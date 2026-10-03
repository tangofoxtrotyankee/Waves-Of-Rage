/**
 * End-to-end smoke test for Waves of Rage 2: Boardmasters.
 *
 * Starts a Vite dev server, opens boardmasters.html in headless Chromium
 * (SwiftShader provides WebGL 2) and drives the prototype through its
 * states, reading the dev-only `window.bm` handle. Run with `npm test`. Set
 * CHROMIUM_PATH to use an existing browser binary instead of Playwright's.
 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT ?? 5201);
const URL = `http://127.0.0.1:${PORT}/boardmasters.html`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
};

async function waitForServer(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  if (!(await waitForServer(URL, 30000))) throw new Error('dev server did not start');

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(2500);

  const wait = (ms) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const state = () => ev(() => window.bm.run.state);
  const surfer = () => ev(() => {
    const s = window.bm.run.surfer;
    return { x: s.x, z: s.z, y: s.y, speed: s.speed, airborne: s.airborne, heading: s.heading };
  });
  const hold = async (key, ms) => {
    await page.keyboard.down(key);
    await wait(ms);
    await page.keyboard.up(key);
  };

  // --- boot and title ---
  check('page boots with the dev handle', await ev(() => typeof window.bm === 'object' && !!window.bm.run));
  check('title state on load', (await state()) === 'title');
  check('the surfer rides on its own on the title (attract)', (await surfer()).z > 5, `z=${(await surfer()).z.toFixed(1)}`);

  // --- character select ---
  await page.keyboard.press('ArrowRight'); await wait(100);
  check('Right on the title picks the next character', (await ev(() => window.bm.run.spec.id)) === 'kai');
  await page.keyboard.press('ArrowLeft'); await wait(100);
  check('Left picks the previous one', (await ev(() => window.bm.run.spec.id)) === 'sam');

  // --- start and move ---
  await page.keyboard.press('Space');
  await wait(300);
  check('Space starts a run', (await state()) === 'playing');
  const s0 = await surfer();
  await wait(800);
  const s1 = await surfer();
  check('the surfer travels forward', s1.z > s0.z + 5, `${s0.z.toFixed(1)} -> ${s1.z.toFixed(1)}`);
  check('distance and score follow', await ev(() => window.bm.run.distance > 5 && window.bm.run.score > 5));

  await hold('ArrowRight', 450);
  const sRight = await surfer();
  await hold('ArrowLeft', 900);
  const sLeft = await surfer();
  // The chase camera looks down +z, so screen-right is world -x.
  check('Right carves to screen-right (world -x), Left back', sRight.x < s1.x - 1 && sLeft.x > sRight.x + 1, `${s1.x.toFixed(1)} -> ${sRight.x.toFixed(1)} -> ${sLeft.x.toFixed(1)}`);
  await wait(600);

  const v0 = (await surfer()).speed;
  await hold('ArrowUp', 700);
  const v1 = (await surfer()).speed;
  check('Up pumps for speed', v1 > v0 + 1, `${v0.toFixed(1)} -> ${v1.toFixed(1)}`);
  await hold('ArrowDown', 700);
  const v2 = (await surfer()).speed;
  check('Down brakes', v2 < v1 - 1, `${v1.toFixed(1)} -> ${v2.toFixed(1)}`);

  // --- jump ---
  for (let i = 0; i < 30 && (await surfer()).airborne; i++) await wait(50);
  await page.keyboard.press('Space');
  await wait(120);
  check('Space jumps', (await surfer()).airborne);
  let landed = false;
  for (let i = 0; i < 60 && !landed; i++) {
    await wait(50);
    landed = !(await surfer()).airborne;
  }
  check('the surfer lands again', landed);

  // --- world ---
  const world = await ev(() => ({
    rivals: window.bm.run.rivals.length,
    rivalZ: window.bm.run.rivals[0]?.z ?? -1,
    buoys: window.bm.run.buoys.length,
    ramps: window.bm.run.layout.features.filter((f) => f.kind === 'ramp').length,
    finish: window.bm.run.layout.finishZ,
    oceanMesh: !!window.bm.run.ocean.mesh.geometry,
  }));
  check('seven rivals ride nearby', world.rivals === 7 && Math.abs(world.rivalZ - (await surfer()).z) < 60, `rival z=${world.rivalZ.toFixed(1)}`);
  check('position is somewhere in the field of eight', await ev(() => window.bm.run.rank >= 1 && window.bm.run.rank <= 8));

  // --- combat: a rival beside the surfer, one punch on its last health point ---
  const placeRival = (i, dx, health) => ev(([i, dx, health]) => {
    const r = window.bm.run; const s = r.surfer; const v = r.rivals[i];
    v.x = s.x + dx; v.z = s.z + 0.3; v.y = s.y; v.heading = 0; v.health = health; v.wiped = false; v.knockedOut = false;
  }, [i, dx, health]);
  // Fast riding hops off crests on its own, so wait for the water before anything that needs the surfer grounded.
  const grounded = async () => { for (let i = 0; i < 60 && (await surfer()).airborne; i++) await wait(50); };
  // Punch (or barge) a rival placed beside the surfer; retried in case a hop or stun swallowed the press.
  const strike = async (index, dx, health, key) => {
    for (let tries = 0; tries < 4; tries++) {
      await grounded();
      await placeRival(index, dx, health);
      await page.keyboard.press(key);
      let peak = 0; let r = null;
      for (let t = 0; t < 8; t++) { // the shove decays fast, so keep the peak
        await wait(25);
        r = await ev((i) => ({ health: window.bm.run.rivals[i].health, shove: window.bm.run.rivals[i].shoveVx }), index);
        peak = Math.max(peak, Math.abs(r.shove));
      }
      if (r.health < health) return { ...r, peak };
      await wait(500);
    }
    return null;
  };
  const score0 = await ev(() => window.bm.run.score);
  // Rivals 1 and 3 (POSER, GIRL RIVAL) are below the aggression threshold, so they do not shoulder-check mid-test.
  await strike(1, 1.0, 1, 'x');
  const ko = await ev(() => ({ out: window.bm.run.rivals[1].knockedOut, kos: window.bm.run.knockouts, score: window.bm.run.score }));
  check('a punch on a one-health rival knocks it out for 500', ko.out && ko.kos === 1 && ko.score >= score0 + 500, JSON.stringify(ko));
  await wait(600);
  const barged = await strike(3, -1.0, 2, 'Shift');
  check('a barge shoves a rival hard and takes a health point', !!barged && barged.peak > 4 && barged.health === 1, JSON.stringify(barged));

  // --- tricks: a full spin lands clean and scores; a half spin crashes ---
  const trick = async (spin) => {
    for (let tries = 0; tries < 5; tries++) {
      await grounded();
      await ev(() => { window.bm.run.lastLanding = null; });
      await page.keyboard.press('Space'); await wait(60);
      if (!(await surfer()).airborne) { await wait(300); continue; }
      await ev((spin) => { window.bm.run.surfer.spin = spin; }, spin);
      for (let i = 0; i < 60; i++) {
        await wait(50);
        const l = await ev(() => window.bm.run.lastLanding);
        if (l) return l;
      }
    }
    return null;
  };
  const spun = await trick(Math.PI * 2);
  check('a 360 landed clean scores air, spin and landing', !!spun && spun.clean && spun.points >= 850, JSON.stringify(spun));
  await wait(400);
  const hp = await ev(() => window.bm.run.health);
  const crashed = await trick(Math.PI);
  const hpAfter = await ev(() => window.bm.run.health);
  check('a 180 is a bad landing: no points, one heart lost', !!crashed && !crashed.clean && crashed.points === 0 && hpAfter === hp - 1, `${JSON.stringify(crashed)} health ${hp}->${hpAfter}`);
  await wait(1500);

  // --- RAGE: a knockout on a nearly full meter starts it ---
  await ev(() => { window.bm.run.rage = 0.95; window.bm.run.health = 3; });
  await strike(3, 1.0, 1, 'x');
  check('a knockout on a full meter starts RAGE', await ev(() => window.bm.run.raging === true && window.bm.run.rage > 0.9));

  // --- pause ---
  await page.keyboard.press('Escape'); await wait(150);
  check('Escape pauses', (await state()) === 'paused');
  const zPaused = (await surfer()).z; await wait(300);
  check('nothing moves while paused', (await surfer()).z === zPaused);
  await page.keyboard.press('Space'); await wait(150);
  check('Space resumes', (await state()) === 'playing');
  check('the course has buoys, ramps and a finish', world.buoys > 5 && world.ramps > 5 && world.finish === 1200, `${world.buoys} buoys, ${world.ramps} ramps`);
  check('the ocean mesh exists', world.oceanMesh);

  // --- wipeout: put a buoy in the surfer's path with one heart left (RAGE would smash it, so end it first) ---
  await ev(() => { window.bm.run.rageUntil = 0; });
  await wait(100);
  await grounded();
  await ev(() => {
    const run = window.bm.run;
    run.health = 1;
    const s = run.surfer;
    const b = run.buoys[0];
    Object.defineProperty(b, 'x', { value: s.x, writable: true });
    Object.defineProperty(b, 'z', { value: s.z + 6, writable: true });
  });
  await wait(900);
  check('a buoy hit on the last heart wipes out', (await state()) === 'wipeout' && (await ev(() => window.bm.run.health)) === 0, `state=${await state()}`);
  await page.keyboard.press('Space');
  await wait(200);
  check('results ignore input at first', (await state()) === 'wipeout');
  await wait(1700);
  await page.keyboard.press('Space');
  await wait(300);
  check('Space restarts from the results', (await state()) === 'playing' && (await ev(() => window.bm.run.health)) === 3 && (await surfer()).z < 20);

  // --- finish ---
  await ev(() => {
    window.bm.run.surfer.z = window.bm.run.layout.finishZ - 8;
  });
  await wait(900);
  check('crossing the line finishes the run', (await state()) === 'finished');

  // --- back to the main menu ---
  await wait(1700);
  const errorsOnSequelPage = errors.slice(); // the original game's page then calls the score API, which this test does not run
  await page.keyboard.press('Escape');
  await wait(1000);
  let phaserReady = false; // the original game's bundle takes a moment on a cold dev server
  for (let i = 0; i < 48 && !phaserReady; i++) {
    await wait(250);
    phaserReady = await ev(() => !!(window.game && window.game.scene));
  }
  check('Escape returns to the main menu page', new globalThis.URL(page.url()).pathname === '/' && phaserReady);

  check('no console or page errors on the sequel page', errorsOnSequelPage.length === 0, errorsOnSequelPage.join(' | '));

  // --- a phone: upright view, touch input, tap to start, tap to jump, HIT button ---
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const tp = await phone.newPage();
  const phoneErrors = [];
  tp.on('pageerror', (e) => phoneErrors.push(e.message));
  await tp.goto(URL); await tp.waitForTimeout(2500);
  const view = await tp.evaluate(() => ({ w: window.bm.renderer.width, h: window.bm.renderer.height, touch: window.bm.input.touch }));
  check('phone: upright 240x426 view with touch input', view.w === 240 && view.h === 426 && view.touch, JSON.stringify(view));
  const css = await tp.evaluate(() => ({ scale: window.bm.renderer.cssScale, ox: window.bm.renderer.offsetX, oy: window.bm.renderer.offsetY }));
  const tapAt = async (gx, gy) => tp.touchscreen.tap(css.ox + gx * css.scale, css.oy + gy * css.scale);
  await tapAt(120, 300); await tp.waitForTimeout(400);
  check('phone: a tap starts the run', (await tp.evaluate(() => window.bm.run.state)) === 'playing');
  await tp.waitForTimeout(800);
  await tapAt(120, 300); await tp.waitForTimeout(100);
  check('phone: a tap jumps', await tp.evaluate(() => window.bm.run.surfer.airborne));
  let phoneKo = 0;
  for (let tries = 0; tries < 4 && !phoneKo; tries++) {
    for (let i = 0; i < 40 && (await tp.evaluate(() => window.bm.run.surfer.airborne)); i++) await tp.waitForTimeout(50);
    await tp.evaluate(() => { const r = window.bm.run; const s = r.surfer; const v = r.rivals[1]; v.x = s.x + 1.0; v.z = s.z + 0.3; v.y = s.y; v.health = 1; v.wiped = false; v.knockedOut = false; });
    await tapAt(240 - 68, 426 - 30); await tp.waitForTimeout(300);
    phoneKo = await tp.evaluate(() => window.bm.run.knockouts);
  }
  check('phone: the HIT button punches', phoneKo >= 1);
  await tapAt(120, 9); await tp.waitForTimeout(150);
  check('phone: the pause button pauses', (await tp.evaluate(() => window.bm.run.state)) === 'paused');
  check('phone: no page errors', phoneErrors.length === 0, phoneErrors.join(' | '));
  await phone.close();
} catch (err) {
  console.error('TEST CRASHED:', err);
  results.push(false);
} finally {
  await browser?.close();
  server.kill();
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);

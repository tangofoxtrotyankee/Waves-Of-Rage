/**
 * End-to-end smoke test for Waves of Rage 2: Boardmasters.
 *
 * Starts a Vite dev server, opens boardmasters.html in headless Chromium
 * (SwiftShader provides WebGL 2) and drives the prototype through its
 * states, reading the dev-only `window.bm` handle. Run with `npm test`. Set
 * CHROMIUM_PATH to use an existing browser binary instead of Playwright's.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.BM_PORT ?? 5201);
const URL = `http://127.0.0.1:${PORT}/boardmasters.html`;
// Spawn Vite's own script (not the npx wrapper) so killing it really stops the server.
const VITE = fileURLToPath(new globalThis.URL('../node_modules/vite/bin/vite.js', import.meta.url));

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

const server = spawn(process.execPath, [VITE, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
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
  // Wait for the game, not the clock: a cold dev server can take seconds to serve the bundle.
  const booted = await page.waitForFunction(() => window.bm && window.bm.run && window.bm.hud.fontLoaded, null, { timeout: 30000 }).then(() => true, () => false);

  const wait = (ms) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const until = (fn, timeout = 8000) => page.waitForFunction(fn, null, { timeout, polling: 50 }).then(() => true, () => false);
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
  check('page boots with the dev handle and the HUD font', booted);
  check('title state on load', (await state()) === 'title');
  check('the surfer rides on its own on the title (attract)', await until(() => window.bm.run.surfer.z > 5), `z=${(await surfer()).z.toFixed(1)}`);

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

  // Slopes change speed too, so start from a known speed and take the extreme over the hold.
  await ev(() => { window.bm.run.surfer.speed = 13; });
  await page.keyboard.down('ArrowUp');
  let vMax = 0;
  for (let i = 0; i < 12; i++) { await wait(100); vMax = Math.max(vMax, (await surfer()).speed); }
  await page.keyboard.up('ArrowUp');
  check('Up pumps for speed', vMax > 14, `peak ${vMax.toFixed(1)}`);
  await ev(() => { window.bm.run.surfer.speed = 16; });
  await page.keyboard.down('ArrowDown');
  let vMin = 99;
  for (let i = 0; i < 8; i++) { await wait(100); vMin = Math.min(vMin, (await surfer()).speed); }
  await page.keyboard.up('ArrowDown');
  check('Down brakes', vMin < 12, `low ${vMin.toFixed(1)}`);

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
    buoys: window.bm.run.buoys.filter((b) => b.active).length,
    ramps: window.bm.run.generator.features.filter((f) => f.kind === 'ramp').length,
    ahead: window.bm.run.generator.generatedTo - window.bm.run.surfer.z,
    oceanMesh: !!window.bm.run.ocean.mesh.geometry,
  }));
  check('seven rivals ride the course', world.rivals === 7 && world.rivalZ > 10 && Math.abs(world.rivalZ - (await surfer()).z) < 150, `rival z=${world.rivalZ.toFixed(1)}`);
  // The brief's other items: a follow camera, water that varies as terrain, a non-lethal hazard.
  const cam = await ev(() => { const c = window.bm.renderer.camera.position; const s = window.bm.run.surfer; return { behind: s.z - c.z, above: c.y - s.y, beside: Math.abs(c.x - s.x) }; });
  check('the camera follows from behind and above', cam.behind > 3 && cam.behind < 7 && cam.above > 0.8 && cam.beside < 3, JSON.stringify(cam));
  const terrain = await ev(() => { const o = window.bm.run.ocean; const z = window.bm.run.surfer.z; const hs = [0, 10, 20, 30, 40].map((d) => o.height(0, z + d)); return Math.max(...hs) - Math.min(...hs); });
  check('the water ahead varies in height like terrain', terrain > 0.8, `range ${terrain.toFixed(2)} m`);
  await ev(() => { const r = window.bm.run; const s = r.surfer; s.heading = 0; s.shoveVx = 0; const b = r.buoys[0]; Object.defineProperty(b, 'x', { value: s.x, writable: true }); Object.defineProperty(b, 'z', { value: s.z + 5, writable: true }); });
  check('a buoy hit costs a heart and the run goes on', await until(() => window.bm.run.health === 2) && (await state()) === 'playing');
  await wait(1500);
  check('position is somewhere in the field of eight', await ev(() => window.bm.run.rank >= 1 && window.bm.run.rank <= 8));

  // --- combat: a rival beside the surfer, one punch on its last health point ---
  // reset() puts the rival on the water with no velocity; setting x/z/y directly leaves a huge surface velocity that launches it.
  const placeRival = (i, dx, health) => ev(([i, dx, health]) => {
    const r = window.bm.run; const s = r.surfer; const v = r.rivals[i];
    v.reset(s.x + dx, s.z + 0.3, r.ocean); v.health = health;
  }, [i, dx, health]);
  // Fast riding hops off crests on its own, so wait for the water before anything that needs the surfer grounded.
  const grounded = async () => { for (let i = 0; i < 60 && (await surfer()).airborne; i++) await wait(50); };
  // Punch (or barge) a rival placed beside the surfer; retried in case a hop or stun swallowed the press.
  const strike = async (index, dx, health, key) => {
    for (let tries = 0; tries < 4; tries++) {
      if ((await state()) !== 'playing') return null;
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
  await ev(() => { window.bm.run.health = 3; }); // the course's own buoys are still out there
  await wait(1500);

  // --- RAGE: a knockout on a nearly full meter starts it ---
  if ((await state()) !== 'playing') { await ev(() => window.bm.run.start()); await wait(500); }
  await ev(() => { window.bm.run.rage = 0.95; window.bm.run.health = 3; });
  const rageStrike = await strike(3, 1.0, 1, 'x');
  check('a knockout on a full meter starts RAGE', await ev(() => window.bm.run.raging === true && window.bm.run.rage > 0.9), `strike=${JSON.stringify(rageStrike)} ${await ev(() => { const r = window.bm.run; const s = r.surfer; return JSON.stringify({ state: r.state, kos: r.knockouts, health: r.health, texts: r.floating.map((f) => f.text), stun: +(s.stunnedUntil - r.time).toFixed(2), air: s.airborne, z: +s.z.toFixed(0), speed: +s.speed.toFixed(1) }); })}`);

  // --- combos: RIGHT RIGHT UP barrel-rolls, UP UP boosts ---
  if ((await state()) !== 'playing') { await ev(() => window.bm.run.start()); await wait(200); }
  // Retried: a roll cut short by a rising face (under half a second) is not scored, and the next flight would be read instead.
  let rolled = null;
  for (let tries = 0; tries < 5 && !(rolled && rolled.rolled); tries++) {
    await grounded();
    await ev(() => { window.bm.run.lastLanding = null; window.bm.run.surfer.rollProgress = 0; });
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp');
    await wait(80);
    if (!(await ev(() => window.bm.run.surfer.rolling))) { await wait(400); continue; }
    rolled = await until(() => window.bm.run.lastLanding !== null, 4000) ? await ev(() => window.bm.run.lastLanding) : null;
  }
  check('RIGHT RIGHT UP is a barrel roll that lands for points', !!rolled && rolled.rolled && rolled.clean && rolled.points >= 750, JSON.stringify(rolled));
  let boosted = false;
  for (let tries = 0; tries < 3 && !boosted; tries++) {
    await grounded();
    await ev(() => { window.bm.run.surfer.speed = 13; window.bm.run.surfer.boostCooldownUntil = 0; });
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
    boosted = await until(() => window.bm.run.surfer.boostUntil > window.bm.run.time && window.bm.run.surfer.speed > 16, 600);
    if (!boosted) await wait(600);
  }
  check('UP UP is a boost', boosted, `speed ${(await surfer()).speed.toFixed(1)}`);

  // --- pause ---
  if ((await state()) !== 'playing') { await ev(() => window.bm.run.start()); await wait(200); } // never press Escape outside play: it would leave the page
  await page.keyboard.press('Escape'); await wait(150);
  check('Escape pauses', (await state()) === 'paused');
  const zPaused = (await surfer()).z; await wait(300);
  check('nothing moves while paused', (await surfer()).z === zPaused);
  await page.keyboard.press('Space'); await wait(150);
  check('Space resumes', (await state()) === 'playing');
  check('the course is generated ahead with buoys and ramps', world.buoys > 3 && world.ramps > 3 && world.ahead > 250, `${world.buoys} buoys, ${world.ramps} ramps, ${world.ahead.toFixed(0)} m ahead`);
  check('the ocean mesh exists', world.oceanMesh);

  // --- wipeout: put a buoy in the surfer's path with one heart left (RAGE would smash it, so end it first) ---
  await ev(() => { window.bm.run.rageUntil = 0; });
  await wait(100);
  await grounded();
  await ev(() => {
    const run = window.bm.run;
    run.health = 1;
    const s = run.surfer;
    s.heading = 0;
    s.shoveVx = 0;
    const b = run.buoys[1];
    Object.defineProperty(b, 'x', { value: s.x, writable: true });
    Object.defineProperty(b, 'z', { value: s.z + 5, writable: true });
  });
  check('a buoy hit on the last heart wipes out', await until(() => window.bm.run.state === 'wipeout') && (await ev(() => window.bm.run.health)) === 0, `state=${await state()}`);
  // An earlier wipeout in this page may already hold a better run; either way the saved best covers this one.
  const best = await ev(() => ({ newBest: window.bm.run.newBest, score: Math.floor(window.bm.run.score), saved: JSON.parse(localStorage.getItem('waves-of-rage.bm.best') || 'null') }));
  check('the best score and distance are kept on the device', !!best.saved && best.saved.score > 0 && best.saved.distance > 0 && (best.newBest || best.saved.score >= best.score), JSON.stringify(best));
  await page.keyboard.press('Space');
  await wait(200);
  check('results ignore input at first', (await state()) === 'wipeout');
  await until(() => window.bm.run.stateTime > 1.7);
  await page.keyboard.press('Space');
  check('Space restarts from the results', await until(() => window.bm.run.state === 'playing') && (await ev(() => window.bm.run.health)) === 3 && (await surfer()).z < 20);

  // --- endless: far down the course the run goes on and the course keeps coming ---
  await ev(() => { window.bm.run.surfer.z = 1300; });
  await wait(300);
  const far = await ev(() => ({ state: window.bm.run.state, ahead: window.bm.run.generator.generatedTo, buoysAhead: window.bm.run.buoys.filter((b) => b.active && b.z > 1300).length }));
  check('there is no finish line: at 1,300 m the run goes on with course ahead', far.state === 'playing' && far.ahead > 1500 && far.buoysAhead > 2, JSON.stringify(far));

  // --- boost gates: ride over the chevrons for a BOOST ---
  await grounded();
  const gate = await ev(() => {
    const run = window.bm.run;
    const s = run.surfer;
    const c = run.chevrons.find((c) => c.active && c.z > s.z + 10);
    if (!c) return null;
    s.heading = 0;
    s.shoveVx = 0;
    s.x = c.x;
    s.z = c.z - 6;
    s.y = run.ocean.height(c.x, c.z - 6);
    s.vy = 0;
    s.boostUntil = 0;
    return { x: +c.x.toFixed(1), z: c.z, time: +run.time.toFixed(2) };
  });
  const gateBoost = !!gate && (await until(() => window.bm.run.surfer.boostUntil > window.bm.run.time, 4000));
  const gateAfter = await ev((z) => ({ taken: !window.bm.run.chevrons.some((c) => c.active && c.z === z), texts: window.bm.run.floating.map((f) => f.text) }), gate ? gate.z : -1);
  check('riding over a boost gate gives a BOOST and takes the gate', gateBoost && gateAfter.taken && gateAfter.texts.includes('BOOST!'), JSON.stringify({ gate, gateAfter }));

  // --- back to the main menu, from the pause panel ---
  const errorsOnSequelPage = errors.slice(); // the original game's page then calls the score API, which this test does not run
  await page.keyboard.press('Escape'); await wait(150);
  await page.keyboard.press('m');
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
    await tp.evaluate(() => { const r = window.bm.run; const v = r.rivals[1]; v.reset(r.surfer.x + 1.0, r.surfer.z + 0.3, r.ocean); v.health = 1; });
    await tapAt(240 - 84, 426 - 32); await tp.waitForTimeout(300);
    phoneKo = await tp.evaluate(() => window.bm.run.knockouts);
  }
  check('phone: the HIT button punches', phoneKo >= 1);
  // Holding RIGHT on the pad carves to screen-right (world -x); a mouse press stands in for a held thumb.
  for (let i = 0; i < 40 && (await tp.evaluate(() => window.bm.run.surfer.airborne)); i++) await tp.waitForTimeout(50);
  await tp.evaluate(() => { window.bm.run.surfer.heading = 0; window.bm.run.surfer.shoveVx = 0; window.bm.run.surfer.stunnedUntil = 0; });
  await tp.mouse.move(css.ox + 76 * css.scale, css.oy + (426 - 32) * css.scale);
  await tp.mouse.down();
  let headingMin = 0;
  for (let i = 0; i < 8; i++) { await tp.waitForTimeout(100); headingMin = Math.min(headingMin, await tp.evaluate(() => window.bm.run.surfer.heading)); }
  await tp.mouse.up();
  check('phone: holding RIGHT carves to screen-right (heading swings to -x)', headingMin < -0.3, `min heading ${headingMin.toFixed(2)}`);
  let phoneRolled = false;
  for (let tries = 0; tries < 4 && !phoneRolled; tries++) {
    for (let i = 0; i < 40 && (await tp.evaluate(() => window.bm.run.surfer.airborne)); i++) await tp.waitForTimeout(50);
    await tapAt(76, 426 - 32); await tapAt(76, 426 - 32); await tapAt(52, 426 - 74); await tp.waitForTimeout(80);
    phoneRolled = await tp.evaluate(() => window.bm.run.surfer.rolling);
    if (!phoneRolled) await tp.waitForTimeout(500);
  }
  check('phone: RIGHT RIGHT UP on the pad barrel-rolls', phoneRolled);
  await tapAt(120, 9); await tp.waitForTimeout(150);
  check('phone: the pause button pauses', (await tp.evaluate(() => window.bm.run.state)) === 'paused');
  check('phone: no page errors', phoneErrors.length === 0, phoneErrors.join(' | '));
  // The way back keeps the overrides too (opened with ?touch=1 here to prove it).
  const back = await phone.newPage();
  await back.goto(`${URL}?touch=1&portrait=1`);
  await back.waitForFunction(() => window.bm && window.bm.run, null, { timeout: 30000 });
  await back.evaluate(() => { window.bm.run.state = 'title'; });
  await back.keyboard.press('Escape'); await back.waitForTimeout(1500);
  const backUrl = new globalThis.URL(back.url());
  check('phone: MENU returns to the main menu with the sequel selected and the overrides kept', backUrl.pathname === '/' && backUrl.searchParams.get('game') === 'boardmasters' && backUrl.searchParams.get('touch') === '1' && backUrl.searchParams.get('portrait') === '1', back.url());
  await back.close();
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

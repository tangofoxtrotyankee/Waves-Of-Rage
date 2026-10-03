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
  check('one rival rides nearby', world.rivals === 1 && Math.abs(world.rivalZ - (await surfer()).z) < 40, `rival z=${world.rivalZ.toFixed(1)}`);
  check('the course has buoys, ramps and a finish', world.buoys > 5 && world.ramps > 5 && world.finish === 1200, `${world.buoys} buoys, ${world.ramps} ramps`);
  check('the ocean mesh exists', world.oceanMesh);

  // --- wipeout: put a buoy in the surfer's path with one heart left ---
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
  for (let i = 0; i < 20 && !phaserReady; i++) {
    await wait(250);
    phaserReady = await ev(() => !!(window.game && window.game.scene));
  }
  check('Escape returns to the main menu page', new globalThis.URL(page.url()).pathname === '/' && phaserReady);

  check('no console or page errors on the sequel page', errorsOnSequelPage.length === 0, errorsOnSequelPage.join(' | '));
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

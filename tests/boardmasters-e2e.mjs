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
  const grounded = async () => { for (let i = 0; i < 60 && (await surfer()).airborne; i++) await wait(50); };
  // Hold a key for this much GAME time (the run clock), so a slow frame under load cannot shorten the hold.
  const holdGame = async (key, seconds) => {
    const t0 = await ev(() => window.bm.run.time);
    await page.keyboard.down(key);
    await page.waitForFunction((end) => window.bm.run.time >= end, t0 + seconds, { timeout: 15000, polling: 20 }).catch(() => {});
    await page.keyboard.up(key);
  };
  // Sample a value every `step` seconds of game time for `seconds` of game time.
  const sampleGame = async (seconds, step, read) => {
    const out = [];
    const t0 = await ev(() => window.bm.run.time);
    for (let t = step; t <= seconds + 1e-6; t += step) {
      await page.waitForFunction((end) => window.bm.run.time >= end, t0 + t, { timeout: 15000, polling: 20 }).catch(() => {});
      out.push(await ev(read));
    }
    return out;
  };
  const hold = async (key, ms) => {
    await page.keyboard.down(key);
    await wait(ms);
    await page.keyboard.up(key);
  };
  // Wait for this much GAME time (the run clock).
  const gameWait = (seconds) => ev(() => window.bm.run.time).then((t0) => page.waitForFunction((end) => window.bm.run.time >= end, t0 + seconds, { timeout: 30000, polling: 20 }).catch(() => {}));
  // Rivals fight back: for the checks that are not about that, hold their attacks (a restart lets them fight again) and keep them clear of the surfer.
  const calm = () => ev(() => {
    const r = window.bm.run;
    r.rivals.forEach((v, k) => {
      v.holdChecks(1e9);
      if (!v.knockedOut && Math.abs(v.z - r.surfer.z) < 30) v.reset(-9 + k * 4.5, r.surfer.z - 60 - k * 5, r.ocean);
    });
  });
  // No course buoy in the way of a trick check: a buoy clipped in the air would cost health that the check is not about.
  const clearAhead = () => ev(() => { const r = window.bm.run; for (const b of r.buoys) if (b.active && b.z > r.surfer.z - 5 && b.z < r.surfer.z + 80) b.retire(); });

  // --- boot and title ---
  check('page boots with the dev handle and the HUD font', booted);
  check('title state on load', (await state()) === 'title');
  check('the surfer rides on its own on the title (attract)', await until(() => window.bm.run.surfer.z > 5), `z=${(await surfer()).z.toFixed(1)}`);

  // --- character select ---
  await page.keyboard.press('ArrowRight');
  check('Right on the title picks the next character', await until(() => window.bm.run.spec.id === 'kai', 5000), `id=${await ev(() => window.bm.run.spec.id)}`);
  await page.keyboard.press('ArrowLeft');
  check('Left picks the previous one', await until(() => window.bm.run.spec.id === 'sam', 5000), `id=${await ev(() => window.bm.run.spec.id)}`);

  // --- start and move ---
  await page.keyboard.press('Space');
  check('Space starts a run', await until(() => window.bm.run.state === 'playing', 5000));
  const s0 = await surfer();
  await page.waitForFunction((end) => window.bm.run.time >= end, (await ev(() => window.bm.run.time)) + 0.8, { timeout: 15000, polling: 20 }).catch(() => {});
  const s1 = await surfer();
  check('the surfer travels forward', s1.z > s0.z + 5, `${s0.z.toFixed(1)} -> ${s1.z.toFixed(1)}`);
  check('distance and score follow', await ev(() => window.bm.run.distance > 5 && window.bm.run.score > 5));

  await holdGame('ArrowRight', 0.45);
  const sRight = await surfer();
  await holdGame('ArrowLeft', 0.9);
  const sLeft = await surfer();
  // The chase camera looks down +z, so screen-right is world -x.
  check('Right carves to screen-right (world -x), Left back', sRight.x < s1.x - 1 && sLeft.x > sRight.x + 1, `${s1.x.toFixed(1)} -> ${sRight.x.toFixed(1)} -> ${sLeft.x.toFixed(1)}`);
  await wait(600);

  // Slopes change speed too, so start from a known speed and take the extreme over the hold.
  await ev(() => { window.bm.run.surfer.speed = 13; });
  await page.keyboard.down('ArrowUp');
  const vUp = await sampleGame(1.2, 0.1, () => window.bm.run.surfer.speed);
  await page.keyboard.up('ArrowUp');
  const vMax = Math.max(...vUp);
  check('Up pumps for speed', vMax > 14, `peak ${vMax.toFixed(1)}`);
  await ev(() => { window.bm.run.surfer.speed = 16; });
  await page.keyboard.down('ArrowDown');
  const vDown = await sampleGame(0.8, 0.1, () => window.bm.run.surfer.speed);
  await page.keyboard.up('ArrowDown');
  const vMin = Math.min(...vDown);
  check('Down brakes', vMin < 12, `low ${vMin.toFixed(1)}`);

  // --- jump ---
  for (let i = 0; i < 30 && (await surfer()).airborne; i++) await wait(50);
  await page.keyboard.press('Space');
  check('Space jumps', await until(() => window.bm.run.surfer.airborne, 3000));
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
  check('five rivals ride the course (a field of six)', world.rivals === 5 && world.rivalZ > 10 && Math.abs(world.rivalZ - (await surfer()).z) < 150, `rival z=${world.rivalZ.toFixed(1)}`);
  // The brief's other items: a follow camera, water that varies as terrain, a non-lethal hazard.
  const cam = await ev(() => { const c = window.bm.renderer.camera.position; const s = window.bm.run.surfer; return { behind: s.z - c.z, above: c.y - s.y, beside: Math.abs(c.x - s.x) }; });
  check('the camera follows from behind and above', cam.behind > 3 && cam.behind < 7 && cam.above > 0.8 && cam.beside < 3, JSON.stringify(cam));
  const terrain = await ev(() => { const o = window.bm.run.ocean; const z = window.bm.run.surfer.z; const hs = [0, 10, 20, 30, 40].map((d) => o.height(0, z + d)); return Math.max(...hs) - Math.min(...hs); });
  check('the water ahead varies in height like terrain', terrain > 0.8, `range ${terrain.toFixed(2)} m`);
  // Put a pooled buoy (re-armed with place) in the surfer's path; again if a hop off a crest carried the surfer over it.
  const buoyAhead = (index) => ev((index) => { const r = window.bm.run; const s = r.surfer; s.heading = 0; s.shoveVx = 0; r.buoys[index].place(s.x, s.z + 5); }, index);
  let buoyHit = false;
  await calm();
  for (let tries = 0; tries < 4 && !buoyHit; tries++) {
    await grounded();
    await ev(() => { const r = window.bm.run; r.health = 100; r.invulnerableUntil = 0; r.rage = 0; r.rageUntil = 0; });
    await buoyAhead(0);
    buoyHit = await until(() => window.bm.run.health === 75, 2000);
  }
  check('a buoy hit costs 25 health and the race goes on', buoyHit && (await state()) === 'playing', `health ${await ev(() => window.bm.run.health)}`);
  await wait(1500);
  check('position is somewhere in the field of six', await ev(() => window.bm.run.rank >= 1 && window.bm.run.rank <= 6));

  // --- combat: a rival beside the surfer, one punch (50) from a knockout ---
  // reset() puts the rival on the water with no velocity; setting x/z/y directly leaves a huge surface velocity that launches it.
  const placeRival = (i, dx, health) => ev(([i, dx, health]) => {
    const r = window.bm.run; const s = r.surfer; const v = r.rivals[i];
    v.reset(s.x + dx, s.z + 0.3, r.ocean); v.health = health;
  }, [i, dx, health]);
  // Fast riding hops off crests on its own, so wait for the water before anything that needs the surfer grounded.
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
  const kos0 = await ev(() => window.bm.run.knockouts);
  // Rivals 1 and 3 (POSER, GIRL RIVAL) are below the aggression threshold, so they do not attack mid-test.
  await calm();
  await strike(1, 1.0, 50, 'x');
  const ko = await ev(() => ({ out: window.bm.run.rivals[1].knockedOut, kos: window.bm.run.knockouts, score: window.bm.run.score }));
  // At least one knockout: a rival shoved earlier may also have gone into a buoy meanwhile (an environment knockout).
  check('a punch on a rival with 50 health knocks it out for 500', ko.out && ko.kos >= kos0 + 1 && ko.score >= score0 + 500, JSON.stringify({ ...ko, kos0 }));
  await wait(600);
  const barged = await strike(3, -1.0, 100, 'Shift');
  check('a barge shoves a rival hard and takes 50 of its 100 health', !!barged && barged.peak > 4 && barged.health === 50, JSON.stringify(barged));

  // --- rivals fight back: BIG GUY (rival 2, a fighter, POWER 0.95) alongside with its attack ready; its pick forced ---
  // Every step is watched inside the page (a hook on run.update), so a slow machine cannot miss the wind-up. Options:
  // `check` forces the shoulder check (else the punch); `counter` presses HIT `counterAt` seconds into the attack;
  // `carveAt` holds LEFT (away from the rival, which is on the -x side) from that many seconds in; `rage` starts RAGE first.
  const rivalAttack = async (opts = {}) => {
    let log = null;
    for (let tries = 0; tries < 5; tries++) {
      if ((await state()) !== 'playing') return log;
      await grounded();
      await calm();
      log = await ev((o) => new Promise((resolve) => {
        const r = window.bm.run; const s = r.surfer; const v = r.rivals[2];
        r.floating.length = 0; // only this attempt's words
        v.reset(s.x - 1.2, s.z + 0.3, r.ocean);
        v.health = 100;
        v.holdChecks(0);
        r.rivalAttackGate = 0; r.invulnerableUntil = 0; r.health = 100; r.rage = 0;
        if (o.rage) r.startRage(); else r.rageUntil = 0;
        const random = Math.random;
        Math.random = () => (o.check ? 0.99 : 0);
        const out = { startAt: -1, strikeAt: -1, bargeAt: -1, hitAt: -1, counteredAt: -1, warned: false, invulnerableFor: 0, health: 100, rivalHealth: 100, words: [] };
        const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code === 'KeyX' ? 'x' : code }));
        let pressed = false; let carving = false;
        const t0 = r.time;
        const step = Object.getPrototypeOf(r).update;
        r.update = function (dt) {
          step.call(this, dt);
          const phase = v.attackPhase;
          if ((phase === 'windup' || v.checking) && out.startAt < 0) {
            out.startAt = r.time;
            Math.random = random;
          }
          const since = out.startAt >= 0 ? r.time - out.startAt : -1;
          if (since >= 0 && o.counter && !pressed && since >= (o.counterAt ?? 0)) {
            pressed = true;
            key('keydown', 'KeyX'); key('keyup', 'KeyX');
          }
          if (since >= 0 && o.carveAt !== undefined && !carving && since >= o.carveAt) {
            carving = true;
            key('keydown', 'ArrowLeft');
          }
          if (v.threatening) out.warned = true;
          if (phase === 'strike' && out.strikeAt < 0) out.strikeAt = r.time;
          if (v.barging && out.bargeAt < 0) out.bargeAt = r.time;
          if (r.health < 100 && out.hitAt < 0) {
            out.hitAt = r.time;
            out.invulnerableFor = +(r.invulnerableTill - r.time).toFixed(3);
          }
          if (v.health < 100 && out.counteredAt < 0) out.counteredAt = r.time;
          for (const f of r.floats) if (!out.words.includes(f.text)) out.words.push(f.text);
          if (r.time - t0 > 3 || (out.startAt >= 0 && r.time - out.startAt > 1.4)) {
            delete r.update;
            Math.random = random;
            if (carving) key('keyup', 'ArrowLeft');
            out.health = r.health;
            out.rivalHealth = v.health;
            resolve(out);
          }
        };
      }), opts);
      // Done when the attack started and something answered it (a blow landed, the counter, or the dodge).
      if (log.startAt >= 0 && (log.hitAt >= 0 || log.counteredAt >= 0 || log.words.includes('DODGED!'))) return log;
      await wait(400);
    }
    return log;
  };
  // BIG GUY's blows: 12 (punch) or 18 (shoulder check) times its POWER multiplier (0.7 + 0.6 * 0.95), halved in RAGE.
  const power = 0.7 + 0.6 * 0.95;
  const punched = await rivalAttack();
  check('a rival\'s punch is telegraphed (a wind-up of at least 0.35 s, the warning up) and then costs 12 x its POWER', !!punched && punched.startAt >= 0 && punched.strikeAt - punched.startAt >= 0.35 && punched.warned && punched.hitAt >= punched.strikeAt && punched.health === 100 - Math.round(12 * power) && punched.words.includes('PUNCHED!'), JSON.stringify(punched));
  check('a blow leaves the surfer untouchable for 0.35 s (no double hits)', !!punched && punched.invulnerableFor > 0.3 && punched.invulnerableFor <= 0.35 + 1e-6, JSON.stringify(punched && punched.invulnerableFor));
  await wait(400);
  const countered = await rivalAttack({ counter: true });
  check('striking a rival in its wind-up cancels its punch (COUNTER!)', !!countered && countered.counteredAt >= 0 && countered.counteredAt < countered.startAt + 0.4 && countered.hitAt < 0 && countered.health === 100 && countered.rivalHealth === 50 && countered.words.includes('COUNTER!') && !countered.words.includes('PUNCHED!'), JSON.stringify(countered));
  await wait(400);
  const carved = await rivalAttack({ carveAt: 0.2 });
  check('carving away 0.2 s into the wind-up dodges the punch', !!carved && carved.startAt >= 0 && carved.hitAt < 0 && carved.health === 100 && carved.words.includes('DODGED!'), JSON.stringify(carved));
  await wait(400);
  const checked = await rivalAttack({ check: true });
  check('a rival\'s shoulder check has a tell (at least 0.35 s, the warning up) before the barge, then costs 18 x its POWER', !!checked && checked.startAt >= 0 && checked.warned && checked.bargeAt - checked.startAt >= 0.35 && checked.hitAt >= checked.bargeAt && checked.health === 100 - Math.round(18 * power) && checked.words.includes('SHOVED!'), JSON.stringify(checked));
  await wait(400);
  const checkCountered = await rivalAttack({ check: true, counter: true, counterAt: 0.15 });
  check('striking a rival in its shoulder check\'s tell counters it', !!checkCountered && checkCountered.counteredAt >= 0 && checkCountered.hitAt < 0 && checkCountered.health === 100 && checkCountered.words.includes('COUNTER!') && !checkCountered.words.includes('SHOVED!'), JSON.stringify(checkCountered));
  await wait(400);
  const ragePunched = await rivalAttack({ rage: true });
  check('RAGE halves the damage taken', !!ragePunched && ragePunched.hitAt >= 0 && ragePunched.health === 100 - Math.round(12 * power * 0.5), JSON.stringify(ragePunched));
  await ev(() => { const r = window.bm.run; r.rageUntil = 0; r.rage = 0; });
  await gameWait(0.2); // RAGE ends on the next step
  // A rider-on-rider bump (POSER, who does not fight) costs 1.
  let bump = null;
  for (let tries = 0; tries < 4 && !(bump && bump.delta !== null); tries++) {
    await grounded();
    await calm();
    bump = await ev(() => new Promise((resolve) => {
      const r = window.bm.run; const s = r.surfer; const v = r.rivals[1];
      r.health = 100; r.invulnerableUntil = 0; r.bumpCooldown = 0;
      v.reset(s.x + 0.6, s.z + 0.2, r.ocean);
      const t0 = r.time;
      const step = Object.getPrototypeOf(r).update;
      r.update = function (dt) {
        step.call(this, dt);
        if (r.health < 100 || r.time - t0 > 0.5) {
          delete r.update;
          resolve({ delta: r.health < 100 ? r.health - 100 : null });
        }
      };
    }));
  }
  check('a rider-on-rider bump costs 1 health', !!bump && bump.delta === -1, JSON.stringify(bump));
  await calm();
  await ev(() => { window.bm.run.health = 100; });
  await wait(400);

  // --- tricks: a full spin lands clean, scores and heals; a half spin held into the landing crashes; stray or carried steering in the air does not ---
  const trick = async (spin, health = 60) => {
    for (let tries = 0; tries < 5; tries++) {
      await grounded();
      await clearAhead();
      await ev((health) => { window.bm.run.lastLanding = null; window.bm.run.health = health; window.bm.run.invulnerableUntil = 0; }, health);
      await page.keyboard.press('Space'); await wait(60);
      if (!(await surfer()).airborne) { await wait(300); continue; }
      await ev((spin) => { window.bm.run.surfer.spin = spin; }, spin);
      for (let i = 0; i < 60; i++) {
        await wait(50);
        const l = await ev(() => window.bm.run.lastLanding);
        // The health it gave back: the latest gain in the change log.
        if (l) return { ...l, health: await ev(() => window.bm.run.health), heal: await ev(() => { const gains = window.bm.run.healthChanges.filter((c) => c.delta > 0); return gains.length ? gains[gains.length - 1].delta : 0; }) };
      }
    }
    return null;
  };
  const spun = await trick(Math.PI * 2);
  check('a 360 landed clean scores air, spin and landing', !!spun && spun.clean && spun.points >= 850, JSON.stringify(spun));
  check('a clean trick heals: air (or big air) plus 6 per half turn', !!spun && spun.clean && spun.jumped && spun.heal === (spun.airTime >= 1 ? 8 : 4) + 12, JSON.stringify(spun));
  await wait(400);
  const topped = await trick(Math.PI * 2, 95);
  check('healing stops at full health (100)', !!topped && topped.clean && topped.health === 100 && topped.heal === 5, JSON.stringify(topped));
  await wait(400);
  // Air a ramp or a swell throws an idle surfer into (no JUMP, no trick) scores but does not heal: the bar never refills on its own.
  let thrown = null;
  for (let tries = 0; tries < 5 && !thrown; tries++) {
    await grounded();
    await clearAhead();
    await ev(() => { const r = window.bm.run; const s = r.surfer; r.lastLanding = null; r.health = 60; r.invulnerableUntil = 0; s.vy = 6; s.y += 0.05; s.takeOff(); });
    if (!(await until(() => window.bm.run.lastLanding !== null, 4000))) continue;
    const l = await ev(() => ({ ...window.bm.run.lastLanding, health: window.bm.run.health }));
    if (l.clean && l.airTime >= 0.45) thrown = l;
  }
  check('air without a JUMP or a trick scores but does not heal', !!thrown && !thrown.jumped && thrown.points > 0 && thrown.health === 60, JSON.stringify(thrown));
  await ev(() => { window.bm.run.health = 100; });
  await wait(400);
  // Released, a spin settles towards the nearest upright, so the half spin is held into the landing: the steer
  // stays down (no settling) and the spin is kept at 180 through the descent.
  const halfSpin = async () => {
    for (let tries = 0; tries < 5; tries++) {
      await grounded();
      // No course buoy in the way: a buoy clipped on the jump would be a second hit, not this crash.
      await ev(() => { const r = window.bm.run; r.lastLanding = null; r.invulnerableUntil = 0; for (const b of r.buoys) if (b.active && b.z > r.surfer.z - 5 && b.z < r.surfer.z + 80) b.retire(); });
      await page.keyboard.press('Space'); await wait(60);
      if (!(await surfer()).airborne) { await wait(300); continue; }
      await page.keyboard.down('ArrowLeft');
      let landing = null;
      for (let i = 0; i < 80 && !landing; i++) {
        // Only on the way down to the first landing: a bounce off a crest after the crash must not be forced into a second one.
        await ev(() => { const run = window.bm.run; const s = run.surfer; if (run.lastLanding === null && s.airborne && s.vy < 0) { s.spin = Math.PI; s.spinVel = 0; } });
        await wait(30);
        landing = await ev(() => window.bm.run.lastLanding);
      }
      await page.keyboard.up('ArrowLeft');
      if (landing) return landing;
    }
    return null;
  };
  await ev(() => { const r = window.bm.run; r.health = 100; r.rage = 0; r.rageUntil = 0; });
  const hp = await ev(() => window.bm.run.health);
  const crashed = await halfSpin();
  const hpAfter = await ev(() => window.bm.run.health);
  check('a 180 held into the landing is a bad landing: no points, 20 health lost', !!crashed && !crashed.clean && crashed.points === 0 && hpAfter === hp - 20, `${JSON.stringify(crashed)} health ${hp}->${hpAfter}`);
  await ev(() => { window.bm.run.health = 100; });
  await wait(900);
  // A short tap of the steer in mid-air (a phone's digital button) builds only a little spin, which settles back upright.
  const tapInAir = async () => {
    for (let tries = 0; tries < 5; tries++) {
      await grounded();
      await ev(() => { window.bm.run.lastLanding = null; window.bm.run.health = 100; });
      await clearAhead();
      await page.keyboard.press('Space');
      // Past the first moment of air (where the steer is ignored for spinning), then a tap of about a tenth of a second.
      if (!(await until(() => window.bm.run.surfer.airborne && window.bm.run.surfer.airTime > 0.16, 1000))) { await wait(300); continue; }
      await page.keyboard.down('ArrowRight'); await wait(140); await page.keyboard.up('ArrowRight');
      const peakDeg = await ev(() => Math.abs(window.bm.run.surfer.spin) * 180 / Math.PI);
      for (let i = 0; i < 60; i++) {
        await wait(50);
        const landing = await ev(() => window.bm.run.lastLanding);
        if (landing) return { landing, peakDeg: +peakDeg.toFixed(1), health: await ev(() => window.bm.run.health) };
      }
    }
    return null;
  };
  const tapped = await tapInAir();
  check('a short steer tap in the air settles back upright: clean landing, no crash damage', !!tapped && tapped.peakDeg > 1 && tapped.landing.clean && tapped.landing.spinDeg < 30 && tapped.health > 80, JSON.stringify(tapped));
  // A carve held over the lip and on to the landing (the press that used to spin riders into crashes): a steer
  // carried off the water never spins.
  let carried = null;
  for (let tries = 0; tries < 5 && !carried; tries++) {
    await grounded();
    await ev(() => { window.bm.run.lastLanding = null; window.bm.run.health = 100; });
    await clearAhead();
    await page.keyboard.down('ArrowLeft'); await wait(150);
    if ((await surfer()).airborne) { await page.keyboard.up('ArrowLeft'); await wait(300); continue; } // a crest hop took it into the air first
    await page.keyboard.press('Space');
    let maxSpin = 0; let landing = null; let flew = false;
    for (let i = 0; i < 100 && !landing; i++) {
      const r = await ev(() => { const s = window.bm.run.surfer; return { air: s.airborne, spin: Math.abs(s.spin) * 180 / Math.PI, landing: window.bm.run.lastLanding }; });
      flew = flew || r.air;
      maxSpin = Math.max(maxSpin, r.spin);
      landing = r.landing;
      if (!landing) await wait(30);
    }
    await page.keyboard.up('ArrowLeft');
    if (flew && landing) carried = { landing, maxSpinDeg: +maxSpin.toFixed(1), health: await ev(() => window.bm.run.health) };
    else await wait(300);
  }
  check('a carve held over the lip and into the landing does not spin: clean, no crash damage', !!carried && carried.landing.clean && carried.maxSpinDeg < 20 && carried.health > 80, JSON.stringify(carried));
  await wait(400);
  // A spin started in the air and let go at the top of the jump (or an eighth of a turn in) settles to an upright by the
  // landing. The jump is given a known height: a hop off a rising swell can be too short to spin at all.
  let released = null;
  for (let tries = 0; tries < 5 && !released; tries++) {
    await grounded();
    await ev(() => { window.bm.run.lastLanding = null; window.bm.run.health = 100; });
    await clearAhead();
    await page.keyboard.press('Space');
    if (!(await until(() => window.bm.run.surfer.airborne, 600))) { await wait(300); continue; }
    // The jump gets a known height and LEFT goes down in the same frame, inside the page, so a slow machine cannot press it late.
    await ev(() => { const s = window.bm.run.surfer; s.vy = Math.max(s.vy, 7); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft', key: 'ArrowLeft' })); });
    // Released inside the page on the first frame the surfer falls (or has turned 45 degrees), so a slow machine does not hold it late.
    const atRelease = await ev(() => new Promise((resolve) => {
      const tick = () => {
        const s = window.bm.run.surfer;
        if (s.vy >= 0 && s.airborne && Math.abs(s.spin) < Math.PI / 4) { requestAnimationFrame(tick); return; }
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowLeft', key: 'ArrowLeft' }));
        resolve(Math.abs(s.spin) * 180 / Math.PI);
      };
      tick();
    }));
    await page.keyboard.up('ArrowLeft');
    const landedNow = await until(() => window.bm.run.lastLanding !== null, 3000);
    // A swell rising under the jump can cut the air too short for any spin to build (the rule keeps such hops straight): try again.
    if (atRelease <= 8) continue;
    if (landedNow) released = { atReleaseDeg: +atRelease.toFixed(1), landing: await ev(() => window.bm.run.lastLanding), health: await ev(() => window.bm.run.health) };
  }
  check('a spin let go at the top of a jump settles upright: clean landing, no crash damage', !!released && released.atReleaseDeg > 8 && released.landing.clean && released.health > 80, JSON.stringify(released));
  await wait(400);
  // Big air (a crest launch, forced here): a spin pressed in the air and held to the water is helped round to a 360.
  let held360 = null;
  for (let tries = 0; tries < 5 && !held360; tries++) {
    await grounded();
    await ev(() => { window.bm.run.lastLanding = null; window.bm.run.health = 100; });
    await clearAhead();
    await page.keyboard.press('Space');
    if (!(await until(() => window.bm.run.surfer.airborne, 600))) { await wait(300); continue; }
    await ev(() => { window.bm.run.surfer.vy = 9.6; }); // about 1.2 s of air
    await page.keyboard.down('ArrowRight');
    const ok = await until(() => window.bm.run.lastLanding !== null, 4000);
    await page.keyboard.up('ArrowRight');
    if (!ok) continue;
    const attempt = { landing: await ev(() => window.bm.run.lastLanding), health: await ev(() => window.bm.run.health) };
    // A swell rising under the jump can cut the forced air well short of the 1.2 s (0.6 to 1.0 s seen): that is not
    // the big air this check is about, so try again.
    if (attempt.landing.airTime >= 1.1 || tries === 4) held360 = attempt;
    else await wait(300);
  }
  check('a spin held through big air lands as a clean 360', !!held360 && held360.landing.clean && Math.round(held360.landing.spinDeg / 180) === 2 && held360.landing.points >= 850 && held360.health > 80, JSON.stringify(held360));
  // Weaving with quick carve taps (a phone's CARVE buttons): crests throw the rider into the air on their own, and a tap
  // made in one of those hops must never spin it into a crooked landing (no JUMP pressed at all).
  await grounded();
  await ev(() => {
    const run = window.bm.run;
    window.__crooked = [];
    window.__resolveLanding = run.resolveLanding;
    run.resolveLanding = function (l) { if (!l.clean && l.airTime >= 0.45) window.__crooked.push({ air: +l.airTime.toFixed(2), spin: Math.round(l.spinDeg) }); return window.__resolveLanding.call(this, l); };
  });
  let hops = 0;
  for (let i = 0; i < 24; i++) {
    await ev(() => { const r = window.bm.run; r.health = 100; for (const b of r.buoys) if (b.active && Math.abs(b.z - r.surfer.z) < 80) b.retire(); r.rivals.forEach((v, k) => { if (Math.abs(v.z - r.surfer.z) < 30) v.reset(-9 + k * 2.5, r.surfer.z - 60 - k * 5, r.ocean); }); });
    const key = i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key); await wait(350);
    if ((await surfer()).airborne) hops++;
    await page.keyboard.up(key); await wait(250);
  }
  const crooked = await ev(() => { window.bm.run.resolveLanding = window.__resolveLanding; return window.__crooked; });
  check('weaving with carve taps never lands crooked (no spin crashes off crest hops)', crooked.length === 0, `${JSON.stringify(crooked)}, airborne at ${hops} of 24 taps`);
  // The course's own buoys are still out there; and these landings feed the RAGE meter, which the RAGE check wants empty and idle.
  await ev(() => { const r = window.bm.run; r.health = 100; r.rage = 0; r.rageUntil = 0; });
  await wait(1500);

  // --- RAGE: a knockout on a nearly full meter starts it ---
  if ((await state()) !== 'playing') { await ev(() => window.bm.run.start()); await wait(500); }
  await ev(() => { window.bm.run.rage = 0.95; window.bm.run.health = 100; });
  const rageStrike = await strike(3, 1.0, 50, 'x');
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
  const frozen = () => ev(() => { const r = window.bm.run; return { z: r.surfer.z, wake: r.wake.mesh.geometry.drawRange.count, spray: r.spray.mesh.count, floats: r.floats.map((f) => f.age).join() }; });
  const clocks = () => ev(() => ({ time: window.bm.run.time, race: window.bm.run.raceTime }));
  const atPause = await frozen();
  const clockAtPause = await clocks();
  // 40 frames of the game loop (counted, not timed: the run clock itself holds while paused).
  await ev(() => new Promise((resolve) => {
    const r = window.bm.run; const step = Object.getPrototypeOf(r).update; let n = 0;
    r.update = function (dt) { step.call(this, dt); if (++n >= 40) { delete r.update; resolve(); } };
  }));
  const afterPause = await frozen();
  const clockAfterPause = await clocks();
  // The wakes, the spray and the words hold too (they used to age away behind the PAUSED panel).
  check('nothing moves while paused', JSON.stringify(atPause) === JSON.stringify(afterPause), `${JSON.stringify(atPause)} -> ${JSON.stringify(afterPause)}`);
  check('the run clock and the race time hold while paused', clockAfterPause.time === clockAtPause.time && clockAfterPause.race === clockAtPause.race, JSON.stringify({ clockAtPause, clockAfterPause }));
  await page.keyboard.press('Space'); await wait(150);
  check('Space resumes', (await state()) === 'playing');
  check('the course is generated ahead with buoys and ramps', world.buoys > 3 && world.ramps > 3 && world.ahead > 250, `${world.buoys} buoys, ${world.ramps} ramps, ${world.ahead.toFixed(0)} m ahead`);
  check('the ocean mesh exists', world.oceanMesh);

  // --- wipeout: put a buoy in the surfer's path with 20 health left (RAGE would smash it, so end it first) ---
  await ev(() => { window.bm.run.rageUntil = 0; });
  await wait(100);
  await calm();
  await ev(() => { window.bm.run.health = 20; });
  let wipedOut = false;
  for (let tries = 0; tries < 4 && !wipedOut; tries++) {
    await grounded();
    await ev(() => { window.bm.run.invulnerableUntil = 0; window.bm.run.rageUntil = 0; });
    await buoyAhead(1);
    wipedOut = await until(() => window.bm.run.state === 'wipeout', 2000);
  }
  check('zero health wipes out: a buoy hit with 20 health left', wipedOut && (await ev(() => window.bm.run.health)) === 0, `state=${await state()}`);
  // An earlier wipeout in this page may already hold a better score; either way the saved best covers this one. No finish yet: no time or place.
  const best = await ev(() => ({ newBest: window.bm.run.newBest, score: Math.floor(window.bm.run.score), saved: JSON.parse(localStorage.getItem('waves-of-rage.bm.race.sunset-bay') || 'null') }));
  check('a wipeout keeps the best score for the course (no time or place without a finish)', !!best.saved && best.saved.score > 0 && best.saved.time === null && best.saved.place === null && (best.newBest || best.saved.score >= best.score), JSON.stringify(best));
  await page.keyboard.press('Space');
  await wait(200);
  check('results ignore input at first', (await state()) === 'wipeout');
  await until(() => window.bm.run.stateTime > 1.7);
  await page.keyboard.press('Space');
  check('Space restarts from the results', await until(() => window.bm.run.state === 'playing') && (await ev(() => window.bm.run.health)) === 100 && (await surfer()).z < 20);

  // --- boost gates: ride over the chevrons for a BOOST ---
  await calm();
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

  // --- the finish line: the course near it ---
  await calm();
  await ev(() => { const r = window.bm.run; const s = r.surfer; s.z = r.course.length - 200; s.x = 0; s.heading = 0; s.shoveVx = 0; s.y = r.ocean.height(0, s.z); s.vy = 0; r.health = 100; });
  await gameWait(0.3);
  const nearEnd = await ev(() => {
    const r = window.bm.run;
    const L = r.course.length;
    return {
      L,
      line: r.finishLine.z,
      generatedTo: Math.round(r.generator.generatedTo),
      lateBuoys: r.generator.buoys.filter((b) => b.z > L - 60).length + r.buoys.filter((b) => b.active && b.z > L - 60).length,
      lateGates: r.chevrons.filter((c) => c.active && c.z > L - 60).length,
      buoysBefore: r.buoys.filter((b) => b.active && b.z > r.surfer.z && b.z <= L - 60).length,
      rampsAfter: r.generator.features.filter((f) => f.kind === 'ramp' && f.z > L).length,
      callout: r.callout && r.callout.text,
    };
  });
  check('the callout sweeps in as the line nears (the latest passed: FINAL STRETCH at 200 m to go)', nearEnd.callout === 'FINAL STRETCH', JSON.stringify(nearEnd));
  check('the finish line stands at 2,000 m; buoys and gates stop 60 m short of it, ramps run on past it', nearEnd.L === 2000 && nearEnd.line === nearEnd.L && nearEnd.generatedTo > nearEnd.L && nearEnd.lateBuoys === 0 && nearEnd.lateGates === 0 && nearEnd.buoysBefore > 0 && nearEnd.rampsAfter > 0, JSON.stringify(nearEnd));

  // --- crossing it: two rivals just ahead cross first and the rest are far behind, so the surfer finishes 3rd ---
  let crossed = null;
  for (let tries = 0; tries < 3 && !(crossed && crossed.state === 'finished'); tries++) {
    if ((await state()) !== 'playing') { await ev(() => window.bm.run.start()); await gameWait(0.3); await calm(); }
    await grounded();
    const before = await ev(() => {
      const r = window.bm.run; const s = r.surfer; const L = r.course.length;
      s.z = L - 40; s.x = 0; s.heading = 0; s.shoveVx = 0; s.y = r.ocean.height(0, s.z); s.vy = 0; s.speed = 14;
      r.health = 100; r.invulnerableUntil = 0;
      r.rivals.forEach((v, k) => { v.holdChecks(1e9); if (k < 2) v.reset(k === 0 ? -6 : 6, L - 8, r.ocean); else v.reset(-9 + k * 4, L - 150, r.ocean); });
      return { score: r.score };
    });
    await until(() => window.bm.run.state !== 'playing', 20000);
    crossed = await ev(() => { const r = window.bm.run; return { state: r.state, place: r.place, time: r.finishTime, raceTime: r.raceTime, bonus: r.placeBonus, score: r.score, order: r.finishOrder.map((f) => (f.player ? '*' : '') + f.name), newBest: r.newBest, callout: r.callout && r.callout.text }; });
    crossed.before = before.score;
  }
  check('the surfer crosses the line: finished, 3rd behind the two rivals over first, with the race time', !!crossed && crossed.state === 'finished' && crossed.place === 3 && crossed.order[2] === '*SAM' && crossed.time > 1 && crossed.raceTime === crossed.time, JSON.stringify(crossed));
  await gameWait(0.3);
  const fireworks = await ev(() => window.bm.run.finishLine.fireworks.visible);
  check('FINISH! is called over the line and the fireworks go up', !!crossed && crossed.callout === 'FINISH!' && fireworks, JSON.stringify({ callout: crossed && crossed.callout, fireworks }));
  check('the place bonus (800 for 3rd) is added to the score', !!crossed && crossed.bonus === 800 && crossed.score >= crossed.before + 800, JSON.stringify(crossed));
  await gameWait(0.5);
  check('the race clock stops at the line', !!crossed && (await ev(() => window.bm.run.raceTime)) === crossed.time);
  // Over the line the rules are off: a buoy in the surfer's path costs nothing and the score holds.
  const afterLine = await ev(() => { const r = window.bm.run; const s = r.surfer; r.buoys[0].place(s.x, s.z + 4); return { health: r.health, score: r.score }; });
  await gameWait(1);
  const laterLine = await ev(() => ({ health: window.bm.run.health, score: window.bm.run.score, state: window.bm.run.state }));
  check('after the finish nothing costs health or scores', laterLine.state === 'finished' && laterLine.health === afterLine.health && laterLine.score === afterLine.score, JSON.stringify({ afterLine, laterLine }));
  const savedRace = await ev(() => JSON.parse(localStorage.getItem('waves-of-rage.bm.race.sunset-bay') || 'null'));
  check('the best place and time are kept for the course', !!crossed && crossed.newBest && !!savedRace && savedRace.place === 3 && Math.abs(savedRace.time - crossed.time) < 1e-6 && savedRace.score >= Math.floor(crossed.score), JSON.stringify(savedRace));
  await page.keyboard.press('Space');
  await wait(200);
  check('the finish results ignore input at first', (await state()) === 'finished');
  // The rivals race on after the surfer finishes: the three far behind cross later, in order.
  let allOver = false;
  for (let i = 0; i < 40 && !allOver; i++) {
    allOver = await ev(() => window.bm.run.finishOrder.length === 6);
    if (!allOver) await gameWait(1.5);
  }
  const order = await ev(() => window.bm.run.finishOrder.map((f) => ({ name: f.name, time: +f.time.toFixed(2) })));
  check('the rivals race on and cross after the surfer, recorded in order', allOver && order.every((f, i) => i === 0 || f.time >= order[i - 1].time) && order[2].name === 'SAM', JSON.stringify(order));
  await until(() => window.bm.run.stateTime > 2.6); // RACE.resultsSeconds: the results take input
  // --- a restart after a long run brings the shore back to the start line ---
  const spansFar = await ev(() => window.bm.run.scenery.group.children.map((c) => c.position.z).sort((a, b) => a - b));
  await page.keyboard.press('Space');
  check('Space restarts from the finish results', await until(() => window.bm.run.state === 'playing') && (await ev(() => window.bm.run.health === 100 && window.bm.run.place === 0 && window.bm.run.finishOrder.length === 0)) && (await surfer()).z < 20);
  await wait(200);
  const spansStart = await ev(() => window.bm.run.scenery.group.children.map((c) => c.position.z).sort((a, b) => a - b));
  // Each span is 1,200 m long: after the restart one must cover the start line and the other the stretch after it.
  check('a restart after a long run puts the cliffs and pier back at the start', spansFar[0] > 0 && spansStart.some((z) => z <= 0 && z + 1200 > 0) && spansStart[1] === spansStart[0] + 1200, JSON.stringify({ spansFar, spansStart }));

  // --- the title shows the best race: a fresh page ---
  await page.reload();
  await page.waitForFunction(() => window.bm && window.bm.run && window.bm.hud.fontLoaded && window.bm.run.hudView, null, { timeout: 30000 });
  const titleBest = await ev(() => ({ state: window.bm.run.state, best: window.bm.run.best, row: window.bm.run.hudView.bestText() }));
  const clockText = (t) => { const d = Math.floor(t * 10 + 1e-6); const sec = Math.floor(d / 10) % 60; return `${Math.floor(d / 600)}:${sec < 10 ? '0' : ''}${sec}.${d % 10}`; };
  check('the title shows the best place and time for the course', titleBest.state === 'title' && titleBest.best.place === 3 && !!crossed && titleBest.row.includes('3RD') && titleBest.row.includes(clockText(crossed.time)), JSON.stringify(titleBest));
  await page.keyboard.press('Space');
  await until(() => window.bm.run.state === 'playing', 8000);

  // --- back to the main menu, from the pause panel (each key waits for the game to take the last) ---
  const errorsOnSequelPage = errors.slice(); // the original game's page then calls the score API, which this test does not run
  await page.keyboard.press('Escape');
  await until(() => window.bm.run.state === 'paused', 5000);
  await page.keyboard.press('m');
  await wait(1000);
  let phaserReady = false; // the original game's bundle takes a moment on a cold dev server
  for (let i = 0; i < 80 && !phaserReady; i++) {
    await wait(250);
    phaserReady = await ev(() => !!(window.game && window.game.scene)).catch(() => false); // mid-navigation the page has no context yet
  }
  check('Escape returns to the main menu page', new globalThis.URL(page.url()).pathname === '/' && phaserReady, `${page.url()} phaser ${phaserReady}`);

  check('no console or page errors on the sequel page', errorsOnSequelPage.length === 0, errorsOnSequelPage.join(' | '));

  // --- a phone: upright view, touch input, tap to start, tap to jump, HIT button ---
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const tp = await phone.newPage();
  const phoneErrors = [];
  tp.on('pageerror', (e) => phoneErrors.push(e.message));
  await tp.goto(URL); await tp.waitForTimeout(2500);
  const view = await tp.evaluate(() => ({ w: window.bm.renderer.width, h: window.bm.renderer.height, touch: window.bm.input.touch }));
  check('phone: upright view (240 wide, 426 to 540 tall, following the screen) with touch input', view.w === 240 && view.h >= 426 && view.h <= 540 && view.touch, JSON.stringify(view));
  const hudRect = await tp.evaluate(() => { const r = window.bm.renderer.hudCanvas.getBoundingClientRect(); return { top: r.top, height: r.height, viewport: window.innerHeight }; });
  check('phone: the HUD spans the screen top to bottom (at least 95% of the viewport height)', hudRect.height >= 0.95 * hudRect.viewport, JSON.stringify(hudRect));
  const css = await tp.evaluate(() => ({ scale: window.bm.renderer.cssScale, ox: window.bm.renderer.offsetX, oy: window.bm.renderer.offsetY }));
  const tapAt = async (gx, gy) => tp.touchscreen.tap(css.ox + gx * css.scale, css.oy + gy * css.scale);
  // HUD points from its real size: W x H. The touch buttons sit as in src/boardmasters/engine/TouchButtons.ts:
  // RIGHT at (76, H - 32), UP at (52, H - 74), HIT at (W - 84, H - 32), JUMP at (W - 34, H - 32); the pause button at the top centre.
  const W = view.w;
  const H = view.h;
  const BUTTON = { right: [76, H - 32], up: [52, H - 74], hit: [W - 84, H - 32], jump: [W - 34, H - 32] };
  const open = [W / 2, Math.round(H * 0.7)]; // open water over the sea, clear of the buttons
  await tapAt(...open); await tp.waitForTimeout(400);
  check('phone: a tap starts the run', (await tp.evaluate(() => window.bm.run.state)) === 'playing');
  await tp.evaluate(() => { for (const v of window.bm.run.rivals) v.holdChecks(1e9); }); // no rival attacks in the way of the pad checks
  await tp.waitForTimeout(800);
  // Waits on the game, not the clock: a frame of the big phone canvas can take a while under SwiftShader.
  const tpUntil = (fn, timeout = 2000) => tp.waitForFunction(fn, null, { timeout, polling: 20 }).then(() => true, () => false);
  let phoneJumped = false;
  for (let tries = 0; tries < 3 && !phoneJumped; tries++) {
    for (let i = 0; i < 40 && (await tp.evaluate(() => window.bm.run.surfer.airborne)); i++) await tp.waitForTimeout(50);
    await tapAt(...open);
    phoneJumped = await tpUntil(() => window.bm.run.surfer.airborne, 1500);
  }
  check('phone: a tap jumps', phoneJumped);
  let phoneKo = 0;
  for (let tries = 0; tries < 4 && !phoneKo; tries++) {
    for (let i = 0; i < 40 && (await tp.evaluate(() => window.bm.run.surfer.airborne)); i++) await tp.waitForTimeout(50);
    await tp.evaluate(() => { const r = window.bm.run; const v = r.rivals[1]; v.reset(r.surfer.x + 1.0, r.surfer.z + 0.3, r.ocean); v.health = 50; });
    await tapAt(...BUTTON.hit); await tp.waitForTimeout(300);
    phoneKo = await tp.evaluate(() => window.bm.run.knockouts);
  }
  check('phone: the HIT button punches', phoneKo >= 1);
  // The knocked-out rider's flight and splash play out in the narrow upright frame (they used to leave it at once).
  const koFrames = [];
  for (let i = 0; i < 12; i++) {
    koFrames.push(await tp.evaluate(() => {
      const r = window.bm.run; const v = r.rivals[1];
      const p = v.group.position.clone(); p.y += 0.8; p.project(r.renderer.camera);
      return v.knockedOut && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1;
    }));
    await tp.waitForTimeout(80);
  }
  check('phone: a knockout stays in frame through its flight', phoneKo >= 1 && koFrames.filter(Boolean).length >= 10, JSON.stringify(koFrames));
  // Holding RIGHT on the pad carves to screen-right (world -x); a mouse press stands in for a held thumb.
  for (let i = 0; i < 40 && (await tp.evaluate(() => window.bm.run.surfer.airborne)); i++) await tp.waitForTimeout(50);
  await tp.evaluate(() => { window.bm.run.surfer.heading = 0; window.bm.run.surfer.shoveVx = 0; window.bm.run.surfer.stunnedUntil = 0; });
  await tp.mouse.move(css.ox + BUTTON.right[0] * css.scale, css.oy + BUTTON.right[1] * css.scale);
  await tp.mouse.down();
  let headingMin = 0;
  for (let i = 0; i < 8; i++) { await tp.waitForTimeout(100); headingMin = Math.min(headingMin, await tp.evaluate(() => window.bm.run.surfer.heading)); }
  await tp.mouse.up();
  check('phone: holding RIGHT carves to screen-right (heading swings to -x)', headingMin < -0.3, `min heading ${headingMin.toFixed(2)}`);
  let phoneRolled = false;
  for (let tries = 0; tries < 4 && !phoneRolled; tries++) {
    for (let i = 0; i < 40 && (await tp.evaluate(() => window.bm.run.surfer.airborne)); i++) await tp.waitForTimeout(50);
    await tapAt(...BUTTON.right); await tapAt(...BUTTON.right); await tapAt(...BUTTON.up);
    phoneRolled = await tpUntil(() => window.bm.run.surfer.rolling, 1500);
    if (!phoneRolled) await tp.waitForTimeout(500);
  }
  check('phone: RIGHT RIGHT UP on the pad barrel-rolls', phoneRolled);
  await tapAt(W / 2, 9); await tp.waitForTimeout(150);
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

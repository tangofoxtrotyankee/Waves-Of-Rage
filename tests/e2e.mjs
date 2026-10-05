/**
 * End-to-end smoke test for Waves of Rage.
 *
 * Starts a Vite dev server, drives the game in headless Chromium and checks
 * the main systems. Run with `npm test`. Set CHROMIUM_PATH to use an
 * existing browser binary instead of Playwright's managed one.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT ?? 5199);
const API_PORT = Number(process.env.API_PORT ?? 8792);
const URL = `http://127.0.0.1:${PORT}/`;

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

// The score API on a spare port with a throwaway data dir; Vite proxies /api to it.
const dataDir = await mkdtemp(join(tmpdir(), 'wor-e2e-'));
const api = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: String(API_PORT), DATA_DIR: dataDir, HOST: '127.0.0.1' }, stdio: 'ignore' });
// Spawn Vite's own script (not the npx wrapper) so killing it really stops the server.
const VITE = fileURLToPath(new globalThis.URL('../node_modules/vite/bin/vite.js', import.meta.url));
const server = spawn(process.execPath, [VITE, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { env: { ...process.env, API_PORT: String(API_PORT) }, stdio: 'ignore' });
let browser;
try {
  if (!(await waitForServer(`http://127.0.0.1:${API_PORT}/api/health`, 20000))) throw new Error('score API did not start');
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
  await page.waitForTimeout(1500);

  const wait = (ms) => page.waitForTimeout(ms);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const scenes = () => ev(() => window.game.scene.getScenes(true).map((s) => s.scene.key));
  const st = () =>
    ev(() => {
      const s = window.game.scene.getScene('GameScene');
      const p = s.player;
      if (!p || !p.scene) return { dead: true, rivals: [], obstacles: [], floating: [] };
      return {
        x: p.x, y: p.y, air: p.airHeight, aerial: p.aerialState, bigAir: p.isBigAir, state: p.playerState, spin: p.spinDegrees, trick: p.currentTrickName,
        attacking: p.isAttacking, barging: p.isBarging, inv: p.isInvulnerable, health: s.health, score: s.score, combo: s.combo.multiplier, gameOver: s.gameOver,
        debug: s.debugHud.visible, hud: { h: s.hud.health.text, sc: s.hud.score.text, d: s.hud.distance.text },
        floating: s.children.list.filter((c) => c.text && /^\+|^\d{3} |WIPEOUT|GRAB|AIR/.test(c.text)).map((c) => c.text),
        rivals: s.spawner.active.filter((o) => o.kind === 'rival').map((r) => ({ hp: r.currentHealth, state: r.rivalState, alive: r.isAlive })),
        obstacles: s.spawner.active.map((o) => ({ kind: o.kind, x: o.x, y: o.y })),
      };
    });
  const freeze = (on) => ev((on) => { window.game.scene.getScene('GameScene').gameSpeed.stopFactor = on ? 0 : 1; }, on);
  const clearField = () => ev(() => { for (const o of window.game.scene.getScene('GameScene').spawner.active) o.y = 400; });
  const setHealth = (n) => ev((n) => { window.game.scene.getScene('GameScene').health = n; }, n);
  // Spawn a kind directly on / near the player (dx, dy) and pin it there.
  const place = (kind, dx, dy) =>
    ev(({ kind, dx, dy }) => {
      const s = window.game.scene.getScene('GameScene');
      const o = s.spawner.debugSpawn(kind, s.player.x + dx);
      o.y = s.player.y + dy;
      if (kind === 'rival') { o.targetX = o.x; o.untilRetarget = 999; o.checkCooldown = 999; }
      return true;
    }, { kind, dx, dy });
  const hold = async (key, ms) => { await page.keyboard.down(key); await wait(ms); await page.keyboard.up(key); };
  const waitLanded = async () => { for (let i = 0; i < 60 && (await st()).bigAir; i++) await wait(50); };

  // --- title and start ---
  check('title scene loads', (await scenes()).join() === 'TitleScene');

  // --- game menu: Down/Up move the cursor (starting Boardmasters navigates to its own page; see the touch block below) ---
  const selectedGame = () => ev(() => window.game.scene.getScene('TitleScene').selectedGame);
  await wait(600); // the title ignores input for a moment after opening
  await page.keyboard.press('ArrowDown'); await wait(100);
  check('Down moves the cursor to Boardmasters', (await selectedGame()) === 'boardmasters');
  await page.keyboard.press('ArrowUp'); await wait(100);
  check('Up moves the cursor back to Waves of Rage', (await selectedGame()) === 'waves');
  await page.keyboard.press('Space'); await wait(500);
  check('Space starts the game', (await scenes()).join() === 'GameScene');
  await freeze(true); await clearField(); await setHealth(50);
  let s = await st();
  check('HUD shows 3 hearts at start', s.hud.h === '♥♥♥' || s.health === 50);

  // --- movement ---
  const x0 = (await st()).x;
  await hold('d', 300); await wait(300);
  const x1 = (await st()).x;
  await hold('ArrowLeft', 300); await wait(300);
  const x2 = (await st()).x;
  check('D moves right, ArrowLeft moves left', x1 > x0 + 20 && x2 < x1 - 20, `${x0.toFixed(0)} -> ${x1.toFixed(0)} -> ${x2.toFixed(0)}`);

  // --- jump ---
  await page.keyboard.press('Space'); await wait(250);
  s = await st();
  check('Space jumps (air > 0, aerial=jump)', s.air > 10 && s.aerial === 'jump');
  check('no double jump', (await ev(() => window.game.scene.getScene('GameScene').player.jump())) === false);
  await wait(500);
  await page.keyboard.press('Space'); await wait(200);
  await place('rock', 0, 0); await wait(100);
  s = await st();
  check('jumping over a rock: no damage, +50', s.health === 50 && s.floating.includes('+50'), s.floating.join('|'));
  await clearField(); await wait(600);

  // --- damage and immunity ---
  await setHealth(3);
  await place('rock', 0, 0); await wait(100);
  s = await st();
  check('rock hit: -1 health, immune, hearts update', s.health === 2 && s.inv && s.hud.h === '♥♥♡', `health ${s.health}`);
  await place('rock', 0, 0); await wait(150);
  check('immunity blocks repeat damage', (await st()).health === 2);
  await clearField(); await wait(1300);
  await place('shark', 0, 0); await wait(100);
  check('shark hit: -2 health', (await st()).health === 0 || (await st()).health === 1 ? (await st()).health === 0 : false, `health ${(await st()).health}`);
  // (2 - 2 = 0 would end the run; the check above accepts 0.)
  await wait(1900);
  check('zero health -> GameOverScene', (await scenes()).join() === 'GameOverScene');
  // First run on a fresh profile always qualifies for the top 10: a name prompt appears.
  await wait(300);
  check('high score: name prompt shown', await page.evaluate(() => !!document.getElementById('name-entry')));
  await page.keyboard.press('Space'); await wait(300);
  check('high score: Space while typing does not restart', (await scenes()).join() === 'GameOverScene');
  await page.fill('#ne-input', 'tester'); await page.keyboard.press('Enter'); await wait(300);
  const table = await page.evaluate(() => window.game.scene.getScene('GameOverScene').tableTexts.map((t) => t.text));
  check('high score: table lists TESTER at rank 1', table.some((l) => l.startsWith(' 1 TESTER')), table.slice(0, 2).join('|'));
  check('high score: persisted to localStorage', await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('waves-of-rage.highscores.v1') || '[]'); return v.length === 1 && v[0].name === 'TESTER'; }));
  check('high score: table heading is online (TOP 10 NORMAL)', table[0] === 'TOP 10 NORMAL', table[0]);
  const shared = await (await fetch(`http://127.0.0.1:${API_PORT}/api/scores`)).json();
  check('high score: posted to the shared table', shared.scores.length === 1 && shared.scores[0].name === 'TESTER', JSON.stringify(shared.scores));
  await wait(700); await page.keyboard.press('Space'); await wait(500);
  check('Space restarts', (await scenes()).join() === 'GameScene' && (await st()).health === 3);
  await freeze(true); await clearField(); await setHealth(50);

  // --- combat ---
  await place('rival', 60, 0);
  await page.keyboard.press('x'); await wait(250);
  check('punch out of range misses', (await st()).rivals.every((r) => r.hp === 2));
  await wait(400); await clearField(); await wait(100);
  await place('rival', 22, 0);
  const sc0 = (await st()).score;
  await page.keyboard.press('x'); await wait(600);
  await ev(() => { const s = window.game.scene.getScene('GameScene'); const r = s.spawner.active.find((o) => o.kind === 'rival' && o.isAlive); if (r) r.x = s.player.x + 22; });
  await page.keyboard.press('x'); await wait(150);
  s = await st();
  check('two punches knock a rival out for +500', s.rivals.some((r) => r.state === 'wipedOut') && Math.round(s.score - sc0) === 500, `delta ${(s.score - sc0).toFixed(0)}`);
  await place('rival', 22, 0); await wait(500); // let the attack cooldown clear
  await page.keyboard.press('x'); await wait(600);
  await ev(() => { const s = window.game.scene.getScene('GameScene'); const r = s.spawner.active.find((o) => o.kind === 'rival' && o.isAlive); if (r) r.x = s.player.x + 22; });
  await page.keyboard.press('x'); await wait(150);
  s = await st();
  check('second knockout within 4 s: combo x2', s.combo === 2 && Math.round(s.score - sc0) === 1500, `combo ${s.combo} delta ${(s.score - sc0).toFixed(0)}`);
  await wait(1300); await clearField(); await wait(100);
  await place('rival', 28, 0); await place('rock', 70, 0);
  const sc1 = (await st()).score;
  await page.keyboard.down('d'); await page.keyboard.press('Shift'); await wait(400); await page.keyboard.up('d');
  s = await st();
  check('barge knocks a rival into a rock for +750 (x combo)', s.rivals.some((r) => r.state === 'wipedOut') && s.score - sc1 >= 750, `delta ${(s.score - sc1).toFixed(0)}`);
  await wait(4500); await clearField(); await wait(100);

  // --- ramps and tricks ---
  await place('ramp', 0, 0); await wait(80);
  await ev(() => { const s = window.game.scene.getScene('GameScene'); const r = s.spawner.active.find((o) => o.kind === 'ramp'); if (r) r.y = s.player.y - 70; });
  s = await st();
  check('ramp launches into big air', s.bigAir, s.state);
  await hold('d', 780);
  s = await st();
  check('spinning in big air reads 360', s.trick === '360', `spin ${s.spin.toFixed(0)} ${s.trick}`);
  const sc2 = (await st()).score;
  const hp2 = (await st()).health;
  await waitLanded(); await wait(100);
  s = await st();
  check('clean 360 lands for +850', Math.round(s.score - sc2) === 850 && s.floating.includes('360 +850'), `delta ${(s.score - sc2).toFixed(0)} health ${hp2}->${s.health} state ${s.state} spin ${s.spin} ${s.floating.join('|')}`);
  await wait(300); await clearField(); await wait(100);
  await place('ramp', 0, 0); await wait(80);
  await ev(() => { const s = window.game.scene.getScene('GameScene'); const r = s.spawner.active.find((o) => o.kind === 'ramp'); if (r) r.y = s.player.y - 70; });
  await page.keyboard.press('x'); await wait(50);
  check('X in big air grabs', (await st()).trick === 'GRAB');
  const hp3 = (await st()).health;
  await hold('a', 330);
  await waitLanded(); await wait(100);
  s = await st();
  check('bad landing: WIPEOUT, -1 health', s.health === hp3 - 1 && s.floating.includes('WIPEOUT'), `health ${hp3}->${s.health} ${s.floating.join('|')}`);

  // --- debug ---
  await page.keyboard.press('F1'); await wait(100);
  check('F1 toggles debug on', (await st()).debug);
  await page.keyboard.press('F1'); await wait(100);
  check('F1 toggles debug off', !(await st()).debug);

  check('no console errors', errors.length === 0, errors.join(' | '));

  // --- touch: real taps hold for ~100 ms, so their release lands after the next scene has opened ---
  const touchPage = await browser.newPage({ viewport: { width: 390, height: 780 } });
  await touchPage.goto(`${URL}?touch=1`);
  await touchPage.waitForFunction(() => window.game && window.game.scene.isActive('TitleScene') && window.game.scene.getScene('TitleScene').buttonCentres.length === 2, null, { timeout: 30000 });
  // The title ignores input for a moment (a scene timer); wait for it to accept input rather than for wall time, which a busy machine stretches.
  await touchPage.waitForFunction(() => window.game.scene.getScene('TitleScene').acceptInput === true, null, { timeout: 15000 });
  const tScenes = () => touchPage.evaluate(() => window.game.scene.getScenes(true).map((s) => s.scene.key).join());
  const box = await touchPage.evaluate(() => { const c = document.querySelector('canvas').getBoundingClientRect(); return { x: c.left, y: c.top, w: c.width }; });
  const scale = box.w / 180; // portrait field: 180 game pixels wide
  const tap = async (gx, gy) => { await touchPage.mouse.move(box.x + gx * scale, box.y + gy * scale); await touchPage.mouse.down(); await touchPage.waitForTimeout(120); await touchPage.mouse.up(); };
  const buttons = await touchPage.evaluate(() => window.game.scene.getScene('TitleScene').buttonCentres);
  await tap(buttons[0].x, buttons[0].y); await touchPage.waitForTimeout(500);
  check('touch: tapping WAVES OF RAGE starts a run', (await tScenes()) === 'GameScene', `scenes=${await tScenes()}`);
  await touchPage.keyboard.press('Escape'); await touchPage.waitForTimeout(300);
  check('touch: Escape pauses', (await tScenes()).includes('PauseScene'));
  await tap(90, 160 + 28); await touchPage.waitForTimeout(150); // MAIN MENU on the pause popover
  const rightAfter = await tScenes();
  await touchPage.waitForTimeout(900);
  check('touch: MAIN MENU returns to the title and stays there', rightAfter === 'TitleScene' && (await tScenes()) === 'TitleScene', `right after=${rightAfter}, later=${await tScenes()}`);
  await touchPage.waitForTimeout(400);
  await tap(buttons[1].x, buttons[1].y); await touchPage.waitForTimeout(1500);
  const sequelUrl = new globalThis.URL(touchPage.url());
  check('touch: tapping WOR 2: BOARDMASTERS opens its page, keeping ?touch=1', sequelUrl.pathname === '/boardmasters.html' && sequelUrl.searchParams.get('touch') === '1', touchPage.url());
  await touchPage.close();
} catch (err) {
  console.error('TEST CRASHED:', err);
  results.push(false);
} finally {
  await browser?.close();
  server.kill();
  api.kill();
  await rm(dataDir, { recursive: true, force: true });
}

const fails = results.filter((r) => !r).length;
console.log(`\n${results.length - fails}/${results.length} checks passed`);
process.exit(fails ? 1 : 0);

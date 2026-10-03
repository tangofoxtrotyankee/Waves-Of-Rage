import { isTouchDevice } from '../game/platform';
import { Hud2D } from './engine/Hud2D';
import { Input } from './engine/Input';
import { Loop } from './engine/Loop';
import { Renderer } from './engine/Renderer';
import { loadJSON } from '../systems/Storage';
import { CHARACTER_STORAGE_KEY, characterById } from './game/characters';
import { CHARACTER_PARAM, LOOK } from './game/constants';
import { Run } from './game/Run';

/**
 * Waves of Rage 2: Boardmasters entry point (boardmasters.html).
 *
 * Builds the renderer, HUD, input and the run, then starts the fixed-step
 * loop. Without WebGL 2 the page explains and links back to the main menu.
 */
const parent = document.getElementById('game');
const message = document.getElementById('message');
if (!parent || !message) throw new Error('boardmasters.html is missing #game or #message');

const fail = (text: string) => {
  message.innerHTML = `${text}<br /><br /><a href="./">BACK TO THE MAIN MENU</a>`;
  message.classList.add('show');
};

if (!Renderer.supported()) {
  fail('WAVES OF RAGE 2 NEEDS WEBGL 2, WHICH THIS BROWSER DOES NOT PROVIDE.');
} else {
  try {
    const renderer = new Renderer(parent);
    const hud = new Hud2D(renderer.hudCanvas);
    const input = new Input(parent, isTouchDevice(), (x, y) => renderer.toInternal(x, y));
    const run = new Run(renderer, hud, input, characterById(CHARACTER_PARAM ?? loadJSON<string>(CHARACTER_STORAGE_KEY, 'sam')));
    const loop = new Loop((dt) => run.update(dt), () => run.render());
    loop.start();

    // In development, expose the game for console poking and automated tests (tests/boardmasters-e2e.mjs).
    if (import.meta.env.DEV) {
      (window as Window & { bm?: unknown }).bm = { run, renderer, hud, input, loop, look: LOOK };
    }
  } catch (err) {
    console.error(err);
    fail('WAVES OF RAGE 2 COULD NOT START ITS 3D RENDERER ON THIS DEVICE.');
  }
}

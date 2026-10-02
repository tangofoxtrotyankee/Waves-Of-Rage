import { HIGH_SCORES, HighScores } from '../systems/HighScores';

/**
 * Asks for the player's name with a small DOM form over the canvas.
 *
 * A real text input is used on purpose: it gives phones their keyboard and
 * desktops normal typing, which a canvas-drawn entry screen would not.
 * Resolves with a cleaned name (never empty), or null if the player skips
 * (SKIP button or Escape): the run is then not recorded.
 */
export function promptForName(parentId = 'game'): Promise<string | null> {
  return new Promise((resolve) => {
    const parent = document.getElementById(parentId) ?? document.body;

    const form = document.createElement('form');
    form.id = 'name-entry';
    form.innerHTML = `
      <div class="ne-title">NEW HIGH SCORE!</div>
      <label class="ne-label" for="ne-input">ENTER YOUR NAME</label>
      <input id="ne-input" name="name" maxlength="${HIGH_SCORES.maxNameLength}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${HIGH_SCORES.defaultName}" />
      <div class="ne-buttons">
        <button type="submit">OK</button>
        <button type="button" class="ne-skip" id="ne-skip">SKIP</button>
      </div>
    `;
    // Keep taps and keys inside the form from reaching the game.
    for (const type of ['pointerdown', 'pointerup', 'keydown', 'keyup'] as const) {
      form.addEventListener(type, (e) => e.stopPropagation());
    }

    const input = form.querySelector('input') as HTMLInputElement;
    input.value = HighScores.lastName();
    input.addEventListener('input', () => {
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '');
      input.setSelectionRange(pos, pos);
    });

    const finish = (value: string | null) => {
      form.remove();
      resolve(value);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      finish(HighScores.cleanName(input.value));
    });
    (form.querySelector('#ne-skip') as HTMLButtonElement).addEventListener('click', () => finish(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') finish(null);
    });

    parent.appendChild(form);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}

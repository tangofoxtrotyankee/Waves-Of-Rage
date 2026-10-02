import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the production build works from any sub-folder
  // (e.g. GitHub Pages or itch.io) as well as from the site root.
  base: './',

  build: {
    // Phaser alone is well over the default 500 kB warning threshold.
    // Raise the limit so builds stay quiet; the size is expected.
    chunkSizeWarningLimit: 1600,
  },
});

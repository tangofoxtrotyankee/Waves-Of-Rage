# Art direction

`waves-of-rage-concept.webp` is the approved concept artwork and the master
visual reference for all future assets. Do not extract game sprites from it;
gameplay graphics are produced separately in the same style.

Visual direction:

- vibrant late-80s / early-90s arcade aesthetic
- Mega Drive-era pixel-art feel
- strong sunset oranges, pinks and purples
- deep blues and cyan water
- heavy contrast
- chunky outlined forms
- exaggerated arcade action
- tropical beach / surf culture
- energetic rather than realistic

`public/assets/title/concept-320x180.png` is a 16:9 crop of this image
downsampled to the game's internal resolution. It is used as the temporary
title-screen background until a proper title screen is produced.

`character-sheet-surfer.webp` is the protagonist sheet (front/side/back,
board, palette, action poses, expressions, example in-game sprites) and
`gameplay-mockup.webp` is the target look for the play field (sunset sky,
sun on the horizon, islands, banded water with foam crests, spray wake).

The in-game pixel art in `public/assets/sprites/` is generated from
`tools/pixelart/` and uses the palette from the character sheet:

| Role     | Colour    |
| -------- | --------- |
| Skin     | `#f4a261` / shade `#d98c4a` |
| Hair     | `#7a3f1d` / light `#a8602c` |
| Shirt    | `#2a9d8f` / light `#4fc1a6` |
| Shorts   | `#1e2a44` / light `#3a4a6b` |
| Board    | `#ffc43d`, `#f4862f`, stripe `#e63946` |
| Outline  | `#1a1a2e` |
| Water    | `#1e4fa3` deep, `#2a66c4`, `#5fb3f0` light, `#f8fbff` foam |
| Sky      | `#f26b4e` -> `#f7a04b` -> `#ffcf6b`, sun `#ffe9a0` |

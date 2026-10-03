# Waves of Rage 2: Boardmasters, art direction

Reference art for the sequel. As with the original game's concept art, do
not extract game assets from these images; the in-game look is produced
separately (low-poly 3D, see `docs/boardmasters/ARCHITECTURE.md`).

| File                   | What it is |
| ---------------------- | ---------- |
| `title-concept.webp`   | Approved title screen: logo, tagline, menu (PLAY / CHARACTERS / COURSES / LEADERBOARD / OPTIONS), Sunset Bay with the pier, the Boardmasters stand and the hero surfer. |
| `gameplay-mockup.webp` | Target in-game presentation on a phone: chase camera at waist height, HUD (HEALTH hearts, POS 3/8, DIST %, SCORE, RAGE meter), course map with the finish flag, boost chevrons on the water, floating trick text (`+250 CARVE`), touch buttons for CARVE, ATTACK and BARGE. |
| `character-lineup.webp` | Character line-up with SPEED / TURN / POWER / RAGE bars: SAM the all-rounder, KAI the speed demon, CHUNGUS the heavy hitter, SKYE the trickster, DIESEL the lifeguard, BISH the poser, SHADOW the mystery; the player animation set (idle, carve left, carve right, accelerate, jump, air trick, hit, barge, wipeout); rival surfers (local, poser, big guy, girl rival); unlockables (business surfer, Old Bob, shark suit, alien); boards (classic, flame, pink, shark, flamingo, skull, reggae, neon); the six environments. |
| `hazards-sheet.webp`   | Hazard and enemy sheet: wave obstacle (dodge, jump or ride over), rival surfers and jet-ski riders, sharks (fin crossing, breach attack, underwater strike), the RESCUE lifeboat, skull buoys, rocks, pier pilings, route gates, wave ramps, pickups (coins, health, speed). |

Visual direction, in addition to the original game's:

- the world is polygonal: low-poly surfers, boards, sharks and boats with
  visible facets, deliberately low-resolution textures
- the original's sunset palette (oranges, pinks, purples; cyan and deep
  blue water; white foam) carries over unchanged
- the UI stays 2D pixel art in the original's style: the logo, the pixel
  font, hearts, the yellow-on-dark menu rows
- exaggerated proportions and loud board shorts; nothing is realistic

`public/assets/boardmasters/` holds crops of the title concept downsampled to
the game's internal resolution for the current title card
(`src/scenes/BoardmastersScene.ts`): the logo (220x110), the hero surfer
(100x180, the right-hand column in landscape) and the whole poster
(180x320, the portrait background). Regenerate them from `title-concept.webp`
with ImageMagick if the crop needs to change; the crops are listed in the
scene file's history.

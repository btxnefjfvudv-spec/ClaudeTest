# Asset Documentation

All visual and audio assets are **generated in code** — there are no image or sound files except the home-screen icons (which are rendered from the same code by `tools/makeIcons.cjs`).

## Pipeline

| Step | Where | Notes |
|---|---|---|
| Palette & colour ramps | `src/core/palette.ts`, `src/art/color.ts` | `ramp(c)` gives a 5-step hue-shifted ramp (shadows → blue/purple, lights → warm). |
| Pixel painting | `src/art/Painter.ts` | `makeTexture(key, w, h, draw)` / `makeSheet(key, fw, fh, n, draw)` paint into an RGBA buffer and upload a Phaser texture once (cached by key). |
| Characters | `src/art/CharacterArt.ts`, `src/data/characters.ts` | 32×32 frames, 31 poses, 13 animations per character, selective coloured outline. Looks are data (`CharacterLook`) so the real 5/8 friends can be dropped in. |
| Classroom | `src/art/classroom.ts`, `src/scenes/ClassroomView.ts` | Placeholder room: outside view, wall, board, windows, floor, desks, fans, light shafts, props. Will be redrawn from the user's photos. |
| Shared FX/UI | `src/art/common.ts`, `src/art/stage.ts` | Particles (dot, spark, star, confetti, dust, puff), coin spin, 9-slice panels and buttons in 10 colours, icons, podiums, crown, ceremony stage. |
| Per-game art | `src/minigames/games/*.ts` | Each game paints its own environment and props; texture keys are prefixed with the game id. |
| Audio | `src/systems/audio/AudioManager.ts` | ~30 synthesized SFX presets + chiptune sequencer with 6 original tracks (menu, game, game2, tension, victory, results). |

## Rules (keep the style consistent across 50 games)

1. Display scale is always **2 world units per art pixel** (`S`). World is 480 tall.
2. Light from the top-left; use `ramp()` / `ball()` / `box()` for shading, never flat single-colour blobs for main objects.
3. Sprites get `outline()` (colour-aware outline, not pure black).
4. Player-owned things use `PLAYER_COLORS` (red / blue / green / yellow) and a P1–P4 number marker.
5. Backgrounds: ≥ 2 layers + ambient motion. No flat empty screens.
6. No emoji or CSS shapes as art. `Graphics` only for UI bars / overlays.
7. Text uses `txt()` (rendered at native resolution, Thai-capable system font with outline).

## Replacing placeholders with the real 5/8 class

- Characters: edit looks/names on the iPad (Characters screen) or in `src/data/characters.ts`. When photos arrive each friend gets reviewed proportions, hair and distinguishing features.
- Classroom: `src/art/classroom.ts` is laid out by `classroomLayout()` — board, windows, door and seats will be re-placed to match the real room and seating chart.

# Architecture

## Stack

Phaser 3.90 (WebGL) · TypeScript strict · Vite · Web Audio (synth) · Service Worker (offline) · GitHub Pages.

## Render model

- World is always **480 units tall**; width follows the screen aspect (clamped 4:3 – 1.6).
- The canvas is sized to **device pixels** (DPR ≤ 2, height ≤ 1600 px) and every camera is zoomed by `canvas / world`, so pixel art stays blocky while text renders at native resolution (sharp Thai).
- Art is painted at half resolution and displayed at **×2** (`S`).
- `BaseScene.fitCamera` letterboxes if the screen changes mid-scene; scenes keep their world size for their whole life.

## Code layout

```
src/
  main.ts                game config, Safari gesture blocking, resize
  config.ts              render model (View, computeView)
  core/                  shared types (MinigameDefinition, PlayerResult…), palette, EventBus
  art/                   Painter, colour ramps, characters, classroom, stage, shared textures
  data/                  characters (placeholders + on-device edits)
  systems/
    input/               MultiTouchManager — finger → player ownership by zone
    audio/               AudioManager — SFX presets + chiptune sequencer, Safari unlock
    party/               Party state, scoring 10/7/5/3, tie-aware ranking, game picking
    players/             Avatar (character sprite + shadow + marker)
    vfx/                 particles, shake, flash, squash & stretch, pop text
    settings.ts          per-device persistence (localStorage, failure-safe)
  ui/                    txt(), Button (9-slice), TouchButton, DragStick
  scenes/                Boot, Menu (living classroom), PlayerSelect, Mode, RoundIntro,
                         Results, Final, Library, Settings, Credits, Characters, TouchTest
  minigames/
    BaseMinigame.ts      lifecycle for every game
    catalog.ts           design data for all 50 games
    registry.ts          auto-discovers games/*.ts (import.meta.glob)
    kit/                 ArenaKit (top-down), SplitKit (per-player cameras), PanelKit (per-player panels), water
    games/               one file per minigame
tools/                   smoke test, art preview, icon + docs generators
```

## Lifecycle

BOOT → MAIN MENU → PLAYER SELECT → MODE SELECT → ROUND INTRO (roulette) → **MINIGAME** (INTRO card for both table sides + ready taps → COUNTDOWN → GAMEPLAY → FINISH banner) → RESULTS → next ROUND INTRO … → FINAL (winner ceremony) → MENU.

`BaseMinigame` implements the standard contract from the brief (`MinigameDefinition`): `setup` (create), `onStart` (start), `tick`/`ambient` (update), pause/resume (built-in, also auto on app background), restart (`scene.restart`), cleanup (scene shutdown), `results()` (getResults).

## Multi-touch

- Phaser touch input with 10 pointers; CSS `touch-action: none`, prevented `touchmove`/gesture/dblclick/contextmenu.
- A finger belongs to the player whose zone it first touched until it lifts/cancels → no input stealing when sliding across zones.
- Failsafes: touchcancel, release outside canvas, app blur/hidden, and a per-frame check drop stuck fingers.
- Zones carry the seat direction (`facing`), so UI and swipe directions are rotated to each player's view.

## Testing

- `tools/smoke.cjs`: every playable game, headless iPad Pro 11 emulation, random 4-finger input, time-accelerated (`?speed=4`), must reach Results without errors.
- `?auto`, `?fast`, `?game=<id>`, `?speed=n` URL flags for automation.
- Real-iPad checks are listed in `docs/QA_REPORT.md`.

# Minigame Dev Guide

How to build one of the 50 minigames so it matches the rest of the game. Read this whole file before writing a game.

## 1. Where things go

- One file per game: `src/minigames/games/<PascalName>.ts`, **default-exporting** a class that extends `BaseMinigame`.
- Discovery is automatic (`import.meta.glob` in `src/minigames/registry.ts`). Never edit the registry.
- The design for each game (id, name, Thai how-to, controls, duration, layout, team) is in `src/minigames/catalog.ts`. Use `super(CATALOG['<id>'])`. You may improve the Thai `blurb`/`howTo`/`controls` text of *your* games in the catalog if your design changes, but keep the id, num, name, category.
- Texture keys are global: **prefix every texture key with your game id** (e.g. `lava-wall`, `pizza-cheese`).
- Reference implementations — read them first:
  - `games/LastOneStanding.ts` — top-down arena (ArenaKit), tile platform, CPU AI, eliminations.
  - `games/BumperBall.ts` — team game, ball physics, team results.
  - `games/ClassroomDash.ts` — per-player scrolling views (SplitKit), touch buttons, parallax.

## 2. Seating (most important rule)

Four players sit **around** the iPad (landscape):

| Player | Zone | Sits at | Facing |
|---|---|---|---|
| P1 red | top-left quadrant | top edge (across the table) | 180° |
| P2 blue | top-right | top edge | 180° |
| P3 green | bottom-left | bottom edge | 0° |
| P4 yellow | bottom-right | bottom edge | 0° |

- Any text or UI meant for one player must be rotated to `this.angleFor(p)`.
- Shared text must be shown twice: once at 0° in the bottom half and once at 180° in the top half (see `BumperBall` score, `BaseMinigame.finish`).
- Shared play-fields should be **top-down** (orientation neutral). Side-view games must use per-player views: `SplitKit` (scrolling, own camera per player, rotated) or `PanelKit` (static rotated container per player).
- Controls live in the player's own zone. A finger belongs to the zone it first touched (`MultiTouchManager`), so players can never steal each other's input.

## 3. BaseMinigame API

```ts
export default class MyGame extends BaseMinigame {
  constructor() { super(CATALOG['my-game']); }
  setup(): void {}          // build world + players (called once per start/restart)
  onStart(): void {}        // GO! appeared
  ambient(dt: number) {}    // every frame in every state (animations, camera follow)
  tick(dt: number) {}       // every frame while state === 'play' (gameplay)
  results(): PlayerResult[] // optional; default ranks by this.score / elimination order
}
```

Available on `this`: `vw`/`vh` (world size, vh = 480, vw ≈ 640–768), `players` (active seats),
`isCpu(p)`, `state`, `elapsed`, `timeLeft`, `score[]`, `addScore(p, n)` (with HUD pop), `hudText[p]` (override HUD text),
`eliminate(p)` (auto-finishes when one is left), `alive(p)`, `finish()`, `hitStop(ms)` (freeze-frame on big impacts), `touch` (MultiTouchManager), `zoneOf(p)`, `angleFor(p)`.

- `meta.duration > 0` → the timer ends the game. `duration: 0` → you must call `this.finish()` (always add a hard cap, e.g. 90 s).
- Results: `rankBy(players, valueFn, higherIsBetter)` from `systems/party/Party`. Ties share a rank. Team games: winners rank 1, losers rank 3, draw = all rank 2; set `team`.
- `dt` is in seconds and capped at 0.05. Tests may run several `tick`s per frame (`Party.speed`), so all gameplay timing must come from `dt`/`elapsed`, **not** `this.time.delayedCall` (use those only for cosmetic effects).
- Never keep state across restarts in field initialisers only — reset everything in `setup()`.

## 4. Kits

- `kit/ArenaKit` — top-down movement for all players: drag stick + dash button (+ optional action button), collisions with knockback, CPU steering (`body.botTarget`, `body.botDash`), avatar animation. Options: `speed, accel, grip (ice ≈ 0.08), radius, dash, dashSpeed, dashCooldown, action, bounds, spawn`. Call `kit.update(dt, this.state === 'play')` from `ambient`.
- `kit/SplitKit` — four cameras, one per quadrant, each watching its own copy of the level at `split.offsetY(p)`. Top players' cameras are rotated 180°. `split.look(p, x, y)` to follow.
- `kit/PanelKit` — rotated container per player (`panel.c`, local coords `x ∈ [-w/2,w/2]`, `+y` toward the player). `panels.onDown(cb)` gives taps in local coords; `panels.localTouches(p)` for drags.
- `kit/water` — animated water + splash.
- `ui/Controls` — `TouchButton(scene, touch, p, u, v, icon, radius)` placed in the player's own frame (u,v ∈ 0..1 of their zone); `onPress/onRelease/isDown`. `DragStick` for analog movement. Icons: `jump left right punch shield dash star bolt pause throw turn fire`.
- `systems/players/Avatar` — a player's character (sprite + shadow + floating number marker). `play('idle'|'run'|'walk'|'jump'|'fall'|'land'|'hit'|'stun'|'win'|'lose'|'attack'|'cheer'|'sit')`, `face(dir)`, `setPos(x, y, z)`. Set `avatar.markerAngle = this.angleFor(p)` in shared views.

## 5. Art rules (non-negotiable)

- **All art is pixel art painted with `art/Painter`** (`makeTexture`, `makeSheet`). Painter has `px rect box ball ellipse circle ring line stroke tri dither gradient stamp outline mirrorX`. Use `ramp(base)` / `shift(c, amount)` from `art/color` for hue-shifted shading. Call `p.outline()` on sprites.
- Display scale: **every art texture is shown at `S` (= 2)** world units per art pixel. Paint backgrounds at `vw / S × vh / S`.
- No emoji or CSS/`Graphics` shapes as final art. `Graphics`/`Rectangle` are fine only for UI bars, debug, or flat overlays.
- Light from the top-left. Each game has its own palette/mood but uses the shared player colours (`core/palette.ts` `PLAYER_COLORS`) for player-owned things.
- Scenes must feel alive: at least 2 layers of background plus ambient motion (clouds, water, swaying, blinking lights, crowd, particles).
- Text: `txt()` from `ui/text` (crisp, Thai + English). Keep Thai text short.

## 6. Game feel (required)

Every action has feedback: `Vfx.squash`, `Vfx.dust`, `Vfx.hit`, `Vfx.sparkle`, `Vfx.explosion`, `Vfx.confetti`, `Vfx.popText`, `Vfx.shake` (use sparingly), `Vfx.hitFlash`, `burst()`; sound via `Audio.sfx(name, pitch)` with names:
`click select back jump land hit bigHit coin power explode whoosh throw splash pop tick count go finish wrong right lose dash stun shoot bounce freeze drum`.
Pass `pitch = 1 + p * 0.1` so players sound different. Music: set `music` in the catalog entry (`game`, `game2`, `tension`) — `game` is default.

## 7. CPU players

Every game must play itself for CPU seats (`this.isCpu(p)`): competitive but beatable, with some randomness so CPUs don't tie. Tests run with CPUs in 3 seats; the game must end with sensible, varied results.

## 8. Fairness

Same layout / same random seed for every player's copy; symmetric spawns; no seat advantage. Gameplay should be understandable in 5–10 s and last 15–90 s.

## 9. Testing

```bash
npm install                      # first time in a fresh checkout
npx vite --port <PORT> --strictPort &   # dev server
npx tsc --noEmit                 # must be clean
node tools/smoke.cjs http://localhost:<PORT>/ my-game,other-game   # must PASS
```

Screenshot a game: open `http://localhost:<PORT>/?auto&fast&game=<id>` in Playwright (iPad Pro 11 landscape) — see `tools/smoke.cjs`. Look at your screenshots; fix anything ugly, overlapping, unreadable or off-screen.

## 10. Done checklist (per game)

Opens · starts · works with 1–4 humans (others CPU) · multi-touch per player independent · score + win/lose correct · animations · VFX · sound · restart works (pause → เริ่มใหม่) · no console errors · smoke test PASS · screenshot reviewed.

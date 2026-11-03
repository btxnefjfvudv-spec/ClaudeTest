import Phaser from 'phaser';
import { S } from '../art/common';
import { PLAYER_COLORS, toCss } from '../core/palette';
import type { PlayerIndex, PlayerResult } from '../core/types';
import { BaseScene } from '../scenes/BaseScene';
import { Audio } from '../systems/audio/AudioManager';
import { MultiTouchManager, type TouchZone } from '../systems/input/MultiTouchManager';
import { Party, rankBy } from '../systems/party/Party';
import { Vfx } from '../systems/vfx/Vfx';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { CATEGORY_LABEL, type MinigameMeta } from './types';

export type GameState = 'intro' | 'countdown' | 'play' | 'end';

/**
 * Shared lifecycle for all 50 minigames:
 * INTRO (rules + everyone taps ready) → COUNTDOWN → PLAY → END → Results scene.
 * Subclasses implement setup(), tick() and optionally results()/onStart().
 */
export abstract class BaseMinigame extends BaseScene {
  readonly meta: MinigameMeta;
  state: GameState = 'intro';
  players: PlayerIndex[] = [];
  score = [0, 0, 0, 0];
  /** Players knocked out (survival games) in order of elimination. */
  eliminated: PlayerIndex[] = [];
  touch!: MultiTouchManager;
  timeLeft = 0;
  elapsed = 0;
  paused = false;
  /** Optional per-player HUD override text (instead of the score). */
  hudText: (string | undefined)[] = [undefined, undefined, undefined, undefined];
  private hudScore: Phaser.GameObjects.Text[] = [];
  private hudPanels: Phaser.GameObjects.Container[] = [];
  private timerTexts: Phaser.GameObjects.Text[] = [];
  private overlay?: Phaser.GameObjects.Container;
  private pauseOverlay?: Phaser.GameObjects.Container;
  private ready = [false, false, false, false];
  private finished = false;
  private lastTick = -1;

  constructor(meta: MinigameMeta) {
    super(meta.id);
    this.meta = meta;
  }

  /** Build the world. Players/characters exist after this. */
  abstract setup(): void;
  /** Per-frame gameplay, only while state === 'play'. dt in seconds. */
  abstract tick(dt: number): void;
  /** Called every frame in every state (ambient animation). */
  ambient(_dt: number): void {}
  /** Called when GO! appears. */
  onStart(): void {}
  /** Default ranking: higher score wins; eliminated players rank by survival order. */
  results(): PlayerResult[] {
    if (this.eliminated.length) {
      const order = (p: PlayerIndex) => {
        const i = this.eliminated.indexOf(p);
        return i === -1 ? 100 + this.score[p] : i;
      };
      return rankBy(this.players, order).map((r) => ({ ...r, score: this.score[r.player] }));
    }
    return rankBy(this.players, (p) => this.score[p]);
  }

  isCpu(p: PlayerIndex): boolean {
    return Party.isCpu(p);
  }

  zoneOf(p: PlayerIndex): TouchZone {
    return this.touch.zoneOf(p)!;
  }

  /** Text angle so a player reads it upright from their seat. */
  angleFor(p: PlayerIndex): number {
    return this.zoneOf(p).facing;
  }

  build(): void {
    this.state = 'intro';
    this.finished = false;
    this.paused = false;
    this.score = [0, 0, 0, 0];
    this.eliminated = [];
    this.elapsed = 0;
    this.ready = [false, false, false, false];
    this.hudText = [undefined, undefined, undefined, undefined];
    this.players = Party.activePlayers;
    this.timeLeft = this.meta.duration;
    this.touch = new MultiTouchManager(this, this.meta.layout ?? 'quadrants');
    this.setup();
    this.buildHud();
    this.showIntro();
    Audio.playMusic(this.meta.music ?? 'game');
    this.input.keyboard?.on('keydown-P', () => this.togglePause());
  }

  // ───────────────────────────── HUD ─────────────────────────────

  private buildHud(): void {
    this.hudScore = [];
    this.hudPanels = [];
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const zone = this.zoneOf(p);
      const r = this.touch.zoneRect(zone);
      const c = PLAYER_COLORS[p];
      const panel = this.add.container(0, 0).setDepth(950);
      const bg = this.add.nineslice(0, 0, 'ui-panel-dark', undefined, 40, 15, 6, 6, 6, 6).setScale(S).setAlpha(0.88);
      const chip = this.add.rectangle(-30, 0, 16, 16, c.main).setStrokeStyle(2, c.dark);
      const num = txt(this, -30, 0, `${p + 1}`, { size: 12, color: '#ffffff', strokeWidth: 0 });
      const score = txt(this, 8, 0, '0', { size: 15, color: toCss(c.light) });
      panel.add([bg, chip, num, score]);
      // Outer corner of the zone, nearest the player, rotated to face them.
      const outerX = zone.x < 0.5 ? r.x + 46 : r.right - 46;
      const outerY = zone.facing === 180 ? r.y + 20 : r.bottom - 20;
      panel.setPosition(outerX, outerY).setAngle(zone.facing);
      if (!this.players.includes(p)) panel.setAlpha(0.25);
      if (this.isCpu(p) && this.players.includes(p)) {
        const cpu = txt(this, 8, -16, 'CPU', { size: 9, color: '#c7c9d6', strokeWidth: 2 });
        panel.add(cpu);
      }
      this.hudScore.push(score);
      this.hudPanels.push(panel);
    }
    this.timerTexts = [];
    if (this.meta.duration > 0) {
      for (const deg of [0, 180]) {
        const t = txt(this, this.vw / 2, deg === 0 ? this.vh - 14 : 14, '', { size: 16, color: '#fff8e7' }).setDepth(950).setAngle(deg);
        this.timerTexts.push(t);
      }
    }
    // Pause button in the middle edge between the two near-side players.
    const pb = this.add.image(this.vw / 2 + 60, this.vh - 14, 'icon-pause').setScale(S * 1.2).setDepth(950).setAlpha(0.6).setInteractive({ useHandCursor: true });
    pb.on(Phaser.Input.Events.POINTER_UP, () => this.togglePause());
  }

  /** Bump a player's score with pop feedback on their HUD. */
  addScore(p: PlayerIndex, n: number): void {
    this.score[p] += n;
    const s = this.hudScore[p];
    if (s) this.tweens.add({ targets: s, scale: { from: 1.5, to: 1 }, duration: 200, ease: 'Back.easeOut' });
  }

  private updateHud(): void {
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const s = this.hudScore[p];
      if (!s) continue;
      const v = this.hudText[p] ?? `${this.score[p]}`;
      if (s.text !== v) s.setText(v);
    }
    if (this.timerTexts.length) {
      const sec = Math.max(0, Math.ceil(this.timeLeft));
      const label = `⏱ ${sec}`;
      for (const t of this.timerTexts) {
        if (t.text !== label) t.setText(label);
        t.setColor(sec <= 5 && this.state === 'play' ? '#ff7a85' : '#fff8e7');
      }
      if (this.state === 'play' && sec <= 5 && sec !== this.lastTick && sec > 0) {
        this.lastTick = sec;
        Audio.sfx('tick');
        for (const t of this.timerTexts) this.tweens.add({ targets: t, scale: { from: 1.6, to: 1 }, duration: 250 });
      }
    }
  }

  // ─────────────────────────── INTRO ───────────────────────────

  private card(angle: number, cy: number): Phaser.GameObjects.Container {
    const m = this.meta;
    const c = this.add.container(this.vw / 2, cy).setAngle(angle);
    const w = Math.min(this.vw - 60, 440);
    const bg = this.add.nineslice(0, 0, 'ui-panel', undefined, w / S, 100 / S, 6, 6, 6, 6).setScale(S);
    const strip = this.add.rectangle(0, -38, w - 16, 20, m.color).setStrokeStyle(2, 0x1b1f3b);
    const num = txt(this, -w / 2 + 34, -38, `#${m.num}`, { size: 12, color: '#ffffff' });
    const cat = txt(this, w / 2 - 14, -38, CATEGORY_LABEL[m.category], { size: 11, color: '#ffffff', origin: [1, 0.5] });
    const title = txt(this, 0, -38, m.name, { size: 18, color: '#ffffff' });
    const how = txt(this, 0, -4, m.howTo.join('\n'), { size: 13, color: '#1b1f3b', strokeWidth: 0, shadow: false, wrap: w - 30 });
    const ctl = txt(this, 0, 34, `🎮 ${m.controls}`, { size: 11, color: '#5a4fa0', strokeWidth: 0, shadow: false, bold: false, wrap: w - 30 });
    c.add([bg, strip, title, num, cat, how, ctl]);
    return c;
  }

  private showIntro(): void {
    const o = this.add.container(0, 0).setDepth(5000);
    this.overlay = o;
    o.add(this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.72).setOrigin(0));
    // One card for each side of the table.
    const bottom = this.card(0, this.vh * 0.75);
    const top = this.card(180, this.vh * 0.25);
    o.add([bottom, top]);
    for (const card of [bottom, top]) this.tweens.add({ targets: card, scale: { from: 0.6, to: 1 }, alpha: { from: 0, to: 1 }, duration: 320, ease: 'Back.easeOut' });

    // Ready chips in each player's zone.
    const chips: Phaser.GameObjects.Text[] = [];
    for (const p of this.players) {
      const zone = this.zoneOf(p);
      const r = this.touch.zoneRect(zone);
      const x = zone.x < 0.5 ? r.x + 60 : r.right - 60;
      const y = zone.facing === 180 ? r.y + 52 : r.bottom - 52;
      const label = this.isCpu(p) ? 'CPU ✓' : 'แตะ = พร้อม!';
      const chip = txt(this, x, y, label, { size: 13, color: toCss(PLAYER_COLORS[p].light) }).setAngle(zone.facing);
      chips[p] = chip;
      o.add(chip);
      if (this.isCpu(p)) this.ready[p] = true;
      else this.tweens.add({ targets: chip, alpha: 0.4, yoyo: true, repeat: -1, duration: 450 });
    }
    const onDown = (t: { player: PlayerIndex }) => {
      if (this.state !== 'intro' || this.ready[t.player] || !this.players.includes(t.player)) return;
      this.ready[t.player] = true;
      const chip = chips[t.player];
      this.tweens.killTweensOf(chip);
      chip.setAlpha(1).setText('พร้อม! ✓');
      this.tweens.add({ targets: chip, scale: { from: 1.5, to: 1 }, duration: 200, ease: 'Back.easeOut' });
      Audio.sfx('select', 1 + t.player * 0.12);
      if (this.players.every((p) => this.ready[p])) this.time.delayedCall(250, () => this.beginCountdown());
    };
    this.touch.on('tap', onDown);
    this.touch.on('up', onDown);
    // Never wait forever: auto start.
    this.time.delayedCall(Party.fast ? 200 : 12000, () => this.beginCountdown());
    if (this.players.every((p) => this.ready[p])) this.time.delayedCall(Party.fast ? 100 : 2600, () => this.beginCountdown());
  }

  private beginCountdown(): void {
    if (this.state !== 'intro') return;
    this.state = 'countdown';
    const o = this.overlay;
    if (o) this.tweens.add({ targets: o, alpha: 0, duration: 200, onComplete: () => o.destroy() });
    this.overlay = undefined;
    const steps = ['3', '2', '1', 'GO!'];
    const gap = Party.fast ? 60 : 650;
    steps.forEach((s, i) => {
      this.time.delayedCall(i * gap + 200, () => {
        const isGo = s === 'GO!';
        Audio.sfx(isGo ? 'go' : 'count');
        for (const [deg, y] of [[0, this.vh * 0.62], [180, this.vh * 0.38]] as const) {
          const t = txt(this, this.vw / 2, y, s, { size: isGo ? 64 : 56, color: isGo ? '#ffe066' : '#ffffff', strokeWidth: 8 }).setDepth(5000).setAngle(deg);
          t.setScale(0.2);
          this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
          this.tweens.add({ targets: t, alpha: 0, scale: 1.6, delay: gap * 0.6, duration: 220, onComplete: () => t.destroy() });
        }
        if (isGo) {
          this.state = 'play';
          this.onStart();
        }
      });
    });
  }

  // ─────────────────────────── LOOP ───────────────────────────

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.05, deltaMs / 1000);
    if (this.paused) return;
    const steps = this.state === 'play' ? Party.speed : 1;
    for (let i = 0; i < steps; i++) {
      this.ambient(dt);
      if (this.state === 'play') {
        this.elapsed += dt;
        this.tick(dt);
        if (this.meta.duration > 0 && this.state === 'play') {
          this.timeLeft -= dt;
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.finish();
          }
        }
      }
    }
    this.updateHud();
  }

  /** Eliminate a player (survival games). Ends the game when one is left. */
  eliminate(p: PlayerIndex): void {
    if (this.eliminated.includes(p)) return;
    this.eliminated.push(p);
    Audio.sfx('lose');
    const panel = this.hudPanels[p];
    if (panel) this.tweens.add({ targets: panel, alpha: 0.35, duration: 300 });
    const alive = this.players.filter((q) => !this.eliminated.includes(q));
    if (alive.length <= 1 && this.players.length > 1) this.time.delayedCall(500, () => this.finish());
    if (alive.length === 0) this.time.delayedCall(500, () => this.finish());
  }

  alive(p: PlayerIndex): boolean {
    return this.players.includes(p) && !this.eliminated.includes(p);
  }

  /** End the round: banner, then the results screen. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.state = 'end';
    this.touch.releaseAll();
    Audio.stopMusic();
    Audio.sfx('finish');
    for (const [deg, y] of [[0, this.vh * 0.62], [180, this.vh * 0.38]] as const) {
      const t = txt(this, this.vw / 2, y, 'จบเกม! FINISH!', { size: 40, color: '#ffe066', strokeWidth: 8 }).setDepth(5000).setAngle(deg);
      this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 300, ease: 'Back.easeOut' });
    }
    Vfx.shake(this, 0.004, 200);
    const results = this.results();
    this.time.delayedCall(Party.fast ? 300 : 1900, () => this.goto('Results', { gameId: this.meta.id, results }));
  }

  // ─────────────────────────── PAUSE ───────────────────────────

  togglePause(): void {
    if (this.state === 'end') return;
    if (this.paused) return this.resumeGame();
    this.paused = true;
    this.tweens.pauseAll();
    this.time.paused = true;
    this.physics?.world?.pause();
    this.anims.pauseAll();
    this.touch.releaseAll();
    this.touch.enabled = false;
    const o = this.add.container(0, 0).setDepth(6000);
    o.add(this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.8).setOrigin(0).setInteractive());
    o.add(txt(this, this.vw / 2, this.vh / 2 - 90, 'หยุดชั่วคราว', { size: 30, color: '#ffe066' }));
    const mk = (y: number, label: string, skin: string, fn: () => void) =>
      o.add(new Button(this, this.vw / 2, y, { w: 220, h: 46, label, skin, onTap: fn }));
    mk(this.vh / 2 - 30, 'เล่นต่อ', 'ui-btn-mint', () => this.resumeGame());
    mk(this.vh / 2 + 26, 'เริ่มใหม่', 'ui-btn', () => { this.resumeGame(); this.scene.restart(); });
    mk(this.vh / 2 + 82, 'ออกเมนู', 'ui-btn-pink', () => { this.resumeGame(); Audio.stopMusic(); this.goto('Menu'); });
    this.pauseOverlay = o;
  }

  private resumeGame(): void {
    this.paused = false;
    this.tweens.resumeAll();
    this.time.paused = false;
    this.physics?.world?.resume();
    this.anims.resumeAll();
    this.touch.enabled = true;
    this.pauseOverlay?.destroy();
    this.pauseOverlay = undefined;
  }
}

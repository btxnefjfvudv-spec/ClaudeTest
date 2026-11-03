import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const TILE = 44;
const COLS = 12;
const ROWS = 7;
const LIVES = 3;
const MAX_ROUNDS = 16;

interface Hue { th: string; en: string; c: number; glyph: string[] }

/** Six floor colours, each with its own symbol so colour-blind players can play too. */
const HUES: Hue[] = [
  { th: 'แดง', en: 'RED', c: 0xff5a5a, glyph: ['.aa.aa.', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..', '...a...'] },
  { th: 'ส้ม', en: 'ORANGE', c: 0xff9a3c, glyph: ['...a...', '..aaa..', '..aaa..', '.aaaaa.', '.aaaaa.', 'aaaaaaa'] },
  { th: 'เหลือง', en: 'YELLOW', c: 0xffdc4a, glyph: ['...a...', '..aaa..', 'aaaaaaa', '.aaaaa.', '.aa.aa.', 'a.....a'] },
  { th: 'เขียว', en: 'GREEN', c: 0x46cf6e, glyph: ['.aaaaa.', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', '.aaaaa.'] },
  { th: 'ฟ้า', en: 'BLUE', c: 0x45a6ff, glyph: ['aaaaaaa', 'aaaaaaa', 'aa...aa', 'aa...aa', 'aaaaaaa', 'aaaaaaa'] },
  { th: 'ม่วง', en: 'PURPLE', c: 0xa77cf2, glyph: ['...a...', '..aaa..', '.aaaaa.', 'aaaaaaa', '.aaaaa.', '..aaa..'] },
];

interface Tile { gx: number; gy: number; hue: number; img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; gone: boolean; x: number; y: number }

type Phase = 'call' | 'drop' | 'back';

interface Banner {
  c: Phaser.GameObjects.Container;
  swatch: Phaser.GameObjects.Image;
  word: Phaser.GameObjects.Text;
  en: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
  barW: number;
}

/** #3 — Stand on the announced colour before every other tile drops away. */
export default class RainbowRun extends BaseMinigame {
  private kit!: ArenaKit;
  private tiles: Tile[] = [];
  private ax = 0;
  private ay = 0;
  private phase: Phase = 'back';
  private phaseT = 0;
  private callTime = 3;
  private round = 0;
  private target = 0;
  private lives = [LIVES, LIVES, LIVES, LIVES];
  private knocks = [0, 0, 0, 0];
  private falling = new Set<PlayerIndex>();
  private banners: Banner[] = [];
  private sideSwatches: Phaser.GameObjects.Image[] = [];
  private border!: Phaser.GameObjects.Rectangle;
  private clouds: Phaser.GameObjects.TileSprite[] = [];
  private sparkles: Phaser.GameObjects.Image[] = [];
  private t = 0;
  private lastTickSec = -1;

  constructor() {
    super(CATALOG['rainbow-run']);
  }

  setup(): void {
    this.tiles = [];
    this.phase = 'back';
    this.phaseT = 1.2;
    this.round = 0;
    this.target = -1;
    this.lives = [LIVES, LIVES, LIVES, LIVES];
    this.knocks = [0, 0, 0, 0];
    this.falling = new Set();
    this.banners = [];
    this.sideSwatches = [];
    this.sparkles = [];
    this.t = 0;
    this.ax = Math.round((this.vw - COLS * TILE) / 2);
    this.ay = Math.round((this.vh - ROWS * TILE) / 2);
    this.paintArt();
    this.buildBackground();
    this.buildTiles();
    this.shuffleColours(true);
    const bounds = new Phaser.Geom.Rectangle(this.ax + 2, this.ay + 6, COLS * TILE - 4, ROWS * TILE - 8);
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 1000, radius: 12, dashSpeed: 400, dashCooldown: 1.0, bounce: 0.6, bounds,
      spawn: (p) => this.spawnPoint(p),
    });
    this.kit.dashHit = 1.35;
    this.kit.onBump = (a, b, power) => {
      if (power > 150) { if (a.dashT > 0) b.data.bumpedBy = a.p + 1; if (b.dashT > 0) a.data.bumpedBy = b.p + 1; }
    };
    for (const b of this.kit.bodies) { b.data.react = 0; b.data.goal = -1; b.data.skill = 0.55 + Math.random() * 0.4; b.data.bumpedBy = 0; }
    this.buildBanners();
    this.refreshLives();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    HUES.forEach((h, i) => {
      makeTexture(this, `rainbow-run-tile-${i}`, 22, 26, (p) => {
        const top = h.c;
        p.rect(0, 22, 22, 4, shift(top, -0.55));
        p.hline(0, 22, 22, shift(top, -0.35));
        p.box(0, 0, 22, 22, top, 1);
        p.rect(2, 2, 18, 18, top);
        p.hline(2, 2, 18, shift(top, 0.45));
        p.vline(2, 2, 18, shift(top, 0.3));
        p.hline(2, 19, 18, shift(top, -0.2));
        p.stamp(8, 8, h.glyph, { a: shift(top, -0.28) });
        p.stamp(7, 7, h.glyph, { a: shift(top, 0.38) });
        p.px(4, 4, 0xffffff); p.px(5, 4, shift(top, 0.6)); p.px(4, 5, shift(top, 0.6));
      });
    });
    makeTexture(this, 'rainbow-run-glow', 22, 22, (p) => {
      p.rect(0, 0, 22, 22, 0xffffff, 60);
      p.hline(0, 0, 22, 0xffffff); p.hline(0, 21, 22, 0xffffff);
      p.vline(0, 0, 22, 0xffffff); p.vline(21, 0, 22, 0xffffff);
      p.hline(1, 1, 20, 0xffffff, 140); p.hline(1, 20, 20, 0xffffff, 140);
      p.vline(1, 1, 20, 0xffffff, 140); p.vline(20, 1, 20, 0xffffff, 140);
    });
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    makeTexture(this, `rainbow-run-sky-${aw}`, aw, ah, (p) => {
      p.gradient(0, 0, aw, ah, [0x2a1f5c, 0x4a2f86, 0x7a4aa8, 0x4a2f86, 0x2a1f5c]);
      const r = rng(77);
      for (let i = 0; i < 140; i++) {
        const x = Math.floor(r() * aw), y = Math.floor(r() * ah);
        p.px(x, y, r() > 0.7 ? 0xffffff : 0xc9b8ff);
        if (r() > 0.92) { p.px(x + 1, y, 0x8f7ad6); p.px(x - 1, y, 0x8f7ad6); p.px(x, y + 1, 0x8f7ad6); p.px(x, y - 1, 0x8f7ad6); }
      }
    });
    makeTexture(this, 'rainbow-run-cloud', 128, 96, (p) => {
      const r = rng(13);
      for (let i = 0; i < 5; i++) {
        const cx = 14 + r() * 100, cy = 14 + r() * 68;
        const w = 14 + r() * 12;
        p.ellipse(cx, cy + 2, w + 2, w * 0.45 + 2, 0xb49ae6, 150);
        p.ellipse(cx, cy, w, w * 0.45, 0xe7dcff, 200);
        p.ellipse(cx - w * 0.4, cy - 3, w * 0.55, w * 0.35, 0xffffff, 210);
        p.ellipse(cx + w * 0.35, cy - 2, w * 0.5, w * 0.3, 0xf4eeff, 210);
      }
    });
    makeTexture(this, 'rainbow-run-frame', 4, 4, (p) => p.rect(0, 0, 4, 4, 0xffffff));
    makeTexture(this, 'rainbow-run-twinkle', 7, 7, (p) => {
      p.vline(3, 0, 7, 0xffffff); p.hline(0, 3, 7, 0xffffff); p.px(3, 3, 0xffffff);
      p.px(2, 2, 0xd8ccff); p.px(4, 4, 0xd8ccff); p.px(2, 4, 0xd8ccff); p.px(4, 2, 0xd8ccff);
    });
    // Rim around the arena: rainbow-striped candy border.
    makeTexture(this, 'rainbow-run-rim', 12, 4, (p) => {
      HUES.forEach((h, i) => p.rect(i * 2, 0, 2, 4, h.c));
      p.hline(0, 0, 12, 0xffffff, 120);
      p.hline(0, 3, 12, 0x000000, 70);
    });
  }

  private buildBackground(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    this.add.image(0, 0, `rainbow-run-sky-${aw}`).setOrigin(0).setScale(S).setDepth(-200);
    this.clouds = [
      this.add.tileSprite(0, 0, aw, ah, 'rainbow-run-cloud').setOrigin(0).setScale(S).setDepth(-190).setAlpha(0.45),
      this.add.tileSprite(0, 0, aw / 1.5, ah / 1.5, 'rainbow-run-cloud').setOrigin(0).setScale(S * 1.5).setDepth(-185).setAlpha(0.6),
    ];
    for (let i = 0; i < 16; i++) {
      const s = this.add.image(Math.random() * this.vw, Math.random() * this.vh, 'rainbow-run-twinkle').setScale(S * (0.5 + Math.random() * 0.6)).setDepth(-180);
      s.setData('ph', Math.random() * 6);
      this.sparkles.push(s);
    }
    // Rainbow rim (drawn under the tiles' sides)
    const W = COLS * TILE, H = ROWS * TILE;
    const rimT = 8;
    this.add.tileSprite(this.ax - rimT, this.ay - rimT, (W + rimT * 2) / S, rimT / S, 'rainbow-run-rim').setOrigin(0).setScale(S).setDepth(-70);
    this.add.tileSprite(this.ax - rimT, this.ay + H + 8, (W + rimT * 2) / S, rimT / S, 'rainbow-run-rim').setOrigin(0).setScale(S).setDepth(-70);
    this.add.tileSprite(this.ax - rimT, this.ay, rimT / S, (H + 8) / S, 'rainbow-run-rim').setOrigin(0).setScale(S).setDepth(-70);
    this.add.tileSprite(this.ax + W, this.ay, rimT / S, (H + 8) / S, 'rainbow-run-rim').setOrigin(0).setScale(S).setDepth(-70);
    this.border = this.add.rectangle(this.ax + W / 2, this.ay + H / 2 + 4, W + 22, H + 30).setStrokeStyle(4, 0xffffff, 0.0).setDepth(-69);
  }

  private buildTiles(): void {
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        const x = this.ax + gx * TILE + TILE / 2, y = this.ay + gy * TILE + TILE / 2;
        const img = this.add.image(x, y, 'rainbow-run-tile-0').setOrigin(0.5, 0.5 * (22 / 26)).setScale(S).setDepth(-60 + gy * 0.1);
        const glow = this.add.image(x, y, 'rainbow-run-glow').setScale(S).setDepth(-59.95 + gy * 0.1).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
        this.tiles.push({ gx, gy, hue: 0, img, glow, gone: false, x, y });
      }
    }
  }

  /** New colour layout: Voronoi blobs; later rounds make the called colour rarer. */
  private shuffleColours(first = false): void {
    const r = Math.random;
    const seeds = Array.from({ length: 18 }, (_, i) => ({ x: r() * COLS, y: r() * ROWS, h: i % HUES.length }));
    for (const t of this.tiles) {
      let best = 0, bd = 1e9;
      seeds.forEach((s, i) => {
        const d = (s.x - t.gx - 0.5) ** 2 + ((s.y - t.gy - 0.5) * 1.2) ** 2 + r() * 0.6;
        if (d < bd) { bd = d; best = i; }
      });
      t.hue = seeds[best].h;
    }
    if (first) for (const t of this.tiles) t.img.setTexture(`rainbow-run-tile-${t.hue}`);
  }

  /** Make sure the called colour has a fair number of tiles in every quadrant. */
  private fixTarget(h: number): void {
    if (this.round > 5) {
      // Late game: only a handful of safe tiles anywhere on the board.
      const n = Math.max(3, 11 - (this.round - 5));
      for (const t of this.tiles) if (t.hue === h) t.hue = (h + 1 + Math.floor(Math.random() * (HUES.length - 1))) % HUES.length;
      const pool = [...this.tiles];
      for (let i = 0; i < n && pool.length; i++) {
        const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        t.hue = h;
        // sometimes grow a 2-tile pair
        if (Math.random() < 0.4) {
          const nb = this.tiles[t.gy * COLS + Math.min(COLS - 1, t.gx + 1)];
          if (nb) nb.hue = h;
        }
      }
      return;
    }
    const want = Math.max(1, Math.round(3.6 - this.round * 0.18));
    const maxQ = Math.max(2, Math.round(6 - this.round * 0.28));
    for (let q = 0; q < 4; q++) {
      const inQ = this.tiles.filter((t) => (t.gx < COLS / 2 ? 0 : 1) + (t.gy < ROWS / 2 ? 0 : 2) === q);
      let own = inQ.filter((t) => t.hue === h);
      while (own.length < want) {
        const pick = inQ.filter((t) => t.hue !== h)[Math.floor(Math.random() * (inQ.length - own.length))];
        if (!pick) break;
        pick.hue = h;
        own = inQ.filter((t) => t.hue === h);
      }
      while (own.length > maxQ) {
        const t = own.splice(Math.floor(Math.random() * own.length), 1)[0];
        t.hue = (h + 1 + Math.floor(Math.random() * (HUES.length - 1))) % HUES.length;
      }
    }
  }

  private buildBanners(): void {
    this.banners = [];
    for (const deg of [0, 180] as const) {
      const bx = deg === 0 ? this.vw / 2 - 64 : this.vw / 2 + 64;
      const by = deg === 0 ? this.vh - this.ay / 2 + 2 : this.ay / 2 - 2;
      const c = this.add.container(bx, by).setDepth(940).setAngle(deg);
      const w = 250, h = 58;
      const bg = this.add.nineslice(0, 0, 'ui-panel-dark', undefined, w / S, h / S, 6, 6, 6, 6).setScale(S).setAlpha(0.95);
      const swatch = this.add.image(-w / 2 + 34, -2, 'rainbow-run-tile-0').setScale(S * 1.05);
      const word = txt(this, 16, -10, '', { size: 24, color: '#ffffff', strokeWidth: 6 });
      const en = txt(this, 16, 13, '', { size: 11, color: '#c7c9d6', strokeWidth: 3 });
      const barW = w - 80;
      const barBg = this.add.rectangle(16 - barW / 2, 24, barW, 5, 0x14172e).setOrigin(0, 0.5);
      const bar = this.add.rectangle(16 - barW / 2, 24, barW, 5, 0xffffff).setOrigin(0, 0.5);
      c.add([bg, swatch, word, en, barBg, bar]);
      c.setVisible(false);
      this.banners.push({ c, swatch, word, en, bar, barW });
    }
    // Big swatches in the side margins (no text, so orientation-neutral)
    for (const side of [-1, 1]) {
      const x = side < 0 ? this.ax / 2 : this.vw - this.ax / 2;
      const img = this.add.image(x, this.vh / 2, 'rainbow-run-tile-0').setScale(S * 1.4).setDepth(930).setVisible(false);
      this.sideSwatches.push(img);
    }
  }

  // ───────────────────────────── HELPERS ─────────────────────────────

  private spawnPoint(p: PlayerIndex): { x: number; y: number } {
    const gx = p % 2 === 0 ? 2 : COLS - 3, gy = p < 2 ? 1 : ROWS - 2;
    return { x: this.ax + gx * TILE + TILE / 2, y: this.ay + gy * TILE + TILE / 2 };
  }

  private tileAt(x: number, y: number): Tile | undefined {
    const gx = Math.floor((x - this.ax) / TILE), gy = Math.floor((y - this.ay) / TILE);
    if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return undefined;
    return this.tiles[gy * COLS + gx];
  }

  private refreshLives(): void {
    for (const p of this.players) {
      this.score[p] = this.lives[p];
      this.hudText[p] = this.lives[p] > 0 ? '♥'.repeat(this.lives[p]) : 'OUT';
    }
  }

  // ───────────────────────────── ROUNDS ─────────────────────────────

  onStart(): void {
    this.phase = 'back';
    this.phaseT = 0.3;
  }

  private startCall(): void {
    this.round++;
    let h = Math.floor(Math.random() * HUES.length);
    if (h === this.target) h = (h + 1 + Math.floor(Math.random() * (HUES.length - 1))) % HUES.length;
    this.target = h;
    this.fixTarget(h);
    for (const t of this.tiles) t.img.setTexture(`rainbow-run-tile-${t.hue}`);
    this.callTime = Math.max(1.4, 3.2 - (this.round - 1) * 0.16);
    this.phase = 'call';
    this.phaseT = this.callTime;
    this.lastTickSec = -1;
    const hue = HUES[h];
    for (const b of this.banners) {
      b.c.setVisible(true);
      b.swatch.setTexture(`rainbow-run-tile-${h}`);
      b.word.setText(hue.th).setColor(`#${hue.c.toString(16).padStart(6, '0')}`);
      b.en.setText(`${hue.en} · รอบ ${this.round}`);
      this.tweens.add({ targets: b.c, scale: { from: 1.25, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    }
    for (const s of this.sideSwatches) {
      s.setVisible(true).setTexture(`rainbow-run-tile-${h}`);
      this.tweens.add({ targets: s, scale: { from: S * 2.2, to: S * 1.4 }, angle: { from: -20, to: 0 }, duration: 300, ease: 'Back.easeOut' });
    }
    this.border.setStrokeStyle(5, hue.c, 1);
    Audio.sfx('select', 0.8 + h * 0.08);
    Audio.sfx('drum');
    for (const b of this.kit.bodies) { b.data.react = 0.3 + Math.random() * 0.6 * (1.3 - b.data.skill); b.data.goal = -1; b.data.mistake = Math.random() < 0.16 * (1.25 - b.data.skill) ? 1 : 0; }
  }

  private dropTiles(): void {
    this.phase = 'drop';
    this.phaseT = 1.25;
    Audio.sfx('whoosh');
    Audio.sfx('bigHit', 0.8);
    Vfx.shake(this, 0.004, 160);
    for (const t of this.tiles) {
      t.img.setAlpha(1).setX(t.x);
      if (t.hue === this.target) {
        t.glow.setAlpha(0.6);
        this.tweens.add({ targets: t.glow, alpha: 0, duration: 600 });
        continue;
      }
      t.gone = true;
      const d = Math.random() * 80;
      this.tweens.add({ targets: t.img, scale: S * 0.55, y: t.y + 40, alpha: 0, duration: 420, delay: d, ease: 'Quad.easeIn' });
    }
    for (const b of this.kit.alive) this.checkFall(b);
  }

  private returnTiles(): void {
    this.phase = 'back';
    this.phaseT = 0.85;
    this.shuffleColours();
    for (const b of this.banners) b.c.setVisible(false);
    for (const s of this.sideSwatches) s.setVisible(false);
    this.border.setStrokeStyle(4, 0xffffff, 0);
    const cx = COLS / 2, cy = ROWS / 2;
    for (const t of this.tiles) {
      t.img.setTexture(`rainbow-run-tile-${t.hue}`);
      if (!t.gone) continue;
      t.gone = false;
      const d = Math.hypot(t.gx + 0.5 - cx, t.gy + 0.5 - cy) * 40;
      this.tweens.killTweensOf(t.img);
      t.img.setY(t.y + 30).setScale(S * 0.6).setAlpha(0);
      this.tweens.add({ targets: t.img, y: t.y, scale: S, alpha: 1, duration: 300, delay: d, ease: 'Back.easeOut' });
    }
    Audio.sfx('pop', 0.9);
    // Fallen players come back on solid ground.
    for (const p of [...this.falling]) this.respawn(p);
  }

  private checkFall(b: ArenaBody): void {
    if (!b.alive || this.falling.has(b.p)) return;
    const t = this.tileAt(b.x, b.y);
    if (t && !t.gone) return;
    this.fall(b);
  }

  private fall(b: ArenaBody): void {
    this.falling.add(b.p);
    this.kit.kill(b);
    this.lives[b.p]--;
    const av = b.avatar;
    av.play('fall', true);
    av.marker?.setVisible(false);
    av.ring?.setVisible(false);
    av.shadow?.setVisible(false);
    av.sprite.setDepth(-65);
    this.tweens.add({ targets: av.sprite, scale: S * 0.3, y: av.sprite.y + 50, alpha: 0, angle: 260, duration: 700, ease: 'Quad.easeIn' });
    Audio.sfx('whoosh', 0.7);
    Audio.sfx('lose', 1 + b.p * 0.05);
    Vfx.popText(this, b.x, b.y - 50, '−♥', '#ff7a85', 22, this.angleFor(b.p));
    burst(this, b.x, b.y, { tex: 'spark', count: 10, tint: [0xffffff, 0xd8ccff], speed: [40, 120], life: 500 });
    const by = (b.data.bumpedBy as number) - 1;
    if (by >= 0 && by !== b.p) {
      this.knocks[by]++;
      Vfx.popText(this, b.x, b.y - 80, 'ชนตก!', '#ffe066', 16, this.angleFor(by as PlayerIndex));
    }
    if (this.lives[b.p] <= 0) {
      this.falling.delete(b.p);
      this.eliminate(b.p);
    }
    this.refreshLives();
  }

  private respawn(p: PlayerIndex): void {
    this.falling.delete(p);
    const b = this.kit.body(p);
    if (!b || this.lives[p] <= 0) return;
    const s = this.spawnPoint(p);
    b.x = s.x; b.y = s.y; b.vx = b.vy = 0; b.stun = 0;
    b.alive = true;
    b.invuln = 1.2;
    b.data.bumpedBy = 0;
    const av = b.avatar;
    av.sprite.setAlpha(1).setAngle(0).setScale(S);
    av.marker?.setVisible(true);
    av.ring?.setVisible(true);
    av.shadow?.setVisible(true);
    av.setPos(b.x, b.y, 80);
    this.tweens.addCounter({ from: 80, to: 0, duration: 380, ease: 'Bounce.easeOut', onUpdate: (tw) => { if (b.alive) av.setPos(b.x, b.y, tw.getValue() ?? 0); } });
    Vfx.dust(this, b.x, b.y);
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    this.clouds[0].tilePositionX = this.t * 4;
    this.clouds[0].tilePositionY = this.t * 1.5;
    this.clouds[1].tilePositionX = -this.t * 7;
    this.clouds[1].tilePositionY = Math.sin(this.t * 0.2) * 10;
    for (const s of this.sparkles) {
      const ph = s.getData('ph') as number;
      s.setAlpha(Math.max(0, Math.sin(this.t * 2 + ph)));
      s.setAngle(this.t * 40 + ph * 30);
    }
    this.kit.update(dt, this.state === 'play');
    // bumped flag fades
    for (const b of this.kit.bodies) if (b.stun <= 0 && b.dashT <= 0 && Math.random() < dt * 2) b.data.bumpedBy = 0;
    if (this.state === 'intro' || this.state === 'countdown') {
      for (const t of this.tiles) t.glow.setAlpha(0.12 + 0.1 * Math.sin(this.t * 3 + t.gx * 0.6 + t.gy * 0.4));
    }
  }

  tick(dt: number): void {
    this.phaseT -= dt;
    if (this.phase === 'call') {
      const k = Math.max(0, this.phaseT / this.callTime);
      for (const b of this.banners) {
        b.bar.width = b.barW * k;
        b.bar.setFillStyle(k < 0.35 ? 0xff5a5a : k < 0.65 ? 0xffe066 : 0x7ee8b0);
      }
      // Right tiles glow; wrong ones tremble near the end.
      const pulse = 0.25 + 0.2 * Math.sin(this.t * 12);
      for (const t of this.tiles) {
        if (t.hue === this.target) t.glow.setAlpha(pulse);
        else {
          t.glow.setAlpha(0);
          t.img.setX(k < 0.45 ? t.x + Math.sin(this.t * 60 + t.gx) * (1 - k / 0.45) * 2 : t.x);
        }
      }
      const sec = Math.ceil(this.phaseT);
      if (sec !== this.lastTickSec && this.phaseT < this.callTime - 0.2) { this.lastTickSec = sec; Audio.sfx('tick'); }
      if (this.phaseT <= 0) this.dropTiles();
    } else if (this.phase === 'drop') {
      for (const b of this.kit.alive) this.checkFall(b);
      if (this.phaseT <= 0) this.returnTiles();
    } else if (this.phase === 'back') {
      if (this.phaseT <= 0) {
        if (this.round >= MAX_ROUNDS) { this.finish(); return; }
        this.startCall();
      }
    }
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b, dt);
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    if (this.phase === 'back') {
      // drift toward the middle so every colour is in reach
      b.botTarget = { x: this.vw / 2 + (b.p % 2 ? 40 : -40), y: this.vh / 2 + (b.p < 2 ? -30 : 30) };
      return;
    }
    if (this.phase === 'call' && b.data.react > 0) { b.data.react -= dt; b.botTarget = undefined; return; }
    const hue = b.data.mistake && this.phase === 'call' && this.phaseT > this.callTime * 0.45 ? (this.target + 2) % HUES.length : this.target;
    let goal = this.tiles[b.data.goal];
    if (!goal || goal.hue !== hue || goal.gone) {
      const opts = this.tiles.filter((t) => t.hue === hue && !t.gone)
        .map((t) => ({ t, d: Math.hypot(t.x - b.x, t.y - b.y) + Math.random() * 30 + this.crowd(t, b) }))
        .sort((a, c) => a.d - c.d);
      goal = opts[0]?.t;
      if (!goal) return;
      b.data.goal = this.tiles.indexOf(goal);
    }
    b.botTarget = { x: goal.x, y: goal.y + 2 };
    // Aggression: bump a rival who is on the right colour near the drop.
    if (this.phase === 'call' && this.phaseT < 1.2 && b.dashCd <= 0 && Math.random() < 0.09 * b.data.skill) {
      const here = this.tileAt(b.x, b.y);
      for (const o of this.kit.alive) {
        if (o === b) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < 60 && here && here.hue === this.target) {
          b.ix = (o.x - b.x) / d; b.iy = (o.y - b.y) / d;
          b.botTarget = { x: o.x, y: o.y };
          b.botDash = true;
          break;
        }
      }
    }
  }

  /** Avoid piling onto a tile already taken by a rival. */
  private crowd(t: Tile, me: ArenaBody): number {
    let c = 0;
    for (const o of this.kit.alive) if (o !== me && Math.hypot(o.x - t.x, o.y - t.y) < TILE) c += 40;
    return c;
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => {
      const i = this.eliminated.indexOf(p);
      if (i !== -1) return i * 100 + this.knocks[p];
      return 10000 + this.lives[p] * 100 + this.knocks[p];
    };
    return rankBy(this.players, value).map((r) => ({ ...r, score: this.lives[r.player] }));
  }
}

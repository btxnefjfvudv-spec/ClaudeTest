import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const HEARTS = 3;

type Kind = 'book' | 'chair' | 'desk' | 'board';
/** Footprint in art pixels (shown at S). */
const SIZE: Record<Kind, [number, number]> = { book: [15, 11], chair: [20, 20], desk: [32, 22], board: [76, 20] };

interface Drop {
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: boolean;
  warn: number;
  t: number;
  shadow: Phaser.GameObjects.Image;
  outline: Phaser.GameObjects.Image;
  obj?: Phaser.GameObjects.Image;
  landed: boolean;
  life: number;
  variant: number;
}

interface Pickup { x: number; y: number; img: Phaser.GameObjects.Image; t: number }

/** #7 — Dodge books, chairs, desks and blackboards falling into the classroom. */
export default class FallingBlocks extends BaseMinigame {
  private kit!: ArenaKit;
  private drops: Drop[] = [];
  private pickups: Pickup[] = [];
  private hearts = [HEARTS, HEARTS, HEARTS, HEARTS];
  private grabs = [0, 0, 0, 0];
  private lastHit = [0, 0, 0, 0];
  private shields: (Phaser.GameObjects.Image | undefined)[] = [];
  private spawnT = 0;
  private aimT = 0;
  private aimNext = 0;
  private waveT = 0;
  private pickT = 0;
  private bounds!: Phaser.Geom.Rectangle;
  private fan!: Phaser.GameObjects.Image;
  private beams: Phaser.GameObjects.Image[] = [];
  private motes: Phaser.GameObjects.Image[] = [];
  private t = 0;

  constructor() {
    super(CATALOG['falling-blocks']);
  }

  setup(): void {
    this.drops = [];
    this.pickups = [];
    this.hearts = [HEARTS, HEARTS, HEARTS, HEARTS];
    this.grabs = [0, 0, 0, 0];
    this.lastHit = [0, 0, 0, 0];
    this.shields = [];
    this.spawnT = 1.2;
    this.aimT = 3;
    this.aimNext = Math.floor(Math.random() * 4);
    this.waveT = 10;
    this.pickT = 5;
    this.beams = [];
    this.motes = [];
    this.t = 0;
    this.bounds = new Phaser.Geom.Rectangle(40, 46, this.vw - 80, this.vh - 92);
    this.paintArt();
    this.buildRoom();
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 1000, radius: 12, dashSpeed: 400, dashCooldown: 1.0, bounce: 0.6, bounds: this.bounds,
      spawn: (p) => ({ x: this.vw / 2 + (p % 2 ? 1 : -1) * 120, y: this.vh / 2 + (p < 2 ? -70 : 70) }),
    });
    this.kit.dashHit = 1.05;
    for (const b of this.kit.bodies) { b.data.skill = 0.45 + Math.random() * 0.45; b.data.react = 0; b.data.daze = 0; b.data.seen = 0; b.data.wx = 0; b.data.wy = 0; }
    this.refresh();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    makeTexture(this, `falling-blocks-floor-${aw}`, aw, ah, (p) => {
      const r = rng(8);
      // parquet planks
      for (let y = 0; y < ah; y += 8) {
        let x = -((y / 8) % 3) * 9;
        while (x < aw) {
          const len = 18 + Math.floor(r() * 10);
          const base = [0xd9b384, 0xcfa673, 0xe2bd8e, 0xc89c68][Math.floor(r() * 4)];
          p.rect(x, y, len, 8, base);
          p.hline(x, y, len, shift(base, 0.22));
          p.hline(x, y + 7, len, shift(base, -0.25));
          p.vline(x, y, 8, shift(base, -0.35));
          if (r() > 0.6) p.hline(x + 3, y + 3 + Math.floor(r() * 3), 5, shift(base, -0.1));
          x += len;
        }
      }
      // rug in the centre
      const rx = aw / 2 - 70, ry = ah / 2 - 42;
      p.rect(rx - 2, ry - 2, 144, 88, 0x8a3f4a);
      p.rect(rx, ry, 140, 84, 0xc9566a);
      p.rect(rx + 6, ry + 6, 128, 72, 0x2b5a8a);
      p.rect(rx + 9, ry + 9, 122, 66, 0x3d7ab8);
      for (let i = 0; i < 6; i++) p.ring(aw / 2, ah / 2, 8 + i * 6, i % 2 ? 0xffe066 : 0x6ec6ff, 1);
      for (let x = rx; x < rx + 140; x += 4) { p.vline(x, ry - 5, 3, 0xfff1c9); p.vline(x, ry + 86, 3, 0xfff1c9); }
      // walls (top-down): thick border with skirting
      const wall = 0x5fa89a;
      p.rect(0, 0, aw, 18, wall); p.rect(0, ah - 18, aw, 18, wall);
      p.rect(0, 0, 16, ah, wall); p.rect(aw - 16, 0, 16, ah, wall);
      p.rect(16, 17, aw - 32, 2, 0x3a7a6e); p.rect(16, ah - 19, aw - 32, 2, 0x3a7a6e);
      p.rect(15, 18, 2, ah - 36, 0x3a7a6e); p.rect(aw - 17, 18, 2, ah - 36, 0x3a7a6e);
      for (let x = 0; x < aw; x += 6) { p.px(x, 4, shift(wall, 0.2)); p.px(x + 3, ah - 5, shift(wall, -0.2)); }
      // windows on the long walls
      for (let x = 50; x < aw - 60; x += 80) {
        p.rect(x, 3, 40, 10, 0xbfe8ff); p.hline(x, 3, 40, 0xffffff); p.vline(x + 20, 3, 10, 0x8fb8d0);
        p.rect(x + 20, ah - 13, 40, 10, 0xbfe8ff); p.hline(x + 20, ah - 13, 40, 0xffffff); p.vline(x + 40, ah - 13, 10, 0x8fb8d0);
      }
      // bookshelves on the short walls
      for (const sx of [2, aw - 14]) for (let y = 40; y < ah - 50; y += 46) {
        p.box(sx, y, 12, 40, 0x8a5530);
        for (let k = 0; k < 9; k++) p.rect(sx + 2, y + 3 + k * 4, 8, 3, [0xff5a6e, 0x3d9bff, 0x3ed17a, 0xffc93d, 0xb8a6ff][(k + y) % 5]);
      }
      // stray chalk dust / scuffs
      for (let i = 0; i < 40; i++) p.px(20 + r() * (aw - 40), 22 + r() * (ah - 44), 0xf0dcbc);
    });
    makeTexture(this, 'falling-blocks-beam', 40, 120, (p) => {
      for (let y = 0; y < 120; y++) for (let x = 0; x < 40; x++) {
        const e = Math.min(x, 39 - x) / 20;
        p.px(x, y, 0xfff1c9, Math.round(Math.min(1, e * 2) * 26));
      }
    });
    makeTexture(this, 'falling-blocks-fan', 80, 80, (p) => {
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        for (let r = 6; r < 38; r++) {
          const w = 5 + (r / 38) * 5;
          for (let s = -w; s <= w; s++) {
            const aa = a + (s / r) * 0.9;
            p.px(40 + Math.cos(aa) * r, 40 + Math.sin(aa) * r, 0x1b1f3b);
          }
        }
      }
      p.circle(40, 40, 7, 0x1b1f3b);
    });
    makeTexture(this, 'falling-blocks-mote', 2, 2, (p) => p.rect(0, 0, 2, 2, 0xfff8e7));
    // falling objects (top-down)
    const book = (p: Painter, c: number) => {
      p.box(0, 0, 15, 11, c);
      p.rect(0, 0, 3, 11, shift(c, -0.35));
      p.vline(14, 1, 9, 0xfff8e7); p.vline(13, 1, 9, 0xe8dcc0);
      p.rect(6, 3, 6, 2, shift(c, 0.4)); p.rect(6, 6, 4, 1, shift(c, 0.25));
      p.outline(-0.75);
    };
    [0xff5a6e, 0x3d9bff, 0x3ed17a, 0xb8a6ff].forEach((c, i) => makeTexture(this, `falling-blocks-book-${i}`, 17, 13, (p) => book(p.sub(1, 1, 15, 11), c)));
    makeTexture(this, 'falling-blocks-chair-0', 22, 22, (q) => {
      const p = q.sub(1, 1, 20, 20);
      p.rect(1, 1, 3, 3, 0x5d6584); p.rect(16, 1, 3, 3, 0x5d6584); p.rect(1, 16, 3, 3, 0x5d6584); p.rect(16, 16, 3, 3, 0x5d6584);
      p.box(2, 5, 16, 13, 0xc0834a);
      p.hline(4, 9, 12, 0xa86f3c); p.hline(4, 13, 12, 0xa86f3c);
      p.box(1, 0, 18, 5, 0x8a5530);
      p.hline(3, 2, 14, 0xb97a3e);
      q.outline(-0.75);
    });
    makeTexture(this, 'falling-blocks-desk-0', 34, 24, (q) => {
      const p = q.sub(1, 1, 32, 22);
      p.box(0, 0, 32, 22, 0xdba366, 1);
      p.hline(2, 3, 28, 0xf0c48a);
      p.rect(2, 17, 28, 3, 0xc0834a);
      p.hline(4, 18, 10, 0x8a5530);
      p.box(5, 5, 10, 8, 0xfff8e7); p.hline(6, 7, 7, 0x8fa3c4); p.hline(6, 9, 6, 0x8fa3c4);
      p.rect(19, 7, 9, 2, 0xffc93d); p.px(27, 7, 0xff7a85); p.px(19, 7, 0x2b2b3a);
      q.outline(-0.75);
    });
    makeTexture(this, 'falling-blocks-board-0', 78, 22, (q) => {
      const p = q.sub(1, 1, 76, 20);
      p.box(0, 0, 76, 20, 0x9e6234, 1);
      p.rect(2, 2, 72, 14, 0x2f6b4f);
      const r = rng(4);
      for (let i = 0; i < 9; i++) { const x = 5 + i * 7 + r() * 3, y = 4 + r() * 8; p.hline(x, y, 3 + r() * 3, 0xe8f4ea); p.px(x + 1, y + 1, 0xc8e0cc); }
      p.ring(60, 8, 3, 0xe8f4ea, 1);
      p.rect(2, 16, 72, 2, 0x7a4a2c);
      p.rect(20, 16, 4, 1, 0xffffff); p.rect(40, 16, 3, 1, 0xffe066);
      q.outline(-0.75);
    });
    // shadows and warning outlines per kind
    for (const k of Object.keys(SIZE) as Kind[]) {
      const [w, h] = SIZE[k];
      makeTexture(this, `falling-blocks-shadow-${k}`, w + 2, h + 2, (p) => {
        p.rect(1, 0, w, h + 2, 0x1b1f3b); p.rect(0, 1, w + 2, h, 0x1b1f3b);
      });
      makeTexture(this, `falling-blocks-warn-${k}`, w + 4, h + 4, (p) => {
        for (let x = 0; x < w + 4; x++) { if ((x >> 1) % 2) { p.px(x, 0, 0xff3b3b); p.px(x, h + 3, 0xff3b3b); } }
        for (let y = 0; y < h + 4; y++) { if ((y >> 1) % 2) { p.px(0, y, 0xff3b3b); p.px(w + 3, y, 0xff3b3b); } }
      });
    }
    makeTexture(this, 'falling-blocks-shield', 22, 22, (p) => {
      p.ring(11, 11, 10.5, 0x9fe3ff, 1);
      p.ring(11, 11, 9.5, 0x6ec6ff, 1);
      p.px(5, 6, 0xffffff); p.px(6, 5, 0xffffff); p.px(7, 4, 0xffffff);
    });
    makeTexture(this, 'falling-blocks-pickup', 14, 16, (p) => {
      p.stamp(0, 0, [
        '.aaaaaaaaaaaa.', 'abbbbbbbbbbbba', 'abccbbbbbbbbba', 'abcbbbbbbbbbba', 'abbbbbbbbbbbba', 'abbbbbbbbbbbba',
        'abbbbbbbbbbbba', '.abbbbbbbbbba.', '.abbbbbbbbbba.', '..abbbbbbbba..', '...abbbbbba...', '....abbbba....', '.....abba.....', '......aa......',
      ], { a: 0x1d5bb3, b: 0x6ec6ff, c: 0xffffff });
      p.outline(-0.7);
    });
  }

  private buildRoom(): void {
    const aw = Math.ceil(this.vw / S);
    this.add.image(0, 0, `falling-blocks-floor-${aw}`).setOrigin(0).setScale(S).setDepth(-200);
    for (let i = 0; i < 3; i++) {
      const b = this.add.image(120 + i * 220, this.vh / 2, 'falling-blocks-beam').setScale(S * 1.2, S * 2.2).setAngle(28).setDepth(-150).setBlendMode(Phaser.BlendModes.ADD);
      b.setData('x0', b.x);
      this.beams.push(b);
    }
    this.fan = this.add.image(this.vw / 2, this.vh / 2, 'falling-blocks-fan').setScale(S * 1.4).setAlpha(0.08).setDepth(-140);
    for (let i = 0; i < 22; i++) {
      const m = this.add.image(Math.random() * this.vw, Math.random() * this.vh, 'falling-blocks-mote').setScale(S * 0.6).setAlpha(0.5).setDepth(1500);
      m.setData('ph', Math.random() * 10);
      this.motes.push(m);
    }
  }

  private refresh(): void {
    for (const p of this.players) {
      this.score[p] = this.hearts[p];
      this.hudText[p] = this.hearts[p] > 0 ? '♥'.repeat(this.hearts[p]) : 'OUT';
    }
  }

  // ───────────────────────────── SPAWNING ─────────────────────────────

  private spawn(kind: Kind, x: number, y: number, rot = false, warn?: number): void {
    const [aw, ah] = SIZE[kind];
    const w = (rot ? ah : aw) * S, h = (rot ? aw : ah) * S;
    const b = this.bounds;
    x = Phaser.Math.Clamp(x, b.x + w / 2 - 6, b.right - w / 2 + 6);
    y = Phaser.Math.Clamp(y, b.y + h / 2 - 6, b.bottom - h / 2 + 6);
    const wt = warn ?? Math.max(0.85, 1.35 - this.elapsed * 0.008) + (kind === 'board' ? 0.2 : 0);
    const shadow = this.add.image(x, y, `falling-blocks-shadow-${kind}`).setScale(S * 0.3).setAlpha(0.15).setDepth(-60).setAngle(rot ? 90 : 0);
    const outline = this.add.image(x, y, `falling-blocks-warn-${kind}`).setScale(S).setAlpha(0).setDepth(-59).setAngle(rot ? 90 : 0);
    this.drops.push({ kind, x, y, w, h, rot, warn: wt, t: 0, shadow, outline, landed: false, life: 2.2, variant: Math.floor(Math.random() * 4) });
  }

  private randomKind(): Kind {
    const e = this.elapsed;
    const r = Math.random();
    const big = Math.min(0.55, e / 90);
    if (r < 0.45 - big * 0.4) return 'book';
    if (r < 0.75 - big * 0.3) return 'chair';
    if (r < 0.95 - big * 0.1) return 'desk';
    return 'board';
  }

  private direct(dt: number): void {
    const e = this.elapsed;
    // background rain
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(0.2, 0.85 - e * 0.012) * (0.7 + Math.random() * 0.6);
      const k = this.randomKind();
      this.spawn(k, this.bounds.x + Math.random() * this.bounds.width, this.bounds.y + Math.random() * this.bounds.height, Math.random() < 0.5);
    }
    // aimed drops: each player in turn
    this.aimT -= dt;
    if (this.aimT <= 0) {
      this.aimT = Math.max(0.38, 1.3 - e * 0.016);
      const alive = this.kit.alive;
      if (alive.length) {
        const b = alive[this.aimNext % alive.length];
        this.aimNext++;
        this.spawn(Math.random() < 0.5 ? 'chair' : this.randomKind(), b.x + b.vx * 0.4, b.y + b.vy * 0.4, Math.random() < 0.5);
      }
    }
    // patterns
    this.waveT -= dt;
    if (this.waveT <= 0) {
      this.waveT = Math.max(6, 10 - e * 0.08);
      const bd = this.bounds;
      const kind = Math.floor(Math.random() * 3);
      Audio.sfx('whoosh', 0.7);
      if (kind === 0) {
        // blackboard bars across the room, with a gap
        const gap = Math.floor(Math.random() * 4);
        for (let i = 0; i < 4; i++) if (i !== gap) this.spawn('board', bd.x + bd.width * (0.14 + i * 0.24), bd.centerY + (i % 2 ? -1 : 1) * 40, true, 1.6);
      } else if (kind === 1) {
        // ring of books around the middle
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; this.spawn('book', bd.centerX + Math.cos(a) * 150, bd.centerY + Math.sin(a) * 100, i % 2 === 0, 1.4); }
      } else {
        // checkerboard of desks
        for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 5; gx++) if ((gx + gy) % 2 === 0) this.spawn('desk', bd.x + bd.width * (0.1 + gx * 0.2), bd.y + bd.height * (0.17 + gy * 0.33), false, 1.5);
      }
    }
    // shields
    this.pickT -= dt;
    if (this.pickT <= 0 && this.pickups.length === 0) {
      this.pickT = 12 + Math.random() * 4;
      const x = this.bounds.x + 40 + Math.random() * (this.bounds.width - 80), y = this.bounds.y + 30 + Math.random() * (this.bounds.height - 60);
      const img = this.add.image(x, y, 'falling-blocks-pickup').setScale(S).setDepth(y);
      this.tweens.add({ targets: img, scale: { from: 0, to: S }, duration: 300, ease: 'Back.easeOut' });
      this.pickups.push({ x, y, img, t: 9 });
      Audio.sfx('pop', 1.4);
    }
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    this.kit.update(dt, this.state === 'play');
    this.fan.setRotation(this.t * 1.3);
    this.beams.forEach((b, i) => { b.x = (b.getData('x0') as number) + Math.sin(this.t * 0.15 + i) * 30; b.setAlpha(0.7 + Math.sin(this.t * 0.6 + i * 2) * 0.3); });
    for (const m of this.motes) {
      const ph = m.getData('ph') as number;
      m.x += Math.sin(this.t * 0.5 + ph) * 6 * dt;
      m.y += Math.cos(this.t * 0.4 + ph) * 4 * dt - 2 * dt;
      if (m.y < 0) m.y = this.vh;
      m.setAlpha(0.25 + 0.25 * Math.sin(this.t + ph));
    }
    for (const p of this.players) {
      const s = this.shields[p];
      const b = this.kit.body(p);
      if (s && b) s.setPosition(b.x, b.y - 22).setDepth(b.y + 5).setAlpha(0.7 + Math.sin(this.t * 8) * 0.2).setAngle(this.t * 60);
    }
    for (const pk of this.pickups) pk.img.setY(pk.y - 6 + Math.sin(this.t * 4 + pk.x) * 3);
    // solid landed objects
    for (const d of this.drops) if (d.landed) for (const b of this.kit.alive) this.pushOutRect(b, d);
  }

  tick(dt: number): void {
    this.direct(dt);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (!d.landed) {
        d.t += dt;
        const u = Math.min(1, d.t / d.warn);
        d.shadow.setScale(S * (0.3 + 0.7 * u)).setAlpha(0.15 + 0.4 * u);
        if (u > 0.6) d.outline.setAlpha(Math.floor(d.t * 14) % 2 ? 0.9 : 0.3);
        const fallT = 0.34;
        if (d.t > d.warn - fallT && !d.obj) {
          d.obj = this.add.image(d.x, d.y - 280, `falling-blocks-${d.kind}-${d.kind === 'book' ? d.variant : 0}`).setScale(S * 1.5).setAngle((d.rot ? 90 : 0) + (Math.random() - 0.5) * 30).setDepth(d.y + 400);
        }
        if (d.obj) {
          const k = Phaser.Math.Clamp((d.t - (d.warn - fallT)) / fallT, 0, 1);
          d.obj.setY(d.y - 280 * (1 - k * k)).setScale(S * (1.5 - 0.5 * k));
        }
        if (d.t >= d.warn) this.impact(d);
      } else {
        d.life -= dt;
        if (d.life <= 0) {
          burst(this, d.x, d.y, { tex: 'puff', count: 6, tint: [0xffffff, 0xe8e0d0], speed: [20, 60], life: 400, scale: [S, S * 0.3] });
          d.obj?.destroy();
          d.shadow.destroy();
          d.outline.destroy();
          this.drops.splice(i, 1);
        } else if (d.life < 0.5 && d.obj) d.obj.setAlpha(Math.floor(d.life * 16) % 2 ? 0.4 : 1);
      }
    }
    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.t -= dt;
      const b = this.kit.alive.find((o) => Math.hypot(o.x - pk.x, o.y - pk.y) < 24);
      if (b) {
        this.grabs[b.p]++;
        if (!this.shields[b.p]) this.shields[b.p] = this.add.image(b.x, b.y, 'falling-blocks-shield').setScale(S * 1.5);
        Audio.sfx('power', 1 + b.p * 0.08);
        Vfx.sparkle(this, pk.x, pk.y, [0x9fe3ff, 0xffffff]);
        Vfx.popText(this, pk.x, pk.y - 30, 'โล่!', '#9fe3ff', 16, this.angleFor(b.p));
      }
      if (b || pk.t <= 0) {
        if (!b) burst(this, pk.x, pk.y, { tex: 'spark', count: 5, tint: 0x9fe3ff, life: 300 });
        pk.img.destroy();
        this.pickups.splice(i, 1);
      } else if (pk.t < 2) pk.img.setAlpha(Math.floor(pk.t * 10) % 2 ? 0.4 : 1);
    }
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b, dt);
    this.refresh();
  }

  private impact(d: Drop): void {
    d.landed = true;
    d.outline.setAlpha(0);
    d.shadow.setScale(S).setAlpha(0.3).setPosition(d.x + 4, d.y + 5);
    if (!d.obj) d.obj = this.add.image(d.x, d.y, `falling-blocks-${d.kind}-${d.kind === 'book' ? d.variant : 0}`).setScale(S).setAngle(d.rot ? 90 : 0);
    d.obj.setPosition(d.x, d.y).setScale(S).setDepth(d.y - d.h / 2 + 4).setAngle(d.rot ? 90 : 0);
    const big = d.kind === 'board' || d.kind === 'desk';
    Audio.sfx(big ? 'bigHit' : 'hit', d.kind === 'book' ? 1.4 : 0.9 + Math.random() * 0.2);
    Vfx.squash(this, d.obj, 1.15, 0.85, 160);
    burst(this, d.x, d.y + d.h / 2, { tex: 'dust', count: big ? 14 : 7, tint: [0xf0e6d0, 0xd9c8a8], speed: [40, big ? 160 : 100], angle: [0, 360], life: 500, scale: [S, 0] });
    if (big) Vfx.shake(this, d.kind === 'board' ? 0.008 : 0.004, 140);
    for (const b of this.kit.alive) {
      if (b.invuln > 0) continue;
      const inX = Math.abs(b.x - d.x) < d.w / 2 + 6, inY = Math.abs(b.y - d.y) < d.h / 2 + 6;
      if (inX && inY) this.hurt(b, d);
    }
  }

  private hurt(b: ArenaBody, d: Drop): void {
    const s = this.shields[b.p];
    this.kit.knock(b, d.x, d.y, 260, 0.35);
    b.invuln = 1.3;
    if (s) {
      s.destroy();
      this.shields[b.p] = undefined;
      Audio.sfx('freeze', 1.2);
      Vfx.hit(this, b.x, b.y - 22, [0x9fe3ff, 0xffffff]);
      Vfx.popText(this, b.x, b.y - 50, 'กันได้!', '#9fe3ff', 16, this.angleFor(b.p));
      return;
    }
    this.hearts[b.p]--;
    this.lastHit[b.p] = this.elapsed;
    b.stun = 0.55;
    Audio.sfx('hit', 1 + b.p * 0.1);
    Vfx.hit(this, b.x, b.y - 22);
    Vfx.hitFlash(this, b.avatar.sprite);
    burst(this, b.x, b.y - 40, { tex: 'heart', count: 3, speed: [40, 90], angle: [230, 310], gravity: 200, life: 600, scale: [S, S * 0.5] });
    Vfx.popText(this, b.x, b.y - 54, '−♥', '#ff7a85', 20, this.angleFor(b.p));
    if (this.hearts[b.p] <= 0) {
      this.kit.kill(b);
      b.avatar.play('lose', true);
      b.avatar.ring?.setVisible(false);
      this.tweens.add({ targets: [b.avatar.sprite, b.avatar.marker], alpha: 0.25, duration: 600 });
      Vfx.popText(this, b.x, b.y - 80, 'ออก!', toCss(PLAYER_COLORS[b.p].light), 22, this.angleFor(b.p));
      this.eliminate(b.p);
    }
    this.refresh();
  }

  private pushOutRect(b: ArenaBody, d: Drop): void {
    const hw = d.w / 2 + b.r - 4, hh = d.h / 2 + b.r * 0.6 - 2;
    const dx = b.x - d.x, dy = b.y - d.y;
    if (Math.abs(dx) >= hw || Math.abs(dy) >= hh) return;
    const ox = hw - Math.abs(dx), oy = hh - Math.abs(dy);
    if (ox < oy) { b.x += Math.sign(dx || 1) * ox; b.vx *= -0.3; } else { b.y += Math.sign(dy || 1) * oy; b.vy *= -0.3; }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    // now and then a CPU gets distracted and reacts late
    b.data.daze -= dt;
    if (b.data.daze < -3 && Math.random() < dt * 0.25 * (1.2 - b.data.skill)) b.data.daze = 1.2;
    // threat = the soonest pending drop whose footprint covers me (as I perceive it)
    let threat: Drop | undefined;
    let soon = 99;
    for (const d of this.drops) {
      if (d.landed) continue;
      const left = d.warn - d.t;
      const visible = d.t > 0.2 + (1 - b.data.skill) * 0.6 + (b.data.daze > 0 ? 0.5 : 0);
      if (!visible) continue;
      if (Math.abs(b.x - d.x) < d.w / 2 + 16 && Math.abs(b.y - d.y) < d.h / 2 + 16 && left < soon) { threat = d; soon = left; }
    }
    if (threat) {
      // escape along the shortest axis, toward the open side
      const d = threat;
      const ex = (d.w / 2 + 26) - Math.abs(b.x - d.x), ey = (d.h / 2 + 26) - Math.abs(b.y - d.y);
      let tx = b.x, ty = b.y;
      if (ex < ey) tx = d.x + Math.sign(b.x - d.x || (b.x < this.vw / 2 ? 1 : -1)) * (d.w / 2 + 28);
      else ty = d.y + Math.sign(b.y - d.y || (b.y < this.vh / 2 ? 1 : -1)) * (d.h / 2 + 28);
      if (tx < this.bounds.x + 14 || tx > this.bounds.right - 14) { tx = b.x; ty = d.y + Math.sign(b.y - d.y || 1) * (d.h / 2 + 28); }
      if (ty < this.bounds.y + 14 || ty > this.bounds.bottom - 14) { ty = b.y; tx = d.x + Math.sign(b.x - d.x || 1) * (d.w / 2 + 28); }
      b.botTarget = { x: tx, y: ty };
      if (soon < 0.4 && b.dashCd <= 0 && Math.random() < b.data.skill * 0.25) {
        b.ix = Math.sign(tx - b.x); b.iy = Math.sign(ty - b.y);
        b.botDash = true;
      }
      return;
    }
    // no threat: go for a shield, else wander to open floor
    const pk = this.pickups[0];
    if (pk && !this.shields[b.p]) { b.botTarget = { x: pk.x, y: pk.y }; return; }
    b.data.react -= dt;
    if (b.data.react <= 0 || !b.botTarget) {
      b.data.react = 0.8 + Math.random() * 1.2;
      b.botTarget = { x: this.bounds.centerX + (Math.random() - 0.5) * this.bounds.width * 0.7, y: this.bounds.centerY + (Math.random() - 0.5) * this.bounds.height * 0.7 };
    }
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => {
      const i = this.eliminated.indexOf(p);
      if (i !== -1) return i * 10;
      return 1000 + this.hearts[p] * 100 + (this.shields[p] ? 50 : 0) + this.grabs[p] + (100 - this.lastHit[p]) / 1000;
    };
    return rankBy(this.players, value).map((r) => ({ ...r, score: this.hearts[r.player] }));
  }
}

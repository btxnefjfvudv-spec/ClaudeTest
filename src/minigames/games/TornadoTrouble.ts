import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { TouchButton } from '../../ui/Controls';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const CORE_R = 26;
const STAM_MAX = 100;

type DebrisKind = 0 | 1 | 2 | 3 | 4;
interface Debris {
  kind: DebrisKind;
  x: number; y: number; z: number;
  vx: number; vy: number;
  mode: 'ground' | 'orbit' | 'fly';
  orbitA: number; orbitR: number; orbitT: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  spin: number;
}
interface Star { x: number; y: number; img: Phaser.GameObjects.Sprite; t: number }
interface Grip { btn?: TouchButton; icon?: Phaser.GameObjects.Image; bar: Phaser.GameObjects.Rectangle; barBg: Phaser.GameObjects.Rectangle; holding: boolean; stam: number; tired: number; regenWait: number }

/** #8 — A tornado roams the schoolyard. Run, hold on, and don't get sucked in. */
export default class TornadoTrouble extends BaseMinigame {
  private kit!: ArenaKit;
  private tx = 0;
  private ty = 0;
  private wx = 0;
  private wy = 0;
  private funnel!: Phaser.GameObjects.Sprite;
  private funnelShadow!: Phaser.GameObjects.Image;
  private dustRing!: Phaser.GameObjects.Image;
  private debris: Debris[] = [];
  private stars: Star[] = [];
  private grips: Grip[] = [];
  private coins = [0, 0, 0, 0];
  private spun = new Set<PlayerIndex>();
  private trees: Phaser.GameObjects.Image[] = [];
  private tufts: Phaser.GameObjects.Image[] = [];
  private streaks: Phaser.GameObjects.Image[] = [];
  private debrisT = 0;
  private starT = 0;
  private bounds!: Phaser.Geom.Rectangle;
  private t = 0;
  private howl = 0;
  private stage = 0;

  constructor() {
    super(CATALOG['tornado-trouble']);
  }

  /** Pull reach and strength grow over the round. */
  private get reach(): number { return 190 + Math.min(130, this.elapsed * 2.2); }
  private get power(): number { return 100 + Math.min(165, this.elapsed * 2.7); }

  setup(): void {
    this.debris = [];
    this.stars = [];
    this.grips = [];
    this.coins = [0, 0, 0, 0];
    this.spun = new Set();
    this.trees = [];
    this.tufts = [];
    this.streaks = [];
    this.debrisT = 0.5;
    this.starT = 1;
    this.t = 0;
    this.howl = 0;
    this.stage = 0;
    this.bounds = new Phaser.Geom.Rectangle(34, 72, this.vw - 68, this.vh - 104);
    this.tx = this.vw / 2;
    this.ty = this.vh / 2;
    this.pickWaypoint();
    this.paintArt();
    this.buildYard();
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 900, radius: 12, dash: false, bounce: 0.7, bounds: this.bounds,
      spawn: (p) => ({ x: p % 2 === 0 ? this.bounds.x + 70 : this.bounds.right - 70, y: p < 2 ? this.bounds.y + 50 : this.bounds.bottom - 50 }),
    });
    for (const b of this.kit.bodies) {
      b.data.skill = 0.5 + Math.random() * 0.45;
      b.data.think = 0;
      b.data.gx = b.x; b.data.gy = b.y;
      const barBg = this.add.rectangle(b.x, b.y, 30, 5, 0x14172e, 0.85).setDepth(2100);
      const bar = this.add.rectangle(b.x, b.y, 28, 3, 0x7ee8b0).setDepth(2101);
      const g: Grip = { bar, barBg, holding: false, stam: STAM_MAX, tired: 0, regenWait: 0 };
      if (!this.isCpu(b.p)) {
        g.btn = new TouchButton(this, this.touch, b.p, 0.82, 0.74, undefined, 17);
        g.icon = this.add.image(g.btn.x, g.btn.y, 'tornado-trouble-anchor').setScale(S * 1.3).setDepth(902).setAngle(this.angleFor(b.p));
        b.stick?.exclude.push(g.btn);
      }
      this.grips[b.p] = g;
    }
    this.funnelShadow = this.add.image(this.tx, this.ty, 'shadow').setScale(S * 3.4, S * 2.6).setAlpha(0.3);
    this.dustRing = this.add.image(this.tx, this.ty, 'tornado-trouble-dust').setScale(S);
    this.funnel = this.add.sprite(this.tx, this.ty, 'tornado-trouble-funnel', 0).setOrigin(0.5, 0.96).setScale(S);
    this.funnel.play('tornado-trouble-spin');
    for (let i = 0; i < 7; i++) this.addDebris(true);
    this.refresh();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    makeTexture(this, `tornado-trouble-yard-${aw}`, aw, ah, (p) => {
      const r = rng(19);
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const stripe = Math.floor((x + y * 0.3) / 14) % 2;
        p.px(x, y, stripe ? 0x7cc46a : 0x72b962);
      }
      for (let i = 0; i < aw * ah * 0.05; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), r() > 0.5 ? 0x8fd27a : 0x63a856);
      // running track oval
      const cx = aw / 2, cy = ah / 2;
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const dx = Math.max(0, Math.abs(x + 0.5 - cx) - 70), dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        if (d > 76 && d < 92) {
          let c = 0xd9604a;
          if (Math.abs(d - 84) < 0.6 || Math.abs(d - 80) < 0.5 || Math.abs(d - 88) < 0.5) c = 0xfff1e8;
          if (d < 77.2 || d > 90.8) c = 0xb94a3a;
          p.px(x, y, c);
        }
      }
      // basketball court inside the oval (half lines)
      p.rect(cx - 60, cy - 36, 120, 72, 0x5fa0c8);
      p.rect(cx - 58, cy - 34, 116, 68, 0x6ab0d8);
      p.vline(cx, cy - 34, 68, 0xffffff);
      p.ring(cx, cy, 12, 0xffffff, 1);
      for (const sx of [-1, 1]) { p.ring(cx + sx * 58, cy, 22, 0xffffff, 1); p.rect(cx + sx * 58 - (sx > 0 ? 14 : 0), cy - 8, 14, 16, 0xe07a5a); }
      p.rect(cx - 60, cy - 37, 120, 1, 0xffffff); p.rect(cx - 60, cy + 36, 120, 1, 0xffffff);
      // path / paving at the edges
      for (let x = 0; x < aw; x += 10) for (const y of [2, ah - 12]) { p.box(x, y, 10, 10, 0xd8d0c0); p.px(x + 3, y + 4, 0xc0b8a8); }
      for (let y = 12; y < ah - 12; y += 10) for (const x of [2, aw - 12]) { p.box(x, y, 10, 10, 0xd8d0c0); }
      // flowers
      for (let i = 0; i < 40; i++) { const x = 16 + r() * (aw - 32), y = 16 + r() * (ah - 32); p.px(x, y, [0xffffff, 0xffe066, 0xff7a85][i % 3]); }
    });
    makeSheet(this, 'tornado-trouble-funnel', 44, 84, 4, (p, f) => {
      for (let y = 0; y < 84; y++) {
        const k = 1 - y / 84;
        const half = 4 + Math.pow(k, 1.3) * 18 + Math.sin(y * 0.18 + f * 1.6) * 1.5;
        const cx = 22 + Math.sin(y * 0.07 + f * 0.8) * 2.5 * k;
        for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
          const u = (x - cx) / half;
          if (Math.abs(u) > 1) continue;
          const band = Math.sin(y * 0.5 - u * 3 + f * Math.PI / 2);
          let c = band > 0.3 ? 0xc9cfe0 : band > -0.3 ? 0xa8b0c8 : 0x8a92ae;
          if (u < -0.55) c = shift(c, 0.25);
          if (u > 0.6) c = shift(c, -0.3);
          const a = Math.abs(u) > 0.85 ? 190 : 250;
          p.px(x, y, c, a);
        }
      }
      // flying bits in the swirl
      for (let i = 0; i < 6; i++) {
        const y = (i * 13 + f * 5) % 80;
        const k = 1 - y / 84;
        const x = 22 + Math.cos(i * 2 + f) * (4 + k * 17);
        p.px(x, y, i % 2 ? 0x6b8e4e : 0x8a5530);
      }
    });
    if (!this.anims.exists('tornado-trouble-spin')) {
      this.anims.create({ key: 'tornado-trouble-spin', frames: this.anims.generateFrameNumbers('tornado-trouble-funnel', {}), frameRate: 14, repeat: -1 });
    }
    makeTexture(this, 'tornado-trouble-dust', 64, 28, (p) => {
      const r = rng(4);
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2, d = 18 + r() * 12;
        p.ellipse(32 + Math.cos(a) * d, 14 + Math.sin(a) * d * 0.4, 4 + r() * 3, 2 + r() * 2, r() > 0.5 ? 0xd9c8a8 : 0xc0ad8a, 200);
      }
    });
    makeTexture(this, 'tornado-trouble-tree', 36, 34, (p) => {
      p.ellipse(18, 30, 15, 4, 0x3a6a32, 120);
      const r = rng(6);
      for (let i = 0; i < 9; i++) p.ball(8 + r() * 20, 8 + r() * 16, 7 + r() * 3, 6 + r() * 3, i % 2 ? 0x4a9a4e : 0x58b05a, false);
      p.ball(14, 10, 6, 5, 0x6cc46a, false);
      p.outline(-0.7);
    });
    makeTexture(this, 'tornado-trouble-tuft', 7, 6, (p) => {
      p.line(1, 5, 0, 1, 0x4a9a4e); p.line(3, 5, 3, 0, 0x5aa858); p.line(5, 5, 6, 2, 0x4a9a4e);
    });
    makeTexture(this, 'tornado-trouble-streak', 24, 2, (p) => { for (let x = 0; x < 24; x++) p.px(x, x % 7 === 0 ? 1 : 0, 0xffffff, Math.round(Math.sin((x / 24) * Math.PI) * 200)); });
    // debris: leaf pile, trash can, ball, book, chair
    makeTexture(this, 'tornado-trouble-deb-0', 12, 10, (p) => { p.ball(6, 6, 5.5, 3.5, 0xd98a3a, false); p.px(3, 4, 0xffc93d); p.px(8, 5, 0xb3561a); p.px(6, 3, 0xe8a84a); p.outline(-0.7); });
    makeTexture(this, 'tornado-trouble-deb-1', 12, 14, (p) => { p.box(2, 3, 8, 10, 0x8f98a8); p.rect(1, 1, 10, 3, 0x5d6584); p.vline(4, 5, 7, 0x6a7494); p.vline(7, 5, 7, 0x6a7494); p.outline(-0.7); });
    makeTexture(this, 'tornado-trouble-deb-2', 10, 10, (p) => { p.ball(5, 5, 4.5, 4.5, 0xff9f43); p.vline(5, 1, 8, 0x8a4a1a); p.hline(1, 5, 8, 0x8a4a1a); p.outline(-0.7); });
    makeTexture(this, 'tornado-trouble-deb-3', 12, 9, (p) => { p.box(0, 0, 12, 9, 0x3d9bff); p.rect(0, 0, 2, 9, 0x1d5bb3); p.vline(11, 1, 7, 0xfff8e7); p.outline(-0.7); });
    makeTexture(this, 'tornado-trouble-deb-4', 14, 14, (p) => { p.box(2, 4, 10, 8, 0xc0834a); p.box(1, 0, 12, 4, 0x8a5530); p.rect(2, 12, 2, 2, 0x5d6584); p.rect(10, 12, 2, 2, 0x5d6584); p.outline(-0.7); });
    makeSheet(this, 'tornado-trouble-star', 11, 11, 4, (p, i) => {
      const w = [5, 3.5, 1.5, 3.5][i];
      p.stamp(0, 0, ['.....a.....', '....aba....', '....aba....', 'aaaabbbaaaa', '.abbbbbbba.', '..abbbbba..', '..abbabba..', '.abba.abba.', '.aa.....aa.', '...........', '...........'].map((row) => {
        if (w >= 5) return row;
        const c = 5, out: string[] = [];
        for (let x = 0; x < 11; x++) { const sx = Math.round(c + (x - c) * (5 / w)); out.push(sx >= 0 && sx < 11 && Math.abs(x - c) <= w ? row[sx] : '.'); }
        return out.join('');
      }), { a: 0xb3861a, b: 0xffe066 });
    });
    if (!this.anims.exists('tornado-trouble-star-spin')) {
      this.anims.create({ key: 'tornado-trouble-star-spin', frames: this.anims.generateFrameNumbers('tornado-trouble-star', {}), frameRate: 8, repeat: -1 });
    }
    makeTexture(this, 'tornado-trouble-anchor', 9, 9, (p) => p.stamp(0, 0, ['...aaa...', '...a.a...', '...aaa...', 'aaaaaaaaa', '....a....', 'a...a...a', 'aa..a..aa', '.aaaaaaa.', '..aaaaa..'], { a: 0xffffff }));
    makeTexture(this, 'tornado-trouble-grip', 22, 10, (p) => {
      p.ring(11, 5, 4.5, 0xffffff, 1);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.px(11 + Math.cos(a) * 9, 5 + Math.sin(a) * 4, 0xffffff); }
    });
  }

  private buildYard(): void {
    const aw = Math.ceil(this.vw / S);
    this.add.image(0, 0, `tornado-trouble-yard-${aw}`).setOrigin(0).setScale(S).setDepth(-200);
    const r = rng(33);
    for (let i = 0; i < 46; i++) {
      const tf = this.add.image(30 + r() * (this.vw - 60), 30 + r() * (this.vh - 60), 'tornado-trouble-tuft').setOrigin(0.5, 1).setScale(S).setDepth(-150);
      this.tufts.push(tf);
    }
    const treePos: [number, number][] = [[20, 60], [20, this.vh / 2 + 40], [this.vw - 20, 120], [this.vw - 20, this.vh - 110], [this.vw / 2 - 160, 14], [this.vw / 2 + 170, this.vh - 10], [this.vw / 2 + 110, 12], [this.vw / 2 - 120, this.vh - 12]];
    for (const [x, y] of treePos) {
      const t = this.add.image(x, y, 'tornado-trouble-tree').setOrigin(0.5, 0.85).setScale(S).setDepth(y + 300);
      t.setData('ph', r() * 6);
      this.trees.push(t);
    }
    for (let i = 0; i < 12; i++) {
      const s = this.add.image(0, 0, 'tornado-trouble-streak').setScale(S).setDepth(1800).setAlpha(0);
      s.setData('a', r() * Math.PI * 2).setData('r', 40 + r() * 160).setData('z', r() * 50);
      this.streaks.push(s);
    }
  }

  private refresh(): void {
    for (const p of this.players) {
      this.score[p] = this.coins[p];
      this.hudText[p] = this.alive(p) ? `★ ${this.coins[p]}` : `OUT ★${this.coins[p]}`;
    }
  }

  // ───────────────────────────── TORNADO ─────────────────────────────

  private pickWaypoint(): void {
    const b = this.bounds ?? new Phaser.Geom.Rectangle(34, 40, this.vw - 68, this.vh - 80);
    // Head toward the busiest area sometimes, otherwise wander.
    if (this.kit && Math.random() < 0.3 && this.kit.alive.length) {
      const v = this.kit.alive[Math.floor(Math.random() * this.kit.alive.length)];
      this.wx = (v.x + this.tx) / 2; this.wy = (v.y + this.ty) / 2;
    } else {
      this.wx = b.x + 60 + Math.random() * (b.width - 120);
      this.wy = b.y + 50 + Math.random() * (b.height - 100);
    }
  }

  private addDebris(initial = false): void {
    const kind = Math.floor(Math.random() * 5) as DebrisKind;
    const b = this.bounds;
    let x = 0, y = 0;
    for (let k = 0; k < 10; k++) {
      x = b.x + 20 + Math.random() * (b.width - 40);
      y = b.y + 20 + Math.random() * (b.height - 40);
      if (Math.hypot(x - this.tx, y - this.ty) > 120) break;
    }
    const shadow = this.add.image(x, y, 'shadow').setScale(S * 0.5).setAlpha(0.25);
    const img = this.add.image(x, y, `tornado-trouble-deb-${kind}`).setScale(S).setDepth(y);
    if (!initial) this.tweens.add({ targets: img, scale: { from: 0, to: S }, duration: 250 });
    this.debris.push({ kind, x, y, z: 0, vx: 0, vy: 0, mode: 'ground', orbitA: 0, orbitR: 0, orbitT: 0, img, shadow, spin: 0 });
  }

  private pull(x: number, y: number): { x: number; y: number; m: number } {
    const dx = this.tx - x, dy = this.ty - y;
    const d = Math.hypot(dx, dy) || 1;
    const R = this.reach;
    if (d > R) return { x: 0, y: 0, m: 0 };
    const k = Math.pow(1 - d / R, 1.4) * this.power + (d < 70 ? 40 : 0);
    const nx = dx / d, ny = dy / d;
    // inward pull with a counter-clockwise swirl
    return { x: (nx * 0.88 - ny * 0.45) * k, y: (ny * 0.88 + nx * 0.45) * k, m: k };
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    const playing = this.state === 'play';
    this.kit.update(dt, playing);
    // tornado drifts toward its waypoint
    const spd = 38 + Math.min(42, this.elapsed * 0.8);
    const dx = this.wx - this.tx, dy = this.wy - this.ty;
    const d = Math.hypot(dx, dy);
    const sp = playing ? spd : 16;
    if (d < 12) this.pickWaypoint();
    else { this.tx += (dx / d) * sp * dt + Math.sin(this.t * 2.3) * 12 * dt; this.ty += (dy / d) * sp * dt + Math.cos(this.t * 1.9) * 10 * dt; }
    const grow = 1.3 + Math.min(0.35, this.elapsed / 130);
    this.funnel.setPosition(this.tx, this.ty).setDepth(this.ty + 4).setScale(S * grow, S * grow);
    this.funnel.setAngle(Math.sin(this.t * 1.7) * 4);
    this.funnelShadow.setPosition(this.tx, this.ty + 2).setDepth(-120).setScale(S * 3.4 * grow, S * 2.2 * grow);
    this.dustRing.setPosition(this.tx, this.ty).setDepth(this.ty + 5).setRotation(0).setScale(S * grow * (1 + Math.sin(this.t * 8) * 0.05), S * grow).setAlpha(0.85);
    this.dustRing.setFlipX(Math.floor(this.t * 8) % 2 === 0);
    if (Math.random() < dt * 25) burst(this, this.tx + (Math.random() - 0.5) * 50, this.ty, { tex: 'dust', count: 1, tint: [0xd9c8a8, 0xc0ad8a], speed: [30, 80], angle: [180, 360], life: 500, scale: [S, 0], depth: this.ty + 6 });
    // wind affects the scenery
    for (const tf of this.tufts) {
      const w = this.pull(tf.x, tf.y);
      tf.setAngle(Phaser.Math.Clamp(w.x * 0.25, -40, 40) + Math.sin(this.t * 3 + tf.x) * 4);
    }
    for (const tr of this.trees) {
      const w = this.pull(tr.x, tr.y);
      tr.setAngle(Math.sin(this.t * 2 + (tr.getData('ph') as number)) * (2 + w.m * 0.04) + Phaser.Math.Clamp(w.x * 0.05, -8, 8));
    }
    for (const s of this.streaks) {
      let a = s.getData('a') as number;
      const r = s.getData('r') as number;
      a += dt * (220 / r);
      s.setData('a', a);
      s.setPosition(this.tx + Math.cos(a) * r, this.ty + Math.sin(a) * r * 0.55 - (s.getData('z') as number));
      s.setRotation(a + Math.PI / 2);
      s.setAlpha((0.15 + 0.35 * (1 - r / 200)) * (0.5 + 0.5 * Math.sin(this.t * 3 + r)));
    }
    // grip UI
    for (const b of this.kit.bodies) {
      const g = this.grips[b.p];
      if (!g) continue;
      const top = this.angleFor(b.p) === 180;
      const yy = b.y + 12;
      g.barBg.setPosition(b.x, yy).setVisible(b.alive);
      g.bar.setPosition(b.x - 14, yy).setOrigin(0, 0.5).setVisible(b.alive);
      g.bar.width = 28 * (g.stam / STAM_MAX);
      g.bar.setFillStyle(g.tired > 0 ? 0xff5a5a : g.holding ? 0xffe066 : 0x7ee8b0);
      if (top) g.bar.setPosition(b.x + 14, yy).setOrigin(1, 0.5);
      if (g.icon && g.btn) g.icon.setAlpha(g.tired > 0 ? 0.4 : 1);
    }
    for (const st of this.stars) st.img.setPosition(st.x, st.y - 8 + Math.sin(this.t * 5 + st.x) * 2).setDepth(st.y);
    this.syncDebris(dt);
  }

  tick(dt: number): void {
    this.howl -= dt;
    if (this.howl <= 0) { Audio.sfx('whoosh', 0.5 + Math.random() * 0.2); this.howl = 0.9 + Math.random() * 0.6; }
    const st = this.elapsed > 40 ? 2 : this.elapsed > 20 ? 1 : 0;
    if (st > this.stage) {
      this.stage = st;
      Audio.sfx('explode', 0.6);
      Vfx.shake(this, 0.006, 300);
      for (const [deg, y] of [[0, this.vh * 0.64], [180, this.vh * 0.36]] as const) {
        const t = txt(this, this.vw / 2, y, st === 1 ? 'พายุแรงขึ้น!' : 'พายุยักษ์!!', { size: 30, color: '#ffe066', strokeWidth: 6 }).setAngle(deg).setDepth(3000);
        this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        this.tweens.add({ targets: t, alpha: 0, delay: 1000, duration: 300, onComplete: () => t.destroy() });
      }
    }
    for (const b of this.kit.alive) {
      const g = this.grips[b.p];
      if (this.isCpu(b.p)) this.bot(b, g, dt);
      else g.holding = !!g.btn?.isDown;
      this.updateGrip(b, g, dt);
      const w = this.pull(b.x, b.y);
      const k = g.holding ? 0.1 : b.stun > 0 ? 1.25 : 1;
      b.x += w.x * k * dt;
      b.y += w.y * k * dt;
      if (Math.hypot(b.x - this.tx, b.y - this.ty) < CORE_R) this.suck(b);
    }
    // debris & stars
    this.debrisT -= dt;
    if (this.debrisT <= 0) { this.debrisT = Math.max(0.45, 1.4 - this.elapsed * 0.016); if (this.debris.length < 20) this.addDebris(); }
    this.starT -= dt;
    if (this.starT <= 0) {
      this.starT = 1.3 + Math.random();
      if (this.stars.length < 6) {
        const b = this.bounds;
        const x = b.x + 20 + Math.random() * (b.width - 40), y = b.y + 20 + Math.random() * (b.height - 40);
        const img = this.add.sprite(x, y, 'tornado-trouble-star', 0).setScale(S);
        img.play('tornado-trouble-star-spin');
        this.tweens.add({ targets: img, scale: { from: 0, to: S }, duration: 250, ease: 'Back.easeOut' });
        this.stars.push({ x, y, img, t: 10 });
      }
    }
    this.stepDebris(dt);
    this.stepStars(dt);
    this.refresh();
  }

  private updateGrip(b: ArenaBody, g: Grip, dt: number): void {
    g.tired = Math.max(0, g.tired - dt);
    if (g.tired > 0 || b.stun > 0) g.holding = false;
    if (g.holding) {
      g.stam -= 36 * dt;
      g.regenWait = 0.45;
      b.speedMul = 0.25;
      b.avatar.play('sit');
      if (Math.random() < dt * 8) burst(this, b.x + (Math.random() - 0.5) * 16, b.y, { tex: 'dot2', count: 1, tint: [0x5aa858, 0x8a5530], speed: [20, 50], angle: [200, 340], gravity: 200, life: 300 });
      if (g.stam <= 0) {
        g.stam = 0;
        g.tired = 1.1;
        g.holding = false;
        Audio.sfx('wrong', 1 + b.p * 0.05);
        Vfx.popText(this, b.x, b.y - 60, 'หมดแรง!', '#ff7a85', 15, this.angleFor(b.p));
      }
    } else {
      b.speedMul = 1;
      g.regenWait -= dt;
      if (g.regenWait <= 0) g.stam = Math.min(STAM_MAX, g.stam + 24 * dt);
    }
    if (b.avatar.ring) b.avatar.ring.setScale(S * 0.75 * (g.holding ? 1.3 : 1));
  }

  private suck(b: ArenaBody): void {
    this.kit.kill(b);
    this.spun.add(b.p);
    const g = this.grips[b.p];
    g.bar.setVisible(false); g.barBg.setVisible(false);
    const av = b.avatar;
    av.play('stun', true);
    av.ring?.setVisible(false);
    av.shadow?.setVisible(false);
    av.marker?.setVisible(false);
    Audio.sfx('whoosh', 1.3);
    Audio.sfx('stun');
    Vfx.popText(this, this.tx, this.ty - 110, 'ถูกดูด!!', toCss(PLAYER_COLORS[b.p].light), 20, this.angleFor(b.p));
    // spin up the funnel, then get flung far away
    const start = this.t;
    const ex = this.tx, ey = this.ty;
    const ev = this.time.addEvent({ delay: 16, loop: true, callback: () => {
      const k = Math.min(1, (this.t - start) / 1.1);
      const a = (this.t - start) * 14;
      av.sprite.setPosition(this.tx + Math.cos(a) * (14 + k * 10), this.ty - 20 - k * 120 + Math.sin(a) * 6).setAngle(a * 60).setDepth(this.ty + (Math.sin(a) > 0 ? 6 : 2));
      if (k >= 1) {
        ev.remove();
        const out = Math.atan2(ey - this.vh / 2, ex - this.vw / 2) + (Math.random() - 0.5);
        Audio.sfx('throw', 0.7);
        this.tweens.add({ targets: av.sprite, x: ex + Math.cos(out) * 700, y: ey + Math.sin(out) * 500 - 200, angle: 1440, scale: S * 0.4, duration: 900, ease: 'Quad.easeIn' });
      }
    } });
    this.eliminate(b.p);
    this.refresh();
  }

  private stepDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (d.mode === 'ground') {
        const w = this.pull(d.x, d.y);
        d.x += w.x * 1.2 * dt; d.y += w.y * 1.2 * dt;
        if (w.m > 30) d.spin += dt * 4;
        if (Math.hypot(d.x - this.tx, d.y - this.ty) < 48) {
          d.mode = 'orbit';
          d.orbitA = Math.atan2(d.y - this.ty, d.x - this.tx);
          d.orbitR = 34 + Math.random() * 24;
          d.orbitT = 0.8 + Math.random() * 1.4;
          Audio.sfx('whoosh', 1.5);
        }
      } else if (d.mode === 'orbit') {
        d.orbitT -= dt;
        d.orbitA += dt * 5;
        d.z = Math.min(70, d.z + dt * 60);
        d.x = this.tx + Math.cos(d.orbitA) * d.orbitR;
        d.y = this.ty + Math.sin(d.orbitA) * d.orbitR * 0.5;
        d.spin += dt * 10;
        if (d.orbitT <= 0) {
          // fling it out along the swirl
          const tx = -Math.sin(d.orbitA), ty = Math.cos(d.orbitA);
          const ox = Math.cos(d.orbitA), oy = Math.sin(d.orbitA);
          const v = 250 + Math.random() * 90;
          d.vx = (tx * 0.6 + ox * 0.8) * v;
          d.vy = (ty * 0.6 + oy * 0.8) * v;
          d.mode = 'fly';
          d.z = 22;
          Audio.sfx('throw', 0.9);
        }
      } else {
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.spin += dt * 14;
        for (const b of this.kit.alive) {
          if (b.invuln > 0 || Math.hypot(b.x - d.x, b.y - d.y) > 20) continue;
          this.kit.knock(b, d.x - d.vx * 0.1, d.y - d.vy * 0.1, 200, 0.9);
          b.invuln = 1.0;
          this.grips[b.p].holding = false;
          Audio.sfx('hit', 1 + b.p * 0.1);
          Audio.sfx('stun', 1.1);
          Vfx.hit(this, b.x, b.y - 24);
          Vfx.hitFlash(this, b.avatar.sprite);
          Vfx.popText(this, b.x, b.y - 58, 'มึน!', '#ffffff', 15, this.angleFor(b.p));
          d.vx *= -0.3; d.vy *= -0.3;
        }
        const B = this.bounds;
        if (d.x < B.x - 60 || d.x > B.right + 60 || d.y < B.y - 60 || d.y > B.bottom + 60) {
          d.img.destroy(); d.shadow.destroy();
          this.debris.splice(i, 1);
        }
      }
    }
  }

  private syncDebris(_dt: number): void {
    for (const d of this.debris) {
      d.img.setPosition(d.x, d.y - d.z).setRotation(d.spin).setDepth(d.y + (d.mode === 'orbit' && Math.sin(d.orbitA) < 0 ? -8 : 8));
      d.shadow.setPosition(d.x, d.y + 4).setDepth(d.y - 900).setAlpha(Math.max(0.08, 0.25 - d.z / 400));
    }
  }

  private stepStars(dt: number): void {
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      s.t -= dt;
      const w = this.pull(s.x, s.y);
      s.x += w.x * 0.9 * dt; s.y += w.y * 0.9 * dt;
      let gone = false;
      const b = this.kit.alive.find((o) => Math.hypot(o.x - s.x, o.y - s.y) < 22);
      if (b) {
        this.coins[b.p]++;
        this.addScore(b.p, 0);
        Audio.sfx('coin', 1 + b.p * 0.1);
        Vfx.coinPop(this, s.x, s.y - 10);
        Vfx.popText(this, s.x, s.y - 36, '+1★', '#ffe066', 14, this.angleFor(b.p));
        gone = true;
      } else if (Math.hypot(s.x - this.tx, s.y - this.ty) < 30 || s.t <= 0) {
        burst(this, s.x, s.y, { tex: 'spark', count: 5, tint: 0xffe066, life: 300 });
        gone = true;
      }
      if (gone) { s.img.destroy(); this.stars.splice(i, 1); }
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: ArenaBody, g: Grip, dt: number): void {
    const dx = b.x - this.tx, dy = b.y - this.ty;
    const d = Math.hypot(dx, dy) || 1;
    const w = this.pull(b.x, b.y);
    const danger = w.m / 150;
    // hold on when the pull outruns our legs
    const want = danger > 0.62 - b.data.skill * 0.15;
    if (want && g.stam > (g.holding ? 6 : 28)) g.holding = true;
    else if (!want || g.stam < 6) g.holding = false;
    b.data.think -= dt;
    if (b.data.think > 0 && !want) { b.botTarget = { x: b.data.gx, y: b.data.gy }; return; }
    b.data.think = 0.2 + Math.random() * 0.6 * (1.2 - b.data.skill);
    // flee: sample directions, prefer open ground far from the core and away from walls/corners
    const B = this.bounds;
    let fx = dx / d, fy = dy / d, bestS = -1e9;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = b.x + Math.cos(a) * 90, py = b.y + Math.sin(a) * 90;
      const cx = Phaser.Math.Clamp(px, B.x + 10, B.right - 10), cy = Phaser.Math.Clamp(py, B.y + 10, B.bottom - 10);
      const wall = Math.min(cx - B.x, B.right - cx, cy - B.y, B.bottom - cy);
      // where the tornado is heading matters too
      const fxT = this.tx + (this.wx - this.tx) * 0.3, fyT = this.ty + (this.wy - this.ty) * 0.3;
      const sc = Math.hypot(cx - fxT, cy - fyT) + Math.min(60, wall) * 1.2 - Math.hypot(px - cx, py - cy) * 2;
      if (sc > bestS) { bestS = sc; fx = Math.cos(a); fy = Math.sin(a); }
    }
    // stars are tempting when safe
    let best: Star | undefined;
    let bd = 1e9;
    for (const s of this.stars) {
      const sd = Math.hypot(s.x - b.x, s.y - b.y);
      const sSafe = Math.hypot(s.x - this.tx, s.y - this.ty) > this.reach * (0.5 - b.data.skill * 0.15);
      if (sSafe && sd < bd) { bd = sd; best = s; }
    }
    let gx: number, gy: number;
    if (best && danger < 0.58) { gx = best.x; gy = best.y; }
    else { gx = b.x + fx * 80; gy = b.y + fy * 80; }
    // sidestep incoming debris
    for (const db of this.debris) {
      if (db.mode !== 'fly') continue;
      const rx = b.x - db.x, ry = b.y - db.y;
      const vl = Math.hypot(db.vx, db.vy) || 1;
      const along = (rx * db.vx + ry * db.vy) / vl;
      const perp = (rx * -db.vy + ry * db.vx) / vl;
      if (along > 0 && along < 140 && Math.abs(perp) < 30 && Math.random() < b.data.skill * 0.8) {
        gx = b.x + (-db.vy / vl) * Math.sign(perp || 1) * 70;
        gy = b.y + (db.vx / vl) * Math.sign(perp || 1) * 70;
        g.holding = false;
      }
    }
    b.data.gx = gx; b.data.gy = gy;
    b.botTarget = { x: gx, y: gy };
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => {
      const i = this.eliminated.indexOf(p);
      return i === -1 ? 10000 + this.coins[p] : i * 100 + this.coins[p];
    };
    return rankBy(this.players, value).map((r) => ({ ...r, score: this.coins[r.player] }));
  }
}

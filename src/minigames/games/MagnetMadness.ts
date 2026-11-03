import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'magnet-madness';
const M = 18;
const BASE_R = 44;
const PULL_R = 120;
const MAX_STUCK = 10;
const MAX_LOOSE = 22;

type Kind = 'bolt' | 'nut' | 'gear' | 'spring' | 'gold';
const VALUE: Record<Kind, number> = { bolt: 1, nut: 1, spring: 1, gear: 2, gold: 5 };

interface Scrap {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  spin: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  delay: number;
  alive: boolean;
}

interface Stuck { kind: Kind; img: Phaser.GameObjects.Image; a: number; r: number }

interface Mag {
  on: boolean;
  hold: number;
  cd: number;
  stuck: Stuck[];
  field: Phaser.GameObjects.Image[];
  depT: number;
  hum: number;
}

interface Drop { x: number; y: number; t: number; shadow: Phaser.GameObjects.Image; hook: Phaser.GameObjects.Image }

/** #44 — Hold to magnetise scrap onto yourself, release for a repulse blast, bank scrap at your base. */
export default class MagnetMadness extends BaseMinigame {
  private kit!: ArenaKit;
  private scrap: Scrap[] = [];
  private mags: Mag[] = [];
  private field!: Phaser.Geom.Rectangle;
  private bases: { p: PlayerIndex; x: number; y: number; bin: Phaser.GameObjects.Image; light: Phaser.GameObjects.Image }[] = [];
  private spawnT = 0;
  private dropT = 0;
  private drop?: Drop;
  private belts: Phaser.GameObjects.TileSprite[] = [];
  private lamps: Phaser.GameObjects.Image[] = [];
  private warned = false;

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.scrap = [];
    this.mags = [];
    this.bases = [];
    this.belts = [];
    this.lamps = [];
    this.spawnT = 0;
    this.dropT = 8;
    this.drop = undefined;
    this.warned = false;
    const W = this.vw, H = this.vh;
    this.field = new Phaser.Geom.Rectangle(M, 46, W - M * 2, H - M - 46);
    this.paintArt();
    this.paintYard();
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) this.makeBase(p);
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 800, radius: 13, dash: false, action: ID, bounce: 0.8, bounds: this.field,
      spawn: (p) => { const b = this.basePos(p); return { x: b.x + (p % 2 === 0 ? 30 : -30), y: b.y + (p < 2 ? 40 : -40) }; },
    });
    this.kit.onAction = (b, down) => this.setMagnet(b, down);
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      this.mags[p] = { on: false, hold: 0, cd: 0, stuck: [], field: [], depT: 0, hum: 0 };
    }
    for (const b of this.kit.bodies) {
      const m = this.mags[b.p];
      for (let i = 0; i < 3; i++) {
        m.field.push(this.add.image(b.x, b.y, `${ID}-wave`).setScale(S).setTint(PLAYER_COLORS[b.p].light).setVisible(false).setBlendMode(Phaser.BlendModes.ADD));
      }
      b.data.greed = 5 + Math.floor(Math.random() * 4);
      b.data.think = 0;
      b.data.tx = b.x;
      b.data.ty = b.y;
      b.data.aggro = 0.4 + Math.random() * 0.5;
      b.data.holdFor = 0;
    }
    const r = rng(3);
    for (let i = 0; i < 16; i++) {
      const s = this.randomSpot(r);
      this.spawnScrap(this.rollKind(r()), s.x, s.y);
    }
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    makeTexture(this, `icon-${ID}`, 9, 9, (p) => {
      p.stamp(0, 0, ['.aaaaaaa.', 'aaaaaaaaa', 'aaa...aaa', 'aaa...aaa', 'aaa...aaa', 'aaa...aaa', '.........', 'aaa...aaa', 'aaa...aaa'], { a: 0xffffff });
    });
    makeTexture(this, `${ID}-bolt`, 10, 6, (p) => {
      p.rect(0, 1, 3, 4, 0xa8b0c0); p.vline(0, 1, 4, 0xd8dbe4);
      p.rect(3, 2, 7, 2, 0x8f98a8); for (let x = 4; x < 10; x += 2) p.px(x, 3, 0x6a7282);
      p.hline(3, 2, 7, 0xc7ccd8);
      p.outline(-0.75);
    });
    makeTexture(this, `${ID}-nut`, 8, 8, (p) => {
      p.tri(1, 4, 4, 0, 7, 4, 0x9aa4b4); p.tri(1, 4, 4, 8, 7, 4, 0x7a8494); p.rect(1, 2, 6, 4, 0x8f98a8);
      p.circle(4, 4, 1.5, 0x3a3f4e); p.px(2, 2, 0xd8dbe4);
      p.outline(-0.75);
    });
    const gear = (c: number) => (p: import('../../art/Painter').Painter) => {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        p.rect(Math.round(5.5 + Math.cos(a) * 4.5) - 1, Math.round(5.5 + Math.sin(a) * 4.5) - 1, 2, 2, shift(c, -0.15));
      }
      p.ball(5.5, 5.5, 4, 4, c);
      p.circle(5.5, 5.5, 1.5, 0x2a2f3e);
      p.outline(-0.75);
    };
    makeTexture(this, `${ID}-gear`, 12, 12, gear(0xc9a26a));
    makeTexture(this, `${ID}-gold`, 12, 12, (p) => { gear(0xffc93d)(p); p.px(3, 3, 0xffffff); p.px(4, 2, 0xffffff); });
    makeTexture(this, `${ID}-spring`, 8, 10, (p) => {
      for (let y = 0; y < 10; y += 2) { p.hline(1, y, 6, 0x6ec6ff); p.px(0, y + 1, 0x3d7bb3); p.px(7, y + 1, 0x3d7bb3); }
      p.hline(2, 0, 4, 0xd8f0ff);
      p.outline(-0.75);
    });
    const WR = PULL_R / S;
    makeTexture(this, `${ID}-wave`, WR * 2 + 2, WR * 2 + 2, (p) => {
      for (let a = 0; a < Math.PI * 2; a += 0.006) {
        if (Math.floor(a * 9) % 3 === 2) continue;
        p.px(WR + 1 + Math.cos(a) * WR, WR + 1 + Math.sin(a) * WR, 0xffffff, 220);
        p.px(WR + 1 + Math.cos(a) * (WR - 1), WR + 1 + Math.sin(a) * (WR - 1), 0xffffff, 120);
      }
    });
    makeTexture(this, `${ID}-shock`, 48, 48, (p) => {
      p.ring(24, 24, 23.5, 0xffffff, 2);
      p.ring(24, 24, 21, 0xffffff, 1);
      for (let a = 0; a < Math.PI * 2; a += 0.3) p.px(24 + Math.cos(a) * 18, 24 + Math.sin(a) * 18, 0xffffff);
    });
    makeTexture(this, `${ID}-hook`, 22, 22, (p) => {
      p.rect(9, 0, 4, 6, 0x6a7282);
      p.ball(11, 13, 10, 8, 0x5a6070);
      p.ellipse(11, 12, 7, 5, 0x8f98a8);
      p.rect(3, 14, 4, 6, 0xff5a3d); p.rect(15, 14, 4, 6, 0x3d9bff);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-lamp`, 8, 8, (p) => { p.ball(4, 4, 3.5, 3.5, 0xffb020); p.px(3, 2, 0xffffff); p.outline(-0.8); });
    makeTexture(this, `${ID}-lampglow`, 32, 32, (p) => { for (let r = 16; r > 0; r -= 2) p.circle(16, 16, r, 0xffb020, Math.round(26 * (1 - r / 17))); });
    makeTexture(this, `${ID}-belt`, 16, 8, (p) => {
      p.rect(0, 0, 16, 8, 0x3a3f4e);
      p.hline(0, 0, 16, 0x5a6070); p.hline(0, 7, 16, 0x22252f);
      for (let x = 0; x < 16; x += 4) p.vline(x, 1, 6, 0x2a2e3a);
      p.px(2, 3, 0x6a7282);
    });
  }

  private basePos(p: PlayerIndex): { x: number; y: number } {
    return { x: p % 2 === 0 ? 140 : this.vw - 140, y: p < 2 ? M + 50 : this.vh - M - 42 };
  }

  private paintYard(): void {
    const W = this.vw, H = this.vh;
    const aw = Math.ceil(W / S), ah = Math.ceil(H / S);
    const key = makeTexture(this, `${ID}-yard-${aw}`, aw, ah, (p) => {
      const r = rng(21);
      // concrete slabs
      const slab = [0x5d6b6e, 0x627173, 0x58666a, 0x667577];
      for (let y = 0; y < ah; y += 24) for (let x = 0; x < aw; x += 32) {
        const c = slab[Math.floor(r() * slab.length)];
        p.rect(x, y, 32, 24, c);
        p.hline(x, y, 32, shift(c, 0.14));
        p.vline(x, y, 24, shift(c, 0.08));
        p.hline(x, y + 23, 32, shift(c, -0.3));
        p.vline(x + 31, y, 24, shift(c, -0.3));
        for (let i = 0; i < 30; i++) p.px(x + Math.floor(r() * 32), y + Math.floor(r() * 24), shift(c, r() < 0.5 ? -0.12 : 0.1));
        if (r() < 0.4) {
          let cx = x + 4 + Math.floor(r() * 24), cy = y + 3 + Math.floor(r() * 16);
          for (let k = 0; k < 6; k++) { const nx = cx + Math.floor(r() * 3) - 1 + 1, ny = cy + Math.floor(r() * 2) + 1; p.line(cx, cy, nx, ny, shift(c, -0.35)); cx = nx; cy = ny; }
        }
      }
      // oil puddles with a rainbow sheen
      for (let i = 0; i < 7; i++) {
        const x = 30 + r() * (aw - 60), y = 30 + r() * (ah - 60), rx = 5 + r() * 5, ry = 2.5 + r() * 2;
        p.ellipse(x, y, rx * 0.7, ry * 0.8, 0x434d56);
        p.ellipse(x - 1, y - 1, rx * 0.45, ry * 0.45, 0x4c5660);
        p.hline(Math.round(x - rx * 0.4), Math.round(y - 1), 3, 0x8455d6);
        p.hline(Math.round(x - rx * 0.1), Math.round(y - 1), 2, 0x3fe0e0);
      }
      // hazard border
      const m = M / S;
      for (let x = 0; x < aw; x += 1) for (let k = 0; k < 3; k++) {
        const c = Math.floor((x + k) / 4) % 2 ? 0xffc93d : 0x2a2e3a;
        p.px(x, m + 3 + k, c); p.px(x, ah - m - 1 - k, c);
      }
      for (let y = m; y < ah - m; y++) for (let k = 0; k < 3; k++) {
        const c = Math.floor((y + k) / 4) % 2 ? 0xffc93d : 0x2a2e3a;
        p.px(m - 1 - k + 2, y, c); p.px(aw - m - 1 + k - 1, y, c);
      }
      // outer wall: corrugated metal
      p.rect(0, 0, aw, m + 3, 0x3a4250); p.rect(0, ah - m + 2, aw, m, 0x3a4250);
      p.rect(0, 0, m - 1, ah, 0x3a4250); p.rect(aw - m + 1, 0, m, ah, 0x3a4250);
      for (let x = 0; x < aw; x += 3) { p.vline(x, 0, 4, 0x4a5262); p.vline(x, ah - 6, 6, 0x4a5262); }
      for (let y = 0; y < ah; y += 3) { p.hline(0, y, 6, 0x4a5262); p.hline(aw - 6, y, 6, 0x4a5262); }
      // scrap heaps & tyres & barrels in the corners (decor)
      const heap = (hx: number, hy: number) => {
        for (let i = 0; i < 24; i++) {
          const a = r() * Math.PI, d = r() * 11;
          const c = [0x8f98a8, 0xc9a26a, 0x6a7282, 0xb86a4a][Math.floor(r() * 4)];
          p.rect(Math.round(hx + Math.cos(a) * d * 1.3), Math.round(hy - Math.sin(a) * d * 0.7), 2 + Math.floor(r() * 3), 2, c);
        }
      };
      const tyre = (tx: number, ty: number) => { p.circle(tx, ty, 5, 0x22252f); p.circle(tx, ty, 2.5, 0x3a3f4e); p.px(tx - 3, ty - 3, 0x4a5060); };
      const barrel = (bx: number, by: number, c: number) => { p.circle(bx, by, 5, shift(c, -0.3)); p.circle(bx, by, 4, c); p.ring(bx, by, 3, shift(c, -0.4)); p.px(bx - 2, by - 2, shift(c, 0.5)); };
      heap(m + 14, ah / 2 - 10); heap(aw - m - 14, ah / 2 + 14);
      tyre(m + 10, ah / 2 + 18); tyre(m + 18, ah / 2 + 26); tyre(aw - m - 12, ah / 2 - 20);
      barrel(aw / 2 - 40, m + 14, 0x3d9bff); barrel(aw / 2 + 44, ah - m - 12, 0xff5a3d); barrel(aw / 2 + 52, ah - m - 14, 0x3ed17a);
      // centre drop pad
      const cx = aw / 2, cy = ah / 2 + 4;
      p.ellipse(cx, cy, 26, 16, 0x4a5660);
      for (let a = 0; a < Math.PI * 2; a += 0.04) {
        const c = Math.floor(a * 4) % 2 ? 0xffc93d : 0x2a2e3a;
        p.px(cx + Math.cos(a) * 25, cy + Math.sin(a) * 15, c);
        p.px(cx + Math.cos(a) * 24, cy + Math.sin(a) * 14.4, c);
      }
      p.rect(cx - 6, cy - 1, 12, 2, 0xffc93d); p.rect(cx - 1, cy - 5, 2, 10, 0xffc93d);
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
    // conveyor belts along the top and bottom wall
    for (const y of [5, H - 9]) {
      const belt = this.add.tileSprite(W / 2, y, (W - 260) / S, 8, `${ID}-belt`).setScale(S).setDepth(-90);
      this.belts.push(belt);
    }
    // blinking warning lamps
    for (const [x, y] of [[M + 2, H / 2 - 60], [W - M - 2, H / 2 + 60], [W / 2, 8], [W / 2, H - 8]]) {
      const glow = this.add.image(x, y, `${ID}-lampglow`).setScale(S * 1.6).setBlendMode(Phaser.BlendModes.ADD).setDepth(-80);
      this.add.image(x, y, `${ID}-lamp`).setScale(S).setDepth(-79);
      this.lamps.push(glow);
    }
  }

  private makeBase(p: PlayerIndex): void {
    const c = PLAYER_COLORS[p];
    const { x, y } = this.basePos(p);
    const padKey = makeTexture(this, `${ID}-pad-${p}`, 48, 30, (g) => {
      g.ellipse(24, 15, 24, 15, 0x2a2e3a);
      g.ellipse(24, 15, 22, 13, shift(c.main, -0.5));
      for (let a = 0; a < Math.PI * 2; a += 0.05) {
        const col = Math.floor(a * 5) % 2 ? c.main : 0x2a2e3a;
        g.px(24 + Math.cos(a) * 21, 15 + Math.sin(a) * 12, col);
        g.px(24 + Math.cos(a) * 20, 15 + Math.sin(a) * 11.4, col);
      }
      g.ellipse(24, 15, 14, 8, shift(c.main, -0.35));
      // arrow chevrons pointing in
      for (const dx of [-9, 9]) g.tri(24 + dx, 12, 24 + dx, 18, 24 + dx - Math.sign(dx) * 4, 15, c.light);
    });
    const binKey = makeTexture(this, `${ID}-bin-${p}`, 30, 24, (g) => {
      g.box(1, 6, 28, 18, shift(c.main, -0.25), 1);
      g.rect(1, 6, 28, 3, shift(c.main, -0.55));
      g.rect(0, 4, 30, 3, 0x8f98a8); g.hline(0, 4, 30, 0xd8dbe4);
      for (let i = 0; i < 6; i++) g.rect(3 + i * 4, 1 + (i % 2), 3, 4, [0x8f98a8, 0xc9a26a, 0x6ec6ff][i % 3]);
      for (let yy = 12; yy < 22; yy += 4) g.hline(4, yy, 22, shift(c.main, -0.45));
      g.rect(11, 13, 8, 6, 0xfff8e7); g.rect(13, 15, 4, 2, c.main);
      g.outline(-0.8);
    });
    this.add.image(x, y, padKey).setScale(S).setDepth(-60);
    const top = p < 2;
    const binY = top ? y - 26 : y + 30;
    const bin = this.add.image(x, binY, binKey).setScale(S).setOrigin(0.5, 1).setDepth(binY - (top ? 0 : 0));
    const light = this.add.image(x, y, `${ID}-lampglow`).setScale(S * 2).setTint(c.main).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.3).setDepth(-59);
    if (!this.players.includes(p)) { bin.setAlpha(0.4); light.setVisible(false); }
    this.bases.push({ p, x, y, bin, light });
  }

  // ───────────────────────────── scrap ─────────────────────────────

  private rollKind(v: number): Kind {
    return v < 0.04 ? 'gold' : v < 0.24 ? 'gear' : v < 0.5 ? 'nut' : v < 0.72 ? 'spring' : 'bolt';
  }

  private randomSpot(r: () => number = Math.random): { x: number; y: number } {
    const f = this.field;
    for (let k = 0; k < 20; k++) {
      const x = f.x + 30 + r() * (f.width - 60), y = f.y + 30 + r() * (f.height - 60);
      if (this.bases.every((b) => Math.hypot(b.x - x, b.y - y) > BASE_R + 46)) return { x, y };
    }
    return { x: this.vw / 2, y: this.vh / 2 };
  }

  private spawnScrap(kind: Kind, x: number, y: number, vx = 0, vy = 0, vz = 0, delay = 0): void {
    const img = this.add.image(x, y, `${ID}-${kind}`).setScale(S).setAngle(Math.random() * 360);
    const shadow = this.add.image(x, y, 'shadow').setScale(S * 0.35).setAlpha(0.3);
    if (!vx && !vz) { img.setScale(0); this.tweens.add({ targets: img, scale: S, duration: 240, ease: 'Back.easeOut' }); }
    this.scrap.push({ kind, x, y, vx, vy, z: vz ? 1 : 0, vz, spin: (Math.random() - 0.5) * 400, img, shadow, delay, alive: true });
  }

  private updateScrap(dt: number): void {
    const f = this.field;
    const fr = Math.pow(0.08, dt);
    for (const s of this.scrap) {
      if (!s.alive) continue;
      s.delay = Math.max(0, s.delay - dt);
      if (s.z > 0 || s.vz) {
        s.vz -= 700 * dt; s.z += s.vz * dt;
        if (s.z <= 0) { s.z = 0; if (s.vz < -120) { s.vz *= -0.35; Audio.sfx('tick'); } else s.vz = 0; }
      }
      s.vx *= s.z > 0 ? 1 : fr; s.vy *= s.z > 0 ? 1 : fr;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.x < f.x + 6) { s.x = f.x + 6; s.vx = Math.abs(s.vx) * 0.5; }
      if (s.x > f.right - 6) { s.x = f.right - 6; s.vx = -Math.abs(s.vx) * 0.5; }
      if (s.y < f.y + 6) { s.y = f.y + 6; s.vy = Math.abs(s.vy) * 0.5; }
      if (s.y > f.bottom - 4) { s.y = f.bottom - 4; s.vy = -Math.abs(s.vy) * 0.5; }
      const sp = Math.hypot(s.vx, s.vy);
      s.img.angle += s.spin * dt * Math.min(1, sp / 60 + (s.z > 0 ? 1 : 0));
      s.img.setPosition(s.x, s.y - 4 - s.z).setDepth(s.y);
      s.shadow.setPosition(s.x, s.y + 2).setDepth(s.y - 1000);
    }
    this.scrap = this.scrap.filter((s) => s.alive);
  }

  // ───────────────────────────── magnet ─────────────────────────────

  private setMagnet(b: ArenaBody, down: boolean): void {
    const m = this.mags[b.p];
    if (this.state !== 'play' || !b.alive) { m.on = false; return; }
    if (down) {
      if (m.cd > 0) return;
      m.on = true;
      m.hold = 0;
      Audio.sfx('power', 0.6 + b.p * 0.06);
    } else if (m.on) {
      m.on = false;
      this.blast(b, Math.min(1.5, m.hold));
      m.cd = 0.35;
    }
  }

  private blast(b: ArenaBody, charge: number): void {
    const k = Phaser.Math.Clamp((charge - 0.15) / 1.2, 0, 1);
    const R = 70 + 60 * k;
    const col = PLAYER_COLORS[b.p];
    const ring = this.add.image(b.x, b.y - 10, `${ID}-shock`).setScale(0.4).setTint(col.light).setDepth(1800).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: ring, scale: (R * 2) / 48, alpha: 0, duration: 300, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
    burst(this, b.x, b.y - 10, { tex: 'spark', count: 10 + Math.round(10 * k), tint: [col.light, 0xffffff, 0x6ec6ff], speed: [120, 220 + 160 * k], life: 320, depth: 1801 });
    Audio.sfx(k > 0.5 ? 'bigHit' : 'whoosh', 1 + b.p * 0.08);
    if (k > 0.6) Vfx.shake(this, 0.005, 140);
    Vfx.squash(this, b.avatar.sprite, 1.35, 0.7, 180);
    // blow loose scrap away
    for (const s of this.scrap) {
      const dx = s.x - b.x, dy = s.y - b.y, d = Math.hypot(dx, dy);
      if (d > R || d < 1) continue;
      const pw = (260 + 260 * k) * (1 - d / (R * 1.2));
      s.vx += (dx / d) * pw; s.vy += (dy / d) * pw; s.vz = 120; s.z = Math.max(s.z, 1);
    }
    // blast rivals: knockback + shake scrap off their cluster
    for (const o of this.kit.alive) {
      if (o === b) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d > R) continue;
      const f = 1 - d / (R * 1.15);
      this.kit.knock(o, b.x, b.y, (220 + 320 * k) * f + 60, 0.35 + 0.4 * k);
      o.lastHitBy = b.p;
      const om = this.mags[o.p];
      const n = Math.min(om.stuck.length, Math.ceil(om.stuck.length * (0.3 + 0.5 * k * f)));
      if (n > 0) {
        this.shed(o, n, b.x, b.y);
        Vfx.popText(this, o.x, o.y - 84, `หลุด ${n}!`, '#ffb3bd', 15, this.angleFor(o.p));
      }
      Vfx.hitFlash(this, o.avatar.sprite);
    }
  }

  private shed(o: ArenaBody, n: number, fromX: number, fromY: number): void {
    const om = this.mags[o.p];
    for (let i = 0; i < n; i++) {
      const st = om.stuck.pop();
      if (!st) break;
      const wx = st.img.x, wy = st.img.y + 4;
      st.img.destroy();
      const dx = o.x - fromX, dy = o.y - fromY, d = Math.hypot(dx, dy) || 1;
      const a = Math.atan2(dy / d, dx / d) + (Math.random() - 0.5) * 1.6;
      const sp = 140 + Math.random() * 140;
      this.spawnScrap(st.kind, wx, wy, Math.cos(a) * sp, Math.sin(a) * sp, 160 + Math.random() * 80, 0.45);
    }
    Audio.sfx('hit', 1.3);
  }

  private stick(b: ArenaBody, s: Scrap): void {
    const m = this.mags[b.p];
    s.alive = false;
    s.shadow.destroy();
    const n = m.stuck.length;
    const ringN = n < 4 ? 0 : n < 10 ? 1 : 2;
    m.stuck.push({ kind: s.kind, img: s.img, a: Math.random() * Math.PI * 2, r: 14 + ringN * 7 + Math.random() * 3 });
    Audio.sfx('pop', 0.9 + b.p * 0.08 + n * 0.03);
    burst(this, s.x, s.y - 6, { tex: 'dot2', count: 4, tint: [0xffffff, PLAYER_COLORS[b.p].light], speed: [30, 80], life: 220 });
    if (m.stuck.length >= MAX_STUCK) Vfx.popText(this, b.x, b.y - 90, 'เต็ม! กลับฐาน!', '#ffe066', 13, this.angleFor(b.p));
  }

  private updateMags(dt: number): void {
    const now = this.time.now;
    for (const b of this.kit.bodies) {
      const m = this.mags[b.p];
      if (!m) continue;
      m.cd = Math.max(0, m.cd - dt);
      if (this.state !== 'play' && m.on) m.on = false;
      if (m.on) m.hold += dt;
      // magnetic field rings contract while held
      m.field.forEach((img, i) => {
        if (!m.on) { img.setVisible(false); return; }
        const t = ((now / 600 + i / 3) % 1);
        const sc = S * ((1 - t) * 0.85 + 0.12);
        img.setVisible(true).setPosition(b.x, b.y - 8).setScale(sc, sc * 0.8).setAlpha(0.15 + t * 0.4).setDepth(b.y - 2).setAngle(now / 8);
      });
      // cluster orbit
      const charge = m.on ? Math.min(1, m.hold / 1.2) : 0;
      m.stuck.forEach((st, i) => {
        st.a += dt * (0.8 + (i % 3) * 0.3) * (m.on ? 2.4 : 1);
        const shake = charge > 0.8 ? (Math.random() - 0.5) * 2 : 0;
        const x = b.x + Math.cos(st.a) * st.r + shake, y = b.y - 22 + Math.sin(st.a) * st.r * 0.75;
        st.img.setPosition(x, y).setDepth(Math.sin(st.a) > 0 ? b.y + 1 : b.y - 1);
        st.img.angle += dt * 90;
      });
      b.speedMul = (1 - m.stuck.length * 0.035) * (m.on ? 0.78 : 1);
      if (b.stun > 0) b.avatar.sprite.setTint(0xc8f0ff); else if (!b.avatar.sprite.tintFill) b.avatar.sprite.clearTint();
    }
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.kit.update(dt, this.state === 'play');
    this.updateMags(dt);
    this.updateScrap(dt);
    for (const [i, belt] of this.belts.entries()) belt.tilePositionX += dt * (i ? -14 : 14);
    const blink = Math.floor(this.time.now / 450) % 2;
    this.lamps.forEach((l, i) => l.setAlpha((blink + i) % 2 ? 0.9 : 0.25));
    if (this.drop) {
      const d = this.drop;
      const k = Math.min(1, d.t / 1.3);
      d.shadow.setPosition(d.x, d.y).setScale(S * (0.6 + k * 1.2)).setAlpha(0.15 + k * 0.25);
      d.hook.setPosition(d.x, d.y - 120 + k * 60);
    }
  }

  tick(dt: number): void {
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.scrap.length < MAX_LOOSE) {
      const s = this.randomSpot();
      this.spawnScrap(this.rollKind(Math.random()), s.x, s.y);
      this.spawnT = 0.45 + Math.random() * 0.4;
    }
    this.tickDrop(dt);
    for (const b of this.kit.alive) {
      const m = this.mags[b.p];
      if (this.isCpu(b.p)) this.bot(b, dt);
      // pull loose scrap
      if (m.on && m.stuck.length < MAX_STUCK) {
        for (const s of this.scrap) {
          if (!s.alive || s.delay > 0) continue;
          const dx = b.x - s.x, dy = b.y - s.y, d = Math.hypot(dx, dy);
          if (d > PULL_R) continue;
          if (d < b.r + 9 && m.stuck.length < MAX_STUCK) { this.stick(b, s); continue; }
          const pull = 900 * (1 - d / PULL_R) + 120;
          s.vx += (dx / d) * pull * dt; s.vy += (dy / d) * pull * dt;
        }
        // rivals feel a gentle tug too (set up a blast!)
        for (const o of this.kit.alive) {
          if (o === b) continue;
          const dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy);
          if (d > PULL_R * 0.8 || d < 30) continue;
          o.vx += (dx / d) * 160 * dt; o.vy += (dy / d) * 160 * dt;
        }
        m.hum -= dt;
        if (m.hum <= 0) { m.hum = 0.22; Audio.sfx('tick'); }
      }
      // deposit at own base
      const base = this.bases.find((x) => x.p === b.p)!;
      if (m.stuck.length && Math.hypot(b.x - base.x, (b.y - base.y) * 1.3) < BASE_R) {
        m.depT -= dt;
        if (m.depT <= 0) { m.depT = 0.09; this.deposit(b, base); }
      } else m.depT = 0;
    }
    if (!this.warned && this.timeLeft < 10) {
      this.warned = true;
      this.banner('10 วิสุดท้าย! รีบกลับฐาน!', '#ffe066');
    }
    for (const p of this.players) {
      const carried = this.mags[p].stuck.reduce((s, st) => s + VALUE[st.kind], 0);
      this.hudText[p] = carried ? `${this.score[p]} +${carried}` : `${this.score[p]}`;
    }
  }

  private deposit(b: ArenaBody, base: { x: number; y: number; bin: Phaser.GameObjects.Image; light: Phaser.GameObjects.Image }): void {
    const m = this.mags[b.p];
    const st = m.stuck.pop();
    if (!st) return;
    const v = VALUE[st.kind];
    this.addScore(b.p, v);
    const img = st.img;
    img.setDepth(3000);
    const tx = base.bin.x, ty = base.bin.y - 30;
    this.tweens.add({
      targets: img, x: tx, y: ty, scale: S * 0.6, angle: img.angle + 360, duration: 220, ease: 'Quad.easeIn',
      onComplete: () => { img.destroy(); burst(this, tx, ty, { tex: 'dot2', count: 4, tint: [0xffffff, 0xffe066], speed: [30, 90], life: 250, depth: 3001 }); },
    });
    Audio.sfx('coin', 1 + b.p * 0.05 + (MAX_STUCK - m.stuck.length) * 0.04);
    this.tweens.add({ targets: base.bin, scaleY: S * 0.85, scaleX: S * 1.1, yoyo: true, duration: 70 });
    this.tweens.add({ targets: base.light, alpha: 0.8, yoyo: true, duration: 90 });
    if (!m.stuck.length || v >= 5) {
      const total = v >= 5 && m.stuck.length ? `+${v}!` : 'ฝากแล้ว!';
      Vfx.popText(this, base.x, base.y + (b.p < 2 ? 40 : -40), total, toCss(PLAYER_COLORS[b.p].light), 16, this.angleFor(b.p));
    }
  }

  private tickDrop(dt: number): void {
    this.dropT -= dt;
    if (!this.drop && this.dropT <= 0 && this.timeLeft > 5) {
      const s = this.randomSpot();
      const x = Phaser.Math.Linear(s.x, this.vw / 2, 0.5), y = Phaser.Math.Linear(s.y, this.vh / 2, 0.5);
      const shadow = this.add.image(x, y, 'shadow').setScale(S * 0.6).setAlpha(0.15).setDepth(-50);
      const hook = this.add.image(x, y - 120, `${ID}-hook`).setScale(S).setDepth(2600);
      this.drop = { x, y, t: 0, shadow, hook };
      Audio.sfx('whoosh', 0.7);
      this.banner('เครนทิ้งเศษเหล็ก!', '#6ec6ff');
    }
    if (this.drop) {
      const d = this.drop;
      d.t += dt;
      if (d.t >= 1.3) {
        Audio.sfx('explode', 1.4);
        Vfx.shake(this, 0.006, 160);
        Vfx.dust(this, d.x - 14, d.y); Vfx.dust(this, d.x + 14, d.y);
        for (let i = 0; i < 9; i++) {
          const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 120;
          this.spawnScrap(i === 0 ? 'gold' : this.rollKind(Math.random() * 0.9 + 0.1), d.x, d.y, Math.cos(a) * sp, Math.sin(a) * sp * 0.8, 160 + Math.random() * 100, 0.25);
        }
        const { shadow, hook } = d;
        shadow.destroy();
        this.tweens.add({ targets: hook, y: hook.y - 260, duration: 700, ease: 'Quad.easeIn', onComplete: () => hook.destroy() });
        this.drop = undefined;
        this.dropT = 10 + Math.random() * 3;
      }
    }
  }

  private banner(text: string, color: string): void {
    Audio.sfx('power');
    for (const [deg, y] of [[0, this.vh * 0.64], [180, this.vh * 0.36]] as const) {
      const t = txt(this, this.vw / 2, y, text, { size: 22, color, strokeWidth: 6 }).setAngle(deg).setDepth(3000);
      this.tweens.add({ targets: t, scale: { from: 0.4, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 1200, duration: 400, onComplete: () => t.destroy() });
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    const m = this.mags[b.p];
    const base = this.bases.find((x) => x.p === b.p)!;
    const dHome = Math.hypot(base.x - b.x, base.y - b.y);
    const carried = m.stuck.reduce((s, st) => s + VALUE[st.kind], 0);
    b.data.think -= dt;
    const goHome = m.stuck.length >= MAX_STUCK || m.stuck.length >= b.data.greed || (carried > 0 && this.timeLeft < 2.5 + dHome / 100);
    // blast a loaded rival who wanders close
    const near = this.kit.alive.filter((o) => o !== b && Math.hypot(o.x - b.x, o.y - b.y) < 70);
    if (m.on && m.hold > 0.45 && near.some((o) => this.mags[o.p].stuck.length >= 2) && Math.random() < 0.08 * b.data.aggro + 0.02) {
      this.setMagnet(b, false);
      return;
    }
    if (goHome) {
      b.botTarget = { x: base.x, y: base.y };
      // keep the magnet on in crowds (to blast), off when the way is clear
      if (m.on && !near.length && m.hold > 0.3) this.setMagnet(b, false);
      if (!m.on && near.length && m.cd <= 0 && Math.random() < 0.05 * b.data.aggro) this.setMagnet(b, true);
      return;
    }
    if (b.data.think <= 0) {
      b.data.think = 0.4 + Math.random() * 0.4;
      // pick the richest nearby cluster of loose scrap
      let best = -1;
      for (const s of this.scrap) {
        if (!s.alive) continue;
        let val = 0;
        for (const o of this.scrap) if (o.alive && Math.hypot(o.x - s.x, o.y - s.y) < 60) val += VALUE[o.kind];
        const d = Math.hypot(s.x - b.x, s.y - b.y);
        const sc = (val / (d + 60)) * (0.8 + Math.random() * 0.4);
        if (sc > best) { best = sc; b.data.tx = s.x; b.data.ty = s.y; }
      }
      // a juicy rival nearby: go blast them
      for (const o of this.kit.alive) {
        if (o === b) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (this.mags[o.p].stuck.length >= 4 && d < 140 && Math.random() < b.data.aggro * 0.6) { b.data.tx = o.x; b.data.ty = o.y; }
      }
    }
    b.botTarget = { x: b.data.tx, y: b.data.ty };
    const closeScrap = this.scrap.some((s) => s.alive && Math.hypot(s.x - b.x, s.y - b.y) < PULL_R * 0.8);
    if (!m.on && m.cd <= 0 && (closeScrap || near.length)) this.setMagnet(b, true);
    if (m.on && !closeScrap && !near.length && m.hold > 0.8) this.setMagnet(b, false);
  }

  shutdown(): void {
    this.kit?.destroy();
  }
}

import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const ID = 'puzzle-panic';
const T = 36; // tile size in world units (18 art px)
const A = T / S;
const N = 1, E = 2, So = 4, W = 8;
const DIRS: [number, number, number, number][] = [
  [N, 0, -1, So], [E, 1, 0, W], [So, 0, 1, N], [W, -1, 0, E],
];
const SIZES: [number, number][] = [[4, 3], [5, 3], [5, 4], [6, 4], [6, 5], [7, 5]];

const rot = (m: number) => ((m << 1) | (m >> 3)) & 15;

interface Puzzle {
  cols: number;
  rows: number;
  r0: number;
  r1: number;
  /** Scrambled starting masks. */
  start: number[];
  /** Openings each path cell needs (0 = not on the path). */
  need: number[];
  /** Path cells in flow order. */
  path: number[];
}

interface Seat {
  p: PlayerIndex;
  pn: Panel;
  level: number;
  solved: number;
  masks: number[];
  pz?: Puzzle;
  grid?: Phaser.GameObjects.Container;
  pipes: Phaser.GameObjects.Image[];
  wet: boolean[];
  tap?: Phaser.GameObjects.Image;
  pot?: Phaser.GameObjects.Image;
  flower?: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
  busy: number;
  pending: boolean;
  progress: number;
  lastSolve: number;
  dripT: number;
  // CPU
  think: number;
  skill: number;
}

/** #35 — Rotate pipe tiles to bring water from the tap to your flower pot. Same puzzles for everyone, they keep getting bigger. */
export default class PuzzlePanic extends BaseMinigame {
  private panels!: PanelKit;
  private seats: Seat[] = [];
  private puzzles: Puzzle[] = [];
  private seed = 1;
  private clouds: Phaser.GameObjects.TileSprite[] = [];
  private flies: { img: Phaser.GameObjects.Image; p: number; ph: number; cx: number; cy: number }[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.seats = [];
    this.puzzles = [];
    this.clouds = [];
    this.flies = [];
    this.seed = 3500 + Math.floor(Math.random() * 100000);
    this.panels = new PanelKit(this, { frame: false, inset: 3 });
    this.paintArt();
    for (const pn of this.panels.panels) this.buildPanel(pn);
    this.panels.onDown((p, lx, ly) => {
      if (!this.isCpu(p)) this.tapAt(this.seats[p], lx, ly);
    });
  }

  // ───────────────────────────── puzzles ─────────────────────────────

  private puzzle(k: number): Puzzle {
    if (!this.puzzles[k]) this.puzzles[k] = makePuzzle(SIZES[Math.min(k, SIZES.length - 1)], rng(this.seed + k * 977));
    return this.puzzles[k];
  }

  private originOf(pz: Puzzle): { x: number; y: number } {
    return { x: -(pz.cols * T) / 2 + T / 2, y: -(pz.rows * T) / 2 + T / 2 - 2 };
  }

  private loadLevel(s: Seat, first: boolean): void {
    const pz = this.puzzle(s.level);
    s.pz = pz;
    s.masks = [...pz.start];
    s.wet = pz.start.map(() => false);
    s.pipes = [];
    const old = s.grid;
    const grid = this.add.container(0, 0);
    s.pn.c.addAt(grid, s.pn.c.getIndex(s.label!) - 1);
    s.grid = grid;
    const o = this.originOf(pz);
    const delayBase = first ? 0 : 380;
    for (let i = 0; i < pz.cols * pz.rows; i++) {
      const cx = i % pz.cols, cy = Math.floor(i / pz.cols);
      const x = o.x + cx * T, y = o.y + cy * T;
      const slab = this.add.image(x, y, `${ID}-slab`, (cx + cy) % 2).setScale(S);
      const pipe = this.add.image(x, y, `${ID}-pipe`, s.masks[i]).setScale(S);
      grid.add([slab, pipe]);
      s.pipes.push(pipe);
      for (const g of [slab, pipe]) {
        g.setScale(0);
        this.tweens.add({ targets: g, scale: S, delay: delayBase + (cx + cy) * 30, duration: 220, ease: 'Back.easeOut' });
      }
    }
    // frame around the patio
    const fw = pz.cols * T + 8, fh = pz.rows * T + 8;
    const fr = this.add.nineslice(o.x - T / 2 + fw / 2 - 4, o.y - T / 2 + fh / 2 - 4, `${ID}-edge`, undefined, fw / S, fh / S, 4, 4, 4, 4).setScale(S);
    grid.addAt(fr, 0);
    // tap + pot positions
    const ty = o.y + pz.r0 * T, py = o.y + pz.r1 * T;
    const tx = o.x - T + 2, px = o.x + pz.cols * T - 2;
    if (first) {
      s.tap!.setPosition(tx, ty);
      s.pot!.setPosition(px, py + 2);
      s.flower!.setPosition(px, py - 18).setFrame(0);
    } else {
      this.tweens.add({ targets: s.tap, x: tx, y: ty, delay: 250, duration: 300, ease: 'Cubic.easeInOut' });
      this.tweens.add({ targets: s.pot, x: px, y: py + 2, delay: 250, duration: 300, ease: 'Cubic.easeInOut' });
      this.time.delayedCall(250, () => s.flower?.setFrame(0));
    }
    if (old) {
      old.each((g: Phaser.GameObjects.GameObject) => {
        const img = g as Phaser.GameObjects.Image;
        this.tweens.add({ targets: img, scale: 0, alpha: 0, duration: 200, delay: Math.random() * 120, ease: 'Back.easeIn' });
      });
      this.time.delayedCall(420, () => old.destroy());
    }
    s.label!.setText(`ด่าน ${s.level + 1}`);
    this.flow(s);
  }

  /** Recompute which tiles hold water; returns true when the pot is reached. */
  private flow(s: Seat): boolean {
    const pz = s.pz!;
    const wet = pz.start.map(() => false);
    const start = pz.r0 * pz.cols;
    let reached = false;
    if (s.masks[start] & W) {
      const q = [start];
      wet[start] = true;
      while (q.length) {
        const i = q.shift()!;
        const cx = i % pz.cols, cy = Math.floor(i / pz.cols);
        if (cx === pz.cols - 1 && cy === pz.r1 && s.masks[i] & E) reached = true;
        for (const [bit, dx, dy, opp] of DIRS) {
          if (!(s.masks[i] & bit)) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= pz.cols || ny >= pz.rows) continue;
          const j = ny * pz.cols + nx;
          if (wet[j] || !(s.masks[j] & opp)) continue;
          wet[j] = true;
          q.push(j);
        }
      }
    }
    let n = 0;
    wet.forEach((w, i) => {
      if (w && !s.wet[i]) n++;
      s.wet[i] = w;
      s.pipes[i]?.setFrame(s.masks[i] + (w ? 16 : 0));
    });
    if (n > 0 && this.state === 'play') Audio.sfx('splash', 1.6 + s.p * 0.1);
    s.progress = pz.path.filter((i) => wet[i]).length / pz.path.length;
    return reached;
  }

  private tapAt(s: Seat | undefined, lx: number, ly: number): void {
    if (!s || !s.pz || s.busy > 0) return;
    const pz = s.pz;
    const o = this.originOf(pz);
    const cx = Math.round((lx - o.x) / T), cy = Math.round((ly - o.y) / T);
    if (cx < 0 || cy < 0 || cx >= pz.cols || cy >= pz.rows) return;
    this.rotate(s, cy * pz.cols + cx);
  }

  private rotate(s: Seat, i: number): void {
    s.masks[i] = rot(s.masks[i]);
    const pipe = s.pipes[i];
    this.tweens.killTweensOf(pipe);
    pipe.setAngle(-90).setScale(S);
    this.tweens.add({ targets: pipe, angle: 0, duration: 90, ease: 'Quad.easeOut' });
    Audio.sfx('click', 0.8 + s.p * 0.08 + Math.random() * 0.1);
    if (this.flow(s)) this.solve(s);
  }

  private solve(s: Seat): void {
    const pz = s.pz!;
    s.solved++;
    s.lastSolve = this.elapsed;
    this.addScore(s.p, 1);
    const col = PLAYER_COLORS[s.p];
    // water rushes along the path, then the flower blooms
    pz.path.forEach((ci, k) => {
      this.time.delayedCall(k * 35, () => {
        const pipe = s.pipes[ci];
        if (!pipe?.active) return;
        pipe.setTint(0xbfeaff);
        Vfx.squash(this, pipe, 1.25, 1.25, 160);
        this.time.delayedCall(120, () => pipe.active && pipe.clearTint());
      });
    });
    const dt = pz.path.length * 35;
    this.time.delayedCall(dt, () => {
      const w = this.panels.toWorld(s.p, s.pot!.x, s.pot!.y - 10);
      burst(this, w.x, w.y, { tex: 'dot2', count: 12, tint: [0x8fd6ff, 0xffffff, 0x3d9bff], speed: [40, 120], angle: [200, 340], gravity: 300, life: 500 });
      Audio.sfx('splash', 1 + s.p * 0.1);
      this.bloom(s);
      const fw = this.panels.toWorld(s.p, s.flower!.x, s.flower!.y);
      Vfx.sparkle(this, fw.x, fw.y, [col.light, 0xffffff, 0xffe066]);
      const tw = this.panels.toWorld(s.p, 0, -10);
      Vfx.popText(this, tw.x, tw.y, 'ผ่าน! +1', toCss(col.light), 22, this.angleFor(s.p));
      Audio.sfx('power', 1 + s.p * 0.08);
    });
    s.busy = dt / 1000 + 0.75;
    s.pending = true;
  }

  private bloom(s: Seat): void {
    const f = s.flower!;
    let k = 0;
    const step = () => {
      k++;
      if (!f.active) return;
      f.setFrame(Math.min(4, k));
      Vfx.squash(this, f, 1.3, 0.8, 120);
      if (k < 4) this.time.delayedCall(70, step);
    };
    step();
  }

  // ───────────────────────────── build ─────────────────────────────

  private buildPanel(pn: Panel): void {
    const { c, w, h, p } = pn;
    const sky = this.add.tileSprite(-w / 2, -h / 2, w / S, 22, `${ID}-sky`).setOrigin(0).setScale(S);
    c.add(sky);
    this.clouds.push(sky);
    c.add(this.add.image(0, 0, this.bgKey(w, h)).setScale(S));
    // ground tufts sway
    for (let i = 0; i < 9; i++) {
      const tuft = this.add.image(-w / 2 + 14 + i * (w - 28) / 8, h / 2 - 6, `${ID}-tuft`, i % 3).setScale(S).setOrigin(0.5, 1);
      c.add(tuft);
      this.tweens.add({ targets: tuft, scaleX: S * 0.85, angle: 4, yoyo: true, repeat: -1, duration: 900 + i * 70, ease: 'Sine.easeInOut', delay: i * 90 });
    }
    // butterflies
    for (let k = 0; k < 2; k++) {
      const img = this.add.image(0, 0, `${ID}-fly`, 0).setScale(S).setTint(k ? 0xffe066 : 0xffb3ff);
      c.add(img);
      this.flies.push({ img, p, ph: Math.random() * 10, cx: (k ? 1 : -1) * w * 0.3, cy: -h / 2 + 30 + k * 10 });
    }
    const label = txt(this, 0, -h / 2 + 12, 'ด่าน 1', { size: 14, color: '#fff8e7' });
    const tap = this.add.image(0, 0, `${ID}-tap`).setScale(S);
    const pot = this.add.image(0, 0, `${ID}-pot`).setScale(S);
    const flower = this.add.image(0, 0, `${ID}-flower-${p}`, 0).setScale(S).setOrigin(0.5, 0.5);
    c.add(this.add.image(0, -h / 2 + 12, `${ID}-sign`).setScale(S));
    c.add([label, tap, pot, flower]);
    c.add(this.add.image(0, 0, this.frameKey(p, w, h)).setScale(S));
    const s: Seat = {
      p, pn, level: 0, solved: 0, masks: [], pipes: [], wet: [], tap, pot, flower, label,
      busy: 0, pending: false, progress: 0, lastSolve: 0, dripT: Math.random(), think: 0, skill: 0.85 + Math.random() * 0.35,
    };
    this.seats[p] = s;
    this.loadLevel(s, true);
    s.think = this.cpuThink(s);
  }

  private cpuThink(s: Seat): number {
    return (0.9 + Math.random() * 1.2 + (s.pz?.path.length ?? 6) * 0.05) / s.skill;
  }

  private bgKey(w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    return makeTexture(this, `${ID}-bg-${aw}x${ah}`, aw, ah, (p) => {
      const top = 20;
      // brick wall
      for (let y = top; y < ah - 12; y++) for (let x = 0; x < aw; x++) {
        const row = Math.floor((y - top) / 5);
        const off = row % 2 ? 5 : 0;
        const mortar = (y - top) % 5 === 4 || (x + off) % 10 === 9;
        const k = Math.floor((x + off) / 10) * 7 + row * 3;
        p.px(x, y, mortar ? 0xb79a8a : [0xc8624e, 0xbb5a48, 0xd06c56][k % 3]);
      }
      // wall cap
      p.rect(0, top - 3, aw, 4, 0xd8cfc0);
      p.hline(0, top - 3, aw, 0xf0eadf);
      p.hline(0, top + 1, aw, 0x8a6a5a);
      // ivy hanging from the wall cap
      const r = rng(4);
      for (let i = 0; i < 7; i++) {
        let x = 6 + Math.floor(r() * (aw - 12)), y = top + 1;
        const len = 8 + Math.floor(r() * 16);
        for (let k = 0; k < len; k++) {
          p.px(x, y, 0x2f6e3c);
          if (k % 3 === 1) {
            const sx = k % 6 === 1 ? -2 : 1;
            p.rect(x + sx, y - 1, 2, 2, 0x3e8a4a); p.px(x + sx, y - 1, 0x6cc46a);
          }
          y += 1;
          if (r() < 0.3) x += r() < 0.5 ? -1 : 1;
        }
        p.rect(x - 1, y - 1, 3, 2, 0x4a9a4e); p.px(x - 1, y - 1, 0x7cd47a);
      }
      // soil + grass bed
      p.rect(0, ah - 12, aw, 12, 0x7a5236);
      for (let x = 0; x < aw; x++) { p.vline(x, ah - 13, 2 + (x * 7 % 3), 0x58b05a); if (r() < 0.12) p.px(x, ah - 5 - Math.floor(r() * 5), 0x5e3e28); }
      for (let i = 0; i < 9; i++) { const x = Math.floor(r() * aw); p.px(x, ah - 15, [0xffe066, 0xff7a85, 0xffffff][i % 3]); p.px(x, ah - 14, 0x3e8a4a); }
      void shift;
    });
  }

  private frameKey(p: PlayerIndex, w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    const c = PLAYER_COLORS[p];
    return makeTexture(this, `${ID}-frame-${p}-${aw}x${ah}`, aw, ah, (g) => {
      for (let i = 0; i < 2; i++) {
        const col = i === 0 ? shift(c.main, -0.5) : c.main;
        g.rect(i, i, aw - i * 2, 1, col); g.rect(i, ah - 1 - i, aw - i * 2, 1, col);
        g.rect(i, i, 1, ah - i * 2, col); g.rect(aw - 1 - i, i, 1, ah - i * 2, col);
      }
      g.hline(3, 2, aw - 6, c.light);
    });
  }

  private paintArt(): void {
    makeTexture(this, `${ID}-sky`, 80, 22, (p) => {
      p.gradient(0, 0, 80, 22, [0x7cc8ff, 0xb8e4ff]);
      p.ball(14, 9, 7, 3, 0xffffff, false); p.ball(20, 7, 5, 3, 0xffffff, false);
      p.ball(55, 13, 6, 2.5, 0xffffff, false); p.ball(60, 11, 4, 2.5, 0xffffff, false);
    });
    makeSheet(this, `${ID}-slab`, A, A, 2, (p, i) => {
      const base = i ? 0xd9cfb8 : 0xcfc4aa;
      p.box(0, 0, A, A, base);
      p.hline(0, A - 1, A, shift(base, -0.5)); p.vline(A - 1, 0, A, shift(base, -0.5));
      const r = rng(20 + i);
      for (let k = 0; k < 12; k++) p.px(1 + Math.floor(r() * (A - 2)), 1 + Math.floor(r() * (A - 2)), r() < 0.5 ? shift(base, -0.18) : shift(base, 0.15));
      p.px(2, A - 4, shift(base, -0.25)); p.px(3, A - 4, shift(base, -0.25)); p.px(A - 5, 3, shift(base, -0.25));
    });
    makeSheet(this, `${ID}-pipe`, A, A, 32, (p, i) => paintPipe(p, i & 15, i >= 16));
    makeTexture(this, `${ID}-tap`, 16, 16, (p) => {
      p.rect(0, 5, 3, 6, 0x8f98a8); // wall pipe
      p.box(2, 5, 9, 6, 0xd4a04a);
      p.rect(9, 6, 7, 4, 0xd4a04a);
      p.hline(9, 6, 7, 0xffd98a);
      p.rect(5, 1, 3, 4, 0xb9822e);
      p.rect(3, 0, 7, 2, 0xff5a6e); p.hline(3, 0, 7, 0xff9aa6);
      p.rect(13, 10, 2, 2, 0xb9822e);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-pot`, 18, 16, (p) => {
      p.rect(0, 2, 6, 4, 0xd4a04a); p.hline(0, 2, 6, 0xffd98a); // inlet pipe stub
      p.tri(3, 4, 15, 4, 13, 15, 0xd9604a);
      p.tri(3, 4, 5, 15, 13, 15, 0xd9604a);
      p.rect(2, 2, 14, 4, 0xe8735a); p.hline(2, 2, 14, 0xf6a088);
      p.rect(4, 3, 10, 2, 0x5e3e28);
      p.vline(6, 6, 8, 0xe8806a);
      p.outline(-0.7);
    });
    for (const q of [0, 1, 2, 3] as PlayerIndex[]) {
      const col = PLAYER_COLORS[q];
      makeSheet(this, `${ID}-flower-${q}`, 16, 20, 5, (p, i) => {
        const stem = 0x3e8a4a;
        p.vline(8, 9, 11, stem);
        p.ellipse(5.5, 15, 2.5, 1.2, 0x58b05a); p.ellipse(10.5, 13, 2.5, 1.2, 0x58b05a);
        if (i === 0) {
          p.ball(8, 7, 2.5, 3.5, shift(col.main, -0.2));
          p.ellipse(8, 9, 2.5, 1.4, 0x58b05a);
        } else {
          const r = 1.5 + i * 1.0;
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
            p.ball(8 + Math.cos(a) * r, 7 + Math.sin(a) * r, 2.2 + i * 0.25, 2.2 + i * 0.25, col.main, false);
          }
          p.ball(8, 7, 1.6 + i * 0.3, 1.6 + i * 0.3, 0xffe066);
          if (i >= 3) p.px(7, 6, 0xffffff);
        }
        p.outline(-0.7);
      });
    }
    makeSheet(this, `${ID}-tuft`, 8, 8, 3, (p, i) => {
      for (let k = 0; k < 4; k++) p.vline(1 + k * 2, 8 - (3 + ((k + i) % 3) * 2), 3 + ((k + i) % 3) * 2, k % 2 ? 0x58b05a : 0x4a9a4e);
      if (i === 1) p.px(3, 2, 0xffe066);
    });
    makeSheet(this, `${ID}-fly`, 7, 6, 2, (p, i) => {
      if (i === 0) { p.ellipse(2, 2, 2, 2, 0xffffff); p.ellipse(5, 2, 2, 2, 0xffffff); p.ellipse(2, 4.5, 1.5, 1.2, 0xffffff); p.ellipse(5, 4.5, 1.5, 1.2, 0xffffff); }
      else { p.rect(2, 1, 1, 4, 0xffffff); p.rect(4, 1, 1, 4, 0xffffff); }
      p.vline(3, 1, 5, 0x2b2b3a);
    });
    makeTexture(this, `${ID}-edge`, 12, 12, (p) => {
      p.rect(0, 0, 12, 12, 0x7a5236);
      p.rect(1, 1, 10, 10, 0x9a6a3a);
      p.hline(1, 1, 10, 0xc08850); p.vline(1, 1, 10, 0xc08850);
      for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) p.clear(x, y);
      p.rect(3, 3, 6, 1, 0x5e3e28); p.rect(3, 3, 1, 6, 0x5e3e28);
    });
    makeTexture(this, `${ID}-drop`, 3, 4, (p) => { p.rect(1, 0, 1, 1, 0x8fd6ff); p.rect(0, 1, 3, 3, 0x3d9bff); p.px(0, 1, 0xbfeaff); });
    makeTexture(this, `${ID}-sign`, 40, 12, (p) => {
      p.box(0, 0, 40, 11, 0x9a6a3a);
      p.hline(1, 1, 38, 0xc08850);
      p.hline(0, 11, 40, 0x5e3e28);
      p.px(2, 5, 0x5e3e28); p.px(37, 5, 0x5e3e28);
    });
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    const t = this.time.now / 1000;
    for (const c of this.clouds) c.tilePositionX += dt * 4;
    for (const f of this.flies) {
      const a = t * 0.6 + f.ph;
      f.img.setPosition(f.cx + Math.sin(a) * 60, f.cy + Math.sin(a * 2.3) * 12).setFrame(Math.floor(t * 8 + f.ph) % 2).setFlipX(Math.cos(a) < 0);
    }
    for (const s of this.seats) {
      if (!s?.tap) continue;
      // dripping tap while waiting
      s.dripT -= dt;
      if (s.dripT <= 0) {
        s.dripT = 0.7 + Math.random() * 0.6;
        const d = this.add.image(s.tap.x + 12, s.tap.y + 10, `${ID}-drop`).setScale(S);
        s.pn.c.add(d);
        this.tweens.add({ targets: d, y: d.y + 18, alpha: 0, duration: 450, ease: 'Quad.easeIn', onComplete: () => d.destroy() });
      }
      if (s.flower && s.pot) {
        s.flower.setPosition(s.pot.x + 2, s.pot.y - 20);
        if (s.busy <= 0) s.flower.setAngle(Math.sin(t * 2 + s.p) * 4);
      }
    }
  }

  tick(dt: number): void {
    for (const s of this.seats) {
      if (!s || !this.players.includes(s.p)) continue;
      s.busy = Math.max(0, s.busy - dt);
      if (s.busy <= 0 && s.pending) {
        s.pending = false;
        s.level++;
        this.loadLevel(s, false);
        s.think = this.cpuThink(s);
        s.busy = 0.35;
      }
      this.hudText[s.p] = `${s.solved} ด่าน`;
      if (this.isCpu(s.p) && s.busy <= 0) this.bot(s, dt);
    }
  }

  private bot(s: Seat, dt: number): void {
    s.think -= dt;
    if (s.think > 0 || !s.pz) return;
    const pz = s.pz;
    s.think = (0.3 + Math.random() * 0.4) / s.skill;
    // occasionally fiddle with a wrong tile
    if (Math.random() < 0.1) {
      this.rotate(s, Math.floor(Math.random() * s.masks.length));
      return;
    }
    // follow the water: fix the first path tile that is wrong
    const bad = pz.path.find((i) => (s.masks[i] & pz.need[i]) !== pz.need[i]);
    if (bad !== undefined) {
      this.rotate(s, bad);
      if (Math.random() < 0.25) s.think += 0.5 / s.skill; // "hmm..."
    }
  }

  results(): PlayerResult[] {
    const v = (p: PlayerIndex) => {
      const s = this.seats[p];
      return s.solved * 1000 + Math.round(s.progress * 100) * 2 - Math.min(99, s.lastSolve) / 100;
    };
    return rankBy(this.players, v).map((r) => ({ ...r, score: this.seats[r.player].solved }));
  }
}

// ───────────────────────────── generation ─────────────────────────────

function makePuzzle([cols, rows]: [number, number], r: () => number): Puzzle {
  const n = cols * rows;
  for (let attempt = 0; attempt < 200; attempt++) {
    const r0 = Math.floor(r() * rows), r1 = Math.floor(r() * rows);
    const start = r0 * cols, goal = r1 * cols + cols - 1;
    const path = walk(cols, rows, start, goal, r);
    if (!path) continue;
    const minLen = cols + Math.abs(r1 - r0) + 1;
    if (path.length < minLen || path.length > Math.max(minLen + 4, n * 0.62)) continue;
    const need = new Array(n).fill(0);
    path.forEach((c, k) => {
      const prev = k === 0 ? c - 1 : path[k - 1];
      const next = k === path.length - 1 ? c + 1 : path[k + 1];
      need[c] = dirTo(cols, c, prev) | dirTo(cols, c, next);
    });
    const masks = new Array(n).fill(0).map((_, i) => {
      if (need[i]) {
        // some path tiles get an extra (harmless) branch
        if (bits(need[i]) === 2 && r() < 0.15) return need[i] | [N, E, So, W].filter((b) => !(need[i] & b))[Math.floor(r() * 2)];
        return need[i];
      }
      const roll = r();
      return roll < 0.38 ? 5 : roll < 0.82 ? 3 : roll < 0.97 ? 7 : 15;
    });
    // scramble rotations
    const scrambled = masks.map((m) => {
      let x = m;
      const k = Math.floor(r() * 4);
      for (let i = 0; i < k; i++) x = rot(x);
      return x;
    });
    // make sure several path tiles start wrong
    let wrong = path.filter((c) => (scrambled[c] & need[c]) !== need[c]);
    let guard = 0;
    while (wrong.length < Math.ceil(path.length * 0.6) && guard++ < 50) {
      const c = path[Math.floor(r() * path.length)];
      if ((scrambled[c] & need[c]) === need[c] && scrambled[c] !== 15) scrambled[c] = rot(scrambled[c]);
      wrong = path.filter((x) => (scrambled[x] & need[x]) !== need[x]);
    }
    // the edges hold the tap/pot openings
    need[start] |= W; need[goal] |= E;
    return { cols, rows, r0, r1, start: scrambled, need, path };
  }
  // fallback: straight line
  const path = Array.from({ length: cols }, (_, i) => i);
  const need = new Array(n).fill(0);
  path.forEach((c) => (need[c] = E | W));
  return { cols, rows, r0: 0, r1: 0, start: need.map((m, i) => (m ? N | So : i % 2 ? 3 : 5)), need, path };
}

function bits(m: number): number {
  return (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
}

function dirTo(cols: number, a: number, b: number): number {
  if (b === a - 1) return W;
  if (b === a + 1) return E;
  return b < a - cols / 2 ? N : So;
}

/** Random self-avoiding walk from start to goal (biased toward the goal). */
function walk(cols: number, rows: number, start: number, goal: number, r: () => number): number[] | null {
  const seen = new Set<number>([start]);
  const path = [start];
  let steps = 0;
  const gx = goal % cols, gy = Math.floor(goal / cols);
  const rec = (c: number): boolean => {
    if (c === goal) return true;
    if (steps++ > 4000) return false;
    const cx = c % cols, cy = Math.floor(c / cols);
    const opts = DIRS.map(([, dx, dy]) => [cx + dx, cy + dy] as const)
      .filter(([x, y]) => x >= 0 && y >= 0 && x < cols && y < rows && !seen.has(y * cols + x))
      .map(([x, y]) => ({ c: y * cols + x, w: r() + (Math.abs(gx - x) + Math.abs(gy - y) < Math.abs(gx - cx) + Math.abs(gy - cy) ? 0.45 : 0) }))
      .sort((a, b) => b.w - a.w);
    for (const o of opts) {
      seen.add(o.c);
      path.push(o.c);
      if (rec(o.c)) return true;
      path.pop();
    }
    return false;
  };
  return rec(start) ? path : null;
}

// ───────────────────────────── art ─────────────────────────────

/** Glass pipe with brass flanges; `wet` fills it with water. Tile is A×A art px. */
function paintPipe(p: Painter, m: number, wet: boolean): void {
  const a = A, c0 = Math.floor(a / 2) - 3, c1 = c0 + 6; // pipe spans [c0, c1)
  const rim = 0x55627e, glass = wet ? 0x3d9bff : 0xe4eef8, hi = wet ? 0x9fdcff : 0xffffff, lo = wet ? 0x2a6fd0 : 0xc2cfdf;
  // rims
  if (m & N) p.rect(c0, 0, 6, c1, rim);
  if (m & So) p.rect(c0, c0, 6, a - c0, rim);
  if (m & W) p.rect(0, c0, c1, 6, rim);
  if (m & E) p.rect(c0, c0, a - c0, 6, rim);
  p.rect(c0, c0, 6, 6, rim);
  // glass / water core
  if (m & N) p.rect(c0 + 1, 0, 4, c1 - 1, glass);
  if (m & So) p.rect(c0 + 1, c0 + 1, 4, a - c0 - 1, glass);
  if (m & W) p.rect(0, c0 + 1, c1 - 1, 4, glass);
  if (m & E) p.rect(c0 + 1, c0 + 1, a - c0 - 1, 4, glass);
  p.rect(c0 + 1, c0 + 1, 4, 4, glass);
  // highlights (top/left) and shade (bottom/right)
  if (m & N) { p.vline(c0 + 1, 0, c0 + 1, hi); p.vline(c0 + 4, 0, c0 + 1, lo); }
  if (m & So) { p.vline(c0 + 1, c1 - 1, a - c1 + 1, hi); p.vline(c0 + 4, c1 - 1, a - c1 + 1, lo); }
  if (m & W) { p.hline(0, c0 + 1, c0 + 1, hi); p.hline(0, c0 + 4, c0 + 1, lo); }
  if (m & E) { p.hline(c1 - 1, c0 + 1, a - c1 + 1, hi); p.hline(c1 - 1, c0 + 4, a - c1 + 1, lo); }
  p.px(c0 + 1, c0 + 1, hi);
  if (wet) { p.px(c0 + 2, c0 + 2, 0xffffff); if (m & E) p.px(a - 4, c0 + 2, 0xd2f0ff); if (m & So) p.px(c0 + 2, a - 4, 0xd2f0ff); }
  // brass flanges at the tile edges
  const brass = 0xd4a04a, bl = 0xffd98a, bd = 0x9a6a24;
  if (m & N) { p.rect(c0 - 1, 0, 8, 2, brass); p.hline(c0 - 1, 0, 8, bl); p.px(c1, 1, bd); }
  if (m & So) { p.rect(c0 - 1, a - 2, 8, 2, brass); p.hline(c0 - 1, a - 2, 8, bl); p.hline(c0 - 1, a - 1, 8, bd); }
  if (m & W) { p.rect(0, c0 - 1, 2, 8, brass); p.vline(0, c0 - 1, 8, bl); p.px(1, c1, bd); }
  if (m & E) { p.rect(a - 2, c0 - 1, 2, 8, brass); p.vline(a - 2, c0 - 1, 8, bl); p.vline(a - 1, c0 - 1, 8, bd); }
  // bolt on the hub
  if (bits(m) >= 3) { p.px(c0 + 2, c0 + 2, 0xd4a04a); p.px(c0 + 3, c0 + 3, 0x9a6a24); }
}

import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Avatar } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const ID = 'balance-master';
const CAP = 75;
const BH = 8; // book thickness (world)
const BW = 40; // book width (world)
const HEAD = 52; // feet → top of head
const LEFF = 70; // effective pendulum length for base acceleration
const AMAX = 1500;
const FALL = 0.95;
const FAIL = 0.5;
const BOOK_COLS = [0xd9604a, 0x3d9bff, 0x3ed17a, 0xffc93d, 0x8455d6, 0xff7ab8, 0x3fe0e0, 0xff9f43];

interface Book { img: Phaser.GameObjects.Image; dx: number }

interface Drop { k: number; t0: number; landX: number; img: Phaser.GameObjects.Image; done: boolean }

interface Seat {
  p: PlayerIndex;
  pn: Panel;
  world?: Phaser.GameObjects.Container;
  av?: Avatar;
  floorY: number;
  xb: number;
  vb: number;
  ab: number;
  th: number;
  om: number;
  phi: number;
  phv: number;
  books: Book[];
  drop?: Drop;
  out: boolean;
  anchor?: { id: number; sx: number; xb: number };
  wall?: Phaser.GameObjects.TileSprite;
  offset: number;
  warn?: Phaser.GameObjects.Text;
  sweatT: number;
  creakT: number;
  hist: { t: number; th: number; om: number }[];
  simT: number;
  // CPU
  skill: number;
  delay: number;
  noise: number;
  nT: number;
  nV: number;
}

interface Gust { at: number; dir: number; dur: number; warned: boolean; started: boolean }

/** #39 — Balance a growing tower of books on your head. Slide under it, catch new books, survive the wind. */
export default class BalanceMaster extends BaseMinigame {
  private panels!: PanelKit;
  private seats: Seat[] = [];
  private dropOffs: number[] = [];
  private nextDrop = 0;
  private dropK = 0;
  private gusts: Gust[] = [];
  private wind = 0;
  private windFx: { img: Phaser.GameObjects.Image; p: number; x: number; y: number; v: number }[] = [];
  private banners: Phaser.GameObjects.Text[] = [];
  private clouds: Phaser.GameObjects.TileSprite[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.seats = [];
    this.windFx = [];
    this.banners = [];
    this.clouds = [];
    this.wind = 0;
    const r = rng(3900 + Math.floor(Math.random() * 1e5));
    // same landing offsets for everyone
    this.dropOffs = Array.from({ length: 60 }, (_, i) => (r() - 0.5) * (i < 3 ? 10 : 30));
    this.nextDrop = 1.2;
    this.dropK = 0;
    this.gusts = [];
    for (let t = 13 + r() * 3; t < CAP; t += 8 + r() * 4) this.gusts.push({ at: t, dir: r() < 0.5 ? -1 : 1, dur: 1.5 + r() * 0.6, warned: false, started: false });
    this.panels = new PanelKit(this, { frame: false, inset: 3 });
    this.paintArt();
    for (const pn of this.panels.panels) this.buildPanel(pn);
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    makeSheet(this, `${ID}-book`, 22, 4, BOOK_COLS.length, (p, i) => {
      const c = BOOK_COLS[i];
      const w = 22 - (i % 3);
      const x0 = Math.floor((22 - w) / 2);
      p.rect(x0, 0, w, 4, c);
      p.hline(x0, 0, w, shift(c, 0.35));
      p.hline(x0, 3, w, shift(c, -0.4));
      // page block on one side
      const left = i % 2 === 0;
      p.rect(left ? x0 : x0 + w - 3, 1, 3, 2, 0xfff8e7);
      p.px(left ? x0 + 1 : x0 + w - 2, 2, 0xd8d0bc);
      // spine label
      p.rect(x0 + Math.floor(w / 2) - 3, 1, 6, 2, shift(c, 0.55));
      p.px(x0 + Math.floor(w / 2) - 1, 1, shift(c, -0.3));
      p.vline(left ? x0 + w - 1 : x0, 0, 4, shift(c, -0.55));
    });
    makeTexture(this, `${ID}-wall`, 64, 48, (p) => {
      p.rect(0, 0, 64, 48, 0xf2e6c8);
      for (let y = 0; y < 48; y += 12) p.hline(0, y, 64, 0xeadcb8);
      for (let x = 0; x < 64; x += 16) p.vline(x, 0, 48, 0xede0bf);
      p.px(10, 5, 0xe0d0a8); p.px(40, 30, 0xe0d0a8); p.px(52, 14, 0xe0d0a8);
    });
    makeTexture(this, `${ID}-sky`, 60, 18, (p) => {
      p.gradient(0, 0, 60, 18, [0x7cc8ff, 0xc2e8ff]);
      p.ball(14, 9, 7, 3, 0xffffff, false); p.ball(20, 7, 4, 3, 0xffffff, false);
      p.ball(44, 12, 5, 2.5, 0xffffff, false);
    });
    makeTexture(this, `${ID}-window`, 36, 26, (p) => {
      p.rect(0, 0, 36, 26, 0xf4f4f4);
      for (let y = 2; y < 24; y++) for (let x = 2; x < 34; x++) p.clear(x, y);
      p.rect(17, 2, 2, 22, 0xf4f4f4);
      p.rect(0, 24, 36, 2, 0xd8dbe4);
      p.outline(-0.4);
    });
    makeTexture(this, `${ID}-lockers`, 96, 34, (p) => {
      for (let i = 0; i < 6; i++) {
        const x = i * 16;
        const c = i % 2 ? 0x5a9ad8 : 0x4a88c8;
        p.box(x, 0, 16, 34, c);
        p.vline(x, 0, 34, 0x2b4a78);
        for (let k = 0; k < 3; k++) p.hline(x + 4, 4 + k * 2, 8, shift(c, -0.35));
        p.rect(x + 12, 16, 2, 4, 0xd8dbe4);
      }
      p.hline(0, 33, 96, 0x2b4a78);
    });
    makeTexture(this, `${ID}-poster`, 18, 22, (p) => {
      p.box(0, 0, 18, 22, 0xfff8e7);
      p.ball(9, 8, 5, 5, 0xffc93d, false);
      p.rect(3, 15, 12, 2, 0xff7a85); p.rect(3, 18, 8, 1, 0xb9c2d6);
      p.outline(-0.5);
    });
    makeTexture(this, `${ID}-leaf`, 5, 4, (p) => { p.ellipse(2.5, 2, 2.5, 1.6, 0x58b05a); p.px(1, 1, 0x8fd67a); p.px(4, 3, 0x3e8a4a); });
    makeTexture(this, `${ID}-paper`, 6, 5, (p) => { p.rect(0, 0, 6, 5, 0xffffff); p.hline(1, 1, 4, 0xb9c2d6); p.hline(1, 3, 3, 0xb9c2d6); });
    makeTexture(this, `${ID}-streak`, 14, 1, (p) => { for (let x = 0; x < 14; x++) p.px(x, 0, 0xffffff, Math.round(200 * (x / 14))); });
    makeTexture(this, `${ID}-sweat`, 3, 4, (p) => { p.px(1, 0, 0xbfeaff); p.rect(0, 1, 3, 3, 0x8fd6ff); p.px(0, 1, 0xffffff); });
    for (const q of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[q];
      makeTexture(this, `${ID}-arrow-${q}`, 9, 7, (p) => {
        p.tri(0, 0, 9, 0, 4.5, 6, c.main);
        p.hline(1, 0, 7, c.light);
        p.outline(-0.6);
      });
    }
  }

  private floorKey(w: number): string {
    const aw = Math.ceil(w / S);
    return makeTexture(this, `${ID}-floor-${aw}`, aw, 60, (p) => {
      p.rect(0, 0, aw, 60, 0xc8925a);
      for (let y = 0; y < 60; y += 5) {
        p.hline(0, y, aw, 0xa86e40);
        const off = (y * 7) % 24;
        for (let x = -off; x < aw; x += 24) p.vline(x, y, 5, 0x9a6238);
      }
      p.rect(0, 0, aw, 3, 0x7a4a2c);
      p.hline(0, 0, aw, 0x5e3420);
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

  // ───────────────────────────── build ─────────────────────────────

  private buildPanel(pn: Panel): void {
    const { c, w, h, p } = pn;
    // parallax wall behind everything
    const wall = this.add.tileSprite(0, 0, w / S, h / S, `${ID}-wall`).setScale(S);
    c.add(wall);
    // world layer scrolls down as the tower grows
    const world = this.add.container(0, 0);
    c.add(world);
    const floorY = h / 2 - 24;
    for (const wx of [-w / 2 + 50, w / 2 - 50]) {
      const sky = this.add.tileSprite(wx, floorY - 150, 32, 22, `${ID}-sky`).setScale(S);
      world.add(sky);
      this.clouds.push(sky);
      world.add(this.add.image(wx, floorY - 150, `${ID}-window`).setScale(S));
    }
    world.add(this.add.image(0, floorY - 160, `${ID}-poster`).setScale(S));
    for (const lx of [-96 * S, 0, 96 * S]) world.add(this.add.image(lx, floorY - 34, `${ID}-lockers`).setScale(S));
    world.add(this.add.image(0, floorY + 60, this.floorKey(w)).setScale(S));
    const av = new Avatar(this, p, 0, floorY, { marker: false, depthSort: false });
    if (av.shadow) world.add(av.shadow);
    world.add(av.sprite);
    // mask the scrolling world to this panel
    const g = this.make.graphics({}, false);
    g.fillStyle(0xffffff).fillRect(pn.rect.x + 3, pn.rect.y + 3, pn.rect.width - 6, pn.rect.height - 6);
    world.setMask(g.createGeometryMask());
    const warn = txt(this, 0, -h / 2 + 46, '', { size: 16, color: '#ff8a95', strokeWidth: 4 });
    c.add(warn);
    const banner = txt(this, 0, -h / 2 + 20, '', { size: 17, color: '#bfeaff', strokeWidth: 4 });
    c.add(banner);
    this.banners[p] = banner;
    c.add(this.add.image(0, 0, this.frameKey(p, w, h)).setScale(S));
    const skill = 0.8 + Math.random() * 0.4;
    this.seats[p] = {
      p, pn, world, av, floorY, xb: 0, vb: 0, ab: 0, th: 0, om: 0, phi: 0, phv: 0, books: [], out: false, wall, offset: 0, warn,
      sweatT: 0, creakT: 0, hist: [], simT: 0, skill, delay: (4 + (1.25 - skill) * 10) / 60, noise: 0.012 / skill, nT: 0, nV: 0,
    };
    // wind props (leaves / papers) live in the panel, not the world
    for (let k = 0; k < 5; k++) {
      const img = this.add.image(0, 0, k % 2 ? `${ID}-paper` : `${ID}-leaf`).setScale(S).setVisible(false);
      c.addAt(img, c.getIndex(warn));
      this.windFx.push({ img, p, x: 0, y: 0, v: 0 });
    }
    for (let k = 0; k < 6; k++) {
      const img = this.add.image(0, 0, `${ID}-streak`).setScale(S).setVisible(false).setAlpha(0.7);
      c.addAt(img, c.getIndex(warn));
      this.windFx.push({ img, p, x: 0, y: 0, v: 1 });
    }
  }

  // ───────────────────────────── physics ─────────────────────────────

  private lam2(n: number): number {
    return -1.6 + 0.35 * n + Math.max(0, n - 10) * 0.25;
  }

  private headY(s: Seat): number {
    return s.floorY - HEAD;
  }

  /** Lean including the static offset of sloppily stacked books. */
  private thEff(s: Seat): number {
    const n = s.books.length;
    if (!n) return s.th;
    const bias = s.books.reduce((a, b, i) => a + b.dx * (i + 1), 0) / (n * (n + 1) / 2);
    return s.th + Math.atan(bias / Math.max(BH * 3, (n * BH) / 2)) * 0.6;
  }

  private bookX(s: Seat, i: number): number {
    const n = s.books.length;
    const h = (i + 0.5) * BH;
    const bend = s.phi * Math.pow((i + 1) / Math.max(1, n), 2) * n * 1.6;
    let dx = 0;
    for (let k = 0; k <= i; k++) dx += s.books[k].dx;
    return s.xb + Math.sin(s.th) * h + bend + dx;
  }

  /** Physical top of the tower (no cosmetic flex). */
  private topX(s: Seat): number {
    const n = s.books.length;
    if (!n) return s.xb;
    return s.xb + Math.sin(s.th) * (n - 0.5) * BH + s.books.reduce((a, b) => a + b.dx, 0);
  }

  /** Fixed small sub-steps so the tower behaves the same at any frame rate. */
  private step(s: Seat, dt: number): void {
    const k = Math.max(1, Math.ceil(dt / (1 / 120)));
    for (let i = 0; i < k && !s.out; i++) this.substep(s, dt / k);
  }

  private substep(s: Seat, dt: number): void {
    s.simT += dt;
    const n = s.books.length;
    const bound = s.pn.w / 2 - 26;
    let a = 0;
    if (this.isCpu(s.p)) a = this.cpuAccel(s, dt);
    else {
      const t = this.panels.localTouches(s.p)[0];
      if (t) {
        if (!s.anchor || s.anchor.id !== t.t.pointerId) s.anchor = { id: t.t.pointerId, sx: t.x, xb: s.xb };
        const target = s.anchor.xb + (t.x - s.anchor.sx) * 1.15;
        const vc = Phaser.Math.Clamp((target - s.xb) * 14, -330, 330);
        a = (vc - s.vb) / dt;
      } else {
        s.anchor = undefined;
        a = -s.vb / dt; // stop when the finger lifts
      }
    }
    a = Phaser.Math.Clamp(a, -AMAX, AMAX);
    const v0 = s.vb;
    s.vb += a * dt;
    s.xb += s.vb * dt;
    if (Math.abs(s.xb) > bound) { s.xb = Math.sign(s.xb) * bound; s.vb = 0; }
    s.ab = Phaser.Math.Clamp((s.vb - v0) / dt, -AMAX, AMAX);
    // tower dynamics (inverted pendulum + flex mode)
    const te = this.thEff(s);
    const wobble = Math.sin(this.elapsed * 1.7) * Math.sin(this.elapsed * 0.63 + 1) * 0.25 * (n / 8);
    const windF = this.wind * (0.35 + n * 0.03);
    const acc = this.lam2(n) * Math.sin(te) - (s.ab / LEFF) * Math.cos(te) - 0.9 * s.om + wobble + windF;
    s.om += acc * dt;
    s.th += s.om * dt;
    s.phv += (-60 * s.phi - 7 * s.phv - s.ab * 0.004 + windF * 0.6) * dt;
    s.phi += s.phv * dt;
    s.hist.push({ t: s.simT, th: te, om: s.om });
    while (s.hist.length > 2 && s.hist[1].t < s.simT - 0.5) s.hist.shift();
    if (n > 0 && Math.abs(this.thEff(s)) > FAIL + Math.max(0, 4 - n) * 0.08) this.collapse(s);
  }

  private cpuAccel(s: Seat, dt: number): number {
    const n = s.books.length;
    // react to what the tower looked like a moment ago (reaction time)
    let old = s.hist[s.hist.length - 1] ?? { t: 0, th: s.th, om: s.om };
    for (let i = s.hist.length - 1; i >= 0; i--) { old = s.hist[i]; if (old.t <= s.simT - s.delay) break; }
    s.nT -= dt;
    if (s.nT <= 0) { s.nT = 0.15 + Math.random() * 0.2; s.nV = (Math.random() - 0.5) * 2 * s.noise * (1 + n * 0.08); }
    const th = old.th + s.nV, om = old.om;
    const k1 = Math.max(0, this.lam2(n)) + 5 * s.skill, k2 = 3 * s.skill;
    // goal: under the falling book, else the middle
    let goal = 0;
    if (s.drop && !s.drop.done) goal = s.xb + (s.drop.landX - this.topX(s));
    // tall towers: lean toward the goal first (cascaded control); short ones: just walk there
    const thd = Phaser.Math.Clamp(0.004 * (goal - s.xb) - 0.004 * s.vb, -0.2, 0.2);
    const wd = Phaser.Math.Clamp(-this.lam2(n) / 1.2, 0, 1);
    return (1 - wd) * LEFF * (k1 * (th - thd) + k2 * om) + wd * (14 * (goal - s.xb) - 7 * s.vb + LEFF * (k1 * th + k2 * om) * 0.3);
  }

  // ───────────────────────────── books ─────────────────────────────

  private spawnDrops(): void {
    const k = this.dropK++;
    for (const s of this.seats) {
      if (!this.alive(s.p) || s.out) continue;
      const landX = Phaser.Math.Clamp(this.topX(s) * 0.6 + this.dropOffs[k % this.dropOffs.length], -s.pn.w / 2 + 50, s.pn.w / 2 - 50);
      const img = this.add.image(landX, -999, `${ID}-book`, k % BOOK_COLS.length).setScale(S);
      s.world!.add(img);
      s.drop = { k, t0: this.elapsed, landX, img, done: false };
    }
    Audio.sfx('whoosh', 1.3);
  }

  private updateDrop(s: Seat): void {
    const d = s.drop;
    if (!d || d.done) return;
    const f = (this.elapsed - d.t0) / FALL;
    const topY = this.headY(s) - s.books.length * BH - BH / 2;
    const startY = -s.pn.h / 2 - s.offset - 10;
    d.img.setPosition(d.landX, startY + (topY - startY) * Math.min(1, f * f));
    if (f < 1) return;
    d.done = true;
    const raw = d.landX - this.topX(s);
    const edge = Math.abs(raw) > BW * 0.55;
    const off = Phaser.Math.Clamp(raw, -BW * 0.55, BW * 0.55);
    // every book lands on your tower; being under it keeps the tower straight
    d.img.setX(this.topX(s) + off);
    s.books.push({ img: d.img, dx: off * 0.45 });
    s.om += off * 0.011 + (edge ? Math.sign(raw) * 0.15 : 0) + (Math.random() - 0.5) * 0.02;
    s.phv -= off * 0.4;
    this.score[s.p] = s.books.length;
    this.addScore(s.p, 0);
    Audio.sfx(edge ? 'hit' : 'land', 1 + s.p * 0.05);
    Audio.sfx('drum', 1.3);
    Vfx.squash(this, d.img, 1.25, 0.7, 140);
    const w = this.panels.toWorld(s.p, d.img.x, topY + s.offset);
    burst(this, w.x, w.y, { tex: 'dust', count: 5, tint: [0xffffff, 0xe9e2d0], speed: [20, 60], angle: [180, 360], life: 300, scale: [S * 0.6, 0] });
    if (edge) Vfx.popText(this, w.x, w.y - 12, 'เกือบหล่น!', '#ff8a95', 13, this.angleFor(s.p));
    else if (Math.abs(raw) < 6) Vfx.popText(this, w.x, w.y - 12, 'ตรงเป๊ะ!', '#bff7d4', 12, this.angleFor(s.p));
    if (s.books.length % 5 === 0) {
      Vfx.popText(this, w.x, w.y - 30, `${s.books.length} เล่ม!`, toCss(PLAYER_COLORS[s.p].light), 16, this.angleFor(s.p));
      Audio.sfx('coin', 1 + s.p * 0.08);
    }
  }

  private collapse(s: Seat): void {
    if (s.out) return;
    s.out = true;
    const dir = Math.sign(this.thEff(s)) || 1;
    Audio.sfx('bigHit', 1 + s.p * 0.05);
    Vfx.shake(this, 0.004, 160);
    s.books.forEach((b, i) => {
      const img = b.img;
      const fx = img.x + dir * (30 + i * 9 + Math.random() * 20);
      this.tweens.add({ targets: img, x: fx, y: s.floorY - 4 - (i % 3) * 8, angle: dir * (90 + Math.random() * 180), duration: 380 + i * 40, delay: (s.books.length - i) * 25, ease: 'Quad.easeIn' });
    });
    if (s.drop && !s.drop.done) { s.drop.done = true; s.drop.img.destroy(); }
    s.av?.play('hit', true);
    this.time.delayedCall(450, () => s.av?.play('lose', true));
    const w = this.panels.toWorld(s.p, 0, -20);
    Vfx.popText(this, w.x, w.y, 'ล้มแล้ว!', '#ff8a95', 22, this.angleFor(s.p));
    s.warn?.setText(`สูงสุด ${s.books.length} เล่ม`).setColor('#fff8e7');
    this.eliminate(s.p);
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    const t = this.time.now / 1000;
    for (const c of this.clouds) c.tilePositionX += dt * 3;
    for (const s of this.seats) {
      // camera: keep the top of the tower in view
      const topY = this.headY(s) - s.books.length * BH;
      const want = Math.max(0, -s.pn.h / 2 + 64 - topY);
      s.offset += (want - s.offset) * Math.min(1, dt * 3);
      s.world!.y = s.offset;
      s.wall!.tilePositionY = -s.offset * 0.35 / S;
      const av = s.av!;
      if (!s.out) {
        av.setPos(s.xb, s.floorY);
        if (Math.abs(s.vb) > 25) { av.play('walk'); av.face(s.vb); } else av.play(Math.abs(this.thEff(s)) > 0.3 ? 'stun' : 'idle');
        s.books.forEach((b, i) => b.img.setPosition(this.bookX(s, i), this.headY(s) - (i + 0.5) * BH));
        // nervous sweat when it leans a lot
        const lean = Math.abs(this.thEff(s));
        s.sweatT -= dt;
        if (lean > 0.28 && s.sweatT <= 0 && s.books.length) {
          s.sweatT = 0.35;
          const sw = this.add.image(s.xb + (Math.random() < 0.5 ? -10 : 10), this.headY(s) + 10, `${ID}-sweat`).setScale(S);
          s.world!.add(sw);
          this.tweens.add({ targets: sw, y: sw.y + 14, alpha: 0, duration: 420, onComplete: () => sw.destroy() });
        }
        if (s.warn && this.state === 'play') {
          const label = lean > 0.33 ? (this.thEff(s) > 0 ? 'เอียงขวา! →' : '← เอียงซ้าย!') : '';
          if (s.warn.text !== label) s.warn.setText(label);
          s.warn.setAlpha(0.6 + Math.sin(t * 16) * 0.4);
        }
      }
    }
    // wind props
    for (const f of this.windFx) {
      const pn = this.panels.panel(f.p as PlayerIndex);
      const active = Math.abs(this.wind) > 0.01 && this.state === 'play';
      if (!active) { f.img.setVisible(false); continue; }
      const dir = Math.sign(this.wind);
      if (!f.img.visible) {
        f.img.setVisible(true);
        f.x = -dir * (pn.w / 2) + Math.random() * pn.w * 0.3 * dir;
        f.y = (Math.random() - 0.5) * (pn.h - 60);
      }
      f.x += dir * (f.v ? 420 : 200) * dt;
      f.y += Math.sin(t * 5 + f.x * 0.05) * (f.v ? 0 : 40) * dt;
      if (Math.abs(f.x) > pn.w / 2 - 8) { f.x = -dir * (pn.w / 2 - 10); f.y = (Math.random() - 0.5) * (pn.h - 60); }
      f.img.setPosition(f.x, f.y).setFlipX(dir < 0);
      if (!f.v) f.img.setAngle(f.img.angle + dir * 400 * dt);
    }
  }

  tick(dt: number): void {
    // wind schedule (same for everyone)
    this.wind = 0;
    for (const g of this.gusts) {
      if (!g.warned && this.elapsed >= g.at - 1.3) {
        g.warned = true;
        for (const b of this.banners) {
          b.setText(g.dir > 0 ? 'ระวังลม! →→' : '←← ระวังลม!');
          this.tweens.add({ targets: b, scale: { from: 1.4, to: 1 }, duration: 250, ease: 'Back.easeOut' });
        }
        Audio.sfx('stun');
      }
      if (this.elapsed >= g.at && this.elapsed < g.at + g.dur) {
        if (!g.started) { g.started = true; Audio.sfx('whoosh', 0.6); Audio.sfx('whoosh', 0.8); }
        const k = (this.elapsed - g.at) / g.dur;
        this.wind = g.dir * Math.sin(k * Math.PI) * 1.0;
      }
      if (g.started && this.elapsed >= g.at + g.dur && this.elapsed < g.at + g.dur + dt * 1.5) for (const b of this.banners) b.setText('');
    }
    // books
    if (this.elapsed >= this.nextDrop) {
      this.spawnDrops();
      this.nextDrop = this.elapsed + Math.max(2.4, 3.3 - this.elapsed * 0.012);
    }
    for (const s of this.seats) {
      if (!this.alive(s.p) || s.out) continue;
      this.step(s, dt);
      this.updateDrop(s);
      this.hudText[s.p] = `${s.books.length} เล่ม`;
      // creak sound when in danger
      s.creakT -= dt;
      if (Math.abs(this.thEff(s)) > 0.36 && s.creakT <= 0 && !s.out) { s.creakT = 0.3; Audio.sfx('tick', 0.6 + s.p * 0.05); }
    }
    if (this.elapsed >= CAP) this.finish();
  }
}

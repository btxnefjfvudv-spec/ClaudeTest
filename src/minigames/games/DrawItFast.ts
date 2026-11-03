import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const ID = 'draw-it-fast';
const ROUNDS = 5;
const DRAW_T = 9;
const INTRO_T = 1.3;
const REVIEW_T = 1.8;
const SCALE = 74; // shape half-size in world units
const CY = 8; // shape centre (local y)
const SPACING = 9; // checkpoint spacing (world)
const HIT_R = 17;
const TOL = 12;
const STRAY = 38;

type Pt = { x: number; y: number };

interface ShapeDef { name: string; th: string; pts: Pt[] }

function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number, rx = r): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * r };
  });
}

const SHAPES: ShapeDef[] = [
  { name: 'circle', th: 'วงกลม', pts: arc(0, 0, 0.92, -Math.PI / 2, Math.PI * 1.5, 48) },
  {
    name: 'star', th: 'ดาว',
    pts: Array.from({ length: 11 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 0.42 : 1;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r + 0.08 };
    }),
  },
  {
    name: 'heart', th: 'หัวใจ',
    pts: Array.from({ length: 61 }, (_, i) => {
      const t = (i / 60) * Math.PI * 2;
      return { x: (16 * Math.sin(t) ** 3) / 17, y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 - 0.1 };
    }),
  },
  { name: 'house', th: 'บ้าน', pts: [{ x: -0.75, y: 0.95 }, { x: -0.75, y: -0.1 }, { x: 0, y: -0.95 }, { x: 0.75, y: -0.1 }, { x: 0.75, y: 0.95 }, { x: -0.75, y: 0.95 }, { x: 0.75, y: -0.1 }, { x: -0.75, y: -0.1 }] },
  { name: 'bolt', th: 'สายฟ้า', pts: [{ x: 0.4, y: -1 }, { x: -0.45, y: 0.08 }, { x: 0.3, y: 0.08 }, { x: -0.4, y: 1 }] },
  { name: 'five', th: 'เลข 5', pts: [{ x: 0.55, y: -0.95 }, { x: -0.45, y: -0.95 }, { x: -0.52, y: -0.08 }, ...arc(-0.02, 0.38, 0.56, -2.45, 2.55, 30, 0.6)] },
  {
    name: 'eight', th: 'เลข 8',
    pts: Array.from({ length: 65 }, (_, i) => {
      const t = (i / 64) * Math.PI * 2;
      return { x: 0.55 * Math.sin(2 * t) * (Math.cos(t) > 0 ? 0.88 : 1), y: -0.96 * Math.cos(t) + 0.02 };
    }),
  },
];

interface Seat {
  p: PlayerIndex;
  pn: Panel;
  rt?: Phaser.GameObjects.RenderTexture;
  idx: number;
  hits: number;
  good: number;
  bad: number;
  drawing: boolean;
  last?: Pt;
  done: boolean;
  doneT: number;
  roundPts: number;
  total: number;
  marker?: Phaser.GameObjects.Image;
  startMark?: Phaser.GameObjects.Image;
  stamp?: Phaser.GameObjects.Container;
  warnCd: number;
  // CPU
  cpuS: number;
  cpuDelay: number;
  cpuSpeed: number;
  cpuNoise: number;
  cpuPh: number;
  cpuSkill: number;
}

/** #36 — Trace the dotted chalk shape: stay on the line, hit every dot in order, be quick. 5 shapes. */
export default class DrawItFast extends BaseMinigame {
  private panels!: PanelKit;
  private seats: Seat[] = [];
  private order: number[] = [];
  private round = -1;
  private phase: 'intro' | 'draw' | 'review' = 'intro';
  private phaseT = 0;
  private cps: Pt[] = [];
  private cum: number[] = [];
  private guides: Phaser.GameObjects.Image[] = [];
  private titles: Phaser.GameObjects.Text[] = [];
  private bars: Phaser.GameObjects.Rectangle[] = [];
  private glares: Phaser.GameObjects.Image[] = [];
  private dust: { img: Phaser.GameObjects.Image; x: number; y: number; v: number; ph: number }[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.seats = [];
    this.guides = [];
    this.titles = [];
    this.bars = [];
    this.glares = [];
    this.dust = [];
    this.round = -1;
    this.phase = 'intro';
    this.phaseT = 0;
    // 5 different shapes, same order for everyone
    const ids = [...SHAPES.keys()];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    this.order = ids.slice(0, ROUNDS);
    this.panels = new PanelKit(this, { frame: false, inset: 3 });
    this.paintArt();
    for (const pn of this.panels.panels) this.buildPanel(pn);
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    makeTexture(this, `${ID}-chalk`, 2, 2, (p) => { p.rect(0, 0, 2, 2, 0xffffff); });
    makeTexture(this, `${ID}-chalk3`, 3, 3, (p) => { p.rect(0, 1, 3, 1, 0xffffff); p.rect(1, 0, 1, 3, 0xffffff); p.px(0, 0, 0xffffff, 120); p.px(2, 2, 0xffffff, 120); });
    makeTexture(this, `${ID}-next`, 9, 9, (p) => {
      p.ring(4.5, 4.5, 4.4, 0xffffff, 1);
      p.circle(4.5, 4.5, 2, 0xffe066);
    });
    makeTexture(this, `${ID}-start`, 15, 15, (p) => {
      p.ball(7.5, 7.5, 7, 7, 0x3ed17a);
      p.tri(5.5, 4, 5.5, 11, 11, 7.5, 0xffffff);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-glare`, 30, 60, (p) => {
      for (let y = 0; y < 60; y++) for (let x = 0; x < 30; x++) {
        const d = Math.abs(x - 15 - (y - 30) * 0.35) / 15;
        if (d < 1) p.px(x, y, 0xffffff, Math.round((1 - d) * 26));
      }
    });
    makeTexture(this, `${ID}-dust`, 1, 1, (p) => p.px(0, 0, 0xffffff));
    makeTexture(this, `${ID}-sticker`, 20, 20, (p) => {
      // gold star sticker
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 4 : 9.5;
        pts.push([10 + Math.cos(a) * r, 10.5 + Math.sin(a) * r]);
      }
      for (let i = 0; i < 10; i++) p.tri(10, 10.5, pts[i][0], pts[i][1], pts[(i + 1) % 10][0], pts[(i + 1) % 10][1], 0xffc93d);
      p.tri(10, 10.5, pts[9][0], pts[9][1], pts[0][0], pts[0][1], 0xffe066);
      p.px(8, 7, 0xfff3c0); p.px(9, 6, 0xfff3c0);
      p.outline(-0.7);
    });
    for (const [i, sh] of SHAPES.entries()) {
      // dotted guide at art resolution (shape box ±SCALE+6)
      const half = Math.ceil((SCALE + 8) / S);
      makeTexture(this, `${ID}-guide-${i}`, half * 2, half * 2, (p) => {
        const pts = resample(sh.pts.map((q) => ({ x: q.x * SCALE, y: q.y * SCALE })), 7);
        pts.forEach((q, k) => {
          const x = Math.round(q.x / S + half), y = Math.round(q.y / S + half);
          const a = 150 + (k % 2) * 40;
          p.px(x, y, 0xe8f3ec, a); p.px(x + 1, y, 0xe8f3ec, a); p.px(x, y + 1, 0xe8f3ec, a); p.px(x + 1, y + 1, 0xcfe0d6, a);
        });
      });
    }
  }

  private boardKey(w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    return makeTexture(this, `${ID}-board-${aw}x${ah}`, aw, ah, (p) => {
      // wooden frame
      p.rect(0, 0, aw, ah, 0x8a4f2c);
      p.hline(0, 0, aw, 0xb06a3c); p.vline(0, 0, ah, 0xb06a3c);
      p.hline(0, ah - 1, aw, 0x5e3420); p.vline(aw - 1, 0, ah, 0x5e3420);
      for (let x = 3; x < aw; x += 9) p.px(x, 2, 0x9e5c34);
      // board
      const bx = 5, by = 4, bw = aw - 10, bh = ah - 14;
      p.rect(bx, by, bw, bh, 0x2f5d47);
      const r = rng(8);
      for (let i = 0; i < bw * bh * 0.08; i++) p.px(bx + Math.floor(r() * bw), by + Math.floor(r() * bh), r() > 0.5 ? 0x356650 : 0x2a5540);
      // old eraser smudges
      for (let i = 0; i < 9; i++) {
        const sx = bx + 4 + Math.floor(r() * (bw - 30)), sy = by + 4 + Math.floor(r() * (bh - 10));
        for (let k = 0; k < 18; k++) p.px(sx + k + Math.floor(r() * 3), sy + Math.floor(r() * 4), 0x3f7259);
      }
      p.hline(bx, by, bw, 0x1f3f30); p.vline(bx, by, bh, 0x1f3f30);
      // chalk tray
      p.rect(2, ah - 10, aw - 4, 4, 0x7a4426);
      p.hline(2, ah - 10, aw - 4, 0xa0603a);
      p.rect(aw / 2 - 30, ah - 12, 7, 2, 0xfff8e7); p.rect(aw / 2 - 20, ah - 12, 5, 2, 0xffb3bd); p.rect(aw / 2 + 22, ah - 12, 6, 2, 0xa8d3ff);
      p.box(aw / 2 + 4, ah - 13, 12, 3, 0x6b6f86); p.rect(aw / 2 + 4, ah - 11, 12, 1, 0xd8dbe4);
      // a tiny doodle in a corner (smiley)
      p.ring(bx + bw - 12, by + 8, 4, 0x6f9c86, 1); p.px(bx + bw - 13, by + 7, 0x6f9c86); p.px(bx + bw - 11, by + 7, 0x6f9c86); p.hline(bx + bw - 13, by + 10, 3, 0x6f9c86);
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
    c.add(this.add.image(0, 0, this.boardKey(w, h)).setScale(S));
    const glare = this.add.image(-w / 2, 0, `${ID}-glare`).setScale(S).setAlpha(0.8);
    c.add(glare);
    this.glares.push(glare);
    const dr = rng(30 + p);
    for (let i = 0; i < 8; i++) {
      const img = this.add.image(0, 0, `${ID}-dust`).setScale(S).setAlpha(0.4);
      c.add(img);
      this.dust.push({ img, x: (dr() - 0.5) * (w - 30), y: (dr() - 0.5) * (h - 40), v: 3 + dr() * 5, ph: dr() * 9 });
    }
    const guide = this.add.image(0, CY, `${ID}-guide-0`).setScale(S).setAlpha(0);
    c.add(guide);
    this.guides[p] = guide;
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    const rt = this.add.renderTexture(0, 0, aw, ah).setScale(S);
    c.add(rt);
    const startMark = this.add.image(0, 0, `${ID}-start`).setScale(S).setVisible(false);
    const marker = this.add.image(0, 0, `${ID}-next`).setScale(S).setVisible(false);
    c.add([startMark, marker]);
    const title = txt(this, 0, -h / 2 + 15, '', { size: 14, color: '#fffbe0', stroke: '#1f3a2c', strokeWidth: 3 });
    c.add(title);
    this.titles[p] = title;
    const bar = this.add.rectangle(-60, -h / 2 + 27, 120, 3, 0xfff8e7, 0.85).setOrigin(0, 0.5);
    c.add(bar);
    this.bars[p] = bar;
    c.add(this.add.image(0, 0, this.frameKey(p, w, h)).setScale(S));
    this.seats[p] = {
      p, pn, rt, idx: 0, hits: 0, good: 0, bad: 0, drawing: false, done: false, doneT: 0, roundPts: 0, total: 0,
      marker, startMark, warnCd: 0,
      cpuS: 0, cpuDelay: 0, cpuSpeed: 0, cpuNoise: 0, cpuPh: Math.random() * 10, cpuSkill: 0.8 + Math.random() * 0.4,
    };
  }

  // ───────────────────────────── rounds ─────────────────────────────

  onStart(): void {
    this.nextRound();
  }

  private nextRound(): void {
    this.round++;
    if (this.round >= ROUNDS) {
      this.finish();
      return;
    }
    const si = this.order[this.round];
    const sh = SHAPES[si];
    this.cps = resample(sh.pts.map((q) => ({ x: q.x * SCALE, y: q.y * SCALE + CY })), SPACING);
    this.cum = [0];
    for (let i = 1; i < this.cps.length; i++) this.cum.push(this.cum[i - 1] + dist(this.cps[i - 1], this.cps[i]));
    this.phase = 'intro';
    this.phaseT = 0;
    Audio.sfx('whoosh');
    for (const s of this.seats) {
      s.idx = 0; s.hits = 0; s.good = 0; s.bad = 0; s.drawing = false; s.last = undefined; s.done = false; s.doneT = 0; s.roundPts = 0;
      s.rt?.clear();
      s.stamp?.destroy();
      s.stamp = undefined;
      const g = this.guides[s.p];
      g.setTexture(`${ID}-guide-${si}`).setAlpha(0).setScale(S * 0.6);
      this.tweens.add({ targets: g, alpha: 1, scale: S, duration: 380, ease: 'Back.easeOut' });
      this.titles[s.p].setText(`รูปที่ ${this.round + 1}/${ROUNDS} · ${sh.th}`);
      this.tweens.add({ targets: this.titles[s.p], scale: { from: 1.3, to: 1 }, duration: 250 });
      const a = this.cps[0], b = this.cps[1];
      s.startMark?.setPosition(a.x, a.y).setVisible(true).setRotation(Math.atan2(b.y - a.y, b.x - a.x)).setAlpha(0);
      if (s.startMark) this.tweens.add({ targets: s.startMark, alpha: 1, duration: 200, delay: 300 });
      s.marker?.setVisible(false);
      s.cpuS = 0;
      s.cpuDelay = 0.25 + Math.random() * 0.5;
      s.cpuSpeed = (150 + Math.random() * 70) * s.cpuSkill;
      s.cpuNoise = (4 + Math.random() * 9) / s.cpuSkill;
      this.bars[s.p].setScale(1, 1);
    }
  }

  ambient(dt: number): void {
    const t = this.time.now / 1000;
    const pw = this.panels.panel(0).w;
    const span = pw - 90;
    const f = ((t * 20) % span) / span;
    for (const g of this.glares) g.setX(-pw / 2 + 45 + f * span).setAlpha(Math.sin(f * Math.PI) * 0.9);
    for (const d of this.dust) {
      d.y -= d.v * dt;
      if (d.y < -110) d.y = 110;
      d.img.setPosition(d.x + Math.sin(t + d.ph) * 6, d.y).setAlpha(0.25 + 0.25 * Math.sin(t * 2 + d.ph));
    }
    for (const s of this.seats) {
      if (s.startMark?.visible) s.startMark.setScale(S * (1 + Math.sin(t * 8) * 0.08));
      if (s.marker?.visible) s.marker.setScale(S * (1 + Math.sin(t * 10) * 0.15));
    }
  }

  tick(dt: number): void {
    this.phaseT += dt;
    if (this.phase === 'intro') {
      if (this.phaseT >= INTRO_T * 0.4) for (const s of this.seats) if (this.players.includes(s.p) && !this.isCpu(s.p)) this.human(s);
      if (this.phaseT >= INTRO_T) { this.phase = 'draw'; this.phaseT = 0; Audio.sfx('go'); }
      return;
    }
    if (this.phase === 'review') {
      if (this.phaseT >= REVIEW_T) this.nextRound();
      return;
    }
    const left = Math.max(0, 1 - this.phaseT / DRAW_T);
    for (const s of this.seats) {
      s.warnCd = Math.max(0, s.warnCd - dt);
      if (!this.players.includes(s.p)) continue;
      if (!s.done) this.bars[s.p].setScale(left, 1).setFillStyle(left < 0.3 ? 0xff8a95 : 0xfff8e7, 0.85);
      if (s.done) continue;
      if (this.isCpu(s.p)) this.bot(s, dt);
      else this.human(s);
    }
    const active = this.seats.filter((s) => this.players.includes(s.p));
    if (this.phaseT >= DRAW_T || active.every((s) => s.done)) this.review();
  }

  private human(s: Seat): void {
    const touches = this.panels.localTouches(s.p);
    if (!touches.length) {
      s.drawing = false;
      s.last = undefined;
      return;
    }
    this.feed(s, { x: touches[0].x, y: touches[0].y });
  }

  /** Feed one finger position (local coords) into the tracer. */
  private feed(s: Seat, pt: Pt): void {
    if (s.done) return;
    const cps = this.cps;
    if (!s.drawing) {
      const target = cps[Math.min(s.idx, cps.length - 1)];
      if (dist(pt, target) > HIT_R + 10) {
        if (s.warnCd <= 0 && !s.last && this.phase === 'draw') {
          s.warnCd = 1.2;
          const m = s.idx === 0 ? s.startMark : s.marker;
          if (m) this.tweens.add({ targets: m, angle: { from: -15, to: 15 }, yoyo: true, duration: 80, repeat: 2, onComplete: () => m.setAngle(0) });
          if (s.idx === 0 && s.startMark) s.startMark.setRotation(Math.atan2(cps[1].y - cps[0].y, cps[1].x - cps[0].x));
        }
        s.last = pt;
        return;
      }
      if (this.phase !== 'draw') { s.last = pt; return; }
      s.drawing = true;
      s.last = pt;
      if (s.idx === 0) {
        s.startMark?.setVisible(false);
        Audio.sfx('select', 1 + s.p * 0.1);
      }
    }
    if (this.phase !== 'draw') return;
    const last = s.last ?? pt;
    const len = dist(last, pt);
    const steps = Math.max(1, Math.ceil(len / 3));
    const col = PLAYER_COLORS[s.p];
    for (let k = 1; k <= steps; k++) {
      const q = { x: last.x + ((pt.x - last.x) * k) / steps, y: last.y + ((pt.y - last.y) * k) / steps };
      const d = this.nearWindow(q, s.idx);
      const seg = len / steps;
      const ok = d < TOL;
      if (ok) s.good += seg; else s.bad += seg;
      this.ink(s, q, ok ? col.light : 0xff8a95);
      if (d > STRAY) {
        // fell off the line: lift and come back to the marker
        s.drawing = false;
        s.last = undefined;
        Audio.sfx('wrong', 1.2);
        const w = this.panels.toWorld(s.p, q.x, q.y - 16);
        Vfx.popText(this, w.x, w.y, 'หลุดเส้น!', '#ff8a95', 13, this.angleFor(s.p));
        this.showMarker(s);
        return;
      }
      // advance through checkpoints (allow skipping a couple, counted as misses)
      for (let j = s.idx; j < Math.min(cps.length, s.idx + 4); j++) {
        if (dist(q, cps[j]) < HIT_R) {
          s.hits += 1;
          s.idx = j + 1;
          break;
        }
      }
      if (s.idx >= cps.length) {
        this.complete(s);
        return;
      }
    }
    s.last = pt;
    this.showMarker(s);
  }

  private showMarker(s: Seat): void {
    const m = s.marker!;
    const c = this.cps[Math.min(s.idx, this.cps.length - 1)];
    m.setVisible(true).setPosition(c.x, c.y);
  }

  /** Distance to the path near the current checkpoint (no shortcuts across the shape). */
  private nearWindow(q: Pt, idx: number): number {
    const cps = this.cps;
    let best = 1e9;
    const a = Math.max(0, idx - 3), b = Math.min(cps.length - 1, idx + 5);
    for (let i = a; i < b; i++) best = Math.min(best, segDist(q, cps[i], cps[i + 1]));
    if (a === b) best = dist(q, cps[a]);
    return best;
  }

  private ink(s: Seat, q: Pt, color: number): void {
    const pn = s.pn;
    const x = Math.floor((q.x + pn.w / 2) / S), y = Math.floor((q.y + pn.h / 2) / S);
    s.rt?.draw(`${ID}-chalk3`, x - 1, y - 1, 1, color);
  }

  private complete(s: Seat): void {
    s.done = true;
    s.doneT = this.phaseT;
    s.drawing = false;
    s.marker?.setVisible(false);
    const n = this.cps.length;
    const coverage = Math.min(1, s.hits / n);
    const precision = s.good / Math.max(1, s.good + s.bad);
    const acc = coverage * (0.35 + 0.65 * precision);
    const speed = Math.round(50 * Phaser.Math.Clamp((7.5 - s.doneT) / 6, 0, 1));
    s.roundPts = Math.round(acc * 100) + speed;
    this.award(s, acc, speed, true);
  }

  private award(s: Seat, acc: number, speed: number, finished: boolean): void {
    s.total += s.roundPts;
    this.addScore(s.p, s.roundPts);
    const col = PLAYER_COLORS[s.p];
    const pct = Math.round(acc * 100);
    const grade = !finished ? 'ยังไม่เสร็จ' : pct >= 85 ? 'เยี่ยม!' : pct >= 65 ? 'ดีมาก!' : pct >= 40 ? 'พอใช้' : 'เบี้ยวไปหน่อย';
    const stamp = this.add.container(0, CY);
    const stars = !finished ? 0 : pct >= 85 ? 3 : pct >= 65 ? 2 : pct >= 40 ? 1 : 0;
    for (let i = 0; i < 3; i++) {
      const st = this.add.image(-44 + i * 44, -26, `${ID}-sticker`).setScale(S).setAlpha(i < stars ? 1 : 0.18).setTint(i < stars ? 0xffffff : 0x2a5540);
      stamp.add(st);
      if (i < stars) {
        st.setScale(0);
        this.tweens.add({ targets: st, scale: S, angle: { from: -40, to: 0 }, delay: 120 + i * 130, duration: 260, ease: 'Back.easeOut' });
        this.time.delayedCall(120 + i * 130, () => Audio.sfx('coin', 1 + i * 0.12 + s.p * 0.05));
      }
    }
    stamp.add(txt(this, 0, 8, grade, { size: 18, color: finished ? '#ffe066' : '#ff8a95', strokeWidth: 4 }));
    stamp.add(txt(this, 0, 30, `แม่น ${pct}%${speed ? `  ⚡+${speed}` : ''}`, { size: 12, color: toCss(col.light), strokeWidth: 3 }));
    stamp.add(txt(this, 0, 50, `+${s.roundPts}`, { size: 16, color: '#ffffff', strokeWidth: 4 }));
    s.pn.c.add(stamp);
    s.stamp = stamp;
    this.tweens.add({ targets: stamp, scale: { from: 0.4, to: 1 }, duration: 280, ease: 'Back.easeOut' });
    if (finished) {
      Audio.sfx(stars >= 2 ? 'power' : 'right', 1 + s.p * 0.08);
      const w = this.panels.toWorld(s.p, 0, CY);
      Vfx.sparkle(this, w.x, w.y, [col.light, 0xffffff, 0xffe066]);
      if (stars === 3) burst(this, w.x, w.y, { tex: 'star', count: 14, tint: [0xffe066, 0xffffff, col.light], speed: [80, 180], life: 700 });
    }
  }

  private review(): void {
    this.phase = 'review';
    this.phaseT = 0;
    for (const s of this.seats) {
      if (!this.players.includes(s.p) || s.done) continue;
      // time up: partial credit for what was traced
      s.done = true;
      s.marker?.setVisible(false);
      s.startMark?.setVisible(false);
      const n = this.cps.length;
      const coverage = Math.min(1, s.hits / n);
      const precision = s.good / Math.max(1, s.good + s.bad);
      const acc = coverage * (0.35 + 0.65 * precision);
      s.roundPts = Math.round(acc * 60);
      this.award(s, acc, 0, false);
    }
    Audio.sfx('drum');
  }

  private bot(s: Seat, dt: number): void {
    if (s.cpuDelay > 0) { s.cpuDelay -= dt; return; }
    const total = this.cum[this.cum.length - 1];
    // slow down on sharp corners
    const i = Math.min(this.cps.length - 2, s.idx);
    const corner = i > 0 && i < this.cps.length - 1 ? turn(this.cps[i - 1], this.cps[i], this.cps[i + 1]) : 0;
    const v = s.cpuSpeed * (1 - Math.min(0.5, corner * 0.5));
    s.cpuS = Math.min(total, s.cpuS + v * dt);
    s.cpuPh += dt * (2.5 + s.cpuNoise * 0.2);
    const pos = at(this.cps, this.cum, s.cpuS);
    const n = s.cpuNoise * (Math.sin(s.cpuPh * 1.7) * 0.7 + Math.sin(s.cpuPh * 4.3) * 0.3);
    const wobble = Math.random() < 0.004 ? 30 : 0;
    const pt = { x: pos.x + pos.nx * (n + wobble), y: pos.y + pos.ny * (n + wobble) };
    this.feed(s, pt);
    if (!s.drawing) {
      // lost the line: back up a little and try again
      s.cpuS = Math.max(0, this.cum[Math.min(s.idx, this.cum.length - 1)] - 4);
      s.cpuDelay = 0.3;
    }
  }

  results(): PlayerResult[] {
    return rankBy(this.players, (p) => this.seats[p].total);
  }
}

// ───────────────────────────── geometry ─────────────────────────────

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segDist(q: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Phaser.Math.Clamp(((q.x - a.x) * dx + (q.y - a.y) * dy) / l2, 0, 1);
  return Math.hypot(q.x - (a.x + dx * t), q.y - (a.y + dy * t));
}

function turn(a: Pt, b: Pt, c: Pt): number {
  const a1 = Math.atan2(b.y - a.y, b.x - a.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d / Math.PI;
}

/** Evenly spaced points along a polyline. */
function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [{ ...pts[0] }];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = dist(a, b);
    let d = step - carry;
    while (d <= L) {
      out.push({ x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L });
      d += step;
    }
    carry = L - (d - step);
  }
  const end = pts[pts.length - 1];
  if (dist(out[out.length - 1], end) > step * 0.4) out.push({ ...end });
  return out;
}

/** Point + normal at arc length s. */
function at(cps: Pt[], cum: number[], s: number): { x: number; y: number; nx: number; ny: number } {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = cps[i - 1], b = cps[i];
  const L = cum[i] - cum[i - 1] || 1;
  const t = Phaser.Math.Clamp((s - cum[i - 1]) / L, 0, 1);
  const dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: -dy, ny: dx };
}

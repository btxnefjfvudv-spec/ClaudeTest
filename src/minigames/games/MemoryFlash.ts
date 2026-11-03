import Phaser from 'phaser';
import { S } from '../../art/common';
import { mixc, shift } from '../../art/color';
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

/** Classic Simon layout: green TL, red TR, yellow BL, blue BR. */
const PADS = [
  { c: 0x2fd85a, f: 415 },
  { c: 0xff3b47, f: 311 },
  { c: 0xffcf2a, f: 252 },
  { c: 0x2f8cff, f: 209 },
];
const R_OUT = 34; // art px
const R_IN = 11;
const BOARD_Y = -10;
const TIMEOUT = 5;
const MAX_ROUND = 14;

type Phase = 'pre' | 'show' | 'input' | 'resolve';

interface Sim {
  p: PlayerIndex;
  pn: Panel;
  lit: Phaser.GameObjects.Image[];
  board: Phaser.GameObjects.Container;
  center: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  dots: Phaser.GameObjects.Image[];
  out: Phaser.GameObjects.Container;
  stars: Phaser.GameObjects.Image[];
  grid: Phaser.GameObjects.TileSprite;
  shoot?: Phaser.GameObjects.Image;
  shootT: number;
  alive: boolean;
  idx: number;
  done: boolean;
  failed: boolean;
  lastInput: number;
  inputTime: number;
  cleared: number;
  failIdx: number;
  litT: number[];
  cpuT: number;
  cpuSpan: number;
}

/** #19 — Simon says, four at once. Same sequence for everyone; one slip and you're out. */
export default class MemoryFlash extends BaseMinigame {
  private panels!: PanelKit;
  private sims: Sim[] = [];
  private seq: number[] = [];
  private round = 0;
  private phase: Phase = 'pre';
  private phaseT = 0;
  private showIdx = -1;
  private elimOrder: PlayerIndex[] = [];

  constructor() {
    super(CATALOG['memory-flash']);
  }

  setup(): void {
    this.sims = [];
    this.seq = [];
    this.round = 0;
    this.phase = 'pre';
    this.phaseT = 0;
    this.showIdx = -1;
    this.elimOrder = [];
    this.paintArt();
    this.cameras.main.setBackgroundColor(0x0e0b1e);
    this.panels = new PanelKit(this, { frame: false, inset: 4 });
    for (const pn of this.panels.panels) this.buildPanel(pn);
    this.panels.onDown((p, lx, ly) => {
      if (this.isCpu(p)) return;
      const k = this.padAt(lx, ly);
      if (k >= 0) this.press(p, k);
    });
    for (let i = 0; i < 2; i++) this.seq.push(Math.floor(Math.random() * 4));
  }

  // ───────────────────────────── ART ─────────────────────────────

  private wedge(p: { px: (x: number, y: number, c: number, a?: number) => void }, k: number, c: number, cx: number, cy: number, rOut: number, rIn: number, shade: boolean): void {
    const sx = k % 2 === 0 ? -1 : 1, sy = k < 2 ? -1 : 1;
    for (let y = Math.floor(cy - rOut - 1); y <= cy + rOut + 1; y++) {
      for (let x = Math.floor(cx - rOut - 1); x <= cx + rOut + 1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (Math.sign(dx) !== sx || Math.sign(dy) !== sy) continue;
        if (Math.abs(dx) < 2.2 || Math.abs(dy) < 2.2) continue; // gaps between pads
        const d = Math.hypot(dx, dy);
        if (d > rOut || d < rIn) continue;
        let col = c;
        if (shade) {
          // light from top-left: brighter toward the outer top-left, darker bottom-right
          const l = (-dx - dy) / (rOut * 1.4);
          if (d > rOut - 1.5) col = shift(c, -0.45);
          else if (d < rIn + 1.2) col = shift(c, -0.35);
          else if (l > 0.35) col = shift(c, 0.25);
          else if (l < -0.35) col = shift(c, -0.2);
        }
        p.px(x, y, col);
      }
    }
  }

  private paintArt(): void {
    const size = R_OUT * 2 + 8, c = size / 2;
    makeTexture(this, 'mf-board', size, size + 4, (p) => {
      p.circle(c, c + 3, R_OUT + 3.5, 0x0a0814);
      p.circle(c, c, R_OUT + 3.5, 0x2b2540);
      p.circle(c, c, R_OUT + 2, 0x1a1528);
      PADS.forEach((pad, k) => this.wedge(p, k, mixc(shift(pad.c, -0.6), 0x2b2540, 0.35), c, c, R_OUT, R_IN, true));
      p.circle(c, c, R_IN - 0.5, 0x3a3450);
      p.circle(c, c, R_IN - 2, 0x1e1a2e);
      p.ring(c, c, R_OUT + 3.5, 0x5a5080, 1);
      p.px(c - 22, c - 24, 0xffffff);
    });
    PADS.forEach((pad, k) => {
      makeTexture(this, `mf-lit-${k}`, size, size, (p) => {
        this.wedge(p, k, shift(pad.c, 0.3), c, c, R_OUT + 1, R_IN - 0.5, true);
        // specular sweep
        const sx = k % 2 === 0 ? -1 : 1, sy = k < 2 ? -1 : 1;
        for (let i = 0; i < 4; i++) p.px(c + sx * (12 + i * 3), c + sy * (21 - i * 2), 0xffffff);
      });
      makeTexture(this, `mf-glow-${k}`, size + 20, size + 20, (p) => {
        // soft halo just outside the lit pad, fading out with distance
        const g = c + 10, sx = k % 2 === 0 ? -1 : 1, sy = k < 2 ? -1 : 1;
        for (let y = 0; y < size + 20; y++) for (let x = 0; x < size + 20; x++) {
          const dx = x + 0.5 - g, dy = y + 0.5 - g;
          if (Math.sign(dx) !== sx || Math.sign(dy) !== sy) continue;
          const d = Math.hypot(dx, dy);
          if (d < R_OUT + 3 || d > R_OUT + 10) continue;
          const a = 1 - (d - R_OUT - 3) / 7;
          if (((x + y) & 1) === 0 || a > 0.6) p.px(x, y, pad.c, Math.round(200 * a));
        }
      });
    });
    makeTexture(this, 'mf-dot-off', 6, 6, (p) => { p.circle(3, 3, 2.6, 0x3a3456); p.outline(-0.5); });
    makeTexture(this, 'mf-dot-on', 6, 6, (p) => { p.circle(3, 3, 2.6, 0xfff8e7); p.px(2, 2, 0xffffff); p.outline(-0.6); });
    makeTexture(this, 'mf-star', 3, 3, (p) => { p.px(1, 0, 0xffffff); p.px(0, 1, 0xffffff); p.px(1, 1, 0xffffff); p.px(2, 1, 0xffffff); p.px(1, 2, 0xffffff); });
    makeTexture(this, 'mf-shoot', 14, 3, (p) => { for (let x = 0; x < 14; x++) p.px(x, 1, 0xffffff, Math.round((x / 14) * 255)); p.px(13, 0, 0xffffff); p.px(13, 2, 0xffffff); });
    makeTexture(this, 'mf-grid', 32, 16, (p) => {
      p.hline(0, 15, 32, 0xd04aff, 160);
      p.vline(0, 0, 16, 0x8a3ad0, 120);
      p.vline(16, 0, 16, 0x8a3ad0, 120);
    });
    makeTexture(this, 'mf-out', 64, 22, (p) => {
      p.box(0, 0, 64, 22, 0xd8344a, 2);
      p.rect(3, 3, 58, 16, 0xb3263a);
      p.outline(-0.7);
    });
  }

  private paintBg(pn: Panel): string {
    const aw = Math.ceil(pn.w / S), ah = Math.ceil(pn.h / S);
    return makeTexture(this, `mf-bg-${aw}x${ah}`, aw, ah, (p) => {
      const hz = Math.floor(ah * 0.7);
      p.gradient(0, 0, aw, hz, [0x0e0b24, 0x1e1446, 0x3a1a5e, 0x6a2a7a]);
      const r = rng(13);
      for (let i = 0; i < 60; i++) p.px(Math.floor(r() * aw), Math.floor(r() * hz), r() < 0.3 ? 0xb8a6ff : 0x6a5aa0);
      // planet
      const px = Math.floor(aw * 0.85), py = Math.floor(ah * 0.18);
      p.ball(px, py, 11, 11, 0xff8a6a, false);
      p.ellipse(px, py + 1, 17, 3, 0xffd0a0, 140);
      p.ellipse(px, py + 1, 11, 1.5, 0xff8a6a);
      // neon city skyline
      for (let x = 0; x < aw; x += 1) {
        const h = 4 + Math.floor((Math.sin(x * 0.37) + Math.sin(x * 0.11 + 2)) * 3 + 6);
        p.vline(x, hz - h, h, 0x1a1036);
      }
      for (let i = 0; i < 40; i++) {
        const x = Math.floor(r() * aw), y = hz - 2 - Math.floor(r() * 10);
        if (p.get(x, y) === 0x1a1036) p.px(x, y, r() < 0.5 ? 0xffe066 : 0x6ec6ff);
      }
      p.hline(0, hz, aw, 0xff6ad0);
      p.rect(0, hz + 1, aw, ah - hz - 1, 0x1a0a30);
      for (let y = 0; y < ah; y++) { p.px(0, y, 0x000000, 120); p.px(aw - 1, y, 0x000000, 120); }
    });
  }

  private buildPanel(pn: Panel): void {
    const p = pn.p;
    const c = pn.c;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { c.add(o); return o; };
    add(this.add.image(0, 0, this.paintBg(pn)).setScale(S));
    const hzY = -pn.h / 2 + Math.floor(Math.ceil(pn.h / S) * 0.7) * S;
    const grid = add(this.add.tileSprite(0, hzY + 2, pn.w / S, (pn.h / 2 - hzY) / S, 'mf-grid').setScale(S).setOrigin(0.5, 0).setAlpha(0.55));
    const stars: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < 9; i++) {
      const st = add(this.add.image(-pn.w / 2 + 10 + Math.random() * (pn.w - 20), -pn.h / 2 + 8 + Math.random() * (hzY + pn.h / 2 - 30), 'mf-star').setScale(S));
      stars.push(st.setData('ph', Math.random() * 6));
    }
    const col = PLAYER_COLORS[p];
    add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));

    const board = this.add.container(0, BOARD_Y);
    c.add(board);
    board.add(this.add.image(0, 2, 'mf-board').setScale(S));
    const lit = PADS.map((_, k) => {
      const g = this.add.image(0, 0, `mf-glow-${k}`).setScale(S).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      const l = this.add.image(0, 0, `mf-lit-${k}`).setScale(S).setAlpha(0);
      board.add([g, l]);
      l.setData('glow', g);
      return l;
    });
    const center = txt(this, 0, 0, '', { size: 13, color: '#fff8e7', strokeWidth: 3 });
    board.add(center);
    const status = add(txt(this, 0, -pn.h / 2 + 16, '', { size: 15, color: toCss(col.light) }));
    const out = this.add.container(0, BOARD_Y).setVisible(false);
    c.add(out);
    out.add(this.add.rectangle(0, -BOARD_Y, pn.w, pn.h, 0x0a0814, 0.55));
    out.add(this.add.image(0, 0, 'mf-out').setScale(S));
    out.add(txt(this, 0, -1, 'ออก!', { size: 22, color: '#ffffff', strokeWidth: 4 }));
    this.sims.push({
      p, pn, lit, board, center, status, dots: [], out, stars, grid, shootT: 2 + Math.random() * 5,
      alive: this.players.includes(p), idx: 0, done: false, failed: false, lastInput: 0, inputTime: 0, cleared: 0, failIdx: 0,
      litT: [0, 0, 0, 0], cpuT: 0, cpuSpan: 6 + Math.random() * 4,
    });
  }

  private layoutDots(s: Sim): void {
    for (const d of s.dots) d.destroy();
    s.dots = [];
    const n = this.seq.length;
    const gap = Math.min(16, 150 / Math.max(1, n - 1));
    for (let i = 0; i < n; i++) {
      const d = this.add.image((i - (n - 1) / 2) * gap, BOARD_Y + R_OUT * S + 16, 'mf-dot-off').setScale(S);
      s.pn.c.add(d);
      s.dots.push(d);
    }
  }

  // ───────────────────────────── FLOW ─────────────────────────────

  private aliveSims(): Sim[] {
    return this.sims.filter((s) => s.alive);
  }

  private stepDur(): number {
    return Math.max(0.3, 0.62 - this.round * 0.03);
  }

  private flash(s: Sim, k: number, dur: number): void {
    s.litT[k] = dur;
    const l = s.lit[k];
    l.setAlpha(1);
    (l.getData('glow') as Phaser.GameObjects.Image).setAlpha(1);
    Vfx.squash(this, l, 1.04, 1.04, 120);
  }

  private tone(k: number, dur: number, vol = 0.18): void {
    Audio.blip(PADS[k].f, dur, 'triangle', undefined, vol);
    Audio.blip(PADS[k].f * 2, dur * 0.6, 'square', undefined, vol * 0.25);
  }

  private startShow(): void {
    this.phase = 'show';
    this.phaseT = 0;
    this.showIdx = -1;
    for (const s of this.sims) {
      this.layoutDots(s);
      if (!s.alive) continue;
      s.idx = 0;
      s.done = false;
      s.failed = false;
      s.status.setText('ดูให้ดี...').setColor('#fff8e7');
      s.center.setText(`รอบ\n${this.round + 1}`);
    }
  }

  private startInput(): void {
    this.phase = 'input';
    this.phaseT = 0;
    for (const s of this.aliveSims()) {
      s.lastInput = this.elapsed;
      s.status.setText('ถึงตาคุณ!').setColor('#ffe066').setScale(1.4);
      this.tweens.add({ targets: s.status, scale: 1, duration: 200, ease: 'Back.easeOut' });
      s.center.setText('กด!');
      s.cpuT = 0.55 + Math.random() * 0.4;
    }
    Audio.sfx('go');
  }

  private padAt(lx: number, ly: number): number {
    const dx = lx, dy = ly - BOARD_Y;
    const d = Math.hypot(dx, dy);
    if (d < R_IN * S - 4 || d > R_OUT * S + 14) return -1;
    return (dx < 0 ? 0 : 1) + (dy < 0 ? 0 : 2);
  }

  private press(p: PlayerIndex, k: number): void {
    const s = this.sims[p];
    if (!s || !s.alive || s.done || s.failed || this.phase !== 'input' || this.state !== 'play') return;
    this.flash(s, k, 0.22);
    s.inputTime += this.elapsed - s.lastInput;
    s.lastInput = this.elapsed;
    if (k !== this.seq[s.idx]) return this.fail(s, false);
    this.tone(k, 0.2, this.isCpu(p) ? 0.06 : 0.18);
    s.dots[s.idx]?.setTexture('mf-dot-on');
    if (s.dots[s.idx]) this.tweens.add({ targets: s.dots[s.idx], scale: { from: S * 1.8, to: S }, duration: 160 });
    s.idx++;
    s.status.setText(`${s.idx}/${this.seq.length}`);
    if (s.idx >= this.seq.length) {
      s.done = true;
      s.cleared++;
      s.status.setText('ผ่าน! ✓').setColor('#7ee8b0');
      s.center.setText('✓');
      const w = this.panels.toWorld(p, 0, BOARD_Y);
      Vfx.sparkle(this, w.x, w.y, [0xffffff, 0x7ee8b0, 0xffe066]);
      Audio.sfx('right', 1 + p * 0.1);
    }
  }

  private fail(s: Sim, timeout: boolean): void {
    s.failed = true;
    s.failIdx = s.idx;
    s.status.setText(timeout ? 'หมดเวลา!' : 'ผิด!').setColor('#ff7a85');
    s.center.setText('✗');
    Audio.sfx('wrong', 1 + s.p * 0.08);
    this.tweens.add({ targets: s.board, x: { from: -10, to: 0 }, duration: 300, ease: 'Elastic.easeOut' });
    // show what it should have been
    this.flash(s, this.seq[s.idx], 0.6);
    const w = this.panels.toWorld(s.p, 0, BOARD_Y);
    burst(this, w.x, w.y, { tex: 'dot3', count: 14, tint: [0xff5a6e, 0x6a6a80], speed: [60, 160], life: 500 });
  }

  private resolveRound(): void {
    this.phase = 'resolve';
    this.phaseT = 0;
    const fallen = this.aliveSims().filter((s) => s.failed);
    const survivors = this.aliveSims().filter((s) => !s.failed);
    // worst first so the elimination order reflects who did better
    fallen.sort((a, b) => a.failIdx - b.failIdx || b.inputTime - a.inputTime);
    for (const s of fallen) {
      s.alive = false;
      this.elimOrder.push(s.p);
      s.out.setVisible(true).setScale(0.4);
      this.tweens.add({ targets: s.out, scale: 1, duration: 260, ease: 'Back.easeOut' });
      this.hudText[s.p] = 'ออก';
    }
    if (fallen.length) Audio.sfx('lose');
    for (const s of survivors) {
      s.status.setText('รอดไปอีกรอบ!').setColor('#7ee8b0');
      this.hudText[s.p] = `${s.cleared}`;
    }
    const multi = this.players.length > 1;
    if ((multi && survivors.length <= 1) || survivors.length === 0 || this.round + 1 >= MAX_ROUND) {
      for (const s of survivors) {
        s.status.setText('ชนะ! จำเก่งสุด').setColor('#ffe066');
        const w = this.panels.toWorld(s.p, 0, BOARD_Y);
        Vfx.confetti(this, w.x, w.y, 50);
      }
      this.time.delayedCall(1200, () => this.finish());
      this.phase = 'pre';
      this.phaseT = -999;
    }
  }

  onStart(): void {
    this.phaseT = 0;
  }

  tick(dt: number): void {
    this.phaseT += dt;
    const step = this.stepDur();
    if (this.phase === 'pre') {
      if (this.phaseT > 0.7) this.startShow();
    } else if (this.phase === 'show') {
      const i = Math.floor((this.phaseT - 0.5) / step);
      if (i >= 0 && i !== this.showIdx && i < this.seq.length) {
        this.showIdx = i;
        const k = this.seq[i];
        for (const s of this.aliveSims()) this.flash(s, k, step * 0.7);
        this.tone(k, step * 0.7);
      }
      if (this.phaseT > 0.5 + this.seq.length * step + 0.15) this.startInput();
    } else if (this.phase === 'input') {
      for (const s of this.aliveSims()) {
        if (s.done || s.failed) continue;
        if (this.elapsed - s.lastInput > TIMEOUT) { this.fail(s, true); continue; }
        if (this.isCpu(s.p)) {
          s.cpuT -= dt;
          if (s.cpuT <= 0) {
            s.cpuT = 0.28 + Math.random() * 0.3;
            const n = this.seq.length;
            const err = n <= s.cpuSpan - 3 ? 0.006 : 0.03 + 0.07 * (n - (s.cpuSpan - 3));
            const right = this.seq[s.idx];
            this.press(s.p, Math.random() < err ? (right + 1 + Math.floor(Math.random() * 3)) % 4 : right);
          }
        }
        const left = TIMEOUT - (this.elapsed - s.lastInput);
        if (left < 2.5 && !s.done && !s.failed) s.center.setText(`${Math.ceil(left)}`);
      }
      if (this.aliveSims().every((s) => s.done || s.failed)) this.resolveRound();
    } else if (this.phase === 'resolve') {
      if (this.phaseT > 1.3) {
        this.round++;
        this.seq.push(Math.floor(Math.random() * 4));
        this.startShow();
      }
    }
  }

  ambient(dt: number): void {
    const now = this.time.now / 1000;
    for (const s of this.sims) {
      for (let k = 0; k < 4; k++) {
        if (s.litT[k] > 0) {
          s.litT[k] -= dt;
          if (s.litT[k] <= 0) {
            this.tweens.add({ targets: [s.lit[k], s.lit[k].getData('glow')], alpha: 0, duration: 90 });
          }
        }
      }
      s.grid.tilePositionY -= dt * 8;
      for (const st of s.stars) st.setAlpha(0.35 + 0.65 * Math.abs(Math.sin(now * 1.4 + (st.getData('ph') as number))));
      s.shootT -= dt;
      if (s.shootT <= 0) {
        s.shootT = 4 + Math.random() * 6;
        const x0 = -s.pn.w / 2 + 30 + Math.random() * s.pn.w * 0.5, y0 = -s.pn.h / 2 + 14 + Math.random() * 30;
        const sh = this.add.image(x0, y0, 'mf-shoot').setScale(S).setAngle(20).setAlpha(0.9);
        s.pn.c.addAt(sh, 2);
        this.tweens.add({ targets: sh, x: x0 + 90, y: y0 + 32, alpha: 0, duration: 600, onComplete: () => sh.destroy() });
      }
    }
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => {
      const s = this.sims[p];
      const steps = s.alive ? this.seq.length : s.failIdx;
      return s.cleared * 10000 + steps * 100 + Math.max(0, 99 - s.inputTime);
    };
    return rankBy(this.players, value).map((r) => ({ ...r, score: this.sims[r.player].cleared }));
  }
}

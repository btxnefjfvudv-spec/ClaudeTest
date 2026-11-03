import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const ID = 'pattern-master';
const N = 4;
const CELL = 38;
const GAP = 5;
const SHOW = 1.5;
const LIVES = 3;
const CAP = 110;

type Phase = 'wait' | 'show' | 'input' | 'good' | 'bad' | 'out';

interface Seat {
  p: PlayerIndex;
  panel: Panel;
  cells: { img: Phaser.GameObjects.Image; x: number; y: number }[];
  level: number;
  cleared: number;
  lives: number;
  fails: number;
  phase: Phase;
  t: number;
  limit: number;
  pattern: Set<number>;
  picked: Set<number>;
  hearts: Phaser.GameObjects.Image[];
  lvText: Phaser.GameObjects.Text;
  hint: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
  rows: { lv: Phaser.GameObjects.Text; mark: Phaser.GameObjects.Image; q: PlayerIndex }[];
  outCard: Phaser.GameObjects.Container;
  cpuQueue: { at: number; cell: number }[];
  skill: number;
  outAt: number;
}

/** #33 — Memorise the lit cells on a 4×4 grid, then tap them back. 3 lives. */
export default class PatternMaster extends BaseMinigame {
  private kit!: PanelKit;
  private seats: Seat[] = [];
  private stars: { img: Phaser.GameObjects.Image; ph: number; sp: number }[] = [];
  private outOrder: PlayerIndex[] = [];
  private t = 0;
  private ending = -1;

  constructor() {
    super(CATALOG[ID]);
  }

  private cellsFor(level: number): number {
    return Math.min(12, 2 + level);
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintTextures(): void {
    makeTexture(this, `${ID}-table`, 32, 32, (p) => {
      p.rect(0, 0, 32, 32, 0x1c1838);
      for (let i = 0; i < 6; i++) p.px((i * 13) % 32, (i * 7) % 32, 0x2c2850);
    });
    const c = CELL / S;
    const tile = (p: import('../../art/Painter').Painter, base: number, glow: boolean) => {
      p.rect(0, 1, c, c, shift(base, -0.65));
      p.rect(0, 0, c, c - 1, shift(base, -0.45));
      p.rect(1, 1, c - 2, c - 3, base);
      p.hline(2, 1, c - 4, shift(base, 0.45));
      p.vline(1, 2, c - 5, shift(base, 0.3));
      p.hline(2, c - 3, c - 4, shift(base, -0.25));
      if (glow) {
        p.rect(4, 4, c - 8, c - 9, shift(base, 0.35));
        p.rect(6, 6, c - 12, c - 13, shift(base, 0.65));
        p.px(4, 4, 0xffffff); p.px(5, 4, 0xffffff); p.px(4, 5, 0xffffff);
      } else {
        p.px(4, 4, shift(base, 0.2)); p.px(c - 5, c - 6, shift(base, -0.2));
      }
    };
    makeTexture(this, `${ID}-off`, c, c, (p) => tile(p, 0x3a3570, false));
    makeTexture(this, `${ID}-lit`, c, c, (p) => tile(p, 0x3fd8e8, true));
    makeTexture(this, `${ID}-bad`, c, c, (p) => {
      tile(p, 0xd83a4e, false);
      p.stroke(5, 5, c - 6, c - 7, 2, 0xffffff); p.stroke(c - 6, 5, 5, c - 7, 2, 0xffffff);
    });
    makeTexture(this, `${ID}-miss`, c, c, (p) => {
      tile(p, 0x3a3570, false);
      p.ring(c / 2, c / 2 - 0.5, c / 2 - 3, 0x3fd8e8, 2);
    });
    for (const q of [0, 1, 2, 3] as PlayerIndex[]) makeTexture(this, `${ID}-pick-${q}`, c, c, (p) => tile(p, PLAYER_COLORS[q].main, true));
    makeTexture(this, `${ID}-heart`, 9, 8, (p) => {
      p.stamp(0, 0, ['.aa.aa...', 'abbaaaa..', 'abaaaaa..', 'aaaaaaa..', '.aaaaa...', '..aaa....', '...a.....'], { a: 0xff4d6d, b: 0xffc2cc });
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-heart0`, 9, 8, (p) => {
      p.stamp(0, 0, ['.aa.aa...', 'aaaaaaa..', 'aaaaaaa..', 'aaaaaaa..', '.aaaaa...', '..aaa....', '...a.....'], { a: 0x4a4470 });
      p.outline(-0.6);
    });
    makeSheet(this, `${ID}-star`, 5, 5, 3, (p, i) => {
      if (i === 0) p.px(2, 2, 0xffffff);
      else if (i === 1) { p.px(2, 2, 0xffffff); p.px(1, 2, 0xc8c0ff); p.px(3, 2, 0xc8c0ff); p.px(2, 1, 0xc8c0ff); p.px(2, 3, 0xc8c0ff); }
      else { p.vline(2, 0, 5, 0xe8e4ff); p.hline(0, 2, 5, 0xe8e4ff); p.px(2, 2, 0xffffff); }
    });
  }

  private panelBg(pn: Panel): string {
    const aw = Math.round(pn.w / S), ah = Math.round(pn.h / S);
    return makeTexture(this, `${ID}-bg-${aw}x${ah}`, aw, ah, (p) => {
      p.gradient(0, 0, aw, ah, [0x1a1640, 0x2a2060, 0x40307a]);
      const r = rng(12);
      for (let i = 0; i < 60; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah * 0.8), r() > 0.7 ? 0xc8c0ff : 0x6a60a8);
      // moon
      p.circle(aw - 18, 14, 7, 0xfff1c9);
      p.circle(aw - 15, 12, 6, 0x221a4c);
      // grid plinth
      const gw = (N * CELL + (N - 1) * GAP) / S + 8;
      const gx = Math.round(aw / 2 - gw / 2), gy = Math.round(ah / 2 - gw / 2);
      p.rect(gx, gy + 2, gw, gw, 0x0e0b26);
      p.rect(gx, gy, gw, gw, 0x5a4a9a);
      p.rect(gx + 1, gy + 1, gw - 2, gw - 2, 0x241e52);
      p.hline(gx + 1, gy, gw - 2, 0x8a7ad0);
      // side plaques
      p.rect(3, ah / 2 - 40, 36, 70, 0x14102e);
      p.rect(4, ah / 2 - 39, 34, 68, 0x221a4c);
      p.hline(4, ah / 2 - 39, 34, 0x3a3070);
      p.rect(aw - 39, ah / 2 - 40, 36, 70, 0x14102e);
      p.rect(aw - 38, ah / 2 - 39, 34, 68, 0x221a4c);
      p.hline(aw - 38, ah / 2 - 39, 34, 0x3a3070);
    });
  }

  // ───────────────────────────── setup ─────────────────────────────

  setup(): void {
    this.seats = [];
    this.stars = [];
    this.outOrder = [];
    this.t = 0;
    this.ending = -1;
    this.paintTextures();
    this.add.tileSprite(0, 0, this.vw / S, this.vh / S, `${ID}-table`).setOrigin(0).setScale(S).setDepth(-100);
    this.kit = new PanelKit(this, { frame: false });
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) this.buildPanel(this.kit.panel(p));
    this.kit.onDown((p, lx, ly) => this.onTap(p, lx, ly));
    for (const s of this.seats) this.hudText[s.p] = 'LV 1';
  }

  private buildPanel(pn: Panel): void {
    const p = pn.p;
    const col = PLAYER_COLORS[p];
    pn.c.add(this.add.image(0, 0, this.panelBg(pn)).setScale(S));
    pn.c.add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));
    for (let i = 0; i < 7; i++) {
      const img = this.add.sprite((Math.random() - 0.5) * pn.w * 0.95, -pn.h / 2 + 8 + Math.random() * pn.h * 0.85, `${ID}-star`, i % 3).setScale(S);
      pn.c.add(img);
      this.stars.push({ img: img as unknown as Phaser.GameObjects.Image, ph: Math.random() * 6, sp: 1 + Math.random() * 2 });
    }
    const span = N * CELL + (N - 1) * GAP;
    const cells: Seat['cells'] = [];
    for (let i = 0; i < N * N; i++) {
      const x = -span / 2 + CELL / 2 + (i % N) * (CELL + GAP);
      const y = -span / 2 + CELL / 2 + Math.floor(i / N) * (CELL + GAP);
      const img = this.add.image(x, y, `${ID}-off`).setScale(S);
      pn.c.add(img);
      cells.push({ img, x, y });
    }
    // left plaque: level + hearts
    const lx = -pn.w / 2 + 42;
    pn.c.add(txt(this, lx, -66, 'LEVEL', { size: 10, color: '#c8c0ff', strokeWidth: 3 }));
    const lvText = txt(this, lx, -44, '1', { size: 28, color: toCss(col.light), strokeWidth: 5 });
    const hearts = [0, 1, 2].map((k) => this.add.image(lx - 20 + k * 20, -14, `${ID}-heart`).setScale(S));
    const hint = txt(this, lx, 16, '', { size: 14, color: '#ffe066', strokeWidth: 4 });
    pn.c.add([lvText, ...hearts, hint]);
    const bar = this.add.rectangle(-span / 2, -span / 2 - 9, span, 4, 0x3fd8e8).setOrigin(0, 0.5);
    pn.c.add(bar);
    // right plaque: everybody's level
    const rx = pn.w / 2 - 42;
    pn.c.add(txt(this, rx, -66, 'ทุกคน', { size: 10, color: '#c8c0ff', strokeWidth: 3 }));
    const rows: Seat['rows'] = [];
    this.players.forEach((q, k) => {
      const y = -46 + k * 20;
      const mark = this.add.image(rx - 18, y, playerMarkerKey(this, q)).setScale(S * 0.8);
      const lv = txt(this, rx + 6, y, 'LV 1', { size: 11, color: toCss(PLAYER_COLORS[q].light), strokeWidth: 3 });
      pn.c.add([mark, lv]);
      rows.push({ lv, mark, q });
    });
    const outCard = this.add.container(0, 0).setVisible(false);
    outCard.add(this.add.rectangle(0, 0, span + 12, 64, 0x14102e, 0.85).setStrokeStyle(2, col.main));
    outCard.add(txt(this, 0, -10, 'หมดหัวใจ!', { size: 20, color: '#ff9fa8', strokeWidth: 5 }));
    const outLv = txt(this, 0, 16, '', { size: 13, color: '#fff8e7', strokeWidth: 3 });
    outCard.add(outLv);
    outCard.setData('lv', outLv);
    pn.c.add(outCard);
    if (!this.players.includes(p)) return;
    this.seats.push({
      p, panel: pn, cells, level: 1, cleared: 0, lives: LIVES, fails: 0, phase: 'wait', t: 0.4, limit: 1,
      pattern: new Set(), picked: new Set(), hearts, lvText, hint, bar, rows, outCard, cpuQueue: [],
      skill: 0.5 + Math.random() * 0.45, outAt: -1,
    });
  }

  // ───────────────────────────── flow ─────────────────────────────

  private startRound(s: Seat): void {
    const n = this.cellsFor(s.level);
    // same pattern for everyone at the same level / attempt (fair)
    const r = rng(977 * s.level + 131 * s.fails + 7);
    const idx = Array.from({ length: N * N }, (_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    s.pattern = new Set(idx.slice(0, n));
    s.picked = new Set();
    s.phase = 'show';
    s.t = SHOW;
    s.hint.setText('จำไว้!').setColor('#3fd8e8');
    s.cells.forEach((c, i) => {
      const on = s.pattern.has(i);
      c.img.setTexture(on ? `${ID}-lit` : `${ID}-off`).setScale(S);
      if (on) this.tweens.add({ targets: c.img, scale: { from: S * 0.6, to: S }, duration: 200, delay: (i % N) * 30, ease: 'Back.easeOut' });
    });
    Audio.sfx('select', 0.9 + s.level * 0.05);
  }

  private startInput(s: Seat): void {
    s.phase = 'input';
    const n = s.pattern.size;
    s.limit = s.t = 3 + n * 0.7;
    s.hint.setText('แตะ!').setColor('#ffe066');
    s.cells.forEach((c) => c.img.setTexture(`${ID}-off`));
    if (this.isCpu(s.p)) {
      const order = [...s.pattern].sort(() => Math.random() - 0.5);
      const k = 1.25 - s.skill * 0.6;
      const e = 0.012 * n * k;
      let at = 0.5 + Math.random() * 0.4;
      s.cpuQueue = [];
      for (const cell of order) {
        at += (0.32 + Math.random() * 0.3) / (0.6 + s.skill * 0.5);
        if (Math.random() < e) {
          const wrong = Array.from({ length: N * N }, (_, i) => i).filter((i) => !s.pattern.has(i));
          s.cpuQueue.push({ at: s.limit - at, cell: wrong[Math.floor(Math.random() * wrong.length)] });
          break;
        }
        s.cpuQueue.push({ at: s.limit - at, cell });
      }
    }
  }

  private onTap(p: PlayerIndex, lx: number, ly: number): void {
    if (this.isCpu(p)) return;
    const s = this.seats.find((o) => o.p === p);
    if (!s) return;
    const i = s.cells.findIndex((c) => Math.abs(lx - c.x) <= (CELL + GAP) / 2 && Math.abs(ly - c.y) <= (CELL + GAP) / 2);
    if (i >= 0) this.pick(s, i);
  }

  private pick(s: Seat, i: number): void {
    if (s.phase !== 'input' || this.state !== 'play' || s.picked.has(i)) return;
    const c = s.cells[i];
    if (s.pattern.has(i)) {
      s.picked.add(i);
      c.img.setTexture(`${ID}-pick-${s.p}`);
      Vfx.squash(this, c.img, 1.2, 1.2, 140);
      Audio.sfx('pop', 1 + s.picked.size * 0.06);
      const w = this.kit.toWorld(s.p, c.x, c.y);
      burst(this, w.x, w.y, { tex: 'spark', count: 5, tint: [0xffffff, PLAYER_COLORS[s.p].light], speed: [30, 90], life: 300, depth: 960 });
      if (s.picked.size === s.pattern.size) this.win(s);
    } else {
      c.img.setTexture(`${ID}-bad`);
      this.tweens.add({ targets: c.img, x: c.x + 4, yoyo: true, repeat: 3, duration: 40, onComplete: () => c.img.setX(c.x) });
      this.lose(s);
    }
  }

  private win(s: Seat): void {
    s.phase = 'good';
    s.t = 0.75;
    s.cleared = s.level;
    s.level++;
    this.score[s.p] = s.cleared;
    this.addScore(s.p, 0);
    s.hint.setText('เยี่ยม!').setColor('#7ee8b0');
    s.lvText.setText(`${s.level}`);
    this.tweens.add({ targets: s.lvText, scale: { from: 1.8, to: 1 }, duration: 260, ease: 'Back.easeOut' });
    s.cells.forEach((c, i) => {
      if (s.pattern.has(i)) this.tweens.add({ targets: c.img, y: c.y - 5, yoyo: true, delay: ((i % N) + Math.floor(i / N)) * 35, duration: 110 });
    });
    Audio.sfx('right', 1 + s.p * 0.08);
    if (s.level % 3 === 1) Audio.sfx('power', 1 + s.p * 0.05);
    const w = this.kit.toWorld(s.p, 0, 0);
    burst(this, w.x, w.y, { tex: 'star', count: 14, tint: [0xffe066, 0xffffff, 0x3fd8e8, PLAYER_COLORS[s.p].main], speed: [80, 200], life: 600, depth: 960 });
    this.hudText[s.p] = `LV ${s.level}`;
    this.syncRows();
  }

  private lose(s: Seat): void {
    s.lives--;
    s.fails++;
    s.phase = 'bad';
    s.t = 1.0;
    s.cpuQueue = [];
    // show what was missed
    s.cells.forEach((c, i) => { if (s.pattern.has(i) && !s.picked.has(i)) c.img.setTexture(`${ID}-miss`); });
    const h = s.hearts[s.lives];
    if (h) { h.setTexture(`${ID}-heart0`); this.tweens.add({ targets: h, scale: { from: S * 1.8, to: S }, duration: 300, ease: 'Back.easeOut' }); }
    s.hint.setText(s.lives > 0 ? 'พลาด!' : '').setColor('#ff9fa8');
    Audio.sfx('wrong', 1 + s.p * 0.05);
    const w = this.kit.toWorld(s.p, 0, 0);
    Vfx.hit(this, w.x, w.y, [0xff5a6e, 0xffffff]);
    if (s.lives <= 0) {
      s.phase = 'out';
      s.outAt = this.elapsed;
      this.outOrder.push(s.p);
      s.outCard.setVisible(true).setScale(0.3);
      (s.outCard.getData('lv') as Phaser.GameObjects.Text).setText(`ผ่านได้ ${s.cleared} ด่าน`);
      this.tweens.add({ targets: s.outCard, scale: 1, duration: 300, ease: 'Back.easeOut' });
      this.hudText[s.p] = `LV ${s.level} ✕`;
      Audio.sfx('lose');
      this.syncRows();
    }
  }

  private syncRows(): void {
    for (const s of this.seats) {
      for (const r of s.rows) {
        const o = this.seats.find((x) => x.p === r.q);
        if (!o) continue;
        r.lv.setText(o.phase === 'out' ? `✕ ${o.cleared}` : `LV ${o.level}`);
        r.mark.setAlpha(o.phase === 'out' ? 0.4 : 1);
        r.lv.setAlpha(o.phase === 'out' ? 0.6 : 1);
      }
    }
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const st of this.stars) st.img.setAlpha(0.35 + Math.sin(this.t * st.sp + st.ph) * 0.35 + 0.3);
    for (const s of this.seats) {
      if (s.phase === 'show') {
        const pulse = 1 + Math.sin(this.t * 10) * 0.04;
        s.cells.forEach((c, i) => { if (s.pattern.has(i)) c.img.setScale(S * pulse); });
      }
      if (s.phase === 'input') s.bar.width = (N * CELL + (N - 1) * GAP) * Math.max(0, s.t / s.limit);
      else if (s.phase === 'show') s.bar.width = (N * CELL + (N - 1) * GAP) * Math.max(0, s.t / SHOW);
      else s.bar.width = 0;
      s.bar.setFillStyle(s.phase === 'show' ? 0x3fd8e8 : s.t / s.limit < 0.3 ? 0xff7a85 : 0xffe066);
      if (s.phase === 'input' && !s.picked.size) s.hint.setScale(1 + Math.sin(this.t * 8) * 0.08);
      else s.hint.setScale(1);
    }
  }

  tick(dt: number): void {
    if (this.ending >= 0) {
      this.ending -= dt;
      if (this.ending <= 0) this.finish();
      return;
    }
    for (const s of this.seats) {
      if (s.phase === 'out') continue;
      s.t -= dt;
      if (s.phase === 'wait' && s.t <= 0) this.startRound(s);
      else if (s.phase === 'show' && s.t <= 0) this.startInput(s);
      else if (s.phase === 'input') {
        if (this.isCpu(s.p)) {
          while (s.cpuQueue.length && s.t <= s.cpuQueue[0].at && s.phase === 'input') this.pick(s, s.cpuQueue.shift()!.cell);
        }
        if (s.phase === 'input' && s.t <= 0) {
          s.hint.setText('หมดเวลา!');
          this.lose(s);
        }
      } else if ((s.phase === 'good' || s.phase === 'bad') && s.t <= 0) {
        s.phase = 'wait';
        s.t = 0.2;
        s.hint.setText('');
      }
    }
    const alive = this.seats.filter((s) => s.phase !== 'out');
    const best = (list: Seat[]) => Math.max(0, ...list.map((s) => s.cleared));
    const out = this.seats.filter((s) => s.phase === 'out');
    let done = alive.length === 0 || this.elapsed > CAP;
    // Last one standing who has already beaten everybody: crown them.
    if (!done && alive.length === 1 && this.seats.length > 1 && alive[0].cleared > best(out)) done = true;
    if (done) {
      this.ending = 0.9;
      if (alive.length === 1) {
        const w = this.kit.toWorld(alive[0].p, 0, 0);
        Vfx.confetti(this, w.x, w.y, 60);
        alive[0].hint.setText('ชนะ!').setColor('#ffe066');
        Audio.sfx('power');
      }
    }
  }

  results(): PlayerResult[] {
    const val = (p: PlayerIndex) => {
      const s = this.seats.find((o) => o.p === p);
      if (!s) return 0;
      const surv = s.phase === 'out' ? this.outOrder.indexOf(p) * 10 : 90;
      return s.cleared * 1000 + surv + s.lives;
    };
    return rankBy(this.players, val).map((r) => ({ ...r, score: this.seats.find((o) => o.p === r.player)?.cleared ?? 0 }));
  }

  __probe(): unknown {
    return this.seats.map((s) => ({ p: s.p, lv: s.level, lives: s.lives, ph: s.phase }));
  }
}

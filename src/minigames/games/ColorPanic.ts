import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import { playerMarkerKey } from '../../systems/players/Avatar';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

/** The five paint colours: Thai word + ink. */
const INKS = [
  { word: 'แดง', c: 0xff3b47 },
  { word: 'ฟ้า', c: 0x3aa6ff },
  { word: 'เขียว', c: 0x34c759 },
  { word: 'เหลือง', c: 0xffd23a },
  { word: 'ม่วง', c: 0xb05cff },
];
const CARD_Y = -48;
const POT_Y = 50;
const POT_DX = [-120, -40, 40, 120];
const POT_R = 36;
const LOCK = 0.6;
const GAP = 0.45;

interface Pot { img: Phaser.GameObjects.Image; ink: number; mark: Phaser.GameObjects.Image }

interface Painter_ {
  p: PlayerIndex;
  pn: Panel;
  card: Phaser.GameObjects.Container;
  word: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
  barBack: Phaser.GameObjects.Rectangle;
  pots: Pot[];
  bubbles: { img: Phaser.GameObjects.Image; vy: number; ph: number }[];
  drips: { img: Phaser.GameObjects.Image; y0: number; v: number }[];
  info: Phaser.GameObjects.Text;
  chips: Phaser.GameObjects.Image[];
  done: boolean;
  lock: number;
  streak: number;
  cpuAt: number;
  cpuSkill: number;
}

/** #17 — Stroop test: tap the INK colour, not the word you read. */
export default class ColorPanic extends BaseMinigame {
  private panels!: PanelKit;
  private ps: Painter_[] = [];
  private word = 0;
  private ink = 1;
  private options: number[] = [0, 1, 2, 3];
  private promptT = 0;
  private timeout = 2.5;
  private gapT = 0;
  private firstDone = false;
  private promptNo = 0;
  private announced = 0;

  constructor() {
    super(CATALOG['color-panic']);
  }

  setup(): void {
    this.ps = [];
    this.promptNo = 0;
    this.announced = 0;
    this.gapT = 0;
    this.paintArt();
    this.add.tileSprite(0, 0, this.vw / S, this.vh / S, 'cp-table').setOrigin(0).setScale(S).setDepth(-100);
    this.panels = new PanelKit(this, { frame: false, inset: 4 });
    for (const pn of this.panels.panels) this.buildPanel(pn);
    this.panels.onDown((p, lx, ly) => {
      if (this.isCpu(p)) return;
      const k = this.potAt(lx, ly);
      if (k >= 0) this.answer(p, k);
    });
    this.newPrompt(true);
    for (const s of this.ps) { s.word.setText('?').setColor('#fff8e7'); }
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    makeTexture(this, 'cp-table', 32, 32, (p) => {
      p.rect(0, 0, 32, 32, 0x2a2440);
      const r = rng(4);
      for (let i = 0; i < 14; i++) p.px(Math.floor(r() * 32), Math.floor(r() * 32), [0x3a3058, 0x342a4e][i % 2]);
    });
    INKS.forEach((ink, k) => {
      makeTexture(this, `cp-pot-${k}`, 32, 30, (p) => {
        // paint can seen from above-front: rim ellipse, body, paint surface
        p.rect(4, 12, 24, 15, 0xb8c0d0);
        p.vline(4, 12, 15, 0xe0e6f0); p.vline(5, 12, 15, 0xd0d6e2);
        p.vline(27, 12, 15, 0x8a92a8); p.vline(26, 12, 15, 0x9aa2b6);
        p.ellipse(16, 27, 12, 3, 0x8a92a8);
        p.rect(4, 18, 24, 5, shift(ink.c, -0.15));
        p.hline(4, 18, 24, shift(ink.c, 0.3));
        p.ellipse(16, 12, 12, 5, 0x8a92a8);
        p.ellipse(16, 12, 11, 4.2, 0xdfe4ee);
        p.ellipse(16, 12.5, 9.5, 3.4, shift(ink.c, -0.3));
        p.ellipse(16, 12, 9, 3, ink.c);
        p.ellipse(13, 11, 4, 1.2, shift(ink.c, 0.45));
        p.px(19, 13, shift(ink.c, 0.6));
        // drips over the rim
        p.vline(9, 14, 5, ink.c); p.px(9, 19, shift(ink.c, -0.2));
        p.vline(21, 14, 3, ink.c);
        p.vline(24, 13, 7, ink.c); p.px(24, 20, shift(ink.c, -0.2));
        p.outline(-0.75);
      });
      makeTexture(this, `cp-splat-${k}`, 12, 12, (p) => {
        const r = rng(k + 30);
        p.circle(6, 6, 4, ink.c);
        for (let i = 0; i < 6; i++) { const a = r() * Math.PI * 2; p.circle(6 + Math.cos(a) * 4.5, 6 + Math.sin(a) * 4.5, 1.4, ink.c); }
        p.px(5, 4, shift(ink.c, 0.5));
      });
    });
    makeTexture(this, 'cp-check', 11, 9, (p) => {
      p.stroke(1, 4, 4, 7, 2, 0xffffff); p.stroke(4, 7, 9, 1, 2, 0xffffff);
      p.outline(-0.9, true);
    });
    makeTexture(this, 'cp-cross', 9, 9, (p) => {
      p.stroke(1, 1, 7, 7, 2, 0xff5a6e); p.stroke(7, 1, 1, 7, 2, 0xff5a6e);
      p.outline(-0.8, true);
    });
    makeTexture(this, 'cp-canvas', 108, 46, (p) => {
      // easel legs
      p.stroke(20, 30, 12, 46, 3, 0x9a6a3a); p.stroke(88, 30, 96, 46, 3, 0x9a6a3a);
      p.box(0, 0, 108, 40, 0xb07a44, 2);
      p.rect(4, 4, 100, 32, 0xfdf8ee);
      p.rect(4, 4, 100, 2, 0xe8e0d0);
      p.dither(4, 30, 100, 6, 0xfdf8ee, 0xf0e8d8, 0.5);
      p.rect(46, 40, 16, 3, 0x8a5a30);
      p.outline(-0.75);
    });
    makeTexture(this, 'cp-bubble', 8, 8, (p) => {
      p.ring(4, 4, 3.6, 0xffffff, 1);
      p.px(2, 2, 0xffffff); p.px(3, 2, 0xffffff);
    });
    makeTexture(this, 'cp-drip', 3, 6, (p) => { p.rect(0, 0, 3, 4, 0xffffff); p.circle(1.5, 4.5, 1.5, 0xffffff); p.px(0, 0, 0xffffff); });
  }

  private paintBg(pn: Panel): string {
    const aw = Math.ceil(pn.w / S), ah = Math.ceil(pn.h / S);
    return makeTexture(this, `cp-bg-${aw}x${ah}`, aw, ah, (p) => {
      const floor = Math.floor(ah * 0.66);
      p.gradient(0, 0, aw, floor, [0x5a4a8a, 0x6a5aa0, 0x7a6ab0]);
      // wallpaper stripes
      for (let x = 0; x < aw; x += 12) p.dither(x, 0, 6, floor, 0x6a5aa0, 0x7262a8, 0.35);
      // splatters on the wall
      const r = rng(19);
      for (let i = 0; i < 15; i++) {
        const c = INKS[i % 5].c;
        const x = r() * aw, y = r() * (floor - 8);
        const s = 1 + r() * 2.5;
        p.circle(x, y, s, shift(c, -0.3), 110);
        for (let k = 0; k < 3; k++) p.px(x + (r() - 0.5) * s * 4, y + (r() - 0.5) * s * 4, shift(c, -0.3), 110);
        if (r() < 0.4) p.vline(Math.round(x), Math.round(y), 2 + Math.floor(r() * 5), shift(c, -0.3), 110);
      }
      // wainscot + floor
      p.rect(0, floor - 4, aw, 4, 0x3a2e5a);
      p.hline(0, floor - 4, aw, 0x8a7ac0);
      for (let y = floor; y < ah; y++) {
        const band = Math.floor((y - floor) / 5) % 2;
        p.hline(0, y, aw, band ? 0xb07a4a : 0xa06a40);
      }
      for (let i = 0; i < 40; i++) p.hline(Math.floor(r() * aw), floor + Math.floor(r() * (ah - floor)), 3, 0x8a5a34);
      for (let i = 0; i < 10; i++) {
        const c = INKS[i % 5].c;
        p.ellipse(r() * aw, floor + 4 + r() * (ah - floor - 6), 2 + r() * 3, 1 + r(), shift(c, -0.1), 200);
      }
      for (let y = 0; y < ah; y++) { p.px(0, y, 0x1b1f3b, 120); p.px(aw - 1, y, 0x1b1f3b, 120); }
    });
  }

  private buildPanel(pn: Panel): void {
    const p = pn.p;
    const c = pn.c;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { c.add(o); return o; };
    add(this.add.image(0, 0, this.paintBg(pn)).setScale(S));
    const drips: Painter_['drips'] = [];
    for (let i = 0; i < 4; i++) {
      const x = -pn.w / 2 + 20 + Math.random() * (pn.w - 40);
      const y0 = -pn.h / 2 + 4 + Math.random() * 30;
      const img = add(this.add.image(x, y0, 'cp-drip').setScale(S).setTint(shift(INKS[(i + p) % 5].c, -0.15)).setAlpha(0.9));
      drips.push({ img, y0, v: 3 + Math.random() * 4 });
    }
    const bubbles: Painter_['bubbles'] = [];
    for (let i = 0; i < 7; i++) {
      const img = add(this.add.image(-pn.w / 2 + Math.random() * pn.w, -pn.h / 2 + Math.random() * pn.h, 'cp-bubble').setScale(S).setAlpha(0.45).setTint(INKS[i % 5].c));
      bubbles.push({ img, vy: 8 + Math.random() * 10, ph: Math.random() * 6 });
    }
    const col = PLAYER_COLORS[p];
    add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));

    const card = this.add.container(0, CARD_Y);
    c.add(card);
    card.add(this.add.image(0, 6, 'cp-canvas').setScale(S));
    const word = txt(this, 0, 0, '', { size: 48, color: '#ffffff', strokeWidth: 5, stroke: '#2b2240' });
    card.add(word);
    const barBack = add(this.add.rectangle(0, 8, 170, 6, 0x1b1f3b, 0.7));
    const bar = add(this.add.rectangle(-85, 8, 170, 4, 0xfff8e7).setOrigin(0, 0.5));
    const pots: Pot[] = POT_DX.map((x) => {
      add(this.add.image(x, POT_Y + 24, 'shadow').setScale(S * 1.4, S).setAlpha(0.3));
      const img = add(this.add.image(x, POT_Y, 'cp-pot-0').setScale(S));
      const mark = add(this.add.image(x, POT_Y - 4, 'cp-check').setScale(S).setVisible(false));
      return { img, ink: 0, mark };
    });
    const info = add(txt(this, 0, -pn.h / 2 + 14, '', { size: 13, color: toCss(col.light) }));
    // who already got it: one chip per player along the top
    const chips = this.players.map((q, i) => add(this.add.image((i - (this.players.length - 1) / 2) * 22, -pn.h / 2 + 16, playerMarkerKey(this, q)).setScale(S * 0.9).setAlpha(0.25).setData('q', q)));
    this.ps.push({
      p, pn, card, word, bar, barBack, pots, bubbles, drips, info, chips, done: false, lock: 0, streak: 0, cpuAt: 0,
      cpuSkill: 0.55 + Math.random() * 0.25,
    });
  }

  onStart(): void {
    this.newPrompt();
  }

  // ───────────────────────────── PROMPTS ─────────────────────────────

  private potAt(lx: number, ly: number): number {
    let best = -1, bd = POT_R + 6;
    POT_DX.forEach((x, k) => {
      const d = Math.hypot(lx - x, ly - (POT_Y + 4));
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }

  private newPrompt(first = false): void {
    this.promptNo++;
    const prevWord = this.word;
    do this.word = Math.floor(Math.random() * 5); while (this.word === prevWord && !first);
    do this.ink = Math.floor(Math.random() * 5); while (this.ink === this.word);
    // Four of the five colours, always including the ink and the (trap) word colour.
    const rest = [0, 1, 2, 3, 4].filter((k) => k !== this.word && k !== this.ink);
    Phaser.Utils.Array.Shuffle(rest);
    this.options = Phaser.Utils.Array.Shuffle([this.word, this.ink, rest[0], rest[1]]);
    this.promptT = 0;
    this.timeout = Math.max(1.3, 2.5 - this.elapsed * 0.028);
    this.firstDone = false;
    for (const s of this.ps) {
      s.done = false;
      for (const ch of s.chips) ch.setAlpha(0.25).setScale(S * 0.9);
      s.word.setText(INKS[this.word].word).setColor(toCss(INKS[this.ink].c));
      s.word.setScale(0.5).setAngle(0);
      this.tweens.add({ targets: s.word, scale: 1, duration: 140, ease: 'Back.easeOut' });
      // later on the word wobbles to stress you out
      if (this.elapsed > 24) this.tweens.add({ targets: s.word, angle: { from: -6, to: 6 }, yoyo: true, repeat: -1, duration: 260 });
      s.pots.forEach((pot, i) => {
        pot.ink = this.options[i];
        pot.img.setTexture(`cp-pot-${pot.ink}`).clearTint().setAlpha(1);
        pot.mark.setVisible(false);
        this.tweens.add({ targets: pot.img, y: { from: POT_Y + 6, to: POT_Y }, duration: 160, delay: i * 25, ease: 'Back.easeOut' });
      });
      s.cpuAt = s.cpuSkill + Math.random() * 0.55 + (Math.random() < 0.1 ? 0.6 : 0);
    }
    Audio.sfx('pop', 0.8 + Math.random() * 0.4);
  }

  private endPrompt(): void {
    this.gapT = GAP;
    for (const s of this.ps) {
      this.tweens.killTweensOf(s.word);
      s.pots.forEach((pot) => {
        if (pot.ink === this.ink) {
          this.tweens.add({ targets: pot.img, y: POT_Y - 8, yoyo: true, duration: 120 });
        } else pot.img.setAlpha(0.35);
      });
    }
  }

  private answer(p: PlayerIndex, k: number): void {
    const s = this.ps[p];
    if (!s || s.done || s.lock > 0 || this.gapT > 0 || this.state !== 'play') return;
    const pot = s.pots[k];
    const w = this.panels.toWorld(p, POT_DX[k], POT_Y - 6);
    const up = this.angleFor(p);
    Vfx.squash(this, pot.img, 1.25, 0.75, 160);
    if (pot.ink === this.ink) {
      s.done = true;
      s.streak++;
      const pts = this.firstDone ? 1 : 2;
      if (!this.firstDone) this.firstDone = true;
      this.addScore(p, pts);
      pot.mark.setTexture('cp-check').setVisible(true).setScale(S * 1.8);
      this.tweens.add({ targets: pot.mark, scale: S, duration: 200, ease: 'Back.easeOut' });
      burst(this, w.x, w.y, { tex: `cp-splat-${pot.ink}`, count: pts === 2 ? 14 : 8, speed: [60, 180], life: 520, scale: [S, S * 0.3], rotate: true });
      Vfx.sparkle(this, w.x, w.y);
      Vfx.popText(this, w.x, w.y + (up === 180 ? 30 : -30), pts === 2 ? '+2 ไวสุด!' : '+1', pts === 2 ? '#ffe066' : '#fff8e7', pts === 2 ? 20 : 17, up);
      Audio.sfx(pts === 2 ? 'coin' : 'right', 1 + p * 0.1);
      s.pots.forEach((o, i) => { if (i !== k) o.img.setAlpha(0.45); });
      for (const o of this.ps) {
        const ch = o.chips.find((x) => x.getData('q') === p);
        if (ch) { ch.setAlpha(1); this.tweens.add({ targets: ch, scale: { from: S * 1.6, to: S * 0.9 }, duration: 220, ease: 'Back.easeOut' }); }
      }
      if (s.streak >= 3 && s.streak % 3 === 0) {
        const cw = this.panels.toWorld(p, 0, CARD_Y - 50);
        Vfx.popText(this, cw.x, cw.y, `ถูก ${s.streak} ติด!`, toCss(PLAYER_COLORS[p].light), 16, up);
      }
    } else {
      s.lock = LOCK;
      s.streak = 0;
      this.addScore(p, -1);
      pot.mark.setTexture('cp-cross').setVisible(true).setScale(S * 2);
      this.tweens.add({ targets: pot.mark, scale: S * 1.2, duration: 200, ease: 'Back.easeOut' });
      for (const o of s.pots) o.img.setTint(0x6a6a80);
      this.tweens.add({ targets: s.card, x: { from: -8, to: 0 }, duration: 260, ease: 'Elastic.easeOut' });
      Vfx.popText(this, w.x, w.y + (up === 180 ? 30 : -30), '-1', '#ff7a85', 18, up);
      Audio.sfx('wrong', 1 + p * 0.1);
    }
  }

  tick(dt: number): void {
    // announce the speed-ups on both sides of the table
    const stage = this.elapsed > 30 ? 2 : this.elapsed > 15 ? 1 : 0;
    if (stage > this.announced) {
      this.announced = stage;
      this.banner(stage === 2 ? 'เร็วสุดๆ!' : 'เร็วขึ้น!');
    }
    for (const s of this.ps) {
      if (s.lock > 0) {
        s.lock -= dt;
        if (s.lock <= 0) for (const o of s.pots) { o.img.clearTint(); if (!o.mark.visible || o.mark.texture.key === 'cp-cross') o.mark.setVisible(false); }
      }
    }
    if (this.gapT > 0) {
      this.gapT -= dt;
      if (this.gapT <= 0) this.newPrompt();
      return;
    }
    this.promptT += dt;
    for (const s of this.ps) {
      if (!this.players.includes(s.p) || !this.isCpu(s.p) || s.done || s.lock > 0) continue;
      if (this.promptT >= s.cpuAt) {
        // Stroop trap: CPUs sometimes go for the colour they read.
        const wrong = Math.random() < 0.13;
        const pick = wrong ? this.options.indexOf(Math.random() < 0.7 ? this.word : this.options.find((k) => k !== this.ink && k !== this.word)!) : this.options.indexOf(this.ink);
        this.answer(s.p, pick);
        if (wrong) s.cpuAt = this.promptT + LOCK + 0.2 + Math.random() * 0.3;
      }
    }
    const frac = Phaser.Math.Clamp(1 - this.promptT / this.timeout, 0, 1);
    for (const s of this.ps) {
      s.bar.width = 170 * frac;
      s.bar.fillColor = frac < 0.3 ? 0xff7a85 : 0xfff8e7;
    }
    const allDone = this.players.every((p) => this.ps[p].done);
    if (this.promptT >= this.timeout || allDone) this.endPrompt();
  }

  private banner(text: string): void {
    Audio.sfx('power');
    for (const [deg, y] of [[0, this.vh * 0.5 + 22], [180, this.vh * 0.5 - 22]] as const) {
      const t = txt(this, this.vw / 2, y, text, { size: 30, color: '#ffe066', strokeWidth: 7 }).setAngle(deg).setDepth(3000);
      this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
    }
  }

  ambient(dt: number): void {
    const now = this.time.now / 1000;
    for (const s of this.ps) {
      const h = s.pn.h / 2, w = s.pn.w / 2;
      for (const b of s.bubbles) {
        b.img.y -= b.vy * dt;
        b.img.x += Math.sin(now * 1.3 + b.ph) * 6 * dt;
        if (b.img.y < -h + 6) { b.img.y = h - 8; b.img.x = -w + 10 + Math.random() * (w * 2 - 20); }
      }
      for (const d of s.drips) {
        d.img.y += d.v * dt;
        if (d.img.y > d.y0 + 40) { d.img.y = d.y0; d.img.setAlpha(0.9); }
        else if (d.img.y > d.y0 + 30) d.img.setAlpha(0.9 * (1 - (d.img.y - d.y0 - 30) / 10));
      }
    }
  }
}

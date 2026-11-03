import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const ID = 'number-rush';
const LOCK = 1;
const WINDOW = 2.2;
const MAX_Q = 11;
const REVEAL = 1.1;
const CARD_COL = [0xff9f43, 0x3fb8e8, 0xa98bf0, 0xf06a9a];
const BTN_W = 146;
const BTN_H = 44;

interface Problem { text: string; answer: number; options: number[]; tier: number }

interface Seat {
  p: PlayerIndex;
  panel: Panel;
  btns: { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; x: number; y: number; dead: boolean }[];
  board: Phaser.GameObjects.Text;
  tierText: Phaser.GameObjects.Text;
  timeBar: Phaser.GameObjects.Rectangle;
  chips: Phaser.GameObjects.Image[];
  checks: Phaser.GameObjects.Text[];
  lockOverlay: Phaser.GameObjects.Container;
  lockText: Phaser.GameObjects.Text;
  lock: number;
  solved: boolean;
  /** CPU plan for this problem. */
  cpuT: number;
  cpuWrong: boolean;
  skill: number;
  streak: number;
}

/** #31 — Everyone gets the same sum; fastest correct answer wins the most. */
export default class NumberRush extends BaseMinigame {
  private kit!: PanelKit;
  private seats: Seat[] = [];
  private q!: Problem;
  private qi = 0;
  private qT = 0;
  private firstAt = -1;
  private phase: 'ask' | 'reveal' = 'ask';
  private revealT = 0;
  private solvedOrder: PlayerIndex[] = [];
  private dust: { img: Phaser.GameObjects.Image; p: PlayerIndex; x: number; y: number; ph: number }[] = [];
  private t = 0;
  private correctCount = [0, 0, 0, 0];

  constructor() {
    super(CATALOG[ID]);
  }

  // ───────────────────────────── problems ─────────────────────────────

  private makeProblem(i: number): Problem {
    const r = rng(9001 + i * 104729);
    const int = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
    const tier = Math.min(4, Math.floor(i / 2.5));
    let text = '', answer = 0;
    const kind = tier === 4 ? int(0, 2) : 0;
    if (tier === 0) { const a = int(3, 9), b = int(2, 9); text = `${a} + ${b}`; answer = a + b; }
    else if (tier === 1) {
      if (r() < 0.5) { const a = int(11, 19), b = int(3, 9); text = `${a} − ${b}`; answer = a - b; }
      else { const a = int(12, 29), b = int(4, 9); text = `${a} + ${b}`; answer = a + b; }
    } else if (tier === 2) { const a = int(3, 9), b = int(3, 9); text = `${a} × ${b}`; answer = a * b; }
    else if (tier === 3) {
      if (r() < 0.5) { const a = int(24, 68), b = int(15, 29); text = `${a} + ${b}`; answer = a + b; }
      else { const a = int(52, 95), b = int(17, 38); text = `${a} − ${b}`; answer = a - b; }
    } else if (kind === 0) { const a = int(3, 9), b = int(3, 8), c = int(2, 9); text = `${a} × ${b} + ${c}`; answer = a * b + c; }
    else if (kind === 1) { const b = int(3, 9), a = b * int(3, 9); text = `${a} ÷ ${b}`; answer = a / b; }
    else { const a = int(2, 6), b = int(2, 5), c = int(2, 4); text = `(${a} + ${b}) × ${c}`; answer = (a + b) * c; }
    const opts = new Set<number>([answer]);
    const near = [1, -1, 2, -2, 10, -10, 3, -3, 5, -5, 11, 9];
    for (let k = 0; opts.size < 4 && k < 40; k++) {
      const d = near[Math.floor(r() * near.length)];
      const v = answer + d;
      if (v >= 0) opts.add(v);
    }
    const options = [...opts];
    for (let k = options.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [options[k], options[j]] = [options[j], options[k]]; }
    return { text: `${text} = ?`, answer, options, tier };
  }

  // ───────────────────────────── setup ─────────────────────────────

  setup(): void {
    this.seats = [];
    this.dust = [];
    this.qi = 0;
    this.qT = 0;
    this.firstAt = -1;
    this.phase = 'ask';
    this.revealT = 0;
    this.solvedOrder = [];
    this.t = 0;
    this.correctCount = [0, 0, 0, 0];
    this.paintTextures();
    this.add.tileSprite(0, 0, this.vw / S, this.vh / S, `${ID}-table`).setOrigin(0).setScale(S).setDepth(-100);
    this.kit = new PanelKit(this, { frame: false });
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) this.buildPanel(this.kit.panel(p));
    this.kit.onDown((p, lx, ly) => this.onTap(p, lx, ly));
    this.q = this.makeProblem(0);
    this.showProblem(true);
  }

  private paintTextures(): void {
    makeTexture(this, `${ID}-table`, 32, 32, (p) => {
      p.rect(0, 0, 32, 32, 0x3a2a24);
      for (let y = 0; y < 32; y += 8) { p.hline(0, y, 32, 0x30221e); p.hline(0, y + 1, 32, 0x44322a); }
      p.px(5, 4, 0x4a3830); p.px(20, 13, 0x4a3830); p.px(12, 22, 0x2a1e1a);
    });
    // answer cards (4 colours + pressed/correct/wrong)
    CARD_COL.forEach((c, i) => {
      for (const st of ['up', 'ok', 'bad']) {
        makeTexture(this, `${ID}-card${i}-${st}`, BTN_W / S, BTN_H / S + 2, (p) => {
          const base = st === 'ok' ? 0x4fd88a : st === 'bad' ? 0x8a8fa8 : c;
          const w = BTN_W / S, h = BTN_H / S;
          p.rect(1, 2, w - 2, h, shift(base, -0.6));
          p.rect(0, 1, w, h - 1, shift(base, -0.5));
          p.rect(1, 0, w - 2, h, shift(base, -0.5));
          p.rect(1, 1, w - 2, h - 2, base);
          p.hline(2, 1, w - 4, shift(base, 0.45));
          p.hline(2, 2, w - 4, shift(base, 0.2));
          p.hline(2, h - 2, w - 4, shift(base, -0.25));
          // shape glyph at the left so the four cards differ by more than colour
          const gx = 7, gy = Math.floor(h / 2);
          const gc = shift(base, 0.55);
          if (i === 0) p.tri(gx - 3, gy + 3, gx + 3, gy + 3, gx, gy - 3, gc);
          else if (i === 1) p.rect(gx - 3, gy - 3, 6, 6, gc);
          else if (i === 2) p.circle(gx, gy, 3.2, gc);
          else { p.tri(gx, gy - 4, gx + 4, gy, gx, gy + 4, gc); p.tri(gx, gy - 4, gx - 4, gy, gx, gy + 4, gc); }
        });
      }
    });
    makeTexture(this, `${ID}-chalk`, 3, 2, (p) => p.rect(0, 0, 3, 2, 0xffffff));
    makeTexture(this, `${ID}-x`, 12, 12, (p) => {
      p.stroke(2, 2, 9, 9, 3, 0xff5a6e);
      p.stroke(9, 2, 2, 9, 3, 0xff5a6e);
      p.outline(-0.7);
    });
  }

  private panelBg(pn: Panel): string {
    const aw = Math.round(pn.w / S), ah = Math.round(pn.h / S);
    return makeTexture(this, `${ID}-bg-${aw}x${ah}`, aw, ah, (p) => {
      const r = rng(4);
      // classroom wall
      p.rect(0, 0, aw, ah, 0xf3e9cf);
      for (let y = 0; y < ah; y += 4) p.hline(0, y, aw, 0xeee2c4);
      // wainscot
      const wy = ah - 46;
      p.rect(0, wy, aw, ah - wy, 0x5fa89a);
      p.hline(0, wy, aw, 0x7ec8b8);
      p.hline(0, wy + 1, aw, 0x4a8a7e);
      for (let x = 6; x < aw; x += 14) p.vline(x, wy + 3, ah - wy - 3, 0x56988c);
      // chalkboard
      const bx = 6, by = 4, bw = aw - 12, bh = 40;
      p.rect(bx - 2, by - 2, bw + 4, bh + 4, 0x8a5a2e);
      p.hline(bx - 2, by - 2, bw + 4, 0xb07a44);
      p.rect(bx, by, bw, bh, 0x2f6b4f);
      for (let i = 0; i < bw * bh * 0.04; i++) p.px(bx + Math.floor(r() * bw), by + Math.floor(r() * bh), 0x377a5b);
      // smudges
      for (let i = 0; i < 5; i++) p.ellipse(bx + 10 + r() * (bw - 20), by + 8 + r() * (bh - 16), 6 + r() * 6, 2, 0x3c7f60);
      // chalk tray
      p.rect(bx - 2, by + bh + 2, bw + 4, 3, 0x6a4422);
      p.rect(bx + 10, by + bh + 1, 5, 2, 0xffffff);
      p.rect(bx + 18, by + bh + 1, 4, 2, 0xffe066);
      p.rect(bx + bw - 18, by + bh + 1, 6, 2, 0xff9fa8);
      // doodles
      p.ring(bx + 8, by + bh - 9, 4, 0xa8d8bc, 1);
      p.px(bx + 7, by + bh - 10, 0xa8d8bc); p.px(bx + 9, by + bh - 10, 0xa8d8bc);
      p.hline(bx + bw - 14, by + bh - 9, 8, 0xa8d8bc);
      p.hline(bx + bw - 12, by + bh - 6, 6, 0xa8d8bc);
    });
  }

  private buildPanel(pn: Panel): void {
    const p = pn.p;
    const g = this;
    const col = PLAYER_COLORS[p];
    pn.c.add(g.add.image(0, 0, this.panelBg(pn)).setScale(S));
    // frame in the player's colour
    pn.c.add(g.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));
    const boardY = -pn.h / 2 + 4 * S + 20 * S;
    const board = txt(this, 0, boardY + 2, '', { size: 34, color: '#ffffff', stroke: '#2f6b4f', strokeWidth: 3, shadow: false });
    const tierText = txt(this, -pn.w / 2 + 22, -pn.h / 2 + 20, '', { size: 10, color: '#a8d8bc', strokeWidth: 0, shadow: false, origin: [0, 0.5] });
    const timeBar = g.add.rectangle(-pn.w / 2 + 18, boardY + 32, pn.w - 36, 4, 0xffe066).setOrigin(0, 0.5);
    pn.c.add([board, tierText, timeBar]);
    // who-has-answered chips (top right of the board)
    const chips: Phaser.GameObjects.Image[] = [];
    const checks: Phaser.GameObjects.Text[] = [];
    this.players.forEach((q, k) => {
      const x = pn.w / 2 - 24 - (this.players.length - 1 - k) * 22, y = -pn.h / 2 + 22;
      const chip = g.add.image(x, y, playerMarkerKey(this, q)).setScale(S * 0.9).setAlpha(0.45);
      const ck = txt(this, x + 7, y + 6, '', { size: 10, color: '#7ee8b0', strokeWidth: 3 });
      chips.push(chip); checks.push(ck);
      pn.c.add([chip, ck]);
    });
    // answer cards, same positions for everyone
    const btns: Seat['btns'] = [];
    for (let i = 0; i < 4; i++) {
      const x = (i % 2 === 0 ? -1 : 1) * (BTN_W / 2 + 6);
      const y = 4 + Math.floor(i / 2) * (BTN_H + 8);
      const img = g.add.image(x, y, `${ID}-card${i}-up`).setScale(S);
      const label = txt(this, x + 8, y - 1, '', { size: 24, color: '#ffffff', strokeWidth: 5 });
      pn.c.add([img, label]);
      btns.push({ img, label, x, y, dead: false });
    }
    const lockOverlay = g.add.container(0, 30).setVisible(false);
    const lockBg = g.add.rectangle(0, 0, BTN_W * 2 + 20, BTN_H * 2 + 20, 0x14172e, 0.55);
    const lockX = g.add.image(0, -10, `${ID}-x`).setScale(S * 2);
    const lockText = txt(this, 0, 22, 'ผิด! รอแป๊บ', { size: 16, color: '#ff9fa8' });
    lockOverlay.add([lockBg, lockX, lockText]);
    pn.c.add(lockOverlay);
    if (!this.players.includes(p)) return;
    const seat: Seat = {
      p, panel: pn, btns, board, tierText, timeBar, chips, checks, lockOverlay, lockText, lock: 0, solved: false,
      cpuT: 0, cpuWrong: false, skill: 0.75 + Math.random() * 0.4, streak: 0,
    };
    this.seats.push(seat);
    // floating chalk dust
    for (let i = 0; i < 6; i++) {
      const img = g.add.image(0, 0, `${ID}-chalk`).setScale(S * 0.6).setAlpha(0.5);
      pn.c.add(img);
      this.dust.push({ img, p, x: (Math.random() - 0.5) * pn.w * 0.9, y: -pn.h / 2 + 20 + Math.random() * 90, ph: Math.random() * 6 });
    }
  }

  // ───────────────────────────── flow ─────────────────────────────

  private showProblem(first = false): void {
    this.phase = 'ask';
    this.qT = 0;
    this.firstAt = -1;
    this.solvedOrder = [];
    const tierName = ['บวก', 'บวก/ลบ', 'คูณ', 'สองหลัก', 'ผสม'][this.q.tier];
    for (const s of this.seats) {
      s.solved = false;
      s.lock = 0;
      s.lockOverlay.setVisible(false);
      s.board.setText(this.q.text);
      s.tierText.setText(`ข้อ ${this.qi + 1} · ${tierName}`);
      s.chips.forEach((c) => c.setAlpha(0.45));
      s.checks.forEach((c) => c.setText(''));
      s.btns.forEach((b, i) => {
        b.dead = false;
        b.img.setTexture(`${ID}-card${i}-up`).setAlpha(1);
        b.label.setText(`${this.q.options[i]}`).setAlpha(1);
        if (!first) {
          b.img.setScale(0); b.label.setScale(0);
          this.tweens.add({ targets: [b.img], scale: S, duration: 220, delay: i * 50, ease: 'Back.easeOut' });
          this.tweens.add({ targets: [b.label], scale: 1, duration: 220, delay: i * 50, ease: 'Back.easeOut' });
        }
      });
      if (!first) { s.board.setScale(0.4); this.tweens.add({ targets: s.board, scale: 1, duration: 260, ease: 'Back.easeOut' }); }
      this.planCpu(s);
    }
    if (!first) Audio.sfx('whoosh', 1.2);
  }

  private planCpu(s: Seat): void {
    if (!this.isCpu(s.p)) return;
    const tier = this.q.tier;
    s.cpuT = ((1.4 + tier * 0.7) * (0.75 + Math.random() * 0.7)) / s.skill;
    s.cpuWrong = Math.random() < 0.08 + tier * 0.035;
  }

  private onTap(p: PlayerIndex, lx: number, ly: number): void {
    if (this.isCpu(p)) return;
    const s = this.seats.find((o) => o.p === p);
    if (!s) return;
    const i = s.btns.findIndex((b) => Math.abs(lx - b.x) < BTN_W / 2 + 3 && Math.abs(ly - b.y) < BTN_H / 2 + 3);
    if (i >= 0) this.answer(s, i);
  }

  private answer(s: Seat, i: number): void {
    if (this.phase !== 'ask' || s.solved || s.lock > 0 || this.state !== 'play') return;
    const b = s.btns[i];
    if (b.dead) return;
    if (this.q.options[i] === this.q.answer) {
      s.solved = true;
      const first = this.firstAt < 0;
      if (first) this.firstAt = this.qT;
      this.solvedOrder.push(s.p);
      const pts = first ? 2 : 1;
      this.addScore(s.p, pts);
      this.correctCount[s.p]++;
      s.streak++;
      b.img.setTexture(`${ID}-card${i}-ok`);
      Vfx.squash(this, b.img, 1.15, 0.85, 200);
      Audio.sfx(first ? 'power' : 'right', 1 + s.p * 0.08);
      this.panelPop(s, b.x + 8, b.y - 30, first ? `+2 เร็วสุด!` : '+1', first ? '#ffe066' : toCss(PLAYER_COLORS[s.p].light), first ? 20 : 18);
      this.panelBurst(s, b.x, b.y, first ? [0xffe066, 0xffffff, 0x7ee8b0] : [0x7ee8b0, 0xffffff]);
      // tell every panel who got it
      for (const o of this.seats) {
        const k = this.players.indexOf(s.p);
        o.chips[k]?.setAlpha(1);
        o.checks[k]?.setText(first ? '★' : '✓').setColor(first ? '#ffe066' : '#7ee8b0');
        if (o.chips[k]) this.tweens.add({ targets: o.chips[k], scale: { from: S * 1.4, to: S * 0.9 }, duration: 220, ease: 'Back.easeOut' });
      }
      if (first) Vfx.shake(this, 0.002, 80);
    } else {
      b.dead = true;
      s.lock = LOCK;
      s.streak = 0;
      b.img.setTexture(`${ID}-card${i}-bad`);
      b.label.setAlpha(0.5);
      s.lockOverlay.setVisible(true).setAlpha(1);
      this.tweens.add({ targets: b.img, x: b.x + 5, yoyo: true, repeat: 3, duration: 40, onComplete: () => b.img.setX(b.x) });
      Audio.sfx('wrong', 1 + s.p * 0.05);
    }
  }

  private panelPop(s: Seat, lx: number, ly: number, text: string, color: string, size: number): void {
    const t = txt(this, lx, ly, text, { size, color, strokeWidth: 5 });
    s.panel.c.add(t);
    t.setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: ly - 22, alpha: 0, delay: 500, duration: 400, onComplete: () => t.destroy() });
  }

  private panelBurst(s: Seat, lx: number, ly: number, tint: number[]): void {
    const w = this.kit.toWorld(s.p, lx, ly);
    burst(this, w.x, w.y, { tex: 'star', count: 12, tint, speed: [60, 170], life: 500, depth: 960 });
  }

  private reveal(): void {
    this.phase = 'reveal';
    this.revealT = REVEAL;
    const ai = this.q.options.indexOf(this.q.answer);
    for (const s of this.seats) {
      s.lockOverlay.setVisible(false);
      s.btns.forEach((b, i) => {
        if (i === ai) {
          b.img.setTexture(`${ID}-card${i}-ok`).setAlpha(1);
          b.label.setAlpha(1);
          this.tweens.add({ targets: b.img, scale: S * 1.08, yoyo: true, duration: 160, repeat: 1 });
        } else {
          b.img.setAlpha(0.35);
          b.label.setAlpha(0.35);
        }
      });
      s.board.setText(this.q.text.replace('?', `${this.q.answer}`));
      if (!s.solved) Vfx.squash(this, s.board, 1.1, 0.9, 200, 1);
    }
    if (!this.solvedOrder.length) Audio.sfx('back');
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const d of this.dust) {
      d.x += Math.sin(this.t * 0.6 + d.ph) * 8 * dt;
      d.y += Math.cos(this.t * 0.5 + d.ph) * 4 * dt + 3 * dt;
      if (d.y > -20) d.y = -this.kit.panel(d.p).h / 2 + 16;
      d.img.setPosition(d.x, d.y).setAlpha(0.3 + Math.sin(this.t * 1.5 + d.ph) * 0.2);
    }
    for (const s of this.seats) {
      if (s.lock > 0) s.lockOverlay.setAlpha(0.6 + Math.sin(this.t * 14) * 0.25);
      // idle wiggle on unanswered problem text to keep the scene alive
      if (this.phase === 'ask' && !s.solved) s.board.setAngle(Math.sin(this.t * 2 + s.p) * 1.2);
      else s.board.setAngle(0);
    }
  }

  tick(dt: number): void {
    if (this.phase === 'reveal') {
      this.revealT -= dt;
      if (this.revealT <= 0) {
        this.qi++;
        this.q = this.makeProblem(this.qi);
        this.showProblem();
      }
      return;
    }
    this.qT += dt;
    const limit = 7 + this.q.tier * 1.5;
    for (const s of this.seats) {
      s.lock = Math.max(0, s.lock - dt);
      if (s.lock <= 0 && s.lockOverlay.visible) s.lockOverlay.setVisible(false);
      const left = this.firstAt >= 0 ? Math.max(0, 1 - (this.qT - this.firstAt) / WINDOW) : Math.max(0, 1 - this.qT / limit);
      s.timeBar.width = (s.panel.w - 36) * left;
      s.timeBar.setFillStyle(this.firstAt >= 0 ? 0xff7a85 : 0xffe066);
      if (this.isCpu(s.p) && !s.solved && s.lock <= 0) {
        s.cpuT -= dt;
        if (s.cpuT <= 0) {
          const ai = this.q.options.indexOf(this.q.answer);
          if (s.cpuWrong) {
            const wrong = s.btns.map((_, i) => i).filter((i) => i !== ai && !s.btns[i].dead);
            this.answer(s, wrong[Math.floor(Math.random() * wrong.length)]);
            s.cpuWrong = false;
            s.cpuT = 0.4 + Math.random() * 0.8;
          } else this.answer(s, ai);
        }
      }
    }
    const allDone = this.seats.every((s) => s.solved);
    const windowOver = this.firstAt >= 0 && this.qT - this.firstAt >= WINDOW;
    if (allDone || windowOver || this.qT >= limit) {
      if (this.qi >= MAX_Q * 3) return;
      this.reveal();
    }
  }
}

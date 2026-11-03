import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { playerMarkerKey } from '../../systems/players/Avatar';
import { burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const ID = 'word-scramble';
const WINDOW = 5;
const WORD_LIMIT = 22;
const REVEAL = 1.3;
const TILE = 36;
const SLOT = 30;

const SHORT = ['PEN', 'BAG', 'MAP', 'BOOK', 'DESK', 'GLUE'];
const MEDIUM = ['CHAIR', 'RULER', 'CLOCK', 'BOARD', 'CHALK', 'GLOBE', 'PAPER'];
const LONG = ['PENCIL', 'ERASER', 'CRAYON', 'TEACHER'];
const THAI: Record<string, string> = {
  PEN: 'ปากกา', BAG: 'กระเป๋า', MAP: 'แผนที่', BOOK: 'หนังสือ', DESK: 'โต๊ะเรียน', GLUE: 'กาว', CHAIR: 'เก้าอี้', RULER: 'ไม้บรรทัด',
  CLOCK: 'นาฬิกา', BOARD: 'กระดาน', CHALK: 'ชอล์ก', GLOBE: 'ลูกโลก', PAPER: 'กระดาษ', PENCIL: 'ดินสอ', ERASER: 'ยางลบ', CRAYON: 'สีเทียน', TEACHER: 'คุณครู',
};

interface Tile { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; ch: string; x: number; y: number; used: boolean }
interface Slot { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; x: number }

interface Seat {
  p: PlayerIndex;
  panel: Panel;
  pic: Phaser.GameObjects.Image;
  thai: Phaser.GameObjects.Text;
  tiles: Tile[];
  slots: Slot[];
  typed: number[];
  done: boolean;
  clearT: number;
  undo: { img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; x: number; y: number };
  chips: Phaser.GameObjects.Image[];
  checks: Phaser.GameObjects.Text[];
  status: Phaser.GameObjects.Text;
  cpuT: number;
  cpuUndo: boolean;
  skill: number;
  words: number;
}

/** #32 — Same scrambled classroom word for everyone; tap the letters in order. */
export default class WordScramble extends BaseMinigame {
  private kit!: PanelKit;
  private seats: Seat[] = [];
  private order: string[] = [];
  private wi = 0;
  private word = '';
  private letters: string[] = [];
  private wT = 0;
  private firstAt = -1;
  private finishers: PlayerIndex[] = [];
  private phase: 'ask' | 'reveal' = 'ask';
  private revealT = 0;
  private t = 0;
  private floaters: { img: Phaser.GameObjects.Image; p: PlayerIndex; x: number; y: number; ph: number; sp: number }[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  // ───────────────────────────── words ─────────────────────────────

  private buildOrder(): void {
    const r = rng(2024);
    const shuf = (a: string[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
    const s = shuf(SHORT), m = shuf(MEDIUM), l = shuf(LONG);
    this.order = [s[0], s[1], m[0], m[1], m[2], l[0], m[3], l[1], m[4], l[2], s[2], m[5], l[3], s[3], m[6], s[4], s[5]];
  }

  private scramble(word: string, i: number): string[] {
    const r = rng(77 + i * 31);
    let a = word.split('');
    for (let k = 0; k < 20; k++) {
      a = word.split('');
      for (let n = a.length - 1; n > 0; n--) { const j = Math.floor(r() * (n + 1)); [a[n], a[j]] = [a[j], a[n]]; }
      // avoid the answer and lazy scrambles where the first two letters stay put
      if (a.join('') !== word && !(a[0] === word[0] && a[1] === word[1])) break;
    }
    return a;
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintTextures(): void {
    makeTexture(this, `${ID}-table`, 32, 32, (p) => {
      p.rect(0, 0, 32, 32, 0x2e2540);
      for (let y = 0; y < 32; y += 8) { p.hline(0, y, 32, 0x282036); p.hline(0, y + 1, 32, 0x382e4e); }
    });
    makeTexture(this, `${ID}-tile`, TILE / S, TILE / S + 2, (p) => {
      const w = TILE / S;
      p.rect(0, 2, w, w, 0x8a5a2e);
      p.box(0, 0, w, w, 0xf2d7a2, 1);
      p.rect(2, 2, w - 4, w - 4, 0xf6e2b8);
      p.hline(2, 1, w - 4, 0xfff4d8);
      p.px(w - 3, w - 3, 0xd8b47a);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-tile-used`, TILE / S, TILE / S + 2, (p) => {
      const w = TILE / S;
      p.rect(0, 2, w, w, 0x4a3a2a);
      p.rect(1, 2, w - 2, w - 2, 0x6a5038);
    });
    for (const [k, c] of [['', 0x3a2e24], ['-ok', 0x2f8a5a], ['-bad', 0xb3364a], ['-fill', 0x4a3a2e]] as const) {
      makeTexture(this, `${ID}-slot${k}`, SLOT / S, 17, (p) => {
        const w = SLOT / S;
        p.rect(0, 0, w, 17, shift(c, -0.4));
        p.rect(1, 1, w - 2, 15, c);
        p.hline(1, 15, w - 2, shift(c, 0.3));
        if (k === '') p.hline(3, 13, w - 6, 0x8a7a68);
      });
    }
    makeTexture(this, `${ID}-undo`, 46, 16, (p) => {
      p.rect(1, 2, 44, 14, 0x8a2a3a);
      p.box(0, 0, 46, 14, 0xff7a85, 1);
      p.hline(2, 1, 42, 0xffb3bd);
      p.tri(6, 7, 11, 3, 11, 11, 0xffffff);
      p.rect(11, 5, 7, 4, 0xffffff);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-frame`, 26, 26, (p) => {
      p.rect(0, 1, 26, 25, 0x5a3a1a);
      p.box(0, 0, 26, 25, 0xc0834a, 1);
      p.rect(2, 2, 22, 21, 0xfff8e7);
      p.hline(2, 2, 22, 0xffffff);
      p.px(12, 0, 0xff5a6e); p.px(13, 0, 0xff5a6e);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-letter`, 5, 5, (p) => p.rect(0, 0, 5, 5, 0xffffff));
    for (const w of [...SHORT, ...MEDIUM, ...LONG]) makeTexture(this, `${ID}-ic-${w}`, 16, 16, (p) => { this.icon(p, w); p.outline(-0.8); });
  }

  /** 16×16 picture hints for every word. */
  private icon(p: Painter, w: string): void {
    switch (w) {
      case 'PEN':
        p.stroke(3, 13, 12, 4, 3, 0x3d6bd8); p.stroke(12, 4, 13, 3, 3, 0x2b3263); p.line(2, 14, 3, 13, 0x1b1f3b); p.line(10, 4, 13, 7, 0xa8c8ff); break;
      case 'BAG':
        p.box(3, 4, 10, 11, 0xff5a6e); p.rect(5, 2, 6, 2, 0xb3263a); p.rect(6, 3, 4, 1, 0xfff8e7);
        p.box(4, 9, 8, 5, 0xe04a5e); p.hline(5, 9, 6, 0xffb3bd); p.px(8, 11, 0xffe066); break;
      case 'MAP':
        p.rect(1, 3, 5, 11, 0x7ec8e0); p.rect(6, 2, 5, 11, 0x6ab8d8); p.rect(11, 3, 4, 11, 0x7ec8e0);
        p.ellipse(7, 7, 3, 2, 0x5fbf5a); p.ellipse(12, 10, 2, 2, 0x5fbf5a); p.line(3, 6, 4, 7, 0xff3a4a); p.line(4, 6, 3, 7, 0xff3a4a);
        p.line(4, 11, 9, 10, 0xb3263a); break;
      case 'BOOK':
        p.box(2, 2, 12, 12, 0x3d9bff); p.rect(4, 12, 10, 2, 0xffffff); p.vline(4, 2, 12, 0x1d5bb3); p.rect(6, 5, 6, 2, 0xffe066); break;
      case 'DESK':
        p.box(1, 4, 14, 3, 0xc98a4b); p.rect(2, 7, 2, 7, 0x8a8f9c); p.rect(12, 7, 2, 7, 0x8a8f9c); p.box(4, 7, 8, 3, 0xa86a3a); p.box(4, 1, 4, 3, 0x7ee8b0); break;
      case 'GLUE':
        p.box(4, 5, 8, 10, 0xfff8e7); p.rect(4, 8, 8, 4, 0x3d9bff); p.rect(6, 2, 4, 3, 0xff9f43); p.rect(7, 0, 2, 2, 0xff9f43); p.px(7, 9, 0xffffff); break;
      case 'CHAIR':
        p.box(4, 1, 3, 9, 0xc98a4b); p.box(4, 8, 9, 3, 0xc98a4b); p.rect(4, 11, 2, 4, 0x8a8f9c); p.rect(11, 11, 2, 4, 0x8a8f9c); break;
      case 'RULER':
        p.stroke(2, 13, 13, 2, 4, 0xffd23d); for (let i = 0; i < 6; i++) p.px(4 + i * 2, 11 - i * 2, 0x8a6a1a); break;
      case 'CLOCK':
        p.circle(8, 8, 7, 0xff7a85); p.circle(8, 8, 5.5, 0xffffff); p.vline(8, 4, 4, 0x1b1f3b); p.hline(8, 8, 3, 0x1b1f3b); p.px(8, 3, 0x8a8f9c); p.px(13, 8, 0x8a8f9c); break;
      case 'BOARD':
        p.rect(0, 2, 16, 11, 0x8a5a2e); p.rect(1, 3, 14, 9, 0x2f6b4f); p.hline(3, 6, 5, 0xffffff); p.hline(3, 9, 8, 0xd8f0e0); p.rect(5, 13, 2, 3, 0x8a5a2e); p.rect(10, 13, 2, 3, 0x8a5a2e); break;
      case 'CHALK':
        p.stroke(2, 10, 10, 4, 3, 0xffffff); p.stroke(5, 14, 13, 8, 3, 0xffe066); p.px(1, 11, 0xd8dbe6); break;
      case 'GLOBE':
        p.ball(8, 7, 6, 6, 0x3fa0e8); p.ellipse(6, 6, 2.5, 2, 0x5fbf5a); p.ellipse(10, 9, 2, 1.5, 0x5fbf5a); p.ring(8, 7, 7, 0xc98a4b, 1); p.rect(7, 13, 2, 2, 0xc98a4b); p.rect(4, 15, 8, 1, 0x8a5a2e); break;
      case 'PAPER':
        p.box(3, 1, 10, 14, 0xffffff); for (let y = 4; y < 14; y += 2) p.hline(5, y, 6, 0x9ab0d8); p.vline(4, 2, 12, 0xff9fa8); break;
      case 'PENCIL':
        p.stroke(3, 13, 12, 4, 3, 0xffc93d); p.stroke(12, 4, 13, 3, 3, 0xff9fa8); p.line(2, 14, 3, 13, 0x5a3a1a); p.line(4, 14, 13, 5, 0xe0a020); break;
      case 'ERASER':
        p.box(2, 5, 12, 7, 0xff9fc0); p.rect(9, 5, 5, 7, 0x3d9bff); p.hline(2, 5, 12, 0xffd0e0); break;
      case 'CRAYON':
        p.stroke(3, 13, 11, 5, 4, 0xff5a4a); p.tri(10, 3, 14, 2, 13, 6, 0xff5a4a); p.line(5, 13, 10, 8, 0xfff8e7); break;
      case 'TEACHER':
        p.circle(8, 4, 3, 0x4a2a1a); p.ball(8, 8, 4.5, 4.5, 0xf2c8a0, false); p.rect(4, 4, 8, 2, 0x4a2a1a);
        p.ring(6.5, 8.5, 1.6, 0x1b1f3b); p.ring(9.5, 8.5, 1.6, 0x1b1f3b); p.hline(7, 11, 2, 0xd0505a); p.rect(4, 13, 8, 3, 0x8455d6); break;
      default: p.rect(2, 2, 12, 12, 0xffffff);
    }
  }

  private panelBg(pn: Panel): string {
    const aw = Math.round(pn.w / S), ah = Math.round(pn.h / S);
    return makeTexture(this, `${ID}-bg-${aw}x${ah}`, aw, ah, (p) => {
      const r = rng(8);
      // wooden wall
      for (let x = 0; x < aw; x += 10) {
        const c = (x / 10) % 2 ? 0xb98a5a : 0xc2945f;
        p.rect(x, 0, 10, ah, c);
        p.vline(x, 0, ah, shift(c, -0.3));
      }
      for (let i = 0; i < aw * ah * 0.02; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), 0xa87a4a);
      // cork board behind picture + slots
      p.rect(3, 4, aw - 6, 52, 0x6a4422);
      p.rect(5, 6, aw - 10, 48, 0xc99a62);
      for (let i = 0; i < aw * 12; i++) p.px(5 + Math.floor(r() * (aw - 10)), 6 + Math.floor(r() * 48), r() > 0.5 ? 0xb88a52 : 0xd8aa72);
      // pinned notes
      p.rect(aw - 26, 40, 10, 8, 0xffe066); p.px(aw - 21, 40, 0xff3a4a);
      p.rect(aw - 14, 42, 8, 7, 0x8fd6ff); p.px(aw - 10, 42, 0x3a8a3a);
      // letter rack
      const ry = 66;
      p.rect(4, ry, aw - 8, 30, 0x5a3a1a);
      p.rect(5, ry + 1, aw - 10, 27, 0x7a4e26);
      p.hline(5, ry + 1, aw - 10, 0x9a6a3a);
      p.rect(4, ry + 26, aw - 8, 4, 0x4a2e14);
      p.hline(4, ry + 26, aw - 8, 0x8a5a2e);
    });
  }

  // ───────────────────────────── setup ─────────────────────────────

  setup(): void {
    this.seats = [];
    this.floaters = [];
    this.wi = 0;
    this.t = 0;
    this.buildOrder();
    this.paintTextures();
    this.add.tileSprite(0, 0, this.vw / S, this.vh / S, `${ID}-table`).setOrigin(0).setScale(S).setDepth(-100);
    this.kit = new PanelKit(this, { frame: false });
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) this.buildPanel(this.kit.panel(p));
    this.kit.onDown((p, lx, ly) => this.onTap(p, lx, ly));
    this.newWord(true);
  }

  private buildPanel(pn: Panel): void {
    const p = pn.p;
    const col = PLAYER_COLORS[p];
    pn.c.add(this.add.image(0, 0, this.panelBg(pn)).setScale(S));
    pn.c.add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));
    const top = -pn.h / 2;
    const picX = -pn.w / 2 + 38, picY = top + 50;
    pn.c.add(this.add.image(picX, picY, `${ID}-frame`).setScale(S));
    const pic = this.add.image(picX, picY + 1, `${ID}-ic-PEN`).setScale(S);
    const thai = txt(this, picX, picY + 33, '', { size: 10, color: '#fff8e7', strokeWidth: 3 });
    pn.c.add([pic, thai]);
    const status = txt(this, 30, top + 106, '', { size: 11, color: '#fff8e7', strokeWidth: 3 });
    pn.c.add(status);
    const chips: Phaser.GameObjects.Image[] = [];
    const checks: Phaser.GameObjects.Text[] = [];
    this.players.forEach((q, k) => {
      const x = pn.w / 2 - 22 - (this.players.length - 1 - k) * 22, y = top + 22;
      const chip = this.add.image(x, y, playerMarkerKey(this, q)).setScale(S * 0.9).setAlpha(0.45);
      const ck = txt(this, x + 7, y + 6, '', { size: 10, color: '#7ee8b0', strokeWidth: 3 });
      chips.push(chip); checks.push(ck);
      pn.c.add([chip, ck]);
    });
    const ux = 0, uy = pn.h / 2 - 26;
    const undoImg = this.add.image(ux, uy, `${ID}-undo`).setScale(S);
    const undoLabel = txt(this, ux + 12, uy - 1, 'ลบ', { size: 14, color: '#ffffff', strokeWidth: 3 });
    pn.c.add([undoImg, undoLabel]);
    if (!this.players.includes(p)) return;
    const seat: Seat = {
      p, panel: pn, pic, thai, tiles: [], slots: [], typed: [], done: false, clearT: 0,
      undo: { img: undoImg, label: undoLabel, x: ux, y: uy }, chips, checks, status, cpuT: 0, cpuUndo: false,
      skill: 0.75 + Math.random() * 0.4, words: 0,
    };
    this.seats.push(seat);
    for (let i = 0; i < 5; i++) {
      const img = this.add.image(0, 0, `${ID}-letter`).setScale(S * 0.5).setAlpha(0.25).setTint([0xffe066, 0xff9fa8, 0x8fd6ff, 0x7ee8b0, 0xffffff][i]);
      pn.c.add(img);
      this.floaters.push({ img, p, x: (Math.random() - 0.5) * pn.w, y: (Math.random() - 0.5) * pn.h, ph: Math.random() * 6, sp: 6 + Math.random() * 8 });
    }
  }

  private newWord(first = false): void {
    this.word = this.order[this.wi % this.order.length];
    this.letters = this.scramble(this.word, this.wi);
    this.wT = 0;
    this.firstAt = -1;
    this.finishers = [];
    this.phase = 'ask';
    const n = this.word.length;
    for (const s of this.seats) {
      const pn = s.panel;
      for (const tl of s.tiles) { tl.img.destroy(); tl.label.destroy(); }
      for (const sl of s.slots) { sl.img.destroy(); sl.label.destroy(); }
      s.tiles = []; s.slots = []; s.typed = []; s.done = false; s.clearT = 0;
      s.pic.setTexture(`${ID}-ic-${this.word}`);
      s.thai.setText(THAI[this.word] ?? '');
      s.status.setText(`คำที่ ${this.wi + 1} · ${n} ตัว`);
      s.chips.forEach((c) => c.setAlpha(0.45));
      s.checks.forEach((c) => c.setText(''));
      const top = -pn.h / 2;
      const slotY = top + 50;
      const sx0 = 26 - ((n - 1) * (SLOT + 4)) / 2;
      for (let i = 0; i < n; i++) {
        const x = sx0 + i * (SLOT + 4);
        const img = this.add.image(x, slotY, `${ID}-slot`).setScale(S);
        const label = txt(this, x, slotY - 1, '', { size: 20, color: '#fff8e7', strokeWidth: 3 });
        pn.c.add([img, label]);
        s.slots.push({ img, label, x });
      }
      const tileY = top + 2 * 66 + 28;
      const gap = n >= 7 ? 4 : 8;
      const tx0 = -((n - 1) * (TILE + gap)) / 2;
      this.letters.forEach((ch, i) => {
        const x = tx0 + i * (TILE + gap);
        const img = this.add.image(x, tileY, `${ID}-tile`).setScale(S);
        const label = txt(this, x, tileY - 1, ch, { size: 22, color: '#5a3a1a', stroke: '#fff4d8', strokeWidth: 2, shadow: false });
        pn.c.add([img, label]);
        s.tiles.push({ img, label, ch, x, y: tileY, used: false });
        if (!first) {
          img.setScale(0); label.setScale(0);
          this.tweens.add({ targets: img, scale: S, delay: i * 45, duration: 200, ease: 'Back.easeOut' });
          this.tweens.add({ targets: label, scale: 1, delay: i * 45, duration: 200, ease: 'Back.easeOut' });
        }
      });
      this.tweens.add({ targets: s.pic, scale: { from: S * 1.5, to: S }, duration: 260, ease: 'Back.easeOut' });
      this.planCpu(s, true);
    }
    if (!first) Audio.sfx('whoosh', 1.1);
  }

  // ───────────────────────────── input ─────────────────────────────

  private onTap(p: PlayerIndex, lx: number, ly: number): void {
    if (this.isCpu(p)) return;
    const s = this.seats.find((o) => o.p === p);
    if (!s) return;
    const half = TILE / 2 + 2;
    const ti = s.tiles.findIndex((t) => Math.abs(lx - t.x) < half && Math.abs(ly - t.y) < half + 4);
    if (ti >= 0) return this.pick(s, ti);
    if (Math.abs(lx - s.undo.x) < 50 && Math.abs(ly - s.undo.y) < 20) return this.undo(s);
    const si = s.slots.findIndex((sl) => Math.abs(lx - sl.x) < SLOT / 2 + 2 && Math.abs(ly - (-s.panel.h / 2 + 50)) < 20);
    if (si >= 0 && si < s.typed.length) while (s.typed.length > si) this.undo(s);
  }

  private pick(s: Seat, ti: number): void {
    if (this.phase !== 'ask' || s.done || s.clearT > 0 || this.state !== 'play') return;
    const t = s.tiles[ti];
    if (t.used) return;
    t.used = true;
    const k = s.typed.length;
    s.typed.push(ti);
    t.img.setTexture(`${ID}-tile-used`);
    t.label.setAlpha(0.15);
    const sl = s.slots[k];
    sl.img.setTexture(`${ID}-slot-fill`);
    sl.label.setText(t.ch);
    // fly a letter from the tile to the slot
    const fly = txt(this, t.x, t.y, t.ch, { size: 22, color: '#ffe066', strokeWidth: 3 });
    s.panel.c.add(fly);
    this.tweens.add({ targets: fly, x: sl.x, y: -s.panel.h / 2 + 50, scale: 0.8, duration: 120, onComplete: () => fly.destroy() });
    sl.label.setScale(0.2);
    this.tweens.add({ targets: sl.label, scale: 1, delay: 90, duration: 160, ease: 'Back.easeOut' });
    Audio.sfx('click', 1 + k * 0.06 + s.p * 0.04);
    if (s.typed.length === this.word.length) this.check(s);
  }

  private undo(s: Seat): void {
    if (this.phase !== 'ask' || s.done || s.clearT > 0 || !s.typed.length) return;
    const ti = s.typed.pop()!;
    const t = s.tiles[ti];
    t.used = false;
    t.img.setTexture(`${ID}-tile`);
    t.label.setAlpha(1);
    this.tweens.add({ targets: t.img, scale: { from: S * 1.2, to: S }, duration: 140 });
    const sl = s.slots[s.typed.length];
    sl.img.setTexture(`${ID}-slot`);
    sl.label.setText('');
    Audio.sfx('back', 1.2);
    this.tweens.add({ targets: s.undo.img, scale: { from: S * 0.85, to: S }, duration: 120 });
  }

  private check(s: Seat): void {
    const guess = s.typed.map((i) => s.tiles[i].ch).join('');
    if (guess === this.word) {
      s.done = true;
      s.words++;
      const first = this.firstAt < 0;
      if (first) this.firstAt = this.wT;
      const inTime = first || this.wT - this.firstAt <= WINDOW;
      const pts = first ? 3 : inTime ? 1 : 0;
      if (pts) this.addScore(s.p, pts);
      this.finishers.push(s.p);
      s.slots.forEach((sl, i) => {
        sl.img.setTexture(`${ID}-slot-ok`);
        this.tweens.add({ targets: [sl.img], y: sl.img.y - 6, yoyo: true, delay: i * 40, duration: 120 });
      });
      Audio.sfx(first ? 'power' : 'right', 1 + s.p * 0.08);
      this.panelPop(s, 30, -s.panel.h / 2 + 96, first ? '+3 เร็วสุด!' : pts ? '+1 ทัน!' : 'ถูกต้อง!', first ? '#ffe066' : toCss(PLAYER_COLORS[s.p].light), first ? 22 : 18);
      const w = this.kit.toWorld(s.p, 26, -s.panel.h / 2 + 50);
      burst(this, w.x, w.y, { tex: 'star', count: first ? 16 : 9, tint: [0xffe066, 0xffffff, PLAYER_COLORS[s.p].main], speed: [60, 180], life: 520, depth: 960 });
      for (const o of this.seats) {
        const k = this.players.indexOf(s.p);
        o.chips[k]?.setAlpha(1);
        o.checks[k]?.setText(first ? '★' : '✓').setColor(first ? '#ffe066' : '#7ee8b0');
      }
      if (first) for (const o of this.seats) if (!o.done) o.status.setText(`เหลือ ${WINDOW} วิ!`).setColor('#ff9fa8');
    } else {
      s.clearT = 0.5;
      s.slots.forEach((sl) => sl.img.setTexture(`${ID}-slot-bad`));
      this.tweens.add({ targets: s.slots.map((sl) => sl.img).concat(s.slots.map((sl) => sl.label as unknown as Phaser.GameObjects.Image)), x: '+=4', yoyo: true, repeat: 3, duration: 40 });
      Audio.sfx('wrong', 1 + s.p * 0.05);
    }
  }

  private panelPop(s: Seat, lx: number, ly: number, text: string, color: string, size: number): void {
    const t = txt(this, lx, ly, text, { size, color, strokeWidth: 5 });
    s.panel.c.add(t);
    t.setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: ly - 20, alpha: 0, delay: 600, duration: 400, onComplete: () => t.destroy() });
  }

  private reveal(): void {
    this.phase = 'reveal';
    this.revealT = REVEAL;
    for (const s of this.seats) {
      if (s.done) continue;
      s.slots.forEach((sl, i) => {
        sl.label.setText(this.word[i]).setColor('#ffe066');
        sl.img.setTexture(`${ID}-slot-fill`);
      });
      s.status.setText(this.word).setColor('#ffe066');
    }
    if (!this.finishers.length) Audio.sfx('back');
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private planCpu(s: Seat, fresh: boolean): void {
    if (!this.isCpu(s.p)) return;
    s.cpuT = fresh ? ((0.9 + this.word.length * 0.32) * (0.8 + Math.random() * 0.6)) / s.skill : ((0.32 + Math.random() * 0.3) / s.skill);
  }

  private cpu(s: Seat, dt: number): void {
    if (s.done || s.clearT > 0) return;
    s.cpuT -= dt;
    if (s.cpuT > 0) return;
    if (s.cpuUndo) { s.cpuUndo = false; this.undo(s); this.planCpu(s, false); return; }
    // Is what we typed so far still right?
    const k = s.typed.length;
    const okSoFar = s.typed.every((ti, i) => s.tiles[ti].ch === this.word[i]);
    if (!okSoFar) { this.undo(s); this.planCpu(s, false); return; }
    const need = this.word[k];
    const free = s.tiles.map((t, i) => ({ t, i })).filter((o) => !o.t.used);
    const right = free.filter((o) => o.t.ch === need);
    const mistake = Math.random() < 0.07 && free.length > 1;
    const pick = mistake ? free.filter((o) => o.t.ch !== need)[0] ?? right[0] : right[0];
    if (!pick) return;
    this.pick(s, pick.i);
    if (mistake && k + 1 < this.word.length) s.cpuUndo = true;
    this.planCpu(s, false);
    if (s.cpuUndo) s.cpuT += 0.35;
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const f of this.floaters) {
      const pn = this.kit.panel(f.p);
      f.y -= f.sp * dt;
      if (f.y < -pn.h / 2) { f.y = pn.h / 2; f.x = (Math.random() - 0.5) * pn.w; }
      f.img.setPosition(f.x + Math.sin(this.t + f.ph) * 6, f.y).setAngle(this.t * 40 + f.ph * 30);
    }
    for (const s of this.seats) {
      if (this.phase === 'ask' && !s.done) s.pic.setAngle(Math.sin(this.t * 2.2 + s.p) * 5);
      else s.pic.setAngle(0);
      s.tiles.forEach((tl, i) => { if (!tl.used) tl.img.y = tl.y + Math.sin(this.t * 3 + i * 0.7) * 1; });
    }
  }

  tick(dt: number): void {
    if (this.phase === 'reveal') {
      this.revealT -= dt;
      if (this.revealT <= 0) { this.wi++; this.newWord(); }
      return;
    }
    this.wT += dt;
    for (const s of this.seats) {
      if (s.clearT > 0) {
        s.clearT -= dt;
        if (s.clearT <= 0) {
          while (s.typed.length) {
            const ti = s.typed.pop()!;
            s.tiles[ti].used = false;
            s.tiles[ti].img.setTexture(`${ID}-tile`);
            s.tiles[ti].label.setAlpha(1);
          }
          s.slots.forEach((sl) => { sl.img.setTexture(`${ID}-slot`); sl.label.setText(''); });
          this.planCpu(s, false);
        }
      }
      if (this.isCpu(s.p)) this.cpu(s, dt);
      if (this.firstAt >= 0 && !s.done) {
        const left = Math.max(0, Math.ceil(WINDOW - (this.wT - this.firstAt)));
        const label = `เหลือ ${left} วิ!`;
        if (s.status.text !== label) s.status.setText(label);
      }
    }
    const allDone = this.seats.every((s) => s.done);
    if (allDone || (this.firstAt >= 0 && this.wT - this.firstAt > WINDOW) || this.wT > WORD_LIMIT) this.reveal();
  }
}

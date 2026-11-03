import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import type { TrackedTouch } from '../../systems/input/MultiTouchManager';
import { Party } from '../../systems/party/Party';
import { Avatar } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';

const ID = 'chaos-button';
const ROUNDS = 8;
const PICK_T = 5;
const CARD_T = 1.5;
const OPT_COL = [0xff7a85, 0x6ec6ff, 0x7ee8b0];
const PANEL_W = 176;
const BTN_H = 36;

interface Opt { label: string; icon: string }
interface Ev { title: string; ill: string; opts: [Opt, Opt, Opt] }
type Twist = 'none' | 'double' | 'bonus' | 'reverse';

const EVENTS: Ev[] = [
  { title: 'ครูมาตรวจการบ้าน!', ill: 'teacher', opts: [{ label: 'ลอกเพื่อน', icon: 'copy' }, { label: 'แกล้งป่วย', icon: 'sick' }, { label: 'ทำหน้าซื่อ', icon: 'smile' }] },
  { title: 'ฝนตกหนัก!', ill: 'rain', opts: [{ label: 'กางร่ม', icon: 'umbrella' }, { label: 'วิ่งฝ่าฝน', icon: 'run' }, { label: 'รอในห้อง', icon: 'chair' }] },
  { title: 'ไฟดับ!', ill: 'bulb', opts: [{ label: 'จุดเทียน', icon: 'candle' }, { label: 'นอนต่อ', icon: 'zzz' }, { label: 'เล่าเรื่องผี', icon: 'ghost' }] },
  { title: 'หมาเข้าห้องเรียน!', ill: 'dog', opts: [{ label: 'ให้ขนม', icon: 'bone' }, { label: 'ปีนโต๊ะ', icon: 'desk' }, { label: 'เล่นด้วย', icon: 'ball' }] },
  { title: 'สอบกะทันหัน!', ill: 'paper', opts: [{ label: 'เดาข้อ ค.', icon: 'letter' }, { label: 'อ่านด่วน', icon: 'book' }, { label: 'ขอพร', icon: 'star' }] },
  { title: 'พักเที่ยงแล้ว!', ill: 'bowl', opts: [{ label: 'ส้มตำ', icon: 'salad' }, { label: 'ข้าวมันไก่', icon: 'chicken' }, { label: 'ไอติม', icon: 'icecream' }] },
  { title: 'กริ่งซ้อมหนีไฟ!', ill: 'alarm', opts: [{ label: 'วิ่งออก', icon: 'run' }, { label: 'หยิบกระเป๋า', icon: 'bag' }, { label: 'มุดใต้โต๊ะ', icon: 'desk' }] },
  { title: 'ผอ.มาเยี่ยม!', ill: 'principal', opts: [{ label: 'ยิ้มหวาน', icon: 'smile' }, { label: 'ตั้งใจเรียน', icon: 'book' }, { label: 'ร้องเพลง', icon: 'note' }] },
  { title: 'แมลงสาบบิน!', ill: 'roach', opts: [{ label: 'ตีด้วยรองเท้า', icon: 'shoe' }, { label: 'กรี๊ดดด!', icon: 'scream' }, { label: 'วิ่งหนี', icon: 'run' }] },
  { title: 'วันเกิดเพื่อน!', ill: 'cake', opts: [{ label: 'ร้องเพลง', icon: 'note' }, { label: 'เป่าเทียน', icon: 'candle' }, { label: 'แอบกินเค้ก', icon: 'cake' }] },
];

interface Btn { c: Phaser.GameObjects.Container; bg: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; ly: number }
interface PanelUI {
  p: PlayerIndex;
  c: Phaser.GameObjects.Container;
  cx: number;
  cy: number;
  angle: number;
  header: Phaser.GameObjects.Text;
  btns: Btn[];
  result: Phaser.GameObjects.Text;
}
interface Card {
  c: Phaser.GameObjects.Container;
  round: Phaser.GameObjects.Text;
  title: Phaser.GameObjects.Text;
  ill: Phaser.GameObjects.Image;
  twist: Phaser.GameObjects.Text;
  twistBg: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Rectangle;
  barW: number;
  fuse: Phaser.GameObjects.Image;
}

/** #40 — Everyone secretly picks one of three reactions; only unique picks score. */
export default class ChaosButton extends BaseMinigame {
  private round = -1;
  private phase: 'card' | 'pick' | 'reveal' | 'done' = 'card';
  private phaseT = 0;
  private deck: Ev[] = [];
  private ev!: Ev;
  private twist: Twist = 'none';
  private bonusOpt = 0;
  private choice: number[] = [-1, -1, -1, -1];
  private cpuAt: number[] = [0, 0, 0, 0];
  private cpuTaste: number[][] = [];
  private panels: PanelUI[] = [];
  private cards: Card[] = [];
  private pads: { c: Phaser.GameObjects.Container; base: Phaser.GameObjects.Image; icon: Phaser.GameObjects.Image; x: number; y: number }[] = [];
  private avatars: Avatar[] = [];
  private home: { x: number; y: number }[] = [];
  private bigBtn!: Phaser.GameObjects.Image;
  private bigBtnBase!: Phaser.GameObjects.Image;
  private rays!: Phaser.GameObjects.Image;
  private bulbs: Phaser.GameObjects.Image[] = [];
  private revealSteps: { at: number; fn: () => void; done: boolean }[] = [];
  private delta = [0, 0, 0, 0];
  private stripY = 240;

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.round = -1;
    this.phase = 'card';
    this.phaseT = 0;
    this.choice = [-1, -1, -1, -1];
    this.panels = [];
    this.cards = [];
    this.pads = [];
    this.avatars = [];
    this.home = [];
    this.bulbs = [];
    this.revealSteps = [];
    this.delta = [0, 0, 0, 0];
    this.cpuTaste = [0, 1, 2, 3].map(() => [0.6 + Math.random(), 0.6 + Math.random(), 0.6 + Math.random()]);
    const deck = Phaser.Utils.Array.Shuffle([...EVENTS]);
    this.deck = deck.slice(0, ROUNDS);
    this.paintArt();
    this.paintStage();
    this.buildStrip();
    this.buildCards();
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) this.buildPanel(p);
    for (const p of this.players) {
      const h = this.homeOf(p);
      this.home[p] = h;
      const av = new Avatar(this, p, h.x, h.y, { ring: false });
      av.markerAngle = this.angleFor(p);
      av.face(h.x < this.vw / 2 ? 1 : -1);
      this.avatars[p] = av;
    }
    this.touch.on('down', (t: TrackedTouch) => this.onTouch(t));
    this.nextRound();
  }

  private homeOf(p: PlayerIndex): { x: number; y: number } {
    const left = p % 2 === 0;
    const x = left ? (p < 2 ? 46 : 128) : (p < 2 ? this.vw - 46 : this.vw - 128);
    return { x, y: this.stripY + 26 };
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    for (const name of Object.keys(ICONS)) makeTexture(this, `${ID}-i-${name}`, 14, 14, (p) => { ICONS[name](p); p.outline(-0.8); });
    for (const name of Object.keys(ILLS)) makeTexture(this, `${ID}-ill-${name}`, 26, 22, (p) => { ILLS[name](p); p.outline(-0.8); });
    OPT_COL.forEach((c, i) => {
      makeTexture(this, `${ID}-btn-${i}`, PANEL_W / S, BTN_H / S, (p) => {
        const w = PANEL_W / S, h = BTN_H / S;
        p.rect(1, 1, w - 2, h - 1, shift(c, -0.55));
        p.rect(1, 0, w - 2, h - 2, c);
        p.rect(0, 1, w, h - 3, c);
        p.hline(2, 1, w - 4, shift(c, 0.45));
        p.hline(2, h - 3, w - 4, shift(c, -0.25));
        p.rect(3, 3, 15, h - 7, shift(c, 0.3));
        p.outline(-0.85);
      });
      makeTexture(this, `${ID}-pad-${i}`, 44, 26, (p) => {
        p.ellipse(22, 15, 22, 11, shift(c, -0.6));
        p.ellipse(22, 13, 21, 10, shift(c, -0.2));
        p.ellipse(22, 12, 18, 8, c);
        p.ellipse(19, 10, 10, 3.5, shift(c, 0.4));
        p.outline(-0.8);
      });
    });
    makeTexture(this, `${ID}-btn-locked`, PANEL_W / S, BTN_H / S, (p) => {
      const w = PANEL_W / S, h = BTN_H / S, c = 0x5a5f80;
      p.rect(1, 1, w - 2, h - 1, shift(c, -0.55));
      p.rect(0, 0, w, h - 2, c);
      p.hline(2, 1, w - 4, shift(c, 0.35));
      for (let x = 4; x < w - 4; x += 6) for (let y = 3; y < h - 4; y += 4) p.px(x + (y % 8 ? 3 : 0), y, shift(c, 0.2));
      p.outline(-0.85);
    });
    makeTexture(this, `${ID}-q`, 7, 9, (p) => { p.stamp(0, 0, ['.aaaaa.', 'aa...aa', '.....aa', '....aa.', '...aa..', '...aa..', '.......', '...aa..', '...aa..'], { a: 0xffffff }); });
    makeTexture(this, `${ID}-bigbase`, 40, 22, (p) => {
      p.ellipse(20, 13, 20, 9, 0x2b2b3a); p.ellipse(20, 11, 19, 8, 0x8f98a8); p.ellipse(20, 10, 16, 6, 0xd8dbe4);
      for (let a = 0; a < Math.PI * 2; a += 0.5) p.px(20 + Math.cos(a) * 18, 11 + Math.sin(a) * 7.5, Math.floor(a * 2) % 2 ? 0xffc93d : 0x2b2b3a);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-bigbtn`, 26, 18, (p) => {
      p.ellipse(13, 11, 12, 6, 0x9a1f30); p.rect(1, 6, 24, 5, 0xc92a42); p.ellipse(13, 6, 12, 5.5, 0xff4d5e); p.ellipse(10, 5, 6, 2.2, 0xffa0aa);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-fuse`, 9, 9, (p) => { p.ball(4, 5, 3.6, 3.6, 0x3a3f4e); p.rect(4, 0, 2, 2, 0xffc93d); p.px(6, 0, 0xff5a3d); });
    makeTexture(this, `${ID}-bulb`, 5, 5, (p) => { p.circle(2.5, 2.5, 2.4, 0xffffff); p.px(1, 1, 0xffffff); });
    makeTexture(this, `${ID}-twistbg`, 100, 12, (p) => {
      p.rect(2, 0, 96, 12, 0x8455d6); p.rect(0, 2, 100, 8, 0x8455d6);
      for (let x = 0; x < 100; x += 6) p.tri(x, 0, x + 3, 0, x, 3, 0xb8a6ff);
      p.hline(2, 1, 96, 0xb8a6ff); p.hline(2, 10, 96, 0x5a3aa0);
    });
  }

  private paintStage(): void {
    const W = this.vw, H = this.vh;
    const aw = Math.ceil(W / S), ah = Math.ceil(H / S);
    const key = makeTexture(this, `${ID}-floor-${aw}`, aw, ah, (p) => {
      p.rect(0, 0, aw, ah, 0x2a1f5a);
      const r = rng(8);
      // checker dance floor tiles
      for (let y = 0; y < ah; y += 12) for (let x = 0; x < aw; x += 12) {
        const c = ((x + y) / 12) % 2 ? 0x33276a : 0x2d2262;
        p.rect(x, y, 12, 12, c);
        p.hline(x, y, 12, shift(c, 0.12));
        if (r() < 0.06) p.px(x + 3 + Math.floor(r() * 6), y + 3 + Math.floor(r() * 6), 0xb8a6ff);
      }
      // the stage strip across the middle
      const sy = this.stripY / S;
      p.rect(0, sy - 26, aw, 52, 0x4a2e7a);
      p.hline(0, sy - 26, aw, 0xb8a6ff); p.hline(0, sy - 25, aw, 0x8455d6);
      p.hline(0, sy + 25, aw, 0x1b1240); p.hline(0, sy + 24, aw, 0x8455d6);
      for (let x = 0; x < aw; x += 16) { p.vline(x, sy - 24, 48, 0x452a72); }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
    // slowly rotating sunburst behind everything
    const rk = makeTexture(this, `${ID}-rays`, 200, 200, (p) => {
      for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
        const a = Math.atan2(y - 100, x - 100), d = Math.hypot(x - 100, y - 100);
        if (d > 99) continue;
        if (Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 2 === 0) p.px(x, y, 0xffffff, Math.round(40 * (1 - d / 100)));
      }
    });
    this.rays = this.add.image(W / 2, H / 2, rk).setScale(S * 1.9).setDepth(-95).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.6).setTint(0xb8a6ff);
    // marquee bulbs chasing around the border
    const per = 26;
    for (let i = 0; i < per; i++) {
      const t = i / per;
      this.bulbs.push(this.add.image(8 + t * (W - 16), 6, `${ID}-bulb`).setScale(S).setDepth(-80));
      this.bulbs.push(this.add.image(W - 8 - t * (W - 16), H - 6, `${ID}-bulb`).setScale(S).setDepth(-80));
    }
    for (let i = 0; i < 14; i++) {
      const t = i / 14;
      this.bulbs.push(this.add.image(5, 16 + t * (H - 32), `${ID}-bulb`).setScale(S).setDepth(-80));
      this.bulbs.push(this.add.image(W - 5, H - 16 - t * (H - 32), `${ID}-bulb`).setScale(S).setDepth(-80));
    }
    // floating sparkles
    for (let i = 0; i < 18; i++) {
      const s = this.add.image(Phaser.Math.Between(20, W - 20), Phaser.Math.Between(20, H - 20), 'spark').setScale(S).setDepth(-70).setAlpha(0).setTint([0xffe066, 0xb8a6ff, 0x6ec6ff][i % 3]);
      this.tweens.add({ targets: s, alpha: { from: 0, to: 0.8 }, angle: 90, duration: 900 + Math.random() * 900, yoyo: true, repeat: -1, delay: Math.random() * 2500, repeatDelay: Math.random() * 1500 });
    }
  }

  private buildStrip(): void {
    const W = this.vw;
    for (let k = 0; k < 3; k++) {
      const x = W / 2 + (k - 1) * 112, y = this.stripY + 6;
      const c = this.add.container(x, y).setDepth(5);
      const base = this.add.image(0, 0, `${ID}-pad-${k}`).setScale(S);
      const icon = this.add.image(0, -4, `${ID}-i-copy`).setScale(S);
      c.add([base, icon]);
      this.pads.push({ c, base, icon, x, y });
      this.tweens.add({ targets: icon, y: -8, yoyo: true, repeat: -1, duration: 600 + k * 90, ease: 'Sine.easeInOut' });
    }
    this.bigBtnBase = this.add.image(W / 2, this.stripY + 8, `${ID}-bigbase`).setScale(S).setDepth(6);
    this.bigBtn = this.add.image(W / 2, this.stripY - 2, `${ID}-bigbtn`).setScale(S).setDepth(7);
  }

  private buildCards(): void {
    const W = this.vw;
    const cw = Math.min(320, W - 2 * (PANEL_W + 16)), ch = 146;
    for (const deg of [0, 180]) {
      const cy = deg === 0 ? this.vh - 110 : 110;
      const c = this.add.container(W / 2, cy).setAngle(deg).setDepth(20);
      const bg = this.add.nineslice(0, 0, 'ui-panel', undefined, cw / S, ch / S, 6, 6, 6, 6).setScale(S);
      const strip = this.add.rectangle(0, -ch / 2 + 16, cw - 14, 20, 0x8455d6).setStrokeStyle(2, 0x1b1f3b);
      const round = txt(this, 0, -ch / 2 + 16, '', { size: 13, color: '#ffffff' });
      const ill = this.add.image(-cw / 2 + 44, -6, `${ID}-ill-teacher`).setScale(S);
      const title = txt(this, 30, -12, '', { size: 21, color: '#1b1f3b', strokeWidth: 0, shadow: false, wrap: cw - 100 });
      const twistBg = this.add.image(18, 26, `${ID}-twistbg`).setScale(S).setVisible(false);
      const twist = txt(this, 18, 26, '', { size: 13, color: '#ffffff', strokeWidth: 3 });
      const barW = cw - 50;
      const track = this.add.rectangle(10, ch / 2 - 18, barW, 8, 0x1b1f3b);
      const bar = this.add.rectangle(10 - barW / 2, ch / 2 - 18, barW, 6, 0xffc93d).setOrigin(0, 0.5);
      const fuse = this.add.image(-barW / 2 - 8, ch / 2 - 20, `${ID}-fuse`).setScale(S);
      c.add([bg, strip, round, ill, title, twistBg, twist, track, bar, fuse]);
      this.cards.push({ c, round, title, ill, twist, twistBg, bar, barW, fuse });
    }
  }

  private panelCenter(p: PlayerIndex): { x: number; y: number } {
    const left = p % 2 === 0, top = p < 2;
    const x = left ? 8 + PANEL_W / 2 : this.vw - 8 - PANEL_W / 2;
    const y = top ? this.vh - (this.vh - 112) : this.vh - 112;
    return { x, y };
  }

  private buildPanel(p: PlayerIndex): void {
    const { x, y } = this.panelCenter(p);
    const angle = this.angleFor(p);
    const c = this.add.container(x, y).setAngle(angle).setDepth(30);
    const col = PLAYER_COLORS[p];
    const header = txt(this, 0, -63, '', { size: 14, color: toCss(col.light), strokeWidth: 4 });
    const result = txt(this, 0, 14, '', { size: 34, color: '#ffe066', strokeWidth: 7 }).setAlpha(0);
    c.add(header);
    const btns: Btn[] = [];
    for (let k = 0; k < 3; k++) {
      const ly = -27 + k * (BTN_H + 4);
      const bc = this.add.container(0, ly);
      const bg = this.add.image(0, 0, `${ID}-btn-${k}`).setScale(S);
      const icon = this.add.image(-PANEL_W / 2 + 21, -1, `${ID}-i-copy`).setScale(S);
      const label = txt(this, 16, -1, '', { size: 14, color: '#1b1f3b', strokeWidth: 0, shadow: false });
      bc.add([bg, icon, label]);
      c.add(bc);
      btns.push({ c: bc, bg, icon, label, ly });
    }
    c.add(result);
    if (!this.players.includes(p)) c.setAlpha(0.25);
    this.panels[p] = { p, c, cx: x, cy: y, angle, header, btns, result };
  }

  // ───────────────────────────── rounds ─────────────────────────────

  private nextRound(): void {
    this.round++;
    if (this.round >= ROUNDS) { this.phase = 'done'; this.finish(); return; }
    this.ev = this.deck[this.round];
    this.choice = [-1, -1, -1, -1];
    this.delta = [0, 0, 0, 0];
    this.phase = 'card';
    this.phaseT = 0;
    // twists: last round is always double; others random
    const last = this.round === ROUNDS - 1;
    const roll = Math.random();
    this.twist = last ? 'double' : this.round < 2 ? 'none' : roll < 0.45 ? 'none' : roll < 0.65 ? 'bonus' : roll < 0.85 ? 'double' : 'reverse';
    this.bonusOpt = Phaser.Math.Between(0, 2);
    const twistText = last ? 'รอบสุดท้าย! แต้ม x2' : {
      none: '', double: 'แต้ม x2!', bonus: `เลือก "${this.ev.opts[this.bonusOpt].label}" +2 เสมอ!`, reverse: 'กลับด้าน! ซ้ำกัน = +2',
    }[this.twist];
    for (const card of this.cards) {
      card.round.setText(`รอบ ${this.round + 1}/${ROUNDS}`);
      card.title.setText(this.ev.title);
      card.ill.setTexture(`${ID}-ill-${this.ev.ill}`);
      card.twist.setText(twistText);
      card.twistBg.setVisible(!!twistText).setScale(S * Math.min(1.5, Math.max(0.8, (card.twist.width + 16) / 200)), S);
      card.bar.width = card.barW;
      card.bar.setFillStyle(0xffc93d);
      this.tweens.add({ targets: card.c, scaleX: { from: 0, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      if (twistText) {
        this.tweens.add({ targets: [card.twist, card.twistBg], alpha: { from: 0, to: 1 }, duration: 200, delay: 300 });
        this.tweens.add({ targets: card.twist, scale: { from: 1.6, to: 1 }, duration: 300, delay: 300, ease: 'Back.easeOut' });
      }
    }
    this.pads.forEach((pad, k) => {
      pad.icon.setTexture(`${ID}-i-${this.ev.opts[k].icon}`);
      pad.c.setVisible(false);
    });
    this.bigBtn.setVisible(true).setScale(S);
    this.bigBtnBase.setVisible(true);
    for (const pn of this.panels) {
      pn.header.setText(this.players.includes(pn.p) ? 'อ่านการ์ด...' : '');
      pn.result.setAlpha(0);
      pn.btns.forEach((b, k) => {
        b.bg.setTexture(`${ID}-btn-${k}`).clearTint();
        b.icon.setTexture(`${ID}-i-${this.ev.opts[k].icon}`).setVisible(true);
        b.label.setText(this.ev.opts[k].label).setColor('#1b1f3b');
        b.c.setAlpha(0.45).setScale(1);
      });
    }
    // CPU timing + choice prepared at pick start
    for (const p of this.players) this.cpuAt[p] = 0.7 + Math.random() * 3.6;
    Audio.sfx('whoosh');
    // the big chaos button gets slammed
    this.time.delayedCall(Party.fast ? 50 : 450, () => {
      if (!this.bigBtn.active) return;
      Vfx.squash(this, this.bigBtn, 1.3, 0.45, 260);
      Audio.sfx('drum');
      Audio.sfx('pop', 0.8);
      burst(this, this.vw / 2, this.stripY - 6, { tex: 'confetti', count: 26, tint: [0xff5a6e, 0x3d9bff, 0x3ed17a, 0xffc93d, 0xffffff], speed: [80, 220], life: 900, gravity: 0, rotate: true, depth: 40 });
    });
  }

  private startPick(): void {
    this.phase = 'pick';
    this.phaseT = 0;
    Audio.sfx('go', 1.1);
    this.bigBtn.setVisible(false);
    this.bigBtnBase.setVisible(false);
    this.pads.forEach((pad, k) => {
      pad.c.setVisible(true).setScale(0);
      this.tweens.add({ targets: pad.c, scale: 1, duration: 260, delay: k * 70, ease: 'Back.easeOut' });
    });
    for (const pn of this.panels) {
      if (!this.players.includes(pn.p)) continue;
      pn.header.setText(this.isCpu(pn.p) ? 'CPU กำลังคิด...' : 'เลือก 1 ปุ่ม!');
      pn.btns.forEach((b, k) => {
        b.c.setAlpha(1);
        this.tweens.add({ targets: b.c, scale: { from: 0.8, to: 1 }, duration: 200, delay: k * 60, ease: 'Back.easeOut' });
      });
    }
  }

  private onTouch(t: TrackedTouch): void {
    if (this.state !== 'play' || this.phase !== 'pick') return;
    const p = t.player;
    if (!this.players.includes(p) || this.isCpu(p) || this.choice[p] !== -1) return;
    const pn = this.panels[p];
    // world → panel-local (panels are rotated 0 or 180)
    const lx = pn.angle === 180 ? pn.cx - t.x : t.x - pn.cx;
    const ly = pn.angle === 180 ? pn.cy - t.y : t.y - pn.cy;
    if (Math.abs(lx) > PANEL_W / 2 + 8) return;
    const k = pn.btns.findIndex((b) => Math.abs(ly - b.ly) <= BTN_H / 2 + 3);
    if (k >= 0) this.pick(p, k);
  }

  private pick(p: PlayerIndex, k: number): void {
    this.choice[p] = k;
    const pn = this.panels[p];
    Audio.sfx('select', 1 + p * 0.1);
    const b = pn.btns[k];
    // flash the chosen one, then turn every button face-down so nobody can peek
    Vfx.squash(this, b.c as unknown as Phaser.GameObjects.Image, 1.08, 0.85, 120, 1);
    this.time.delayedCall(Party.fast ? 20 : 160, () => {
      pn.btns.forEach((bb) => {
        bb.bg.setTexture(`${ID}-btn-locked`);
        bb.icon.setTexture(`${ID}-q`);
        bb.label.setText('???').setColor('#c7c9d6');
      });
    });
    pn.header.setText('ล็อกแล้ว ✓');
    this.tweens.add({ targets: pn.header, scale: { from: 1.4, to: 1 }, duration: 200, ease: 'Back.easeOut' });
    burst(this, pn.cx, pn.cy, { tex: 'spark', count: 6, tint: [0xffffff, PLAYER_COLORS[p].light], speed: [40, 100], life: 300, depth: 40 });
    this.tweens.add({ targets: this.avatars[p].sprite, y: this.avatars[p].sprite.y - 10, yoyo: true, duration: 120 });
  }

  private cpuPick(p: PlayerIndex): void {
    const w = [...this.cpuTaste[p]];
    if (this.twist === 'bonus') w[this.bonusOpt] += 1.1;
    if (this.twist === 'reverse') w[0] += 0.8; // herd toward the "obvious" first option
    // a little table-reading: shy away from options others already locked
    if (Math.random() < 0.3) for (const q of this.players) if (q !== p && this.choice[q] >= 0) w[this.choice[q]] *= 0.55;
    for (let k = 0; k < 3; k++) w[k] *= 0.6 + Math.random() * 0.8;
    const k = w.indexOf(Math.max(...w));
    this.pick(p, k);
  }

  private startReveal(): void {
    this.phase = 'reveal';
    this.phaseT = 0;
    this.revealSteps = [];
    const at = (t: number, fn: () => void) => this.revealSteps.push({ at: t, fn, done: false });
    Audio.sfx('drum');
    for (const card of this.cards) card.bar.width = 0;
    for (const pn of this.panels) {
      if (!this.players.includes(pn.p)) continue;
      const k = this.choice[pn.p];
      pn.header.setText(k < 0 ? 'หมดเวลา!' : 'เฉลย!');
      pn.btns.forEach((b, j) => {
        b.bg.setTexture(`${ID}-btn-${j}`);
        b.icon.setTexture(`${ID}-i-${this.ev.opts[j].icon}`);
        b.label.setText(this.ev.opts[j].label).setColor('#1b1f3b');
        b.c.setAlpha(j === k ? 1 : 0.3);
        if (j === k) this.tweens.add({ targets: b.c, scale: { from: 1.15, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      });
    }
    // avatars run to their pad
    at(0.25, () => {
      const groups: PlayerIndex[][] = [[], [], []];
      for (const p of this.players) if (this.choice[p] >= 0) groups[this.choice[p]].push(p);
      groups.forEach((g, k) => g.forEach((p, i) => {
        const pad = this.pads[k];
        const tx = pad.x + (i - (g.length - 1) / 2) * 24, ty = pad.y + 14 + (i % 2) * 4;
        this.runTo(p, tx, ty, 0.55);
      }));
      for (const p of this.players) if (this.choice[p] < 0) this.avatars[p].play('lose', true);
      Audio.sfx('whoosh');
    });
    // score each pad in turn
    const counts = [0, 0, 0];
    for (const p of this.players) if (this.choice[p] >= 0) counts[this.choice[p]]++;
    const mult = this.twist === 'double' ? 2 : 1;
    for (let k = 0; k < 3; k++) {
      at(1.0 + k * 0.5, () => this.scorePad(k, counts[k], mult));
    }
    if (this.twist === 'bonus') at(2.6, () => this.scoreBonus());
    at(this.twist === 'bonus' ? 3.3 : 2.8, () => this.showDeltas());
    at(this.twist === 'bonus' ? 4.1 : 3.6, () => { for (const p of this.players) this.runTo(p, this.home[p].x, this.home[p].y, 0.45); });
  }

  private runTo(p: PlayerIndex, x: number, y: number, dur: number): void {
    const av = this.avatars[p];
    if (!av) return;
    av.face(x - av.x);
    av.play('run', true);
    const o = { x: av.x, y: av.y };
    this.tweens.add({
      targets: o, x, y, duration: (Party.fast ? 0.3 : 1) * dur * 1000, ease: 'Quad.easeInOut',
      onUpdate: () => av.setPos(o.x, o.y),
      onComplete: () => { av.setPos(x, y); av.play('idle'); Vfx.dust(this, x, y); },
    });
  }

  private scorePad(k: number, n: number, mult: number): void {
    const pad = this.pads[k];
    const who = this.players.filter((p) => this.choice[p] === k);
    if (!n) { Vfx.squash(this, pad.base, 0.9, 1.1, 160); return; }
    let pts: number;
    let label: string;
    let color: string;
    if (this.twist === 'reverse') {
      pts = n >= 2 ? 2 : 0;
      label = n >= 2 ? 'เพื่อนกัน! +2' : 'เหงา... 0';
      color = n >= 2 ? '#7ee8b0' : '#c7c9d6';
    } else if (n === 1) { pts = 3 * mult; label = `ไม่ซ้ำใคร! +${pts}`; color = '#ffe066'; }
    else if (n === 2) { pts = 0; label = 'ชนกัน! 0'; color = '#c7c9d6'; }
    else { pts = -1 * mult; label = `วุ่นวาย! ${pts}`; color = '#ff7a85'; }
    for (const p of who) { this.delta[p] += pts; this.addScore(p, pts); }
    if (pts > 0) {
      Audio.sfx('coin', 1.2);
      Audio.sfx('power', 1 + k * 0.1);
      Vfx.sparkle(this, pad.x, pad.y - 30, [0xffe066, 0xffffff, OPT_COL[k]]);
      for (const p of who) this.avatars[p].play('cheer', true);
    } else if (pts === 0) {
      Audio.sfx('hit', 0.9);
      Vfx.hit(this, pad.x, pad.y - 24, [0xffffff, 0xc7c9d6]);
      for (const p of who) this.avatars[p].play('hit', true);
    } else {
      Audio.sfx('explode', 1.2);
      Vfx.explosion(this, pad.x, pad.y - 20, 0.6);
      for (const p of who) this.avatars[p].play('stun', true);
    }
    Vfx.squash(this, pad.base, 1.3, 0.7, 220);
    for (const [deg, dy] of [[0, 48], [180, -78]] as const) {
      const t = txt(this, pad.x, pad.y + dy, label, { size: 14, color, strokeWidth: 4 }).setAngle(deg).setDepth(60).setScale(0.3);
      this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: Party.fast ? 200 : 1500, duration: 300, onComplete: () => t.destroy() });
    }
  }

  private scoreBonus(): void {
    const k = this.bonusOpt;
    const pad = this.pads[k];
    const who = this.players.filter((p) => this.choice[p] === k);
    Vfx.sparkle(this, pad.x, pad.y - 30, [0xb8a6ff, 0xffffff]);
    Audio.sfx(who.length ? 'right' : 'wrong');
    for (const p of who) { this.delta[p] += 2; this.addScore(p, 2); }
    for (const [deg, dy] of [[0, 66], [180, -96]] as const) {
      const t = txt(this, pad.x, pad.y + dy, who.length ? 'โบนัส +2!' : 'ไม่มีใครได้โบนัส', { size: 13, color: '#b8a6ff', strokeWidth: 4 }).setAngle(deg).setDepth(60);
      this.tweens.add({ targets: t, alpha: 0, delay: Party.fast ? 200 : 1200, duration: 300, onComplete: () => t.destroy() });
    }
  }

  private showDeltas(): void {
    for (const p of this.players) {
      const pn = this.panels[p];
      const d = this.delta[p];
      const s = this.choice[p] < 0 ? 'พลาด!' : d > 0 ? `+${d}` : `${d}`;
      pn.result.setText(s).setColor(d > 0 ? '#ffe066' : d < 0 ? '#ff7a85' : '#e0e0f0').setAlpha(1).setScale(0.3);
      this.tweens.add({ targets: pn.result, scale: 1, duration: 260, ease: 'Back.easeOut' });
      pn.btns.forEach((b) => b.c.setAlpha(0.15));
    }
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.rays.angle += dt * 6;
    const n = Math.floor(this.time.now / 110);
    this.bulbs.forEach((b, i) => b.setTint((i + n) % 3 === 0 ? 0xffe066 : (i + n) % 3 === 1 ? 0xff7a85 : 0x5a4fa0));
    for (const p of this.players) this.avatars[p]?.sync();
    if (this.bigBtn.visible) this.bigBtn.setY(this.stripY - 2 + Math.sin(this.time.now / 200) * 1.5);
  }

  tick(dt: number): void {
    this.phaseT += dt;
    if (this.phase === 'card') {
      if (this.phaseT >= CARD_T) this.startPick();
    } else if (this.phase === 'pick') {
      const left = Math.max(0, 1 - this.phaseT / PICK_T);
      for (const card of this.cards) {
        card.bar.width = card.barW * left;
        card.bar.setFillStyle(left < 0.3 ? (Math.floor(this.phaseT * 8) % 2 ? 0xff5a3d : 0xffe066) : 0xffc93d);
        card.fuse.setX(-card.barW / 2 - 8 + 10 + card.barW * left - 10);
      }
      if (Math.random() < 0.4) for (const card of this.cards) {
        const wx = card.c.x + (card.c.angle === 180 ? -1 : 1) * (10 - card.barW / 2 + card.barW * left);
        const wy = card.c.y + (card.c.angle === 180 ? -1 : 1) * (146 / 2 - 18);
        burst(this, wx, wy, { tex: 'dot2', count: 1, tint: [0xffe066, 0xff9f43], speed: [20, 60], life: 260, depth: 40 });
      }
      const sec = Math.ceil(PICK_T - this.phaseT);
      if (sec !== Math.ceil(PICK_T - this.phaseT + dt) && sec <= 3 && sec > 0) Audio.sfx('tick');
      for (const p of this.players) if (this.isCpu(p) && this.choice[p] < 0 && this.phaseT >= this.cpuAt[p]) this.cpuPick(p);
      const allIn = this.players.every((p) => this.choice[p] >= 0);
      if (this.phaseT >= PICK_T || (allIn && this.phaseT > 0.6)) this.startReveal();
    } else if (this.phase === 'reveal') {
      for (const s of this.revealSteps) if (!s.done && this.phaseT >= s.at) { s.done = true; s.fn(); }
      const end = (this.twist === 'bonus' ? 4.8 : 4.3);
      if (this.phaseT >= end) this.nextRound();
    }
    if (this.elapsed > 150) this.finish();
  }
}

// ───────────────────────────── pixel icons (14×14) ─────────────────────────────

const INK = 0x1b1f3b;
const face = (p: Painter, base = 0xffd8b0) => { p.ball(7, 7.5, 6, 6, base); };
const ICONS: Record<string, (p: Painter) => void> = {
  copy: (p) => {
    p.box(1, 2, 9, 11, 0xfff8e7); for (let y = 5; y < 12; y += 2) p.hline(3, y, 5, 0x8fa8d8);
    p.line(12, 1, 6, 9, 0xffc93d); p.line(13, 2, 7, 10, 0xe0a020); p.px(6, 10, INK); p.px(12, 0, 0xff7a85);
  },
  sick: (p) => {
    face(p, 0xc8f0a0); p.px(5, 6, INK); p.px(9, 6, INK); p.hline(5, 10, 4, INK);
    p.rect(10, 1, 2, 8, 0xffffff); p.rect(10, 7, 2, 3, 0xff4d4d); p.px(11, 2, 0xd8dbe4);
  },
  smile: (p) => {
    face(p); p.rect(4, 5, 2, 2, INK); p.rect(9, 5, 2, 2, INK); p.px(4, 5, 0xffffff); p.px(9, 5, 0xffffff);
    p.hline(5, 10, 5, INK); p.px(4, 9, INK); p.px(10, 9, INK); p.px(3, 8, 0xff9fb0); p.px(11, 8, 0xff9fb0);
  },
  umbrella: (p) => {
    p.ellipse(7, 5, 7, 4, 0xff5a6e); p.rect(0, 5, 14, 2, 0xff5a6e); p.px(3, 6, 0xffb3bd); p.px(7, 6, 0xffb3bd); p.px(11, 6, 0xffb3bd);
    p.ellipse(5, 3, 3, 1.5, 0xff9fb0); p.vline(7, 6, 6, 0x6a5040); p.hline(5, 12, 2, 0x6a5040); p.px(5, 11, 0x6a5040);
  },
  run: (p) => {
    p.box(3, 6, 9, 5, 0x3d9bff); p.rect(3, 10, 10, 2, 0xffffff); p.rect(6, 4, 4, 3, 0x3d9bff); p.px(7, 7, 0xffffff); p.px(9, 7, 0xffffff);
    p.hline(0, 5, 2, 0xffffff); p.hline(0, 8, 2, 0xffffff); p.hline(0, 11, 2, 0xffffff);
  },
  chair: (p) => { p.box(3, 1, 8, 7, 0xc98a4b); p.box(2, 8, 10, 2, 0xc98a4b); p.rect(3, 10, 1, 4, 0x8f98a8); p.rect(10, 10, 1, 4, 0x8f98a8); },
  candle: (p) => {
    p.ellipse(7, 3, 2, 3, 0xffc93d); p.px(7, 3, 0xffffff); p.box(5, 6, 5, 7, 0xfff8e7); p.px(5, 8, 0xffe9a8); p.vline(7, 5, 1, INK);
    p.rect(3, 12, 9, 2, 0xb8a6ff);
  },
  zzz: (p) => {
    p.stamp(1, 6, ['aaaa', '..a.', '.a..', 'aaaa'], { a: 0x6ec6ff }); p.stamp(6, 3, ['aaa', '.a.', 'aaa'], { a: 0xa8d3ff }); p.stamp(10, 0, ['aa', 'aa'], { a: 0xffffff });
    p.ellipse(6, 12, 6, 2, 0xb8a6ff);
  },
  ghost: (p) => {
    p.ellipse(7, 6, 5, 5, 0xffffff); p.rect(2, 6, 11, 6, 0xffffff); p.px(2, 12, 0xffffff); p.px(5, 12, 0xffffff); p.px(8, 12, 0xffffff); p.px(11, 12, 0xffffff);
    p.rect(4, 5, 2, 3, INK); p.rect(8, 5, 2, 3, INK); p.ellipse(7, 10, 1.2, 1, INK);
  },
  bone: (p) => { p.rect(3, 6, 8, 2, 0xfff8e7); for (const [x, y] of [[2, 5], [2, 8], [11, 5], [11, 8]]) p.circle(x, y, 1.8, 0xfff8e7); p.hline(4, 6, 6, 0xffffff); },
  desk: (p) => { p.box(0, 3, 14, 4, 0xc98a4b); p.rect(1, 7, 2, 6, 0x8f98a8); p.rect(11, 7, 2, 6, 0x8f98a8); p.rect(3, 7, 8, 3, 0xa8703a); p.rect(3, 1, 5, 2, 0x6ec6ff); },
  ball: (p) => { p.ball(7, 7, 6, 6, 0xff7a85); p.vline(7, 1, 12, 0xffffff); p.ring(7, 7, 6, 0xc94a5a); },
  letter: (p) => { p.box(1, 1, 12, 12, 0xfff8e7); p.stamp(4, 3, ['aaaaa.', 'a...a.', '.aaaa.', '....a.', 'a.aaa.', 'aa..a.', 'a...a.'], { a: 0xff5a3d }); },
  book: (p) => { p.box(1, 2, 12, 10, 0x3ed17a); p.vline(7, 2, 10, 0x1f8a4a); p.rect(2, 3, 4, 8, 0xfff8e7); p.rect(8, 3, 4, 8, 0xfff8e7); p.hline(3, 5, 2, 0x8fa8d8); p.hline(9, 5, 2, 0x8fa8d8); p.hline(3, 7, 2, 0x8fa8d8); },
  star: (p) => { p.stamp(1, 1, ['.....a.....', '....aaa....', '....aaa....', 'aaaaaaaaaaa', '.aaaaaaaaa.', '..aaaaaaa..', '..aaa.aaa..', '.aaa...aaa.', '.a.......a.'], { a: 0xffe066 }); p.px(5, 3, 0xffffff); },
  salad: (p) => { p.ellipse(7, 9, 6.5, 4, 0xfff8e7); p.ellipse(7, 7, 6, 2, 0x7ee8b0); p.px(4, 6, 0xff5a3d); p.px(9, 6, 0xff5a3d); p.px(6, 5, 0xffc93d); p.ellipse(7, 11, 4, 1.5, 0xd8dbe4); },
  chicken: (p) => { p.ellipse(7, 10, 6.5, 3, 0xfff8e7); p.ellipse(7, 8, 5, 2.5, 0xffffff); p.ellipse(7, 6, 4.5, 2, 0xf0c080); p.hline(4, 5, 6, 0xffe0a0); p.px(11, 8, 0x3ed17a); p.px(12, 7, 0x3ed17a); },
  icecream: (p) => { p.tri(4, 7, 10, 7, 7, 13, 0xe0a050); p.px(6, 9, 0xc98a4b); p.px(8, 10, 0xc98a4b); p.ball(7, 5, 4, 3.5, 0xffb3e6); p.ball(6, 2, 2.5, 2, 0xfff8e7); p.px(9, 4, 0xff5a6e); },
  bag: (p) => { p.box(2, 4, 10, 9, 0xff9f43); p.rect(5, 1, 4, 1, 0x8a5020); p.vline(4, 1, 3, 0x8a5020); p.vline(9, 1, 3, 0x8a5020); p.rect(4, 7, 6, 3, 0xffc070); p.px(7, 8, 0x8a5020); },
  note: (p) => { p.vline(5, 1, 9, INK); p.vline(11, 0, 9, INK); p.hline(5, 1, 7, INK); p.hline(5, 2, 7, INK); p.ellipse(3.5, 10.5, 2.5, 2, 0xb8a6ff); p.ellipse(9.5, 9.5, 2.5, 2, 0xb8a6ff); },
  shoe: (p) => { p.rect(1, 7, 11, 4, 0xff5a6e); p.rect(1, 4, 5, 4, 0xff5a6e); p.rect(0, 11, 13, 2, 0xffffff); p.px(3, 5, 0xffffff); p.px(3, 7, 0xffffff); p.px(12, 3, 0xffe066); p.px(13, 1, 0xffe066); },
  scream: (p) => { face(p); p.rect(4, 4, 2, 2, INK); p.rect(9, 4, 2, 2, INK); p.ellipse(7.5, 9.5, 2, 2.5, INK); p.ellipse(7.5, 10.5, 1, 1, 0xff5a6e); p.px(1, 2, 0x6ec6ff); p.px(13, 3, 0x6ec6ff); },
  cake: (p) => { p.box(2, 7, 10, 6, 0xffb3e6); p.rect(2, 7, 10, 2, 0xfff8e7); p.px(4, 9, 0xfff8e7); p.px(9, 9, 0xfff8e7); p.vline(7, 3, 4, 0x6ec6ff); p.px(7, 2, 0xffc93d); p.px(7, 1, 0xff9f43); },
};

// ───────────────────────────── event illustrations (26×22) ─────────────────────────────

const ILLS: Record<string, (p: Painter) => void> = {
  teacher: (p) => {
    p.rect(2, 2, 22, 12, 0x2f5a46); p.rect(1, 1, 24, 1, 0x8a6a4a); p.hline(4, 5, 6, 0xffffff); p.hline(4, 8, 9, 0xffffff);
    p.ball(17, 13, 5, 5, 0xffd8b0); p.rect(12, 8, 10, 3, 0x5a3a2a); p.rect(14, 12, 3, 1, INK); p.rect(19, 12, 3, 1, INK); p.hline(15, 11, 2, INK); p.hline(19, 11, 2, INK);
    p.hline(16, 16, 3, 0xb3263a); p.rect(11, 18, 12, 4, 0x8455d6); p.line(9, 21, 6, 15, 0xc98a4b);
  },
  rain: (p) => {
    p.ball(9, 6, 7, 5, 0x8f98a8, false); p.ball(16, 5, 7, 5, 0xa8b0c0, false); p.ball(13, 8, 9, 4, 0x8f98a8, false);
    for (const [x, y] of [[4, 14], [9, 16], [14, 13], [19, 16], [23, 14], [7, 19], [17, 20]]) { p.vline(x, y, 2, 0x6ec6ff); p.px(x, y + 2, 0xa8d3ff); }
    p.line(19, 9, 16, 14, 0xffe066); p.line(16, 14, 19, 14, 0xffe066); p.line(19, 14, 16, 19, 0xffe066);
  },
  bulb: (p) => {
    p.rect(0, 0, 26, 22, 0x14172e); p.ball(13, 8, 6, 6, 0x5a5f80); p.rect(10, 13, 6, 4, 0x8f98a8); p.hline(10, 15, 6, 0x6a7282);
    p.line(11, 6, 15, 10, 0x2b3263); p.px(4, 4, 0xffffff); p.px(21, 3, 0xfff1a0); p.px(22, 16, 0xffffff);
    p.rect(5, 15, 2, 2, 0xffffff); p.rect(19, 15, 2, 2, 0xffffff);
  },
  dog: (p) => {
    p.ball(12, 14, 8, 5, 0xc98a4b); p.ball(19, 9, 5, 5, 0xd9a06a); p.ellipse(16, 6, 2, 4, 0x8a5a2a); p.ellipse(23, 7, 2, 3, 0x8a5a2a);
    p.rect(17, 8, 2, 2, INK); p.rect(21, 8, 1, 2, INK); p.ellipse(22, 11, 1.5, 1, INK); p.rect(20, 13, 3, 2, 0xff7a85);
    p.rect(6, 17, 2, 4, 0xc98a4b); p.rect(15, 17, 2, 4, 0xc98a4b); p.line(4, 12, 1, 8, 0xc98a4b);
  },
  paper: (p) => {
    p.box(5, 1, 16, 20, 0xfff8e7); for (let y = 5; y < 18; y += 3) { p.hline(8, y, 9, 0x8fa8d8); p.rect(7, y - 1, 1, 2, 0x5a5f80); }
    p.stamp(15, 2, ['aaaa', 'a..a', 'a..a', 'aaaa'], { a: 0xff5a3d }); p.px(17, 4, 0xff5a3d);
    p.line(24, 4, 18, 16, 0xffc93d); p.px(18, 17, INK);
  },
  bowl: (p) => {
    p.ellipse(13, 15, 11, 6, 0xfff8e7); p.ellipse(13, 12, 11, 3, 0xffffff); p.ellipse(13, 11, 9, 2, 0xf0c080);
    p.line(17, 2, 21, 12, 0xc98a4b); p.line(19, 2, 23, 12, 0xc98a4b); p.ellipse(13, 18, 6, 2, 0x6ec6ff);
    p.vline(8, 3, 4, 0xd8dbe4); p.vline(11, 1, 5, 0xd8dbe4); p.vline(14, 3, 4, 0xd8dbe4);
  },
  alarm: (p) => {
    p.ball(13, 10, 8, 8, 0xff5a3d); p.ball(13, 10, 4, 4, 0xffc93d); p.rect(12, 18, 2, 3, 0x8f98a8);
    for (const [x0, y0, x1, y1] of [[2, 4, 0, 1], [24, 4, 26, 1], [1, 10, -1, 10], [25, 10, 27, 10], [3, 16, 0, 19], [23, 16, 26, 19]]) p.line(x0, y0, x1, y1, 0xffe066);
  },
  principal: (p) => {
    p.ball(13, 11, 8, 8, 0xffd8b0); p.rect(5, 3, 16, 3, 0x8f98a8); p.ellipse(13, 3, 6, 2, 0x8f98a8);
    p.ring(9, 10, 2.5, INK); p.ring(17, 10, 2.5, INK); p.hline(11, 10, 4, INK);
    p.rect(9, 14, 8, 2, 0x5a3a2a); p.hline(11, 17, 4, 0xb3263a); p.rect(6, 19, 14, 3, 0x2b3263); p.tri(12, 19, 14, 19, 13, 22, 0xff5a3d);
  },
  roach: (p) => {
    p.ellipse(13, 12, 7, 5, 0x8a4a2a); p.ellipse(13, 11, 5, 3, 0xa85a32); p.ball(13, 5, 3, 2.5, 0x6a3a20);
    p.line(11, 3, 6, 0, 0x6a3a20); p.line(15, 3, 20, 0, 0x6a3a20);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) p.line(13 + s * 6, 9 + i * 3, 13 + s * 10, 7 + i * 4, 0x6a3a20);
    p.ellipse(6, 9, 4, 6, 0xc8f0ff); p.ellipse(20, 9, 4, 6, 0xc8f0ff);
  },
  cake: (p) => {
    p.box(3, 11, 20, 10, 0xffb3e6); p.rect(3, 11, 20, 3, 0xfff8e7); for (let x = 5; x < 22; x += 4) p.px(x, 14, 0xfff8e7);
    p.box(6, 6, 14, 6, 0xff7a85); p.rect(6, 6, 14, 2, 0xfff8e7);
    for (const x of [9, 13, 17]) { p.vline(x, 2, 4, 0x6ec6ff); p.px(x, 1, 0xffc93d); }
    p.ellipse(13, 21, 12, 1.5, 0xd8dbe4);
  },
};

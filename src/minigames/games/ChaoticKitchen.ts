import Phaser from 'phaser';
import { buildCharacter } from '../../art/CharacterArt';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { CHARACTERS } from '../../data/characters';
import type { TrackedTouch } from '../../systems/input/MultiTouchManager';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

type Food = 'pork' | 'ball';
const RATE: Record<Food, number> = { pork: 1 / 4.0, ball: 1 / 3.0 };
const GOLD = 1;
const BURN = 1.6;
const ASH = 2.4;
const SLOT_X = [-100, 0, 100];
const SLOT_Y = 8;
const CUST_X = [-96, 96];
const FOOD_TH: Record<Food, string> = { pork: 'หมูปิ้ง', ball: 'ลูกชิ้น' };

interface Skewer {
  food: Food;
  cook: [number, number];
  up: 0 | 1;
  img: Phaser.GameObjects.Image;
  edge: Phaser.GameObjects.Rectangle;
  meter: Phaser.GameObjects.Rectangle;
  meterBg: Phaser.GameObjects.Image;
  flipT: number;
  smokeT: number;
  busy: boolean;
}

interface Customer {
  food: Food;
  qty: number;
  patience: number;
  max: number;
  spr: Phaser.GameObjects.Sprite;
  bubble: Phaser.GameObjects.Container;
  bar: Phaser.GameObjects.Rectangle;
  qtyText: Phaser.GameObjects.Text;
  leaving: boolean;
}

interface Stall {
  p: PlayerIndex;
  pn: Panel;
  slots: (Skewer | undefined)[];
  cust: (Customer | undefined)[];
  custWait: number[];
  orderIdx: number;
  combo: number;
  served: number;
  burnt: number;
  comboText: Phaser.GameObjects.Text;
  coal: Phaser.GameObjects.Image;
  smoke: { img: Phaser.GameObjects.Image; life: number; vx: number }[];
  bulbs: Phaser.GameObjects.Image[];
  tuk: Phaser.GameObjects.Image;
  tukX: number;
  // CPU
  think: number;
  skill: number;
  flipAt: number[];
}

/** #26 — Thai street grill: place, flip and serve skewers at the perfect golden moment. */
export default class ChaoticKitchen extends BaseMinigame {
  private panels!: PanelKit;
  private stalls: Stall[] = [];
  private orders: { food: Food; qty: number; who: number }[] = [];
  private t = 0;

  constructor() {
    super(CATALOG['chaotic-kitchen']);
  }

  setup(): void {
    this.stalls = [];
    this.t = 0;
    const r = rng(2626 + Math.floor(Math.random() * 999));
    // Same order list for every stall (fair).
    this.orders = [];
    for (let i = 0; i < 80; i++) this.orders.push({ food: r() < 0.5 ? 'pork' : 'ball', qty: i > 8 && r() < 0.35 ? 2 : 1, who: Math.floor(r() * CHARACTERS.length) });
    this.paint();
    this.panels = new PanelKit(this, { frame: false, inset: 3 });
    for (const pn of this.panels.panels) this.buildStall(pn);
    this.touch.on('up', (t: TrackedTouch) => this.onUp(t));
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paint(): void {
    const sheet = (food: Food) => makeSheet(this, `chaotic-kitchen-${food}`, 38, 12, 6, (p, lv) => {
      p.rect(0, 5, 38, 2, 0xd9b77a); // bamboo stick
      p.hline(0, 5, 38, 0xf0d9a6);
      p.px(37, 5, 0xa8864a); p.px(37, 6, 0xa8864a);
      const pork = [0xf2a3a3, 0xe8a070, 0xd4843c, 0xbd6a2a, 0x5a3424, 0x2a1c1c][lv];
      const ball = [0xf0d2c8, 0xe2b88e, 0xd29a52, 0xbb7a3a, 0x5a3a2a, 0x2a1e1e][lv];
      if (food === 'pork') {
        for (let k = 0; k < 3; k++) {
          const x = 5 + k * 9;
          p.box(x, 1, 8, 10, pork);
          p.hline(x + 1, 4, 6, shift(pork, lv < 4 ? 0.35 : 0.15));
          p.px(x + 2, 7, shift(pork, -0.3)); p.px(x + 5, 2, shift(pork, -0.3));
          if (lv >= 2 && lv <= 3) { p.hline(x + 1, 9, 6, shift(pork, -0.35)); p.px(x + 3, 3, 0xfff3c4); }
          if (lv >= 4) { p.px(x + 1, 3, 0x1a1214); p.px(x + 5, 8, 0x1a1214); }
        }
      } else {
        for (let k = 0; k < 4; k++) {
          const x = 7 + k * 7.5;
          p.ball(x, 6, 3.6, 4.2, ball);
          if (lv >= 2 && lv <= 3) p.hline(Math.round(x) - 2, 8, 4, shift(ball, -0.35));
          if (lv >= 4) p.px(Math.round(x), 4, 0x1a1214);
        }
      }
      if (lv === 5) for (let k = 0; k < 6; k++) p.px(6 + k * 5, 2 + (k % 3) * 3, 0x6b6b80);
      p.outline(-0.8);
    });
    sheet('pork');
    sheet('ball');
    makeTexture(this, 'chaotic-kitchen-grill', 160, 42, (p) => {
      p.box(0, 0, 160, 42, 0x4a4458, 2);
      p.rect(4, 4, 152, 34, 0x1e1418);
      const r = rng(7);
      for (let i = 0; i < 520; i++) {
        const x = 5 + Math.floor(r() * 150), y = 5 + Math.floor(r() * 32);
        p.px(x, y, [0x3a2024, 0x6a2a22, 0xb8401e, 0xff7a3a][Math.floor(r() * 4)]);
      }
      // divider rails between the three slots
      for (const x of [53, 106]) p.rect(x, 4, 2, 34, 0x6b6380);
      for (let y = 7; y < 38; y += 4) p.hline(4, y, 152, 0x9a94a8);
      for (let y = 7; y < 38; y += 4) p.hline(4, y + 1, 152, 0x3a3348);
      p.rect(0, 40, 160, 2, 0x2b2733);
      p.rect(6, 42 - 2, 6, 2, 0x2b2733); p.rect(148, 40, 6, 2, 0x2b2733);
    });
    makeTexture(this, 'chaotic-kitchen-coal', 150, 32, (p) => {
      for (let y = 0; y < 32; y++) for (let x = 0; x < 150; x++) {
        const d = Math.abs(y - 16) / 16;
        if ((x * 7 + y * 13) % 5 < 3 - d * 3) p.px(x, y, 0xff6a2a, 120);
      }
    });
    makeTexture(this, 'chaotic-kitchen-street', 170, 38, (p) => {
      const r = rng(3);
      p.gradient(0, 0, 170, 38, [0x2b2a5a, 0x3d3a78, 0x5a4a88]);
      // shophouses
      const cols = [0xd98a6a, 0xe6c07a, 0x8fbfa8, 0xc9a0d0];
      for (let i = 0; i < 5; i++) {
        const x = i * 36 - 6, c = cols[i % 4];
        p.box(x, 4, 34, 34, c);
        p.rect(x + 2, 4, 30, 4, shift(c, -0.3));
        for (let k = 0; k < 2; k++) {
          const lit = r() < 0.7;
          p.rect(x + 5 + k * 14, 11, 9, 8, lit ? 0xffe9a8 : 0x3a3a5a);
          p.hline(x + 5 + k * 14, 15, 9, lit ? 0xffd070 : 0x2b2b44);
        }
        for (let y = 24; y < 38; y += 2) p.hline(x + 3, y, 28, y % 4 ? 0x9aa3b8 : 0x7a8298);
      }
      // neon sign
      p.box(56, 0, 58, 10, 0x1b1f3b);
      p.hline(58, 2, 54, 0xff5a9e); p.hline(58, 7, 54, 0xff5a9e);
    });
    makeTexture(this, 'chaotic-kitchen-counter', 170, 9, (p) => {
      p.box(0, 0, 170, 9, 0xc0834a);
      p.hline(0, 1, 170, 0xe0a96c);
      for (let x = 10; x < 170; x += 28) p.vline(x, 3, 6, 0x8a5a34);
      p.hline(0, 8, 170, 0x6e4426);
    });
    makeTexture(this, 'chaotic-kitchen-table', 170, 36, (p) => {
      p.rect(0, 0, 170, 36, 0xa9b7c6);
      for (let y = 0; y < 36; y += 6) p.hline(0, y, 170, 0x97a5b6);
      p.hline(0, 0, 170, 0xe6eef6);
      // tray of raw pork skewers (left) + meatball bowl (right)
      p.box(22, 6, 40, 18, 0xe8ecf4);
      for (let k = 0; k < 4; k++) { p.hline(25, 9 + k * 4, 34, 0xd9b77a); for (let j = 0; j < 3; j++) p.rect(29 + j * 9, 8 + k * 4, 6, 3, 0xf2a3a3); }
      p.ellipse(130, 15, 20, 10, 0xffffff);
      p.ellipse(130, 14, 17, 7, 0xe8ecf4);
      for (let k = 0; k < 9; k++) p.ball(118 + (k % 5) * 6, 11 + Math.floor(k / 5) * 5, 2.6, 2.6, 0xf0d2c8);
    });
    makeTexture(this, 'chaotic-kitchen-bin', 18, 18, (p) => {
      p.box(2, 4, 14, 14, 0x5aa858);
      p.rect(0, 2, 18, 3, 0x3e7a3a);
      p.rect(7, 0, 4, 2, 0x3e7a3a);
      for (let x = 5; x < 15; x += 3) p.vline(x, 7, 9, 0x3e7a3a);
      p.outline(-0.7);
    });
    makeTexture(this, 'chaotic-kitchen-bubble', 24, 22, (p) => {
      p.box(0, 0, 24, 18, 0xfff8e7);
      p.tri(4, 17, 10, 17, 4, 22, 0xfff8e7);
      p.outline(-0.8);
    });
    makeTexture(this, 'chaotic-kitchen-meter', 34, 5, (p) => {
      p.rect(0, 0, 34, 5, 0x1b1f3b);
      p.rect(1, 1, 18, 3, 0xf2a3a3);
      p.rect(19, 1, 8, 3, 0xffc93d);
      p.rect(27, 1, 6, 3, 0x3a2a2a);
    });
    makeTexture(this, 'chaotic-kitchen-puff', 8, 8, (p) => { p.circle(4, 4, 4, 0xffffff); p.circle(3, 3, 2.5, 0xffffff); });
    makeTexture(this, 'chaotic-kitchen-bulb', 4, 5, (p) => { p.rect(1, 0, 2, 1, 0x3a3348); p.circle(2, 3, 1.8, 0xffffff); });
    makeTexture(this, 'chaotic-kitchen-tuk', 30, 18, (p) => {
      p.box(4, 2, 22, 10, 0x3d9bff);
      p.rect(2, 0, 26, 3, 0xffe066);
      p.rect(8, 4, 8, 6, 0xbfeaff);
      p.box(0, 10, 30, 4, 0x2b3263);
      p.circle(6, 15, 3, 0x1b1f3b); p.circle(24, 15, 3, 0x1b1f3b);
      p.px(6, 15, 0x9aa3b8); p.px(24, 15, 0x9aa3b8);
      p.outline(-0.7);
    });
    makeTexture(this, 'chaotic-kitchen-icon-pork', 14, 8, (p) => { p.hline(0, 4, 14, 0xd9b77a); for (let k = 0; k < 3; k++) p.box(2 + k * 4, 1, 3, 6, 0xd4843c); p.outline(-0.8); });
    makeTexture(this, 'chaotic-kitchen-icon-ball', 14, 8, (p) => { p.hline(0, 4, 14, 0xd9b77a); for (let k = 0; k < 3; k++) p.ball(3 + k * 4, 4, 2, 2.4, 0xd29a52); p.outline(-0.8); });
  }

  private buildStall(pn: Panel): void {
    const p = pn.p;
    const c = pn.c;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { c.add(o); return o; };
    const col = PLAYER_COLORS[p];
    // frame
    add(this.add.rectangle(0, 0, pn.w, pn.h, 0x1b1f3b));
    add(this.add.image(0, -pn.h / 2 + 38, 'chaotic-kitchen-street').setScale(S).setDisplaySize(pn.w, 76));
    const bulbs: Phaser.GameObjects.Image[] = [];
    for (let x = -pn.w / 2 + 12; x < pn.w / 2; x += 22) {
      const y = -pn.h / 2 + 6 + Math.abs(Math.sin(x * 0.03)) * 6;
      bulbs.push(add(this.add.image(x, y, 'chaotic-kitchen-bulb').setScale(S)));
    }
    const tuk = add(this.add.image(-pn.w, -pn.h / 2 + 62, 'chaotic-kitchen-tuk').setScale(S).setAlpha(0.95));
    const neon = add(txt(this, 0, -pn.h / 2 + 8, 'หมูปิ้ง · ลูกชิ้น', { size: 10, color: '#ffb3e0', stroke: '#5a1a4a', strokeWidth: 3 }));
    this.tweens.add({ targets: neon, alpha: 0.65, yoyo: true, repeat: -1, duration: 700, ease: 'Stepped' });
    const st: Stall = {
      p, pn, slots: [undefined, undefined, undefined], cust: [undefined, undefined], custWait: [0.3, 1.4], orderIdx: 0,
      combo: 0, served: 0, burnt: 0, comboText: undefined as unknown as Phaser.GameObjects.Text,
      coal: undefined as unknown as Phaser.GameObjects.Image, smoke: [], bulbs, tuk, tukX: -pn.w * (1 + Math.random()),
      think: 0.5, skill: 0.45 + Math.random() * 0.45, flipAt: [0, 0, 0],
    };
    // customers live in a sub-container so the counter covers their legs
    const custLayer = add(this.add.container(0, 0));
    custLayer.setName('cust');
    add(this.add.image(0, -36, 'chaotic-kitchen-counter').setScale(S).setDisplaySize(pn.w, 18));
    // grill
    add(this.add.image(0, SLOT_Y, 'chaotic-kitchen-grill').setScale(S));
    st.coal = add(this.add.image(0, SLOT_Y, 'chaotic-kitchen-coal').setScale(S).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5));
    for (const x of SLOT_X) add(txt(this, x, SLOT_Y, '+', { size: 18, color: '#6b6380', strokeWidth: 0, shadow: false })).setData('plus', x);
    // prep table
    add(this.add.image(0, pn.h / 2 - 30, 'chaotic-kitchen-table').setScale(S).setDisplaySize(pn.w, 60));
    add(this.add.image(0, pn.h / 2 - 24, 'chaotic-kitchen-bin').setScale(S));
    add(txt(this, 0, pn.h / 2 - 50, '↓ ทิ้ง', { size: 9, color: '#e6eef6', strokeWidth: 2 }));
    st.comboText = add(txt(this, 0, -26, '', { size: 13, color: '#ffe066' }).setAlpha(0));
    // player colour frame
    add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));
    if (!this.players.includes(p)) c.setAlpha(0.3);
    this.stalls[p] = st;
  }

  private custLayer(st: Stall): Phaser.GameObjects.Container {
    return st.pn.c.getByName('cust') as Phaser.GameObjects.Container;
  }

  // ───────────────────────────── INPUT ─────────────────────────────

  private slotAt(lx: number, ly: number): number {
    for (let i = 0; i < 3; i++) if (Math.abs(lx - SLOT_X[i]) < 50 && Math.abs(ly - SLOT_Y) < 42) return i;
    return -1;
  }

  private onUp(t: TrackedTouch): void {
    if (this.state !== 'play' || !this.players.includes(t.player) || this.isCpu(t.player)) return;
    const st = this.stalls[t.player];
    const s = this.panels.toLocal(t.player, t.startX, t.startY);
    const e = this.panels.toLocal(t.player, t.x, t.y);
    const dx = e.x - s.x, dy = e.y - s.y;
    const slot = this.slotAt(s.x, s.y);
    if (slot < 0) return;
    if (dy < -28 && Math.abs(dy) > Math.abs(dx) * 0.6) this.serve(st, slot);
    else if (dy > 28 && Math.abs(dy) > Math.abs(dx) * 0.6) this.trash(st, slot);
    else if (Math.hypot(dx, dy) < 22) this.tapSlot(st, slot);
  }

  private tapSlot(st: Stall, i: number): void {
    const sk = st.slots[i];
    if (!sk) this.place(st, i);
    else this.flip(st, i);
  }

  private demand(st: Stall, food: Food): number {
    let need = 0;
    for (const c of st.cust) if (c && !c.leaving && c.food === food) need += c.qty;
    for (const s of st.slots) if (s && s.food === food) need--;
    return need;
  }

  private place(st: Stall, i: number): void {
    const dp = this.demand(st, 'pork'), db = this.demand(st, 'ball');
    let food: Food = dp >= db ? 'pork' : 'ball';
    if (dp === db) food = st.cust[0]?.food ?? st.cust[1]?.food ?? (i % 2 ? 'ball' : 'pork');
    const c = st.pn.c;
    const meterBg = this.add.image(SLOT_X[i], SLOT_Y + 30, 'chaotic-kitchen-meter').setScale(S);
    const meter = this.add.rectangle(SLOT_X[i] - 33, SLOT_Y + 30, 3, 12, 0xffffff).setStrokeStyle(1, 0x1b1f3b);
    const edge = this.add.rectangle(SLOT_X[i], SLOT_Y + 11, 64, 3, 0xf2a3a3).setAlpha(0.9);
    const img = this.add.image(SLOT_X[i], SLOT_Y, `chaotic-kitchen-${food}`, 0).setScale(S);
    c.add([edge, img, meterBg, meter]);
    st.slots[i] = { food, cook: [0, 0], up: 0, img, edge, meter, meterBg, flipT: 0, smokeT: 0, busy: false };
    img.setY(SLOT_Y - 20).setAlpha(0);
    this.tweens.add({ targets: img, y: SLOT_Y, alpha: 1, duration: 160, ease: 'Quad.easeIn' });
    Audio.sfx('land', 1.2);
    this.puff(st, SLOT_X[i], SLOT_Y, 0xffffff, 3);
    st.flipAt[i] = GOLD + 0.05 + Math.random() * (0.22 + (1 - st.skill) * 0.45);
  }

  private flip(st: Stall, i: number): void {
    const sk = st.slots[i];
    if (!sk || sk.busy || sk.flipT > 0) return;
    sk.flipT = 0.28;
    sk.up = sk.up === 0 ? 1 : 0;
    Audio.sfx('whoosh', 1.5 + st.p * 0.05);
    this.tweens.add({
      targets: sk.img, scaleY: { from: S, to: 0 }, y: { from: SLOT_Y, to: SLOT_Y - 12 }, duration: 120, yoyo: true,
      onYoyo: () => sk.img.setFrame(this.frameOf(sk.cook[sk.up])),
      onComplete: () => sk.img.setScale(S).setY(SLOT_Y),
    });
    this.puff(st, SLOT_X[i], SLOT_Y, 0xffffff, 4);
    st.flipAt[i] = GOLD + 0.05 + Math.random() * (0.22 + (1 - st.skill) * 0.45);
  }

  private frameOf(v: number): number {
    if (v < 0.5) return 0;
    if (v < GOLD) return 1;
    if (v < 1.25) return 2;
    if (v < BURN) return 3;
    if (v < 2.0) return 4;
    return 5;
  }

  private serve(st: Stall, i: number): void {
    const sk = st.slots[i];
    if (!sk || sk.busy) return;
    // which customer wants it (most impatient first)
    const ci = [0, 1].filter((k) => st.cust[k] && !st.cust[k]!.leaving && st.cust[k]!.food === sk.food).sort((a, b) => st.cust[a]!.patience - st.cust[b]!.patience)[0];
    const raw = sk.cook[0] < GOLD || sk.cook[1] < GOLD;
    const burnt = sk.cook[0] >= BURN || sk.cook[1] >= BURN;
    if (ci === undefined) {
      this.bounce(st, i, 'ไม่มีใครสั่ง!');
      return;
    }
    if (raw && !burnt) {
      this.bounce(st, i, 'ยังดิบ!');
      st.combo = 0;
      return;
    }
    const cu = st.cust[ci]!;
    sk.busy = true;
    st.slots[i] = undefined;
    for (const o of [sk.meter, sk.meterBg, sk.edge]) o.destroy();
    this.tweens.add({ targets: sk.img, x: CUST_X[ci], y: -70, scale: S * 0.6, angle: -20, duration: 220, ease: 'Quad.easeOut', onComplete: () => sk.img.destroy() });
    if (burnt) {
      this.addScore(st.p, -2);
      st.combo = 0;
      st.burnt++;
      Audio.sfx('wrong');
      this.pop(st, CUST_X[ci], -60, 'ไหม้! −2', '#ff7a85');
      cu.spr.play(`${cu.spr.texture.key}-lose`, true);
      this.time.delayedCall(500, () => cu.spr.active && cu.spr.play(`${cu.spr.texture.key}-idle`, true));
      return;
    }
    st.combo++;
    st.served++;
    const bonus = Math.min(3, st.combo - 1);
    const quick = cu.patience / cu.max > 0.55 ? 1 : 0;
    const pts = 2 + bonus + quick;
    this.addScore(st.p, pts);
    Audio.sfx(st.combo >= 3 ? 'power' : 'coin', 1 + st.p * 0.08);
    this.pop(st, CUST_X[ci], -60, `${quick ? 'ไวมาก!' : 'อร่อย!'} +${pts}`, toCss(PLAYER_COLORS[st.p].light));
    if (st.combo >= 2) this.comboFx(st);
    cu.qty--;
    cu.qtyText.setText(cu.qty > 1 ? `x${cu.qty}` : '');
    if (cu.qty <= 0) this.leave(st, ci, true);
  }

  private bounce(st: Stall, i: number, msg: string): void {
    const sk = st.slots[i]!;
    Audio.sfx('wrong', 1.2);
    this.tweens.add({ targets: sk.img, y: SLOT_Y - 26, duration: 120, yoyo: true, ease: 'Quad.easeOut' });
    this.pop(st, SLOT_X[i], SLOT_Y - 30, msg, '#ffffff');
  }

  private trash(st: Stall, i: number): void {
    const sk = st.slots[i];
    if (!sk || sk.busy) return;
    sk.busy = true;
    st.slots[i] = undefined;
    for (const o of [sk.meter, sk.meterBg, sk.edge]) o.destroy();
    const burnt = sk.cook[0] >= BURN || sk.cook[1] >= BURN;
    this.tweens.add({ targets: sk.img, x: 0, y: st.pn.h / 2 - 22, scale: S * 0.4, angle: 180, duration: 260, ease: 'Quad.easeIn', onComplete: () => sk.img.destroy() });
    Audio.sfx('throw');
    if (burnt) { this.addScore(st.p, -1); st.burnt++; this.pop(st, 0, st.pn.h / 2 - 50, 'ไหม้ −1', '#ff7a85'); }
    st.combo = 0;
  }

  private comboFx(st: Stall): void {
    const t = st.comboText;
    t.setText(`คอมโบ x${st.combo}!`).setAlpha(1).setScale(0.5);
    this.tweens.killTweensOf(t);
    this.tweens.add({ targets: t, scale: 1.1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300 });
  }

  private pop(st: Stall, x: number, y: number, s: string, color: string): void {
    const t = txt(this, x, y, s, { size: 14, color });
    st.pn.c.add(t);
    t.setScale(0.5);
    this.tweens.add({ targets: t, scale: 1, duration: 150, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, delay: 500, duration: 400, onComplete: () => t.destroy() });
  }

  private puff(st: Stall, x: number, y: number, tint: number, n: number): void {
    for (let k = 0; k < n; k++) {
      const img = this.add.image(x + (Math.random() - 0.5) * 50, y - 4, 'chaotic-kitchen-puff').setScale(S * (0.5 + Math.random() * 0.5)).setTint(tint).setAlpha(0.6);
      st.pn.c.add(img);
      st.smoke.push({ img, life: 0.8 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 14 });
    }
  }

  // ───────────────────────────── CUSTOMERS ─────────────────────────────

  private spawnCustomer(st: Stall, k: number): void {
    const o = this.orders[st.orderIdx++ % this.orders.length];
    const ch = CHARACTERS[o.who];
    const key = buildCharacter(this, ch.id, ch.look);
    const layer = this.custLayer(st);
    const spr = this.add.sprite(CUST_X[k] + (k === 0 ? -200 : 200), -30, key, 0).setOrigin(0.5, 1).setScale(S);
    spr.play(`${key}-walk`);
    spr.setFlipX(k === 1);
    layer.add(spr);
    this.tweens.add({ targets: spr, x: CUST_X[k], duration: 520, ease: 'Quad.easeOut', onComplete: () => spr.active && spr.play(`${key}-idle`) });
    const bubble = this.add.container(CUST_X[k] + (k === 0 ? 50 : -50), -74);
    const bg = this.add.image(0, 0, 'chaotic-kitchen-bubble').setScale(S).setFlipX(k === 1);
    const icon = this.add.image(0, -6, `chaotic-kitchen-icon-${o.food}`).setScale(S);
    const label = txt(this, 0, 8, FOOD_TH[o.food], { size: 9, color: '#1b1f3b', strokeWidth: 0, shadow: false });
    const qtyText = txt(this, 22, -14, o.qty > 1 ? `x${o.qty}` : '', { size: 12, color: '#ff7a85' });
    const barBg = this.add.rectangle(0, 21, 40, 5, 0x1b1f3b);
    const bar = this.add.rectangle(-19, 21, 38, 3, 0x7ee8b0).setOrigin(0, 0.5);
    bubble.add([bg, icon, label, qtyText, barBg, bar]);
    bubble.setScale(0);
    this.tweens.add({ targets: bubble, scale: 1, delay: 400, duration: 220, ease: 'Back.easeOut' });
    st.pn.c.add(bubble);
    const max = Math.max(10, 15 - this.elapsed * 0.08) + (o.qty > 1 ? 6 : 0);
    st.cust[k] = { food: o.food, qty: o.qty, patience: max, max, spr, bubble, bar, qtyText, leaving: false };
  }

  private leave(st: Stall, k: number, happy: boolean): void {
    const cu = st.cust[k];
    if (!cu || cu.leaving) return;
    cu.leaving = true;
    st.cust[k] = undefined;
    st.custWait[k] = 0.6 + Math.random() * 0.5;
    const key = cu.spr.texture.key;
    cu.spr.play(`${key}-${happy ? 'cheer' : 'lose'}`, true);
    this.tweens.add({ targets: cu.bubble, scale: 0, duration: 180, onComplete: () => cu.bubble.destroy() });
    this.time.delayedCall(happy ? 350 : 500, () => {
      if (!cu.spr.active) return;
      cu.spr.play(`${key}-walk`, true).setFlipX(k === 0);
      this.tweens.add({ targets: cu.spr, x: CUST_X[k] + (k === 0 ? -220 : 220), duration: 700, onComplete: () => cu.spr.destroy() });
    });
    if (!happy) {
      this.addScore(st.p, -1);
      st.combo = 0;
      Audio.sfx('lose', 1.4);
      this.pop(st, CUST_X[k], -70, 'รอนาน! −1', '#ff7a85');
    }
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const st of this.stalls) {
      if (!st) continue;
      st.coal.setAlpha(0.4 + Math.sin(this.t * 7 + st.p) * 0.08 + Math.sin(this.t * 13.7) * 0.05);
      st.bulbs.forEach((b, i) => b.setTint([0xffe066, 0xff7a85, 0x7ee8b0, 0x6ec6ff][(i + Math.floor(this.t * 2.5)) % 4]).setAlpha((i + Math.floor(this.t * 5)) % 3 ? 0.9 : 0.4));
      st.tukX += dt * 70;
      if (st.tukX > st.pn.w * 2.5) st.tukX = -st.pn.w * (0.8 + Math.random());
      const tx = st.tukX - st.pn.w / 2;
      st.tuk.setX(tx).setVisible(Math.abs(tx) < st.pn.w / 2 - 30).setY(-st.pn.h / 2 + 62 + Math.sin(this.t * 20) * 0.6);
      for (const s of st.smoke) {
        s.life -= dt;
        s.img.y -= dt * 34;
        s.img.x += s.vx * dt;
        s.img.setAlpha(Math.max(0, s.life) * 0.6).setScale(s.img.scale + dt * 0.8);
        if (s.life <= 0) s.img.destroy();
      }
      st.smoke = st.smoke.filter((s) => s.life > 0);
    }
  }

  tick(dt: number): void {
    for (const st of this.stalls) {
      if (!st || !this.players.includes(st.p)) continue;
      // customers
      for (const k of [0, 1]) {
        const cu = st.cust[k];
        if (!cu) {
          st.custWait[k] -= dt;
          if (st.custWait[k] <= 0) this.spawnCustomer(st, k);
          continue;
        }
        cu.patience -= dt;
        const f = Math.max(0, cu.patience / cu.max);
        cu.bar.width = 38 * f;
        cu.bar.fillColor = f > 0.5 ? 0x7ee8b0 : f > 0.25 ? 0xffc93d : 0xff5a6e;
        if (f < 0.25) cu.bubble.x = CUST_X[k] + (k === 0 ? 50 : -50) + Math.sin(this.t * 40) * 1.5;
        if (cu.patience <= 0) this.leave(st, k, false);
      }
      // cooking
      st.slots.forEach((sk, i) => {
        if (!sk || sk.busy) return;
        sk.flipT = Math.max(0, sk.flipT - dt);
        const down = sk.up === 0 ? 1 : 0;
        sk.cook[down] += RATE[sk.food] * dt;
        if (sk.flipT <= 0) sk.img.setFrame(this.frameOf(sk.cook[sk.up]));
        const v = sk.cook[down];
        sk.edge.fillColor = [0xf2a3a3, 0xe8a070, 0xd4843c, 0xbd6a2a, 0x5a3424, 0x2a1c1c][this.frameOf(v)];
        sk.meter.x = SLOT_X[i] - 33 + Math.min(66, (v / ASH) * 66);
        sk.meter.fillColor = v >= BURN ? 0xff5a6e : v >= GOLD ? 0xffe066 : 0xffffff;
        sk.smokeT -= dt;
        if (sk.smokeT <= 0) {
          sk.smokeT = v >= BURN ? 0.12 : 0.35;
          this.puff(st, SLOT_X[i], SLOT_Y, v >= BURN ? 0x3a3348 : v >= GOLD ? 0xd8d0c8 : 0xffffff, 1);
        }
        if (v >= BURN && v - RATE[sk.food] * dt < BURN) { Audio.sfx('stun', 0.8); this.pop(st, SLOT_X[i], SLOT_Y - 26, 'ไหม้แล้ว!', '#ff9f43'); }
        if (Math.max(sk.cook[0], sk.cook[1]) >= ASH) {
          // goes up in flames
          st.slots[i] = undefined;
          for (const o of [sk.meter, sk.meterBg, sk.edge]) o.destroy();
          this.tweens.add({ targets: sk.img, alpha: 0, scaleY: 0.5, duration: 300, onComplete: () => sk.img.destroy() });
          this.puff(st, SLOT_X[i], SLOT_Y, 0x2b2733, 6);
          this.puff(st, SLOT_X[i], SLOT_Y, 0xff9f43, 3);
          Audio.sfx('explode', 1.6);
          Vfx.shake(this, 0.003, 100);
          this.addScore(st.p, -1);
          st.burnt++;
          st.combo = 0;
          this.pop(st, SLOT_X[i], SLOT_Y - 26, 'ไฟลุก! −1', '#ff7a85');
        }
      });
      for (const ch of st.pn.c.list) {
        if (ch instanceof Phaser.GameObjects.Text && ch.getData('plus') !== undefined) {
          const i = SLOT_X.indexOf(ch.getData('plus') as number);
          ch.setVisible(!st.slots[i]);
        }
      }
      if (this.isCpu(st.p)) this.bot(st, dt);
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(st: Stall, dt: number): void {
    st.think -= dt;
    if (st.think > 0) return;
    st.think = 0.22 + (1 - st.skill) * 0.45 + Math.random() * 0.3;
    if (Math.random() < (1 - st.skill) * 0.08) { st.think += 0.8 + Math.random(); return; }
    // 1. trash burnt
    for (let i = 0; i < 3; i++) {
      const sk = st.slots[i];
      if (sk && !sk.busy && (sk.cook[0] >= BURN || sk.cook[1] >= BURN) && Math.random() < 0.7) return this.trash(st, i);
    }
    // 1b. nobody wants this one any more and it is about to burn: bin it
    for (let i = 0; i < 3; i++) {
      const sk = st.slots[i];
      if (!sk || sk.busy) continue;
      const wanted = st.cust.some((c) => c && !c.leaving && c.food === sk.food);
      if (!wanted && Math.max(sk.cook[0], sk.cook[1]) > BURN - 0.15 && sk.cook[0] >= GOLD && sk.cook[1] >= GOLD) return this.trash(st, i);
    }
    // 2. serve ready
    for (let i = 0; i < 3; i++) {
      const sk = st.slots[i];
      if (sk && !sk.busy && sk.cook[0] >= GOLD && sk.cook[1] >= GOLD && sk.cook[0] < BURN && sk.cook[1] < BURN) {
        if (st.cust.some((c) => c && !c.leaving && c.food === sk.food)) return this.serve(st, i);
      }
    }
    // 3. flip when the bottom is done
    for (let i = 0; i < 3; i++) {
      const sk = st.slots[i];
      if (!sk || sk.busy) continue;
      const down = sk.up === 0 ? 1 : 0;
      if (sk.cook[down] >= st.flipAt[i] && sk.cook[sk.up] < GOLD) return this.flip(st, i);
    }
    // 4. place where needed
    if (this.demand(st, 'pork') > 0 || this.demand(st, 'ball') > 0) {
      const i = st.slots.findIndex((s) => !s);
      if (i >= 0) return this.place(st, i);
    }
  }
}

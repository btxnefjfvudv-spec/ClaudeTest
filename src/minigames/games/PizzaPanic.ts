import Phaser from 'phaser';
import { S } from '../../art/common';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import type { TrackedTouch } from '../../systems/input/MultiTouchManager';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

type Top = 'pepperoni' | 'mushroom' | 'olive' | 'pineapple';
const TOPS: Top[] = ['pepperoni', 'mushroom', 'olive', 'pineapple'];
const PIZZA = { x: 26, y: -20, r: 58, drop: 54 };
const BINS_Y = 60;
const BIN_X = [-102, -34, 34, 102];
const BELL = { x: 132, y: -44 };
const TICKET = { x: -118, y: -38 };

interface Order { need: Record<Top, number>; total: number }
interface Placed { top: Top; img: Phaser.GameObjects.Image }
interface Drag { id: number; top: Top; img: Phaser.GameObjects.Image; from?: Placed }

interface Kitchen {
  p: PlayerIndex;
  pn: Panel;
  orderIdx: number;
  order: Order;
  placed: Placed[];
  drags: Drag[];
  pizza: Phaser.GameObjects.Container;
  ticket: Phaser.GameObjects.Container;
  bell: Phaser.GameObjects.Image;
  bonusBar: Phaser.GameObjects.Rectangle;
  orderText: Phaser.GameObjects.Text;
  fire: Phaser.GameObjects.Sprite;
  steam: { img: Phaser.GameObjects.Image; life: number }[];
  t: number;
  par: number;
  lock: number;
  streak: number;
  done: number;
  wrong: number;
  // CPU
  skill: number;
  plan: Top[];
  hand?: { top: Top; img: Phaser.GameObjects.Image; t: number; dur: number; x0: number; y0: number; x1: number; y1: number };
  think: number;
  checked: boolean;
}

/** #27 — Build pizzas to the exact order card, then hit the bell. */
export default class PizzaPanic extends BaseMinigame {
  private panels!: PanelKit;
  private kitchens: Kitchen[] = [];
  private orders: Order[] = [];
  private t = 0;

  constructor() {
    super(CATALOG['pizza-panic']);
  }

  setup(): void {
    this.kitchens = [];
    this.t = 0;
    this.makeOrders();
    this.paint();
    this.panels = new PanelKit(this, { frame: false, inset: 3 });
    for (const pn of this.panels.panels) this.buildKitchen(pn);
    this.touch.on('down', (t: TrackedTouch) => this.onDown(t));
    this.touch.on('up', (t: TrackedTouch) => this.onUp(t, false));
    this.touch.on('cancel', (t: TrackedTouch) => this.onUp(t, true));
  }

  private makeOrders(): void {
    const r = rng(2727 + Math.floor(Math.random() * 999));
    this.orders = [];
    for (let i = 0; i < 40; i++) {
      const kinds = i < 2 ? 2 : i < 5 ? 3 : r() < 0.5 ? 3 : 4;
      const pool = [...TOPS].sort(() => r() - 0.5).slice(0, kinds);
      const need = { pepperoni: 0, mushroom: 0, olive: 0, pineapple: 0 } as Record<Top, number>;
      let total = 0;
      for (const k of pool) {
        const n = 1 + Math.floor(r() * (i < 3 ? 3 : 4));
        need[k] = n;
        total += n;
      }
      this.orders.push({ need, total });
    }
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paint(): void {
    makeTexture(this, 'pizza-panic-bg', 170, 118, (p) => {
      const r = rng(27);
      // tiled wall strip
      for (let y = 0; y < 22; y++) for (let x = 0; x < 170; x++) p.px(x, y, (Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? 0xe8f1f8 : 0xc9dcea);
      for (let x = 0; x < 170; x += 6) p.vline(x, 0, 22, 0xb0c4d6);
      for (let y = 0; y < 22; y += 6) p.hline(0, y, 170, 0xb0c4d6);
      // oven mouth (fire sprite sits on top)
      p.rect(118, 0, 50, 22, 0x8a3c36);
      for (let y = 0; y < 22; y += 4) { p.hline(118, y, 50, 0x6e2e2a); for (let x = 118 + ((y / 4) % 2) * 4; x < 168; x += 8) p.vline(x, y, 4, 0x6e2e2a); }
      p.ellipse(143, 22, 18, 13, 0x1b1214);
      // counter wood
      for (let y = 22; y < 118; y++) for (let x = 0; x < 170; x++) p.px(x, y, Math.floor(y / 10) % 2 ? 0xd29a5c : 0xc98f52);
      for (let y = 22; y < 118; y += 10) p.hline(0, y, 170, 0xa8723e);
      p.hline(0, 22, 170, 0x7a4a2c);
      p.hline(0, 23, 170, 0xeab87a);
      for (let i = 0; i < 180; i++) p.px(Math.floor(r() * 170), 24 + Math.floor(r() * 94), r() > 0.4 ? 0xb8804a : 0xe0ad72);
      // flour dusting
      for (let i = 0; i < 90; i++) { const a = r() * Math.PI * 2, d = 30 + r() * 12; p.px(Math.round(98 + Math.cos(a) * d), Math.round(49 + Math.sin(a) * d * 0.8), 0xfff8e7); }
    });
    makeSheet(this, 'pizza-panic-fire', 40, 14, 3, (p, i) => {
      const r = rng(3 + i);
      for (let k = 0; k < 9; k++) {
        const x = 4 + k * 4 + Math.floor(r() * 2), h = 6 + Math.floor(r() * 7);
        p.tri(x - 3, 14, x + 3, 14, x + (r() - 0.5) * 2, 14 - h, 0xff7a3a);
        p.tri(x - 2, 14, x + 2, 14, x, 14 - h * 0.6, 0xffe066);
      }
    });
    if (!this.anims.exists('pizza-panic-flame')) this.anims.create({ key: 'pizza-panic-flame', frames: this.anims.generateFrameNumbers('pizza-panic-fire', {}), frameRate: 9, repeat: -1 });
    makeTexture(this, 'pizza-panic-pizza', 62, 62, (p) => {
      p.circle(31, 32, 30, 0x8a5a34);
      p.circle(31, 31, 30, 0xe0a050);
      p.ring(31, 31, 29, 0xf0c070, 2);
      p.circle(31, 31, 25, 0xd0402c);
      p.circle(30, 30, 24, 0xe04a32);
      const r = rng(5);
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 20;
        p.ellipse(31 + Math.cos(a) * d, 31 + Math.sin(a) * d, 4 + r() * 3, 3 + r() * 2, r() > 0.4 ? 0xffe39a : 0xfff0c0);
      }
      for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2; p.px(31 + Math.cos(a) * 27, 31 + Math.sin(a) * 27, 0xc07a3a); }
      p.outline(-0.6);
    });
    makeTexture(this, 'pizza-panic-board', 70, 70, (p) => {
      p.circle(35, 36, 34, 0x7a4a2c);
      p.circle(35, 35, 34, 0xb07540);
      p.ring(35, 35, 33, 0xd29a5c, 1);
    });
    const top = (k: Top, w: number, h: number, draw: (p: import('../../art/Painter').Painter) => void) => makeTexture(this, `pizza-panic-${k}`, w, h, (p) => { draw(p); p.outline(-0.8); });
    top('pepperoni', 10, 10, (p) => {
      p.circle(5, 5, 4.6, 0xc0302a);
      p.circle(5, 5, 3.8, 0xd8443a);
      for (const [x, y] of [[3, 3], [6, 4], [4, 7], [7, 7]]) p.px(x, y, 0xf0a08a);
      p.px(3, 2, 0xff9a8a);
    });
    top('mushroom', 10, 9, (p) => {
      p.ellipse(5, 3.5, 4.8, 3.5, 0xe8dcc8);
      p.rect(3, 4, 4, 5, 0xe8dcc8);
      p.ellipse(5, 3.5, 3.6, 2.3, 0xc8b8a0);
      p.vline(5, 5, 3, 0xc8b8a0);
      p.px(3, 2, 0xfff8e7);
    });
    top('olive', 8, 8, (p) => {
      p.circle(4, 4, 3.8, 0x2b2733);
      p.circle(4, 4, 1.6, 0x6e3a4a);
      p.px(2, 2, 0x8a8a9a);
    });
    top('pineapple', 9, 8, (p) => {
      p.tri(0, 7, 9, 7, 4.5, 0, 0xffd84d);
      p.rect(1, 5, 7, 2, 0xffe680);
      p.hline(2, 4, 5, 0xe0b030);
      p.px(4, 2, 0xfff3c4);
    });
    makeTexture(this, 'pizza-panic-bin', 28, 20, (p) => {
      p.box(0, 2, 28, 18, 0xc9ced8);
      p.rect(2, 4, 24, 14, 0x8a90a0);
      p.hline(0, 2, 28, 0xf0f4f8);
      p.outline(-0.7);
    });
    makeTexture(this, 'pizza-panic-bell', 18, 16, (p) => {
      p.rect(8, 0, 2, 3, 0x6b7290);
      p.ellipse(9, 9, 8, 6, 0xd8dbe4);
      p.rect(1, 9, 16, 3, 0xd8dbe4);
      p.ellipse(7, 6, 3, 2, 0xffffff);
      p.box(0, 12, 18, 4, 0xb8584a);
      p.hline(1, 13, 16, 0xe08a78);
      p.outline(-0.8);
    });
    makeTexture(this, 'pizza-panic-ticket', 42, 54, (p) => {
      p.rect(1, 2, 40, 52, 0xd8cfb8);
      p.rect(0, 0, 40, 52, 0xfffbef);
      for (let y = 14; y < 50; y += 9) p.hline(3, y, 34, 0xe6dcc4);
      p.rect(0, 0, 40, 9, 0xff7a85);
      p.rect(16, 0, 8, 3, 0x9aa3b8);
      for (let x = 0; x < 40; x += 4) p.px(x + 2, 51, 0xd8cfb8);
      p.outline(-0.6);
    });
    makeTexture(this, 'pizza-panic-steam', 8, 8, (p) => { p.circle(4, 4, 3.8, 0xffffff); });
    makeTexture(this, 'pizza-panic-hand', 14, 12, (p) => {
      p.ball(7, 7, 6, 5, 0xffd9b8);
      p.rect(2, 1, 3, 6, 0xffd9b8); p.rect(6, 0, 3, 6, 0xffd9b8); p.rect(10, 1, 3, 6, 0xffd9b8);
      p.outline(-0.6);
    });
  }

  private buildKitchen(pn: Panel): void {
    const p = pn.p;
    const c = pn.c;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { c.add(o); return o; };
    add(this.add.image(0, 0, 'pizza-panic-bg').setDisplaySize(pn.w, pn.h));
    const fire = add(this.add.sprite(0, -pn.h / 2 + 38, 'pizza-panic-fire', 0).setScale(S * 0.9));
    fire.x = (143 - 85) * (pn.w / 170);
    fire.y = -pn.h / 2 + 22 * (pn.h / 118) - 10;
    fire.play({ key: 'pizza-panic-flame', startFrame: p % 3 });
    // hanging utensils
    for (const [x, len] of [[-30, 18], [-8, 24], [14, 16]] as const) {
      const u = add(this.add.rectangle(x, -pn.h / 2, 3, len, 0x9aa3b8).setOrigin(0.5, 0));
      const head = add(this.add.ellipse(x, -pn.h / 2 + len + 4, 10, 8, 0xb8bfd0).setStrokeStyle(1, 0x5d6378));
      this.tweens.add({ targets: [u, head], angle: { from: -6, to: 6 }, yoyo: true, repeat: -1, duration: 1300 + x * 5, ease: 'Sine.easeInOut' });
    }
    add(this.add.image(PIZZA.x, PIZZA.y, 'pizza-panic-board').setScale(S));
    const pizza = add(this.add.container(PIZZA.x, PIZZA.y));
    pizza.add(this.add.image(0, 0, 'pizza-panic-pizza').setScale(S));
    // bins
    TOPS.forEach((k, i) => {
      add(this.add.image(BIN_X[i], BINS_Y, 'pizza-panic-bin').setScale(S * 0.95));
      const r = rng(40 + i);
      for (let n = 0; n < 7; n++) add(this.add.image(BIN_X[i] + (r() - 0.5) * 36, BINS_Y + 2 + (r() - 0.5) * 16, `pizza-panic-${k}`).setScale(S * 0.85).setAngle(r() * 360));
    });
    const bell = add(this.add.image(BELL.x, BELL.y, 'pizza-panic-bell').setScale(S * 1.25));
    add(txt(this, BELL.x, BELL.y + 30, 'ส่ง!', { size: 12, color: '#ffe066' }));
    const ticket = add(this.add.container(TICKET.x, TICKET.y));
    const orderText = add(txt(this, TICKET.x, TICKET.y - 66, 'ออร์เดอร์ 1', { size: 10, color: '#fff8e7', strokeWidth: 3 }));
    add(this.add.rectangle(TICKET.x, TICKET.y + 60, 76, 7, 0x1b1f3b));
    const bonusBar = add(this.add.rectangle(TICKET.x - 37, TICKET.y + 60, 74, 5, 0x7ee8b0).setOrigin(0, 0.5));
    add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, PLAYER_COLORS[p].main, 0.95));
    if (!this.players.includes(p)) c.setAlpha(0.3);
    const k: Kitchen = {
      p, pn, orderIdx: 0, order: this.orders[0], placed: [], drags: [], pizza, ticket, bell, bonusBar, orderText, fire, steam: [],
      t: 0, par: 0, lock: 0, streak: 0, done: 0, wrong: 0, skill: 0.45 + Math.random() * 0.45, plan: [], think: 0.8, checked: false,
    };
    this.kitchens[p] = k;
    this.newOrder(k, 0, false);
  }

  private newOrder(k: Kitchen, idx: number, anim = true): void {
    k.orderIdx = idx;
    k.order = this.orders[idx % this.orders.length];
    k.t = 0;
    k.par = 2.5 + k.order.total * 0.95;
    k.plan = [];
    k.checked = false;
    k.ticket.removeAll(true);
    k.ticket.add(this.add.image(0, 0, 'pizza-panic-ticket').setScale(S));
    let row = 0;
    for (const t of TOPS) {
      const n = k.order.need[t];
      if (!n) continue;
      const y = -26 + row * 18;
      k.ticket.add(this.add.image(-18, y, `pizza-panic-${t}`).setScale(S));
      k.ticket.add(txt(this, 14, y, `×${n}`, { size: 15, color: '#1b1f3b', strokeWidth: 0, shadow: false }));
      row++;
    }
    k.orderText.setText(`ออร์เดอร์ ${idx + 1}`);
    if (anim) {
      k.ticket.setScale(0.3).setAngle(-20);
      this.tweens.add({ targets: k.ticket, scale: 1, angle: 0, duration: 260, ease: 'Back.easeOut' });
    }
  }

  // ───────────────────────────── INPUT ─────────────────────────────

  private local(k: Kitchen, x: number, y: number): { x: number; y: number } {
    return this.panels.toLocal(k.p, x, y);
  }

  private onDown(t: TrackedTouch): void {
    if (this.state !== 'play' || !this.players.includes(t.player) || this.isCpu(t.player)) return;
    const k = this.kitchens[t.player];
    if (k.lock > 0) return;
    const l = this.local(k, t.x, t.y);
    if (Math.hypot(l.x - BELL.x, l.y - BELL.y) < 30) return this.ring(k);
    // pick a topping already on the pizza (to move or remove it)
    for (let i = k.placed.length - 1; i >= 0; i--) {
      const pl = k.placed[i];
      if (Math.hypot(PIZZA.x + pl.img.x - l.x, PIZZA.y + pl.img.y - l.y) < 13) {
        k.placed.splice(i, 1);
        k.pizza.remove(pl.img);
        k.pn.c.add(pl.img);
        pl.img.setPosition(l.x, l.y - 10).setScale(S * 1.3);
        k.drags.push({ id: t.pointerId, top: pl.top, img: pl.img, from: pl });
        Audio.sfx('click', 1.3);
        return;
      }
    }
    const bin = BIN_X.findIndex((bx) => Math.abs(l.x - bx) < 32 && Math.abs(l.y - BINS_Y) < 30);
    if (bin < 0) return;
    const top = TOPS[bin];
    const img = this.add.image(l.x, l.y - 10, `pizza-panic-${top}`).setScale(S * 1.3).setAngle(Math.random() * 360);
    k.pn.c.add(img);
    k.drags.push({ id: t.pointerId, top, img });
    Audio.sfx('pop', 1.2 + bin * 0.1);
  }

  private onUp(t: TrackedTouch, cancel: boolean): void {
    const k = this.kitchens[t.player];
    if (!k) return;
    const i = k.drags.findIndex((d) => d.id === t.pointerId);
    if (i < 0) return;
    const d = k.drags[i];
    k.drags.splice(i, 1);
    const l = this.local(k, t.x, t.y);
    const dropY = l.y - 10;
    if (!cancel && this.state === 'play' && Math.hypot(l.x - PIZZA.x, dropY - PIZZA.y) < PIZZA.drop) this.put(k, d.top, l.x - PIZZA.x, dropY - PIZZA.y, d.img);
    else this.drop(k, d.img);
  }

  private put(k: Kitchen, top: Top, x: number, y: number, img?: Phaser.GameObjects.Image): void {
    const lim = PIZZA.drop - 6;
    const dd = Math.hypot(x, y);
    if (dd > lim) { x *= lim / dd; y *= lim / dd; }
    if (img) k.pn.c.remove(img);
    const im = img ?? this.add.image(x, y, `pizza-panic-${top}`).setAngle(Math.random() * 360);
    im.setPosition(x, y).setScale(S * 1.5);
    k.pizza.add(im);
    this.tweens.add({ targets: im, scale: S, duration: 140, ease: 'Bounce.easeOut' });
    k.placed.push({ top, img: im });
    Audio.sfx('land', 1.3 + Math.random() * 0.2);
  }

  private drop(k: Kitchen, img: Phaser.GameObjects.Image): void {
    this.tweens.add({ targets: img, scale: 0, angle: img.angle + 120, alpha: 0, duration: 220, onComplete: () => img.destroy() });
    Audio.sfx('back', 1.4);
    void k;
  }

  // ───────────────────────────── SERVE ─────────────────────────────

  private ring(k: Kitchen): void {
    if (k.lock > 0 || this.state !== 'play') return;
    this.tweens.add({ targets: k.bell, angle: { from: -14, to: 14 }, duration: 60, yoyo: true, repeat: 2, onComplete: () => k.bell.setAngle(0) });
    Audio.sfx('select', 1.6);
    if (!k.placed.length) return;
    const have = { pepperoni: 0, mushroom: 0, olive: 0, pineapple: 0 } as Record<Top, number>;
    for (const pl of k.placed) have[pl.top]++;
    const ok = TOPS.every((t) => have[t] === k.order.need[t]);
    const col = toCss(PLAYER_COLORS[k.p].light);
    k.lock = 0.55;
    for (const d of k.drags) d.img.destroy();
    k.drags = [];
    if (ok) {
      const bonus = Math.max(0, Math.min(3, Math.ceil(((k.par - k.t) / k.par) * 3)));
      k.streak++;
      const streakB = k.streak >= 3 ? 1 : 0;
      const pts = 3 + bonus + streakB;
      this.addScore(k.p, pts);
      k.done++;
      Audio.sfx(bonus >= 2 ? 'power' : 'coin', 1 + k.p * 0.08);
      this.pop(k, PIZZA.x, PIZZA.y - 30, `เป๊ะ! +${pts}`, col, 18);
      if (bonus > 0) this.pop(k, PIZZA.x, PIZZA.y + 4, `ไว +${bonus}${streakB ? ' · ติดกัน +1' : ''}`, '#ffe066', 12);
      for (let n = 0; n < 6; n++) {
        const s = this.add.image(PIZZA.x + (Math.random() - 0.5) * 80, PIZZA.y + (Math.random() - 0.5) * 60, 'pizza-panic-steam').setScale(S * 0.6).setAlpha(0.7);
        k.pn.c.add(s);
        k.steam.push({ img: s, life: 0.6 + Math.random() * 0.5 });
      }
      if (bonus >= 3) Vfx.shake(this, 0.002, 80);
      this.slideAway(k, true);
    } else {
      k.streak = 0;
      k.wrong++;
      this.addScore(k.p, -2);
      Audio.sfx('wrong');
      this.pop(k, PIZZA.x, PIZZA.y - 30, 'ผิดออร์เดอร์! −2', '#ff7a85', 16);
      // highlight wrong rows
      this.tweens.add({ targets: k.ticket, x: TICKET.x + 5, duration: 50, yoyo: true, repeat: 3, onComplete: () => k.ticket.setX(TICKET.x) });
      this.slideAway(k, false);
    }
  }

  private slideAway(k: Kitchen, good: boolean): void {
    const old = k.pizza;
    const c = k.pn.c;
    this.tweens.add({
      targets: old, x: good ? k.pn.w / 2 + 80 : PIZZA.x, y: good ? PIZZA.y - 20 : k.pn.h / 2 + 60, angle: good ? 30 : -60, alpha: good ? 1 : 0,
      duration: 380, ease: 'Quad.easeIn', onComplete: () => old.destroy(),
    });
    const fresh = this.add.container(PIZZA.x, PIZZA.y);
    fresh.add(this.add.image(0, 0, 'pizza-panic-pizza').setScale(S));
    c.addAt(fresh, c.getIndex(old));
    fresh.setScale(0);
    this.tweens.add({ targets: fresh, scale: 1, delay: 260, duration: 240, ease: 'Back.easeOut' });
    k.pizza = fresh;
    k.placed = [];
    if (good) this.newOrder(k, k.orderIdx + 1);
    else { k.plan = []; k.checked = false; }
  }

  private pop(k: Kitchen, x: number, y: number, s: string, color: string, size = 14): void {
    const t = txt(this, x, y, s, { size, color });
    k.pn.c.add(t);
    t.setScale(0.5);
    this.tweens.add({ targets: t, scale: 1, duration: 150, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 24, alpha: 0, delay: 650, duration: 400, onComplete: () => t.destroy() });
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const k of this.kitchens) {
      if (!k) continue;
      k.ticket.setAngle(Math.sin(this.t * 1.7 + k.p) * 2.5);
      for (const d of k.drags) {
        const f = this.touch.touchesFor(k.p).find((x) => x.pointerId === d.id);
        if (f) { const l = this.local(k, f.x, f.y); d.img.setPosition(l.x, l.y - 10); }
      }
      for (const s of k.steam) {
        s.life -= dt;
        s.img.y -= dt * 30;
        s.img.setAlpha(Math.max(0, s.life)).setScale(s.img.scale + dt);
        if (s.life <= 0) s.img.destroy();
      }
      k.steam = k.steam.filter((s) => s.life > 0);
      if (Math.random() < dt * 1.5) {
        const s = this.add.image(k.fire.x + (Math.random() - 0.5) * 30, k.fire.y - 6, 'pizza-panic-steam').setScale(S * 0.4).setTint(0xb8b0a8).setAlpha(0.5);
        k.pn.c.addAt(s, 2);
        k.steam.push({ img: s, life: 0.9 });
      }
    }
  }

  tick(dt: number): void {
    for (const k of this.kitchens) {
      if (!k || !this.players.includes(k.p)) continue;
      k.t += dt;
      k.lock = Math.max(0, k.lock - dt);
      const f = Math.max(0, 1 - k.t / k.par);
      k.bonusBar.width = 74 * f;
      k.bonusBar.fillColor = f > 0.5 ? 0x7ee8b0 : f > 0.2 ? 0xffc93d : 0xff5a6e;
      if (this.isCpu(k.p)) this.bot(k, dt);
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(k: Kitchen, dt: number): void {
    if (k.lock > 0) return;
    const h = k.hand;
    if (h) {
      h.t += dt;
      const e = Math.min(1, h.t / h.dur);
      const arc = Math.sin(e * Math.PI) * 24;
      h.img.setPosition(h.x0 + (h.x1 - h.x0) * e, h.y0 + (h.y1 - h.y0) * e - arc);
      if (e >= 1) {
        k.hand = undefined;
        this.put(k, h.top, h.x1 - PIZZA.x, h.y1 - PIZZA.y, h.img);
      }
      return;
    }
    k.think -= dt;
    if (k.think > 0) return;
    const have = { pepperoni: 0, mushroom: 0, olive: 0, pineapple: 0 } as Record<Top, number>;
    for (const pl of k.placed) have[pl.top]++;
    if (!k.plan.length && !k.checked) {
      // plan the remaining toppings (with occasional slips)
      for (const t of TOPS) for (let n = have[t]; n < k.order.need[t]; n++) k.plan.push(t);
      for (let i = 0; i < k.plan.length; i++) {
        if (Math.random() < (1 - k.skill) * 0.16) k.plan[i] = TOPS[Math.floor(Math.random() * 4)];
      }
      if (Math.random() < (1 - k.skill) * 0.3) k.plan.push(TOPS[Math.floor(Math.random() * 4)]);
      k.plan.sort(() => Math.random() - 0.5);
      k.checked = true;
    }
    const next = k.plan.shift();
    if (next) {
      const bi = TOPS.indexOf(next);
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * (PIZZA.drop - 10);
      const img = this.add.image(BIN_X[bi], BINS_Y, `pizza-panic-${next}`).setScale(S * 1.3).setAngle(Math.random() * 360);
      k.pn.c.add(img);
      Audio.sfx('pop', 1.2 + bi * 0.1);
      k.hand = { top: next, img, t: 0, dur: 0.32 + (1 - k.skill) * 0.35 + Math.random() * 0.15, x0: BIN_X[bi], y0: BINS_Y, x1: PIZZA.x + Math.cos(a) * d, y1: PIZZA.y + Math.sin(a) * d };
      k.think = 0.06 + Math.random() * 0.12;
      return;
    }
    // done placing: careful CPUs double-check and fix mistakes
    const wrong = TOPS.some((t) => have[t] !== k.order.need[t]);
    if (wrong && Math.random() < 0.2 + k.skill * 0.6) {
      const extra = TOPS.find((t) => have[t] > k.order.need[t]);
      if (extra) {
        const i = k.placed.findIndex((pl) => pl.top === extra);
        const pl = k.placed.splice(i, 1)[0];
        k.pizza.remove(pl.img);
        k.pn.c.add(pl.img);
        pl.img.setPosition(PIZZA.x + pl.img.x, PIZZA.y + pl.img.y);
        this.drop(k, pl.img);
      }
      const missing = TOPS.find((t) => have[t] < k.order.need[t]);
      if (missing) k.plan.push(missing);
      k.think = 0.4 + Math.random() * 0.3;
      return;
    }
    this.ring(k);
    k.think = 0.5 + Math.random() * 0.4 + (1 - k.skill) * 0.3;
  }
}


import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const ID = 'hidden-objects';

/** Thai names of the findable items, index = frame in the item sheet. */
const NAMES = [
  'ยางลบ', 'เป็ดยาง', 'ถุงเท้า', 'มือถือ', 'แอปเปิล', 'กุญแจ', 'ไม้บรรทัด', 'ช้อน',
  'ดินสอ', 'กรรไกร', 'แว่นตา', 'กล้วย', 'นาฬิกาปลุก', 'ลูกบอล', 'หมวก', 'ตุ๊กตาหมี',
  'นมกล่อง', 'จรวดกระดาษ', 'สีเทียน', 'อมยิ้ม', 'โดนัท', 'รถของเล่น', 'ร่ม', 'ถ้วยรางวัล',
];
const ITEM = 16;
const START_ITEMS = 16;
const MAX_ITEMS = 21;
const HIT_R = 19;

interface Spot {
  x: number;
  y: number;
  kind: number;
  flip: boolean;
  imgs: Phaser.GameObjects.Image[];
}

interface Seat {
  p: PlayerIndex;
  lock: number;
  lockMark?: Phaser.GameObjects.Image;
  boardIcon?: Phaser.GameObjects.Image;
  boardName?: Phaser.GameObjects.Text;
  board?: Phaser.GameObjects.Container;
  // CPU
  cursor?: Phaser.GameObjects.Image;
  cx: number;
  cy: number;
  gx: number;
  gy: number;
  wanderT: number;
  findAt: number;
  wrongAt: number;
  skill: number;
  goingFor: number;
}

/** #34 — Everyone searches the same messy classroom for the item on the chalkboard. First tap wins it. */
export default class HiddenObjects extends BaseMinigame {
  private panels!: PanelKit;
  private spots: Spot[] = [];
  private slots: { x: number; y: number }[] = [];
  private seats: Seat[] = [];
  private target = -1;
  private roundT = 0;
  private between = 0;
  private found = 0;
  private hinted = false;
  private r: () => number = Math.random;
  private skies: Phaser.GameObjects.TileSprite[] = [];
  private clocks: Phaser.GameObjects.Image[] = [];
  private fish: Phaser.GameObjects.Image[] = [];
  private beams: Phaser.GameObjects.Image[] = [];
  private motes: { img: Phaser.GameObjects.Image; x: number; y: number; ph: number }[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.spots = [];
    this.seats = [];
    this.skies = [];
    this.clocks = [];
    this.fish = [];
    this.beams = [];
    this.motes = [];
    this.target = -1;
    this.roundT = 0;
    this.between = 0;
    this.found = 0;
    this.hinted = false;
    this.r = rng(3400 + Math.floor(Math.random() * 100000));
    this.panels = new PanelKit(this, { frame: false, inset: 3 });
    this.paintArt();
    const pn0 = this.panels.panel(0);
    this.slots = this.makeSlots(pn0.w, pn0.h, 40);
    for (const pn of this.panels.panels) this.buildPanel(pn);
    // initial items: distinct kinds in the first slots
    const kinds = this.shuffle([...NAMES.keys()]);
    for (let i = 0; i < START_ITEMS; i++) this.addSpot(this.slots[i], kinds[i]);
    this.panels.onDown((p, lx, ly) => this.tap(p, lx, ly));
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    makeSheet(this, `${ID}-items`, ITEM, ITEM, NAMES.length, (p, i) => {
      ITEM_PAINTERS[i](p);
      p.outline(-0.75);
    });
    makeTexture(this, `${ID}-glow`, 22, 22, (p) => {
      for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) {
        const d = Math.hypot(x + 0.5 - 11, y + 0.5 - 11) / 11;
        if (d < 1) p.px(x, y, 0xfff3a0, Math.round((1 - d) * (1 - d) * 200));
      }
    });
    makeTexture(this, `${ID}-cross`, 11, 11, (p) => {
      p.stroke(1, 1, 9, 9, 2, 0xff4d5e);
      p.stroke(9, 1, 1, 9, 2, 0xff4d5e);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-hand`, 12, 14, (p) => {
      // pointing hand cursor
      const sk = 0xffffff, sh = 0xc9ccd6;
      p.rect(4, 0, 3, 8, sk);
      p.rect(2, 6, 9, 6, sk);
      p.rect(1, 8, 2, 3, sk);
      p.rect(3, 12, 7, 2, sk);
      p.vline(7, 7, 4, sh); p.vline(9, 7, 4, sh);
      p.hline(4, 13, 6, sh);
      p.outline(-0.9);
    });
    makeTexture(this, `${ID}-sky`, 40, 26, (p) => {
      p.gradient(0, 0, 40, 26, [0x6ec6ff, 0x9fdcff, 0xd2f0ff]);
      p.ball(10, 9, 6, 3, 0xffffff, false); p.ball(15, 8, 4, 3, 0xffffff, false); p.hline(5, 11, 14, 0xdbe9f7);
      p.ball(31, 17, 5, 2.5, 0xffffff, false); p.ball(35, 16, 3, 2, 0xffffff, false);
    });
    makeSheet(this, `${ID}-clock`, 17, 17, 12, (p, i) => {
      p.circle(8.5, 8.5, 8, 0xd9604a);
      p.circle(8.5, 8.5, 6.5, 0xfff8e7);
      for (let k = 0; k < 12; k += 3) {
        const a = (k / 12) * Math.PI * 2;
        p.px(Math.round(8 + Math.sin(a) * 5.4), Math.round(8 - Math.cos(a) * 5.4), 0x2b3263);
      }
      const a = (i / 12) * Math.PI * 2;
      p.line(8, 8, Math.round(8 + Math.sin(a) * 5), Math.round(8 - Math.cos(a) * 5), 0x2b3263);
      p.line(8, 8, 8 + (i < 6 ? 1 : -1), 5, 0x1b1f3b);
      p.px(8, 8, 0xff5a6e);
      p.outline(-0.7);
    });
    makeSheet(this, `${ID}-fish`, 8, 6, 2, (p, i) => {
      p.ellipse(4, 3, 2.6, 1.8, 0xff9f43);
      p.tri(0, 1 + i, 0, 5 - i, 2, 3, 0xff7a3d);
      p.px(5, 2, 0x1b1f3b);
    });
    makeTexture(this, `${ID}-mote`, 2, 2, (p) => p.rect(0, 0, 2, 2, 0xfff6c8));
    makeTexture(this, `${ID}-curtain`, 9, 30, (p) => {
      const c = 0xff7a85;
      p.rect(0, 0, 9, 3, shift(c, -0.3));
      for (let y = 3; y < 30; y++) {
        const w = 7 + Math.round(Math.sin(y * 0.5) * 1) + (y > 22 ? 1 : 0);
        p.hline(0, y, w, c);
        p.px(2, y, shift(c, -0.25)); p.px(5, y, shift(c, 0.25));
      }
      p.outline(-0.6);
    });
  }

  private roomKey(w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    return makeTexture(this, `${ID}-room-${aw}x${ah}`, aw, ah, (p) => paintRoom(p, aw, ah));
  }

  private beamKey(w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    return makeTexture(this, `${ID}-beam-${aw}x${ah}`, aw, ah, (p) => {
      // soft sunbeam from the window down onto the floor
      for (let y = 30; y < ah; y++) {
        const t = (y - 30) / (ah - 30);
        const x0 = 8 + t * 34, x1 = 36 + t * 70;
        for (let x = Math.floor(x0); x < x1; x++) {
          const edge = Math.min(x - x0, x1 - x) / 8;
          p.px(x, y, 0xfff1b8, Math.round(Math.min(1, edge) * (1 - t) * 46));
        }
      }
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

  private boardKey(): string {
    return makeTexture(this, `${ID}-board`, 82, 25, (p) => {
      p.rect(0, 0, 82, 25, 0x8a4f2c);
      p.hline(0, 0, 82, 0xb06a3c);
      p.rect(2, 2, 78, 20, 0x2f5d47);
      const r = rng(11);
      for (let i = 0; i < 90; i++) p.px(2 + Math.floor(r() * 78), 2 + Math.floor(r() * 20), r() > 0.5 ? 0x386b53 : 0x2a5540);
      for (let i = 0; i < 6; i++) p.hline(4 + Math.floor(r() * 60), 3 + Math.floor(r() * 18), 6 + Math.floor(r() * 10), 0x3d7058);
      p.rect(0, 22, 82, 3, 0x7a4426);
      p.hline(0, 22, 82, 0xa0603a);
      p.rect(60, 21, 5, 2, 0xfff8e7); p.rect(68, 21, 4, 2, 0xffb3bd);
      p.rect(8, 20, 7, 2, 0x6b6f86);
    });
  }

  // ───────────────────────────── build ─────────────────────────────

  private buildPanel(pn: Panel): void {
    const { c, w, h, p } = pn;
    const left = -w / 2, top = -h / 2;
    // sky behind the window hole
    const sky = this.add.tileSprite(left + 7 * S, top + 6 * S, 30, 25, `${ID}-sky`).setOrigin(0).setScale(S);
    c.add(sky);
    this.skies.push(sky);
    c.add(this.add.image(0, 0, this.roomKey(w, h)).setScale(S));
    const beam = this.add.image(0, 0, this.beamKey(w, h)).setScale(S).setAlpha(0.9);
    c.add(beam);
    this.beams.push(beam);
    // curtains sway
    for (const [x, fl] of [[left + 5 * S, false], [left + 32 * S, true]] as const) {
      const cu = this.add.image(x, top + 4 * S, `${ID}-curtain`).setOrigin(fl ? 0 : 0, 0).setScale(S).setFlipX(fl);
      c.add(cu);
      this.tweens.add({ targets: cu, scaleX: S * 0.9, duration: 1700 + (fl ? 300 : 0), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    const clock = this.add.image(w / 2 - 22 * S, top + 10 * S, `${ID}-clock`, 0).setScale(S);
    c.add(clock);
    this.clocks.push(clock);
    const fish = this.add.image(w / 2 - 16 * S, top + 34 * S, `${ID}-fish`, 0).setScale(S);
    c.add(fish);
    this.fish.push(fish);
    // dust motes in the sunbeam
    const mr = rng(90 + p);
    for (let i = 0; i < 7; i++) {
      const img = this.add.image(0, 0, `${ID}-mote`).setScale(S * 0.5).setAlpha(0.7);
      c.add(img);
      this.motes.push({ img, x: left + (30 + mr() * 50) * S, y: top + (40 + mr() * 50) * S, ph: mr() * 10 });
    }
    // chalkboard with the target
    const board = this.add.container(0, top + 15 * S);
    board.add(this.add.image(0, 0, this.boardKey()).setScale(S));
    const label = txt(this, -56, -3, 'หา', { size: 13, color: '#e9f5e6', stroke: '#1f3a2c', strokeWidth: 3, shadow: false });
    const icon = this.add.image(-24, -3, `${ID}-items`, 0).setScale(S).setVisible(false);
    const name = txt(this, 4, -3, '…', { size: 15, color: '#fffbe0', stroke: '#1f3a2c', strokeWidth: 3, shadow: false, origin: [0, 0.5] });
    board.add([label, icon, name]);
    c.add(board);
    c.add(this.add.image(0, 0, this.frameKey(p, w, h)).setScale(S));
    const lockMark = this.add.image(0, 0, `${ID}-cross`).setScale(S * 1.4).setVisible(false).setDepth(5);
    c.add(lockMark);
    const seat: Seat = {
      p, lock: 0, lockMark, boardIcon: icon, boardName: name, board,
      cx: 0, cy: 20, gx: 0, gy: 20, wanderT: 0, findAt: 99, wrongAt: -1, skill: 0, goingFor: -1,
    };
    if (this.isCpu(p) && this.players.includes(p)) {
      seat.skill = 0.85 + Math.random() * 0.3;
      seat.cursor = this.add.image(0, 20, `${ID}-hand`).setScale(S).setOrigin(0.35, 0.05).setAlpha(0.85);
      c.add(seat.cursor);
    }
    this.seats[p] = seat;
  }

  /** Poisson-ish slots on the floor/desks, identical for every panel. Avoids HUD corners. */
  private makeSlots(w: number, h: number, n: number): { x: number; y: number }[] {
    const r = rng(77);
    const out: { x: number; y: number }[] = [];
    const x0 = -w / 2 + 20, x1 = w / 2 - 20, y0 = -h / 2 + 76, y1 = h / 2 - 18;
    let tries = 0;
    while (out.length < n && tries++ < 6000) {
      const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0);
      if (Math.abs(x) > w / 2 - 92 && y > h / 2 - 40) continue; // HUD / timer corners
      const min = tries < 3000 ? 36 : 30;
      if (out.some((o) => Math.hypot(o.x - x, (o.y - y) * 1.15) < min)) continue;
      out.push({ x: Math.round(x), y: Math.round(y) });
    }
    return out;
  }

  private shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  private addSpot(slot: { x: number; y: number }, kind: number): Spot {
    const s: Spot = { x: slot.x, y: slot.y, kind, flip: this.r() < 0.5, imgs: [] };
    for (const pn of this.panels.panels) {
      const img = this.add.image(s.x, s.y, `${ID}-items`, kind).setScale(S).setFlipX(s.flip);
      // items sit on the floor, under the chalkboard / frame / cursor layers
      const board = this.seats[pn.p]?.board;
      pn.c.addAt(img, board ? pn.c.getIndex(board) : pn.c.length);
      s.imgs[pn.p] = img;
    }
    this.spots.push(s);
    return s;
  }

  // ───────────────────────────── rounds ─────────────────────────────

  onStart(): void {
    this.nextTarget();
  }

  private nextTarget(): void {
    const prev = this.spots[this.target]?.kind;
    const pool = this.spots.map((_, i) => i).filter((i) => this.spots[i].kind !== prev);
    this.target = pool[Math.floor(this.r() * pool.length)];
    this.roundT = 0;
    this.hinted = false;
    const kind = this.spots[this.target].kind;
    for (const s of this.seats) {
      if (!s) continue;
      s.boardIcon?.setFrame(kind).setVisible(true);
      if (s.boardName) this.fitName(s.boardName, NAMES[kind]);
      if (s.board) this.tweens.add({ targets: s.board, scale: { from: 1.15, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      // CPU plan for this round
      if (s.cursor) {
        const difficulty = 1 + this.spots.length * 0.02;
        s.findAt = (0.9 + Math.random() * 1.8 + -Math.log(1 - Math.random() * 0.95) * 1.4) * difficulty / s.skill;
        s.wrongAt = Math.random() < 0.16 ? s.findAt * (0.3 + Math.random() * 0.4) : -1;
        s.goingFor = -1;
        s.wanderT = 0;
      }
    }
    Audio.sfx('whoosh');
  }

  private fitName(t: Phaser.GameObjects.Text, s: string): Phaser.GameObjects.Text {
    t.setText(s).setScale(1);
    const max = 80;
    if (t.width > max) t.setScale(max / t.width);
    return t;
  }

  private tap(p: PlayerIndex, lx: number, ly: number): void {
    if (this.isCpu(p)) return;
    this.tryPick(p, lx, ly);
  }

  private tryPick(p: PlayerIndex, lx: number, ly: number): void {
    const seat = this.seats[p];
    if (!seat || seat.lock > 0 || this.between > 0 || this.target < 0) return;
    let best = -1, bd = HIT_R;
    this.spots.forEach((s, i) => {
      const d = Math.hypot(s.x - lx, s.y - ly);
      if (d < bd || (i === this.target && d < HIT_R + 3 && d < bd + 6)) { bd = d; best = i; }
    });
    if (best === this.target) return this.win(p);
    // wrong item or empty floor → short lockout
    seat.lock = best >= 0 ? 1.1 : 0.7;
    Audio.sfx('wrong', 1 + p * 0.05);
    const mark = seat.lockMark!;
    mark.setPosition(lx, ly).setVisible(true).setAlpha(1);
    Vfx.squash(this, mark, 1.6, 1.6, 180, S * 1.4);
    if (best >= 0) {
      const img = this.spots[best].imgs[p];
      this.tweens.add({ targets: img, x: img.x + 3, yoyo: true, repeat: 3, duration: 50 });
    }
    const w = this.panels.toWorld(p, lx, ly - 24);
    Vfx.popText(this, w.x, w.y, best >= 0 ? 'ไม่ใช่!' : 'พลาด!', '#ff8a95', 14, this.angleFor(p));
  }

  private win(p: PlayerIndex): void {
    const s = this.spots[this.target];
    this.addScore(p, 1);
    this.found++;
    Audio.sfx('right', 1 + p * 0.1);
    Audio.sfx('coin', 1 + p * 0.1);
    const col = PLAYER_COLORS[p];
    for (const pn of this.panels.panels) {
      const img = s.imgs[pn.p];
      this.tweens.killTweensOf(img);
      img.clearTint().setAlpha(1);
      const wpt = this.panels.toWorld(pn.p, s.x, s.y);
      if (pn.p === p) {
        // fly up onto the chalkboard
        img.setDepth(10);
        pn.c.bringToTop(img);
        this.tweens.add({ targets: img, x: -24, y: -pn.h / 2 + 12 * S, scale: S * 1.6, duration: 380, ease: 'Cubic.easeOut' });
        this.tweens.add({ targets: img, alpha: 0, delay: 420, duration: 200, onComplete: () => img.destroy() });
        Vfx.sparkle(this, wpt.x, wpt.y, [col.light, 0xffffff, 0xffe066]);
        Vfx.hit(this, wpt.x, wpt.y, [col.main, col.light, 0xffffff]);
        Vfx.popText(this, this.panels.toWorld(p, s.x, s.y - 26).x, this.panels.toWorld(p, s.x, s.y - 26).y, 'เจอแล้ว! +1', toCss(col.light), 17, this.angleFor(p));
      } else {
        this.tweens.add({ targets: img, scale: 0, angle: 90, duration: 260, ease: 'Back.easeIn', onComplete: () => img.destroy() });
        burst(this, wpt.x, wpt.y, { tex: 'puff', count: 6, tint: [0xffffff, col.light], speed: [20, 60], life: 380, scale: [S * 0.8, 0] });
        const lbl = this.panels.toWorld(pn.p, s.x, s.y - 22);
        Vfx.popText(this, lbl.x, lbl.y, `P${p + 1} ได้!`, toCss(col.light), 14, this.angleFor(pn.p));
        const seat = this.seats[pn.p];
        if (seat?.boardName && this.players.includes(pn.p)) this.fitName(seat.boardName, `P${p + 1} เจอก่อน!`).setColor(toCss(col.light));
      }
    }
    this.between = 0.9;
    const reshuffle = this.found % 5 === 0;
    // Replace the found item with a new kind (keeps the room equally messy).
    const idx = this.target;
    this.target = -1;
    const used = new Set(this.spots.map((x) => x.kind));
    const fresh = this.shuffle([...NAMES.keys()].filter((k) => !used.has(k)));
    const spot = this.spots[idx];
    this.spots.splice(idx, 1);
    const ns = this.addSpot(spot, fresh[0] ?? spot.kind);
    for (const img of ns.imgs) {
      img.setScale(0);
      this.tweens.add({ targets: img, scale: S, delay: 450, duration: 300, ease: 'Back.easeOut' });
    }
    if (reshuffle) {
      this.between = 1.6;
      // the room gets messier: two more items, everything moves
      for (let k = 0; k < 2 && this.spots.length < MAX_ITEMS; k++) {
        const kind = fresh[k + 1];
        if (kind === undefined) break;
        const extra = this.addSpot(this.slots[this.spots.length], kind);
        for (const img of extra.imgs) img.setScale(0);
      }
      const order = this.shuffle(this.slots.slice(0, Math.max(this.spots.length + 4, 24)));
      this.time.delayedCall(500, () => {
        Audio.sfx('whoosh', 0.8);
        this.spots.forEach((sp, i) => {
          sp.x = order[i].x;
          sp.y = order[i].y;
          sp.flip = this.r() < 0.5;
          for (const img of sp.imgs) {
            if (!img.active) continue;
            img.setFlipX(sp.flip);
            this.tweens.add({ targets: img, x: sp.x, y: sp.y, scale: S, duration: 520, ease: 'Back.easeInOut', delay: i * 12 });
          }
        });
      });
      for (const pn of this.panels.panels) {
        if (!this.players.includes(pn.p)) continue;
        const t = this.panels.toWorld(pn.p, 0, 10);
        Vfx.popText(this, t.x, t.y, 'ห้องรกขึ้น!', '#ffe066', 18, this.angleFor(pn.p));
      }
    }
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    const t = this.time.now / 1000;
    for (const s of this.skies) s.tilePositionX += dt * 3;
    const frame = Math.floor(t * 2) % 12;
    for (const c of this.clocks) c.setFrame(frame);
    this.fish.forEach((f, i) => {
      f.setFrame(Math.floor(t * 4 + i) % 2);
      const ph = t * 0.8 + i;
      f.x = this.panels.panel(i as PlayerIndex).w / 2 - 16 * S + Math.sin(ph) * 6;
      f.setFlipX(Math.cos(ph) < 0);
    });
    for (const b of this.beams) b.setAlpha(0.75 + Math.sin(t * 0.9) * 0.2);
    for (const m of this.motes) {
      m.img.setPosition(m.x + Math.sin(t * 0.5 + m.ph) * 10, m.y + Math.cos(t * 0.37 + m.ph * 2) * 8);
      m.img.setAlpha(0.35 + 0.35 * Math.sin(t * 1.3 + m.ph));
    }
    for (const s of this.seats) {
      if (!s) continue;
      if (s.lockMark?.visible && s.lock <= 0) s.lockMark.setVisible(false);
      if (s.cursor) {
        s.cx += (s.gx - s.cx) * Math.min(1, dt * 7);
        s.cy += (s.gy - s.cy) * Math.min(1, dt * 7);
        s.cursor.setPosition(s.cx, s.cy);
      }
    }
  }

  tick(dt: number): void {
    for (const s of this.seats) if (s) s.lock = Math.max(0, s.lock - dt);
    if (this.between > 0) {
      this.between -= dt;
      if (this.between <= 0) {
        for (const s of this.seats) s?.boardName?.setColor('#fffbe0');
        this.nextTarget();
      }
      return;
    }
    if (this.target < 0) return;
    this.roundT += dt;
    const tgt = this.spots[this.target];
    if (this.roundT > 9 && !this.hinted) {
      // nobody found it yet: make it glow everywhere
      this.hinted = true;
      for (const s of this.seats) if (s?.cursor) s.findAt = Math.min(s.findAt, this.roundT + 0.6 + Math.random() * 1.6);
      for (const pn of this.panels.panels) {
        const img = tgt.imgs[pn.p];
        const glow = this.add.image(tgt.x, tgt.y, `${ID}-glow`).setScale(S * 1.4).setAlpha(0);
        pn.c.addAt(glow, pn.c.getIndex(img));
        this.tweens.add({ targets: glow, alpha: 1, yoyo: true, repeat: 6, duration: 300, onComplete: () => glow.destroy() });
        this.tweens.add({ targets: img, scale: S * 1.25, yoyo: true, repeat: 6, duration: 300 });
      }
    }
    for (const s of this.seats) if (s?.cursor && this.players.includes(s.p)) this.bot(s, dt);
  }

  private bot(s: Seat, dt: number): void {
    if (s.lock > 0) return;
    if (s.goingFor >= 0) {
      const sp = this.spots[s.goingFor];
      if (!sp) { s.goingFor = -1; return; }
      s.gx = sp.x + 4; s.gy = sp.y + 2;
      if (Math.hypot(s.cx - s.gx, s.cy - s.gy) < 3) {
        if (s.cursor) Vfx.squash(this, s.cursor, 0.8, 0.8, 120);
        if (s.goingFor !== this.target) s.wrongAt = -1;
        s.goingFor = -1;
        this.tryPick(s.p, sp.x, sp.y);
      }
      return;
    }
    if (this.roundT >= s.findAt) {
      s.goingFor = this.target;
      return;
    }
    if (s.wrongAt > 0 && this.roundT >= s.wrongAt) {
      const others = this.spots.map((_, i) => i).filter((i) => i !== this.target);
      s.goingFor = others[Math.floor(Math.random() * others.length)];
      return;
    }
    s.wanderT -= dt;
    if (s.wanderT <= 0) {
      s.wanderT = 0.35 + Math.random() * 0.5;
      const sp = this.spots[Math.floor(Math.random() * this.spots.length)];
      s.gx = sp.x + 10 + Math.random() * 10; s.gy = sp.y + 8;
    }
  }
}

// ───────────────────────────── item art ─────────────────────────────

function clearRect(p: Painter, x: number, y: number, w: number, h: number): void {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p.clear(x + i, y + j);
}

const ITEM_PAINTERS: ((p: Painter) => void)[] = [
  // 0 eraser
  (p) => { p.box(2, 6, 12, 6, 0xff8fb1); p.box(9, 6, 5, 6, 0x5aa0e8); p.hline(3, 7, 5, 0xffc2d4); },
  // 1 rubber duck
  (p) => { p.ball(7, 10, 5.5, 4, 0xffd84d); p.ball(10, 6, 3.2, 3.2, 0xffd84d); p.rect(13, 6, 2, 2, 0xff8a3d); p.px(10, 5, 0x1b1f3b); p.hline(4, 9, 4, 0xffe98a); },
  // 2 sock
  (p) => {
    p.rect(5, 1, 6, 9, 0xf4f4f4); p.rect(5, 8, 9, 5, 0xf4f4f4); p.rect(6, 13, 7, 1, 0xf4f4f4);
    p.hline(5, 2, 6, 0xff5a6e); p.hline(5, 4, 6, 0xff5a6e); p.hline(5, 6, 6, 0x3d9bff);
    p.rect(12, 9, 2, 4, 0xff5a6e); p.vline(10, 2, 7, 0xc9ccd6);
  },
  // 3 phone
  (p) => { p.rect(4, 1, 8, 14, 0x2b3263); p.rect(5, 2, 6, 10, 0x6ec6ff); p.hline(5, 3, 3, 0xd2f0ff); p.px(6, 5, 0xffffff); p.rect(7, 13, 2, 1, 0x8f98a8); },
  // 4 apple
  (p) => { p.ball(8, 9, 5.5, 5, 0xe8394a); p.vline(8, 2, 3, 0x7a4426); p.ellipse(10.5, 3, 2.2, 1.2, 0x3ed17a); },
  // 5 key
  (p) => { p.ring(5, 7, 3.6, 0xffc93d, 2); p.rect(8, 6, 7, 2, 0xffc93d); p.rect(12, 8, 1, 2, 0xffc93d); p.rect(14, 8, 1, 3, 0xffc93d); p.px(3, 5, 0xffe9a8); },
  // 6 ruler
  (p) => { p.box(0, 5, 16, 6, 0xffe066); for (let x = 1; x < 16; x += 2) p.vline(x, 5, x % 4 === 1 ? 3 : 2, 0x8a6a1c); },
  // 7 spoon
  (p) => { p.ball(4, 8, 3.4, 2.6, 0xd8dbe4); p.stroke(7, 8, 15, 6, 2, 0xb9bdca); p.px(3, 7, 0xffffff); },
  // 8 pencil
  (p) => { p.rect(3, 6, 9, 4, 0xffc93d); p.hline(3, 6, 9, 0xffe28a); p.rect(1, 6, 2, 4, 0xff8fb1); p.vline(3, 6, 4, 0xc9ccd6); p.tri(12, 6, 12, 9.9, 15, 8, 0xf0c9a0); p.px(14, 7, 0x2b2b3a); p.px(14, 8, 0x2b2b3a); },
  // 9 scissors
  (p) => { p.ring(4, 11, 2.6, 0xff5a6e, 2); p.ring(10, 12, 2.6, 0xff5a6e, 2); p.stroke(5, 9, 12, 2, 1, 0xd8dbe4); p.stroke(8, 10, 5, 2, 1, 0xb9bdca); p.px(7, 7, 0x2b2b3a); },
  // 10 glasses
  (p) => { p.ring(4.5, 8, 3.5, 0x2b2b3a, 1); p.ring(11.5, 8, 3.5, 0x2b2b3a, 1); p.circle(4.5, 8, 2.6, 0xbfeaff); p.circle(11.5, 8, 2.6, 0xbfeaff); p.hline(7, 7, 2, 0x2b2b3a); p.px(3, 7, 0xffffff); p.px(10, 7, 0xffffff); },
  // 11 banana
  (p) => { for (let i = 0; i < 12; i++) { const a = Math.PI * (0.15 + i / 14); p.rect(Math.round(8 - Math.cos(a) * 6), Math.round(4 + Math.sin(a) * 7), 2, 2, i < 3 || i > 9 ? 0xe0b22a : 0xffe066); } p.px(2, 6, 0x6b4a2a); p.px(14, 6, 0x6b4a2a); },
  // 12 alarm clock
  (p) => { p.circle(4, 3, 2, 0xffc93d); p.circle(12, 3, 2, 0xffc93d); p.ball(8, 9, 5.5, 5.5, 0x3d9bff); p.circle(8, 9, 3.6, 0xfff8e7); p.vline(8, 6, 3, 0x2b2b3a); p.hline(8, 9, 2, 0x2b2b3a); p.px(4, 14, 0x2b3263); p.px(12, 14, 0x2b3263); },
  // 13 ball
  (p) => { p.ball(8, 8, 6, 6, 0xf4f4f4); p.rect(6, 6, 4, 4, 0xff5a6e); p.rect(2, 7, 2, 2, 0x3d9bff); p.rect(12, 7, 2, 2, 0x3d9bff); p.rect(7, 2, 2, 2, 0xffc93d); p.rect(7, 12, 2, 2, 0xffc93d); },
  // 14 cap
  (p) => { p.ball(7, 8, 5.5, 4.5, 0x3d9bff); clearRect(p, 0, 9, 16, 7); p.hline(2, 8, 11, 0x1d5bb3); p.rect(9, 9, 6, 2, 0x1d5bb3); p.px(7, 4, 0xffffff); p.rect(4, 6, 2, 2, 0xa8d3ff); },
  // 15 teddy
  (p) => { p.circle(4, 3, 2, 0xb97a3e); p.circle(11, 3, 2, 0xb97a3e); p.ball(7.5, 6, 4.5, 4, 0xc98a4b); p.ball(7.5, 12, 4.5, 3.5, 0xc98a4b); p.px(6, 5, 0x1b1f3b); p.px(9, 5, 0x1b1f3b); p.rect(7, 7, 2, 1, 0x5a3426); p.ellipse(7.5, 12, 2, 1.6, 0xe8b884); },
  // 16 milk carton
  (p) => { p.rect(4, 5, 8, 10, 0xf4f4f4); p.tri(4, 5, 12, 5, 8, 1, 0xdfe3ec); p.rect(7, 0, 2, 2, 0xdfe3ec); p.rect(4, 8, 8, 4, 0x3d9bff); p.px(6, 9, 0xffffff); p.px(9, 10, 0xffffff); p.vline(11, 5, 10, 0xc9ccd6); },
  // 17 paper plane
  (p) => { p.tri(1, 9, 15, 3, 7, 10, 0xffffff); p.tri(7, 10, 15, 3, 9, 14, 0xdbe2ee); p.line(7, 10, 14, 4, 0xb9c2d6); },
  // 18 crayon
  (p) => { p.rect(1, 6, 11, 4, 0x3ed17a); p.rect(4, 6, 5, 4, 0xa6f0c4); p.hline(4, 8, 5, 0x1f8a4a); p.tri(12, 6, 12, 9.9, 15, 8, 0x3ed17a); p.hline(1, 6, 11, 0x7ee8b0); },
  // 19 lollipop
  (p) => { p.vline(8, 9, 7, 0xf4f4f4); p.circle(8, 6, 5, 0xff7ab8); p.ring(8, 6, 3.2, 0xfff0f6, 1); p.px(8, 6, 0xffffff); p.ring(8, 6, 5, 0xe04a8a, 1); },
  // 20 donut
  (p) => { p.ball(8, 9, 6.5, 5, 0xd49a58); p.ellipse(8, 8, 5.5, 3.8, 0xff8fc4); p.ellipse(8, 8.5, 1.8, 1.2, 0); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (((x + 0.5 - 8) / 1.8) ** 2 + ((y + 0.5 - 8.5) / 1.2) ** 2 <= 1) p.clear(x, y); p.px(5, 7, 0xffffff); p.px(10, 6, 0x6ec6ff); p.px(11, 9, 0xffe066); p.px(6, 10, 0x7ee8b0); },
  // 21 toy car
  (p) => { p.box(1, 7, 14, 5, 0xff5a3d); p.rect(4, 4, 7, 3, 0xff5a3d); p.rect(5, 5, 2, 2, 0xbfeaff); p.rect(8, 5, 2, 2, 0xbfeaff); p.circle(4, 12, 2, 0x2b2b3a); p.circle(12, 12, 2, 0x2b2b3a); p.px(4, 12, 0xc9ccd6); p.px(12, 12, 0xc9ccd6); },
  // 22 umbrella
  (p) => { p.ball(8, 7, 7, 5, 0x8455d6); clearRect(p, 0, 8, 16, 8); p.hline(1, 7, 15, 0x6a3fb3); p.px(4, 5, 0xb8a6ff); p.vline(8, 7, 7, 0x6b4a2a); p.px(7, 14, 0x6b4a2a); p.px(6, 13, 0x6b4a2a); },
  // 23 trophy
  (p) => { p.ball(8, 5, 4.5, 4, 0xffc93d); p.rect(4, 1, 9, 3, 0xffc93d); p.ring(3, 5, 2, 0xe0a82a, 1); p.ring(13, 5, 2, 0xe0a82a, 1); p.rect(7, 9, 2, 3, 0xe0a82a); p.box(4, 12, 8, 3, 0x8a4f2c); p.px(6, 3, 0xfff3c0); },
];

/** The messy classroom, painted at art resolution (aw × ah). Window area left transparent for the sky. */
function paintRoom(p: Painter, aw: number, ah: number): void {
  const r = rng(5);
  const wallH = 40;
  // wall + subtle wallpaper stripes
  p.rect(0, 0, aw, wallH, 0xf0dcae);
  for (let x = 0; x < aw; x += 6) p.vline(x, 0, wallH - 8, 0xe9d2a0);
  p.rect(0, wallH - 8, aw, 8, 0xb07448);
  p.hline(0, wallH - 8, aw, 0xd09060);
  p.hline(0, wallH - 1, aw, 0x7a4a2c);
  for (let x = 4; x < aw; x += 14) p.vline(x, wallH - 7, 6, 0x9a6038);
  // window (transparent hole) with frame
  const wx = 6, wy = 5, ww = 31, wh = 26;
  p.rect(wx - 2, wy - 2, ww + 4, wh + 4, 0xf4f4f4);
  for (let y = wy; y < wy + wh; y++) for (let x = wx; x < wx + ww; x++) p.clear(x, y);
  p.rect(wx + 15, wy, 1, wh, 0xf4f4f4);
  p.rect(wx, wy + 12, ww, 1, 0xf4f4f4);
  p.rect(wx - 3, wy + wh + 1, ww + 6, 3, 0xdfe3ec);
  p.hline(wx - 3, wy + wh + 3, ww + 6, 0xa9aec0);
  // potted plant on the sill
  p.box(wx + 22, wy + wh - 4, 6, 5, 0xd9604a);
  p.ball(wx + 25, wy + wh - 8, 4, 4, 0x4a9a4e, false); p.ball(wx + 23, wy + wh - 10, 2.5, 2.5, 0x58b05a, false);
  // poster: ABC
  p.box(aw - 46, 20, 20, 13, 0xfff8e7);
  p.rect(aw - 44, 23, 4, 4, 0xff5a6e); p.rect(aw - 39, 23, 4, 4, 0x3d9bff); p.rect(aw - 34, 23, 4, 4, 0x3ed17a);
  p.hline(aw - 44, 29, 14, 0xc9ccd6);
  // shelf with fish bowl
  p.rect(aw - 24, 37, 22, 2, 0x8a4f2c);
  p.circle(aw - 16, 33, 5, 0xbfeaff); p.hline(aw - 21, 30, 11, 0xdff4ff); p.circle(aw - 16, 35, 3.5, 0x8fd6ff);
  p.rect(aw - 9, 30, 3, 7, 0x3d9bff); p.rect(aw - 6, 31, 3, 6, 0xffc93d);
  // floor planks
  for (let y = wallH; y < ah; y += 6) {
    const row = (y - wallH) / 6;
    const off = (row * 17) % 30;
    for (let x = 0; x < aw; x++) {
      const k = Math.floor((x + off) / 30);
      p.vline(x, y, 6, (k + row) % 2 ? 0xc8925a : 0xbd8550);
    }
    p.hline(0, y, aw, 0xa86e40);
    for (let x = -off; x < aw; x += 30) p.vline(x, y, 6, 0x9a6238);
  }
  // shading near wall
  for (let x = 0; x < aw; x++) { p.px(x, wallH, 0x7a4a2c); if (x % 2) p.px(x, wallH + 1, 0x9a6238); }
  // rug
  const rx = aw / 2, ry = ah * 0.68;
  p.ellipse(rx, ry, 42, 16, 0xc55a6a);
  p.ellipse(rx, ry, 38, 13, 0xe0788a);
  p.ellipse(rx, ry, 30, 9, 0xc55a6a);
  p.ellipse(rx, ry, 26, 7, 0xf0a0ae);
  for (let a = 0; a < Math.PI * 2; a += 0.35) p.px(Math.round(rx + Math.cos(a) * 34), Math.round(ry + Math.sin(a) * 11), 0xffe066);
  // desks (3/4 view)
  const desk = (x: number, y: number) => {
    p.rect(x + 1, y + 8, 2, 9, 0x6b6f86); p.rect(x + 23, y + 8, 2, 9, 0x6b6f86);
    p.box(x, y, 26, 9, 0xe0b47a);
    p.rect(x, y + 8, 26, 2, 0xa8784a);
    p.rect(x + 3, y + 10, 20, 3, 0x8a5a36);
  };
  const chair = (x: number, y: number) => {
    p.box(x, y, 12, 4, 0x3d9bff);
    p.rect(x + 1, y + 4, 10, 2, 0x1d5bb3);
    p.vline(x + 1, y + 6, 5, 0x6b6f86); p.vline(x + 10, y + 6, 5, 0x6b6f86);
    p.box(x, y - 8, 12, 5, 0x3d9bff);
  };
  chair(14, 64); desk(8, 48);
  chair(aw - 30, 64); desk(aw - 36, 48);
  chair(aw / 2 - 6, 47); desk(aw / 2 - 13, 52);
  // scattered papers, crumpled balls, books (clutter — not findable)
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(r() * (aw - 12)), y = wallH + 4 + Math.floor(r() * (ah - wallH - 10));
    const kind = r();
    if (kind < 0.45) {
      p.rect(x, y, 7, 5, 0xfdfdf6); p.hline(x + 1, y + 1, 5, 0xb9c2d6); p.hline(x + 1, y + 3, 4, 0xb9c2d6); p.hline(x, y + 5, 7, 0xc9c2b0);
    } else if (kind < 0.7) {
      p.circle(x + 2, y + 2, 2, 0xf0f0e8); p.px(x + 1, y + 1, 0xc9c9c0); p.px(x + 3, y + 3, 0xc9c9c0);
    } else {
      const bc = [0x3ed17a, 0xff9f43, 0x8455d6, 0x3fe0e0][Math.floor(r() * 4)];
      p.box(x, y, 9, 3, bc); p.hline(x + 1, y + 1, 7, 0xfff8e7); p.box(x + 1, y - 3, 8, 3, shift(bc, 0.3));
    }
  }
  // backpack and bin in the bottom corners (under the HUD)
  p.ball(10, ah - 12, 7, 8, 0x3ed17a); p.box(6, ah - 12, 8, 5, 0x1f8a4a); p.hline(5, ah - 18, 10, 0xa6f0c4);
  p.box(aw - 16, ah - 20, 11, 14, 0x8f98a8); p.hline(aw - 16, ah - 20, 11, 0xd8dbe4); p.circle(aw - 10, ah - 21, 2, 0xf0f0e8);
}

import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'delivery-dash';
const HOUSE_LIFE = 14;
const CARRY_SPEED = 0.74;
const GRAV = 700;

interface House {
  i: number;
  x: number;
  y: number;
  /** Mailbox (delivery point). */
  mx: number;
  my: number;
  solid: Phaser.Geom.Rectangle;
  img: Phaser.GameObjects.Image;
  key: string;
  glow: Phaser.GameObjects.Image;
  mailbox: Phaser.GameObjects.Image;
  gem: Phaser.GameObjects.Sprite;
  stars: Phaser.GameObjects.Image[];
  ring: Phaser.GameObjects.Graphics;
  chimney: { x: number; y: number };
  lit: boolean;
  life: number;
  cool: number;
  smokeT: number;
}

interface Pkg {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  holder?: ArenaBody;
  lock: number;
  gold: boolean;
  pad: number;
  bob: number;
}

/** #28 — Grab parcels at the post office and run them to houses that light up. */
export default class DeliveryDash extends BaseMinigame {
  private kit!: ArenaKit;
  private houses: House[] = [];
  private pkgs: Pkg[] = [];
  private pads: { x: number; y: number; t: number; img: Phaser.GameObjects.Image }[] = [];
  private solids: Phaser.Geom.Rectangle[] = [];
  private po!: Phaser.Geom.Rectangle;
  private cx = 0;
  private cy = 0;
  private litTimer = 0;
  private goldT = 0;
  private delivered = [0, 0, 0, 0];
  private clouds!: Phaser.GameObjects.TileSprite;
  private flies: { img: Phaser.GameObjects.Sprite; ox: number; oy: number; ph: number; sp: number }[] = [];
  private t = 0;

  constructor() {
    super(CATALOG[ID]);
  }

  // ───────────────────────────── setup ─────────────────────────────

  setup(): void {
    const W = this.vw, H = this.vh;
    this.cx = W / 2;
    this.cy = H / 2;
    this.houses = [];
    this.pkgs = [];
    this.pads = [];
    this.solids = [];
    this.flies = [];
    this.delivered = [0, 0, 0, 0];
    this.litTimer = 0.4;
    this.goldT = 9;
    this.t = 0;
    this.paintTextures();
    this.layoutHouses();
    this.paintGround();
    this.buildPostOffice();
    this.buildDecor();

    this.kit = new ArenaKit(this, {
      speed: 150, accel: 900, radius: 12, dashSpeed: 430, dashCooldown: 1.0, bounce: 0.6,
      bounds: new Phaser.Geom.Rectangle(14, 16, W - 28, H - 32),
      spawn: (p) => ({ x: this.cx + (p % 2 === 0 ? -1 : 1) * 118, y: this.cy + (p < 2 ? -1 : 1) * 92 }),
    });
    this.kit.dashHit = 1.05;
    this.kit.canDash = (b) => !this.carried(b);
    this.kit.onBump = (a, b) => {
      if (a.dashT > 0 && this.carried(b)) this.drop(b, a);
      else if (b.dashT > 0 && this.carried(a)) this.drop(a, b);
    };
    for (const b of this.kit.bodies) {
      b.data.think = Math.random() * 0.4;
      b.data.aggro = 0.35 + Math.random() * 0.45;
      b.data.cpuSpeed = 0.9 + Math.random() * 0.08;
      b.data.noise = 0.25 + Math.random() * 0.35;
    }
  }

  private paintTextures(): void {
    // Package (normal + gold)
    makeTexture(this, `${ID}-box`, 11, 10, (p) => {
      p.box(0, 2, 11, 8, 0xc98a4b);
      p.rect(0, 0, 11, 3, 0xe0a865);
      p.hline(1, 0, 9, 0xf0c48a);
      p.vline(5, 0, 10, 0xf2deb0);
      p.hline(0, 2, 11, shift(0xc98a4b, -0.3));
      p.px(2, 5, 0xffffff); p.px(3, 5, 0xffffff); p.px(2, 6, 0x3d9bff);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-gold`, 11, 10, (p) => {
      p.box(0, 2, 11, 8, 0xffc93d);
      p.rect(0, 0, 11, 3, 0xffe066);
      p.hline(1, 0, 9, 0xfff3b0);
      p.vline(5, 0, 10, 0xff5a6e);
      p.hline(0, 5, 11, 0xff5a6e);
      p.hline(0, 2, 11, shift(0xffc93d, -0.3));
      p.px(4, 0, 0xff5a6e); p.px(6, 0, 0xff5a6e);
      p.outline(-0.7);
    });
    // Pad where parcels appear
    makeTexture(this, `${ID}-pad`, 22, 14, (p) => {
      p.ellipse(11, 7, 11, 7, 0x8a6a4a);
      p.ellipse(11, 6.5, 10, 6, 0xf0d68a);
      p.ellipse(11, 6.5, 7, 4, 0xe5c06a);
      for (let i = 0; i < 22; i += 4) p.vline(i, 3, 8, 0xd6ad55);
      p.ellipse(11, 6.5, 3, 2, 0xf6e3a8);
    });
    // Spinning request gem
    makeSheet(this, `${ID}-gem`, 12, 14, 6, (p, i) => {
      const w = [5, 4, 2, 0.8, 2, 4][i];
      p.tri(6 - w, 6, 6 + w, 6, 6, 13, 0xffb020);
      p.tri(6 - w, 6, 6 + w, 6, 6, 0, 0xffe066);
      if (w > 2) { p.px(5, 3, 0xffffff); p.px(5, 4, 0xfff7c2); }
      p.outline(-0.7);
    });
    if (!this.anims.exists(`${ID}-gem-spin`)) this.anims.create({ key: `${ID}-gem-spin`, frames: this.anims.generateFrameNumbers(`${ID}-gem`, {}), frameRate: 10, repeat: -1 });
    makeTexture(this, `${ID}-star`, 7, 7, (p) => {
      p.stamp(0, 0, ['...a...', '..aba..', 'aaabaaa', '.abbba.', '..aaa..', '.aa.aa.', 'a.....a'], { a: 0xffd23d, b: 0xfff6c0 });
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-glow`, 40, 30, (p) => {
      for (let r = 0; r < 6; r++) p.ellipse(20, 15, 20 - r * 3, 15 - r * 2.2, 0xffe9a0, 40 + r * 20);
    });
    // Mailboxes (flag up / down)
    for (const up of [0, 1]) {
      makeTexture(this, `${ID}-mail${up}`, 10, 14, (p) => {
        p.rect(4, 7, 2, 7, 0x7a5a3a);
        p.box(1, 2, 8, 6, 0x3d7bd8);
        p.rect(2, 1, 6, 1, 0x5a9af0);
        p.rect(2, 4, 3, 2, 0x1b2f6b);
        if (up) { p.vline(9, 0, 4, 0xd8dbe4); p.rect(9, 0, 1, 2, 0xff3a4a); p.px(8, 0, 0xff3a4a); }
        else { p.hline(8, 5, 2, 0xff3a4a); }
        p.outline(-0.7);
      });
    }
    // Trees, bushes, flowers
    makeTexture(this, `${ID}-tree`, 22, 26, (p) => {
      p.ellipse(11, 23, 8, 3, 0x2e6b3a, 120);
      p.rect(9, 15, 4, 9, 0x7a4a2c);
      p.vline(9, 15, 9, 0x9a643c);
      p.ball(11, 10, 10, 9, 0x4fae52);
      p.ball(7, 8, 5, 5, 0x5fc060, false);
      p.ball(15, 12, 5, 4, 0x3f9a48, false);
      p.px(6, 5, 0xb8f0a0); p.px(7, 5, 0xb8f0a0);
      p.px(13, 7, 0xff5a6e); p.px(8, 12, 0xff5a6e); p.px(15, 10, 0xff5a6e);
      p.outline(-0.75);
    });
    makeTexture(this, `${ID}-bush`, 14, 9, (p) => {
      p.ball(4, 5, 4, 4, 0x4a9a4e, false);
      p.ball(10, 5, 4, 4, 0x4a9a4e, false);
      p.ball(7, 4, 4, 4, 0x5aaa58);
      p.outline(-0.7);
    });
    makeSheet(this, `${ID}-fly`, 5, 4, 2, (p, i) => {
      const c = 0xffffff;
      if (i === 0) { p.rect(0, 0, 2, 3, c); p.rect(3, 0, 2, 3, c); }
      else { p.rect(0, 1, 2, 2, c); p.rect(3, 1, 2, 2, c); }
      p.vline(2, 0, 4, 0x2b2b3a);
    });
    if (!this.anims.exists(`${ID}-flap`)) this.anims.create({ key: `${ID}-flap`, frames: this.anims.generateFrameNumbers(`${ID}-fly`, {}), frameRate: 10, repeat: -1 });
    makeTexture(this, `${ID}-cloud`, 160, 120, (p) => {
      const r = rng(31);
      for (let i = 0; i < 3; i++) {
        const cx = 25 + i * 50 + r() * 15, cy = 25 + r() * 70;
        for (let k = 0; k < 5; k++) p.ellipse(cx + (r() - 0.5) * 22, cy + (r() - 0.5) * 10, 10 + r() * 8, 6 + r() * 4, 0x10304a);
      }
    });
    makeSheet(this, `${ID}-flag`, 12, 8, 4, (p, i) => {
      for (let x = 0; x < 10; x++) {
        const dy = Math.round(Math.sin((x + i * 2.5) * 0.8) * 1);
        p.vline(x + 1, 1 + dy, 5, x < 5 ? 0xff5a6e : 0xff7a85);
        p.px(x + 1, 1 + dy, 0xffb3bd);
      }
      p.vline(0, 0, 8, 0xe8e8f0);
      p.outline(-0.7);
    });
    if (!this.anims.exists(`${ID}-flag-wave`)) this.anims.create({ key: `${ID}-flag-wave`, frames: this.anims.generateFrameNumbers(`${ID}-flag`, {}), frameRate: 8, repeat: -1 });
    // Houses (3/4 view, front facing +y; rotated so every front faces the post office)
    const roofs = [0xd9604a, 0x4a8ad9, 0x5fae6a, 0xc98ad9, 0xe09a3a];
    const walls = [0xfff1d6, 0xf3e0c0, 0xfff8e7, 0xe8f0ff, 0xfde8d8];
    roofs.forEach((col, k) => {
      for (const lit of [0, 1]) {
        makeTexture(this, `${ID}-house${k}-${lit}`, 26, 26, (p) => {
          const wall = walls[k];
          // roof (top-down gable, ridge horizontal)
          p.rect(0, 1, 26, 15, shift(col, -0.5));
          p.rect(1, 1, 24, 7, shift(col, 0.2));
          p.rect(1, 8, 24, 7, shift(col, -0.12));
          for (let x = 2; x < 25; x += 3) { p.vline(x, 2, 6, col); p.vline(x + 1, 9, 6, shift(col, -0.3)); }
          for (let y = 3; y < 8; y += 2) p.hline(1, y, 24, shift(col, 0.05));
          p.hline(1, 7, 24, shift(col, 0.5));
          p.hline(1, 8, 24, shift(col, -0.35));
          p.hline(0, 15, 26, shift(col, -0.6));
          // chimney
          p.box(18, 0, 4, 5, 0xb0675a);
          p.rect(19, 0, 2, 1, 0x3a2a2a);
          // front wall
          p.rect(2, 16, 22, 9, wall);
          p.hline(2, 16, 22, shift(wall, -0.35));
          p.vline(23, 16, 9, shift(wall, -0.2));
          p.hline(1, 25, 24, shift(wall, -0.55));
          // door
          p.box(11, 18, 5, 7, 0x9a6a3e);
          p.px(15, 21, 0xffd34d);
          // windows
          const win = lit ? 0xffe680 : 0x7ab4dc;
          for (const wx of [4, 18]) {
            p.rect(wx - 1, 18, 6, 5, shift(wall, -0.45));
            p.rect(wx, 19, 4, 3, win);
            p.px(wx, 19, lit ? 0xfffbe0 : 0xc8ecff);
            p.vline(wx + 2, 19, 3, shift(wall, -0.45));
          }
          // flower boxes
          p.hline(3, 23, 6, 0x7a4a2c); p.hline(17, 23, 6, 0x7a4a2c);
          p.px(4, 22, 0xff7a85); p.px(6, 22, 0xffe066); p.px(18, 22, 0xb8a6ff); p.px(21, 22, 0xff7a85);
          p.outline(-0.75);
        });
      }
    });
    // Post office
    makeTexture(this, `${ID}-po`, 52, 38, (p) => {
      p.rect(0, 2, 52, 36, 0x7a3a3a);
      p.box(1, 1, 50, 34, 0xe05a4a, 1);
      p.rect(3, 3, 46, 30, 0xf06a55);
      for (let y = 5; y < 32; y += 3) p.hline(3, y, 46, 0xe05a4a);
      p.box(9, 8, 34, 20, 0xfff8e7, 1);
      // envelope emblem
      p.rect(12, 11, 28, 14, 0xffffff);
      p.line(12, 11, 26, 19, 0xc9c2d8); p.line(39, 11, 26, 19, 0xc9c2d8);
      p.line(12, 24, 22, 17, 0xdcd6e6); p.line(39, 24, 30, 17, 0xdcd6e6);
      p.rect(33, 12, 5, 5, 0xff5a6e); p.px(34, 13, 0xffe066);
      // vents
      p.box(3, 30, 6, 4, 0xb8bccb); p.box(43, 30, 6, 4, 0xb8bccb);
      p.box(3, 3, 6, 4, 0xb8bccb);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-poshadow`, 52, 38, (p) => p.rect(0, 0, 52, 38, 0x0a2a1a));
  }

  private layoutHouses(): void {
    const W = this.vw, H = this.vh;
    const spots: { x: number; y: number; side: 'top' | 'bottom' | 'left' | 'right' }[] = [];
    for (const f of [0.2, 0.38, 0.62, 0.8]) {
      spots.push({ x: Math.round(W * f), y: 50, side: 'top' });
      spots.push({ x: Math.round(W * f), y: H - 50, side: 'bottom' });
    }
    spots.push({ x: 40, y: H / 2, side: 'left' });
    spots.push({ x: W - 40, y: H / 2, side: 'right' });
    const order = [0, 1, 2, 3, 4, 1, 3, 0, 2, 4];
    spots.forEach((s, i) => {
      const vert = s.side === 'left' || s.side === 'right';
      const off = 36;
      const mx = s.x + (s.side === 'left' ? off : s.side === 'right' ? -off : 0);
      const my = s.y + (s.side === 'top' ? off : s.side === 'bottom' ? -off : 0);
      const hw = 26, hh = 26;
      const ang = { top: 0, bottom: 180, left: -90, right: 90 }[s.side];
      const glow = this.add.image(s.x, s.y, `${ID}-glow`).setScale(S * 1.3).setDepth(-40).setAlpha(0);
      this.add.image(s.x + 3, s.y + 4, `${ID}-poshadow`).setScale((hw * S) / 52, (hh * S) / 38).setAlpha(0.22).setDepth(-45);
      const img = this.add.image(s.x, s.y, `${ID}-house${order[i]}-0`).setScale(S).setAngle(ang).setDepth(s.y + (s.side === 'top' ? hh : -hh));
      const mailbox = this.add.image(mx + (vert ? 0 : 18), my, `${ID}-mail0`).setScale(S).setOrigin(0.5, 1).setDepth(my);
      const gem = this.add.sprite(mx, my - 40, `${ID}-gem`).setScale(S).setDepth(3000).setVisible(false);
      gem.play(`${ID}-gem-spin`);
      const stars = [0, 1, 2].map(() => this.add.image(mx, my, `${ID}-star`).setScale(S).setDepth(3001).setVisible(false));
      const ring = this.add.graphics().setDepth(2999);
      const rad = (ang * Math.PI) / 180;
      const ox = 7 * S, oy = -10 * S;
      const chx = s.x + ox * Math.cos(rad) - oy * Math.sin(rad), chy = s.y + ox * Math.sin(rad) + oy * Math.cos(rad);
      this.houses.push({
        i, x: s.x, y: s.y, mx: mailbox.x, my, img, key: `${ID}-house${order[i]}`,
        solid: new Phaser.Geom.Rectangle(s.x - hw + 3, s.y - hh + 3, hw * 2 - 6, hh * 2 - 6),
        glow, mailbox, gem, stars, ring, chimney: { x: chx, y: chy }, lit: false, life: 0, cool: 0, smokeT: Math.random(),
      });
      this.solids.push(this.houses[i].solid);
    });
  }

  private paintGround(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const key = makeTexture(this, `${ID}-ground-${aw}`, aw, ah, (p) => {
      const r = rng(77);
      p.rect(0, 0, aw, ah, 0x78c066);
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const n = Math.sin(x * 0.11 + y * 0.07) + Math.sin(x * 0.05 - y * 0.13);
        if (n > 1.1) p.px(x, y, 0x82ca6e);
        else if (n < -1.2) p.px(x, y, 0x6fb65e);
      }
      for (let i = 0; i < aw * ah * 0.03; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), r() > 0.5 ? 0x8ed47a : 0x66ad58);
      // grass tufts
      for (let i = 0; i < 160; i++) {
        const x = Math.floor(r() * aw), y = Math.floor(r() * ah);
        p.px(x, y, 0x5a9e4e); p.px(x + 1, y - 1, 0x5a9e4e); p.px(x + 2, y, 0x5a9e4e);
      }
      const cx = aw / 2, cy = ah / 2;
      const path = 0xe6d5ab, pathD = 0xcdb98c, edge = 0xb59f74;
      // paths from plaza to each mailbox
      for (const h of this.houses) {
        const tx = h.mx / S, ty = h.my / S;
        p.stroke(cx, cy, tx, ty, 11, edge);
      }
      for (const h of this.houses) p.stroke(cx, cy, h.mx / S, h.my / S, 9, path);
      // plaza
      p.ellipse(cx, cy, 62, 46, edge);
      p.ellipse(cx, cy, 61, 45, path);
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        if (p.get(x, y) !== path) continue;
        if ((x + (Math.floor(y / 4) % 2) * 3) % 6 === 0 || y % 4 === 0) p.px(x, y, pathD);
        else if (r() < 0.04) p.px(x, y, 0xf2e4c0);
      }
      // yards under houses
      for (const h of this.houses) {
        const x = h.x / S, y = h.y / S;
        p.ellipse(x, y, 20, 18, 0x6aae58);
      }
      // flowers
      for (let i = 0; i < 90; i++) {
        const x = Math.floor(r() * aw), y = Math.floor(r() * ah);
        if (p.get(x, y) === path || p.get(x, y) === pathD || p.get(x, y) === edge) continue;
        const c = [0xffffff, 0xffe066, 0xff8fa8, 0xb8a6ff][Math.floor(r() * 4)];
        p.px(x, y, c); p.px(x - 1, y, c); p.px(x + 1, y, c); p.px(x, y - 1, c); p.px(x, y, 0xffd23d);
      }
      // hedge border
      for (let x = 0; x < aw; x += 3) {
        p.ball(x, 2, 3, 3, 0x3f8a46, false);
        p.ball(x, ah - 3, 3, 3, 0x3f8a46, false);
      }
      for (let y = 0; y < ah; y += 3) {
        p.ball(2, y, 3, 3, 0x3f8a46, false);
        p.ball(aw - 3, y, 3, 3, 0x3f8a46, false);
      }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
  }

  private buildPostOffice(): void {
    const w = 52 * S, h = 38 * S;
    this.po = new Phaser.Geom.Rectangle(this.cx - w / 2 + 2, this.cy - h / 2 + 2, w - 4, h - 4);
    this.solids.push(this.po);
    this.add.image(this.cx + 5, this.cy + 7, `${ID}-poshadow`).setScale(S).setAlpha(0.25).setDepth(-45);
    this.add.image(this.cx, this.cy, `${ID}-po`).setScale(S).setDepth(this.cy + h / 2 - 4);
    const flag = this.add.sprite(this.cx + w / 2 - 14, this.cy - h / 2 - 2, `${ID}-flag`).setOrigin(0, 1).setScale(S).setDepth(this.cy + h);
    flag.play(`${ID}-flag-wave`);
    // four pads at the diagonals (one per seat direction = fair)
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = this.cx + sx * (w / 2 + 26), y = this.cy + sy * (h / 2 + 6);
      const img = this.add.image(x, y, `${ID}-pad`).setScale(S).setDepth(-30);
      this.pads.push({ x, y, t: 0.2 + this.pads.length * 0.15, img });
    }
  }

  private buildDecor(): void {
    const W = this.vw, H = this.vh;
    const spots = [
      [30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30],
      [W * 0.29, 30], [W * 0.71, 30], [W * 0.29, H - 30], [W * 0.71, H - 30],
      [34, H * 0.28], [W - 34, H * 0.72], [34, H * 0.72], [W - 34, H * 0.28],
    ];
    spots.forEach(([x, y], i) => {
      if (i < 4 || i >= 8) {
        const t = this.add.image(x, y + 20, `${ID}-tree`).setOrigin(0.5, 0.92).setScale(S).setDepth(y + 20);
        this.tweens.add({ targets: t, angle: { from: -2, to: 2 }, yoyo: true, repeat: -1, duration: 1600 + i * 130, ease: 'Sine.easeInOut' });
        this.solids.push(new Phaser.Geom.Rectangle(x - 6, y + 10, 12, 10));
      } else {
        const b = this.add.image(x, y, `${ID}-bush`).setScale(S).setDepth(y + 6);
        this.tweens.add({ targets: b, scaleY: S * 1.06, yoyo: true, repeat: -1, duration: 1300 + i * 90, ease: 'Sine.easeInOut' });
      }
    });
    this.clouds = this.add.tileSprite(0, 0, W / S, H / S, `${ID}-cloud`).setOrigin(0).setScale(S).setAlpha(0.13).setDepth(2500);
    for (let i = 0; i < 4; i++) {
      const img = this.add.sprite(0, 0, `${ID}-fly`).setScale(S).setDepth(2400).setTint([0xffffff, 0xffe066, 0xffb3e0, 0xa8d3ff][i]);
      img.play({ key: `${ID}-flap`, startFrame: i % 2 });
      this.flies.push({ img, ox: W * (0.15 + i * 0.23), oy: H * (i % 2 ? 0.3 : 0.7), ph: i * 1.7, sp: 0.5 + i * 0.12 });
    }
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private carried(b: ArenaBody): Pkg | undefined {
    return this.pkgs.find((k) => k.holder === b);
  }

  private value(h: House): number {
    const f = h.life / HOUSE_LIFE;
    return f > 0.62 ? 3 : f > 0.3 ? 2 : 1;
  }

  private spawnPkg(pad: number): void {
    const pd = this.pads[pad];
    const gold = this.goldT <= 0;
    if (gold) this.goldT = 12 + Math.random() * 4;
    const img = this.add.image(pd.x, pd.y, gold ? `${ID}-gold` : `${ID}-box`).setScale(S).setOrigin(0.5, 1);
    const shadow = this.add.image(pd.x, pd.y, 'shadow').setScale(S * 0.5).setAlpha(0.3).setDepth(-20);
    this.pkgs.push({ x: pd.x, y: pd.y + 2, z: 90, vx: 0, vy: 0, vz: 0, img, shadow, lock: 0, gold, pad, bob: Math.random() * 6 });
    Audio.sfx('whoosh', 1.3);
  }

  private pickup(b: ArenaBody, k: Pkg): void {
    k.holder = b;
    k.pad = -1;
    b.speedMul = CARRY_SPEED * (this.isCpu(b.p) ? b.data.cpuSpeed : 1);
    Audio.sfx('pop', 1 + b.p * 0.1);
    Vfx.squash(this, b.avatar.sprite, 0.8, 1.2, 160);
    Vfx.squash(this, k.img, 1.4, 0.7, 180);
    if (k.gold) Vfx.sparkle(this, b.x, b.y - 40);
  }

  private drop(victim: ArenaBody, by: ArenaBody): void {
    const k = this.carried(victim);
    if (!k) return;
    k.holder = undefined;
    victim.speedMul = this.isCpu(victim.p) ? victim.data.cpuSpeed : 1;
    victim.stun = Math.max(victim.stun, 0.6);
    const dx = victim.x - by.x, dy = victim.y - by.y;
    const l = Math.hypot(dx, dy) || 1;
    k.vx = (dx / l) * 150 + (Math.random() - 0.5) * 60;
    k.vy = (dy / l) * 150 + (Math.random() - 0.5) * 60;
    k.vz = 200;
    k.z = 30;
    k.lock = 0.45;
    Audio.sfx('bigHit');
    Audio.sfx('stun', 1 + victim.p * 0.1);
    Vfx.hit(this, victim.x, victim.y - 30, [0xffffff, 0xffe066, 0xc98a4b]);
    Vfx.popText(this, victim.x, victim.y - 60, 'หล่น!', '#ffb3bd', 16, this.angleFor(victim.p));
    Vfx.shake(this, 0.004, 120);
  }

  private light(): void {
    const free = this.houses.filter((h) => !h.lit && h.cool <= 0);
    if (!free.length) return;
    // Prefer houses far from the other lit ones so requests spread around the table.
    const lit = this.houses.filter((h) => h.lit);
    const scoreOf = (h: House) => (lit.length ? Math.min(...lit.map((o) => Math.hypot(o.x - h.x, o.y - h.y))) : 500) + Math.random() * 220;
    const h = free.reduce((m, o) => (scoreOf(o) > scoreOf(m) ? o : m));
    h.lit = true;
    h.life = HOUSE_LIFE;
    h.mailbox.setTexture(`${ID}-mail1`);
    h.img.setTexture(`${h.key}-1`);
    h.gem.setVisible(true).setScale(0);
    this.tweens.add({ targets: h.gem, scale: S, duration: 300, ease: 'Back.easeOut' });
    for (const s of h.stars) s.setVisible(true);
    Vfx.squash(this, h.mailbox, 0.7, 1.4, 220);
    Audio.sfx('select', 1.2);
  }

  private unlight(h: House, delivered: boolean): void {
    h.lit = false;
    h.cool = delivered ? 1.2 : 2;
    h.mailbox.setTexture(`${ID}-mail0`);
    h.img.setTexture(`${h.key}-0`);
    h.gem.setVisible(false);
    for (const s of h.stars) s.setVisible(false);
    h.ring.clear();
    if (!delivered) {
      burst(this, h.mx, h.my - 30, { tex: 'puff', count: 6, tint: [0xc7c9d6, 0x9aa0b8], speed: [20, 50], life: 600, scale: [S * 0.8, 0], gravity: -40 });
      Audio.sfx('back');
    }
  }

  private deliver(b: ArenaBody, k: Pkg, h: House): void {
    const stars = this.value(h);
    const pts = (2 + stars) * (k.gold ? 2 : 1);
    this.addScore(b.p, pts);
    this.delivered[b.p]++;
    k.holder = undefined;
    k.img.destroy();
    k.shadow.destroy();
    this.pkgs.splice(this.pkgs.indexOf(k), 1);
    b.speedMul = this.isCpu(b.p) ? b.data.cpuSpeed : 1;
    this.unlight(h, true);
    const col = toCss(PLAYER_COLORS[b.p].light);
    const label = stars === 3 ? `+${pts} เร็วมาก!` : stars === 2 ? `+${pts} ดี!` : `+${pts}`;
    Vfx.popText(this, h.mx, h.my - 54, label, col, stars === 3 ? 22 : 18, this.angleFor(b.p));
    Vfx.coinPop(this, h.mx, h.my - 20);
    Vfx.sparkle(this, h.mx, h.my - 20, [PLAYER_COLORS[b.p].main, 0xffffff, 0xffe066]);
    if (k.gold) Vfx.confetti(this, h.mx, h.my - 20, 40);
    Vfx.squash(this, h.mailbox, 1.4, 0.7, 220);
    Audio.sfx('coin', 1 + b.p * 0.1);
    if (stars === 3 || k.gold) Audio.sfx('power', 1 + b.p * 0.05);
    b.avatar.play('cheer', true);
  }

  private pushOut(b: ArenaBody): void {
    for (const r of this.solids) {
      const l = r.x - b.r, rt = r.right + b.r, t = r.y - b.r, bt = r.bottom + b.r;
      if (b.x <= l || b.x >= rt || b.y <= t || b.y >= bt) continue;
      const dl = b.x - l, dr = rt - b.x, dt = b.y - t, db = bt - b.y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) { b.x = l; b.vx = Math.min(0, b.vx); }
      else if (m === dr) { b.x = rt; b.vx = Math.max(0, b.vx); }
      else if (m === dt) { b.y = t; b.vy = Math.min(0, b.vy); }
      else { b.y = bt; b.vy = Math.max(0, b.vy); }
    }
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    this.kit.update(dt, this.state === 'play');
    for (const b of this.kit.bodies) {
      this.pushOut(b);
      b.avatar.setPos(b.x, b.y);
    }
    // parcels
    for (const k of this.pkgs) {
      if (k.holder) {
        const hb = k.holder;
        k.x = hb.x + hb.avatar.facing * 9;
        k.y = hb.y + 1;
        k.z = 16 + Math.abs(Math.sin(this.t * 10)) * (Math.hypot(hb.vx, hb.vy) > 25 ? 3 : 0);
      }
      const bob = !k.holder && k.z === 0 ? Math.sin(this.t * 3 + k.bob) * 1 : 0;
      k.img.setPosition(k.x, k.y - k.z + bob).setDepth(k.y + 2);
      k.shadow.setPosition(k.x, k.y).setVisible(!k.holder).setScale(S * 0.5 * Math.max(0.4, 1 - k.z / 120));
      if (k.gold && Math.random() < 0.08) burst(this, k.x + (Math.random() - 0.5) * 16, k.y - k.z - 12, { tex: 'spark', count: 1, tint: [0xffffff, 0xffe066], speed: [5, 20], life: 400, depth: 3000 });
    }
    // houses
    for (const h of this.houses) {
      h.ring.clear();
      if (h.lit) {
        const pulse = 0.55 + Math.sin(this.t * 6 + h.i) * 0.25;
        h.glow.setAlpha(pulse);
        const f = h.life / HOUSE_LIFE;
        const gy = h.my - 40 + Math.sin(this.t * 4 + h.i) * 3;
        h.gem.setPosition(h.mx, gy);
        const n = this.value(h);
        h.stars.forEach((s, j) => {
          const on = j < n;
          s.setVisible(on).setPosition(h.mx + (j - (n - 1) / 2) * 13, gy + 20);
        });
        const col = f > 0.62 ? 0x7ee8b0 : f > 0.3 ? 0xffe066 : 0xff7a85;
        h.ring.lineStyle(4, 0x1b1f3b, 0.6).beginPath().arc(h.mx, gy, 17, 0, Math.PI * 2).strokePath();
        h.ring.lineStyle(3, col, 1).beginPath().arc(h.mx, gy, 17, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f).strokePath();
        h.smokeT -= dt;
        if (h.smokeT <= 0) {
          h.smokeT = 0.35;
          burst(this, h.chimney.x, h.chimney.y, { tex: 'puff', count: 1, tint: [0xffffff, 0xe8e8f0], speed: [8, 20], angle: [250, 290], life: 1200, scale: [S * 0.5, S * 1.1], alpha: [0.7, 0], gravity: -20, depth: 2600 });
        }
      } else {
        h.glow.setAlpha(Math.max(0, h.glow.alpha - dt * 2));
        h.smokeT -= dt;
        if (h.smokeT <= 0) {
          h.smokeT = 1.4 + Math.random();
          burst(this, h.chimney.x, h.chimney.y, { tex: 'puff', count: 1, tint: [0xe8e8f0], speed: [5, 12], angle: [250, 290], life: 1400, scale: [S * 0.4, S * 0.9], alpha: [0.45, 0], gravity: -12, depth: 2600 });
        }
      }
    }
    // ambient life
    this.clouds.tilePositionX = this.t * 6;
    this.clouds.tilePositionY = this.t * 2.5;
    for (const f of this.flies) {
      const x = f.ox + Math.sin(this.t * f.sp + f.ph) * 70 + Math.sin(this.t * f.sp * 2.3) * 20;
      const y = f.oy + Math.cos(this.t * f.sp * 1.3 + f.ph) * 40;
      f.img.setPosition(x, y);
    }
  }

  tick(dt: number): void {
    this.goldT -= dt;
    // requests
    for (const h of this.houses) {
      h.cool = Math.max(0, h.cool - dt);
      if (h.lit) {
        h.life -= dt;
        if (h.life <= 0) this.unlight(h, false);
      }
    }
    const want = Math.min(3, Math.max(2, this.players.length - 1));
    this.litTimer -= dt;
    if (this.litTimer <= 0 && this.houses.filter((h) => h.lit).length < want) {
      this.light();
      this.litTimer = 0.5;
    }
    // parcels: refill pads
    const maxInPlay = Math.max(2, this.players.length - 1);
    for (let i = 0; i < this.pads.length; i++) {
      const pd = this.pads[i];
      if (this.pkgs.some((k) => k.pad === i)) continue;
      pd.t -= dt;
      if (pd.t <= 0 && this.pkgs.length < maxInPlay) {
        this.spawnPkg(i);
        pd.t = 1.2 + Math.random() * 0.8;
      }
    }
    for (const k of this.pkgs) {
      k.lock = Math.max(0, k.lock - dt);
      if (k.holder) continue;
      if (k.z > 0 || k.vz !== 0) {
        k.vz -= GRAV * dt;
        k.z += k.vz * dt;
        if (k.z <= 0) {
          k.z = 0;
          if (Math.abs(k.vz) > 120) { k.vz = -k.vz * 0.35; Audio.sfx('land'); Vfx.dust(this, k.x, k.y); }
          else { k.vz = 0; Vfx.dust(this, k.x, k.y); if (k.pad >= 0) { Audio.sfx('land'); Vfx.squash(this, k.img, 1.3, 0.7, 160); } }
        }
      }
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      const fr = Math.pow(k.z > 0 ? 0.6 : 0.02, dt);
      k.vx *= fr; k.vy *= fr;
      k.x = Phaser.Math.Clamp(k.x, 24, this.vw - 24);
      k.y = Phaser.Math.Clamp(k.y, 28, this.vh - 24);
      for (const r of this.solids) {
        if (r.contains(k.x, k.y)) {
          const dl = k.x - r.x, dr = r.right - k.x, dtp = k.y - r.y, db = r.bottom - k.y;
          const m = Math.min(dl, dr, dtp, db);
          if (m === dl) k.x = r.x - 4; else if (m === dr) k.x = r.right + 4; else if (m === dtp) k.y = r.y - 4; else k.y = r.bottom + 4;
          k.vx = -k.vx * 0.3; k.vy = -k.vy * 0.3;
        }
      }
    }
    // pickups + deliveries
    for (const b of this.kit.alive) {
      const k = this.carried(b);
      if (!k) {
        if (b.stun > 0) continue;
        const near = this.pkgs.find((o) => !o.holder && o.lock <= 0 && o.z < 12 && Math.hypot(o.x - b.x, o.y - b.y) < 22);
        if (near) this.pickup(b, near);
      } else {
        const h = this.houses.find((o) => o.lit && Math.hypot(o.mx - b.x, o.my + 4 - b.y) < 28);
        if (h) this.deliver(b, k, h);
      }
    }
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b, dt);
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private route(b: ArenaBody, tx: number, ty: number): { x: number; y: number } {
    const r = new Phaser.Geom.Rectangle(this.po.x - 16, this.po.y - 16, this.po.width + 32, this.po.height + 32);
    const line = new Phaser.Geom.Line(b.x, b.y, tx, ty);
    if (!Phaser.Geom.Intersects.LineToRectangle(line, r)) return { x: tx, y: ty };
    const corners = [[r.x, r.y], [r.right, r.y], [r.x, r.bottom], [r.right, r.bottom]];
    let best = corners[0], bd = Infinity;
    for (const c of corners) {
      const d = Math.hypot(c[0] - b.x, c[1] - b.y) + Math.hypot(tx - c[0], ty - c[1]);
      if (d < bd && Math.hypot(c[0] - b.x, c[1] - b.y) > 8) { bd = d; best = c; }
    }
    return { x: best[0], y: best[1] };
  }

  private bot(b: ArenaBody, dt: number): void {
    const k = this.carried(b);
    if (!k) b.speedMul = b.data.cpuSpeed;
    b.data.think -= dt;
    const goal = b.data.goalSet ? { x: b.data.gx, y: b.data.gy } : undefined;
    if (b.data.think <= 0 || !goal) {
      b.data.think = 0.3 + Math.random() * 0.4;
      b.data.chase = -1;
      let gx = this.cx, gy = this.cy + (b.p < 2 ? -70 : 70);
      if (k) {
        const lit = this.houses.filter((h) => h.lit);
        let best: House | undefined, bs = -Infinity;
        for (const h of lit) {
          const d = Math.hypot(h.mx - b.x, h.my - b.y);
          const eta = d / (150 * CARRY_SPEED);
          if (eta > h.life + 0.5) continue;
          const s = (2 + this.value(h)) / (d + 140) * (1 - b.data.noise * 0.5 + Math.random() * b.data.noise);
          if (s > bs) { bs = s; best = h; }
        }
        if (best) { gx = best.mx; gy = best.my + 4; }
      } else {
        const free = this.pkgs.filter((o) => !o.holder);
        const dist = (o: { x: number; y: number }) => Math.hypot(o.x - b.x, o.y - b.y);
        const pk = free.length ? free.reduce((m, o) => (dist(o) < dist(m) ? o : m)) : undefined;
        const carriers = this.kit.alive.filter((o) => o !== b && this.carried(o));
        const ca = carriers.length ? carriers.reduce((m, o) => (dist(o) < dist(m) ? o : m)) : undefined;
        const chase = ca && (!pk || dist(ca) * (1.4 - b.data.aggro) < dist(pk)) && dist(ca) < 220 && Math.random() < 0.85;
        if (chase && ca) { gx = ca.x + ca.vx * 0.3; gy = ca.y + ca.vy * 0.3; b.data.chase = ca.p; }
        else if (pk) { gx = pk.x; gy = pk.y; }
      }
      b.data.gx = gx; b.data.gy = gy; b.data.goalSet = 1;
    }
    if (b.data.chase >= 0) {
      const ca = this.kit.body(b.data.chase as PlayerIndex);
      if (ca && this.carried(ca)) {
        b.data.gx = ca.x + ca.vx * 0.25; b.data.gy = ca.y + ca.vy * 0.25;
        const d = Math.hypot(ca.x - b.x, ca.y - b.y);
        if (d < 75 && b.dashCd <= 0 && Math.random() < 0.12 * b.data.aggro + 0.02) b.botDash = true;
      }
    }
    b.botTarget = this.route(b, b.data.gx, b.data.gy);
  }

  shutdown(): void {
    this.kit?.destroy();
  }
}

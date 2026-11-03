import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'hide-and-seek';
const TOP = 62; // top wall (blackboard + windows)
const SIDE = 16;
const ROUND = 15;
const CONE_LEN = 236; // world units
const CONE_HALF = 0.5; // radians (~29°)
const EXPOSE = 0.32; // seconds in the light until caught
const FREEZE = 2;
const CATCH_PTS = 5;
const CAUGHT_LOSS = 2;
const BRAVE_R = 140;
const RUSTLE_AFTER = 4.5;
const DARK = 0x05061a;

interface Block { x: number; y: number; w: number; h: number }
interface Desk extends Block { img: Phaser.GameObjects.Image; occupant: PlayerIndex | -1; rattle: number }

interface Hider {
  expose: number;
  frozen: number;
  immune: number;
  hidden: boolean;
  desk: Desk | null;
  hideT: number;
  pts: number;
  eyes: Phaser.GameObjects.Image;
  alert: Phaser.GameObjects.Image;
  blinkT: number;
  ice: Phaser.GameObjects.Image;
}

/** #42 — Dark classroom: the flashlight passes around every 15 s; find hiders, or stay in the dark. */
export default class HideAndSeek extends BaseMinigame {
  private kit!: ArenaKit;
  private field!: Phaser.Geom.Rectangle;
  private blocks: Block[] = [];
  private desks: Desk[] = [];
  private hs: Hider[] = [];
  private seeker: PlayerIndex = 0;
  private round = -1;
  private grace = 0;
  private ang = 0;
  private dark!: Phaser.GameObjects.RenderTexture;
  private light!: Phaser.GameObjects.RenderTexture;
  private cone!: Phaser.GameObjects.Image;
  private halo!: Phaser.GameObjects.Image;
  private moons: Phaser.GameObjects.Image[] = [];
  private glows: Phaser.GameObjects.Image[] = [];
  private shadowG!: Phaser.GameObjects.Graphics;
  private torch!: Phaser.GameObjects.Image;
  private sky: Phaser.GameObjects.TileSprite[] = [];
  private curtains: Phaser.GameObjects.Image[] = [];
  private flicker = 0;
  private fish: Phaser.GameObjects.Sprite[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.blocks = [];
    this.desks = [];
    this.hs = [];
    this.moons = [];
    this.glows = [];
    this.sky = [];
    this.curtains = [];
    this.fish = [];
    this.round = -1;
    this.grace = 0;
    this.flicker = 0;
    this.seeker = this.players[0];
    this.ang = Math.PI / 2;
    const W = this.vw, H = this.vh;
    this.field = new Phaser.Geom.Rectangle(SIDE, TOP, W - SIDE * 2, H - TOP - SIDE);
    this.paintArt();
    this.paintRoom();
    this.buildFurniture();
    this.kit = new ArenaKit(this, {
      speed: 132, accel: 900, radius: 11, dash: false, bounce: 0.3, bounds: this.field,
      spawn: (p) => ({ x: p % 2 === 0 ? 60 : W - 60, y: p < 2 ? TOP + 36 : H - 50 }),
    });
    this.kit.onBump = (a, b) => {
      if (this.state !== 'play' || this.grace > 0) return;
      if (a.p === this.seeker) this.tryTag(b);
      else if (b.p === this.seeker) this.tryTag(a);
    };
    for (const b of this.kit.bodies) {
      const c = PLAYER_COLORS[b.p];
      const eyesKey = makeTexture(this, `${ID}-eyes-${b.p}`, 9, 4, (g) => {
        g.rect(1, 1, 2, 2, 0xffffff); g.rect(6, 1, 2, 2, 0xffffff);
        g.px(2, 2, c.dark); g.px(7, 2, c.dark);
        g.outline(-0.3);
      });
      this.hs[b.p] = {
        expose: 0, frozen: 0, immune: 0, hidden: false, desk: null, hideT: 0, pts: 0, blinkT: Math.random() * 3,
        eyes: this.add.image(b.x, b.y, eyesKey).setScale(S).setDepth(886).setAlpha(0),
        alert: this.add.image(b.x, b.y, `${ID}-alert`).setScale(S).setDepth(2600).setVisible(false),
        ice: this.add.image(b.x, b.y, `${ID}-ice`).setScale(S).setOrigin(0.5, 1).setVisible(false),
      };
      b.data.think = 0;
      b.data.tx = b.x;
      b.data.ty = b.y;
      b.data.skill = 0.5 + Math.random() * 0.45;
      b.data.gx = b.x;
      b.data.gy = b.y;
      b.data.sweep = Math.random() * 10;
    }
    this.buildLighting();
    this.startRound(0);
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    const WOOD = 0xb07a48;
    makeTexture(this, `${ID}-desk`, 32, 22, (p) => {
      // two chairs peeking out below
      for (const cx of [7, 21]) { p.box(cx - 4, 15, 9, 6, 0x6a7a9a); p.rect(cx - 4, 20, 2, 2, 0x4a5470); p.rect(cx + 3, 20, 2, 2, 0x4a5470); }
      p.box(0, 2, 32, 12, WOOD, 1);
      p.rect(0, 14, 32, 3, shift(WOOD, -0.4));
      p.rect(1, 17, 2, 3, 0x6a7282); p.rect(29, 17, 2, 3, 0x6a7282);
      p.rect(4, 4, 8, 6, 0xfff8e7); p.hline(5, 6, 6, 0x8fa8d8); p.hline(5, 8, 5, 0x8fa8d8);
      p.rect(18, 5, 9, 5, 0x3d9bff); p.vline(18, 5, 5, 0x1d5bb3);
      p.line(14, 10, 17, 4, 0xffc93d);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-tdesk`, 62, 34, (p) => {
      p.box(0, 6, 62, 16, shift(WOOD, -0.1), 1);
      p.rect(0, 22, 62, 12, shift(WOOD, -0.42));
      p.rect(4, 24, 20, 8, shift(WOOD, -0.3)); p.rect(12, 27, 4, 2, 0xd9c27a);
      p.rect(38, 24, 20, 8, shift(WOOD, -0.3)); p.rect(46, 27, 4, 2, 0xd9c27a);
      p.rect(6, 8, 14, 10, 0xfff8e7); p.rect(8, 10, 10, 1, 0x8fa8d8); p.rect(8, 13, 8, 1, 0x8fa8d8);
      p.ball(28, 12, 3, 3, 0xff4d4d); p.px(28, 8, 0x3ed17a);
      p.ball(48, 8, 6, 6, 0x3d9bff); p.rect(46, 6, 3, 3, 0x3ed17a); p.rect(50, 9, 3, 2, 0x3ed17a); p.rect(47, 14, 2, 5, 0x8f98a8); p.rect(44, 18, 8, 2, 0x8f98a8);
      p.rect(34, 10, 8, 6, 0xff7a85); p.rect(35, 9, 8, 1, 0xffe066);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-shelf`, 18, 62, (p) => {
      p.box(0, 0, 18, 62, 0x7a5236, 1);
      for (let y = 4; y < 58; y += 11) {
        p.rect(2, y, 14, 9, 0x4a3020);
        const cols = [0xff7a85, 0x6ec6ff, 0xffe066, 0x7ee8b0, 0xb8a6ff, 0xff9f43];
        for (let x = 2; x < 15; x += 3) p.rect(x, y + 1 + ((x + y) % 3 === 0 ? 2 : 0), 2, 8 - ((x + y) % 3 === 0 ? 2 : 0), cols[(x + y) % cols.length]);
        p.hline(1, y + 9, 16, 0x9a6a46);
      }
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-boxes`, 34, 26, (p) => {
      const cb = 0xc9955a;
      p.box(0, 10, 18, 16, cb, 1); p.rect(0, 10, 18, 3, shift(cb, 0.2)); p.vline(9, 10, 16, shift(cb, -0.3));
      p.box(16, 8, 18, 18, shift(cb, -0.08), 1); p.rect(16, 8, 18, 3, shift(cb, 0.15)); p.hline(16, 16, 18, 0xe0c080);
      p.box(6, 0, 16, 12, shift(cb, 0.06), 1); p.rect(6, 0, 16, 3, shift(cb, 0.25)); p.vline(14, 0, 12, shift(cb, -0.3));
      p.rect(20, 18, 8, 4, 0xfff8e7); p.hline(21, 20, 6, 0x8f98a8);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-tankbase`, 34, 30, (p) => {
      p.box(0, 14, 34, 16, 0x6a7282, 1);
      p.rect(2, 18, 14, 10, 0x5a6070); p.rect(18, 18, 14, 10, 0x5a6070);
      p.rect(8, 22, 2, 2, 0xd8dbe4); p.rect(24, 22, 2, 2, 0xd8dbe4);
      p.rect(1, 0, 32, 14, 0x1d4a6e);
      p.rect(2, 1, 30, 12, 0x2f86c0);
      p.rect(2, 1, 30, 3, 0x5ab8ee);
      p.rect(2, 11, 30, 2, 0xc9a26a);
      p.vline(6, 6, 6, 0x3ed17a); p.vline(7, 4, 8, 0x3ed17a); p.vline(27, 7, 5, 0x3ed17a);
      p.outline(-0.8);
    });
    makeSheet(this, `${ID}-fish`, 6, 4, 2, (p, i) => {
      p.ellipse(2.5, 2, 2.5, 1.6, i ? 0xff9f43 : 0xffe066); p.tri(4, 0, 6, 2, 4, 4, i ? 0xff9f43 : 0xffe066); p.px(1, 1, 0x1b1f3b);
    });
    makeTexture(this, `${ID}-plant`, 14, 22, (p) => {
      p.box(3, 14, 8, 8, 0xd9734e);
      const r = rng(9);
      for (let i = 0; i < 7; i++) p.ball(7 + (r() - 0.5) * 9, 5 + r() * 9, 3.5, 2.6, i % 2 ? 0x58b05a : 0x4a9a4e, false);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-alert`, 5, 9, (p) => { p.rect(1, 0, 3, 5, 0xffe066); p.rect(1, 6, 3, 2, 0xffe066); p.outline(-0.8); });
    makeTexture(this, `${ID}-ice`, 20, 36, (p) => {
      for (let y = 0; y < 36; y++) for (let x = 0; x < 20; x++) {
        const edge = x === 0 || x === 19 || y === 0 || y === 35;
        if (((x * 3 + y) % 7) === 0 || edge) p.px(x, y, 0xe0f8ff, edge ? 230 : 160);
        else p.px(x, y, 0x9ee6ff, 90);
      }
      p.line(3, 4, 7, 12, 0xffffff); p.line(13, 18, 16, 28, 0xffffff);
    });
    makeTexture(this, `${ID}-torch`, 9, 5, (p) => { p.rect(0, 1, 6, 3, 0x3a3f4e); p.rect(6, 0, 3, 5, 0xd8dbe4); p.px(8, 2, 0xfff6c8); p.outline(-0.6); });
    // light cone, painted at art resolution (dithered falloff → pixel-art light)
    const L = Math.round(CONE_LEN / S);
    makeTexture(this, `${ID}-cone`, L + 2, L, (p) => {
      const cy = L / 2;
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      for (let y = 0; y < L; y++) for (let x = 0; x < L + 2; x++) {
        const dx = x + 0.5, dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy);
        const a = Math.abs(Math.atan2(dy, dx));
        if (d > L || a > CONE_HALF) continue;
        const edgeA = Math.min(1, (CONE_HALF - a) / 0.12);
        const edgeD = Math.min(1, (L - d) / (L * 0.3));
        const k = Math.min(edgeA, edgeD);
        const th = (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        if (k > th) p.px(x, y, 0xffffff, k > 0.6 ? 255 : 200);
      }
    });
    makeTexture(this, `${ID}-halo`, 36, 36, (p) => {
      const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      for (let y = 0; y < 36; y++) for (let x = 0; x < 36; x++) {
        const d = Math.hypot(x + 0.5 - 18, y + 0.5 - 18) / 18;
        if (d > 1) continue;
        const k = 1 - d;
        if (k * 1.6 > (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16) p.px(x, y, 0xffffff, 200);
      }
    });
    makeTexture(this, `${ID}-moon`, 40, 60, (p) => {
      // slanted window light patch on the floor
      for (let y = 0; y < 60; y++) {
        const x0 = Math.round(y * 0.35);
        const fade = 1 - y / 60;
        for (let x = 0; x < 22; x++) {
          if ((x === 10 || x === 11)) continue;
          if (y % 14 === 13) continue;
          if (fade * 1.4 > (((x + y) & 3) + 0.5) / 4) p.px(x0 + x, y, 0xffffff, 150);
        }
      }
    });
    makeTexture(this, `${ID}-softglow`, 32, 32, (p) => {
      for (let r = 16; r > 0; r -= 2) p.circle(16, 16, r, 0xffffff, Math.round(60 * (1 - r / 17)));
    });
    makeTexture(this, `${ID}-curtain`, 12, 30, (p) => {
      for (let x = 0; x < 12; x++) p.vline(x, 0, 30 - (x % 4 === 0 ? 1 : 0), x % 4 < 2 ? 0x8455d6 : 0x6a3fb0);
      p.hline(0, 0, 12, 0xb8a6ff);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-nightsky`, 32, 16, (p) => {
      p.rect(0, 0, 32, 16, 0x1d2a5a);
      p.px(3, 3, 0xffffff); p.px(17, 6, 0xfff1a0); p.px(26, 2, 0xffffff); p.px(9, 11, 0xc8d8ff); p.px(22, 12, 0xffffff);
      p.ball(13, 9, 4, 1.5, 0x3a4a80, false); p.ball(16, 8, 3, 1.5, 0x3a4a80, false);
    });
    makeTexture(this, `${ID}-moonball`, 10, 10, (p) => { p.ball(5, 5, 4.5, 4.5, 0xfff6c8); p.px(3, 4, 0xe0d8a0); p.px(6, 6, 0xe0d8a0); });
  }

  private paintRoom(): void {
    const W = this.vw, H = this.vh;
    const aw = Math.ceil(W / S), ah = Math.ceil(H / S);
    const key = makeTexture(this, `${ID}-room-${aw}`, aw, ah, (p) => {
      const r = rng(17);
      // wooden floor planks
      const planks = [0x9a6a40, 0x8f6239, 0xa47248, 0x946640];
      for (let y = 0; y < ah; y += 7) {
        let x = -Math.floor(r() * 30);
        while (x < aw) {
          const len = 24 + Math.floor(r() * 26);
          const c = planks[Math.floor(r() * planks.length)];
          p.rect(x, y, len, 6, c);
          p.hline(x, y, len, shift(c, 0.15));
          p.vline(x + len - 1, y, 6, shift(c, -0.4));
          for (let i = 0; i < 3; i++) p.hline(x + Math.floor(r() * len), y + 2 + Math.floor(r() * 3), 3 + Math.floor(r() * 4), shift(c, -0.12));
          x += len;
        }
        p.hline(0, y + 6, aw, 0x5a3a22);
      }
      // a reading rug
      const rx = aw - 70, ry = ah - 34;
      p.ellipse(rx, ry, 30, 13, 0x7a3a6a); p.ellipse(rx, ry, 26, 10, 0xb8508a); p.ellipse(rx, ry, 18, 6, 0xe07ab0);
      // top wall with blackboard, windows, clock
      const tw = TOP / S;
      p.rect(0, 0, aw, tw, 0xe8d8b8);
      p.rect(0, tw - 5, aw, 5, 0x8a6a4a); p.hline(0, tw - 5, aw, 0xb08a60);
      for (let x = 0; x < aw; x += 4) p.vline(x, 0, tw - 5, 0xdccaa8);
      const bw = 96, bx = Math.round(aw / 2 - bw / 2);
      p.rect(bx - 2, 3, bw + 4, tw - 8, 0x8a6a4a);
      p.rect(bx, 4, bw, tw - 10, 0x2f5a46);
      p.dither(bx, 4, bw, tw - 10, 0x2f5a46, 0x356450, 0.3);
      // chalk doodles: sum, house, smiley
      p.hline(bx + 8, 10, 10, 0xffffff); p.vline(bx + 13, 6, 9, 0xffffff); p.hline(bx + 22, 9, 6, 0xffffff); p.hline(bx + 22, 11, 6, 0xffffff);
      p.rect(bx + 32, 8, 3, 4, 0xffffff); p.rect(bx + 37, 8, 3, 4, 0xffffff);
      p.ring(bx + 70, 12, 6, 0xffe9a8); p.px(bx + 68, 10, 0xffe9a8); p.px(bx + 72, 10, 0xffe9a8); p.hline(bx + 68, 14, 5, 0xffe9a8);
      p.line(bx + 50, 16, bx + 56, 8, 0xc8f0ff); p.line(bx + 56, 8, bx + 62, 16, 0xc8f0ff); p.hline(bx + 50, 16, 12, 0xc8f0ff);
      p.rect(bx + 10, tw - 7, bw - 20, 1, 0xb08a60); p.rect(bx + 20, tw - 8, 4, 1, 0xffffff);
      // clock
      p.circle(bx + bw + 16, 12, 6, 0xfff8e7); p.ring(bx + bw + 16, 12, 6, 0x5a3a22); p.vline(bx + bw + 16, 8, 4, 0x1b1f3b); p.hline(bx + bw + 16, 12, 3, 0x1b1f3b);
      // posters
      p.box(bx - 30, 6, 14, 18, 0xffb3bd, 1); p.ball(bx - 23, 13, 4, 4, 0xffe066, false); p.hline(bx - 28, 20, 10, 0x8455d6);
      // side walls (top view rim)
      const sw = SIDE / S;
      p.rect(0, tw, sw, ah - tw, 0xc8b898); p.rect(aw - sw, tw, sw, ah - tw, 0xc8b898);
      p.vline(sw - 1, tw, ah - tw, 0x8a6a4a); p.vline(aw - sw, tw, ah - tw, 0x8a6a4a);
      p.rect(0, ah - sw, aw, sw, 0xc8b898); p.hline(0, ah - sw, aw, 0x8a6a4a);
      // exit sign by the bottom wall
      p.rect(aw / 2 - 8, ah - sw + 1, 16, 6, 0x1f8a4a); p.rect(aw / 2 - 6, ah - sw + 2, 12, 4, 0x3ed17a);
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
    // windows with moving night sky + moon (cut into the top wall)
    const winXs = [W * 0.13, W * 0.87];
    winXs.forEach((x, i) => {
      const sky = this.add.tileSprite(x, 26, 26, 18, `${ID}-nightsky`).setScale(S).setDepth(-95);
      this.sky.push(sky);
      if (i === 0) this.add.image(x + 12, 18, `${ID}-moonball`).setScale(S).setDepth(-94);
      const frame = makeTexture(this, `${ID}-winframe`, 30, 22, (p) => {
        p.rect(0, 0, 30, 2, 0xfff8e7); p.rect(0, 20, 30, 2, 0xfff8e7); p.rect(0, 0, 2, 22, 0xfff8e7); p.rect(28, 0, 2, 22, 0xfff8e7);
        p.rect(14, 0, 2, 22, 0xfff8e7); p.rect(0, 10, 30, 2, 0xfff8e7);
        p.outline(-0.6);
      });
      this.add.image(x, 26, frame).setScale(S).setDepth(-93);
      for (const dx of [-38, 38]) {
        const c = this.add.image(x + dx, 6, `${ID}-curtain`).setScale(S).setOrigin(0.5, 0).setDepth(-92);
        this.curtains.push(c);
      }
    });
  }

  private addBlock(x: number, y: number, w: number, h: number, key: string, imgH: number): void {
    // x,y = centre of the footprint; image anchored at the footprint bottom.
    this.blocks.push({ x: x - w / 2, y: y - h / 2, w, h });
    const img = this.add.image(x, y + h / 2, key).setScale(S).setOrigin(0.5, 1).setDepth(y + h / 2);
    void imgH;
    void img;
  }

  private buildFurniture(): void {
    const W = this.vw, H = this.vh, cx = W / 2;
    this.addBlock(cx, TOP + 40, 120, 30, `${ID}-tdesk`, 68);
    this.addBlock(112, 205, 34, 96, `${ID}-shelf`, 124);
    this.addBlock(W - 112, 290, 34, 96, `${ID}-shelf`, 124);
    this.addBlock(146, H - 62, 64, 36, `${ID}-boxes`, 52);
    this.addBlock(W - 150, H - 56, 64, 26, `${ID}-tankbase`, 60);
    // fish swimming in the tank + its glow
    for (let i = 0; i < 2; i++) {
      const f = this.add.sprite(W - 150, H - 92 + i * 6, `${ID}-fish`, i).setScale(S).setDepth(H - 42);
      this.fish.push(f);
    }
    for (const [x, y] of [[54, TOP + 22], [W - 54, H - 120]]) this.add.image(x, y, `${ID}-plant`).setScale(S).setOrigin(0.5, 1).setDepth(y);
    // student desks = hiding spots (walk under them)
    const xs = [cx - 165, cx - 55, cx + 55, cx + 165];
    for (const [j, y] of [205, 305].entries()) {
      for (const [i, x] of xs.entries()) {
        if ((j === 0 && i === 0) || (j === 1 && i === 3)) continue; // leave room near the shelves
        const w = 62, h = 30;
        const img = this.add.image(x, y + h / 2 + 6, `${ID}-desk`).setScale(S).setOrigin(0.5, 1).setDepth(y + h / 2 + 4);
        this.desks.push({ x: x - w / 2, y: y - h / 2, w, h, img, occupant: -1, rattle: 0 });
      }
    }
  }

  private buildLighting(): void {
    const AW = Math.ceil(this.vw / S), AH = Math.ceil(this.vh / S);
    this.dark = this.add.renderTexture(0, 0, AW, AH).setOrigin(0).setScale(S).setDepth(880);
    this.light = new Phaser.GameObjects.RenderTexture(this, 0, 0, AW, AH).setOrigin(0);
    this.cone = new Phaser.GameObjects.Image(this, 0, 0, `${ID}-cone`).setOrigin(0, 0.5);
    this.halo = new Phaser.GameObjects.Image(this, 0, 0, `${ID}-halo`);
    this.shadowG = new Phaser.GameObjects.Graphics(this);
    // moonlight patches from the windows, plus faint glows (fish tank, exit sign)
    for (const x of [this.vw * 0.13, this.vw * 0.87]) {
      this.moons.push(new Phaser.GameObjects.Image(this, (x - 16) / S, TOP / S, `${ID}-moon`).setOrigin(0, 0).setAlpha(0.5));
    }
    this.glows.push(new Phaser.GameObjects.Image(this, (this.vw - 150) / S, (this.vh - 84) / S, `${ID}-softglow`).setScale(1.6, 1.1).setAlpha(0.9));
    this.glows.push(new Phaser.GameObjects.Image(this, this.vw / 2 / S, (this.vh - 10) / S, `${ID}-softglow`).setScale(1.2, 0.6).setAlpha(0.8));
    this.torch = this.add.image(0, 0, `${ID}-torch`).setScale(S).setDepth(2400);
  }

  // ───────────────────────────── rounds ─────────────────────────────

  private startRound(i: number): void {
    this.round = i;
    this.seeker = this.players[i % this.players.length];
    this.grace = 1.4;
    this.flicker = 1.4;
    for (const b of this.kit.bodies) {
      const h = this.hs[b.p];
      h.expose = 0; h.frozen = 0; h.immune = 0;
      b.stun = 0;
      b.speedMul = b.p === this.seeker ? 1.08 : 1;
      b.avatar.marker?.setVisible(b.p === this.seeker);
      b.avatar.ring?.setVisible(b.p === this.seeker);
      h.ice.setVisible(false);
      b.avatar.sprite.clearTint();
    }
    const sb = this.kit.body(this.seeker);
    if (sb) this.ang = Math.atan2(this.vh / 2 - sb.y, this.vw / 2 - sb.x);
    if (i === 0) return;
    Audio.sfx('freeze', 0.8);
    const c = PLAYER_COLORS[this.seeker];
    for (const [deg, y] of [[0, this.vh * 0.62], [180, this.vh * 0.38]] as const) {
      const t = txt(this, this.vw / 2, y, `รอบ ${i + 1}/4 · P${this.seeker + 1} ถือไฟฉาย!`, { size: 22, color: toCss(c.light), strokeWidth: 6 }).setAngle(deg).setDepth(3000);
      this.tweens.add({ targets: t, scale: { from: 0.4, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 1200, duration: 300, onComplete: () => t.destroy() });
    }
    this.roleTexts();
  }

  private roleTexts(): void {
    for (const b of this.kit.bodies) {
      const me = b.p === this.seeker;
      this.pop(b.x, b.y - 80, me ? 'คนหา!' : 'ซ่อนเร็ว!', me ? '#ffe066' : toCss(PLAYER_COLORS[b.p].light), 16, this.angleFor(b.p));
    }
  }

  onStart(): void {
    this.roleTexts();
    const c = PLAYER_COLORS[this.seeker];
    for (const [deg, y] of [[0, this.vh * 0.62], [180, this.vh * 0.38]] as const) {
      const t = txt(this, this.vw / 2, y, `P${this.seeker + 1} ถือไฟฉาย!`, { size: 22, color: toCss(c.light), strokeWidth: 6 }).setAngle(deg).setDepth(3000);
      this.tweens.add({ targets: t, alpha: 0, delay: 1300, duration: 300, onComplete: () => t.destroy() });
    }
  }

  /** Pop text that stays above the darkness overlay. */
  private pop(x: number, y: number, text: string, color: string, size: number, angle: number): void {
    const t = txt(this, x, y, text, { size, color, strokeWidth: 4 }).setDepth(2700).setAngle(angle).setScale(0.4);
    const up = angle === 180 ? 26 : -26;
    this.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y + up, alpha: 0, delay: 500, duration: 420, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
  }

  // ───────────────────────────── geometry ─────────────────────────────

  private segBlocked(x0: number, y0: number, x1: number, y1: number): boolean {
    for (const b of this.blocks) if (Phaser.Geom.Intersects.LineToRectangle(new Phaser.Geom.Line(x0, y0, x1, y1), new Phaser.Geom.Rectangle(b.x, b.y, b.w, b.h))) return true;
    return false;
  }

  private pushOut(b: ArenaBody): void {
    const r = b.r;
    for (const k of this.blocks) {
      const nx = Phaser.Math.Clamp(b.x, k.x, k.x + k.w), ny = Phaser.Math.Clamp(b.y, k.y, k.y + k.h);
      const dx = b.x - nx, dy = b.y - ny, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d > 0.001) { b.x = nx + (dx / d) * r; b.y = ny + (dy / d) * r; }
      else {
        // centre inside the block: push along the shallowest axis
        const l = b.x - k.x, rr = k.x + k.w - b.x, t = b.y - k.y, bt = k.y + k.h - b.y;
        const m = Math.min(l, rr, t, bt);
        if (m === l) b.x = k.x - r; else if (m === rr) b.x = k.x + k.w + r; else if (m === t) b.y = k.y - r; else b.y = k.y + k.h + r;
      }
    }
  }

  private deskAt(x: number, y: number): Desk | null {
    for (const d of this.desks) if (x > d.x + 4 && x < d.x + d.w - 4 && y > d.y && y < d.y + d.h + 6) return d;
    return null;
  }

  /** Is this hider lit by the seeker's flashlight right now? */
  private isLit(s: ArenaBody, b: ArenaBody): boolean {
    if (this.flicker > 0.6) return false;
    const h = this.hs[b.p];
    const sx = s.x, sy = s.y - 14, tx = b.x, ty = b.y - 14;
    const d = Math.hypot(tx - sx, ty - sy);
    if (h.hidden && d > 56) return false;
    if (d < 30) return true;
    if (d > CONE_LEN - 10) return false;
    let da = Math.atan2(ty - sy, tx - sx) - this.ang;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > CONE_HALF * 0.92) return false;
    return !this.segBlocked(sx, sy, tx, ty);
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.kit.update(dt, this.state === 'play');
    for (const b of this.kit.bodies) { this.pushOut(b); b.avatar.setPos(b.x, b.y); }
    const now = this.time.now;
    for (const [i, s] of this.sky.entries()) s.tilePositionX += dt * (2 + i);
    this.curtains.forEach((c, i) => c.setScale(S * (1 + Math.sin(now / 900 + i) * 0.06), S));
    this.fish.forEach((f, i) => {
      const t = now / 1000 * (0.6 + i * 0.25) + i * 2;
      f.setX(this.vw - 150 + Math.sin(t) * 22).setFlipX(Math.cos(t) > 0);
    });
    const seekerB = this.kit.body(this.seeker);
    // hider visuals: eyes, hidden dimming, frozen ice
    for (const b of this.kit.bodies) {
      const h = this.hs[b.p];
      const isSeeker = b.p === this.seeker;
      const moving = Math.hypot(b.vx, b.vy) > 20;
      h.blinkT -= dt;
      if (h.blinkT < -0.15) h.blinkT = 2 + Math.random() * 2.5;
      const showEyes = !isSeeker && !h.hidden && h.frozen <= 0 && (moving || h.blinkT < 0) && this.state !== 'end';
      h.eyes.setPosition(b.x + b.avatar.facing * 2, b.y - 46).setAlpha(showEyes ? 0.9 : 0);
      if (!isSeeker) {
        if (h.hidden) b.avatar.setAlpha(0.55);
        if (h.immune > 0 && h.frozen <= 0) b.avatar.setAlpha(Math.floor(now / 80) % 2 ? 0.35 : 1);
      }
      h.ice.setVisible(h.frozen > 0).setPosition(b.x, b.y + 2).setDepth(b.y + 1);
      h.alert.setVisible(h.expose > 0.02 && h.frozen <= 0).setPosition(b.x, b.y - 78).setScale(S * (1 + h.expose * 2));
    }
    // seeker's torch in hand
    if (seekerB) {
      const hx = seekerB.x + Math.cos(this.ang) * 12, hy = seekerB.y - 26 + Math.sin(this.ang) * 6;
      this.torch.setPosition(hx, hy).setRotation(this.ang).setDepth(seekerB.y + (Math.sin(this.ang) > 0 ? 2 : -2));
    }
    this.renderLight(seekerB);
  }

  private renderLight(s?: ArenaBody): void {
    const L = this.light;
    L.clear();
    const on = s && this.state !== 'intro' && !(this.flicker > 0 && Math.floor(this.flicker * 14) % 2 === 0);
    if (s && on) {
      const sx = s.x / S, sy = (s.y - 14) / S;
      this.cone.setPosition(sx, sy).setRotation(this.ang);
      this.halo.setPosition(sx, sy + 2);
      L.draw([this.cone, this.halo]);
      // shadows behind tall furniture
      const g = this.shadowG;
      g.clear();
      g.fillStyle(0xffffff, 1);
      const far = 400;
      for (const b of this.blocks) {
        const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([x, y]) => [x / S, y / S]);
        const cxm = (b.x + b.w / 2) / S, cym = (b.y + b.h / 2) / S;
        const base = Math.atan2(cym - sy, cxm - sx);
        let lo = 0, hi = 0, loA = 1e9, hiA = -1e9;
        corners.forEach(([x, y], i) => {
          let a = Math.atan2(y - sy, x - sx) - base;
          a = Math.atan2(Math.sin(a), Math.cos(a));
          if (a < loA) { loA = a; lo = i; }
          if (a > hiA) { hiA = a; hi = i; }
        });
        const P = (i: number) => corners[i];
        const proj = (i: number) => { const [x, y] = P(i); const a = Math.atan2(y - sy, x - sx); return [x + Math.cos(a) * far, y + Math.sin(a) * far]; };
        const pts = [P(lo), P(hi), proj(hi), proj(lo)].map(([x, y]) => new Phaser.Math.Vector2(x, y));
        // include the far corner(s) so the block's back half is shadowed too
        g.fillPoints(pts, true);
      }
      L.erase(g);
    }
    L.draw(this.moons);
    L.draw(this.glows);
    this.dark.clear();
    this.dark.fill(DARK, 0.93);
    this.dark.erase(L);
  }

  tick(dt: number): void {
    const r = Math.min(3, Math.floor(this.elapsed / ROUND));
    if (r !== this.round) this.startRound(r);
    this.grace = Math.max(0, this.grace - dt);
    this.flicker = Math.max(0, this.flicker - dt);
    const s = this.kit.body(this.seeker)!;
    // flashlight follows movement (smoothed)
    if (!this.isCpu(this.seeker) && s.stick && Math.hypot(s.stick.vx, s.stick.vy) > 0.25) this.turnTo(Math.atan2(s.stick.vy, s.stick.vx), dt, 7);
    // desks: who is hiding where
    for (const d of this.desks) { d.occupant = -1; d.rattle = Math.max(0, d.rattle - dt); }
    for (const b of this.kit.bodies) {
      const h = this.hs[b.p];
      if (b.p === this.seeker) { h.hidden = false; h.desk = null; continue; }
      const d = this.deskAt(b.x, b.y);
      if (d && d.occupant === -1 && h.frozen <= 0) {
        d.occupant = b.p;
        if (h.desk !== d) h.hideT = 0;
        h.desk = d;
        h.hideT += dt;
        h.hidden = h.hideT < RUSTLE_AFTER;
        if (!h.hidden) {
          // stayed too long: the desk rattles and gives them away
          d.rattle = 0.2;
          if (Math.random() < dt * 6) { burst(this, d.x + d.w / 2, d.y + 4, { tex: 'dot2', count: 3, tint: [0xffe066, 0xffffff], speed: [30, 70], angle: [220, 320], life: 300, depth: 2600 }); Audio.sfx('tick', 0.6); }
        }
      } else { h.hidden = false; h.desk = null; h.hideT = Math.max(0, h.hideT - dt * 2); }
    }
    for (const d of this.desks) d.img.setX(d.x + d.w / 2 + (d.rattle > 0 ? Math.sin(this.time.now / 25) * 2 : 0));
    // light & catches
    for (const b of this.kit.bodies) {
      if (b.p === this.seeker) continue;
      const h = this.hs[b.p];
      h.frozen = Math.max(0, h.frozen - dt);
      h.immune = Math.max(0, h.immune - dt);
      if (h.frozen > 0) { b.speedMul = 0; b.stun = Math.max(b.stun, 0.1); if (h.frozen <= dt) this.thaw(b); continue; }
      b.speedMul = 1;
      const lit = this.grace <= 0 && h.immune <= 0 && this.isLit(s, b);
      if (lit) {
        h.expose += dt;
        if (h.expose >= EXPOSE) this.caught(b, s);
      } else {
        h.expose = Math.max(0, h.expose - dt * 1.5);
        // unseen in the dark: score
        const brave = Math.hypot(b.x - s.x, b.y - s.y) < BRAVE_R && this.grace <= 0;
        h.pts += dt * (brave ? 2 : 1);
        if (h.pts >= 1) {
          h.pts -= 1;
          this.addScore(b.p, 1);
          if (brave && Math.random() < 0.5) this.pop(b.x + 14, b.y - 60, 'x2', toCss(PLAYER_COLORS[b.p].light), 11, this.angleFor(b.p));
        }
      }
    }
    for (const b of this.kit.bodies) if (this.isCpu(b.p)) { if (b.p === this.seeker) this.botSeek(b, dt); else this.botHide(b, s, dt); }
  }

  private turnTo(target: number, dt: number, rate: number): void {
    let d = target - this.ang;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.ang += d * Math.min(1, dt * rate);
  }

  private tryTag(b: ArenaBody): void {
    const h = this.hs[b.p];
    if (b.p === this.seeker || h.frozen > 0 || h.immune > 0) return;
    this.caught(b, this.kit.body(this.seeker)!);
  }

  private caught(b: ArenaBody, s: ArenaBody): void {
    const h = this.hs[b.p];
    h.frozen = FREEZE;
    h.expose = 0;
    h.immune = FREEZE + 1.6;
    b.vx = b.vy = 0;
    b.stun = FREEZE;
    this.addScore(s.p, CATCH_PTS);
    const loss = Math.min(CAUGHT_LOSS, this.score[b.p]);
    if (loss > 0) this.addScore(b.p, -loss);
    Audio.sfx('freeze', 1 + b.p * 0.1);
    Audio.sfx('right', 1 + s.p * 0.1);
    b.avatar.sprite.setTint(0x9ee6ff);
    Vfx.sparkle(this, b.x, b.y - 30, [0xc8f0ff, 0xffffff]);
    this.pop(b.x, b.y - 92, loss > 0 ? `เจอแล้ว! -${loss}` : 'เจอแล้ว!', '#c8f0ff', 18, this.angleFor(b.p));
    this.pop(s.x, s.y - 92, `+${CATCH_PTS}`, '#ffe066', 18, this.angleFor(s.p));
    Vfx.squash(this, s.avatar.sprite, 1.2, 0.85, 160);
    s.avatar.play('cheer', true);
  }

  private thaw(b: ArenaBody): void {
    const h = this.hs[b.p];
    h.frozen = 0;
    b.stun = 0;
    b.speedMul = 1;
    b.avatar.sprite.clearTint();
    burst(this, b.x, b.y - 24, { tex: 'dot3', count: 10, tint: [0xc8f0ff, 0xffffff], speed: [50, 120], life: 360, depth: 2600 });
    Audio.sfx('pop', 1.4);
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private botSeek(b: ArenaBody, dt: number): void {
    b.data.think -= dt;
    b.data.sweep += dt;
    const targets = this.kit.bodies.filter((o) => o.p !== this.seeker && this.hs[o.p].frozen <= 0 && this.hs[o.p].immune <= 0);
    if (b.data.think <= 0) {
      b.data.think = 0.9 + Math.random() * 0.8;
      // a noisy guess of where somebody is (the CPU doesn't see perfectly in the dark)
      let best: ArenaBody | undefined, bd = 1e9;
      for (const o of targets) {
        const d = Math.hypot(o.x - b.x, o.y - b.y) * (0.7 + Math.random() * 0.6);
        if (d < bd) { bd = d; best = o; }
      }
      const noise = 90 * (1 - b.data.skill) + 30;
      if (best) { b.data.gx = best.x + (Math.random() - 0.5) * noise * 2; b.data.gy = best.y + (Math.random() - 0.5) * noise * 2; }
      else { b.data.gx = this.field.x + 40 + Math.random() * (this.field.width - 80); b.data.gy = this.field.y + 40 + Math.random() * (this.field.height - 80); }
      b.data.gx = Phaser.Math.Clamp(b.data.gx, this.field.x + 20, this.field.right - 20);
      b.data.gy = Phaser.Math.Clamp(b.data.gy, this.field.y + 20, this.field.bottom - 20);
    }
    b.botTarget = { x: b.data.gx, y: b.data.gy };
    // aim: toward the guess, sweeping side to side; follow movement when far
    const dx = b.data.gx - b.x, dy = b.data.gy - b.y;
    const base = Math.hypot(dx, dy) > 20 ? Math.atan2(dy, dx) : this.ang;
    this.turnTo(base + Math.sin(b.data.sweep * 2.6) * 0.55, dt, 4 + b.data.skill * 3);
    // notice someone in the light: chase them
    for (const o of targets) if (this.hs[o.p].expose > 0) { b.botTarget = { x: o.x, y: o.y }; this.turnTo(Math.atan2(o.y - 14 - (b.y - 14), o.x - b.x), dt, 6); }
  }

  private botHide(b: ArenaBody, s: ArenaBody, dt: number): void {
    const h = this.hs[b.p];
    if (h.frozen > 0) return;
    b.data.think -= dt;
    const ds = Math.hypot(s.x - b.x, s.y - b.y);
    let da = Math.atan2(b.y - s.y, b.x - s.x) - this.ang;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const danger = (ds < CONE_LEN + 30 && Math.abs(da) < CONE_HALF + 0.5) || ds < 110 || h.expose > 0;
    const restless = h.desk && h.hideT > RUSTLE_AFTER - 0.6 - Math.random() * 0.8;
    if (b.data.think <= 0 || (danger && b.data.think < 0.3 && Math.random() < b.data.skill * 0.25) || restless) {
      b.data.think = 0.8 + Math.random() * 1.2;
      // score candidate spots: far from the seeker, out of its beam, desks preferred
      let best = -1e9;
      const cands: { x: number; y: number; desk: boolean }[] = this.desks.filter((d) => d.occupant === -1 || d.occupant === b.p)
        .filter((d) => !(restless && h.desk === d)).map((d) => ({ x: d.x + d.w / 2, y: d.y + d.h / 2 + 2, desk: true }));
      for (let i = 0; i < 6; i++) cands.push({ x: this.field.x + 30 + Math.random() * (this.field.width - 60), y: this.field.y + 30 + Math.random() * (this.field.height - 60), desk: false });
      for (const c of cands) {
        const dSeek = Math.hypot(c.x - s.x, c.y - s.y);
        const dMe = Math.hypot(c.x - b.x, c.y - b.y);
        let a = Math.atan2(c.y - s.y, c.x - s.x) - this.ang;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        const inBeam = Math.abs(a) < CONE_HALF + 0.3 && dSeek < CONE_LEN + 40;
        const behind = this.segBlocked(s.x, s.y - 14, c.x, c.y - 14);
        const sc = dSeek * 1.0 - dMe * 0.55 + (c.desk ? 60 : 0) + (behind ? 80 : 0) - (inBeam ? 220 : 0) + Math.random() * 40;
        if (sc > best) { best = sc; b.data.tx = c.x; b.data.ty = c.y; }
      }
    }
    b.botTarget = { x: b.data.tx, y: b.data.ty };
    // sloppy CPUs sometimes freeze in place when the beam is on them
    if (h.expose > 0 && Math.random() < (1 - b.data.skill) * 0.04) b.botTarget = { x: b.x, y: b.y };
  }

  shutdown(): void {
    this.kit?.destroy();
    this.light?.destroy();
  }
}

import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng, type Painter } from '../../art/Painter';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Avatar, playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { SplitKit } from '../kit/SplitKit';

/** View-local surfaces (world units inside a player's 240-tall view). */
const CEIL = 44;
const FLOOR = 196;
/** Sprite origin (body centre) → feet distance. */
const BODY = 24;
const GRAV = 2600;
const START_X = 90;
const COURSE = 17500;
const HALF_W = 9;
const HALF_H = 18;
const PX_PER_M = 16;

type Side = 1 | -1; // 1 = gravity down (floor), -1 = gravity up (ceiling)

interface Ob { x: number; w: number; h: number; side: Side; kind: number }
interface Pad { x: number; w: number; side: Side }

interface Runner {
  p: PlayerIndex;
  av: Avatar;
  spr: Phaser.GameObjects.Sprite;
  mark: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  x: number;
  cy: number;
  vy: number;
  side: Side;
  grounded: boolean;
  fromCy: number;
  flippedX: boolean;
  speedMul: number;
  stun: number;
  inv: number;
  boost: number;
  buffer: number;
  hits: Set<number>;
  pads: Set<number>;
  obImgs: Phaser.GameObjects.Image[];
  far: Phaser.GameObjects.TileSprite;
  wall: Phaser.GameObjects.TileSprite;
  floor: Phaser.GameObjects.TileSprite;
  ceil: Phaser.GameObjects.TileSprite;
  ceilGlow: Phaser.GameObjects.TileSprite;
  glowF: Phaser.GameObjects.TileSprite;
  glowC: Phaser.GameObjects.TileSprite;
  dust: Phaser.GameObjects.Particles.ParticleEmitter;
  ghosts: { q: PlayerIndex; s: Phaser.GameObjects.Sprite; m: Phaser.GameObjects.Image }[];
  cpuPlan: number;
  cpuAt: number;
  cpuSkill: number;
  trailT: number;
}

/** #45 — Side-view auto-runner: tap to flip gravity between floor and ceiling. */
export default class GravitySwitch extends BaseMinigame {
  private split!: SplitKit;
  private runners: Runner[] = [];
  private obs: Ob[] = [];
  private pads: Pad[] = [];
  private t = 0;

  constructor() {
    super(CATALOG['gravity-switch']);
  }

  setup(): void {
    this.runners = [];
    this.t = 0;
    this.split = new SplitKit(this);
    this.buildCourse();
    this.paintArt();
    for (const p of this.players) this.makeTrack(p);
    for (const r of this.runners) {
      for (const q of this.players) {
        if (q === r.p) continue;
        const o = this.runners.find((x) => x.p === q)!;
        const y0 = this.split.offsetY(r.p);
        const s = this.add.sprite(START_X, y0 + FLOOR - BODY, o.av.key, 0).setOrigin(0.5, 0.62).setScale(S).setAlpha(0.3).setDepth(y0 + 40);
        const m = this.add.image(START_X, y0, playerMarkerKey(this, q)).setScale(S * 0.7).setAlpha(0.55).setDepth(y0 + 41);
        r.ghosts.push({ q, s, m });
      }
    }
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) if (!this.players.includes(p)) this.split.cams[p].setVisible(false);
    this.touch.on('down', (t: { player: PlayerIndex }) => {
      const r = this.runners.find((x) => x.p === t.player);
      if (!r || this.isCpu(r.p) || this.state !== 'play') return;
      this.flip(r);
    });
  }

  // ───────────────────────────── course ─────────────────────────────

  private buildCourse(): void {
    const r = rng(4545);
    this.obs = [];
    this.pads = [];
    let x = 720;
    let last: Side = 1;
    while (x < COURSE - 300) {
      const v = Math.min(325, 205 + (x - START_X) * 0.0105);
      // Same side as last obstacle more often early on (gentler), zig-zags later.
      const zig = r() < 0.45 + Math.min(0.3, x / 30000);
      const side: Side = zig ? (last === 1 ? -1 : 1) : r() < 0.5 ? 1 : -1;
      const kind = Math.floor(r() * 3);
      const w = side === 1 ? [44, 36, 46][kind] : [40, 36, 26][kind];
      const h = side === 1 ? [56, 52, 54][kind] : [56, 52, 64][kind];
      this.obs.push({ x, w, h, side, kind });
      // gap needed to switch sides comfortably at this speed
      const need = side !== last ? v * 0.55 + 50 : v * 0.35 + 40;
      const gap = need + v * (0.25 + r() * 0.75);
      if (r() < 0.28 && gap > 200) this.pads.push({ x: x + gap * 0.5, w: 56, side: r() < 0.5 ? 1 : -1 });
      last = side;
      x += gap + w;
    }
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    makeTexture(this, 'gravity-space', 256, 120, (p) => {
      p.gradient(0, 0, 256, 120, [0x0b0a22, 0x181245, 0x2a1b5e, 0x1a1240]);
      const r = rng(9);
      for (let i = 0; i < 7; i++) {
        const cx = r() * 256, cy = 20 + r() * 80;
        p.ellipse(cx, cy, 26 + r() * 20, 10 + r() * 8, i % 2 ? 0x6a3fa0 : 0x2f6fb0, 40);
      }
      for (let i = 0; i < 140; i++) {
        const c = [0xffffff, 0xbfe3ff, 0xffe9a8, 0xd9c8ff][Math.floor(r() * 4)];
        p.px(Math.floor(r() * 256), Math.floor(r() * 120), c, 120 + Math.floor(r() * 135));
      }
      for (let i = 0; i < 8; i++) {
        const sx = Math.floor(r() * 250) + 3, sy = Math.floor(r() * 110) + 3;
        p.px(sx, sy, 0xffffff); p.px(sx - 1, sy, 0xbfe3ff); p.px(sx + 1, sy, 0xbfe3ff); p.px(sx, sy - 1, 0xbfe3ff); p.px(sx, sy + 1, 0xbfe3ff);
      }
      // ringed planet + moon
      p.ellipse(196, 58, 34, 7, 0xffd9a0, 90);
      p.ball(196, 56, 20, 20, 0xff9f6a);
      for (let y = 40; y < 74; y += 6) p.hline(180, y, 32, 0xe8774a, 90);
      for (let a = 0; a < Math.PI * 2; a += 0.02) {
        const x = 196 + Math.cos(a) * 33, y = 58 + Math.sin(a) * 6;
        if (Math.sin(a) > -0.1 || Math.abs(x - 196) > 20) p.px(x, y, 0xffe3b8);
      }
      p.ball(58, 26, 7, 7, 0xc7c9d6);
      p.px(56, 25, 0x9aa0b8); p.px(60, 28, 0x9aa0b8);
    });

    makeTexture(this, 'gravity-wall', 160, 76, (p) => {
      const base = 0xa9b6d0;
      p.rect(0, 0, 160, 76, base);
      p.dither(0, 8, 160, 56, base, shift(base, -0.08), 0.25);
      // trims
      p.rect(0, 0, 160, 6, 0x56618a); p.hline(0, 5, 160, 0x7d8ab2);
      p.rect(0, 66, 160, 10, 0x4b557c); p.hline(0, 66, 160, 0x8a97bf); p.hline(0, 70, 160, 0x3fe0e0);
      for (let x = 0; x < 160; x += 40) { p.vline(x, 6, 60, shift(base, -0.3)); p.vline(x + 1, 6, 60, shift(base, 0.3)); }
      // window to space
      const wx = 6, wy = 12, ww = 50, wh = 34;
      p.box(wx - 3, wy - 3, ww + 6, wh + 6, 0x4b557c, 2);
      for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
        const corner = (x < 2 && y < 2) || (x > ww - 3 && y < 2) || (x < 2 && y > wh - 3) || (x > ww - 3 && y > wh - 3);
        if (!corner) p.clear(wx + x, wy + y);
      }
      for (let i = 0; i < 18; i++) { p.px(wx + 6 + i, wy + 26 - i, 0xffffff, 40); p.px(wx + 7 + i, wy + 26 - i, 0xffffff, 40); }
      for (let i = 0; i < 8; i++) p.px(wx + 22 + i, wy + 20 - i, 0xffffff, 30);
      p.vline(wx + ww / 2, wy, wh, 0x4b557c);
      // lockers (school!)
      const lc = [0xff7a85, 0x6ec6ff, 0x7ee8b0, 0xffe066];
      for (let i = 0; i < 4; i++) {
        const lx = 66 + i * 13;
        p.box(lx, 14, 12, 52, lc[i]);
        for (let v = 0; v < 3; v++) p.hline(lx + 3, 18 + v * 2, 6, shift(lc[i], -0.4));
        p.rect(lx + 9, 38, 1, 5, 0x3b4466);
        p.hline(lx + 1, 64, 10, shift(lc[i], -0.45));
      }
      // poster: rocket drawing
      p.box(122, 13, 22, 28, 0xfff8e7);
      p.rect(132, 18, 3, 14, 0xff5a6e); p.tri(130, 18, 137, 18, 133.5, 14, 0xff5a6e);
      p.px(133, 22, 0x6ec6ff); p.tri(129, 32, 132, 28, 132, 32, 0x3d9bff); p.tri(135, 28, 138, 32, 135, 32, 0x3d9bff);
      p.px(133, 34, 0xffc93d); p.px(133, 35, 0xff9f43);
      for (let i = 0; i < 5; i++) p.px(125 + i * 4, 38, 0x8a8fb8);
      p.px(132, 12, 0xd94a4a);
      // control panel with lights
      p.box(148, 20, 10, 18, 0x56618a);
      p.px(150, 23, 0x7ee8b0); p.px(153, 23, 0xff7a85); p.px(150, 27, 0xffe066); p.px(153, 27, 0x6ec6ff);
      p.rect(150, 31, 6, 4, 0x1b1f3b); p.hline(151, 32, 3, 0x3fe0e0);
    });

    const floorTile = (p: Painter, ceil: boolean) => {
      const plate = 0x5b6585;
      const y = (v: number) => (ceil ? 21 - v : v);
      for (let j = 0; j < 22; j++) p.hline(0, y(j), 32, plate);
      p.hline(0, y(0), 32, 0x3fe0e0);
      p.hline(0, y(1), 32, 0xdfe8f5);
      for (let x = 0; x < 32; x++) for (let j = 2; j < 5; j++) p.px(x, y(j), ((x + j) >> 2) % 2 ? 0x2b2f45 : 0xffc93d);
      p.hline(0, y(5), 32, 0x3b4466);
      for (let j = 6; j < 22; j++) { p.px(0, y(j), shift(plate, 0.3)); p.px(31, y(j), shift(plate, -0.35)); }
      p.hline(0, y(6), 32, shift(plate, 0.3));
      p.hline(0, y(21), 32, shift(plate, -0.4));
      p.px(3, y(8), 0x8a97bf); p.px(28, y(8), 0x8a97bf); p.px(3, y(19), 0x3b4466); p.px(28, y(19), 0x3b4466);
      if (!ceil) { p.hline(6, y(13), 20, shift(plate, -0.2)); p.hline(6, y(15), 20, shift(plate, -0.2)); }
      else { p.rect(9, y(12), 14, 4, 0x3b4466); p.rect(10, y(11), 12, 2, 0xcfe8ff); }
    };
    makeTexture(this, 'gravity-floor', 32, 22, (p) => floorTile(p, false));
    makeTexture(this, 'gravity-ceil', 32, 22, (p) => floorTile(p, true));
    makeTexture(this, 'gravity-ceilglow', 32, 22, (p) => {
      p.rect(10, 9, 12, 2, 0xffffff);
      p.rect(8, 8, 16, 1, 0xbfe3ff, 120);
      p.rect(8, 11, 16, 1, 0xbfe3ff, 120);
    });
    makeTexture(this, 'gravity-glow', 16, 6, (p) => {
      for (let j = 0; j < 6; j++) p.hline(0, j, 16, 0x3fe0e0, [200, 140, 90, 55, 30, 12][j]);
    });

    // floor obstacles
    makeTexture(this, 'gravity-ob-f0', 22, 28, (p) => {
      // two stacked cargo crates
      p.box(1, 14, 20, 14, 0xe08a3c);
      p.box(3, 1, 16, 13, 0xd9a03c);
      for (const [x, y, w, h] of [[1, 14, 20, 14], [3, 1, 16, 13]]) {
        p.rect(x, y, 3, 3, 0x8a97bf); p.rect(x + w - 3, y, 3, 3, 0x8a97bf);
        p.rect(x, y + h - 3, 3, 3, 0x56618a); p.rect(x + w - 3, y + h - 3, 3, 3, 0x56618a);
      }
      for (let i = 0; i < 6; i++) p.px(6 + i * 2, 20 + (i % 2), i % 2 ? 0x2b2f45 : 0xffc93d);
      p.line(5, 4, 15, 11, shift(0xd9a03c, -0.3));
      p.outline(-0.7);
    });
    makeTexture(this, 'gravity-ob-f1', 18, 26, (p) => {
      // cleaning robot
      p.ball(9, 9, 7, 7, 0x6ec6ff);
      p.px(6, 6, 0xffffff); p.px(7, 5, 0xffffff);
      p.box(2, 11, 14, 12, 0xc7c9d6);
      p.rect(5, 14, 8, 3, 0x1b1f3b); p.rect(7, 15, 2, 1, 0xff5a6e); p.rect(10, 15, 1, 1, 0xff5a6e);
      p.hline(3, 20, 12, 0xffc93d);
      p.ball(5, 23, 2.6, 2.6, 0x3b4466); p.ball(13, 23, 2.6, 2.6, 0x3b4466);
      p.vline(9, 0, 3, 0x8a97bf); p.px(9, 0, 0xff5a6e);
      p.outline(-0.7);
    });
    makeTexture(this, 'gravity-ob-f2', 24, 27, (p) => {
      // pile of school desks & chair
      p.rect(2, 12, 2, 15, 0x8a97bf); p.rect(20, 12, 2, 15, 0x8a97bf);
      p.box(0, 9, 24, 4, 0xd49a58);
      p.box(3, 13, 18, 5, 0xb97a3e);
      p.rect(6, 0, 2, 9, 0x8a97bf); p.rect(16, 3, 2, 6, 0x8a97bf);
      p.box(4, 2, 14, 3, 0xd49a58);
      p.box(4, 18, 6, 9, 0x6ec6ff);
      p.px(5, 19, 0xbfe3ff);
      p.outline(-0.7);
    });
    // ceiling obstacles (hang from the top)
    makeTexture(this, 'gravity-ob-c0', 20, 28, (p) => {
      p.rect(3, 0, 5, 24, 0x8a97bf); p.vline(3, 0, 24, 0xc7c9d6);
      p.rect(12, 0, 5, 18, 0x7d8ab2); p.vline(12, 0, 18, 0xb7c3d9);
      p.box(1, 22, 9, 4, 0x56618a); p.box(10, 16, 9, 4, 0x56618a);
      p.ring(5.5, 13, 4, 0xff5a6e, 2); p.px(5, 13, 0xff5a6e);
      p.rect(4, 26, 3, 2, 0x3b4466); p.rect(13, 20, 3, 2, 0x3b4466);
      p.outline(-0.7);
    });
    makeTexture(this, 'gravity-ob-c1', 18, 26, (p) => {
      p.vline(9, 0, 12, 0x3b4466);
      p.rect(7, 10, 4, 3, 0x56618a);
      p.tri(1, 22, 17, 22, 9, 12, 0xffc93d);
      p.tri(3, 22, 9, 13, 9, 22, 0xffe066);
      p.hline(1, 22, 17, 0xb3861a);
      p.ellipse(9, 23, 5, 2, 0xfff8e7);
      p.outline(-0.7);
      for (let j = 0; j < 2; j++) p.hline(4 - j, 24 + j, 10 + j * 2, 0xfff1a8, 90);
    });
    makeSheet(this, 'gravity-ob-c2', 14, 32, 2, (p, i) => {
      p.box(1, 0, 12, 6, 0x56618a);
      p.rect(4, 6, 6, 2, 0x3b4466);
      p.px(3, 2, i ? 0xff5a6e : 0x7a2a3a);
      const core = i ? 0xffffff : 0xffd0d8;
      p.rect(5, 8, 4, 24, 0xff3d5a);
      p.rect(6, 8, 2, 24, core);
      for (let y = 8; y < 32; y += 3) p.px(i ? 4 : 9, y + (i ? 1 : 0), 0xff9fae);
    });
    makeSheet(this, 'gravity-pad', 28, 4, 2, (p, i) => {
      p.box(0, 1, 28, 3, 0x2b3263);
      for (let k = 0; k < 4; k++) {
        const x = 3 + k * 6 + (i ? 1 : 0);
        p.tri(x, 1, x, 4, x + 3, 2.5, k % 2 === i ? 0xffffff : 0x3fe0e0);
      }
      p.hline(0, 0, 28, 0x3fe0e0);
    });
    if (!this.anims.exists('gravity-laser')) {
      this.anims.create({ key: 'gravity-laser', frames: this.anims.generateFrameNumbers('gravity-ob-c2', {}), frameRate: 10, repeat: -1 });
      this.anims.create({ key: 'gravity-pad-go', frames: this.anims.generateFrameNumbers('gravity-pad', {}), frameRate: 8, repeat: -1 });
    }
    makeTexture(this, 'gravity-sign', 30, 11, (p) => {
      p.box(0, 0, 30, 11, 0x2b3263);
      p.ring(15, 5.5, 3, 0x3fe0e0, 1);
      p.hline(1, 1, 28, 0x3fe0e0);
      p.hline(1, 9, 28, 0x1b1f3b);
      p.outline(-0.6);
    });
  }

  // ───────────────────────────── tracks ─────────────────────────────

  private makeTrack(p: PlayerIndex): void {
    const y0 = this.split.offsetY(p);
    const vw = this.split.viewW;
    const aw = Math.ceil(vw / S) + 2;
    const far = this.add.tileSprite(0, y0, aw, 120, 'gravity-space').setOrigin(0).setScale(S).setDepth(y0 - 100);
    const wall = this.add.tileSprite(0, y0 + CEIL, aw, 76, 'gravity-wall').setOrigin(0).setScale(S).setDepth(y0 - 90);
    const floor = this.add.tileSprite(0, y0 + FLOOR, aw, 22, 'gravity-floor').setOrigin(0).setScale(S).setDepth(y0 - 80);
    const ceil = this.add.tileSprite(0, y0, aw, 22, 'gravity-ceil').setOrigin(0).setScale(S).setDepth(y0 - 80);
    const ceilGlow = this.add.tileSprite(0, y0, aw, 22, 'gravity-ceilglow').setOrigin(0).setScale(S).setDepth(y0 - 79).setBlendMode(Phaser.BlendModes.ADD);
    const glowF = this.add.tileSprite(0, y0 + FLOOR - 12, aw, 6, 'gravity-glow').setOrigin(0).setScale(S).setDepth(y0 - 78).setFlipY(true).setBlendMode(Phaser.BlendModes.ADD);
    const glowC = this.add.tileSprite(0, y0 + CEIL, aw, 6, 'gravity-glow').setOrigin(0).setScale(S).setDepth(y0 - 78).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    const dust = this.add.particles(0, y0 + CEIL + 10, 'dot2', {
      x: { min: 0, max: vw + 200 }, y: { min: 0, max: FLOOR - CEIL - 20 },
      speedX: { min: -90, max: -40 }, speedY: { min: -6, max: 6 }, lifespan: 2600, frequency: 120,
      alpha: { start: 0.5, end: 0 }, scale: { min: 0.5, max: 1 }, tint: [0xbfe3ff, 0x3fe0e0, 0xffffff],
    }).setDepth(y0 - 70);

    // obstacles & pads
    const obImgs: Phaser.GameObjects.Image[] = [];
    this.obs.forEach((o, i) => {
      if (o.side === 1) {
        obImgs[i] = this.add.image(o.x, y0 + FLOOR + 1, `gravity-ob-f${o.kind}`).setOrigin(0.5, 1).setScale(S).setDepth(y0 + 20);
      } else if (o.kind === 2) {
        const s = this.add.sprite(o.x, y0 + CEIL - 1, 'gravity-ob-c2', 0).setOrigin(0.5, 0).setScale(S).setDepth(y0 + 20);
        s.play('gravity-laser');
        obImgs[i] = s;
      } else {
        obImgs[i] = this.add.image(o.x, y0 + CEIL - 1, `gravity-ob-c${o.kind}`).setOrigin(0.5, 0).setScale(S).setDepth(y0 + 20);
      }
    });
    for (const pd of this.pads) {
      const s = this.add.sprite(pd.x, pd.side === 1 ? y0 + FLOOR + 2 : y0 + CEIL - 2, 'gravity-pad', 0).setOrigin(0.5, pd.side === 1 ? 1 : 0).setScale(S).setDepth(y0 + 10);
      s.setFlipY(pd.side === -1).play('gravity-pad-go');
    }
    // distance signs every 100 m
    for (let m = 100; m * PX_PER_M < COURSE; m += 100) {
      const sx = START_X + m * PX_PER_M;
      this.add.image(sx, y0 + CEIL + 26, 'gravity-sign').setScale(S).setDepth(y0 - 60);
      txt(this, sx, y0 + CEIL + 26, `${m} m`, { size: 11, color: '#bff8ff', strokeWidth: 3 }).setDepth(y0 - 59);
    }
    // start gate
    this.add.rectangle(START_X + 30, y0 + (CEIL + FLOOR) / 2, 4, FLOOR - CEIL, 0x3fe0e0, 0.5).setDepth(y0 - 60);

    const av = new Avatar(this, p, START_X, y0 + FLOOR, { depthSort: false, shadow: false, marker: false });
    const spr = av.sprite.setOrigin(0.5, 0.62).setDepth(y0 + 50);
    const mark = this.add.image(START_X, y0, playerMarkerKey(this, p)).setScale(S * 0.9).setDepth(y0 + 52);
    const shadow = this.add.image(START_X, y0 + FLOOR, 'shadow').setScale(S * 0.6).setAlpha(0.3).setDepth(y0 + 15);
    const r: Runner = {
      p, av, spr, mark, shadow, x: START_X, cy: FLOOR - BODY, vy: 0, side: 1, grounded: true, fromCy: FLOOR - BODY, flippedX: false,
      speedMul: 1, stun: 0, inv: 0, boost: 0, buffer: 0, hits: new Set(), pads: new Set(), obImgs, far, wall, floor, ceil, ceilGlow,
      glowF, glowC, dust, ghosts: [], cpuPlan: -1, cpuAt: 0, cpuSkill: 0.8 + Math.random() * 0.14, trailT: 0,
    };
    this.runners.push(r);
    this.syncRunner(r);
  }

  // ───────────────────────────── gameplay ─────────────────────────────

  private baseSpeed(): number {
    return 205 + 115 * Math.min(1, this.elapsed / 45);
  }

  private speedOf(r: Runner): number {
    return this.baseSpeed() * r.speedMul * (r.boost > 0 ? 1.35 : 1);
  }

  private flip(r: Runner): void {
    if (this.state !== 'play') return;
    if (!r.grounded) { r.buffer = 0.14; return; }
    r.side = (r.side === 1 ? -1 : 1) as Side;
    r.grounded = false;
    r.fromCy = r.cy;
    r.vy = -r.side * 60; // small pop off the surface
    r.buffer = 0;
    Audio.sfx('whoosh', 1 + r.p * 0.1);
    Audio.sfx('jump', 0.8 + r.p * 0.08);
    const y0 = this.split.offsetY(r.p);
    Vfx.dust(this, r.x, y0 + (r.side === 1 ? CEIL : FLOOR));
    burst(this, r.x, y0 + r.cy, { tex: 'spark', count: 6, tint: [0x3fe0e0, 0xffffff], speed: [40, 110], life: 300, depth: y0 + 60 });
  }

  private target(side: Side): number {
    return side === 1 ? FLOOR - BODY : CEIL + BODY;
  }

  ambient(dt: number): void {
    this.t += dt;
    for (const r of this.runners) this.syncRunner(r);
  }

  tick(dt: number): void {
    for (const r of this.runners) {
      if (this.isCpu(r.p)) this.bot(r);
      this.step(r, dt);
      this.hudText[r.p] = `${Math.max(0, Math.floor((r.x - START_X) / PX_PER_M))} m`;
    }
  }

  private step(r: Runner, dt: number): void {
    const y0 = this.split.offsetY(r.p);
    r.stun = Math.max(0, r.stun - dt);
    r.inv = Math.max(0, r.inv - dt);
    r.boost = Math.max(0, r.boost - dt);
    if (r.stun <= 0) r.speedMul += (1 - r.speedMul) * Math.min(1, dt * 1.5);
    if (r.buffer > 0) r.buffer -= dt;
    const prevX = r.x;
    r.x += this.speedOf(r) * dt;

    if (!r.grounded) {
      r.vy += GRAV * r.side * dt;
      r.cy += r.vy * dt;
      const tgt = this.target(r.side);
      if ((r.side === 1 && r.cy >= tgt) || (r.side === -1 && r.cy <= tgt)) {
        r.cy = tgt;
        r.vy = 0;
        r.grounded = true;
        Audio.sfx('land', 1 + r.p * 0.1);
        Vfx.dust(this, r.x, y0 + (r.side === 1 ? FLOOR : CEIL));
        Vfx.squash(this, r.spr, 1.25, 0.8, 160);
        if (r.buffer > 0) this.flip(r);
      }
    }

    // obstacles
    const top = r.cy - HALF_H, bot = r.cy + HALF_H;
    for (let i = 0; i < this.obs.length; i++) {
      const o = this.obs[i];
      if (o.x - o.w / 2 > r.x + 40) break;
      if (o.x + o.w / 2 < prevX - 30 || r.hits.has(i)) continue;
      const oTop = o.side === 1 ? FLOOR - o.h : CEIL;
      const oBot = o.side === 1 ? FLOOR : CEIL + o.h;
      const overlapX = r.x + HALF_W > o.x - o.w / 2 + 4 && r.x - HALF_W < o.x + o.w / 2 - 4;
      if (!overlapX || bot < oTop + 4 || top > oBot - 4) continue;
      r.hits.add(i);
      if (r.inv > 0) continue;
      this.crash(r, i);
    }
    // boost pads
    if (r.grounded) {
      this.pads.forEach((pd, i) => {
        if (r.pads.has(i) || pd.side !== r.side || Math.abs(pd.x - r.x) > pd.w / 2) return;
        r.pads.add(i);
        r.boost = 1.3;
        Audio.sfx('power', 1 + r.p * 0.08);
        Vfx.speedLines(this, r.x + 10, y0 + r.cy, 180, 0x3fe0e0);
        Vfx.popText(this, r.x + 20, y0 + (CEIL + FLOOR) / 2, 'BOOST!', '#7ff6ff', 16, 0);
      });
    }
    if (r.boost > 0) {
      r.trailT -= dt;
      if (r.trailT <= 0) {
        r.trailT = 0.05;
        Vfx.speedLines(this, r.x - 16, y0 + r.cy + (Math.random() - 0.5) * 30, 0, 0x7ff6ff);
      }
    }
  }

  private crash(r: Runner, i: number): void {
    const y0 = this.split.offsetY(r.p);
    const o = this.obs[i];
    r.speedMul = 0.28;
    r.stun = 0.5;
    r.inv = 1.1;
    r.boost = 0;
    Audio.sfx('hit', 1 + r.p * 0.1);
    Audio.sfx('stun', 1);
    const hy = o.side === 1 ? FLOOR - o.h / 2 : CEIL + o.h / 2;
    Vfx.hit(this, o.x - o.w / 2, y0 + hy);
    Vfx.hitFlash(this, r.spr);
    burst(this, o.x, y0 + hy, { tex: 'dot3', count: 10, tint: [0xffc93d, 0xc7c9d6, 0xffffff], speed: [60, 180], gravity: 500 * o.side, life: 500, depth: y0 + 60 });
    Vfx.popText(this, r.x, y0 + (CEIL + FLOOR) / 2, 'โอ๊ย!', '#ff9fae', 18, 0);
    for (const c of [this.split.cams[r.p]]) c.shake(140, 0.008);
    const img = r.obImgs[i];
    if (img) {
      this.tweens.add({
        targets: img, x: img.x + 60, angle: o.side === 1 ? 70 : -70, alpha: 0.4,
        duration: 380, ease: 'Quad.easeOut',
      });
    }
  }

  private syncRunner(r: Runner): void {
    const y0 = this.split.offsetY(r.p);
    const spr = r.spr;
    // orientation: front-flip between surfaces
    let angle: number;
    let flipX: boolean;
    if (r.grounded) {
      angle = r.side === 1 ? 0 : 180;
      flipX = r.side === -1;
    } else {
      const from = r.fromCy, to = this.target(r.side);
      const k = Phaser.Math.Clamp((r.cy - from) / (to - from || 1), 0, 1);
      const e = 1 - (1 - k) * (1 - k);
      angle = (r.side === -1 ? 0 : 180) + 180 * e;
      flipX = r.side === -1 ? e >= 0.5 : e < 0.5;
    }
    spr.setAngle(angle).setFlipX(flipX);
    spr.setPosition(r.x, y0 + r.cy);
    const blink = r.inv > 0 && Math.floor(r.inv * 16) % 2 === 0;
    spr.setAlpha(blink ? 0.45 : 1);
    if (this.state === 'end') r.av.play('win');
    else if (r.stun > 0) r.av.play('hit');
    else if (!r.grounded) r.av.play('jump');
    else if (this.state === 'play') r.av.play('run');
    else r.av.play('idle');
    spr.anims.timeScale = r.av.anim === 'run' ? 0.6 + this.speedOf(r) / 320 : 1;
    // marker sits on the "up" side of the body
    const up = r.grounded ? r.side : r.vy >= 0 ? 1 : -1;
    r.mark.setPosition(r.x, y0 + r.cy - up * 46 + Math.sin(this.t * 4.5) * 2).setFlipY(false);
    // contact shadow on the target surface
    const surf = r.side === 1 ? FLOOR : CEIL;
    const dist = Math.abs(r.cy - this.target(r.side));
    r.shadow.setPosition(r.x, y0 + surf + (r.side === 1 ? -1 : 1)).setScale(S * 0.6 * Math.max(0.3, 1 - dist / 120), S * 0.6).setAlpha(0.3 * Math.max(0.3, 1 - dist / 120));

    // camera + parallax
    const camX = r.x + this.split.viewW * 0.24;
    this.split.look(r.p, camX, y0 + this.split.viewH / 2);
    const left = camX - this.split.viewW / 2 - S;
    for (const ts of [r.far, r.wall, r.floor, r.ceil, r.ceilGlow, r.glowF, r.glowC]) ts.x = left;
    r.far.tilePositionX = (left * 0.08) / S + this.t * 1.5;
    r.wall.tilePositionX = (left * 0.7) / S;
    r.floor.tilePositionX = r.ceil.tilePositionX = r.ceilGlow.tilePositionX = left / S;
    r.glowF.tilePositionX = r.glowC.tilePositionX = left / S;
    r.ceilGlow.setAlpha(0.55 + Math.sin(this.t * 6 + r.p) * 0.25 + (Math.sin(this.t * 23) > 0.96 ? -0.4 : 0));
    const gf = r.side === 1 ? 1 : 0;
    r.glowF.setAlpha(Phaser.Math.Linear(r.glowF.alpha, gf * (0.7 + Math.sin(this.t * 5) * 0.2), 0.2));
    r.glowC.setAlpha(Phaser.Math.Linear(r.glowC.alpha, (1 - gf) * (0.7 + Math.sin(this.t * 5) * 0.2), 0.2));
    r.dust.setX(left);
    // ghosts of rivals
    for (const g of r.ghosts) {
      const o = this.runners.find((x) => x.p === g.q);
      if (!o) continue;
      g.s.setPosition(o.x, y0 + o.cy).setAngle(o.spr.angle).setFlipX(o.spr.flipX);
      g.s.setFrame(o.spr.frame.name);
      const oup = o.grounded ? o.side : o.vy >= 0 ? 1 : -1;
      g.m.setPosition(o.x, y0 + o.cy - oup * 44);
      const vis = Math.abs(o.x - r.x) > 6;
      g.s.setVisible(vis); g.m.setVisible(vis);
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(r: Runner): void {
    if (!r.grounded) return;
    const v = this.speedOf(r);
    const ahead = (side: Side, range: number) =>
      this.obs.findIndex((o, i) => o.side === side && !r.hits.has(i) && o.x + o.w / 2 > r.x - HALF_W && o.x - o.w / 2 < r.x + range);
    const i = ahead(r.side, 420);
    if (i < 0) {
      // nothing ahead on my side: sometimes go for a boost pad on the other side
      const pad = this.pads.findIndex((pd, k) => !r.pads.has(k) && pd.side !== r.side && pd.x > r.x + v * 0.3 && pd.x < r.x + v * 0.6);
      if (pad >= 0 && ahead(-r.side as Side, v * 0.9) < 0 && Math.random() < 0.05) this.flip(r);
      return;
    }
    const o = this.obs[i];
    if (r.cpuPlan !== i) {
      r.cpuPlan = i;
      const late = Math.random() > r.cpuSkill;
      r.cpuAt = late ? v * (0.02 + Math.random() * 0.08) : v * (0.24 + Math.random() * 0.24) + 14;
    }
    const d = o.x - o.w / 2 - (r.x + HALF_W);
    if (d < r.cpuAt) {
      // don't flip straight into something on the other side
      const j = ahead(-r.side as Side, v * 0.42 + 30);
      if (j < 0 || Math.random() > r.cpuSkill + 0.1) this.flip(r);
    }
  }

  results(): PlayerResult[] {
    const m = (p: PlayerIndex) => {
      const r = this.runners.find((x) => x.p === p);
      return r ? Math.floor((r.x - START_X) / PX_PER_M) : 0;
    };
    return rankBy(this.players, m);
  }
}

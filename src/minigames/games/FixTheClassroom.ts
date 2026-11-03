import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import type { TrackedTouch } from '../../systems/input/MultiTouchManager';
import { zonePoint } from '../../ui/Controls';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';

const ID = 'fix-the-classroom';
const WALL = 18;
const BIN_R = 30;
const RUB_NEED = 520;
const HOLD_NEED = 1.3;
const TAPS_NEED = 5;
const MAX_PER_ZONE = 5;

type Kind = 'stain' | 'trash' | 'desk' | 'dust';

interface Mess {
  id: number;
  kind: Kind;
  zone: PlayerIndex;
  x: number;
  y: number;
  vx: number;
  vy: number;
  prog: number;
  img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  shadow?: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Image;
  held?: number;
  thrownBy?: PlayerIndex;
  flying: boolean;
  done: boolean;
  spin: number;
  rubSfx: number;
  age: number;
}

interface Finger { mess?: Mess; lx: number; ly: number; hist: { x: number; y: number; t: number }[] }

interface Cpu {
  hand: Phaser.GameObjects.Image;
  x: number;
  y: number;
  target?: Mess;
  think: number;
  act: number;
  phase: number;
  skill: number;
  tapT: number;
}

/** #30 — Co-op: clean the whole classroom before the teacher walks in. */
export default class FixTheClassroom extends BaseMinigame {
  private messes: Mess[] = [];
  private fingers = new Map<number, Finger>();
  private cpus = new Map<PlayerIndex, Cpu>();
  private spawnT: number[] = [0, 0, 0, 0];
  private seq: number[] = [0, 0, 0, 0];
  private fixes = [0, 0, 0, 0];
  private need = 40;
  private done = 0;
  private shown = 0;
  private nextId = 0;
  private cx = 0;
  private cy = 0;
  private bin!: Phaser.GameObjects.Image;
  private bars: { fill: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; teacher: Phaser.GameObjects.Image; x0: number; w: number; deg: number }[] = [];
  private success = false;
  private endT = -1;
  private milestone = 0;
  private motes: { img: Phaser.GameObjects.Image; x: number; y: number; ph: number }[] = [];
  private beams: Phaser.GameObjects.Image[] = [];
  private plane?: { img: Phaser.GameObjects.Image; t: number; y: number; dir: number };
  private planeT = 6;
  private clockHand!: Phaser.GameObjects.Image;
  private t = 0;

  constructor() {
    super(CATALOG[ID]);
  }

  // ───────────────────────────── setup ─────────────────────────────

  setup(): void {
    this.messes = [];
    this.fingers.clear();
    this.cpus.clear();
    this.bars = [];
    this.motes = [];
    this.beams = [];
    this.plane = undefined;
    this.planeT = 5;
    this.fixes = [0, 0, 0, 0];
    this.seq = [0, 0, 0, 0];
    this.spawnT = [0.6, 0.6, 0.6, 0.6];
    this.done = 0;
    this.shown = 0;
    this.nextId = 0;
    this.success = false;
    this.endT = -1;
    this.milestone = 0;
    this.t = 0;
    this.cx = this.vw / 2;
    this.cy = this.vh / 2;
    this.need = Math.round(this.players.length * 10.5);
    this.paintTextures();
    this.paintRoom();
    this.buildMeter();
    for (const p of this.players) {
      for (let i = 0; i < 2; i++) this.spawn(p);
      if (this.isCpu(p)) {
        const z = zonePoint(this.touch, this.zoneOf(p), 0.5, 0.75);
        const hand = this.add.image(z.x, z.y, `${ID}-hand-${p}`).setScale(S).setDepth(3000).setOrigin(0.3, 0.1);
        this.cpus.set(p, { hand, x: z.x, y: z.y, think: 0.5 + Math.random() * 0.5, act: 0, phase: 0, skill: 0.45 + Math.random() * 0.45, tapT: 0 });
      }
    }
    this.touch.on('down', (t: TrackedTouch) => this.onDown(t));
    this.touch.on('up', (t: TrackedTouch) => this.onUp(t));
    this.touch.on('cancel', (t: TrackedTouch) => this.onUp(t));
  }

  private paintTextures(): void {
    // stains (3 colours)
    [0x9a4ad0, 0xff8a3d, 0x6a4a2e].forEach((c, i) => {
      makeTexture(this, `${ID}-stain${i}`, 28, 22, (p) => {
        const r = rng(10 + i);
        for (let k = 0; k < 7; k++) p.ellipse(14 + (r() - 0.5) * 12, 11 + (r() - 0.5) * 8, 4 + r() * 5, 3 + r() * 3, shift(c, -0.15));
        p.ellipse(14, 11, 9, 6, c);
        for (let k = 0; k < 4; k++) p.circle(3 + r() * 22, 2 + r() * 18, 1.4, shift(c, -0.15));
        p.ellipse(11, 8, 4, 2, shift(c, 0.4));
        p.px(9, 7, 0xffffff); p.px(10, 7, 0xffffff);
      });
    });
    // trash
    makeTexture(this, `${ID}-trash0`, 12, 12, (p) => {
      p.ball(6, 6, 5.5, 5.5, 0xf4f4f8);
      p.line(3, 4, 8, 6, 0xc9ccd8); p.line(4, 8, 9, 5, 0xc9ccd8); p.px(6, 2, 0xc9ccd8);
      p.hline(2, 6, 3, 0x9ab0d8);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-trash1`, 14, 12, (p) => {
      p.ellipse(7, 7, 3, 3, 0xffe066);
      p.stroke(6, 6, 1, 1, 2, 0xffd23d); p.stroke(8, 6, 13, 2, 2, 0xffd23d); p.stroke(7, 8, 7, 11, 2, 0xf0c030);
      p.px(1, 1, 0x7a5a2a); p.px(13, 2, 0x7a5a2a);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-trash2`, 10, 13, (p) => {
      p.box(1, 3, 8, 10, 0xffffff);
      p.tri(1, 3, 9, 3, 5, 0, 0xe8e8f0);
      p.rect(1, 6, 8, 4, 0x3d9bff);
      p.px(3, 7, 0xffffff); p.px(4, 7, 0xffffff);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-trash3`, 10, 12, (p) => {
      p.ellipse(5, 2.5, 3, 2.5, 0xff5a4a);
      p.rect(3, 4, 4, 4, 0xfff1c9);
      p.ellipse(5, 9.5, 3, 2.5, 0xff5a4a);
      p.px(5, 0, 0x6a4a2a); p.px(6, 0, 0x4fae52);
      p.outline(-0.7);
    });
    // broken → fixed desk (6 frames)
    makeSheet(this, `${ID}-desk`, 28, 22, 6, (p, i) => {
      const wood = 0xd08a4a;
      const broken = 1 - i / 5;
      const tilt = Math.round(broken * 3);
      p.rect(3, 16, 3, 5, 0x8a8f9c); p.rect(22, 16 + Math.round(broken * 2), 3, 5, 0x8a8f9c);
      p.box(1, 2, 26, 15, wood, 1);
      p.rect(3, 4, 22, 11, shift(wood, 0.1));
      for (let y = 6; y < 15; y += 3) p.hline(3, y, 22, shift(wood, -0.12));
      // loose plank
      if (i < 5) {
        p.box(15 + tilt, 3 - tilt + 3, 11, 6, shift(wood, -0.05), 1);
        p.line(16 + tilt, 7, 24 + tilt, 4, shift(wood, -0.5));
      }
      // crack
      const len = Math.round(broken * 12);
      let x = 6, y = 5;
      for (let k = 0; k < len; k++) { p.px(x, y, 0x5a3a1a); x += 1; y += k % 2 ? 1 : 0; if (y > 14) y = 14; }
      if (i >= 5) { p.px(5, 4, 0xfff6c0); p.px(6, 4, 0xfff6c0); p.hline(4, 3, 8, shift(wood, 0.5)); }
      // pencil + book
      p.box(5, 10, 6, 4, 0x6ec6ff);
      p.hline(13, 12, 6, 0xffd23d); p.px(19, 12, 0xff9fa8);
      p.outline(-0.7);
    });
    // chalk dust cloud (2 frames)
    makeSheet(this, `${ID}-dust`, 30, 24, 2, (p, i) => {
      const r = rng(4 + i);
      for (let k = 0; k < 8; k++) p.ellipse(15 + (r() - 0.5) * 16, 12 + (r() - 0.5) * 10, 5 + r() * 4, 4 + r() * 3, 0xd8dbe6);
      for (let k = 0; k < 6; k++) p.ellipse(13 + (r() - 0.5) * 12, 10 + (r() - 0.5) * 8, 3 + r() * 3, 2.5 + r() * 2, 0xf4f6fb);
      for (let k = 0; k < 5; k++) p.px(Math.floor(r() * 30), Math.floor(r() * 24), 0xffffff);
      p.rect(10 + i, 17, 6, 2, 0xffffff);
      p.px(16 + i, 17, 0xff9fa8);
    });
    // action icons (what to do), white for tinting
    const icons: Record<Kind, string[]> = {
      stain: ['a.a.a..', '.aaaaa.', 'aaaaaaa', '.aaaaa.', '..a.a..', '.......', '.......'],
      trash: ['...a...', '..aaa..', '.aaaaa.', '...a...', '...a...', '.aaaaa.', '.......'],
      desk: ['aaaa...', 'aaaa...', '.aaa...', '..aaa..', '...aaa.', '....aaa', '.....aa'],
      dust: ['..aaa..', '.aaaaa.', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..', '.......'],
    };
    for (const [k, rows] of Object.entries(icons)) {
      makeTexture(this, `${ID}-ic-${k}`, 9, 9, (p) => {
        p.circle(4.5, 4.5, 4.5, 0x1b1f3b);
        p.stamp(1, 1, rows, { a: 0xffffff });
      });
    }
    // glove cursor for CPU seats
    for (const pp of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[pp];
      makeTexture(this, `${ID}-hand-${pp}`, 12, 14, (p) => {
        p.rect(3, 0, 3, 7, 0xffffff);
        p.rect(3, 5, 8, 6, 0xffffff);
        p.rect(0, 6, 3, 3, 0xffffff);
        p.rect(3, 11, 8, 3, c.main);
        p.vline(6, 6, 3, 0xd8dbe6); p.vline(8, 6, 3, 0xd8dbe6);
        p.outline(-0.9);
      });
    }
    makeTexture(this, `${ID}-bin`, 30, 30, (p) => {
      p.circle(15, 16, 14, 0x1d5b8a);
      p.circle(15, 15, 14, 0x2f86c0);
      p.circle(15, 15, 12, 0x5ab8ee);
      p.circle(15, 15, 10.5, 0x1b2f4b);
      p.circle(14, 14, 9, 0x24405e);
      p.ring(15, 15, 13.5, 0x8fd6ff, 1);
      for (let a = 0; a < 8; a++) {
        const r = (a / 8) * Math.PI * 2;
        p.px(Math.round(15 + Math.cos(r) * 12), Math.round(15 + Math.sin(r) * 12), 0x2f86c0);
      }
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-mote`, 2, 2, (p) => p.rect(0, 0, 2, 2, 0xffffff));
    makeTexture(this, `${ID}-beam`, 70, 44, (p) => {
      // sunlight patch on the floor: widens and fades away from the window (window on the right)
      for (let x = 0; x < 70; x++) {
        const f = x / 69; // 0 far → 1 window
        const half = 9 + (1 - f) * 12;
        const a = Math.round(70 * Math.pow(f, 0.8));
        const cy = 22 + (1 - f) * 6;
        for (let y = Math.round(cy - half); y <= Math.round(cy + half); y++) {
          const edge = Math.min(y - (cy - half), cy + half - y);
          if (edge < 0) continue;
          p.px(x, y, 0xfff3c4, Math.round(a * Math.min(1, edge / 4)));
        }
      }
    });
    makeTexture(this, `${ID}-plane`, 12, 6, (p) => {
      p.tri(0, 0, 12, 3, 0, 6, 0xffffff);
      p.hline(0, 3, 11, 0xc9d4e6);
      p.outline(-0.5);
    });
    makeTexture(this, `${ID}-hand-clock`, 1, 6, (p) => p.rect(0, 0, 1, 6, 0x1b1f3b));
    // tiny teacher for the progress track + big teacher for the ending
    const teacher = (p: import('../../art/Painter').Painter, sc: number, mood: number) => {
      const s = (v: number) => Math.round(v * sc);
      p.rect(s(3), s(0), s(8), s(4), 0x4a2a1a);
      p.ball(s(7), s(5), s(3.6), s(3.6), 0xf2c8a0, false);
      p.rect(s(3), s(2), s(8), s(2), 0x4a2a1a);
      p.circle(s(7), s(1), s(2), 0x4a2a1a);
      p.hline(s(5), s(5), s(4), 0x1b1f3b);
      p.px(s(5), s(6), 0x1b1f3b); p.px(s(9), s(6), 0x1b1f3b);
      if (mood > 0) p.hline(s(6), s(8), s(3), 0xd0505a); else p.hline(s(6), s(8) + 1, s(3), 0x8a3a3a);
      p.rect(s(3), s(10), s(8), s(7), 0x8455d6);
      p.rect(s(4), s(10), s(6), s(2), 0xffffff);
      p.rect(s(4), s(17), s(6), s(4), 0x2b3263);
      p.rect(s(4), s(21), s(2), s(1), 0x1b1f3b); p.rect(s(8), s(21), s(2), s(1), 0x1b1f3b);
      p.box(s(9), s(12), s(4), s(4), 0xff7a85);
      p.outline(-0.8);
    };
    makeTexture(this, `${ID}-teach`, 14, 23, (p) => teacher(p, 1, 0));
    makeTexture(this, `${ID}-teach-happy`, 28, 46, (p) => teacher(p, 2, 1));
    makeTexture(this, `${ID}-teach-angry`, 28, 46, (p) => teacher(p, 2, 0));
    makeTexture(this, `${ID}-door`, 9, 12, (p) => { p.box(0, 0, 9, 12, 0x9a6a3e); p.rect(2, 2, 5, 4, 0xa9e0ff); p.px(7, 7, 0xffd34d); p.outline(-0.7); });
  }

  private paintRoom(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const wall = WALL / S;
    const key = makeTexture(this, `${ID}-room-${aw}`, aw, ah, (p) => {
      const r = rng(3);
      // checker floor tiles
      const ts = 12;
      for (let y = 0; y < ah; y += ts) for (let x = 0; x < aw; x += ts) {
        const odd = ((x / ts) + (y / ts)) % 2;
        p.rect(x, y, ts, ts, odd ? 0xe9e1cf : 0xdcd2bb);
        p.hline(x, y, ts, odd ? 0xf3ede0 : 0xe6ddc8);
        p.vline(x, y, ts, odd ? 0xf3ede0 : 0xe6ddc8);
      }
      for (let i = 0; i < aw * ah * 0.02; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), 0xd0c6ae);
      // rug in the middle
      p.ellipse(aw / 2, ah / 2, 44, 30, 0x5fa89a);
      p.ellipse(aw / 2, ah / 2, 41, 27.5, 0x7ec8b8);
      p.ellipse(aw / 2, ah / 2, 34, 22, 0x6ab8a8);
      for (let a = 0; a < 40; a++) {
        const t = (a / 40) * Math.PI * 2;
        p.px(Math.round(aw / 2 + Math.cos(t) * 38), Math.round(ah / 2 + Math.sin(t) * 25), 0xfff1c9);
      }
      // walls (top-down: thick rims)
      const wallC = 0x5fa89a;
      p.rect(0, 0, aw, wall, wallC); p.rect(0, ah - wall, aw, wall, wallC);
      p.rect(0, 0, wall, ah, wallC); p.rect(aw - wall, 0, wall, ah, wallC);
      p.hline(0, wall - 1, aw, shift(wallC, -0.5)); p.hline(0, ah - wall, aw, shift(wallC, -0.5));
      p.vline(wall - 1, 0, ah, shift(wallC, -0.5)); p.vline(aw - wall, 0, ah, shift(wallC, -0.5));
      p.hline(0, 0, aw, shift(wallC, 0.4)); p.hline(0, ah - 1, aw, shift(wallC, 0.4));
      // blackboard along the left wall
      p.rect(0, ah / 2 - 50, wall + 1, 100, 0x8a5a2e);
      p.rect(1, ah / 2 - 48, wall - 2, 96, 0x2f6b4f);
      for (let i = 0; i < 9; i++) p.hline(3, ah / 2 - 42 + i * 10, 2 + Math.floor(r() * 3), 0xe8f4ee);
      // windows along the right wall
      for (let i = 0; i < 3; i++) {
        const y0 = Math.round(ah * (0.22 + i * 0.28)) - 14;
        p.rect(aw - wall, y0, wall, 28, 0xffffff);
        p.rect(aw - wall + 2, y0 + 2, wall - 4, 24, 0x9fdcff);
        p.hline(aw - wall + 2, y0 + 13, wall - 4, 0xffffff);
        p.px(aw - wall + 3, y0 + 4, 0xe6f7ff);
      }
      // shelves / cubbies along top & bottom walls
      for (const yy of [wall, ah - wall - 6]) {
        for (let x = 60; x < aw - 60; x += 60) {
          p.box(x, yy, 22, 6, 0xc0834a);
          for (let k = 0; k < 5; k++) p.rect(x + 2 + k * 4, yy + 1, 3, 4, [0xff7a85, 0x6ec6ff, 0xffe066, 0x7ee8b0, 0xb8a6ff][(k + x) % 5]);
        }
      }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
    // plants in corners near the board
    makeTexture(this, `${ID}-plant`, 16, 16, (p) => {
      p.circle(8, 8, 5, 0xd9734e);
      const r = rng(9);
      for (let i = 0; i < 7; i++) p.ball(8 + (r() - 0.5) * 10, 8 + (r() - 0.5) * 10, 3.5, 3, i % 2 ? 0x58b05a : 0x4a9a4e, false);
      p.outline(-0.6);
    });
    for (const [x, y] of [[30, this.vh / 2 - 120], [30, this.vh / 2 + 120], [this.vw - 30, this.vh / 2 - 120], [this.vw - 30, this.vh / 2 + 120]]) {
      const pl = this.add.image(x, y, `${ID}-plant`).setScale(S).setDepth(5);
      this.tweens.add({ targets: pl, angle: { from: -4, to: 4 }, yoyo: true, repeat: -1, duration: 1800 + y, ease: 'Sine.easeInOut' });
    }
    // sun beams from the windows
    for (let i = 0; i < 3; i++) {
      const y = this.vh * (0.22 + i * 0.28);
      const b = this.add.image(this.vw - WALL - 70, y + 4, `${ID}-beam`).setScale(S).setDepth(4).setAlpha(0.7).setBlendMode(Phaser.BlendModes.ADD);
      this.beams.push(b);
    }
    for (let i = 0; i < 26; i++) {
      const img = this.add.image(0, 0, `${ID}-mote`).setDepth(2600).setAlpha(0.5).setScale(1 + Math.random());
      this.motes.push({ img, x: Math.random() * this.vw, y: Math.random() * this.vh, ph: Math.random() * 6 });
    }
    // clock on the board wall
    makeTexture(this, `${ID}-clock`, 12, 12, (p) => { p.circle(6, 6, 6, 0x2b3263); p.circle(6, 6, 5, 0xffffff); p.px(6, 1, 0x1b1f3b); p.px(6, 10, 0x1b1f3b); p.px(1, 6, 0x1b1f3b); p.px(10, 6, 0x1b1f3b); p.outline(-0.6); });
    this.add.image(WALL + 16, this.vh / 2 + 130, `${ID}-clock`).setScale(S).setDepth(6);
    this.clockHand = this.add.image(WALL + 16, this.vh / 2 + 130, `${ID}-hand-clock`).setScale(S).setOrigin(0.5, 1).setDepth(7);
    // bin in the middle (shared by all four players)
    this.add.image(this.cx + 4, this.cy + 6, 'shadow').setScale(S * 2).setAlpha(0.25).setDepth(8);
    this.bin = this.add.image(this.cx, this.cy, `${ID}-bin`).setScale(S).setDepth(9);
  }

  private buildMeter(): void {
    for (const deg of [0, 180] as const) {
      const y = deg === 0 ? this.cy + 52 : this.cy - 52;
      const w = 150;
      const c = this.add.container(this.cx, y).setAngle(deg).setDepth(960);
      const bg = this.add.nineslice(0, 0, 'ui-panel-dark', undefined, (w + 20) / S, 34 / S, 6, 6, 6, 6).setScale(S);
      const track = this.add.rectangle(0, 4, w, 8, 0x14172e);
      const fill = this.add.rectangle(-w / 2, 4, 1, 8, 0x7ee8b0).setOrigin(0, 0.5);
      const label = txt(this, 0, -8, 'ห้องสะอาด 0%', { size: 11, color: '#fff8e7', strokeWidth: 3 });
      const door = this.add.image(w / 2 + 2, 4, `${ID}-door`).setScale(S * 0.8);
      const teacher = this.add.image(-w / 2, -6, `${ID}-teach`).setScale(S * 0.7).setOrigin(0.5, 1).setAlpha(0.95);
      c.add([bg, track, fill, label, door, teacher]);
      this.bars.push({ fill, label, teacher, x0: -w / 2, w, deg });
    }
  }

  // ───────────────────────────── messes ─────────────────────────────

  private freeSpot(p: PlayerIndex, u: number, v: number): { x: number; y: number } | undefined {
    const pt = zonePoint(this.touch, this.zoneOf(p), u, v);
    const r = this.touch.zoneRect(this.zoneOf(p));
    const zone = this.zoneOf(p);
    const hudX = zone.x < 0.5 ? r.x + 46 : r.right - 46;
    const hudY = zone.facing === 180 ? r.y + 20 : r.bottom - 20;
    if (Math.abs(pt.x - hudX) < 80 && Math.abs(pt.y - hudY) < 46) return undefined;
    if (Math.abs(pt.x - this.cx) < 120 && Math.abs(pt.y - this.cy) < 78) return undefined;
    if (Math.abs(pt.x - this.cx) < 70 && Math.abs(pt.y - (zone.facing === 180 ? 0 : this.vh)) < 40) return undefined;
    if (pt.x < WALL + 26 || pt.x > this.vw - WALL - 26 || pt.y < WALL + 24 || pt.y > this.vh - WALL - 24) return undefined;
    if (this.messes.some((m) => !m.done && Math.hypot(m.x - pt.x, m.y - pt.y) < 60)) return undefined;
    return pt;
  }

  private spawn(p: PlayerIndex): void {
    if (this.messes.filter((m) => !m.done && m.zone === p).length >= MAX_PER_ZONE) return;
    // Same seeded sequence for every seat, mirrored into each zone (fair).
    const k = this.seq[p]++;
    const r = rng(1000 + k * 7919);
    const kind = (['stain', 'trash', 'desk', 'dust'] as Kind[])[Math.floor(r() * 4)];
    let pt: { x: number; y: number } | undefined;
    for (let i = 0; i < 20 && !pt; i++) pt = this.freeSpot(p, 0.08 + r() * 0.84, 0.1 + r() * 0.8);
    if (!pt) return;
    const ring = this.add.graphics().setDepth(2900);
    let img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
    let shadow: Phaser.GameObjects.Image | undefined;
    if (kind === 'stain') img = this.add.image(pt.x, pt.y, `${ID}-stain${Math.floor(r() * 3)}`).setScale(S).setDepth(20);
    else if (kind === 'trash') {
      shadow = this.add.image(pt.x, pt.y + 8, 'shadow').setScale(S * 0.6).setAlpha(0.25).setDepth(30);
      img = this.add.image(pt.x, pt.y, `${ID}-trash${Math.floor(r() * 4)}`).setScale(S).setDepth(pt.y + 40).setAngle(r() * 360);
    } else if (kind === 'desk') {
      img = this.add.sprite(pt.x, pt.y, `${ID}-desk`, 0).setScale(S).setDepth(pt.y);
      this.tweens.add({ targets: img, angle: { from: -3, to: 3 }, yoyo: true, repeat: -1, duration: 260 });
    } else {
      const s = this.add.sprite(pt.x, pt.y, `${ID}-dust`, 0).setScale(S).setDepth(2000).setAlpha(0.92);
      this.tweens.add({ targets: s, scaleX: S * 1.08, scaleY: S * 0.94, yoyo: true, repeat: -1, duration: 500, ease: 'Sine.easeInOut' });
      img = s;
    }
    const icon = this.add.image(pt.x + 20, pt.y - 18, `${ID}-ic-${kind}`).setScale(S).setDepth(2950).setTint(PLAYER_COLORS[p].light).setAngle(this.angleFor(p));
    const m: Mess = { id: this.nextId++, kind, zone: p, x: pt.x, y: pt.y, vx: 0, vy: 0, prog: 0, img, shadow, ring, icon, flying: false, done: false, spin: 0, rubSfx: 0, age: 0 };
    this.messes.push(m);
    img.setScale(0);
    this.tweens.add({ targets: img, scale: S, duration: 260, ease: 'Back.easeOut' });
    if (this.state === 'play') Audio.sfx('pop', 0.8 + Math.random() * 0.3);
  }

  private messAt(x: number, y: number): Mess | undefined {
    let best: Mess | undefined, bd = 40;
    for (const m of this.messes) {
      if (m.done || m.flying || m.held !== undefined) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  private complete(m: Mess, by: PlayerIndex): void {
    if (m.done) return;
    m.done = true;
    m.ring.destroy();
    m.icon.destroy();
    this.tweens.killTweensOf(m.img);
    this.fixes[by]++;
    this.done++;
    this.score[by] = this.fixes[by];
    this.addScore(by, 0);
    const col = PLAYER_COLORS[by];
    Vfx.popText(this, m.x, m.y - 26, '+1', toCss(col.light), 18, this.angleFor(by));
    Vfx.sparkle(this, m.x, m.y, [0xffffff, 0x7ee8b0, col.main]);
    Audio.sfx('coin', 1 + by * 0.1);
    if (m.kind === 'trash') {
      this.tweens.add({ targets: m.img, x: this.cx, y: this.cy - 4, scale: S * 0.5, duration: 160, onComplete: () => m.img.destroy() });
      m.shadow?.destroy();
      Vfx.squash(this, this.bin, 1.25, 0.8, 200);
      burst(this, this.cx, this.cy, { tex: 'dot2', count: 8, tint: [0xffffff, 0x8fd6ff], speed: [40, 110], life: 350, depth: 60 });
    } else if (m.kind === 'desk') {
      (m.img as Phaser.GameObjects.Sprite).setFrame(5).setAngle(0);
      this.tweens.add({ targets: m.img, scale: S * 1.2, yoyo: true, duration: 120 });
      this.tweens.add({ targets: m.img, alpha: 0, delay: 500, duration: 300, onComplete: () => m.img.destroy() });
    } else {
      this.tweens.add({ targets: m.img, alpha: 0, scale: S * 1.2, duration: 250, onComplete: () => m.img.destroy() });
    }
    this.messes = this.messes.filter((o) => o !== m);
    const pct = this.done / this.need;
    if (pct >= 0.5 && this.milestone < 1) { this.milestone = 1; this.banner('ครึ่งทางแล้ว!', '#7ee8b0', 26); }
    else if (pct >= 0.8 && this.milestone < 2) { this.milestone = 2; this.banner('อีกนิดเดียว!', '#ffe066', 26); }
    if (this.done >= this.need && !this.success) {
      this.success = true;
      this.endT = 1.4;
      Audio.sfx('power');
      Vfx.confetti(this, this.cx, this.cy, 90);
    }
  }

  private banner(s: string, color: string, size: number): void {
    for (const [deg, y] of [[0, this.vh * 0.72], [180, this.vh * 0.28]] as const) {
      const t = txt(this, this.cx, y, s, { size, color, strokeWidth: 6 }).setAngle(deg).setDepth(4000);
      this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
    }
  }

  // ─────────────────────────── actions ───────────────────────────

  private rub(m: Mess, dist: number, by: PlayerIndex): void {
    m.prog += dist / RUB_NEED;
    m.rubSfx -= dist;
    if (m.rubSfx <= 0) {
      m.rubSfx = 60;
      Audio.sfx('whoosh', 1.4 + Math.random() * 0.3);
      burst(this, m.x + (Math.random() - 0.5) * 30, m.y + (Math.random() - 0.5) * 20, { tex: 'dust', count: 3, tint: [0xffffff, 0xdff6ff, 0xbfeaff], speed: [10, 40], life: 500, scale: [S * 0.6, 0], gravity: -30, depth: 2800 });
    }
    m.img.setAlpha(Math.max(0.12, 1 - m.prog * 0.9));
    if (m.prog >= 1) this.complete(m, by);
  }

  private hold(m: Mess, dt: number, by: PlayerIndex, fx: number, fy: number): void {
    m.prog += dt / HOLD_NEED;
    m.img.setAlpha(Math.max(0.15, 1 - m.prog * 0.85)).setScale(S * (1 - m.prog * 0.4));
    if (Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2;
      const px = m.x + Math.cos(a) * 30, py = m.y + Math.sin(a) * 24;
      const d = this.add.image(px, py, 'dust').setScale(S * 0.5).setDepth(2800).setTint(0xf4f6fb);
      this.tweens.add({ targets: d, x: fx, y: fy, scale: 0, duration: 260, onComplete: () => d.destroy() });
    }
    m.rubSfx -= dt;
    if (m.rubSfx <= 0) { m.rubSfx = 0.18; Audio.sfx('whoosh', 2 + m.prog); }
    if (m.prog >= 1) this.complete(m, by);
  }

  private bonk(m: Mess, by: PlayerIndex): void {
    m.prog += 1 / TAPS_NEED;
    const f = Math.min(5, Math.floor(m.prog * TAPS_NEED + 0.001));
    (m.img as Phaser.GameObjects.Sprite).setFrame(f);
    Audio.sfx('hit', 1.2 + f * 0.08);
    Vfx.hit(this, m.x + (Math.random() - 0.5) * 16, m.y - 6, [0xffffff, 0xffe066, PLAYER_COLORS[by].light]);
    Vfx.popText(this, m.x, m.y - 30, ['ป๊อก!', 'ปัง!', 'ตึง!'][Math.floor(Math.random() * 3)], '#ffffff', 13, this.angleFor(by));
    Vfx.squash(this, m.img, 1.2, 0.8, 120);
    if (m.prog >= 0.999) this.complete(m, by);
  }

  private fling(m: Mess, vx: number, vy: number, by: PlayerIndex): void {
    const sp = Math.hypot(vx, vy);
    m.held = undefined;
    m.thrownBy = by;
    // dropped straight onto the bin also counts
    if (Math.hypot(m.x - this.cx, m.y - this.cy) < BIN_R + 14) { this.complete(m, by); return; }
    if (sp < 120) { m.vx = vx * 0.3; m.vy = vy * 0.3; return; }
    // Aim assist toward the shared bin when the throw is roughly aimed at it.
    const bx = this.cx - m.x, by_ = this.cy - m.y;
    const bd = Math.hypot(bx, by_) || 1;
    const cos = (vx * bx + vy * by_) / (sp * bd);
    let nvx = vx, nvy = vy;
    const s = Phaser.Math.Clamp(sp, 260, 900);
    if (cos > 0.85) { nvx = (bx / bd) * s; nvy = (by_ / bd) * s; }
    else { nvx = (vx / sp) * s; nvy = (vy / sp) * s; }
    m.vx = nvx; m.vy = nvy;
    m.flying = true;
    m.spin = (Math.random() - 0.5) * 900;
    Audio.sfx('throw', 1 + by * 0.1);
  }

  // ─────────────────────────── input ───────────────────────────

  private onDown(t: TrackedTouch): void {
    if (this.state !== 'play' || this.isCpu(t.player) || this.endT >= 0) return;
    const f: Finger = { lx: t.x, ly: t.y, hist: [{ x: t.x, y: t.y, t: this.time.now }] };
    const m = this.messAt(t.x, t.y);
    if (m) {
      if (m.kind === 'desk') this.bonk(m, t.player);
      else if (m.kind === 'trash') { m.held = t.pointerId; m.vx = m.vy = 0; f.mess = m; Audio.sfx('pop', 1.4); Vfx.squash(this, m.img, 1.3, 1.3, 120); }
      else f.mess = m;
    }
    this.fingers.set(t.pointerId, f);
  }

  private onUp(t: TrackedTouch): void {
    const f = this.fingers.get(t.pointerId);
    this.fingers.delete(t.pointerId);
    if (!f?.mess || f.mess.done) return;
    if (f.mess.kind === 'trash' && f.mess.held === t.pointerId) {
      // release velocity from the last ~120 ms of finger movement
      const now = this.time.now;
      f.hist.push({ x: t.x, y: t.y, t: now });
      const old = f.hist.find((h) => now - h.t <= 200) ?? f.hist[0];
      const dts = Math.max(0.03, (now - old.t) / 1000);
      f.mess.x = t.x; f.mess.y = t.y;
      this.fling(f.mess, (t.x - old.x) / dts, (t.y - old.y) / dts, t.player);
    }
  }

  private humanInput(dt: number): void {
    for (const p of this.players) {
      if (this.isCpu(p)) continue;
      for (const t of this.touch.touchesFor(p)) {
        const f = this.fingers.get(t.pointerId);
        if (!f) continue;
        const dx = t.x - f.lx, dy = t.y - f.ly;
        const d = Math.hypot(dx, dy);
        f.lx = t.x; f.ly = t.y;
        f.hist.push({ x: t.x, y: t.y, t: this.time.now });
        if (f.hist.length > 30) f.hist.shift();
        let m = f.mess;
        if (m?.done) m = f.mess = undefined;
        if (!m) {
          // sliding onto a stain or dust cloud also works
          const o = this.messAt(t.x, t.y);
          if (o && (o.kind === 'stain' || o.kind === 'dust')) m = f.mess = o;
        }
        if (!m) continue;
        if (m.kind === 'trash' && m.held === t.pointerId) { m.x = t.x; m.y = t.y; }
        else if (m.kind === 'stain') { if (Math.hypot(t.x - m.x, t.y - m.y) < 46) this.rub(m, d, p); }
        else if (m.kind === 'dust') { if (Math.hypot(t.x - m.x, t.y - m.y) < 46) this.hold(m, dt, p, t.x, t.y); }
      }
    }
  }

  // ─────────────────────────── CPU ───────────────────────────

  private cpu(p: PlayerIndex, c: Cpu, dt: number): void {
    const zr = this.touch.zoneRect(this.zoneOf(p));
    if (c.target && (c.target.done || (c.target.kind === 'trash' && c.target.flying))) { c.target = undefined; c.think = 0.25 + Math.random() * 0.5 / c.skill; }
    if (!c.target) {
      c.think -= dt;
      // idle drift
      c.x += Math.sin(this.t * 2 + p) * 10 * dt;
      if (c.think > 0) return;
      const mine = this.messes.filter((m) => !m.done && !m.flying && m.held === undefined && zr.contains(m.x, m.y));
      if (!mine.length) { c.think = 0.3; return; }
      c.target = mine.reduce((a, b) => (Math.hypot(a.x - c.x, a.y - c.y) < Math.hypot(b.x - c.x, b.y - c.y) ? a : b));
      c.phase = 0; c.act = 0; c.tapT = 0;
    }
    const m = c.target;
    const sp = 300 * c.skill;
    if (c.phase === 0) {
      const dx = m.x - c.x, dy = m.y - c.y, d = Math.hypot(dx, dy);
      if (d < 6) { c.phase = 1; if (m.kind === 'trash') m.held = -100 - p; }
      else { const k = Math.min(1, (sp * dt) / d); c.x += dx * k; c.y += dy * k; }
      return;
    }
    c.act += dt;
    if (m.kind === 'stain') {
      const ox = Math.sin(c.act * 16 * c.skill) * 18;
      const nx = m.x + ox, ny = m.y + Math.cos(c.act * 8) * 6;
      const d = Math.hypot(nx - c.x, ny - c.y);
      c.x = nx; c.y = ny;
      this.rub(m, d * 0.62, p);
    } else if (m.kind === 'dust') {
      c.x = m.x + (Math.random() - 0.5) * 3; c.y = m.y + (Math.random() - 0.5) * 3;
      this.hold(m, dt * 0.62 * c.skill + dt * 0.12, p, c.x, c.y);
    } else if (m.kind === 'desk') {
      c.tapT -= dt;
      if (c.tapT <= 0) {
        c.tapT = 0.34 / c.skill;
        c.hand.setScale(S * 0.8);
        this.tweens.add({ targets: c.hand, scale: S, duration: 100 });
        this.bonk(m, p);
      }
    } else if (m.kind === 'trash') {
      // drag a bit toward the bin, then flick (sometimes misses)
      const bx = this.cx - m.x, by = this.cy - m.y, bd = Math.hypot(bx, by) || 1;
      if (c.act < 0.3 / c.skill) {
        m.x += (bx / bd) * 70 * dt; m.y += (by / bd) * 70 * dt;
        c.x = m.x; c.y = m.y;
      } else {
        const err = (Math.random() - 0.5) * (1 - c.skill) * 1.6;
        const a = Math.atan2(by, bx) + err;
        this.fling(m, Math.cos(a) * 600, Math.sin(a) * 600, p);
        c.target = undefined;
        c.think = 0.35 + Math.random() * 0.6;
      }
    }
  }

  // ─────────────────────────── loop ───────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const m of this.messes) {
      m.age += dt;
      m.img.setPosition(m.x, m.y);
      if (m.kind === 'trash') {
        m.img.setDepth(m.held !== undefined || m.flying ? 2700 : m.y + 40);
        if (m.flying) m.img.angle += m.spin * dt;
        m.shadow?.setPosition(m.x, m.y + 10);
      }
      m.icon.setPosition(m.x + 22, m.y - 20 + Math.sin(this.t * 4 + m.id) * 2).setVisible(m.held === undefined && !m.flying);
      m.ring.clear();
      if (m.prog > 0 && !m.done) {
        m.ring.lineStyle(5, 0x1b1f3b, 0.6).beginPath().arc(m.x, m.y, 30, 0, Math.PI * 2).strokePath();
        m.ring.lineStyle(3, PLAYER_COLORS[m.zone].light, 1).beginPath().arc(m.x, m.y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, m.prog)).strokePath();
      }
    }
    for (const [, c] of this.cpus) c.hand.setPosition(c.x, c.y + (c.target?.kind === 'desk' ? -Math.abs(Math.sin(this.t * 18)) * 5 : 0));
    // meter + teacher
    this.shown += (Math.min(1, this.done / this.need) - this.shown) * Math.min(1, dt * 6);
    const tf = Phaser.Math.Clamp(this.elapsed / this.meta.duration, 0, 1);
    for (const b of this.bars) {
      b.fill.width = Math.max(1, b.w * this.shown);
      b.fill.setFillStyle(this.shown >= 1 ? 0xffe066 : this.shown > 0.6 ? 0x7ee8b0 : 0x6ec6ff);
      const label = `ห้องสะอาด ${Math.floor(this.shown * 100 + 0.001)}%`;
      if (b.label.text !== label) b.label.setText(label);
      b.teacher.x = b.x0 + b.w * tf;
      b.teacher.y = -6 - Math.abs(Math.sin(this.t * 8)) * 2;
    }
    // room life
    for (const mo of this.motes) {
      mo.x += Math.sin(this.t * 0.5 + mo.ph) * 6 * dt - 4 * dt;
      mo.y += Math.cos(this.t * 0.4 + mo.ph) * 5 * dt;
      if (mo.x < 0) mo.x = this.vw;
      mo.img.setPosition(mo.x, mo.y).setAlpha(0.25 + Math.sin(this.t * 2 + mo.ph) * 0.2);
    }
    this.beams.forEach((b, i) => b.setAlpha(0.55 + Math.sin(this.t * 0.8 + i) * 0.15));
    this.clockHand.setAngle(this.t * 60);
    this.planeT -= dt;
    if (!this.plane && this.planeT <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y = this.vh * (0.2 + Math.random() * 0.6);
      const img = this.add.image(dir > 0 ? -20 : this.vw + 20, y, `${ID}-plane`).setScale(S).setDepth(3500).setFlipX(dir < 0);
      this.plane = { img, t: 0, y, dir };
    }
    if (this.plane) {
      const pl = this.plane;
      pl.t += dt;
      pl.img.x += pl.dir * 120 * dt;
      pl.img.y = pl.y + Math.sin(pl.t * 3) * 14;
      pl.img.setAngle(Math.cos(pl.t * 3) * 12 * pl.dir);
      if (pl.img.x < -40 || pl.img.x > this.vw + 40) { pl.img.destroy(); this.plane = undefined; this.planeT = 7 + Math.random() * 6; }
    }
  }

  tick(dt: number): void {
    if (this.endT >= 0) {
      this.endT -= dt;
      if (this.endT <= 0) this.finish();
      return;
    }
    // new messes keep appearing in every zone
    for (const p of this.players) {
      this.spawnT[p] -= dt;
      if (this.spawnT[p] <= 0) {
        this.spawnT[p] = 2.3 + rng(500 + this.seq[p])() * 0.8;
        this.spawn(p);
      }
    }
    this.humanInput(dt);
    for (const [p, c] of this.cpus) this.cpu(p, c, dt);
    // flying trash
    for (const m of [...this.messes]) {
      if (m.kind !== 'trash' || m.held !== undefined || m.done) continue;
      if (!m.flying && Math.hypot(m.vx, m.vy) < 1) continue;
      m.x += m.vx * dt; m.y += m.vy * dt;
      const fr = Math.pow(m.flying ? 0.35 : 0.02, dt);
      m.vx *= fr; m.vy *= fr;
      if (m.x < WALL + 10 || m.x > this.vw - WALL - 10) { m.vx = -m.vx * 0.5; m.x = Phaser.Math.Clamp(m.x, WALL + 10, this.vw - WALL - 10); Audio.sfx('bounce', 1.5); }
      if (m.y < WALL + 10 || m.y > this.vh - WALL - 10) { m.vy = -m.vy * 0.5; m.y = Phaser.Math.Clamp(m.y, WALL + 10, this.vh - WALL - 10); Audio.sfx('bounce', 1.5); }
      if (Math.hypot(m.x - this.cx, m.y - this.cy) < BIN_R) { this.complete(m, m.thrownBy ?? m.zone); continue; }
      if (Math.hypot(m.vx, m.vy) < 40) {
        m.flying = false; m.vx = m.vy = 0;
        m.img.setAngle(m.img.angle);
        // landed somewhere else: belongs to whichever zone it is in now
        const z = this.touch.playerAt(m.x, m.y);
        if (z !== undefined && this.players.includes(z)) m.zone = z;
        Vfx.dust(this, m.x, m.y + 6);
      }
    }
  }

  finish(): void {
    if (this.state === 'end') return;
    const ok = this.success || this.done >= this.need;
    this.success = ok;
    // Teacher walks in to judge the room.
    const key = ok ? `${ID}-teach-happy` : `${ID}-teach-angry`;
    for (const [deg, y] of [[0, this.cy + 8], [180, this.cy - 8]] as const) {
      const t = this.add.image(this.cx, y, key).setScale(S).setAngle(deg).setDepth(4500).setOrigin(0.5, 1);
      this.tweens.add({ targets: t, scale: { from: 0, to: S }, duration: 300, ease: 'Back.easeOut' });
      if (ok) this.tweens.add({ targets: t, y: y + (deg === 0 ? -6 : 6), yoyo: true, repeat: -1, duration: 200 });
      else this.tweens.add({ targets: t, x: this.cx + 3, yoyo: true, repeat: -1, duration: 60 });
    }
    for (const [deg, y] of [[0, this.vh * 0.84], [180, this.vh * 0.16]] as const) {
      const t = txt(this, this.cx, y, ok ? 'สะอาดเอี่ยม! ทีมสำเร็จ!' : 'ครูมาแล้ว! ยังไม่สะอาด…', { size: 28, color: ok ? '#7ee8b0' : '#ff7a85', strokeWidth: 7 }).setAngle(deg).setDepth(4600);
      this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 320, ease: 'Back.easeOut' });
    }
    if (ok) Vfx.confetti(this, this.cx, this.cy, 80);
    else Audio.sfx('lose');
    super.finish();
  }

  results(): PlayerResult[] {
    return rankBy(this.players, (p) => this.fixes[p]).map((r) => ({ ...r, score: this.fixes[r.player] }));
  }

  /** Probe for tests. */
  __probe(): unknown {
    return { done: this.done, need: this.need, fixes: this.fixes, messes: this.messes.length };
  }
}

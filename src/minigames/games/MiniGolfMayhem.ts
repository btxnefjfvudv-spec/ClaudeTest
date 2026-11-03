import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { splash } from '../kit/water';

const BALL_R = 6;
const CUP_R = 9;
const MAX_SHOT = 540;
const DRAG_FULL = 105;
const HOLE_TIME = 30;
const INTRO_T = 1.4;
const PTS = [4, 3, 2, 1];

interface Seg { x1: number; y1: number; x2: number; y2: number; w: number; vx: number; vy: number; omega: number; cx: number; cy: number }
interface Circ { x: number; y: number; r: number; k: number }
interface Ell { x: number; y: number; rx: number; ry: number }

interface HoleDef {
  name: string;
  cup: { x: number; y: number };
  walls: Seg[];
  bumpers: Circ[];
  sand: Ell[];
  ponds: Ell[];
  /** Island hole: water annulus (inner, outer radius) with bridge half-width. */
  ring?: { r0: number; r1: number; bridge: number };
  /** Moving segments at hole time t. */
  dyn: (t: number) => Seg[];
}

interface GBall {
  p: PlayerIndex;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastX: number;
  lastY: number;
  sunk: boolean;
  sinkT: number;
  drown: number;
  strokes: number;
  total: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  mark: Phaser.GameObjects.Image;
  dots: Phaser.GameObjects.Image[];
  band: Phaser.GameObjects.Image;
  aimId: number;
  aimDx: number;
  aimDy: number;
  cpuT: number;
  skill: number;
  inSand: boolean;
  trailT: number;
}

const seg = (x1: number, y1: number, x2: number, y2: number, w = 4): Seg => ({ x1, y1, x2, y2, w, vx: 0, vy: 0, omega: 0, cx: 0, cy: 0 });

/** #23 — Simultaneous slingshot mini golf over three crazy holes. */
export default class MiniGolfMayhem extends BaseMinigame {
  private holes: HoleDef[] = [];
  private hole = 0;
  private holeT = 0;
  private holeLimit = HOLE_TIME;
  private between = 0;
  private sinkOrder: PlayerIndex[] = [];
  private balls: GBall[] = [];
  private bg!: Phaser.GameObjects.Image;
  private holeObjs: Phaser.GameObjects.GameObject[] = [];
  private dynImgs: { img: Phaser.GameObjects.Image; i: number; kind: 'slide' | 'mill' }[] = [];
  private flag!: Phaser.GameObjects.Sprite;
  private cupImg!: Phaser.GameObjects.Image;
  private infoTexts: Phaser.GameObjects.Text[] = [];
  private sparkles: Phaser.GameObjects.Image[] = [];
  private flies: { img: Phaser.GameObjects.Image; a: number; s: number; cx: number; cy: number }[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private L = 0;
  private R = 0;
  private T = 0;
  private B = 0;
  private t = 0;
  private done = false;

  constructor() {
    super(CATALOG['mini-golf-mayhem']);
  }

  setup(): void {
    this.hole = 0;
    this.holeT = 0;
    this.between = 0;
    this.sinkOrder = [];
    this.balls = [];
    this.holeObjs = [];
    this.dynImgs = [];
    this.sparkles = [];
    this.flies = [];
    this.clouds = [];
    this.t = 0;
    this.done = false;
    this.L = 16; this.R = this.vw - 16; this.T = 36; this.B = this.vh - 36;
    this.defineHoles();
    this.paintShared();
    this.bg = this.add.image(0, 0, this.paintHole(0)).setOrigin(0).setScale(S).setDepth(-100);
    for (let i = 1; i < 3; i++) this.paintHole(i);
    this.cupImg = this.add.image(0, 0, 'mini-golf-mayhem-cup').setScale(S).setDepth(-40);
    this.flag = this.add.sprite(0, 0, 'mini-golf-mayhem-flag', 0).setOrigin(0.15, 1).setScale(S).setDepth(600);
    this.flag.play('mini-golf-mayhem-wave');
    this.makeBalls();
    this.infoTexts = [];
    for (const deg of [0, 180]) {
      const y = deg === 0 ? this.vh - 15 : 15;
      this.infoTexts.push(txt(this, this.vw / 2 + (deg === 0 ? -46 : 46), y, '', { size: 14, color: '#fff8e7' }).setAngle(deg).setDepth(950));
    }
    this.ambientLife();
    this.loadHole(0, false);
  }

  // ───────────────────────────── COURSE DATA ─────────────────────────────

  private tee(p: PlayerIndex): { x: number; y: number } {
    const left = p % 2 === 0, top = p < 2;
    return { x: left ? this.L + 54 : this.R - 54, y: top ? this.T + 48 : this.B - 48 };
  }

  private defineHoles(): void {
    const cx = this.vw / 2, cy = this.vh / 2;
    const { L, R, T, B } = this;
    const border = [seg(L, T, R, T, 3), seg(R, T, R, B, 3), seg(R, B, L, B, 3), seg(L, B, L, T, 3)];
    // 1 — WINDMILL: four sails sweep around the cup.
    const mill = (t: number): Seg[] => {
      const out: Seg[] = [];
      const w = 1.25;
      for (let k = 0; k < 4; k++) {
        const a = t * w + (k * Math.PI) / 2;
        const c = Math.cos(a), s = Math.sin(a);
        out.push({ x1: cx + c * 30, y1: cy + s * 30, x2: cx + c * 84, y2: cy + s * 84, w: 5, vx: 0, vy: 0, omega: w, cx, cy });
      }
      return out;
    };
    this.holes = [
      {
        name: 'กังหันลม WINDMILL',
        cup: { x: cx, y: cy },
        walls: [
          ...border,
          // angled deflectors in front of the side bumpers
          seg(cx - 150, cy - 120, cx - 110, cy - 150, 4), seg(cx + 150, cy - 120, cx + 110, cy - 150, 4),
          seg(cx - 150, cy + 120, cx - 110, cy + 150, 4), seg(cx + 150, cy + 120, cx + 110, cy + 150, 4),
        ],
        bumpers: [{ x: cx - 190, y: cy, r: 13, k: 1.25 }, { x: cx + 190, y: cy, r: 13, k: 1.25 }],
        sand: [{ x: cx, y: T + 46, rx: 62, ry: 20 }, { x: cx, y: B - 46, rx: 62, ry: 20 }],
        ponds: [],
        dyn: mill,
      },
      {
        name: 'กำแพงเลื่อน MOVING WALLS',
        cup: { x: cx, y: cy },
        walls: [
          ...border,
          seg(cx - 170, cy - 66, cx - 40, cy - 66), seg(cx + 40, cy - 66, cx + 170, cy - 66),
          seg(cx - 170, cy + 66, cx - 40, cy + 66), seg(cx + 40, cy + 66, cx + 170, cy + 66),
          seg(cx - 170, cy - 66, cx - 170, cy - 22), seg(cx - 170, cy + 22, cx - 170, cy + 66),
          seg(cx + 170, cy - 66, cx + 170, cy - 22), seg(cx + 170, cy + 22, cx + 170, cy + 66),
        ],
        bumpers: [{ x: cx, y: T + 58, r: 12, k: 1.25 }, { x: cx, y: B - 58, r: 12, k: 1.25 }],
        sand: [{ x: cx - 100, y: cy, rx: 34, ry: 26 }, { x: cx + 100, y: cy, rx: 34, ry: 26 }],
        ponds: [{ x: L + 66, y: cy, rx: 48, ry: 40 }, { x: R - 66, y: cy, rx: 48, ry: 40 }],
        dyn: (t) => {
          const a = Math.sin(t * 1.5) * 62, b = Math.sin(t * 1.5 + Math.PI) * 62;
          const va = Math.cos(t * 1.5) * 62 * 1.5, vb = Math.cos(t * 1.5 + Math.PI) * 62 * 1.5;
          const c = Math.sin(t * 1.9) * 24, vc = Math.cos(t * 1.9) * 24 * 1.9;
          const mk = (x1: number, y1: number, x2: number, y2: number, vx: number, vy: number): Seg => ({ x1, y1, x2, y2, w: 5, vx, vy, omega: 0, cx: 0, cy: 0 });
          return [
            mk(cx + a - 30, cy - 66, cx + a + 30, cy - 66, va, 0),
            mk(cx + b - 30, cy + 66, cx + b + 30, cy + 66, vb, 0),
            mk(cx - 170, cy + c - 16, cx - 170, cy + c + 16, 0, vc),
            mk(cx + 170, cy - c - 16, cx + 170, cy - c + 16, 0, -vc),
          ];
        },
      },
      {
        name: 'เกาะกลางน้ำ ISLAND',
        cup: { x: cx, y: cy },
        walls: [...border],
        bumpers: [
          { x: cx - 150, y: cy - 112, r: 14, k: 1.3 }, { x: cx + 150, y: cy - 112, r: 14, k: 1.3 },
          { x: cx - 150, y: cy + 112, r: 14, k: 1.3 }, { x: cx + 150, y: cy + 112, r: 14, k: 1.3 },
        ],
        sand: [{ x: cx, y: T + 30, rx: 44, ry: 16 }, { x: cx, y: B - 30, rx: 44, ry: 16 }, { x: L + 40, y: cy, rx: 22, ry: 44 }, { x: R - 40, y: cy, rx: 22, ry: 44 }],
        ponds: [],
        ring: { r0: 52, r1: 112, bridge: 17 },
        dyn: () => [],
      },
    ];
  }

  private inEll(e: Ell, x: number, y: number): boolean {
    const nx = (x - e.x) / e.rx, ny = (y - e.y) / e.ry;
    return nx * nx + ny * ny < 1;
  }

  private inWater(h: HoleDef, x: number, y: number): boolean {
    for (const e of h.ponds) if (this.inEll(e, x, y)) return true;
    if (h.ring) {
      const dx = x - h.cup.x, dy = y - h.cup.y;
      const d = Math.hypot(dx, dy);
      if (d > h.ring.r0 && d < h.ring.r1 && Math.abs(dx) > h.ring.bridge && Math.abs(dy) > h.ring.bridge) return true;
    }
    return false;
  }

  private inSand(h: HoleDef, x: number, y: number): boolean {
    return h.sand.some((e) => this.inEll(e, x, y));
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintShared(): void {
    makeTexture(this, 'mini-golf-mayhem-cup', 12, 12, (p) => {
      p.circle(6, 6, 5.5, 0xd8f0c8);
      p.circle(6, 6, 4.5, 0x1d2a24);
      p.ellipse(6, 7, 3.5, 2.8, 0x0e1512);
      p.hline(4, 2, 4, 0xffffff);
    });
    makeSheet(this, 'mini-golf-mayhem-flag', 16, 30, 4, (p, i) => {
      p.vline(2, 4, 26, 0xf2f2f2);
      p.vline(3, 4, 26, 0xb8bcc8);
      const wv = [0, 1, 0, -1][i];
      for (let x = 0; x < 11; x++) {
        const o = Math.round(Math.sin((x + i * 2.5) * 0.6) * 1.2) + (x > 6 ? wv : 0);
        const h = 7 - Math.floor(x * 0.45);
        p.vline(4 + x, 4 + o + (7 - h) / 2, h, x % 4 === 3 ? 0xd43a4c : 0xff5a6e);
      }
      p.px(2, 3, 0xffe066);
      p.outline(-0.7);
    });
    if (!this.anims.exists('mini-golf-mayhem-wave')) this.anims.create({ key: 'mini-golf-mayhem-wave', frames: this.anims.generateFrameNumbers('mini-golf-mayhem-flag', {}), frameRate: 7, repeat: -1 });
    // windmill sails (one blade, rotated per instance)
    makeTexture(this, 'mini-golf-mayhem-sail', 30, 9, (p) => {
      p.rect(0, 3, 30, 3, 0x7a4a2c);
      p.hline(0, 3, 30, 0xa86a3e);
      p.box(4, 0, 25, 9, 0xf4ead2);
      for (let x = 4; x < 29; x += 5) p.vline(x, 0, 9, 0xa86a3e);
      p.hline(4, 4, 25, 0xa86a3e);
      p.rect(5, 1, 3, 2, 0xffffff);
      p.outline(-0.7);
    });
    makeTexture(this, 'mini-golf-mayhem-hub', 34, 34, (p) => {
      p.ring(17, 17, 16.5, 0x7a4a2c, 3);
      p.ring(17, 17, 14, 0xa86a3e, 1);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        p.circle(17 + Math.cos(a) * 15.5, 17 + Math.sin(a) * 15.5, 1.3, 0xe0b070);
      }
    });
    makeTexture(this, 'mini-golf-mayhem-slider', 32, 8, (p) => {
      p.box(0, 0, 32, 8, 0xff9f43);
      for (let x = 0; x < 32; x += 8) p.rect(x, 1, 4, 6, 0x3a3340);
      p.hline(1, 1, 30, 0xffd08a);
      p.outline(-0.7);
    });
    makeTexture(this, 'mini-golf-mayhem-dot', 3, 3, (p) => p.rect(0, 0, 3, 3, 0xffffff));
    makeTexture(this, 'mini-golf-mayhem-sparkle', 5, 5, (p) => { p.px(2, 0, 0xffffff); p.hline(1, 2, 3, 0xffffff); p.px(2, 4, 0xffffff); p.px(2, 1, 0xdff6ff); p.px(2, 3, 0xdff6ff); });
    makeSheet(this, 'mini-golf-mayhem-fly', 7, 5, 2, (p, i) => {
      const c = 0xffffff;
      if (i === 0) { p.rect(0, 0, 3, 3, c); p.rect(4, 0, 3, 3, c); } else { p.rect(0, 2, 3, 2, c); p.rect(4, 2, 3, 2, c); }
      p.vline(3, 1, 3, 0x2b2030);
    });
    if (!this.anims.exists('mini-golf-mayhem-flap')) this.anims.create({ key: 'mini-golf-mayhem-flap', frames: this.anims.generateFrameNumbers('mini-golf-mayhem-fly', {}), frameRate: 10, repeat: -1 });
    makeTexture(this, 'mini-golf-mayhem-cloud', 150, 70, (p) => {
      const blobs = [[75, 38, 60, 26], [45, 30, 34, 22], [105, 32, 36, 24], [70, 24, 30, 18]];
      for (let y = 0; y < 70; y++) for (let x = 0; x < 150; x++) {
        let m = 0;
        for (const [bx, by, rx, ry] of blobs) m = Math.max(m, 1 - Math.hypot((x - bx) / rx, (y - by) / ry));
        if (m <= 0) continue;
        if (m < 0.12 && (x + y) % 2) continue;
        p.px(x, y, 0x000000);
      }
    });
    makeTexture(this, 'mini-golf-mayhem-lily', 9, 8, (p) => {
      p.ellipse(4.5, 4, 4.5, 3.6, 0x4caf50);
      p.tri(4.5, 4, 9, 1, 9, 5, 0x2f9fd8);
      p.px(3, 2, 0x8bdc7a); p.px(6, 5, 0xff9fc0);
      p.outline(-0.6);
    });
    makeTexture(this, 'mini-golf-mayhem-band', 24, 24, (p) => p.ring(12, 12, 11.5, 0xffffff, 1.5));
  }

  private paintHole(i: number): string {
    const W = Math.ceil(this.vw / S), H = Math.ceil(this.vh / S);
    const h = this.holes[i];
    return makeTexture(this, `mini-golf-mayhem-hole${i}-${W}`, W, H, (p) => {
      const r = rng(230 + i);
      const a = (v: number) => v / S;
      // hedge + flowers around the course
      p.rect(0, 0, W, H, 0x2f6b3c);
      for (let k = 0; k < W * H * 0.08; k++) p.px(Math.floor(r() * W), Math.floor(r() * H), r() > 0.5 ? 0x3a7d45 : 0x285e35);
      for (let k = 0; k < 90; k++) {
        const x = Math.floor(r() * W), y = Math.floor(r() * H);
        const c = [0xff7a85, 0xffe066, 0xffffff, 0xb8a6ff][k % 4];
        p.px(x, y, c); p.px(x + 1, y, shift(c, -0.3));
      }
      // course grass with mowing stripes
      const x0 = a(this.L), y0 = a(this.T), x1 = a(this.R), y1 = a(this.B);
      const g1 = [0x63c35d, 0x6fc95b, 0x5fba63][i], g2 = shift(g1, -0.12);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) p.px(x, y, Math.floor((x + y) / 12) % 2 ? g1 : g2);
      for (let k = 0; k < (x1 - x0) * (y1 - y0) * 0.03; k++) p.px(x0 + Math.floor(r() * (x1 - x0)), y0 + Math.floor(r() * (y1 - y0)), shift(g1, 0.18));
      // soft shade along the top/left border
      for (let x = x0; x < x1; x++) { p.px(x, y0, shift(g2, -0.35)); p.px(x, y0 + 1, shift(g2, -0.2)); }
      for (let y = y0; y < y1; y++) { p.px(x0, y, shift(g2, -0.35)); p.px(x0 + 1, y, shift(g2, -0.2)); }
      // water
      const WATER = 0x2f9fd8;
      if (h.ring) {
        const { r0, r1, bridge } = h.ring;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const dx = x + 0.5 - a(h.cup.x), dy = y + 0.5 - a(h.cup.y);
          const d = Math.hypot(dx, dy);
          if (d > a(r0) - 1 && d < a(r1) + 1) {
            const edge = d < a(r0) + 1 || d > a(r1) - 1;
            p.px(x, y, edge ? 0xc9b27a : d < a(r0) + 3 || d > a(r1) - 3 ? 0x56b8e8 : WATER);
          }
        }
        for (let k = 0; k < 160; k++) {
          const ang = r() * Math.PI * 2, d = a(r0) + 4 + r() * (a(r1 - r0) - 8);
          p.hline(Math.round(a(h.cup.x) + Math.cos(ang) * d), Math.round(a(h.cup.y) + Math.sin(ang) * d), 2 + Math.floor(r() * 3), 0x2588c4);
        }
        // bridges (planks)
        const bw = a(bridge);
        const cxa = a(h.cup.x), cya = a(h.cup.y);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          for (let s = a(r0) - 2; s <= a(r1) + 2; s++) {
            const bx = cxa + dx * s, by = cya + dy * s;
            for (let o = -bw; o <= bw; o++) {
              const px = dx === 0 ? bx + o : bx, py = dy === 0 ? by + o : by;
              const plank = Math.floor(s / 3) % 2 ? 0xc0834a : 0xb07540;
              p.px(px, py, Math.abs(o) >= bw - 0.5 ? 0x7a4a2c : plank);
            }
          }
        }
      }
      for (const e of h.ponds) {
        p.ellipse(a(e.x), a(e.y), a(e.rx) + 1.5, a(e.ry) + 1.5, 0xc9b27a);
        p.ellipse(a(e.x), a(e.y), a(e.rx), a(e.ry), 0x56b8e8);
        p.ellipse(a(e.x), a(e.y) + 1, a(e.rx) - 2, a(e.ry) - 2, WATER);
        for (let k = 0; k < 14; k++) p.hline(Math.round(a(e.x) + (r() - 0.5) * a(e.rx) * 1.2), Math.round(a(e.y) + (r() - 0.5) * a(e.ry) * 1.2), 3, 0x2588c4);
      }
      // sand
      for (const e of h.sand) {
        p.ellipse(a(e.x), a(e.y), a(e.rx) + 1, a(e.ry) + 1, 0xc9a86a);
        p.ellipse(a(e.x), a(e.y), a(e.rx), a(e.ry), 0xedd8a0);
        p.ellipse(a(e.x) - 2, a(e.y) - 1, a(e.rx) * 0.6, a(e.ry) * 0.5, 0xf6e6b8);
        for (let k = 0; k < a(e.rx) * a(e.ry) * 0.15; k++) {
          const ang = r() * Math.PI * 2, d = Math.sqrt(r());
          p.px(Math.round(a(e.x) + Math.cos(ang) * d * a(e.rx) * 0.9), Math.round(a(e.y) + Math.sin(ang) * d * a(e.ry) * 0.9), 0xd8bd80);
        }
      }
      // putting green around the cup
      {
        const gr = h.ring ? a(h.ring.r0) - 3 : 22;
        for (let y = -gr; y <= gr; y++) for (let x = -gr; x <= gr; x++) {
          const d = Math.hypot(x, y);
          if (d <= gr) p.px(a(h.cup.x) + x, a(h.cup.y) + y, d > gr - 1 ? shift(g1, -0.1) : (x + y) % 2 ? 0x7cd96a : 0x76d266);
        }
      }
      // tee pads
      for (const q of [0, 1, 2, 3] as PlayerIndex[]) {
        const t = this.tee(q);
        p.box(Math.round(a(t.x) - 7), Math.round(a(t.y) - 7), 14, 14, 0x86d977);
        p.rect(Math.round(a(t.x) - 6), Math.round(a(t.y) + 5), 12, 1, PLAYER_COLORS[q].main);
        p.rect(Math.round(a(t.x) - 6), Math.round(a(t.y) - 6), 12, 1, PLAYER_COLORS[q].main);
      }
      // static walls as wooden logs
      for (const s of h.walls) this.paintLog(p, a(s.x1), a(s.y1), a(s.x2), a(s.y2), Math.max(2, Math.round(a(s.w * 2))));
      // bumpers
      for (const b of h.bumpers) {
        p.circle(a(b.x) + 1, a(b.y) + 2, a(b.r), 0x1e4a2a);
        p.ball(a(b.x), a(b.y), a(b.r), a(b.r), 0xff5a6e);
        p.ring(a(b.x), a(b.y), a(b.r) - 2, 0xffffff, 1);
        p.circle(a(b.x), a(b.y), a(b.r) * 0.35, 0xffe066);
      }
    });
  }

  private paintLog(p: Painter, x1: number, y1: number, x2: number, y2: number, size: number): void {
    p.stroke(x1 + 1, y1 + 2, x2 + 1, y2 + 2, size, 0x1e4a2a);
    p.stroke(x1, y1, x2, y2, size, 0x8a5a34);
    if (size >= 3) {
      const horiz = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
      p.stroke(x1 - (horiz ? 0 : 1), y1 - (horiz ? 1 : 0), x2 - (horiz ? 0 : 1), y2 - (horiz ? 1 : 0), 1, 0xc0834a);
    }
  }

  private ambientLife(): void {
    for (let i = 0; i < 3; i++) {
      const img = this.add.sprite(0, 0, 'mini-golf-mayhem-fly', 0).setScale(S).setDepth(700).setTint([0xffe066, 0xffffff, 0xff9fc0][i]);
      img.play('mini-golf-mayhem-flap');
      this.flies.push({ img, a: Math.random() * 6, s: 0.4 + Math.random() * 0.3, cx: this.vw * (0.2 + i * 0.3), cy: this.vh * (0.3 + (i % 2) * 0.4) });
    }
    for (let i = 0; i < 2; i++) {
      this.clouds.push(this.add.image(Math.random() * this.vw, this.vh * (0.25 + i * 0.5), 'mini-golf-mayhem-cloud').setScale(S * 1.4).setAlpha(0.08).setDepth(650));
    }
  }

  private makeBalls(): void {
    for (const p of this.players) {
      const c = PLAYER_COLORS[p];
      const key = makeTexture(this, `mini-golf-mayhem-ball-${p}`, 8, 8, (g) => {
        g.ball(4, 4, 3.6, 3.6, c.main);
        g.px(2, 2, 0xffffff);
        g.px(5, 5, shift(c.main, -0.3));
        g.outline(-0.8);
      });
      const shadow = this.add.image(0, 0, 'shadow').setScale(S * 0.45).setAlpha(0.3).setDepth(-20);
      const img = this.add.image(0, 0, key).setScale(S).setDepth(100);
      const mark = this.add.image(0, 0, playerMarkerKey(this, p)).setScale(S * 0.75).setDepth(800).setAngle(this.angleFor(p)).setOrigin(0.5, 1);
      const dots: Phaser.GameObjects.Image[] = [];
      for (let k = 0; k < 9; k++) dots.push(this.add.image(0, 0, 'mini-golf-mayhem-dot').setScale(S * (k === 8 ? 1.2 : 0.8)).setDepth(90).setTint(c.light).setVisible(false));
      const band = this.add.image(0, 0, 'mini-golf-mayhem-band').setScale(S * 0.9).setDepth(89).setTint(c.main).setVisible(false);
      this.balls.push({
        p, x: 0, y: 0, vx: 0, vy: 0, lastX: 0, lastY: 0, sunk: false, sinkT: 0, drown: 0, strokes: 0, total: 0,
        img, shadow, mark, dots, band, aimId: -1, aimDx: 0, aimDy: 0, cpuT: 0, skill: 0.5 + Math.random() * 0.4, inSand: false, trailT: 0,
      });
    }
    this.touch.on('down', (t: { pointerId: number; player: PlayerIndex }) => {
      const b = this.balls.find((x) => x.p === t.player);
      if (!b || this.isCpu(b.p) || b.aimId !== -1) return;
      b.aimId = t.pointerId;
      b.aimDx = b.aimDy = 0;
    });
    const release = (t: { pointerId: number; player: PlayerIndex; x: number; y: number; startX: number; startY: number }, cancel: boolean) => {
      const b = this.balls.find((x) => x.p === t.player);
      if (!b || b.aimId !== t.pointerId) return;
      b.aimId = -1;
      const dx = t.startX - t.x, dy = t.startY - t.y;
      if (!cancel && this.canShoot(b)) {
        const pw = Math.min(1, Math.hypot(dx, dy) / DRAG_FULL);
        if (pw > 0.1) this.shoot(b, Math.atan2(dy, dx), pw);
      }
      b.aimDx = b.aimDy = 0;
    };
    this.touch.on('up', (t: never) => release(t, false));
    this.touch.on('cancel', (t: never) => release(t, true));
  }

  // ───────────────────────────── HOLES ─────────────────────────────

  private loadHole(i: number, announce = true): void {
    this.hole = i;
    this.holeT = 0;
    this.holeLimit = HOLE_TIME;
    this.sinkOrder = [];
    for (const o of this.holeObjs) o.destroy();
    this.holeObjs = [];
    this.dynImgs = [];
    this.sparkles = [];
    const h = this.holes[i];
    this.bg.setTexture(`mini-golf-mayhem-hole${i}-${Math.ceil(this.vw / S)}`);
    this.cupImg.setPosition(h.cup.x, h.cup.y);
    this.flag.setPosition(h.cup.x + 2, h.cup.y + 2).setVisible(true);
    // moving parts
    const dyn = h.dyn(0);
    if (i === 0) {
      const hub = this.add.image(h.cup.x, h.cup.y, 'mini-golf-mayhem-hub').setScale(S).setDepth(-30);
      this.holeObjs.push(hub);
      dyn.forEach((_, k) => {
        const img = this.add.image(h.cup.x, h.cup.y, 'mini-golf-mayhem-sail').setOrigin(-0.5, 0.5).setScale(S * 1.9, S).setDepth(400);
        this.holeObjs.push(img);
        this.dynImgs.push({ img, i: k, kind: 'mill' });
      });
    } else {
      dyn.forEach((s, k) => {
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
        const img = this.add.image(0, 0, 'mini-golf-mayhem-slider').setDisplaySize(len + 10, 14).setDepth(400);
        if (Math.abs(s.x2 - s.x1) < 1) img.setAngle(90);
        this.holeObjs.push(img);
        this.dynImgs.push({ img, i: k, kind: 'slide' });
      });
    }
    // water sparkles + lily pads
    const waterPts: { x: number; y: number }[] = [];
    for (let k = 0; k < 400 && waterPts.length < 14; k++) {
      const x = this.L + Math.random() * (this.R - this.L), y = this.T + Math.random() * (this.B - this.T);
      if (this.inWater(h, x, y) && this.inWater(h, x + 8, y) && this.inWater(h, x - 8, y)) waterPts.push({ x, y });
    }
    waterPts.forEach((pt, k) => {
      if (k < 4) {
        const lily = this.add.image(pt.x, pt.y, 'mini-golf-mayhem-lily').setScale(S).setDepth(-35).setAngle(Math.random() * 360);
        this.tweens.add({ targets: lily, angle: lily.angle + 20, y: pt.y + 2, yoyo: true, repeat: -1, duration: 1800 + k * 300, ease: 'Sine.easeInOut' });
        this.holeObjs.push(lily);
      } else {
        const sp = this.add.image(pt.x, pt.y, 'mini-golf-mayhem-sparkle').setScale(S).setDepth(-35).setAlpha(0);
        sp.setData('ph', Math.random() * 6);
        this.sparkles.push(sp);
        this.holeObjs.push(sp);
      }
    });
    // reset balls to tees
    for (const b of this.balls) {
      const t = this.tee(b.p);
      b.x = b.lastX = t.x; b.y = b.lastY = t.y;
      b.vx = b.vy = 0;
      b.sunk = false; b.sinkT = 0; b.drown = 0; b.strokes = 0;
      b.cpuT = 0.6 + Math.random() * 0.8;
      b.img.setVisible(true).setScale(S).setAlpha(1);
      b.shadow.setVisible(true);
      b.mark.setVisible(true);
      b.aimId = -1;
    }
    if (announce) this.banner(`HOLE ${i + 1}/3`, h.name, '#ffe066');
  }

  private banner(big: string, small: string, color: string): void {
    for (const [deg, y] of [[0, this.vh * 0.66], [180, this.vh * 0.34]] as const) {
      const c = this.add.container(this.vw / 2, y).setAngle(deg).setDepth(3000);
      c.add(txt(this, 0, -10, big, { size: 32, color, strokeWidth: 7 }));
      if (small) c.add(txt(this, 0, 20, small, { size: 15, color: '#ffffff' }));
      this.tweens.add({ targets: c, scale: { from: 0.3, to: 1 }, duration: 300, ease: 'Back.easeOut' });
      this.tweens.add({ targets: c, alpha: 0, delay: 1300, duration: 300, onComplete: () => c.destroy() });
    }
  }

  onStart(): void {
    this.banner('HOLE 1/3', this.holes[0].name, '#ffe066');
  }

  // ───────────────────────────── PHYSICS ─────────────────────────────

  private canShoot(b: GBall): boolean {
    return this.state === 'play' && this.between <= 0 && this.holeT > INTRO_T && !b.sunk && b.drown <= 0 && b.vx === 0 && b.vy === 0;
  }

  private shoot(b: GBall, ang: number, pw: number): void {
    const v = MAX_SHOT * (0.12 + pw * 0.88);
    b.vx = Math.cos(ang) * v;
    b.vy = Math.sin(ang) * v;
    b.lastX = b.x; b.lastY = b.y;
    b.strokes++;
    b.total++;
    Audio.sfx(pw > 0.7 ? 'hit' : 'click', 1 + b.p * 0.1);
    Vfx.squash(this, b.img, 1.5, 0.6, 160);
    burst(this, b.x, b.y, { tex: 'dot2', count: 6, tint: [0xffffff, PLAYER_COLORS[b.p].light], speed: [30, 90], life: 300 });
    if (pw > 0.8) Vfx.speedLines(this, b.x, b.y, (ang * 180) / Math.PI, PLAYER_COLORS[b.p].light);
  }

  /** One physics step for a ball against the course at hole time t. Returns event flags. */
  private stepBall(s: { x: number; y: number; vx: number; vy: number }, h: HoleDef, t: number, dt: number, fx: boolean): { wall: number; bump: boolean } {
    const sand = this.inSand(h, s.x, s.y);
    const sp = Math.hypot(s.vx, s.vy);
    let ev = { wall: 0, bump: false };
    if (sp > 0) {
      const k = sand ? 3.6 : 0.75;
      const decel = sand ? 120 : 34;
      const ns = Math.max(0, sp * Math.exp(-k * dt) - decel * dt);
      s.vx *= ns / sp; s.vy *= ns / sp;
    }
    // gentle slope into the cup
    const cdx = h.cup.x - s.x, cdy = h.cup.y - s.y;
    const cd = Math.hypot(cdx, cdy);
    if (cd < 22 && cd > 0.5) {
      s.vx += (cdx / cd) * 260 * dt * (1 - cd / 22);
      s.vy += (cdy / cd) * 260 * dt * (1 - cd / 22);
    }
    const n = Math.max(1, Math.ceil((Math.hypot(s.vx, s.vy) * dt) / 4));
    const hdt = dt / n;
    const dyn = h.dyn(t);
    for (let i = 0; i < n; i++) {
      s.x += s.vx * hdt;
      s.y += s.vy * hdt;
      for (const w of h.walls) { const e = this.collideSeg(s, w); if (e > ev.wall) ev.wall = e; }
      for (const w of dyn) { const e = this.collideSeg(s, w); if (e > ev.wall) ev.wall = e; }
      for (const c of h.bumpers) {
        const dx = s.x - c.x, dy = s.y - c.y, d = Math.hypot(dx, dy), m = c.r + BALL_R;
        if (d < m && d > 0) {
          const nx = dx / d, ny = dy / d;
          s.x = c.x + nx * m; s.y = c.y + ny * m;
          const vn = s.vx * nx + s.vy * ny;
          if (vn < 0) {
            s.vx -= (1 + c.k) * vn * nx; s.vy -= (1 + c.k) * vn * ny;
            s.vx += nx * 60; s.vy += ny * 60;
            ev = { ...ev, bump: true };
          }
        }
      }
    }
    if (Math.hypot(s.vx, s.vy) < (fx ? 7 : 7)) { s.vx = 0; s.vy = 0; }
    return ev;
  }

  /** Ball vs thick (possibly moving / rotating) segment. Returns impact speed. */
  private collideSeg(s: { x: number; y: number; vx: number; vy: number }, w: Seg): number {
    const ex = w.x2 - w.x1, ey = w.y2 - w.y1;
    const l2 = ex * ex + ey * ey || 1;
    const u = Phaser.Math.Clamp(((s.x - w.x1) * ex + (s.y - w.y1) * ey) / l2, 0, 1);
    const qx = w.x1 + ex * u, qy = w.y1 + ey * u;
    const dx = s.x - qx, dy = s.y - qy;
    const d = Math.hypot(dx, dy);
    const m = BALL_R + w.w;
    if (d >= m || d === 0) return 0;
    const nx = dx / d, ny = dy / d;
    s.x = qx + nx * m; s.y = qy + ny * m;
    // surface velocity
    let wvx = w.vx, wvy = w.vy;
    if (w.omega) { wvx += -w.omega * (qy - w.cy); wvy += w.omega * (qx - w.cx); }
    const rvx = s.vx - wvx, rvy = s.vy - wvy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    const e = 0.72;
    s.vx = wvx + rvx - (1 + e) * vn * nx;
    s.vy = wvy + rvy - (1 + e) * vn * ny;
    return -vn;
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    const h = this.holes[this.hole];
    // moving parts follow hole time
    const dyn = h.dyn(this.holeT);
    for (const d of this.dynImgs) {
      const s = dyn[d.i];
      if (!s) continue;
      if (d.kind === 'mill') d.img.setRotation(Math.atan2(s.y2 - s.y1, s.x2 - s.x1));
      else d.img.setPosition((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2);
    }
    for (const sp of this.sparkles) {
      const ph = sp.getData('ph') as number;
      const v = Math.sin(this.t * 2.2 + ph);
      sp.setAlpha(v > 0.75 ? (v - 0.75) * 4 : 0);
    }
    for (const f of this.flies) {
      f.a += dt * f.s;
      f.img.setPosition(f.cx + Math.sin(f.a * 1.3) * 120, f.cy + Math.sin(f.a * 2.1) * 50);
      f.img.setFlipX(Math.cos(f.a * 1.3) < 0);
    }
    for (const c of this.clouds) {
      c.x += dt * 9;
      if (c.x > this.vw + 120) c.x = -120;
    }
    for (const b of this.balls) this.drawBall(b);
    // HUD info
    const sec = Math.max(0, Math.ceil(this.holeLimit - this.holeT));
    const label = this.state === 'play' || this.state === 'end' ? `HOLE ${this.hole + 1}/3 · ⏱ ${this.between > 0 ? 0 : sec}` : `HOLE 1/3`;
    for (const t of this.infoTexts) {
      if (t.text !== label) t.setText(label);
      t.setColor(sec <= 5 && this.state === 'play' && this.between <= 0 ? '#ff7a85' : '#fff8e7');
    }
  }

  private drawBall(b: GBall): void {
    const bob = Math.sin(this.t * 4 + b.p) * 2;
    b.img.setPosition(b.x, b.y);
    b.shadow.setPosition(b.x + 2, b.y + 5);
    b.mark.setPosition(b.x, b.y + (this.angleFor(b.p) === 180 ? 12 : -10) + bob * (this.angleFor(b.p) === 180 ? -1 : 1));
    // aim guide
    const aiming = b.aimId !== -1 && this.canShoot(b);
    let dx = 0, dy = 0;
    if (aiming) {
      const f = this.touch.touchesFor(b.p).find((t) => t.pointerId === b.aimId);
      if (f) { dx = f.startX - f.x; dy = f.startY - f.y; }
    } else if (b.aimDx || b.aimDy) { dx = b.aimDx; dy = b.aimDy; }
    const pw = Math.min(1, Math.hypot(dx, dy) / DRAG_FULL);
    const show = pw > 0.1 && this.canShoot(b);
    const ang = Math.atan2(dy, dx);
    b.dots.forEach((d, k) => {
      if (!show) { d.setVisible(false); return; }
      const dist = 12 + (k / 8) * (20 + pw * 120);
      const wob = (this.t * 60) % 8;
      d.setVisible(true).setPosition(b.x + Math.cos(ang) * (dist + (k < 8 ? wob * pw : 0)), b.y + Math.sin(ang) * (dist + (k < 8 ? wob * pw : 0)));
      d.setTint(pw > 0.85 ? 0xff7a85 : pw > 0.5 ? 0xffe066 : PLAYER_COLORS[b.p].light).setAlpha(k === 8 ? 1 : 0.4 + (k / 8) * 0.6);
    });
    if (show) b.band.setVisible(true).setPosition(b.x, b.y).setScale(S * (0.5 + pw * 0.6)).setAlpha(0.8);
    else if (this.canShoot(b)) b.band.setVisible(true).setPosition(b.x, b.y).setScale(S * (0.62 + Math.sin(this.t * 6 + b.p) * 0.08)).setAlpha(0.45);
    else b.band.setVisible(false);
  }

  tick(dt: number): void {
    const h = this.holes[this.hole];
    if (this.between > 0) {
      this.between -= dt;
      if (this.between <= 0) {
        if (this.hole >= 2) { this.done = true; this.finish(); return; }
        this.loadHole(this.hole + 1);
      }
      return;
    }
    this.holeT += dt;
    for (const b of this.balls) this.updateBall(b, h, dt);
    this.collideBalls();
    for (const b of this.balls) if (this.isCpu(b.p)) this.bot(b, h, dt);
    const left = this.balls.filter((b) => !b.sunk);
    // Last one out gets a short hurry-up instead of the whole clock.
    if (left.length === 1 && this.balls.length > 1 && this.holeLimit > this.holeT + 8) {
      this.holeLimit = this.holeT + 8;
      Vfx.popText(this, this.vw / 2, this.vh / 2 + 40, 'เร็วเข้า! 8 วิ', '#ff7a85', 16, 0);
      Vfx.popText(this, this.vw / 2, this.vh / 2 - 40, 'เร็วเข้า! 8 วิ', '#ff7a85', 16, 180);
    }
    if (left.length === 0 || this.holeT >= this.holeLimit) this.endHole();
    if (this.elapsed > 130 && !this.done) { this.done = true; this.finish(); }
  }

  private updateBall(b: GBall, h: HoleDef, dt: number): void {
    if (b.sunk) {
      b.sinkT += dt;
      return;
    }
    if (b.drown > 0) {
      b.drown -= dt;
      if (b.drown <= 0) {
        b.x = b.lastX; b.y = b.lastY; b.vx = b.vy = 0;
        b.img.setVisible(true).setScale(0);
        b.shadow.setVisible(true);
        this.tweens.add({ targets: b.img, scale: S, duration: 250, ease: 'Back.easeOut' });
        Vfx.sparkle(this, b.x, b.y, [0xffffff, PLAYER_COLORS[b.p].light]);
      }
      return;
    }
    const moving = b.vx !== 0 || b.vy !== 0;
    const ev = this.stepBall(b, h, this.holeT, dt, true);
    if (ev.wall > 60) { Audio.sfx('bounce', 1.3 + b.p * 0.05); if (ev.wall > 220) Vfx.hit(this, b.x, b.y, [0xffffff, 0xffe066]); }
    if (ev.bump) { Audio.sfx('bounce', 0.8); Vfx.hit(this, b.x, b.y, [0xff5a6e, 0xffe066, 0xffffff]); Vfx.popText(this, b.x, b.y - 14, 'BOING!', '#ffe066', 12, this.angleFor(b.p)); }
    const sand = this.inSand(h, b.x, b.y);
    if (sand && moving && Math.random() < 0.5) burst(this, b.x, b.y, { tex: 'dot2', count: 2, tint: [0xedd8a0, 0xd8bd80], speed: [20, 50], life: 260 });
    if (sand && !b.inSand && moving) Audio.sfx('land');
    b.inSand = sand;
    if (moving) {
      b.trailT -= dt;
      if (b.trailT <= 0 && Math.hypot(b.vx, b.vy) > 160) {
        b.trailT = 0.04;
        const g = this.add.image(b.x, b.y, 'mini-golf-mayhem-dot').setScale(S).setTint(PLAYER_COLORS[b.p].light).setAlpha(0.6).setDepth(95);
        this.tweens.add({ targets: g, alpha: 0, scale: 0.5, duration: 260, onComplete: () => g.destroy() });
      }
    }
    // cup
    const d = Math.hypot(b.x - h.cup.x, b.y - h.cup.y);
    const sp = Math.hypot(b.vx, b.vy);
    if (d < CUP_R - 1) {
      if (sp < 300) this.sink(b, h);
      else if (Math.random() < 0.5) { Audio.sfx('tick'); }
    }
    // water
    if (this.inWater(h, b.x, b.y)) {
      b.drown = 0.9;
      b.strokes++;
      b.total++;
      b.vx = b.vy = 0;
      b.img.setVisible(false);
      b.shadow.setVisible(false);
      splash(this, b.x, b.y);
      Audio.sfx('splash', 1 + b.p * 0.1);
      Vfx.popText(this, b.x, b.y - 10, 'ตกน้ำ! +1', '#bfeaff', 14, this.angleFor(b.p));
    }
  }

  private sink(b: GBall, h: HoleDef): void {
    b.sunk = true;
    b.vx = b.vy = 0;
    const place = this.sinkOrder.length;
    this.sinkOrder.push(b.p);
    const pts = PTS[place] ?? 1;
    this.addScore(b.p, pts);
    this.tweens.add({ targets: b.img, x: h.cup.x, y: h.cup.y, scale: 0.4, duration: 220, ease: 'Quad.easeIn', onComplete: () => b.img.setVisible(false) });
    b.shadow.setVisible(false);
    b.mark.setVisible(false);
    Audio.sfx(place === 0 ? 'power' : 'coin', 1 + b.p * 0.08);
    Vfx.confetti(this, h.cup.x, h.cup.y, place === 0 ? 50 : 24);
    const ace = b.strokes === 1;
    const label = ace ? 'HOLE IN ONE!!' : `ที่ ${place + 1}! +${pts}`;
    const ang = this.angleFor(b.p);
    Vfx.popText(this, h.cup.x, h.cup.y + (ang === 180 ? 28 : -28), label, toCss(PLAYER_COLORS[b.p].light), ace ? 20 : 18, ang);
    if (ace) { this.addScore(b.p, 2); Vfx.shake(this, 0.006, 200); }
    this.tweens.add({ targets: this.flag, angle: { from: -15, to: 0 }, duration: 400, ease: 'Elastic.easeOut' });
  }

  private collideBalls(): void {
    const list = this.balls.filter((b) => !b.sunk && b.drown <= 0);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = BALL_R * 2;
      if (d >= m || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      const o = (m - d) / 2;
      a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel <= 0) continue;
      const imp = rel * 0.95;
      a.vx -= nx * imp; a.vy -= ny * imp;
      b.vx += nx * imp; b.vy += ny * imp;
      if (rel > 50) {
        Audio.sfx('hit', 1.5);
        Vfx.hit(this, (a.x + b.x) / 2, (a.y + b.y) / 2, [0xffffff, PLAYER_COLORS[a.p].light, PLAYER_COLORS[b.p].light]);
        if (rel > 200) Vfx.popText(this, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12, 'ชน!', '#ffffff', 13);
      }
    }
  }

  private endHole(): void {
    this.between = 2.4;
    for (const b of this.balls) { b.aimId = -1; if (!b.sunk) { b.vx = b.vy = 0; } }
    Audio.sfx('finish');
    const order = this.sinkOrder.map((p, i) => `P${p + 1}+${PTS[i]}`).join('  ');
    this.banner(`HOLE ${this.hole + 1} จบ!`, order || 'ไม่มีใครลงหลุม!', '#7ee8b0');
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: GBall, h: HoleDef, dt: number): void {
    if (!this.canShoot(b)) return;
    b.cpuT -= dt;
    if (b.cpuT > 0) return;
    b.cpuT = 0.5 + Math.random() * 0.9 + (1 - b.skill) * 0.6;
    // Try a fan of shots in a quick simulation and keep the best.
    const direct = Math.atan2(h.cup.y - b.y, h.cup.x - b.x);
    let best = { ang: direct, pw: 0.5, score: Infinity };
    const tries = 26;
    for (let k = 0; k < tries; k++) {
      const ang = k < 12 ? direct + (Math.random() - 0.5) * 0.5 : Math.random() * Math.PI * 2;
      const pw = 0.15 + Math.random() * 0.85;
      const sc = this.simulate(b, h, ang, pw);
      if (sc < best.score) best = { ang, pw, score: sc };
    }
    const err = (1 - b.skill) * 0.16 + 0.02;
    this.shoot(b, best.ang + (Math.random() - 0.5) * 2 * err, Phaser.Math.Clamp(best.pw * (1 + (Math.random() - 0.5) * err * 1.5), 0.1, 1));
  }

  private simulate(b: GBall, h: HoleDef, ang: number, pw: number): number {
    const v = MAX_SHOT * (0.12 + pw * 0.88);
    const s = { x: b.x, y: b.y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v };
    const dt = 1 / 24;
    let t = this.holeT;
    for (let i = 0; i < 110; i++) {
      this.stepBall(s, h, t, dt, false);
      t += dt;
      const d = Math.hypot(s.x - h.cup.x, s.y - h.cup.y);
      if (d < CUP_R - 1 && Math.hypot(s.vx, s.vy) < 300) return -1000 + i;
      if (this.inWater(h, s.x, s.y)) return 900;
      if (s.vx === 0 && s.vy === 0) break;
    }
    // rough "path length" estimate: penalise ending behind walls by line-of-sight check
    let sc = Math.hypot(s.x - h.cup.x, s.y - h.cup.y);
    if (this.blocked(h, s.x, s.y)) sc += 80;
    if (this.inSand(h, s.x, s.y)) sc += 30;
    return sc;
  }

  private blocked(h: HoleDef, x: number, y: number): boolean {
    const cx = h.cup.x, cy = h.cup.y;
    for (const w of h.walls) if (this.segX(x, y, cx, cy, w.x1, w.y1, w.x2, w.y2)) return true;
    return false;
  }

  private segX(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
    const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (d === 0) return false;
    const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
    const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
    return u > 0 && u < 1 && v > 0 && v < 1;
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => this.score[p] * 1000 - (this.balls.find((b) => b.p === p)?.total ?? 0);
    return rankBy(this.players, value).map((r) => ({ ...r, score: this.score[r.player] }));
  }
}


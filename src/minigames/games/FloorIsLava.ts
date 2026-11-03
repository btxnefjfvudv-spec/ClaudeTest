import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Avatar, playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { SplitKit } from '../kit/SplitKit';

/** Half width of the shaft (inner wall face to centre). */
const HW = 92;
/** Feet offset from the wall face while clinging. */
const CLING = 13;
const JUMP_T = 0.36;
const JUMP_H = 84;
const JUMP_ARC = 26;
const TOWER = 15000;
const FLOOR_GAP = 480;
const METRE = 30;
/** Body span above the feet that can touch hazards. */
const BODY_TOP = 40;
const BODY_BOT = 4;

interface Spike { side: number; y0: number; y1: number; imgs: Phaser.GameObjects.TileSprite[] }
interface Pipe { side: number; y: number; period: number; phase: number; imgs: Phaser.GameObjects.Sprite[] }

interface Climber {
  p: PlayerIndex;
  av: Avatar;
  cx: number;
  side: number;
  x: number;
  y: number;
  /** 'cling' | 'jump' | 'stun' | 'dead' */
  mode: 'cling' | 'jump' | 'stun' | 'dead';
  t: number;
  fromX: number;
  fromY: number;
  clingT: number;
  perch?: Pipe;
  buffer: number;
  best: number;
  camY: number;
  layers: { ts: Phaser.GameObjects.TileSprite; f: number }[];
  wallL: Phaser.GameObjects.TileSprite;
  wallR: Phaser.GameObjects.TileSprite;
  trimL: Phaser.GameObjects.TileSprite;
  trimR: Phaser.GameObjects.TileSprite;
  lava: Phaser.GameObjects.TileSprite;
  lavaBody: Phaser.GameObjects.TileSprite;
  glow: Phaser.GameObjects.Image;
  danger: Phaser.GameObjects.Image;
  embers: Phaser.GameObjects.Particles.ParticleEmitter;
  reticle: Phaser.GameObjects.Image;
  signs: Phaser.GameObjects.Text[];
  lamps: Phaser.GameObjects.Image[];
  meterBar: Phaser.GameObjects.Image;
  meterLava: Phaser.GameObjects.Image;
  meterMarks: Phaser.GameObjects.Image[];
  floor: Phaser.GameObjects.TileSprite;
  floorGone: boolean;
  cpuDelay: number;
  cpuSkill: number;
  cpuWait: number;
  deadAt: number;
  warnT: number;
  outText?: Phaser.GameObjects.Text;
}

/** #2 — Wall-jump up a school stairwell while the lava rises. Split screen per player. */
export default class FloorIsLava extends BaseMinigame {
  private split!: SplitKit;
  private climbers: Climber[] = [];
  private spikes: Spike[] = [];
  private pipes: Pipe[] = [];
  private lavaY = 160;
  private lavaV = 0;
  private bubbleT = 0;

  constructor() {
    super(CATALOG['floor-is-lava']);
  }

  /** World X centre of a player's shaft copy (far away from the HUD camera). */
  private cxOf(p: PlayerIndex): number {
    return 4000 + p * 1400;
  }

  setup(): void {
    this.climbers = [];
    this.lavaY = 170;
    this.lavaV = 0;
    this.bubbleT = 0;
    this.split = new SplitKit(this);
    this.paintArt();
    this.buildTower();
    for (const p of this.players) this.makeShaft(p);
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) if (!this.players.includes(p)) this.split.cams[p].setVisible(false);
    this.touch.on('down', (t: { player: PlayerIndex }) => {
      if (this.state !== 'play' || this.isCpu(t.player)) return;
      const c = this.climbers.find((k) => k.p === t.player);
      if (c) c.buffer = 0.16;
    });
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const iw = Math.round((HW * 2) / S);
    // Far back wall of the stairwell: dark concrete, lit windows, floor slabs.
    makeTexture(this, 'floor-is-lava-back', iw, 120, (p) => {
      const r = rng(31);
      p.rect(0, 0, iw, 120, 0x2c2442);
      for (let y = 0; y < 120; y += 12) p.hline(0, y, iw, 0x261f3a);
      for (let x = 0; x < iw; x += 21) p.vline(x, 0, 120, 0x261f3a);
      for (let i = 0; i < 90; i++) p.px(Math.floor(r() * iw), Math.floor(r() * 120), r() > 0.5 ? 0x352c50 : 0x221b34);
      // floor slab
      p.rect(0, 100, iw, 8, 0x3d3358);
      p.hline(0, 100, iw, 0x564a78);
      p.hline(0, 107, iw, 0x1c1630);
      // windows with warm light
      for (const wx of [10, iw - 34]) {
        p.rect(wx - 1, 34, 26, 40, 0x1c1630);
        p.gradient(wx, 35, 24, 38, [0xffd98a, 0xffb35c, 0xff8a4a]);
        p.vline(wx + 12, 35, 38, 0x6b4a3a);
        p.hline(wx, 54, 24, 0x6b4a3a);
        p.hline(wx, 35, 24, 0xfff1c9);
      }
      // stair rail silhouette
      for (let i = 0; i < 10; i++) p.rect(32 + i * 2, 96 - i * 4, 3, 4, 0x3d3358);
      p.line(30, 86, 54, 50, 0x4a3f68);
    });
    // Mid layer: vertical pipes and cables with indicator lights (transparent).
    makeTexture(this, 'floor-is-lava-mid', iw, 160, (p) => {
      p.rect(6, 0, 5, 160, 0x4c5d7a);
      p.vline(6, 0, 160, 0x7187ab);
      p.vline(10, 0, 160, 0x34405a);
      for (let y = 10; y < 160; y += 40) { p.rect(5, y, 7, 3, 0x8fa3c4); p.hline(5, y + 3, 7, 0x2a3348); }
      p.rect(iw - 12, 0, 3, 160, 0x3a3048);
      p.vline(iw - 12, 0, 160, 0x564a6a);
      for (let y = 0; y < 160; y++) {
        const x = Math.round(iw - 22 + Math.sin(y / 14) * 3);
        p.px(x, y, 0x1f1a2c);
      }
      p.box(iw - 18, 60, 10, 12, 0x5d6b7d);
      p.px(iw - 15, 64, 0x3ed17a);
    });
    // Brick walls (left & right), tile vertically.
    const brick = (key: string, lit: boolean) =>
      makeTexture(this, key, 48, 32, (p) => {
        const r = rng(lit ? 3 : 4);
        const base = lit ? 0x9a5544 : 0x7d4438;
        p.rect(0, 0, 48, 32, shift(base, -0.55));
        for (let row = 0; row < 4; row++) {
          const off = row % 2 ? 8 : 0;
          for (let bx = -16; bx < 48; bx += 16) {
            const x = bx + off, y = row * 8;
            const c = r() > 0.75 ? shift(base, 0.08) : r() > 0.5 ? shift(base, -0.08) : base;
            for (let j = 0; j < 7; j++) for (let i = 0; i < 15; i++) {
              const px = x + i;
              if (px < 0 || px >= 48) continue;
              let col = c;
              if (j === 0) col = shift(c, 0.28);
              else if (j === 6) col = shift(c, -0.3);
              p.px(px, y + j, col);
            }
            if (r() > 0.6) p.px(Math.max(0, x + 3 + Math.floor(r() * 9)), y + 2 + Math.floor(r() * 3), shift(c, -0.25));
          }
        }
      });
    brick('floor-is-lava-brickL', false);
    brick('floor-is-lava-brickR', true);
    // Inner wall trim (concrete lip): 6 px wide, lit on the right wall.
    makeTexture(this, 'floor-is-lava-trimL', 6, 16, (p) => {
      p.rect(0, 0, 6, 16, 0x8e8aa0);
      p.vline(0, 0, 16, 0xb4b0c4);
      p.vline(5, 0, 16, 0x56526a);
      p.vline(4, 0, 16, 0x6c687f);
      p.px(2, 4, 0x6c687f); p.px(3, 11, 0x6c687f);
      p.hline(0, 15, 6, 0x6c687f);
    });
    makeTexture(this, 'floor-is-lava-trimR', 6, 16, (p) => {
      p.rect(0, 0, 6, 16, 0xb0acc2);
      p.vline(0, 0, 16, 0xeae6f6);
      p.vline(1, 0, 16, 0xcfcbe0);
      p.vline(5, 0, 16, 0x7a768e);
      p.px(3, 4, 0x8e8aa0); p.px(2, 11, 0x8e8aa0);
      p.hline(0, 15, 6, 0x8e8aa0);
    });
    // Spike tooth (points right = into the shaft from the left wall).
    makeTexture(this, 'floor-is-lava-spike', 12, 8, (p) => {
      p.rect(0, 0, 3, 8, 0x4a4458);
      p.vline(0, 0, 8, 0x6a6480);
      p.tri(2, 0, 2, 8, 11.5, 4, 0xc9ccd9);
      p.tri(2, 0, 2, 4, 11.5, 4, 0xf2f4fa);
      p.hline(3, 6, 5, 0x8c8ea3);
      p.px(10, 4, 0xffffff);
      p.px(2, 7, 0xff5a3d);
    });
    // Hot pipe: 3 frames — cool / warming / hot.
    makeSheet(this, 'floor-is-lava-pipe', 28, 12, 3, (p, i) => {
      const body = [0x7c8aa3, 0xc9785a, 0xff6a3d][i];
      const hi = [0xb7c4da, 0xffb38a, 0xffe066][i];
      p.rect(0, 0, 5, 12, 0x4a4458);
      p.vline(0, 0, 12, 0x6a6480);
      p.rect(4, 2, 4, 8, shift(body, -0.25));
      p.rect(7, 3, 19, 6, body);
      p.hline(7, 3, 19, hi);
      p.hline(7, 8, 19, shift(body, -0.4));
      p.rect(24, 2, 4, 8, shift(body, -0.15));
      p.vline(24, 2, 8, hi);
      p.px(26, 5, 0x1b1f3b); p.px(26, 6, 0x1b1f3b);
      if (i === 2) { p.px(12, 5, 0xfff8e7); p.px(18, 6, 0xfff8e7); p.hline(10, 4, 3, 0xfff1c9); }
      p.outline(-0.75);
    });
    // Lava surface (tiles horizontally) and body.
    makeTexture(this, 'floor-is-lava-surface', 48, 14, (p) => {
      for (let x = 0; x < 48; x++) {
        const h = Math.round(3 + Math.sin((x / 48) * Math.PI * 4) * 1.6 + Math.sin((x / 48) * Math.PI * 2 + 1) * 1.2);
        for (let y = h; y < 14; y++) {
          let c = 0xff5a3d;
          if (y === h) c = 0xfff1a8;
          else if (y === h + 1) c = 0xffd04a;
          else if (y < h + 4) c = 0xff9f43;
          else if (y > 10) c = 0xe0402e;
          p.px(x, y, c);
        }
      }
      p.px(8, 7, 0xffd04a); p.px(30, 9, 0xffd04a); p.px(31, 9, 0xffe98a);
    });
    makeTexture(this, 'floor-is-lava-body', 32, 32, (p) => {
      const r = rng(9);
      p.gradient(0, 0, 32, 32, [0xe0402e, 0xb32a2a, 0x8a1f2a]);
      for (let i = 0; i < 6; i++) {
        let x = r() * 32, y = r() * 32;
        for (let k = 0; k < 8; k++) { p.px(x, y, 0x5c1424); x += r() * 3 - 1; y += r() * 2 - 0.5; }
      }
      for (let i = 0; i < 10; i++) p.px(Math.floor(r() * 32), Math.floor(r() * 32), 0xff7a3d);
    });
    makeTexture(this, 'floor-is-lava-glow', 4, 48, (p) => {
      for (let y = 0; y < 48; y++) p.hline(0, y, 4, y > 30 ? 0xff9f43 : 0xff6a3d, Math.round(Math.pow(y / 48, 2.2) * 150));
    });
    makeTexture(this, 'floor-is-lava-danger', 4, 64, (p) => {
      for (let y = 0; y < 64; y++) p.hline(0, y, 4, 0xff2a2a, Math.round(Math.pow(y / 64, 1.6) * 200));
    });
    // Landing reticle: ok (white) and bad (red X).
    makeSheet(this, 'floor-is-lava-reticle', 11, 11, 2, (p, i) => {
      if (i === 0) {
        p.ring(5.5, 5.5, 5, 0xffffff, 1);
        p.px(5, 5, 0xffffff);
      } else {
        for (let k = 0; k < 9; k++) { p.px(1 + k, 1 + k, 0xff3b3b); p.px(9 - k, 1 + k, 0xff3b3b); p.px(2 + k, 1 + k, 0xff3b3b); p.px(8 - k, 1 + k, 0xff3b3b); }
      }
    });
    // Wall lamp (flickers) and classroom floor slab.
    makeTexture(this, 'floor-is-lava-lamp', 10, 12, (p) => {
      p.rect(3, 0, 4, 3, 0x4a4458);
      p.ball(5, 7, 4.5, 4.5, 0xffe9a8);
      p.rect(1, 3, 8, 2, 0x6a6480);
      p.outline(-0.7);
    });
    makeTexture(this, 'floor-is-lava-floor', 16, 10, (p) => {
      p.rect(0, 0, 16, 10, 0xc98a4b);
      p.hline(0, 0, 16, 0xf0c48a);
      p.hline(0, 1, 16, 0xdba366);
      p.vline(7, 2, 8, 0x9e6234);
      p.rect(0, 6, 16, 4, 0x8a5530);
      p.hline(0, 6, 16, 0x6b3f22);
    });
    makeTexture(this, 'floor-is-lava-meter', 4, 64, (p) => {
      p.rect(0, 0, 4, 64, 0x1b1f3b);
      p.rect(1, 1, 2, 62, 0x3a3f6b);
    });
    makeTexture(this, 'floor-is-lava-flame', 9, 10, (p) => {
      p.tri(4.5, 0, 0, 8, 9, 8, 0xff5a3d);
      p.ball(4.5, 6.5, 4, 3.5, 0xff9f43, false);
      p.ball(4.5, 7, 2, 2, 0xffe066, false);
      p.outline(-0.7);
    });
    makeTexture(this, 'floor-is-lava-steam', 6, 6, (p) => { p.circle(3, 3, 3, 0xffffff); });
  }

  // ───────────────────────────── LEVEL ─────────────────────────────

  private buildTower(): void {
    this.spikes = [];
    this.pipes = [];
    const r = rng(20260);
    // One hazard per height band, alternating walls at random, so there is
    // always a comfortable way past (no impossible stagger between walls).
    let y = -230;
    let side = -1;
    let run = 0;
    while (y > -TOWER) {
      const hard = Math.min(1, -y / 9000);
      const flip = run >= 2 || r() < 0.55;
      if (flip) { side = -side; run = 0; } else run++;
      if (r() < 0.28 + hard * 0.1) {
        this.pipes.push({ side, y, period: 2.6 - hard * 0.6 + r() * 0.8, phase: r() * 3, imgs: [] });
        y -= 60;
      } else {
        const len = 36 + r() * 28 + hard * 26;
        this.spikes.push({ side, y0: y - len, y1: y, imgs: [] });
        y -= len;
      }
      y -= 110 + r() * 130 - hard * 30;
    }
    // No traps: the landing spot from any pipe perch must be free of spikes,
    // and no pipe may sit inside the landing window of another pipe.
    this.spikes = this.spikes.filter((s) => !this.pipes.some((pp) => {
      const ly = pp.y - 9 - JUMP_H;
      return s.side === -pp.side && ly - BODY_TOP - 10 < s.y1 && ly + 10 > s.y0;
    }));
  }

  private makeShaft(p: PlayerIndex): void {
    const cx = this.cxOf(p);
    const vw = this.split.viewW, vh = this.split.viewH;
    const iw = HW * 2;
    const wallW = vw / 2 - HW + 8;
    const layers = [
      { ts: this.add.tileSprite(cx - HW, 0, iw / S, vh / S + 4, 'floor-is-lava-back').setOrigin(0).setScale(S).setDepth(-100), f: 0.45 },
      { ts: this.add.tileSprite(cx - HW, 0, iw / S, vh / S + 4, 'floor-is-lava-mid').setOrigin(0).setScale(S).setDepth(-90).setAlpha(0.9), f: 0.75 },
    ];
    const wallL = this.add.tileSprite(cx - HW - wallW, 0, wallW / S, vh / S + 4, 'floor-is-lava-brickL').setOrigin(0).setScale(S).setDepth(-50);
    const wallR = this.add.tileSprite(cx + HW, 0, wallW / S, vh / S + 4, 'floor-is-lava-brickR').setOrigin(0).setScale(S).setDepth(-50);
    const trimL = this.add.tileSprite(cx - HW - 12, 0, 6, vh / S + 4, 'floor-is-lava-trimL').setOrigin(0).setScale(S).setDepth(-45);
    const trimR = this.add.tileSprite(cx + HW, 0, 6, vh / S + 4, 'floor-is-lava-trimR').setOrigin(0).setScale(S).setDepth(-45);
    // starting classroom floor
    const floor = this.add.tileSprite(cx - HW, 0, iw / S, 10, 'floor-is-lava-floor').setOrigin(0, 0).setScale(S).setDepth(-40);
    // hazards for this copy
    for (const s of this.spikes) {
      const len = s.y1 - s.y0;
      const x = s.side < 0 ? cx - HW : cx + HW;
      const ts = this.add.tileSprite(x, s.y0, 12, len / S, 'floor-is-lava-spike').setOrigin(s.side < 0 ? 0 : 1, 0).setScale(S).setDepth(-30);
      if (s.side > 0) ts.setFlipX(true);
      s.imgs[p] = ts;
    }
    for (const pp of this.pipes) {
      const x = pp.side < 0 ? cx - HW : cx + HW;
      const img = this.add.sprite(x, pp.y, 'floor-is-lava-pipe', 0).setOrigin(pp.side < 0 ? 0 : 1, 0.5).setScale(S).setDepth(-30);
      if (pp.side > 0) img.setFlipX(true);
      pp.imgs[p] = img;
    }
    // lava
    const lava = this.add.tileSprite(cx - vw / 2, 0, vw / S, 14, 'floor-is-lava-surface').setOrigin(0, 0).setScale(S).setDepth(30);
    const lavaBody = this.add.tileSprite(cx - vw / 2, 0, vw / S, vh / S, 'floor-is-lava-body').setOrigin(0, 0).setScale(S).setDepth(30);
    const glow = this.add.image(cx - vw / 2, 0, 'floor-is-lava-glow').setOrigin(0, 1).setDisplaySize(vw, 150).setDepth(29).setBlendMode(Phaser.BlendModes.ADD);
    const danger = this.add.image(cx - vw / 2, 0, 'floor-is-lava-danger').setOrigin(0, 1).setDisplaySize(vw, vh * 0.7).setDepth(40).setAlpha(0);
    const embers = this.add.particles(cx, 0, 'dot2', {
      x: { min: -vw / 2, max: vw / 2 }, speedY: { min: -90, max: -30 }, speedX: { min: -15, max: 15 },
      lifespan: { min: 900, max: 2000 }, scale: { start: S * 0.9, end: 0 }, tint: [0xffe066, 0xff9f43, 0xff5a3d],
      frequency: 70, quantity: 1, alpha: { start: 1, end: 0.3 },
    }).setDepth(31);
    const reticle = this.add.image(cx, 0, 'floor-is-lava-reticle', 0).setScale(S).setDepth(25).setAlpha(0);
    const signs = [0, 1].map(() => txt(this, cx, 0, '', { size: 14, color: '#ffe9a8', strokeWidth: 4 }).setDepth(-44));
    const lamps = [0, 1].map(() => this.add.image(cx, 0, 'floor-is-lava-lamp').setScale(S).setDepth(-44));
    // progress meter (rivals' heights) on the side away from the HUD panel
    const meterSide = p === 0 || p === 3 ? -1 : 1;
    const mx = cx + meterSide * (vw / 2 - 14);
    const meterBar = this.add.image(mx, 0, 'floor-is-lava-meter').setOrigin(0.5, 0).setScale(S, 2).setDepth(50).setAlpha(0.9);
    const meterLava = this.add.image(mx, 0, 'floor-is-lava-flame').setScale(S).setDepth(52);
    const meterMarks = this.players.map((q) => this.add.image(mx, 0, playerMarkerKey(this, q)).setScale(S * (q === p ? 0.85 : 0.6)).setDepth(q === p ? 54 : 53));

    const av = new Avatar(this, p, cx - HW + CLING, -2, { depthSort: false, shadow: false });
    av.sprite.setDepth(10);
    av.marker?.setDepth(11).setAngle(0);
    av.face(1);
    const c: Climber = {
      p, av, cx, side: -1, x: cx - HW + CLING, y: -2, mode: 'cling', t: 0, fromX: 0, fromY: 0, clingT: 0, buffer: 0,
      best: 0, camY: -60, layers, wallL, wallR, trimL, trimR, lava, lavaBody, glow, danger, embers, reticle, signs, lamps,
      meterBar, meterLava, meterMarks, floor, floorGone: false, cpuDelay: 0.4, cpuSkill: 0.72 + Math.random() * 0.24,
      cpuWait: 0, deadAt: -1, warnT: 0,
    };
    this.climbers.push(c);
    this.syncView(c, 0);
  }

  // ───────────────────────────── HELPERS ─────────────────────────────

  private pipeHeat(pp: Pipe, time = this.elapsed): number {
    const u = ((time + pp.phase) % pp.period) / pp.period;
    if (u < 0.5) return 2; // hot
    if (u > 0.82) return 1; // warming up
    return 0;
  }

  private spikeAt(side: number, y: number): Spike | undefined {
    return this.spikes.find((s) => s.side === side && y - BODY_TOP < s.y1 && y - BODY_BOT > s.y0);
  }

  private pipeAt(side: number, y: number): Pipe | undefined {
    return this.pipes.find((pp) => pp.side === side && Math.abs(y - (pp.y - 9)) < 16);
  }

  private wallX(c: Climber, side: number): number {
    return c.cx + side * (HW - CLING);
  }

  /** Is landing after a jump from (side, y) dangerous? Looks ahead in time. */
  private landingBad(side: number, y: number, dtAhead = JUMP_T): boolean {
    const ly = y - JUMP_H;
    const ns = -side;
    if (this.spikeAt(ns, ly)) return true;
    const pp = this.pipeAt(ns, ly);
    if (pp && this.pipeHeat(pp, this.elapsed + dtAhead) === 2) return true;
    return false;
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.bubbleT += dt;
    for (const c of this.climbers) this.syncView(c, dt);
    // pipes animate their heat for everyone (also during intro, cosmetic)
    for (const pp of this.pipes) {
      const heat = this.pipeHeat(pp);
      for (const img of pp.imgs) {
        if (!img || !img.visible) continue;
        if (Number(img.frame.name) !== heat) img.setFrame(heat);
        if (heat === 2 && Math.random() < dt * 3) {
          const tipX = img.x + (pp.side < 0 ? 40 : -40);
          burst(this, tipX, pp.y - 6, { tex: 'floor-is-lava-steam', count: 1, tint: [0xffffff, 0xe8e0f0], speed: [15, 40], angle: [250, 290], life: 700, scale: [S * 0.6, S * 1.4], alpha: [0.6, 0], depth: -29 });
        }
      }
    }
  }

  tick(dt: number): void {
    // Lava rises faster and faster; it never lags far behind the lowest climber.
    this.lavaV = 16 + this.elapsed * 2.1;
    let lowest = -Infinity;
    for (const c of this.climbers) if (c.mode !== 'dead') lowest = Math.max(lowest, c.y);
    let v = this.lavaV;
    // Gentle catch-up so the lava never lags hopelessly far behind the last climber.
    if (lowest > -Infinity && this.lavaY > lowest + 420) v += Math.min(70, (this.lavaY - (lowest + 420)) * 0.5);
    this.lavaY -= v * dt;

    for (const c of this.climbers) {
      if (c.mode === 'dead') continue;
      if (this.isCpu(c.p)) this.bot(c, dt);
      this.move(c, dt);
    }
    for (const c of this.climbers) {
      const m = Math.max(0, Math.floor(-c.y / METRE));
      if (c.mode !== 'dead') c.best = Math.max(c.best, m);
      this.score[c.p] = c.best;
      this.hudText[c.p] = c.mode === 'dead' ? `🔥 ${c.best}m` : `${c.best}m`;
    }
  }

  private move(c: Climber, dt: number): void {
    c.buffer = Math.max(0, c.buffer - dt);
    if (!c.floorGone && this.lavaY < 12) this.breakFloor(c);
    switch (c.mode) {
      case 'cling': {
        if (c.buffer > 0) { this.jump(c); break; }
        c.clingT += dt;
        if (c.perch) {
          c.y = c.perch.y - 9;
          if (this.pipeHeat(c.perch) === 2) { this.burn(c, c.perch); break; }
        } else if (c.floorGone || c.y < -3) {
          const v = Math.min(95, 16 + c.clingT * 80);
          const prevY = c.y;
          c.y += v * dt;
          if (!c.floorGone) c.y = Math.min(c.y, -2);
          const sp = this.spikeAt(c.side, c.y);
          if (sp) { this.spiked(c); break; }
          const pp = this.pipes.find((q) => q.side === c.side && prevY <= q.y - 9 && c.y >= q.y - 9);
          if (pp) {
            if (this.pipeHeat(pp) === 2) { this.burn(c, pp); break; }
            c.perch = pp;
            c.y = pp.y - 9;
            Audio.sfx('land', 1.2);
          }
          if (Math.random() < dt * 10 * Math.min(1, v / 60)) burst(this, c.x - c.side * 4, c.y - 30, { tex: 'dot2', count: 1, tint: [0xd9b7a0, 0xa8806a], speed: [10, 30], angle: [250, 290], life: 300 });
        }
        break;
      }
      case 'jump': {
        c.t += dt;
        const u = Math.min(1, c.t / JUMP_T);
        const e = 0.5 - Math.cos(u * Math.PI) / 2;
        c.x = c.fromX + (this.wallX(c, c.side) - c.fromX) * e;
        c.y = c.fromY - JUMP_H * u - JUMP_ARC * Math.sin(u * Math.PI);
        if (u >= 1) this.land(c);
        break;
      }
      case 'stun': {
        c.t -= dt;
        c.y += 175 * dt * Math.max(0.2, c.t / 0.65);
        if (!c.floorGone) c.y = Math.min(c.y, -2);
        c.x = this.wallX(c, c.side) + c.side * -Math.sin(Math.max(0, c.t) * 14) * 3;
        if (c.t <= 0) { c.mode = 'cling'; c.clingT = 0.6; }
        break;
      }
    }
    if (c.y > this.lavaY - 6) this.die(c);
  }

  private jump(c: Climber): void {
    c.buffer = 0;
    c.mode = 'jump';
    c.t = 0;
    c.perch = undefined;
    c.fromX = c.x;
    c.fromY = c.y;
    c.side = -c.side;
    c.av.face(-c.side);
    Audio.sfx('jump', 1 + c.p * 0.1);
    Vfx.squash(this, c.av.sprite, 0.75, 1.3, 160);
    burst(this, c.x, c.y - 20, { tex: 'dust', count: 4, tint: [0xe9e2d0, 0xcfc6b0], speed: [20, 70], angle: c.side > 0 ? [150, 210] : [-30, 30], life: 320, scale: [S * 0.7, 0] });
  }

  private land(c: Climber): void {
    c.x = this.wallX(c, c.side);
    c.mode = 'cling';
    c.clingT = 0;
    if (this.spikeAt(c.side, c.y)) return this.spiked(c);
    const pp = this.pipeAt(c.side, c.y);
    if (pp) {
      if (this.pipeHeat(pp) === 2) return this.burn(c, pp);
      c.perch = pp;
      c.y = pp.y - 9;
    }
    Audio.sfx('land', 1 + c.p * 0.1);
    Vfx.squash(this, c.av.sprite, 1.25, 0.8, 140);
    burst(this, c.x + c.side * 8, c.y - 24, { tex: 'dust', count: 5, tint: [0xe9e2d0, 0xbfae98], speed: [20, 60], angle: c.side > 0 ? [150, 210] : [-30, 30], life: 340, scale: [S * 0.7, 0] });
  }

  private stun(c: Climber, label: string, color: string): void {
    c.mode = 'stun';
    c.t = 0.65;
    c.perch = undefined;
    c.buffer = 0;
    Audio.sfx('hit', 1 + c.p * 0.1);
    Audio.sfx('stun', 1 + c.p * 0.05);
    Vfx.hitFlash(this, c.av.sprite);
    Vfx.hit(this, c.x + c.side * 10, c.y - 26, [0xffffff, 0xff9f43, 0xff5a3d]);
    Vfx.popText(this, c.cx, c.y - 70, label, color, 16, 0);
    this.cameras.getCamera(`p${c.p}`)?.shake(160, 0.01);
  }

  private spiked(c: Climber): void {
    this.stun(c, 'โอ๊ย! หนาม', '#ffd0d6');
  }

  private burn(c: Climber, pp: Pipe): void {
    this.stun(c, 'ร้อน!!', '#ffb35c');
    for (let i = 0; i < 3; i++) burst(this, c.cx + pp.side * (HW - 30), pp.y - 6, { tex: 'floor-is-lava-steam', count: 4, tint: [0xffffff, 0xd8d8e8], speed: [20, 60], angle: [240, 300], life: 700, scale: [S * 0.8, S * 1.6], alpha: [0.8, 0] });
  }

  private breakFloor(c: Climber): void {
    c.floorGone = true;
    const f = c.floor;
    burst(this, c.cx, 4, { tex: 'dot3', count: 18, tint: [0xc98a4b, 0x8a5530, 0xf0c48a], speed: [60, 180], angle: [200, 340], gravity: 500, life: 700 });
    this.tweens.add({ targets: f, y: f.y + 40, alpha: 0, angle: 4, duration: 600, ease: 'Quad.easeIn' });
  }

  private die(c: Climber): void {
    c.mode = 'dead';
    c.deadAt = this.elapsed;
    const s = c.av.sprite;
    c.av.play('hit', true);
    s.setTint(0x6a3030);
    Audio.sfx('explode');
    Audio.sfx('splash', 0.7);
    burst(this, c.x, this.lavaY, { tex: 'dot3', count: 26, tint: [0xffe066, 0xff9f43, 0xff5a3d], speed: [80, 240], angle: [220, 320], gravity: 600, life: 800 });
    burst(this, c.x, this.lavaY - 20, { tex: 'puff', count: 8, tint: [0x6b6b80, 0x4a4a5c], speed: [20, 70], angle: [250, 290], life: 1200, scale: [S, S * 2], gravity: -60, alpha: [0.8, 0] });
    Vfx.popText(this, c.cx, c.y - 90, 'ตกลาวา!', '#ff9f43', 22, 0);
    this.cameras.getCamera(`p${c.p}`)?.shake(300, 0.02);
    this.tweens.add({ targets: s, y: s.y - 60, angle: c.side * 200, duration: 380, ease: 'Quad.easeOut', yoyo: false,
      onComplete: () => this.tweens.add({ targets: s, y: this.lavaY + 50, alpha: 0, duration: 500, ease: 'Quad.easeIn' }) });
    c.av.marker?.setVisible(false);
    c.reticle.setAlpha(0);
    const place = this.players.length - this.eliminated.length;
    c.outText = txt(this, c.cx, c.camY, `ออกแล้ว!\nที่ ${place} · ${c.best}m`, { size: 22, color: '#ffe9a8', strokeWidth: 6 }).setDepth(60);
    this.tweens.add({ targets: c.outText, scale: { from: 0.3, to: 1 }, duration: 300, ease: 'Back.easeOut' });
    this.eliminate(c.p);
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(c: Climber, dt: number): void {
    if (c.mode !== 'cling') { c.cpuDelay = 0.05 + Math.random() * 0.5 * (1.15 - c.cpuSkill); return; }
    c.cpuDelay -= dt;
    if (c.cpuDelay > 0) return;
    const bad = this.landingBad(c.side, c.y);
    // Danger while waiting: about to slide into spikes, lava close, or perch getting hot.
    const slideBad = !c.perch && this.spikeAt(c.side, c.y + 22);
    const perchHot = c.perch && this.pipeHeat(c.perch, this.elapsed + 0.25) === 2;
    const lavaClose = this.lavaY - c.y < 90;
    const careless = Math.random() > c.cpuSkill;
    if (!bad || slideBad || perchHot || lavaClose || (careless && Math.random() < 0.05)) {
      this.jump(c);
      c.cpuDelay = 0.05 + Math.random() * 0.5 * (1.15 - c.cpuSkill);
    } else c.cpuDelay = 0.04 + Math.random() * 0.12;
  }

  // ───────────────────────────── VIEW ─────────────────────────────

  private syncView(c: Climber, dt: number): void {
    const vw = this.split.viewW, vh = this.split.viewH;
    const av = c.av;
    if (c.mode !== 'dead') {
      av.setPos(c.x, c.y);
      if (c.mode === 'jump') av.play(c.t < JUMP_T * 0.55 ? 'jump' : 'fall');
      else if (c.mode === 'stun') av.play('stun');
      else if (this.state === 'end') av.play('win');
      else if (c.perch) av.play('idle');
      else av.play(c.y >= -3 && !c.floorGone ? 'idle' : 'land');
      if (c.mode !== 'jump') av.face(-c.side);
      av.sprite.setAngle(c.mode === 'jump' ? Math.sin((c.t / JUMP_T) * Math.PI) * 10 * c.side : 0);
    }
    // camera follow: keep the climber in the lower-middle of the view
    const targetY = (c.mode === 'dead' ? this.lavaY - 40 : c.y - 34);
    c.camY += (targetY - c.camY) * Math.min(1, dt * 7);
    if (dt === 0) c.camY = targetY;
    this.split.look(c.p, c.cx, c.camY);
    c.outText?.setY(c.camY - 20);
    const top = c.camY - vh / 2 - 4;
    for (const l of c.layers) { l.ts.y = top; l.ts.tilePositionY = (top * l.f) / S; }
    for (const w of [c.wallL, c.wallR, c.trimL, c.trimR]) { w.y = top; w.tilePositionY = top / S; }
    // signs / lamps on the walls
    const k0 = Math.floor(-c.camY / FLOOR_GAP);
    [k0, k0 + 1].forEach((k, i) => {
      const y = -k * FLOOR_GAP - 40;
      const s = c.signs[i];
      const label = k <= 0 ? 'ชั้น 1' : `ชั้น ${k + 1}`;
      if (s.text !== label) s.setText(label);
      s.setPosition(c.cx + (k % 2 === 0 ? -1 : 1) * (HW + (vw / 2 - HW) / 2 + 2), y);
      const lamp = c.lamps[i];
      lamp.setPosition(c.cx + (k % 2 === 0 ? 1 : -1) * (HW + (vw / 2 - HW) / 2), y - 70);
      lamp.setAlpha(0.75 + 0.25 * Math.sin(this.bubbleT * 13 + k * 3) * (Math.sin(this.bubbleT * 2.3 + k) > 0.8 ? 1 : 0.1));
    });
    // hazard culling
    const near = (y: number) => y > top - 160 && y < top + vh + 160;
    for (const s of this.spikes) { const im = s.imgs[c.p]; if (im) im.setVisible(near(s.y0) || near(s.y1)); }
    for (const pp of this.pipes) { const im = pp.imgs[c.p]; if (im) im.setVisible(near(pp.y)); }
    // lava
    const ly = this.lavaY;
    c.lava.y = ly - 8;
    c.lava.tilePositionX = this.bubbleT * 9 + c.p * 7;
    c.lavaBody.y = ly + 18;
    c.lavaBody.tilePositionX = Math.sin(this.bubbleT * 0.7) * 6;
    c.lavaBody.tilePositionY = -this.bubbleT * 4;
    c.glow.y = ly + 4;
    c.glow.setAlpha(0.75 + Math.sin(this.bubbleT * 3 + c.p) * 0.15);
    c.embers.setPosition(c.cx, ly + 4);
    const gap = ly - c.y;
    const dangerA = c.mode === 'dead' ? 0 : Phaser.Math.Clamp(1 - (gap - 60) / 160, 0, 1);
    c.danger.y = top + vh + 4;
    c.danger.setAlpha(dangerA * (0.55 + 0.25 * Math.sin(this.bubbleT * 14)));
    if (dangerA > 0.55 && this.state === 'play') {
      c.warnT -= dt;
      if (c.warnT <= 0) { Audio.sfx('tick', 0.8); c.warnT = 0.35; }
    }
    // landing preview
    if (c.mode === 'cling' && this.state !== 'end') {
      const bad = this.landingBad(c.side, c.y);
      c.reticle.setFrame(bad ? 1 : 0).setPosition(this.wallX(c, -c.side) - c.side * 4, c.y - JUMP_H - 20);
      c.reticle.setTint(bad ? 0xffffff : PLAYER_COLORS[c.p].light).setAlpha(0.55 + 0.3 * Math.sin(this.bubbleT * 8));
    } else c.reticle.setAlpha(0);
    // progress meter: lava at the bottom, leader near the top
    const mTop = top + 34, mBot = top + vh - 54;
    c.meterBar.setPosition(c.meterBar.x, mTop).setDisplaySize(8, mBot - mTop);
    let hi = -Infinity;
    for (const o of this.climbers) hi = Math.max(hi, -o.y);
    const lo = -ly;
    const span = Math.max(300, hi - lo + 120);
    const toM = (h: number) => mBot - Phaser.Math.Clamp((h - lo) / span, 0, 1) * (mBot - mTop);
    c.meterLava.setPosition(c.meterBar.x, mBot + 4);
    this.players.forEach((q, i) => {
      const o = this.climbers.find((x) => x.p === q);
      if (!o) return;
      c.meterMarks[i].setPosition(c.meterBar.x, toM(-o.y) + 6).setAlpha(o.mode === 'dead' ? 0.3 : 1);
    });
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => {
      const c = this.climbers.find((k) => k.p === p);
      const h = c?.best ?? 0;
      const i = this.eliminated.indexOf(p);
      return i === -1 ? 1e7 + h : (i + 1) * 1e5 + h;
    };
    return rankBy(this.players, value).map((r) => ({ ...r, score: this.climbers.find((k) => k.p === r.player)?.best ?? 0 }));
  }

  /** Text colour helper for popups in a player's colour. */
  colorOf(p: PlayerIndex): string {
    return toCss(PLAYER_COLORS[p].light);
  }
}

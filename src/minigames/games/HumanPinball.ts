import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { characterById } from '../../data/characters';
import { Audio } from '../../systems/audio/AudioManager';
import { Party, rankBy } from '../../systems/party/Party';
import { playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';

const BALL_R = 16;
const LAUNCH_V = 610;
const READY_V = 46;
const BUMPER_R = 21;
const HOLE_R = 17;
const SUCK_R = 52;

interface Seg { x1: number; y1: number; x2: number; y2: number; kick?: number; id?: number }
interface Ball {
  p: PlayerIndex;
  x: number; y: number; vx: number; vy: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  marker: Phaser.GameObjects.Image;
  arrow: Phaser.GameObjects.Image;
  aim: number;
  aimDir: number;
  spin: number;
  cool: number;
  drained: number;
  lastHit: PlayerIndex | -1;
  lastHitT: number;
  saucerCd: number;
  cpuGoal: number;
  cpuErr: number;
  cpuWait: number;
  skill: number;
  buffer: number;
  trail: number;
}
interface Bumper { x: number; y: number; img: Phaser.GameObjects.Sprite; ring: Phaser.GameObjects.Image; lit: number }
interface Target { seg: Seg; up: boolean; img: Phaser.GameObjects.Sprite; bank: number }
interface Spinner { x: number; y: number; w: number; img: Phaser.GameObjects.Sprite; spin: number; ang: number }
interface Light { x: number; y: number; img: Phaser.GameObjects.Sprite; on: boolean }
interface Hole { x: number; y: number; img: Phaser.GameObjects.Image }

/** #5 — Every player is a hamster ball on a pinball table. Aim, tap, score. */
export default class HumanPinball extends BaseMinigame {
  private balls: Ball[] = [];
  private walls: Seg[] = [];
  private bumpers: Bumper[] = [];
  private targets: Target[] = [];
  private bankReset = [0, 0];
  private spinners: Spinner[] = [];
  private rollLights: Light[] = [];
  private holes: Hole[] = [];
  private saucer!: Phaser.GameObjects.Sprite;
  private saucerFlash = 0;
  private kickers: Phaser.GameObjects.Image[] = [];
  private chase: Phaser.GameObjects.Image[] = [];
  private inserts: Phaser.GameObjects.Image[] = [];
  private L = 0; private T = 0; private Rt = 0; private B = 0; private cx = 0; private cy = 0;
  private t = 0;

  constructor() {
    super(CATALOG['human-pinball']);
  }

  setup(): void {
    this.balls = []; this.walls = []; this.bumpers = []; this.targets = []; this.spinners = []; this.rollLights = []; this.holes = [];
    this.kickers = []; this.chase = []; this.inserts = [];
    this.bankReset = [0, 0];
    this.saucerFlash = 0;
    this.t = 0;
    this.L = 18; this.Rt = this.vw - 18; this.T = 40; this.B = this.vh - 40;
    this.cx = this.vw / 2; this.cy = this.vh / 2;
    this.paintArt();
    this.buildTable();
    for (const p of this.players) this.makeBall(p);
    this.touch.on('down', (t: { player: PlayerIndex }) => {
      if (this.state !== 'play' || this.isCpu(t.player)) return;
      const b = this.balls.find((x) => x.p === t.player);
      if (b) b.buffer = 0.2;
    });
    this.refresh();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const L = this.L / S, T = this.T / S, R = this.Rt / S, B = this.B / S, C = 26;
    const ccx = this.cx / S, ccy = this.cy / S;
    makeTexture(this, `human-pinball-table-${aw}`, aw, ah, (p) => {
      // cabinet wood
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const g = Math.sin((x + Math.sin(y * 0.07) * 6) * 0.35) * 0.5 + 0.5;
        p.px(x, y, g > 0.7 ? 0x7a3f2a : g > 0.35 ? 0x6b3624 : 0x5c2d1e);
      }
      const inside = (x: number, y: number, m: number) => {
        if (x < L + m || x > R - m || y < T + m || y > B - m) return false;
        const cxm = Math.min(x - (L + m), (R - m) - x), cym = Math.min(y - (T + m), (B - m) - y);
        return cxm + cym >= C - m * 0.4;
      };
      // chrome rail + playfield
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        if (inside(x, y, -5) && !inside(x, y, -2)) p.px(x, y, y < ccy ? 0xe8edf4 : 0x9aa4b8);
        else if (inside(x, y, -2) && !inside(x, y, 0)) p.px(x, y, 0x5d6584);
        else if (inside(x, y, 0)) {
          // playfield: deep navy with a rainbow starburst from the centre
          const dx = x - ccx, dy = (y - ccy) * 1.3;
          const a = Math.atan2(dy, dx);
          const ray = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24) % 2;
          const d = Math.hypot(dx, dy);
          let c = ray ? 0x23285a : 0x1e2350;
          if (d < 70) c = ray ? 0x2e2a6e : 0x282563;
          if (d < 44) c = ray ? 0x3a2f80 : 0x332a75;
          if ((x + y) % 7 === 0 && d > 80) c = shift(c, 0.08);
          p.px(x, y, c);
        }
      }
      // painted rings around the bumper cluster
      p.ring(ccx, ccy, 62, 0x3d4aa0, 1);
      p.ring(ccx, ccy, 64, 0x2c3580, 1);
      // arrow inserts pointing from each corner toward the centre
      const r = rng(3);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        for (let k = 0; k < 3; k++) {
          const ax = ccx + sx * (100 - k * 14), ay = ccy + sy * (58 - k * 8);
          const ang = Math.atan2(-sy * 58, -sx * 100);
          const tip = [ax + Math.cos(ang) * 5, ay + Math.sin(ang) * 5];
          const l = [ax + Math.cos(ang + 2.4) * 4, ay + Math.sin(ang + 2.4) * 4];
          const rr = [ax + Math.cos(ang - 2.4) * 4, ay + Math.sin(ang - 2.4) * 4];
          p.tri(tip[0], tip[1], l[0], l[1], rr[0], rr[1], k === 0 ? 0xff7a85 : k === 1 ? 0xffc93d : 0x7ee8b0);
        }
      }
      for (let i = 0; i < 60; i++) p.px(L + 4 + r() * (R - L - 8), T + 4 + r() * (B - T - 8), 0x3a4290);
      // launch pads in the corners
      for (const [lx, ly] of this.padsArt()) { p.ring(lx, ly, 10, 0x6a74b8, 1); p.ring(lx, ly, 7, 0x4a5398, 1); }
    });
    // hamster balls with a tiny classmate inside
    for (const pl of [0, 1, 2, 3] as PlayerIndex[]) {
      const look = characterById(Party.slots[pl].characterId).look;
      const c = PLAYER_COLORS[pl];
      makeTexture(this, `human-pinball-ball-${pl}`, 18, 18, (p) => {
        p.circle(9, 9, 8.6, shift(c.main, -0.5));
        p.circle(9, 9, 7.8, shift(c.light, 0.1));
        p.circle(9, 9, 7, 0xd7ecff);
        // kid: body (player colour shirt), head, hair, eyes
        p.ellipse(9, 12.5, 3.6, 2.6, c.main);
        p.circle(9, 7.5, 3.4, look.skin);
        p.ellipse(9, 5.2, 3.6, 1.8, look.hair);
        p.px(5.6, 6.5, look.hair); p.px(12.2, 6.5, look.hair);
        p.px(7.5, 8, 0x1b1f3b); p.px(10.5, 8, 0x1b1f3b);
        p.px(9, 9.5, shift(look.skin, -0.35));
        p.px(6, 11.5, look.skin); p.px(12, 11.5, look.skin);
        // glass highlight
        p.px(4, 4, 0xffffff); p.px(5, 3, 0xffffff); p.px(3, 5, 0xffffff); p.px(6, 3, 0xffffff, 160); p.px(3, 6, 0xffffff, 160);
        p.px(13, 14, 0xffffff, 120);
        p.ring(9, 9, 8.6, c.dark, 1);
      });
      makeTexture(this, `human-pinball-arrow-${pl}`, 40, 9, (p) => {
        for (let x = 12; x < 30; x += 5) p.rect(x, 3, 3, 3, c.light);
        p.tri(30, 0, 30, 9, 39.5, 4.5, c.main);
        p.tri(31, 2, 31, 7, 37, 4.5, c.light);
        p.outline(-0.7);
      });
    }
    makeSheet(this, 'human-pinball-bumper', 24, 24, 2, (p, i) => {
      p.circle(12, 13, 11.5, 0x14172e);
      p.circle(12, 12, 11, i ? 0xffffff : 0xff5a6e);
      p.circle(12, 12, 9, i ? 0xfff1a8 : 0xffb3bd);
      p.circle(12, 12, 7, i ? 0xffe066 : 0xff5a6e);
      p.ball(12, 11, 5, 5, i ? 0xfff8e7 : 0xfff1f0);
      p.stamp(9, 8, ['..a..', '.aaa.', 'aaaaa', '.a.a.'], { a: i ? 0xff9f43 : 0xff5a6e });
    });
    makeTexture(this, 'human-pinball-bring', 30, 30, (p) => p.ring(15, 15, 14.5, 0xffffff, 2));
    makeSheet(this, 'human-pinball-target', 6, 14, 2, (p, i) => {
      if (i === 0) { p.box(0, 0, 6, 14, 0xffc93d); p.rect(1, 5, 4, 4, 0xff5a3d); }
      else { p.rect(0, 5, 6, 4, 0x6a5a3a); p.hline(0, 5, 6, 0x8a7a5a); }
    });
    makeSheet(this, 'human-pinball-spinner', 24, 8, 4, (p, i) => {
      const h = [4, 3, 1, 3][i];
      p.rect(0, 3, 2, 2, 0x9aa4b8); p.rect(22, 3, 2, 2, 0x9aa4b8);
      p.rect(2, 4 - h / 2, 20, Math.max(1, h), i === 2 ? 0x8f98a8 : i % 2 ? 0xc6cdd9 : 0xeef1f6);
      if (h > 2) p.hline(2, 4 - h / 2, 20, 0xffffff);
      if (i === 0) { p.px(8, 4, 0xff5a6e); p.px(15, 4, 0x3d9bff); }
    });
    makeSheet(this, 'human-pinball-light', 10, 10, 2, (p, i) => {
      p.circle(5, 5, 4.5, i ? 0xfff1a8 : 0x3a3f6b);
      p.circle(5, 5, 3, i ? 0xffe066 : 0x4b5290);
      p.px(4, 3, i ? 0xffffff : 0x6a74b8);
    });
    makeTexture(this, 'human-pinball-hole', 22, 22, (p) => {
      p.circle(11, 11, 10.5, 0x9aa4b8);
      p.circle(11, 11, 9.5, 0x5d6584);
      p.circle(11, 11, 8.5, 0x0b0d1f);
      p.ellipse(11, 12, 7, 6, 0x000000);
      p.hline(6, 2, 10, 0xe8edf4);
    });
    makeTexture(this, 'human-pinball-swirl', 22, 22, (p) => {
      for (let a = 0; a < Math.PI * 4; a += 0.15) {
        const rr = 2 + a * 0.6;
        p.px(11 + Math.cos(a) * rr, 11 + Math.sin(a) * rr, 0x6a74b8);
      }
    });
    makeSheet(this, 'human-pinball-saucer', 20, 20, 2, (p, i) => {
      p.circle(10, 10, 9.5, i ? 0xffffff : 0xb8a6ff);
      p.circle(10, 10, 7.5, i ? 0xffe066 : 0x8455d6);
      p.stamp(6, 6, ['...a...'.slice(0, 7), '..aaa..', 'aaaaaaa', '.aaaaa.', '.aa.aa.', 'a.....a'].map((r) => r.slice(0, 7)), { a: i ? 0xffffff : 0xffe066 });
    });
    makeTexture(this, 'human-pinball-kicker', 16, 4, (p) => {
      p.rect(0, 0, 16, 4, 0xff7a85);
      p.hline(0, 0, 16, 0xffb3bd);
      p.hline(0, 3, 16, 0xb3263a);
    });
    makeSheet(this, 'human-pinball-chase', 4, 4, 2, (p, i) => p.ball(2, 2, 1.8, 1.8, i ? 0xfff1a8 : 0x8a4a2a, false));
  }

  private padsArt(): [number, number][] {
    return ([0, 1, 2, 3] as PlayerIndex[]).map((p) => { const s = this.padOf(p); return [s.x / S, s.y / S]; });
  }

  private padOf(p: PlayerIndex): { x: number; y: number } {
    return { x: p % 2 === 0 ? this.L + 64 : this.Rt - 64, y: p < 2 ? this.T + 52 : this.B - 52 };
  }

  private buildTable(): void {
    const aw = Math.ceil(this.vw / S);
    this.add.image(0, 0, `human-pinball-table-${aw}`).setOrigin(0).setScale(S).setDepth(-200);
    const { L, T, Rt: R, B, cx, cy } = this;
    const C = 52;
    // outer walls (octagon, corners are kickers)
    const add = (x1: number, y1: number, x2: number, y2: number, kick?: number) => this.walls.push({ x1, y1, x2, y2, kick });
    add(L + C, T, R - C, T); add(R, T + C, R, B - C); add(R - C, B, L + C, B); add(L, B - C, L, T + C);
    add(R - C, T, R, T + C, 1); add(R, B - C, R - C, B, 1); add(L + C, B, L, B - C, 1); add(L, T + C, L + C, T, 1);
    for (const [x1, y1, x2, y2] of [[R - C, T, R, T + C], [R, B - C, R - C, B], [L + C, B, L, B - C], [L, T + C, L + C, T]]) {
      const k = this.add.image((x1 + x2) / 2, (y1 + y2) / 2, 'human-pinball-kicker').setScale(S * 2.2, S).setRotation(Math.atan2(y2 - y1, x2 - x1)).setDepth(-150);
      this.kickers.push(k);
    }
    // marquee chase lights on the rail
    const per = 2 * (R - L + B - T);
    for (let i = 0; i < 64; i++) {
      let d = (i / 64) * per;
      let x = 0, y = 0;
      const w = R - L + 10, h = B - T + 10;
      if (d < w) { x = L - 5 + d; y = T - 11; } else if ((d -= w) < h) { x = R + 11; y = T - 5 + d; } else if ((d -= h) < w) { x = R + 5 - d; y = B + 11; } else { d -= w; x = L - 11; y = B + 5 - d; }
      this.chase.push(this.add.image(x, y, 'human-pinball-chase', 0).setScale(S).setDepth(-140));
    }
    // pop bumpers (diamond)
    for (const [dx, dy] of [[-74, 0], [74, 0], [0, -64], [0, 64]]) {
      const x = cx + dx, y = cy + dy;
      const ring = this.add.image(x, y, 'human-pinball-bring').setScale(S).setDepth(-99).setAlpha(0);
      const img = this.add.sprite(x, y, 'human-pinball-bumper', 0).setScale(S).setDepth(y - 10);
      this.bumpers.push({ x, y, img, ring, lit: 0 });
    }
    // centre jackpot saucer
    this.saucer = this.add.sprite(cx, cy, 'human-pinball-saucer', 0).setScale(S).setDepth(-120);
    // drop target banks on the left and right walls
    for (const side of [-1, 1]) {
      const x = side < 0 ? L + 18 : R - 18;
      for (let k = -1; k <= 1; k++) {
        const y = cy + k * 34;
        const seg: Seg = { x1: x, y1: y - 14, x2: x, y2: y + 14 };
        const img = this.add.sprite(x, y, 'human-pinball-target', 0).setScale(S).setDepth(y);
        this.targets.push({ seg, up: true, img, bank: side < 0 ? 0 : 1 });
      }
      // little guide rails behind the bank
      add(x + side * 6, cy - 62, x + side * 6, cy + 62);
    }
    // spinners at the top and bottom centre
    for (const y of [T + 40, B - 40]) {
      const img = this.add.sprite(cx, y, 'human-pinball-spinner', 0).setScale(S).setDepth(y);
      this.spinners.push({ x: cx, y, w: 46, img, spin: 0, ang: 0 });
      // posts either side
      for (const sx of [-1, 1]) {
        this.add.image(cx + sx * 26, y, 'human-pinball-chase', 1).setScale(S * 1.6).setDepth(y + 1).setTint(0xc6cdd9);
        add(cx + sx * 26, y - 10, cx + sx * 26, y + 10);
      }
    }
    // rollover lights ring
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = cx + Math.cos(a) * 150, y = cy + Math.sin(a) * 104;
      const img = this.add.sprite(x, y, 'human-pinball-light', 0).setScale(S).setDepth(-110);
      this.rollLights.push({ x, y, img, on: false });
    }
    // drain holes
    for (const side of [-1, 1]) {
      const x = cx + side * 168, y = cy;
      const sw = this.add.image(x, y, 'human-pinball-swirl').setScale(S * 1.6).setDepth(-130).setAlpha(0.7);
      this.inserts.push(sw);
      const img = this.add.image(x, y, 'human-pinball-hole').setScale(S).setDepth(-125);
      this.holes.push({ x, y, img });
    }
  }

  private makeBall(p: PlayerIndex): void {
    const s = this.padOf(p);
    const shadow = this.add.image(s.x + 4, s.y + 6, 'shadow').setScale(S * 0.9, S * 1.2).setAlpha(0.35).setDepth(-90);
    const img = this.add.image(s.x, s.y, `human-pinball-ball-${p}`).setScale(S);
    const marker = this.add.image(s.x, s.y - 30, playerMarkerKey(this, p)).setScale(S * 0.75).setAngle(this.angleFor(p)).setDepth(2000);
    const arrow = this.add.image(s.x, s.y, `human-pinball-arrow-${p}`).setOrigin(0, 0.5).setScale(S).setDepth(1500);
    const aim = Math.atan2(this.cy - s.y, this.cx - s.x) - 0.9;
    this.balls.push({
      p, x: s.x, y: s.y, vx: 0, vy: 0, img, shadow, marker, arrow, aim, aimDir: p % 2 ? -1 : 1, spin: 0, cool: 0, drained: 0,
      lastHit: -1, lastHitT: 0, saucerCd: 0, cpuGoal: -1, cpuErr: 0, cpuWait: 0.4 + Math.random() * 0.6, skill: 0.55 + Math.random() * 0.4, buffer: 0, trail: 0,
    });
  }

  private refresh(): void {
    for (const p of this.players) this.hudText[p] = `${this.score[p]}`;
  }

  private award(b: Ball, n: number, x: number, y: number, label?: string): void {
    const before = this.score[b.p];
    this.score[b.p] = Math.max(0, before + n);
    this.addScore(b.p, 0);
    const col = n >= 0 ? toCss(PLAYER_COLORS[b.p].light) : '#ff7a85';
    Vfx.popText(this, x, y - 22, label ?? `${n > 0 ? '+' : ''}${n}`, col, n >= 25 || n < 0 ? 20 : 15, this.angleFor(b.p));
    this.refresh();
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    this.chase.forEach((c, i) => c.setFrame((Math.floor(this.t * 10) + i) % 4 === 0 ? 1 : 0));
    for (const sw of this.inserts) sw.setRotation(this.t * 2.5);
    for (const bm of this.bumpers) {
      bm.lit = Math.max(0, bm.lit - dt);
      bm.img.setFrame(bm.lit > 0 ? 1 : 0);
      bm.ring.setAlpha(bm.lit * 5).setScale(S * (1 + (0.2 - bm.lit) * 3));
    }
    this.saucerFlash = Math.max(0, this.saucerFlash - dt);
    this.saucer.setFrame(this.saucerFlash > 0 || Math.sin(this.t * 4) > 0.6 ? 1 : 0);
    for (const k of this.kickers) k.setAlpha(Math.max(0.75, k.alpha - dt * 2));
    for (const sp of this.spinners) {
      sp.spin = Math.max(0, sp.spin - dt * 1.5);
      sp.ang += sp.spin * dt * 30;
      sp.img.setFrame(Math.floor(sp.ang) % 4);
    }
    for (const lt of this.rollLights) if (!lt.on) lt.img.setFrame(Math.sin(this.t * 5 + lt.x) > 0.92 ? 1 : 0);
    for (const b of this.balls) this.syncBall(b, dt);
  }

  tick(dt: number): void {
    for (let k = 0; k < 2; k++) {
      const h = dt / 2;
      for (const b of this.balls) if (b.drained <= 0) this.stepBall(b, h);
      this.collideBalls();
    }
    for (const b of this.balls) {
      b.cool = Math.max(0, b.cool - dt);
      b.buffer = Math.max(0, b.buffer - dt);
      b.saucerCd = Math.max(0, b.saucerCd - dt);
      if (b.drained > 0) {
        b.drained -= dt;
        if (b.drained <= 0) this.respawn(b);
        continue;
      }
      const ready = this.isReady(b);
      if (ready) b.aim += b.aimDir * 2.7 * dt;
      if (this.isCpu(b.p)) this.bot(b, dt);
      if (ready && b.buffer > 0) this.launch(b);
    }
    for (let i = 0; i < 2; i++) {
      if (this.bankReset[i] > 0) {
        this.bankReset[i] -= dt;
        if (this.bankReset[i] <= 0) {
          for (const tg of this.targets) if (tg.bank === i) { tg.up = true; tg.img.setFrame(0); Vfx.squash(this, tg.img, 1, 1.4, 160); }
          Audio.sfx('pop', 1.3);
        }
      }
    }
  }

  private isReady(b: Ball): boolean {
    return b.drained <= 0 && b.cool <= 0 && Math.hypot(b.vx, b.vy) < READY_V;
  }

  private launch(b: Ball): void {
    b.buffer = 0;
    b.vx = Math.cos(b.aim) * LAUNCH_V;
    b.vy = Math.sin(b.aim) * LAUNCH_V;
    b.cool = 0.45;
    b.aimDir = Math.random() < 0.5 ? 1 : -1;
    Audio.sfx('shoot', 1 + b.p * 0.1);
    Vfx.squash(this, b.img, 1.35, 0.7, 160);
    Vfx.speedLines(this, b.x, b.y, (b.aim * 180) / Math.PI, PLAYER_COLORS[b.p].light);
    burst(this, b.x, b.y, { tex: 'dust', count: 6, tint: [0xffffff, PLAYER_COLORS[b.p].light], speed: [30, 90], life: 300, depth: -80 });
  }

  private stepBall(b: Ball, dt: number): void {
    // rolling friction
    const sp = Math.hypot(b.vx, b.vy);
    const f = Math.exp(-0.72 * dt);
    let nv = sp * f - 34 * dt;
    if (nv < 0) nv = 0;
    if (sp > 0) { b.vx *= nv / sp; b.vy *= nv / sp; }
    // drain suction
    for (const h of this.holes) {
      const dx = h.x - b.x, dy = h.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d < SUCK_R) {
        const k = (1 - d / SUCK_R) * 420 * dt;
        b.vx += (dx / d) * k; b.vy += (dy / d) * k;
        if (d < HOLE_R - 4) { this.drain(b, h); return; }
      }
    }
    const py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.spin += (Math.hypot(b.vx, b.vy) * dt) / BALL_R * (b.vx >= 0 ? 1 : -1);
    // walls
    for (const w of this.walls) this.collideSeg(b, w, w.kick ? 1.05 : 0.72, w.kick ? 260 : 0);
    // drop targets
    for (const tg of this.targets) {
      if (!tg.up) continue;
      if (this.collideSeg(b, tg.seg, 0.8, 0)) {
        tg.up = false;
        tg.img.setFrame(1);
        Audio.sfx('hit', 1.3);
        Vfx.hit(this, tg.seg.x1, (tg.seg.y1 + tg.seg.y2) / 2, [0xffe066, 0xffffff]);
        this.award(b, 15, tg.seg.x1, tg.seg.y1);
        if (this.targets.filter((x) => x.bank === tg.bank).every((x) => !x.up)) {
          this.bankReset[tg.bank] = 3;
          Audio.sfx('power', 1 + b.p * 0.05);
          this.award(b, 50, tg.seg.x1 + (tg.bank ? -60 : 60), this.cy - 40, '+50 BANK!');
          Vfx.confetti(this, tg.seg.x1, this.cy, 30);
        }
      }
    }
    // bumpers
    for (const bm of this.bumpers) {
      const dx = b.x - bm.x, dy = b.y - bm.y;
      const d = Math.hypot(dx, dy);
      if (d < BUMPER_R + BALL_R && d > 0) {
        const nx = dx / d, ny = dy / d;
        b.x = bm.x + nx * (BUMPER_R + BALL_R);
        b.y = bm.y + ny * (BUMPER_R + BALL_R);
        const out = Math.max(430, Math.hypot(b.vx, b.vy) * 1.1);
        b.vx = nx * out; b.vy = ny * out;
        if (bm.lit <= 0.05) {
          bm.lit = 0.2;
          Audio.sfx('bounce', 1.5 + b.p * 0.05);
          Audio.sfx('pop', 1.1);
          Vfx.squash(this, bm.img, 1.3, 1.3, 140);
          burst(this, bm.x, bm.y, { tex: 'spark', count: 8, tint: [0xffe066, 0xffffff, 0xff7a85], speed: [80, 180], life: 320, depth: 600 });
          this.award(b, 10, bm.x, bm.y);
        }
      }
    }
    // spinners: crossing the gate line
    for (const s of this.spinners) {
      if (Math.abs(b.x - s.x) < s.w / 2 - 2 && (py - s.y) * (b.y - s.y) < 0) {
        const pts = Math.max(2, Math.round(Math.abs(b.vy) / 45));
        s.spin = Math.min(1.6, s.spin + Math.abs(b.vy) / 400);
        Audio.sfx('coin', 1.2 + b.p * 0.05);
        this.award(b, pts, s.x, s.y);
      }
    }
    // rollover lights
    for (const lt of this.rollLights) {
      if (lt.on || Math.hypot(b.x - lt.x, b.y - lt.y) > 13) continue;
      lt.on = true;
      lt.img.setFrame(1).setTint(PLAYER_COLORS[b.p].light);
      Audio.sfx('right', 1 + this.rollLights.filter((l) => l.on).length * 0.06);
      this.award(b, 5, lt.x, lt.y);
      if (this.rollLights.every((l) => l.on)) {
        this.award(b, 40, this.cx, this.cy - 40, '+40 ไฟครบ!');
        Audio.sfx('power');
        Vfx.flash(this, PLAYER_COLORS[b.p].main, 120);
        for (const l of this.rollLights) { l.on = false; l.img.clearTint(); this.tweens.add({ targets: l.img, scale: { from: S * 2, to: S }, duration: 300 }); }
      }
    }
    // jackpot saucer
    if (b.saucerCd <= 0 && Math.hypot(b.x - this.cx, b.y - this.cy) < 14) {
      b.saucerCd = 2;
      this.saucerFlash = 0.5;
      Audio.sfx('power', 1.2);
      Vfx.sparkle(this, this.cx, this.cy, [0xffe066, 0xffffff, 0xb8a6ff]);
      this.award(b, 25, this.cx, this.cy, '+25 JACKPOT');
    }
  }

  /** Circle vs segment. Returns true on contact. */
  private collideSeg(b: Ball, w: Seg, e: number, kick: number): boolean {
    const ex = w.x2 - w.x1, ey = w.y2 - w.y1;
    const l2 = ex * ex + ey * ey;
    let u = ((b.x - w.x1) * ex + (b.y - w.y1) * ey) / l2;
    u = Math.max(0, Math.min(1, u));
    const qx = w.x1 + ex * u, qy = w.y1 + ey * u;
    const dx = b.x - qx, dy = b.y - qy;
    const d = Math.hypot(dx, dy);
    if (d >= BALL_R || d === 0) return false;
    const nx = dx / d, ny = dy / d;
    b.x = qx + nx * BALL_R;
    b.y = qy + ny * BALL_R;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= (1 + e) * vn * nx;
      b.vy -= (1 + e) * vn * ny;
      if (kick) {
        b.vx += nx * kick; b.vy += ny * kick;
        const k = this.kickers.find((im) => Math.hypot(im.x - qx, im.y - qy) < 60);
        if (k) k.setAlpha(1).setTint(0xffffff);
        if (k) this.time.delayedCall(90, () => k.clearTint());
        Audio.sfx('bounce', 1.2);
        this.award(b, 3, qx + nx * 20, qy + ny * 20);
      } else if (-vn > 120) Audio.sfx('bounce', 0.7 + b.p * 0.05);
    }
    return true;
  }

  private collideBalls(): void {
    const list = this.balls.filter((b) => b.drained <= 0);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], c = list[j];
      const dx = c.x - a.x, dy = c.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= BALL_R * 2 || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      const ov = BALL_R * 2 - d;
      a.x -= nx * ov / 2; a.y -= ny * ov / 2; c.x += nx * ov / 2; c.y += ny * ov / 2;
      const rel = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
      if (rel <= 0) continue;
      const imp = rel * 0.95;
      a.vx -= nx * imp; a.vy -= ny * imp; c.vx += nx * imp; c.vy += ny * imp;
      // who hit whom (the faster one gets the credit)
      const fa = Math.hypot(a.vx, a.vy), fc = Math.hypot(c.vx, c.vy);
      if (fc > fa) { a.lastHit = c.p; a.lastHitT = this.elapsed; } else { c.lastHit = a.p; c.lastHitT = this.elapsed; }
      if (rel > 150) {
        Audio.sfx('hit', 1.1);
        Vfx.hit(this, (a.x + c.x) / 2, (a.y + c.y) / 2, [0xffffff, 0xffe066]);
      } else Audio.sfx('bounce', 1.6);
    }
  }

  private drain(b: Ball, h: Hole): void {
    b.drained = 1.3;
    b.vx = b.vy = 0;
    b.x = h.x; b.y = h.y;
    Audio.sfx('lose', 1 + b.p * 0.05);
    Audio.sfx('whoosh', 0.6);
    this.tweens.add({ targets: b.img, scale: 0.2, angle: b.img.angle + 540, duration: 500, ease: 'Quad.easeIn' });
    b.shadow.setVisible(false);
    b.marker.setVisible(false);
    b.arrow.setVisible(false);
    this.award(b, -20, h.x, h.y, '−20 ตกหลุม!');
    Vfx.shake(this, 0.004, 120);
    if (b.lastHit !== -1 && b.lastHit !== b.p && this.elapsed - b.lastHitT < 3) {
      const k = this.balls.find((x) => x.p === b.lastHit);
      if (k) { this.award(k, 15, k.x, k.y, '+15 ชนตก!'); Audio.sfx('coin', 1.4); }
    }
  }

  private respawn(b: Ball): void {
    const s = this.padOf(b.p);
    b.x = s.x; b.y = s.y; b.vx = b.vy = 0;
    b.lastHit = -1;
    b.img.setAngle(0);
    this.tweens.killTweensOf(b.img);
    b.img.setScale(S * 1.8).setAlpha(0);
    this.tweens.add({ targets: b.img, scale: S, alpha: 1, duration: 300, ease: 'Back.easeOut' });
    b.shadow.setVisible(true);
    b.marker.setVisible(true);
    b.aim = Math.atan2(this.cy - s.y, this.cx - s.x) + (Math.random() - 0.5) * 2;
    Audio.sfx('pop', 1 + b.p * 0.1);
  }

  private syncBall(b: Ball, dt: number): void {
    if (b.drained > 0) { b.img.setPosition(b.x, b.y); return; }
    b.img.setPosition(b.x, b.y).setRotation(b.spin).setDepth(b.y + 20);
    b.shadow.setPosition(b.x + 4, b.y + 8);
    b.marker.setPosition(b.x, b.y + (this.angleFor(b.p) === 180 ? 30 : -30) + Math.sin(this.t * 4 + b.p) * 2);
    const ready = this.state === 'play' ? this.isReady(b) : this.state !== 'end';
    b.arrow.setVisible(ready).setPosition(b.x, b.y).setRotation(b.aim);
    if (ready) b.arrow.setAlpha(0.75 + Math.sin(this.t * 10) * 0.25);
    const sp = Math.hypot(b.vx, b.vy);
    b.trail -= dt;
    if (sp > 280 && b.trail <= 0) {
      b.trail = 0.03;
      const g = this.add.image(b.x, b.y, `human-pinball-ball-${b.p}`).setScale(S).setAlpha(0.35).setTint(PLAYER_COLORS[b.p].light).setDepth(b.y + 10).setRotation(b.spin);
      this.tweens.add({ targets: g, alpha: 0, scale: S * 0.6, duration: 220, onComplete: () => g.destroy() });
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: Ball, dt: number): void {
    if (!this.isReady(b)) { b.cpuGoal = -1; return; }
    if (b.cpuWait > 0) { b.cpuWait -= dt; return; }
    if (b.cpuGoal < 0) {
      // candidate targets: bumpers, standing drop targets, unlit lights, saucer, rivals near a hole
      const cands: { x: number; y: number; v: number }[] = [];
      for (const bm of this.bumpers) cands.push({ x: bm.x, y: bm.y, v: 10 });
      for (const tg of this.targets) if (tg.up) cands.push({ x: tg.seg.x1, y: (tg.seg.y1 + tg.seg.y2) / 2, v: 18 });
      for (const lt of this.rollLights) if (!lt.on) cands.push({ x: lt.x, y: lt.y, v: 7 });
      cands.push({ x: this.cx, y: this.cy, v: 16 });
      for (const o of this.balls) {
        if (o === b || o.drained > 0) continue;
        const nearHole = this.holes.some((h) => Math.hypot(h.x - o.x, h.y - o.y) < 90);
        if (nearHole) cands.push({ x: o.x, y: o.y, v: 22 });
      }
      const scored = cands.map((c, i) => {
        const d = Math.hypot(c.x - b.x, c.y - b.y);
        let risk = 0;
        for (const h of this.holes) if (this.segDist(h.x, h.y, b.x, b.y, c.x, c.y) < 34) risk += 30;
        return { i, s: c.v - d * 0.03 - risk + Math.random() * 8 };
      }).sort((a, c) => c.s - a.s);
      const pick = cands[scored[0].i];
      b.cpuGoal = Math.atan2(pick.y - b.y, pick.x - b.x);
      b.cpuErr = (Math.random() - 0.5) * 0.5 * (1.1 - b.skill);
    }
    const diff = Phaser.Math.Angle.Wrap(b.aim - (b.cpuGoal + b.cpuErr));
    if (Math.abs(diff) < 0.09) {
      b.buffer = 0.05;
      b.cpuWait = 0.15 + Math.random() * 0.9 * (1.2 - b.skill);
    }
  }

  private segDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const ex = x2 - x1, ey = y2 - y1;
    const l2 = ex * ex + ey * ey || 1;
    const u = Math.max(0, Math.min(1, ((px - x1) * ex + (py - y1) * ey) / l2));
    return Math.hypot(px - (x1 + ex * u), py - (y1 + ey * u));
  }

  results(): PlayerResult[] {
    return rankBy(this.players, (p) => this.score[p]);
  }
}

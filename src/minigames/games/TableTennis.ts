import Phaser from 'phaser';
import { S } from '../../art/common';
import { mixc, shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';

/** Rail thickness (world units) on the left / right walls. */
const WALL = 30;
/** Goal line distance from the top / bottom edge. */
const GOAL = 20;
/** Paddle centre distance from the edge. */
const PAD_Y = 54;
/** Paddle half width / half thickness. */
const PW = 31;
const PH = 7;
const BALL_R = 6;
const POST_R = 10;
const BASE_SPEED = 235;
const MAX_SPEED = 560;
const TRAIL = 7;

interface Paddle {
  p: PlayerIndex;
  top: boolean;
  x: number;
  y: number;
  vx: number;
  tx: number;
  min: number;
  max: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  active: boolean;
  // CPU brain
  skill: number;
  think: number;
  aimOff: number;
  aimBall?: Ball;
  aimHits: number;
  cpuSpeed: number;
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  spin: number;
  /** Visual hop over the table (cosmetic). */
  hop: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Image[];
  hist: { x: number; y: number }[];
  last?: PlayerIndex;
  /** Seconds until it launches (serving). */
  wait: number;
  live: boolean;
  target: PlayerIndex;
  hits: number;
}

/** #22 — Four-way table tennis: guard your own goal segment, smash balls into the others'. */
export default class TableTennis extends BaseMinigame {
  private pads: Paddle[] = [];
  private balls: Ball[] = [];
  private goalStrips: Phaser.GameObjects.Image[] = [];
  private leds: Phaser.GameObjects.Image[] = [];
  private light!: Phaser.GameObjects.Image;
  private netFlags: Phaser.GameObjects.Image[] = [];
  private serveTurn = 0;
  private multiball = false;
  private t = 0;
  private rallyText: Phaser.GameObjects.Text[] = [];

  constructor() {
    super(CATALOG['table-tennis']);
  }

  setup(): void {
    this.pads = [];
    this.balls = [];
    this.goalStrips = [];
    this.leds = [];
    this.netFlags = [];
    this.serveTurn = Math.floor(Math.random() * 4);
    this.multiball = false;
    this.t = 0;
    this.paintTable();
    this.buildPaddles();
    this.rallyText = [];
    for (const deg of [0, 180]) {
      const y = deg === 0 ? this.vh / 2 + 26 : this.vh / 2 - 26;
      this.rallyText.push(txt(this, this.vw / 2, y, '', { size: 14, color: '#ffe066' }).setAngle(deg).setDepth(60).setAlpha(0));
    }
    this.addBall();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintTable(): void {
    const W = Math.ceil(this.vw / S), H = Math.ceil(this.vh / S);
    const wl = WALL / S, gl = GOAL / S;
    const mid = Math.floor(W / 2);
    const TABLE = 0x2e6fc4;
    const key = makeTexture(this, `table-tennis-bg-${W}`, W, H, (p) => {
      const r = rng(22);
      // surface with soft top-left light
      p.gradient(0, 0, W, H, [0x3a80d6, TABLE, 0x2861ad, 0x245a9f]);
      for (let i = 0; i < W * H * 0.03; i++) p.px(Math.floor(r() * W), Math.floor(r() * H), r() > 0.5 ? 0x3476c9 : 0x2a66b4);
      // home zones tinted with the owner's colour (dithered)
      for (const q of [0, 1, 2, 3] as PlayerIndex[]) {
        const x0 = q % 2 === 0 ? wl : mid, x1 = q % 2 === 0 ? mid : W - wl;
        const y0 = q < 2 ? gl : H - gl - 34, y1 = q < 2 ? gl + 34 : H - gl;
        const pc = PLAYER_COLORS[q].main;
        for (let y = y0; y < y1; y++) {
          const k = q < 2 ? (y - y0) / 34 : (y1 - y) / 34;
          p.dither(x0, y, x1 - x0, 1, mixc(TABLE, pc, 0.32), TABLE, k);
        }
      }
      // white lines
      p.rect(wl + 2, gl + 1, W - wl * 2 - 4, 1, 0xf4f8ff);
      p.rect(wl + 2, H - gl - 2, W - wl * 2 - 4, 1, 0xf4f8ff);
      p.rect(wl + 2, gl + 1, 1, H - gl * 2 - 2, 0xf4f8ff);
      p.rect(W - wl - 3, gl + 1, 1, H - gl * 2 - 2, 0xf4f8ff);
      p.rect(mid, gl + 1, 1, H - gl * 2 - 2, 0xdfe9fa);
      // centre circle
      p.ring(mid + 0.5, H / 2, 18, 0xc6daf5);
      // goal gutters
      for (const top of [true, false]) {
        const y0 = top ? 0 : H - gl;
        p.rect(0, y0, W, gl, 0x161a33);
        for (const q of (top ? [0, 1] : [2, 3]) as PlayerIndex[]) {
          const c = PLAYER_COLORS[q];
          const x0 = q % 2 === 0 ? wl : mid + 1, x1 = q % 2 === 0 ? mid : W - wl;
          p.rect(x0, y0 + 1, x1 - x0, gl - 2, shift(c.dark, -0.35));
          for (let x = x0; x < x1; x++) for (let y = 1; y < gl - 1; y++) if (((x + y * (top ? 1 : -1)) & 7) < 2) p.px(x, y0 + y, shift(c.dark, -0.15));
          p.hline(x0, top ? y0 + gl - 2 : y0 + 1, x1 - x0, c.main);
        }
      }
      // wooden rails
      for (const left of [true, false]) {
        const x0 = left ? 0 : W - wl;
        p.box(x0, 0, wl, H, 0x8b5a34, 1);
        for (let y = 3; y < H; y += 6) p.hline(x0 + 2, y, wl - 4, 0x7a4c2b);
        p.rect(left ? x0 + wl - 3 : x0, 0, 3, H, 0xb8bfd0);
        p.vline(left ? x0 + wl - 3 : x0 + 2, 0, H, 0xe6ebf5);
        p.vline(left ? x0 + wl - 1 : x0, 0, H, 0x5d6378);
        for (let y = 14; y < H; y += 28) { p.circle(x0 + wl / 2 - (left ? 1 : -1), y, 1.6, 0xd7c7a6); p.px(x0 + wl / 2 - (left ? 1.5 : -0.5), y - 1, 0xfff1cf); }
      }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);

    // goal strips (flash when someone concedes)
    const stripKey = makeTexture(this, 'table-tennis-strip', 8, 8, (p) => p.rect(0, 0, 8, 8, 0xffffff));
    for (const q of [0, 1, 2, 3] as PlayerIndex[]) {
      const x0 = q % 2 === 0 ? WALL : this.vw / 2, x1 = q % 2 === 0 ? this.vw / 2 : this.vw - WALL;
      const y = q < 2 ? GOAL / 2 : this.vh - GOAL / 2;
      const s = this.add.image((x0 + x1) / 2, y, stripKey).setDisplaySize(x1 - x0, GOAL).setTint(PLAYER_COLORS[q].main).setAlpha(0).setDepth(-90);
      this.goalStrips[q] = s;
      if (!this.players.includes(q)) {
        // empty seat: a wall instead of a goal
        const wallKey = makeTexture(this, 'table-tennis-wall', 8, 10, (p) => { p.box(0, 0, 8, 10, 0x8b5a34); p.hline(1, 3, 6, 0x7a4c2b); p.hline(1, 7, 6, 0x7a4c2b); });
        this.add.tileSprite((x0 + x1) / 2, y, (x1 - x0) / S, GOAL / S, wallKey).setScale(S).setDepth(-89);
      }
    }

    // net across the middle
    const nw = Math.ceil((this.vw - WALL * 2) / S) + 4;
    const net = makeTexture(this, `table-tennis-net-${nw}`, nw, 9, (p) => {
      p.rect(0, 6, nw, 3, 0x1a3f73);
      for (let x = 2; x < nw - 2; x++) for (let y = 1; y < 5; y++) p.px(x, y, (x + y) % 2 ? 0x2b2f45 : 0x6b7290);
      p.hline(2, 0, nw - 4, 0xffffff);
      p.hline(2, 5, nw - 4, 0xc9cfe0);
      p.box(0, 0, 3, 7, 0x9aa3b8);
      p.box(nw - 3, 0, 3, 7, 0x9aa3b8);
    });
    this.add.image(this.vw / 2, this.vh / 2, net).setScale(S).setDepth(20);
    // little pennants on the net posts that flutter
    const flag = makeTexture(this, 'table-tennis-flag', 7, 5, (p) => { p.tri(0, 0, 7, 2.5, 0, 5, 0xffe066); p.vline(0, 0, 5, 0xfff8e7); p.outline(-0.7); });
    for (const x of [WALL - 2, this.vw - WALL + 2]) {
      const f = this.add.image(x, this.vh / 2 - 6, flag).setOrigin(0, 0.5).setScale(S).setDepth(21);
      if (x > this.vw / 2) f.setFlipX(true).setOrigin(1, 0.5);
      this.netFlags.push(f);
    }

    // centre posts between the two goals on each side
    const post = makeTexture(this, 'table-tennis-post', 11, 11, (p) => { p.ball(5.5, 5.5, 5, 5, 0xc0c8dc); p.ring(5.5, 5.5, 5, 0x5d6378); p.outline(-0.7); });
    for (const y of [GOAL, this.vh - GOAL]) this.add.image(this.vw / 2, y, post).setScale(S).setDepth(25);

    // rail LEDs (chasing lights)
    const led = makeTexture(this, 'table-tennis-led', 4, 4, (p) => { p.circle(2, 2, 2, 0xffffff); p.px(1, 1, 0xffffff); });
    for (const x of [WALL / 2 - 3, this.vw - WALL / 2 + 3]) {
      for (let y = 40; y < this.vh - 30; y += 34) {
        this.leds.push(this.add.image(x, y, led).setScale(S * 0.75).setDepth(-80).setTint(0xffe066));
      }
    }

    // ceiling lamp light pool + floating dust
    const lightKey = makeTexture(this, 'table-tennis-light', 120, 90, (p) => {
      for (let y = 0; y < 90; y++) for (let x = 0; x < 120; x++) {
        const d = Math.hypot((x - 60) / 60, (y - 45) / 45);
        if (d > 1) continue;
        const lv = d < 0.45 ? 4 : d < 0.65 ? 3 : d < 0.82 ? 2 : 1;
        if (lv === 1 && (x + y) % 2) continue;
        p.px(x, y, 0xfff3c4, 40 + lv * 30);
      }
    });
    this.light = this.add.image(this.vw * 0.42, this.vh * 0.44, lightKey).setScale(S * 2.2).setDepth(-70).setAlpha(0.1).setBlendMode(Phaser.BlendModes.ADD);
    const dust = this.add.particles(0, 0, 'dot2', {
      x: { min: WALL, max: this.vw - WALL }, y: { min: 30, max: this.vh - 30 },
      lifespan: 5000, speedX: { min: -6, max: 6 }, speedY: { min: -8, max: 2 }, quantity: 1, frequency: 260,
      alpha: { start: 0.35, end: 0 }, scale: { start: 1, end: 0.6 }, tint: [0xfff3c4, 0xffffff],
    });
    dust.setDepth(-60);

    // ball textures
    makeTexture(this, 'table-tennis-ball', 7, 7, (p) => { p.ball(3.5, 3.5, 3.2, 3.2, 0xfff6e0); p.outline(-0.6); });
    makeTexture(this, 'table-tennis-ball2', 7, 7, (p) => { p.ball(3.5, 3.5, 3.2, 3.2, 0xff9f43); p.outline(-0.6); });
    makeTexture(this, 'table-tennis-trail', 4, 4, (p) => p.circle(2, 2, 2, 0xffffff));
  }

  private paddleKey(p: PlayerIndex): string {
    const c = PLAYER_COLORS[p];
    return makeTexture(this, `table-tennis-pad-${p}`, 34, 15, (g) => {
      // handle toward the owner (painted at the bottom; flipped for top seats)
      g.box(14, 9, 6, 6, 0xc58b52);
      g.vline(16, 9, 6, 0xe0a96c);
      g.hline(14, 14, 6, 0x8a5a34);
      // blade
      g.ellipse(17, 5.5, 16.5, 5.5, shift(c.main, -0.45));
      g.ellipse(17, 5, 16, 4.6, c.main);
      g.ellipse(13, 3.5, 9, 1.6, c.light);
      g.hline(5, 8, 24, shift(c.main, -0.2));
      // rubber dimples
      for (let x = 6; x < 29; x += 3) g.px(x, 5 + (x % 2), shift(c.main, -0.15));
      // number dot
      g.px(17, 5, shift(c.main, 0.4));
      g.outline(-0.8);
    });
  }

  private buildPaddles(): void {
    const glowKey = makeTexture(this, 'table-tennis-glow', 40, 14, (p) => {
      for (let y = 0; y < 14; y++) for (let x = 0; x < 40; x++) {
        const d = Math.hypot((x - 20) / 20, (y - 7) / 7);
        if (d <= 1) p.px(x, y, 0xffffff, d < 0.6 ? 110 : 55);
      }
    });
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const top = p < 2;
      const left = p % 2 === 0;
      const min = left ? WALL + PW * 0.55 : this.vw / 2 + PW - 2;
      const max = left ? this.vw / 2 - PW + 2 : this.vw - WALL - PW * 0.55;
      const x = (min + max) / 2;
      const y = top ? PAD_Y : this.vh - PAD_Y;
      const active = this.players.includes(p);
      const glow = this.add.image(x, y, glowKey).setScale(S * 1.1).setTint(PLAYER_COLORS[p].main).setAlpha(0.25).setDepth(28).setBlendMode(Phaser.BlendModes.ADD);
      const shadow = this.add.image(x + 4, y + 6, this.paddleKey(p)).setScale(S).setTintFill(0x0d2550).setAlpha(0.35).setDepth(27).setFlipY(top);
      const img = this.add.image(x, y, this.paddleKey(p)).setScale(S).setDepth(30).setFlipY(top);
      // player number on the blade
      if (!active) { img.setVisible(false); shadow.setVisible(false); glow.setVisible(false); }
      this.pads.push({
        p, top, x, y, vx: 0, tx: x, min, max, img, shadow, glow, active,
        skill: 0.5 + Math.random() * 0.4, think: 0, aimOff: 0, aimHits: -1, cpuSpeed: 0,
      });
      const pad = this.pads[this.pads.length - 1];
      pad.cpuSpeed = 270 + pad.skill * 230;
    }
  }

  // ───────────────────────────── BALLS ─────────────────────────────

  private addBall(second = false): void {
    const key = second ? 'table-tennis-ball2' : 'table-tennis-ball';
    const shadow = this.add.image(0, 0, key).setScale(S).setTintFill(0x0d2550).setAlpha(0.35).setDepth(35);
    const img = this.add.image(0, 0, key).setScale(S).setDepth(40);
    const trail: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < TRAIL; i++) trail.push(this.add.image(0, 0, 'table-tennis-trail').setScale(S * (1 - i / TRAIL) * 0.9).setDepth(38).setAlpha(0));
    const b: Ball = {
      x: this.vw / 2, y: this.vh / 2, vx: 0, vy: 0, speed: BASE_SPEED, spin: 0, hop: 0, img, shadow, trail, hist: [],
      wait: 0.8, live: false, target: 0, hits: 0,
    };
    this.balls.push(b);
    this.serve(b, second ? 1.2 : 0.9);
  }

  private nextTarget(): PlayerIndex {
    for (let i = 0; i < 4; i++) {
      const q = ((this.serveTurn + i) % 4) as PlayerIndex;
      if (this.players.includes(q)) { this.serveTurn = q + 1; return q; }
    }
    return this.players[0];
  }

  private serve(b: Ball, wait: number): void {
    b.x = this.vw / 2;
    b.y = this.vh / 2;
    b.vx = b.vy = 0;
    b.spin = 0;
    b.hist = [];
    b.last = undefined;
    b.hits = 0;
    b.live = false;
    b.wait = wait;
    b.target = this.nextTarget();
    b.speed = BASE_SPEED + Math.min(70, this.elapsed * 1.2);
    b.img.setVisible(true).setScale(0);
    this.tweens.add({ targets: b.img, scale: S, duration: 280, ease: 'Back.easeOut' });
  }

  private launch(b: Ball): void {
    const q = b.target;
    const tx = (q % 2 === 0 ? (WALL + this.vw / 2) / 2 : (this.vw / 2 + this.vw - WALL) / 2) + (Math.random() - 0.5) * 120;
    const ty = q < 2 ? PAD_Y : this.vh - PAD_Y;
    const dx = tx - b.x, dy = ty - b.y;
    const l = Math.hypot(dx, dy);
    b.vx = (dx / l) * b.speed;
    b.vy = (dy / l) * b.speed;
    b.live = true;
    Audio.sfx('whoosh', 1.2);
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    // swaying lamp light, LED chase, pennants
    this.light.setPosition(this.vw * 0.45 + Math.sin(this.t * 0.5) * 40, this.vh * 0.45 + Math.cos(this.t * 0.37) * 18);
    this.light.setAlpha(0.09 + Math.sin(this.t * 2.3) * 0.02);
    const pal = [0xffe066, 0xff7a85, 0x6ec6ff, 0x7ee8b0];
    this.leds.forEach((l, i) => {
      const on = (Math.floor(this.t * 6) + i) % 4;
      l.setAlpha(on === 0 ? 1 : 0.35).setTint(pal[(i + Math.floor(this.t * 1.5)) % 4]);
    });
    this.netFlags.forEach((f, i) => f.setScale(S * (0.85 + Math.sin(this.t * 9 + i * 2) * 0.15), S));
    // paddles (humans move even before GO so they can warm up)
    for (const pad of this.pads) {
      if (!pad.active) continue;
      if (!this.isCpu(pad.p) && this.state !== 'end') {
        const touches = this.touch.touchesFor(pad.p);
        const f = touches[touches.length - 1];
        if (f) pad.tx = f.x;
      }
      pad.tx = Phaser.Math.Clamp(pad.tx, pad.min, pad.max);
      const prev = pad.x;
      if (this.isCpu(pad.p)) {
        const d = pad.tx - pad.x;
        const step = pad.cpuSpeed * dt;
        pad.x += Phaser.Math.Clamp(d, -step, step);
      } else {
        pad.x += (pad.tx - pad.x) * Math.min(1, dt * 22);
      }
      pad.x = Phaser.Math.Clamp(pad.x, pad.min, pad.max);
      const v = (pad.x - prev) / Math.max(dt, 1e-4);
      pad.vx += (v - pad.vx) * Math.min(1, dt * 18);
      const tilt = Phaser.Math.Clamp(pad.vx / 1800, -0.1, 0.1) * (pad.top ? -1 : 1);
      pad.img.setPosition(pad.x, pad.y).setRotation(tilt);
      pad.shadow.setPosition(pad.x + 4, pad.y + 7).setRotation(tilt);
      pad.glow.setPosition(pad.x, pad.y);
    }
    for (const b of this.balls) this.drawBall(b);
  }

  private drawBall(b: Ball): void {
    const z = b.live ? Math.abs(Math.sin(b.hop)) * 7 : 0;
    b.img.setPosition(b.x, b.y - z);
    b.shadow.setPosition(b.x + 2 + z * 0.4, b.y + 3).setScale(S * (1 - z / 30));
    b.img.rotation += b.spin * 0.05;
    const col = b.last !== undefined ? PLAYER_COLORS[b.last].main : 0xffffff;
    const fast = Phaser.Math.Clamp((b.speed - 300) / 250, 0, 1);
    b.trail.forEach((t, i) => {
      const h = b.hist[b.hist.length - 1 - (i + 1) * 2];
      if (!h || !b.live) { t.setAlpha(0); return; }
      t.setPosition(h.x, h.y).setTint(fast > 0.6 && i < 2 ? 0xffe066 : col).setAlpha((1 - i / TRAIL) * (0.35 + fast * 0.45));
    });
  }

  tick(dt: number): void {
    if (!this.multiball && this.elapsed >= 30) {
      this.multiball = true;
      this.addBall(true);
      Audio.sfx('power');
      this.banner('MULTIBALL! ลูกที่ 2!', '#ff9f43');
    }
    for (const pad of this.pads) if (pad.active && this.isCpu(pad.p)) this.bot(pad, dt);
    for (const b of this.balls) this.stepBall(b, dt);
  }

  private stepBall(b: Ball, dt: number): void {
    if (!b.live) {
      b.wait -= dt;
      b.img.setAlpha(Math.floor(b.wait * 8) % 2 ? 0.6 : 1);
      if (b.wait <= 0) { b.img.setAlpha(1); this.launch(b); }
      return;
    }
    // spin curves the flight, then fades
    if (b.spin !== 0) {
      const a = b.spin * dt;
      const c = Math.cos(a), s = Math.sin(a);
      const nvx = b.vx * c - b.vy * s, nvy = b.vx * s + b.vy * c;
      b.vx = nvx; b.vy = nvy;
      b.spin *= Math.pow(0.35, dt);
      if (Math.abs(b.spin) < 0.05) b.spin = 0;
    }
    // never let the ball crawl sideways forever
    const sp = Math.hypot(b.vx, b.vy) || 1;
    if (Math.abs(b.vy) < sp * 0.34) {
      b.vy = Math.sign(b.vy || (b.y < this.vh / 2 ? 1 : -1)) * sp * 0.34;
      b.vx = Math.sign(b.vx) * Math.sqrt(Math.max(0, sp * sp - b.vy * b.vy));
    }
    const k = b.speed / (Math.hypot(b.vx, b.vy) || 1);
    b.vx *= k; b.vy *= k;
    const steps = Math.ceil((b.speed * dt) / 5);
    const h = dt / steps;
    for (let i = 0; i < steps && b.live; i++) this.substep(b, h);
    b.hop += (b.speed * dt) / 55;
    b.hist.push({ x: b.x, y: b.y });
    if (b.hist.length > TRAIL * 2 + 2) b.hist.shift();
  }

  private substep(b: Ball, h: number): void {
    const py = b.y;
    b.x += b.vx * h;
    b.y += b.vy * h;
    // side walls
    if (b.x < WALL + BALL_R) { b.x = WALL + BALL_R; b.vx = Math.abs(b.vx); this.wallFx(b); }
    if (b.x > this.vw - WALL - BALL_R) { b.x = this.vw - WALL - BALL_R; b.vx = -Math.abs(b.vx); this.wallFx(b); }
    // centre posts
    for (const y of [GOAL, this.vh - GOAL]) {
      const dx = b.x - this.vw / 2, dy = b.y - y;
      const d = Math.hypot(dx, dy);
      if (d < POST_R + BALL_R && d > 0) {
        const nx = dx / d, ny = dy / d;
        b.x = this.vw / 2 + nx * (POST_R + BALL_R);
        b.y = y + ny * (POST_R + BALL_R);
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
        this.wallFx(b);
      }
    }
    // paddles
    for (const pad of this.pads) {
      if (!pad.active) continue;
      const toward = pad.top ? b.vy < 0 : b.vy > 0;
      if (!toward) continue;
      const face = pad.y + (pad.top ? PH : -PH);
      const crossed = pad.top ? py - BALL_R >= face - 2 && b.y - BALL_R < face : py + BALL_R <= face + 2 && b.y + BALL_R > face;
      const inside = Math.abs(b.y - pad.y) < PH + BALL_R && (pad.top ? b.y > pad.y - PH : b.y < pad.y + PH);
      if ((crossed || inside) && Math.abs(b.x - pad.x) < PW + BALL_R * 0.8) this.hitPaddle(b, pad, face);
    }
    // inactive seats are walls
    for (const q of [0, 1, 2, 3] as PlayerIndex[]) {
      if (this.players.includes(q)) continue;
      const left = q % 2 === 0;
      if (left ? b.x > this.vw / 2 : b.x < this.vw / 2) continue;
      if (q < 2 && b.y < GOAL + BALL_R) { b.y = GOAL + BALL_R; b.vy = Math.abs(b.vy); this.wallFx(b); }
      if (q >= 2 && b.y > this.vh - GOAL - BALL_R) { b.y = this.vh - GOAL - BALL_R; b.vy = -Math.abs(b.vy); this.wallFx(b); }
    }
    // goals
    if (b.y < GOAL - 2) this.goal(b, b.x < this.vw / 2 ? 0 : 1);
    else if (b.y > this.vh - GOAL + 2) this.goal(b, b.x < this.vw / 2 ? 2 : 3);
  }

  private wallFx(b: Ball): void {
    Audio.sfx('bounce', 1.6);
    burst(this, b.x, b.y, { tex: 'dot2', count: 4, tint: [0xffffff, 0xffe066], speed: [30, 90], life: 220 });
  }

  private hitPaddle(b: Ball, pad: Paddle, face: number): void {
    const off = Phaser.Math.Clamp((b.x - pad.x) / PW, -1, 1);
    b.speed = Math.min(MAX_SPEED, b.speed * 1.04 + 5);
    const ang = off * 1.0 + Phaser.Math.Clamp(pad.vx / 2600, -0.35, 0.35);
    const dir = pad.top ? 1 : -1;
    b.vx = Math.sin(ang) * b.speed;
    b.vy = Math.cos(ang) * b.speed * dir;
    b.spin = Phaser.Math.Clamp(-pad.vx / 520, -2.4, 2.4) * dir;
    b.y = face + dir * (BALL_R + 0.5);
    b.last = pad.p;
    b.hits++;
    const fast = b.speed > 430;
    Audio.sfx(fast ? 'bigHit' : 'hit', 1 + pad.p * 0.1);
    Vfx.hit(this, b.x, face, [0xffffff, PLAYER_COLORS[pad.p].light, 0xffe066]);
    Vfx.squash(this, pad.img, 1.18, 0.7, 140);
    pad.img.setFlipY(pad.top);
    pad.glow.setAlpha(0.8);
    this.tweens.add({ targets: pad.glow, alpha: 0.25, duration: 260 });
    if (fast) {
      Vfx.speedLines(this, b.x, b.y, (Math.atan2(b.vy, b.vx) * 180) / Math.PI + 180, 0xffe066);
      if (b.speed > 540) Vfx.shake(this, 0.003, 90);
    }
    if (Math.abs(b.spin) > 1.2) Vfx.popText(this, b.x, face + dir * 18, 'SPIN!', '#b8a6ff', 12, this.angleFor(pad.p));
    if (b.hits >= 6 && b.hits % 3 === 0) this.rally(b.hits);
  }

  private rally(n: number): void {
    for (const t of this.rallyText) {
      t.setText(`แรลลี่ ${n}!`).setAlpha(1).setScale(0.5);
      this.tweens.killTweensOf(t);
      this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 700, duration: 300 });
    }
  }

  private goal(b: Ball, owner: PlayerIndex): void {
    b.live = false;
    const conceded = this.players.includes(owner);
    if (conceded) {
      this.addScore(owner, -1);
      const strip = this.goalStrips[owner];
      strip.setAlpha(0.9);
      this.tweens.add({ targets: strip, alpha: 0, duration: 140, yoyo: true, repeat: 2, onComplete: () => strip.setAlpha(0) });
      const ox = b.x, oy = owner < 2 ? GOAL + 30 : this.vh - GOAL - 30;
      Vfx.popText(this, ox, oy, '−1', '#ff7a85', 22, this.angleFor(owner));
      const pad = this.pads[owner];
      Vfx.hitFlash(this, pad.img, 160);
    }
    const scorer = b.last;
    if (scorer !== undefined && scorer !== owner) {
      this.addScore(scorer, 1);
      const sp = this.pads[scorer];
      Vfx.popText(this, sp.x, sp.y + (sp.top ? 30 : -30), '+1 แต้ม!', toCss(PLAYER_COLORS[scorer].light), 15, this.angleFor(scorer));
      Vfx.sparkle(this, sp.x, sp.y, [PLAYER_COLORS[scorer].light, 0xffffff]);
    }
    Audio.sfx('explode', 1.3);
    Audio.sfx('wrong');
    Vfx.explosion(this, Phaser.Math.Clamp(b.x, WALL + 10, this.vw - WALL - 10), owner < 2 ? GOAL : this.vh - GOAL, 0.45);
    b.img.setVisible(false);
    for (const t of b.trail) t.setAlpha(0);
    this.serve(b, 1.1);
  }

  private banner(text: string, color: string): void {
    for (const [deg, y] of [[0, this.vh * 0.64], [180, this.vh * 0.36]] as const) {
      const t = txt(this, this.vw / 2, y, text, { size: 30, color, strokeWidth: 7 }).setAngle(deg).setDepth(3000);
      this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 300, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 1300, duration: 300, onComplete: () => t.destroy() });
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  /** Where a ball will cross a horizontal line, folding wall bounces. */
  private predictX(b: Ball, y: number): { x: number; t: number } | undefined {
    if (!b.live) return undefined;
    if (Math.abs(b.vy) < 1) return undefined;
    const t = (y - b.y) / b.vy;
    if (t < 0) return undefined;
    const lo = WALL + BALL_R, hi = this.vw - WALL - BALL_R, w = hi - lo;
    let x = b.x + b.vx * t - lo;
    x = ((x % (2 * w)) + 2 * w) % (2 * w);
    if (x > w) x = 2 * w - x;
    return { x: x + lo, t };
  }

  private bot(pad: Paddle, dt: number): void {
    pad.think -= dt;
    if (pad.think > 0) return;
    pad.think = 0.07 + (1 - pad.skill) * 0.16 + Math.random() * 0.06;
    const face = pad.y + (pad.top ? PH : -PH);
    let best: { x: number; t: number; b: Ball } | undefined;
    for (const b of this.balls) {
      const toward = pad.top ? b.vy < 0 : b.vy > 0;
      if (!toward) continue;
      const pr = this.predictX(b, face);
      if (!pr) continue;
      // only care about balls heading into my half of the edge
      const mine = pad.p % 2 === 0 ? pr.x < this.vw / 2 + 20 : pr.x > this.vw / 2 - 20;
      if (!mine) continue;
      // spin makes the read harder
      const noise = (1 - pad.skill) * (30 + Math.abs(b.spin) * 26) * Math.min(1, pr.t * 1.4);
      pr.x += (Math.random() - 0.5) * 2 * noise;
      if (!best || pr.t < best.t) best = { ...pr, b };
    }
    if (best) {
      const b = best.b;
      if (pad.aimBall !== b || pad.aimHits !== b.hits) {
        // New incoming ball: pick a victim on the other side and aim at the spot their paddle is not.
        pad.aimBall = b;
        pad.aimHits = b.hits;
        const victims = this.pads.filter((o) => o.active && o.top !== pad.top);
        const v = victims[Math.floor(Math.random() * victims.length)];
        let off = 0;
        if (v) {
          const far = Math.abs(v.x - v.min) > Math.abs(v.x - v.max) ? v.min - PW * 0.3 : v.max + PW * 0.3;
          const tx = Phaser.Math.Clamp(far, WALL + 10, this.vw - WALL - 10);
          const ang = Math.atan2(tx - best.x, Math.abs(v.y - face));
          off = Phaser.Math.Clamp(ang, -0.85, 0.85) * (0.5 + pad.skill * 0.5);
        }
        // Sometimes a CPU simply misreads the ball.
        const blunder = Math.random() < 0.15 + (1 - pad.skill) * 0.25 + Math.min(0.18, (b.speed - 300) / 1400);
        pad.aimOff = off * PW + (blunder ? (Math.random() < 0.5 ? -1 : 1) * PW * (1.15 + Math.random() * 0.5) : 0);
      }
      pad.tx = best.x - pad.aimOff;
    } else {
      // drift home, slightly toward the middle of the table
      const home = (pad.min + pad.max) / 2 + (pad.p % 2 === 0 ? 18 : -18);
      pad.tx = home + Math.sin(this.elapsed * 0.8 + pad.p) * 20;
      pad.aimBall = undefined;
    }
  }
}

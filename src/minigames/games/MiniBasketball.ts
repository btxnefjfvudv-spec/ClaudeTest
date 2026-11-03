import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import type { TrackedTouch } from '../../systems/input/MultiTouchManager';
import { Avatar } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';

const G = 1000;
const ZR = 46; // rim height
const RR = 20; // rim radius (world)
const BR = 8; // ball radius (world, at rim height)
const Z0 = 22;
const COOLDOWN = 0.5;
const BALL_FRAMES = 6;
const AIM_DOTS = 9;
const FIRE_EVERY = 13;
const FIRE_LEN = 5.5;

interface Ball {
  owner: PlayerIndex;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  state: 'fly' | 'in' | 'dead';
  rimHits: number;
  life: number;
  fire: boolean;
}

interface Shooter {
  p: PlayerIndex;
  av: Avatar;
  sx: number;
  sy: number;
  /** unit vector from spot toward court centre */
  dx: number;
  dy: number;
  hand: Phaser.GameObjects.Image;
  handShadow: Phaser.GameObjects.Image;
  cd: number;
  aim: Phaser.GameObjects.Image[];
  touchId: number;
  cpuT: number;
  cpuErr: number;
  made: number;
  streak: number;
}

/** #21 — Flick balls into a drone-carried hoop that drifts around the room. Flaming hoop = 3 points. */
export default class MiniBasketball extends BaseMinigame {
  private shooters: Shooter[] = [];
  private balls: Ball[] = [];
  private hx = 0;
  private hy = 0;
  private hvx = 0;
  private hvy = 0;
  private hoopT = 0;
  private hoopMode: 'hover' | 'glide' = 'hover';
  private glideDur = 1;
  private wpFrom = { x: 0, y: 0 };
  private wpTo = { x: 0, y: 0 };
  private wpOrder: number[] = [];
  private hoop!: Phaser.GameObjects.Image;
  private net!: Phaser.GameObjects.Sprite;
  private props: Phaser.GameObjects.Sprite[] = [];
  private hoopShadow!: Phaser.GameObjects.Image;
  private drone!: Phaser.GameObjects.Image;
  private glow!: Phaser.GameObjects.Image;
  private fire = false;
  private fireT = 0;
  private fireFx = 0;
  private sheen!: Phaser.GameObjects.Image;
  private motes: Phaser.GameObjects.Image[] = [];
  private netT = 0;

  constructor() {
    super(CATALOG['mini-basketball']);
  }

  setup(): void {
    this.shooters = [];
    this.balls = [];
    this.motes = [];
    this.props = [];
    this.fire = false;
    this.fireT = FIRE_EVERY;
    this.hoopT = 1.5;
    this.hoopMode = 'hover';
    this.wpOrder = [];
    this.netT = 0;
    this.paintArt();
    this.add.image(0, 0, `mb-court-${Math.ceil(this.vw / S)}`).setOrigin(0).setScale(S).setDepth(-100);
    this.sheen = this.add.image(-200, 0, 'mb-sheen').setOrigin(0.5, 0).setScale(S).setDepth(-90).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.16);
    for (let i = 0; i < 14; i++) {
      this.motes.push(this.add.image(Math.random() * this.vw, Math.random() * this.vh, 'dot2').setScale(S * 0.5).setAlpha(0.25).setDepth(-80).setData('ph', Math.random() * 6));
    }
    this.hx = this.vw / 2;
    this.hy = this.vh / 2;
    this.hoopShadow = this.add.image(this.hx, this.hy, 'mb-hoop-shadow').setScale(S).setAlpha(0.28).setDepth(-60);
    this.glow = this.add.image(this.hx, this.hy, 'mb-glow').setScale(S).setDepth(588).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.drone = this.add.image(this.hx, this.hy, 'mb-drone').setScale(S).setDepth(589);
    this.net = this.add.sprite(this.hx, this.hy, 'mb-net', 0).setScale(S).setDepth(590);
    this.hoop = this.add.image(this.hx, this.hy, 'mb-hoop').setScale(S).setDepth(600);
    for (let i = 0; i < 4; i++) this.props.push(this.add.sprite(0, 0, 'mb-prop', 0).setScale(S).setDepth(601));
    for (const p of this.players) this.makeShooter(p);
    this.touch.on('down', (t: TrackedTouch) => this.onDown(t));
    this.touch.on('up', (t: TrackedTouch) => this.onUp(t));
    this.touch.on('cancel', (t: TrackedTouch) => { const s = this.shooter(t.player); if (s && s.touchId === t.pointerId) s.touchId = -1; });
    this.placeHoop();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    makeTexture(this, `mb-court-${aw}`, aw, ah, (p) => {
      const r = rng(17);
      // planks
      for (let y = 0; y < ah; y += 6) {
        let x = -Math.floor(r() * 40);
        while (x < aw) {
          const len = 30 + Math.floor(r() * 40);
          const base = [0xd99a5a, 0xd4945a, 0xdea262, 0xcf8e54][Math.floor(r() * 4)];
          p.rect(x, y, len, 6, base);
          p.hline(x, y, len, shift(base, 0.18));
          p.hline(x, y + 5, len, shift(base, -0.2));
          p.vline(x, y, 6, shift(base, -0.35));
          for (let k = 0; k < 3; k++) p.hline(x + Math.floor(r() * len), y + 2 + Math.floor(r() * 3), 2 + Math.floor(r() * 4), shift(base, -0.1));
          x += len;
        }
      }
      const line = 0xfff4e0;
      const cx = aw / 2, cy = ah / 2;
      // painted centre zone
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < 46) p.px(x, y, 0x3d6bd8, 70);
      }
      p.ring(cx, cy, 46, line, 1);
      p.ring(cx, cy, 16, line, 1);
      // boundary
      const m = 6;
      p.rect(m, m, aw - m * 2, 1, line); p.rect(m, ah - m - 1, aw - m * 2, 1, line);
      p.rect(m, m, 1, ah - m * 2, line); p.rect(aw - m - 1, m, 1, ah - m * 2, line);
      p.vline(Math.floor(cx), m, ah - m * 2, line, 120);
      p.hline(m, Math.floor(cy), aw - m * 2, line, 120);
      // a shooting arc around each corner, tinted with the owner's colour
      const corners: [number, number, number][] = [[m, m, PLAYER_COLORS[0].main], [aw - m, m, PLAYER_COLORS[1].main], [m, ah - m, PLAYER_COLORS[2].main], [aw - m, ah - m, PLAYER_COLORS[3].main]];
      for (const [x0, y0, col] of corners) {
        for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
          const d = Math.hypot(x + 0.5 - x0, y + 0.5 - y0);
          if (d < 62) p.px(x, y, col, 45);
          if (d >= 61 && d < 62.2) p.px(x, y, line);
          if (d >= 62.2 && d < 63.2) p.px(x, y, col, 200);
        }
      }
      // border strip
      p.rect(0, 0, aw, 3, 0x3a2a3e); p.rect(0, ah - 3, aw, 3, 0x3a2a3e);
      p.rect(0, 0, 3, ah, 0x3a2a3e); p.rect(aw - 3, 0, 3, ah, 0x3a2a3e);
      // centre logo: a ball (reads the same from every seat)
      p.circle(cx, cy, 7, 0xffb070, 150);
      p.ring(cx, cy, 7, 0xfff4e0, 1);
      p.hline(Math.floor(cx) - 6, Math.floor(cy), 13, 0xfff4e0);
      p.vline(Math.floor(cx), Math.floor(cy) - 6, 13, 0xfff4e0);
    });
    makeTexture(this, 'mb-sheen', 120, Math.ceil(this.vh / S), (p) => {
      // soft diagonal band of light from the gym windows
      for (let y = 0; y < p.h; y++) for (let x = 0; x < 120; x++) {
        const u = (x - y * 0.4 + p.h * 0.4) / 120;
        if (u < 0 || u > 1) continue;
        p.px(x, y, 0xfff0d0, Math.round(255 * Math.pow(Math.sin(u * Math.PI), 2)));
      }
    });
    // hoop: orange rim + white net seen from above
    makeTexture(this, 'mb-hoop', 26, 26, (p) => {
      p.ring(13, 13, 11.5, 0xc94a1a, 3);
      p.ring(13, 13, 11, 0xff7a2a, 1.5);
      for (let a = 0; a < 8; a++) {
        const ang = (a * Math.PI) / 4 - 0.8;
        p.px(Math.round(13 + Math.cos(ang) * 10), Math.round(13 + Math.sin(ang) * 10), 0xffb070);
      }
      p.outline(-0.6);
    });
    makeTexture(this, 'mb-hoop-fire', 26, 26, (p) => {
      p.ring(13, 13, 11.5, 0xd8241a, 3);
      p.ring(13, 13, 11, 0xffd23a, 1.5);
      p.outline(-0.5);
    });
    makeSheet(this, 'mb-net', 22, 22, 2, (p, i) => {
      const c = 11;
      for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
        if (d > 9.5) continue;
        const on = ((x + y + i) % 4 === 0) || ((x - y + 44 + i) % 4 === 0);
        if (on) p.px(x, y, d < 4 ? 0xc8d0e0 : 0xf4f6fa);
      }
      p.circle(c, c, 3.2, 0x3a2a3e, 120);
    });
    const drone = (p: { stroke: (a: number, b: number, c: number, d: number, s: number, col: number) => void; circle: (x: number, y: number, r: number, c: number) => void }, c: number, arm: number, pod: number) => {
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        p.stroke(c + sx * 8, c + sy * 8, c + sx * 13.5, c + sy * 13.5, 2, arm);
        p.circle(c + sx * 13.5, c + sy * 13.5, 2.6, pod);
      }
    };
    makeTexture(this, 'mb-drone', 34, 34, (p) => {
      drone(p, 17, 0x4a4a60, 0x2b2b3a);
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.px(17 + sx * 13 - 1, 17 + sy * 13 - 1, 0x8a8aa0);
      p.outline(-0.6);
    });
    makeTexture(this, 'mb-hoop-shadow', 34, 34, (p) => {
      p.ring(17, 17, 11.5, 0x000000, 3);
      drone(p, 17, 0x000000, 0x000000);
    });
    makeSheet(this, 'mb-prop', 12, 12, 2, (p, i) => {
      p.circle(6, 6, 2.5, 0x3a3a4e);
      p.px(5, 5, 0x8a8aa0);
      const c = 0xd8e0f0;
      if (i === 0) { p.line(1, 6, 11, 6, c); p.line(1, 5, 4, 5, c); p.line(8, 7, 11, 7, c); }
      else { p.line(6, 1, 6, 11, c); p.line(7, 1, 7, 4, c); p.line(5, 8, 5, 11, c); }
      p.outline(-0.7);
    });
    makeTexture(this, 'mb-arm', 6, 2, (p) => p.rect(0, 0, 6, 2, 0x5a5a70));
    for (const pl of [0, 1, 2, 3] as PlayerIndex[]) {
      const col = PLAYER_COLORS[pl];
      makeSheet(this, `mb-ball-${pl}`, 22, 22, BALL_FRAMES, (p, i) => {
        const r = 4.5 + i * 0.9;
        const c = 11;
        p.ball(c, c, r, r, 0xff8a3d, false);
        p.ellipse(c - r * 0.35, c - r * 0.4, r * 0.3, r * 0.22, 0xffc08a);
        // seams
        for (let y = Math.floor(c - r); y <= c + r; y++) for (let x = Math.floor(c - r); x <= c + r; x++) {
          const dx = x + 0.5 - c, dy = y + 0.5 - c;
          const d = Math.hypot(dx, dy);
          if (d > r - 0.3) continue;
          if (Math.abs(dx + dy * 0.2) < 0.5 || Math.abs(dy - dx * 0.2) < 0.5 || Math.abs(Math.hypot(dx - r * 0.95, dy) - r * 0.7) < 0.45) p.px(x, y, 0x7a2e10);
        }
        p.ring(c, c, r + 1.3, col.main, 1.3);
        p.outline(-0.8);
      });
      makeTexture(this, `mb-aim-${pl}`, 4, 4, (p) => { p.circle(2, 2, 2, col.light); p.px(1, 1, 0xffffff); });
    }
    makeTexture(this, 'mb-glow', 48, 48, (p) => {
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        const d = Math.hypot(x + 0.5 - 24, y + 0.5 - 24) / 24;
        if (d < 1) p.px(x, y, 0xff8a2a, Math.round(200 * (1 - d) * (1 - d)));
      }
    });
    makeTexture(this, 'mb-flame', 5, 7, (p) => {
      p.tri(2.5, 0, 0, 6, 5, 6, 0xffd23a);
      p.circle(2.5, 5, 2.4, 0xffd23a);
      p.circle(2.5, 5, 1.2, 0xffffff);
    });
  }

  // ───────────────────────────── PLAYERS ─────────────────────────────

  private shooter(p: PlayerIndex): Shooter | undefined {
    return this.shooters.find((s) => s.p === p);
  }

  private makeShooter(p: PlayerIndex): void {
    const left = p % 2 === 0, top = p < 2;
    const sx = this.vw * (left ? 0.12 : 0.88), sy = this.vh * (top ? 0.22 : 0.78);
    const av = new Avatar(this, p, sx, sy, { ring: true });
    av.markerAngle = this.angleFor(p);
    av.face(left ? 1 : -1);
    const dl = Math.hypot(this.vw / 2 - sx, this.vh / 2 - sy);
    const dx = (this.vw / 2 - sx) / dl, dy = (this.vh / 2 - sy) / dl;
    const handShadow = this.add.image(0, 0, 'shadow').setScale(S * 0.5).setAlpha(0.25).setDepth(-50);
    const hand = this.add.image(0, 0, `mb-ball-${p}`, 1).setScale(S);
    const aim = Array.from({ length: AIM_DOTS }, () => this.add.image(0, 0, `mb-aim-${p}`).setScale(S).setDepth(800).setVisible(false));
    const s: Shooter = { p, av, sx, sy, dx, dy, hand, handShadow, cd: 0, aim, touchId: -1, cpuT: 1 + Math.random(), cpuErr: 0.8 + Math.random() * 0.6, made: 0, streak: 0 };
    this.shooters.push(s);
    this.placeHand(s);
  }

  private handPos(s: Shooter): { x: number; y: number } {
    return { x: s.sx + s.dx * 18, y: s.sy + s.dy * 10 - 6 };
  }

  private placeHand(s: Shooter): void {
    const h = this.handPos(s);
    s.hand.setPosition(h.x, h.y).setDepth(s.sy + 5);
    s.handShadow.setPosition(h.x + 6, h.y + 8);
  }

  private onDown(t: TrackedTouch): void {
    const s = this.shooter(t.player);
    if (!s || this.isCpu(s.p) || this.state !== 'play') return;
    s.touchId = t.pointerId;
  }

  private onUp(t: TrackedTouch): void {
    const s = this.shooter(t.player);
    if (!s || this.isCpu(s.p) || s.touchId !== t.pointerId) return;
    s.touchId = -1;
    for (const d of s.aim) d.setVisible(false);
    if (this.state !== 'play') return;
    const dx = t.x - t.startX, dy = t.y - t.startY;
    const len = Math.hypot(dx, dy);
    if (len < 14) return;
    this.shoot(s, Math.atan2(dy, dx), this.rangeFor(len));
  }

  private rangeFor(dragLen: number): number {
    return Phaser.Math.Clamp(60 + dragLen * 1.9, 80, 600);
  }

  private shoot(s: Shooter, ang: number, range: number): void {
    if (s.cd > 0) return;
    s.cd = COOLDOWN;
    const h = this.handPos(s);
    const T = 0.42 + range / 1300;
    const v = range / T;
    const vz = (ZR - Z0 + 0.5 * G * T * T) / T;
    const img = this.add.image(h.x, h.y, `mb-ball-${s.p}`, 1).setScale(S);
    const shadow = this.add.image(h.x, h.y, 'shadow').setScale(S * 0.5).setAlpha(0.28).setDepth(-50);
    this.balls.push({ owner: s.p, x: h.x, y: h.y, z: Z0, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, vz, img, shadow, state: 'fly', rimHits: 0, life: 4, fire: this.fire });
    s.hand.setVisible(false);
    s.handShadow.setVisible(false);
    s.av.play('attack', true);
    s.av.face(Math.cos(ang) >= 0 ? 1 : -1);
    Vfx.squash(this, s.av.sprite, 0.8, 1.25, 180);
    Audio.sfx('throw', 1 + s.p * 0.1);
  }

  // ───────────────────────────── HOOP ─────────────────────────────

  /** The drone hovers, then glides to the next waypoint (each one leaning toward a different player in turn). */
  private moveHoop(dt: number): void {
    const f = Math.min(1, this.elapsed / this.meta.duration);
    this.hoopT -= dt;
    if (this.hoopT <= 0) {
      if (this.hoopMode === 'hover') {
        if (!this.wpOrder.length) this.wpOrder = Phaser.Utils.Array.Shuffle([0, 1, 2, 3, -1]);
        const q = this.wpOrder.shift()!;
        const ax = this.vw * (0.08 + f * 0.12), ay = this.vh * (0.07 + f * 0.09);
        const bx = q < 0 ? 0 : q % 2 === 0 ? -1 : 1, by = q < 0 ? 0 : q < 2 ? -1 : 1;
        this.wpFrom = { x: this.hx, y: this.hy };
        this.wpTo = {
          x: this.vw / 2 + (bx * 0.6 + (Math.random() - 0.5) * 0.8) * ax,
          y: this.vh / 2 + (by * 0.6 + (Math.random() - 0.5) * 0.8) * ay,
        };
        this.hoopMode = 'glide';
        this.hoopT = this.glideDur = 1.5 - f * 0.5;
      } else {
        this.hoopMode = 'hover';
        this.hoopT = 1.7 - f * 0.8;
      }
    }
    let nx = this.hx, ny = this.hy;
    if (this.hoopMode === 'glide') {
      const k = Phaser.Math.Easing.Sine.InOut(1 - this.hoopT / this.glideDur);
      nx = this.wpFrom.x + (this.wpTo.x - this.wpFrom.x) * k;
      ny = this.wpFrom.y + (this.wpTo.y - this.wpFrom.y) * k;
    }
    this.hvx = (nx - this.hx) / Math.max(1e-3, dt);
    this.hvy = (ny - this.hy) / Math.max(1e-3, dt);
    this.hx = nx;
    this.hy = ny;
  }

  private placeHoop(): void {
    const fire = this.fire;
    this.hoop.setPosition(this.hx, this.hy).setTexture(fire ? 'mb-hoop-fire' : 'mb-hoop');
    this.net.setPosition(this.hx, this.hy);
    this.glow.setPosition(this.hx, this.hy).setVisible(fire).setAlpha(0.6 + Math.sin(this.time.now / 90) * 0.25);
    this.drone.setPosition(this.hx, this.hy + Math.sin(this.time.now / 260) * 1);
    this.hoopShadow.setPosition(this.hx + ZR * 0.35, this.hy + ZR * 0.35);
    const off = 13.5 * S;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy], i) => this.props[i].setPosition(this.hx + sx * off, this.hy + sy * off + 1));
  }

  private setFire(on: boolean): void {
    this.fire = on;
    this.fireT = on ? FIRE_LEN : FIRE_EVERY - FIRE_LEN;
    if (on) {
      Audio.sfx('power');
      Audio.sfx('explode', 1.6);
      for (const [deg, y] of [[0, this.vh * 0.5 + 70], [180, this.vh * 0.5 - 70]] as const) {
        const t = txt(this, this.vw / 2, y, 'ห่วงไฟลุก! 3 แต้ม', { size: 24, color: '#ffb040', strokeWidth: 6 }).setAngle(deg).setDepth(3000);
        this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        this.tweens.add({ targets: t, alpha: 0, delay: 1100, duration: 300, onComplete: () => t.destroy() });
      }
    }
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  tick(dt: number): void {
    this.moveHoop(dt);
    this.fireT -= dt;
    if (this.fireT <= 0 && this.timeLeft > 2) this.setFire(!this.fire);
    for (const s of this.shooters) {
      if (s.cd > 0) {
        s.cd -= dt;
        if (s.cd <= 0) {
          s.hand.setVisible(true).setScale(S * 0.3);
          s.handShadow.setVisible(true);
          this.tweens.add({ targets: s.hand, scale: S, duration: 140, ease: 'Back.easeOut' });
          s.av.play('idle');
        }
      }
      if (this.isCpu(s.p)) this.bot(s, dt);
    }
    for (const b of this.balls) this.stepBall(b, dt);
    this.balls = this.balls.filter((b) => {
      if (b.state === 'dead') { b.img.destroy(); b.shadow.destroy(); return false; }
      return true;
    });
  }

  private stepBall(b: Ball, dt: number): void {
    b.life -= dt;
    const pz = b.z;
    b.vz -= G * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    if (b.state === 'fly' && pz > ZR && b.z <= ZR && b.vz < 0) {
      const dx = b.x - this.hx, dy = b.y - this.hy;
      const d = Math.hypot(dx, dy);
      if (d < RR - BR * 0.55) this.score_(b);
      else if (d < RR + BR * 0.8) this.rim(b, dx, dy, d);
    }
    if (b.state === 'in') {
      // dropping through the net: slow and centred
      b.vx *= Math.pow(0.02, dt); b.vy *= Math.pow(0.02, dt);
      b.x += (this.hx - b.x) * Math.min(1, dt * 10);
      b.y += (this.hy - b.y) * Math.min(1, dt * 10);
    }
    if (b.z <= 0) {
      b.z = 0;
      if (Math.abs(b.vz) > 120) {
        b.vz = -b.vz * 0.45;
        b.vx *= 0.7; b.vy *= 0.7;
        Audio.sfx('bounce', 0.7 + b.owner * 0.05);
        Vfx.dust(this, b.x, b.y);
      } else {
        b.vz = 0;
        b.vx *= Math.pow(0.15, dt); b.vy *= Math.pow(0.15, dt);
        if (b.state === 'fly') b.state = 'in'; // rolling: no more scoring
        b.life = Math.min(b.life, 0.6);
      }
    }
    if (b.x < -20 || b.x > this.vw + 20 || b.y < -20 || b.y > this.vh + 20) b.life = 0;
    if (b.life <= 0) b.state = 'dead';
    // render: size by height, shadow offset away from the top-left light
    const frame = Phaser.Math.Clamp(Math.round(b.z / 32), 0, BALL_FRAMES - 1);
    b.img.setPosition(b.x, b.y).setFrame(frame).setAlpha(b.life < 0.4 ? b.life / 0.4 : 1);
    b.img.setDepth(b.z > ZR ? 700 + b.z : 400 + b.y * 0.1);
    b.shadow.setPosition(b.x + b.z * 0.35, b.y + b.z * 0.35).setScale(S * (0.55 - Math.min(0.3, b.z / 500)), S * 0.5 * (0.55 - Math.min(0.3, b.z / 500)) * 1.6);
  }

  private rim(b: Ball, dx: number, dy: number, d: number): void {
    b.rimHits++;
    Audio.sfx('bounce', 1.6);
    Vfx.hit(this, this.hx + (dx / d) * RR, this.hy + (dy / d) * RR, [0xffffff, 0xffb070]);
    this.tweens.add({ targets: this.hoop, scale: { from: S * 1.12, to: S }, duration: 160 });
    const sp = Math.hypot(b.vx, b.vy);
    let nx = dx / d, ny = dy / d;
    // inner half of the rim: sometimes rattles in
    if (d < RR && b.rimHits < 3 && Math.random() < 0.45) { nx = -nx; ny = -ny; }
    const k = 0.18 + Math.random() * 0.2;
    const j = (Math.random() - 0.5) * 0.8;
    b.vx = (nx * Math.cos(j) - ny * Math.sin(j)) * sp * k + this.hvx * 0.15;
    b.vy = (ny * Math.cos(j) + nx * Math.sin(j)) * sp * k + this.hvy * 0.15;
    b.vz = Math.abs(b.vz) * 0.35 + 140;
    b.z = ZR + 1;
    if (b.rimHits >= 3) b.state = 'in';
  }

  private score_(b: Ball): void {
    b.state = 'in';
    const s = this.shooter(b.owner);
    const pts = b.fire || this.fire ? 3 : 2;
    this.addScore(b.owner, pts);
    if (s) {
      s.made++;
      s.av.play('cheer', true);
      this.time.delayedCall(700, () => s.cd <= 0 && s.av.play('idle'));
    }
    this.netT = 0.5;
    const col = PLAYER_COLORS[b.owner];
    Vfx.popText(this, this.hx, this.hy - (this.angleFor(b.owner) === 180 ? -34 : 34), pts === 3 ? '+3 ไฟลุก!' : b.rimHits ? '+2' : '+2 สวิช!', pts === 3 ? '#ffb040' : toCss(col.light), pts === 3 ? 22 : 19, this.angleFor(b.owner));
    burst(this, this.hx, this.hy, { tex: 'confetti', count: 18, tint: [col.main, col.light, 0xffffff], speed: [80, 220], life: 700, rotate: true, scale: [S, S] });
    Vfx.sparkle(this, this.hx, this.hy);
    Audio.sfx('coin', 1 + b.owner * 0.1);
    if (pts === 3) { Audio.sfx('power', 1.1); Vfx.explosion(this, this.hx, this.hy, 0.35); }
    else Audio.sfx('splash', 2);
  }

  private bot(s: Shooter, dt: number): void {
    s.cpuT -= dt;
    if (s.cpuT > 0 || s.cd > 0) return;
    s.cpuT = 0.85 + Math.random() * 0.9;
    const h = this.handPos(s);
    // lead the moving hoop by the flight time
    let tx = this.hx, ty = this.hy;
    for (let i = 0; i < 3; i++) {
      const range = Math.hypot(tx - h.x, ty - h.y);
      const T = 0.42 + range / 1300;
      tx = this.hx + this.hvx * T * 0.9;
      ty = this.hy + this.hvy * T * 0.9;
    }
    const range = Math.hypot(tx - h.x, ty - h.y) + (Math.random() - 0.5) * 34 * s.cpuErr;
    const ang = Math.atan2(ty - h.y, tx - h.x) + (Math.random() - 0.5) * 0.11 * s.cpuErr;
    this.shoot(s, ang, range);
  }

  ambient(dt: number): void {
    const now = this.time.now / 1000;
    this.placeHoop();
    this.props.forEach((pr, i) => pr.setFrame((Math.floor(now * 20) + i) & 1));
    if (this.netT > 0) { this.netT -= dt; this.net.setFrame(Math.floor(now * 16) & 1); } else this.net.setFrame(0);
    if (this.fire) {
      this.fireFx -= dt;
      if (this.fireFx <= 0) {
        this.fireFx = 0.04;
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          burst(this, this.hx + Math.cos(a) * RR, this.hy + Math.sin(a) * RR, { tex: 'mb-flame', count: 2, tint: [0xffd23a, 0xff7a2a, 0xff3b1a], speed: [20, 60], angle: [(a * 180) / Math.PI - 30, (a * 180) / Math.PI + 30], life: 420, scale: [S * 1.4, 0], depth: 602 });
        }
      }
    }
    // gym-light sheen drifting over the floor, dust in the air
    this.sheen.x = ((now * 22) % (this.vw + 500)) - 250;
    for (const m of this.motes) {
      m.y -= dt * 4;
      m.x += Math.sin(now + (m.getData('ph') as number)) * dt * 6;
      if (m.y < 0) m.y = this.vh;
    }
    for (const s of this.shooters) {
      if (s.cd <= 0) this.placeHand(s);
      // aim preview while dragging
      const t = s.touchId >= 0 ? this.touch.touchesFor(s.p).find((x) => x.pointerId === s.touchId) : undefined;
      if (!t || this.state !== 'play' || s.cd > 0) { for (const d of s.aim) d.setVisible(false); continue; }
      const dx = t.x - t.startX, dy = t.y - t.startY;
      const len = Math.hypot(dx, dy);
      if (len < 10) { for (const d of s.aim) d.setVisible(false); continue; }
      const h = this.handPos(s);
      const show = Phaser.Math.Clamp(this.rangeFor(len) * 0.45, 20, 240);
      s.aim.forEach((d, i) => {
        const k = (i + 1) / AIM_DOTS;
        d.setVisible(true).setPosition(h.x + (dx / len) * show * k, h.y + (dy / len) * show * k).setAlpha(1 - k * 0.6);
      });
    }
  }
}

import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture } from '../../art/Painter';
import { PLAYER_COLORS } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const M = 18;
const GOAL_H = 150;
const BALL_R = 13;

/** #11 — 2v2 bumper-car soccer. Left team P1+P3, right team P2+P4. */
export default class BumperBall extends BaseMinigame {
  private kit!: ArenaKit;
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private bx = 0;
  private by = 0;
  private bvx = 0;
  private bvy = 0;
  private spin = 0;
  private goals = [0, 0];
  private resetT = 0;
  private cars: Phaser.GameObjects.Image[] = [];
  private field!: Phaser.Geom.Rectangle;
  private scoreTexts: Phaser.GameObjects.Text[] = [];

  constructor() {
    super(CATALOG['bumper-ball']);
  }

  private team(p: PlayerIndex): number {
    return p % 2 === 0 ? 0 : 1;
  }

  setup(): void {
    this.goals = [0, 0];
    this.resetT = 0;
    this.field = new Phaser.Geom.Rectangle(M, M, this.vw - M * 2, this.vh - M * 2);
    this.paintField();
    this.kit = new ArenaKit(this, {
      speed: 165, accel: 520, grip: 0.8, radius: 17, dashSpeed: 400, dashCooldown: 1.2, bounce: 0.9,
      bounds: this.field, spawn: (p) => this.spawnPos(p), avatar: { ring: false },
    });
    this.kit.dashHit = 1.2;
    this.cars = this.kit.bodies.map((b) => this.add.image(b.x, b.y, this.carKey(b.p)).setScale(S));
    makeTexture(this, 'soccer-ball', 14, 14, (p) => {
      p.ball(7, 7, 6.5, 6.5, 0xf4f4f4);
      p.rect(5, 5, 4, 4, 0x2b2b3a); p.px(4, 7, 0x2b2b3a); p.px(9, 7, 0x2b2b3a);
      p.px(2, 3, 0x2b2b3a); p.px(11, 3, 0x2b2b3a); p.px(3, 11, 0x2b2b3a); p.px(10, 11, 0x2b2b3a);
      p.outline(-0.7);
    });
    this.ballShadow = this.add.image(0, 0, 'shadow').setScale(S * 0.7).setAlpha(0.3);
    this.ball = this.add.image(0, 0, 'soccer-ball').setScale(S);
    this.resetBall();
    // Big team scores on each side (readable from both seats)
    this.scoreTexts = [];
    for (const deg of [0, 180]) {
      const y = deg === 0 ? this.vh - 44 : 44;
      this.scoreTexts.push(txt(this, this.vw / 2, y, '0 : 0', { size: 26, color: '#ffffff', strokeWidth: 6 }).setAngle(deg).setDepth(940));
    }
    this.updateScore();
  }

  private spawnPos(p: PlayerIndex): { x: number; y: number } {
    const left = this.team(p) === 0;
    const top = p < 2;
    return { x: left ? this.vw * 0.3 : this.vw * 0.7, y: top ? this.vh * 0.32 : this.vh * 0.68 };
  }

  private carKey(p: PlayerIndex): string {
    const c = PLAYER_COLORS[p];
    return makeTexture(this, `bumper-${p}`, 26, 16, (g) => {
      g.ellipse(13, 9, 13, 7, shift(c.main, -0.5));
      g.ellipse(13, 8, 12.5, 6.5, c.main);
      g.ellipse(13, 6, 10, 3.5, c.light);
      g.ellipse(13, 7, 7, 3, shift(c.main, -0.3));
      g.hline(3, 12, 20, 0x2b2b3a);
      g.outline(-0.7);
    });
  }

  private paintField(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const key = makeTexture(this, `pitch-${aw}`, aw, ah, (p) => {
      for (let x = 0; x < aw; x += 16) p.rect(x, 0, 16, ah, (x / 16) % 2 ? 0x5fbf5a : 0x55b350);
      // dither noise
      for (let i = 0; i < aw * ah * 0.04; i++) p.px(Math.floor(Math.random() * aw), Math.floor(Math.random() * ah), 0x6ccc66);
      const m = M / S, W = aw - m * 2, H = ah - m * 2;
      const line = 0xf4fff0;
      p.rect(0, 0, aw, m, 0x3e7a3a); p.rect(0, ah - m, aw, m, 0x3e7a3a);
      p.rect(0, 0, m, ah, 0x3e7a3a); p.rect(aw - m, 0, m, ah, 0x3e7a3a);
      p.rect(m, m, W, 1, line); p.rect(m, ah - m - 1, W, 1, line);
      p.rect(m, m, 1, H, line); p.rect(aw - m - 1, m, 1, H, line);
      p.rect(Math.floor(aw / 2), m, 1, H, line);
      p.ring(aw / 2, ah / 2, 30, line);
      p.circle(aw / 2, ah / 2, 2, line);
      const gh = GOAL_H / S;
      // penalty boxes
      p.rect(m, ah / 2 - gh * 0.8, 30, 1, line); p.rect(m, ah / 2 + gh * 0.8, 30, 1, line); p.rect(m + 30, ah / 2 - gh * 0.8, 1, gh * 1.6, line);
      p.rect(aw - m - 30, ah / 2 - gh * 0.8, 30, 1, line); p.rect(aw - m - 30, ah / 2 + gh * 0.8, 30, 1, line); p.rect(aw - m - 31, ah / 2 - gh * 0.8, 1, gh * 1.6, line);
      // goals (nets) in team colours
      for (const [x0, col] of [[0, 0xff5a6e], [aw - m, 0x3d9bff]] as const) {
        p.rect(x0, ah / 2 - gh / 2, m, gh, 0xe8eef8);
        for (let y = 0; y < gh; y += 3) p.hline(x0, ah / 2 - gh / 2 + y, m, 0xb8c2d6);
        for (let x = 0; x < m; x += 3) p.vline(x0 + x, ah / 2 - gh / 2, gh, 0xb8c2d6);
        p.rect(x0, ah / 2 - gh / 2 - 2, m, 2, col); p.rect(x0, ah / 2 + gh / 2, m, 2, col);
      }
      // crowd boards
      for (let x = m; x < aw - m; x += 24) { p.rect(x, 2, 20, m - 4, x % 48 ? 0xffe066 : 0xff7a85); p.rect(x, ah - m + 2, 20, m - 4, x % 48 ? 0x6ec6ff : 0xb8a6ff); }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
  }

  private resetBall(): void {
    this.bx = this.vw / 2;
    this.by = this.vh / 2;
    this.bvx = this.bvy = 0;
  }

  private resetPlayers(): void {
    for (const b of this.kit.bodies) {
      const s = this.spawnPos(b.p);
      b.x = s.x; b.y = s.y; b.vx = b.vy = 0; b.stun = 0;
    }
  }

  private updateScore(): void {
    for (const t of this.scoreTexts) t.setText(`${this.goals[0]} : ${this.goals[1]}`);
    for (const p of this.players) this.hudText[p] = `${this.goals[this.team(p)]}`;
  }

  ambient(dt: number): void {
    const playing = this.state === 'play' && this.resetT <= 0;
    this.kit.update(dt, playing);
    this.kit.bodies.forEach((b, i) => {
      this.cars[i].setPosition(b.x, b.y - 4).setDepth(b.y - 1).setFlipX(b.avatar.facing < 0);
      b.avatar.sprite.setY(b.y - 6);
    });
    this.ball.setPosition(this.bx, this.by - 6).setDepth(this.by).setAngle(this.spin);
    this.ballShadow.setPosition(this.bx, this.by + 6).setDepth(this.by - 2);
  }

  tick(dt: number): void {
    if (this.resetT > 0) {
      this.resetT -= dt;
      if (this.resetT <= 0) { this.resetBall(); this.resetPlayers(); Audio.sfx('go'); }
      return;
    }
    // ball physics
    const drag = Math.pow(0.55, dt);
    this.bvx *= drag; this.bvy *= drag;
    this.bx += this.bvx * dt; this.by += this.bvy * dt;
    this.spin += (this.bvx * dt) * 4;
    const f = this.field;
    const inGoalMouth = Math.abs(this.by - this.vh / 2) < GOAL_H / 2 - BALL_R * 0.5;
    if (this.bx < f.x + BALL_R) {
      if (inGoalMouth) return this.goal(1);
      this.bx = f.x + BALL_R; this.bvx = Math.abs(this.bvx) * 0.85; Audio.sfx('bounce');
    }
    if (this.bx > f.right - BALL_R) {
      if (inGoalMouth) return this.goal(0);
      this.bx = f.right - BALL_R; this.bvx = -Math.abs(this.bvx) * 0.85; Audio.sfx('bounce');
    }
    if (this.by < f.y + BALL_R) { this.by = f.y + BALL_R; this.bvy = Math.abs(this.bvy) * 0.85; }
    if (this.by > f.bottom - BALL_R) { this.by = f.bottom - BALL_R; this.bvy = -Math.abs(this.bvy) * 0.85; }
    // Rounded corners: nudge a trapped ball back toward the middle.
    const nearX = Math.min(this.bx - f.x, f.right - this.bx), nearY = Math.min(this.by - f.y, f.bottom - this.by);
    if (nearX < 50 && nearY < 50) {
      this.bvx += Math.sign(this.vw / 2 - this.bx) * 500 * dt;
      this.bvy += Math.sign(this.vh / 2 - this.by) * 500 * dt;
    }
    // ball vs cars
    for (const b of this.kit.alive) {
      const dx = this.bx - b.x, dy = this.by - b.y;
      const d = Math.hypot(dx, dy), min = BALL_R + b.r;
      if (d >= min || d === 0) continue;
      const nx = dx / d, ny = dy / d;
      this.bx = b.x + nx * min; this.by = b.y + ny * min;
      const rel = (b.vx - this.bvx) * nx + (b.vy - this.bvy) * ny;
      const kick = Math.max(0, rel) * (b.dashT > 0 ? 1.9 : 1.25) + 40;
      this.bvx += nx * kick; this.bvy += ny * kick;
      b.vx -= nx * kick * 0.15; b.vy -= ny * kick * 0.15;
      if (kick > 220) { Audio.sfx('hit', 1.2); Vfx.hit(this, this.bx, this.by - 6, [0xffffff, 0xffe066]); }
      else Audio.sfx('bounce', 1.3);
      b.data.touch = this.elapsed;
      this.lastTouch = b.p;
    }
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b);
  }

  private lastTouch: PlayerIndex | undefined;

  private goal(team: number): void {
    this.goals[team]++;
    this.resetT = 1.8;
    Audio.sfx('explode');
    Audio.sfx('power');
    Vfx.flash(this, team === 0 ? 0xff5a6e : 0x3d9bff, 160);
    Vfx.confetti(this, team === 0 ? this.vw - 30 : 30, this.vh / 2, 70);
    Vfx.shake(this, 0.01, 300);
    if (this.lastTouch !== undefined && this.team(this.lastTouch) === team) this.score[this.lastTouch] += 1;
    for (const b of this.kit.bodies) b.avatar.play(this.team(b.p) === team ? 'cheer' : 'lose', true);
    for (const [deg, y] of [[0, this.vh * 0.62], [180, this.vh * 0.38]] as const) {
      const t = txt(this, this.vw / 2, y, 'GOAL!!', { size: 54, color: team === 0 ? '#ff7a85' : '#6ec6ff', strokeWidth: 8 }).setAngle(deg).setDepth(3000);
      this.tweens.add({ targets: t, scale: { from: 0.3, to: 1.1 }, duration: 300, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 1100, duration: 300, onComplete: () => t.destroy() });
    }
    this.bvx = this.bvy = 0;
    this.bx = -999;
    this.updateScore();
  }

  private bot(b: ArenaBody): void {
    const team = this.team(b.p);
    const targetGoalX = team === 0 ? this.field.right : this.field.x;
    const ownGoalX = team === 0 ? this.field.x : this.field.right;
    const gx = targetGoalX, gy = this.vh / 2;
    // stand behind the ball relative to the target goal
    const ax = this.bx - gx, ay = this.by - gy;
    const al = Math.hypot(ax, ay) || 1;
    const behind = { x: this.bx + (ax / al) * 34, y: this.by + (ay / al) * 34 };
    const mate = this.kit.bodies.find((o) => o !== b && this.team(o.p) === team);
    const iAmCloser = !mate || Math.hypot(this.bx - b.x, this.by - b.y) <= Math.hypot(this.bx - mate.x, this.by - mate.y) + 10;
    if (!iAmCloser) {
      // support: hang back between ball and own goal
      b.botTarget = { x: (this.bx + ownGoalX) / 2, y: (this.by + this.vh / 2) / 2 };
      return;
    }
    const dBehind = Math.hypot(behind.x - b.x, behind.y - b.y);
    const f = this.field;
    behind.x = Phaser.Math.Clamp(behind.x, f.x + 20, f.right - 20);
    behind.y = Phaser.Math.Clamp(behind.y, f.y + 20, f.bottom - 20);
    b.botTarget = dBehind < 22 ? { x: this.bx, y: this.by } : behind;
    if (dBehind < 30 && Math.hypot(this.bx - b.x, this.by - b.y) < 60 && b.dashCd <= 0 && Math.random() < 0.04) b.botDash = true;
  }

  results(): PlayerResult[] {
    const [a, b] = this.goals;
    return this.players.map((p) => {
      const t = this.team(p);
      const rank = a === b ? 2 : (t === 0 ? a > b : b > a) ? 1 : 3;
      return { player: p, rank, score: this.goals[t], team: t };
    });
  }
}

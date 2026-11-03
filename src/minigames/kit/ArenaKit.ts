import Phaser from 'phaser';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Avatar, type AvatarOpts } from '../../systems/players/Avatar';
import { Vfx } from '../../systems/vfx/Vfx';
import { DragStick, TouchButton } from '../../ui/Controls';
import type { BaseMinigame } from '../BaseMinigame';

export interface ArenaOpts {
  speed?: number;
  accel?: number;
  /** Traction 0..1 (ice ≈ 0.08): scales how fast velocity follows input. */
  grip?: number;
  radius?: number;
  dash?: boolean;
  dashSpeed?: number;
  dashCooldown?: number;
  /** Second button (optional), e.g. 'throw', 'shield'. */
  action?: string;
  collide?: boolean;
  bounce?: number;
  bounds?: Phaser.Geom.Rectangle;
  avatar?: AvatarOpts;
  /** Where each player spawns (defaults to their screen corner). */
  spawn?: (p: PlayerIndex) => { x: number; y: number };
}

export interface ArenaBody {
  p: PlayerIndex;
  avatar: Avatar;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dashT: number;
  dashCd: number;
  stun: number;
  invuln: number;
  alive: boolean;
  /** Input direction this frame (-1..1). */
  ix: number;
  iy: number;
  speedMul: number;
  /** Set by the game: CPU target and wishes. */
  botTarget?: { x: number; y: number };
  botDash: boolean;
  botAction: boolean;
  stick?: DragStick;
  dashBtn?: TouchButton;
  actBtn?: TouchButton;
  /** Last frame this body was hit by someone (for kill credit). */
  lastHitBy?: PlayerIndex;
  data: Record<string, number>;
}

/**
 * Top-down arena movement shared by many games: drag-stick movement, dash,
 * body collisions with knockback, CPU steering, character animation.
 */
export class ArenaKit {
  readonly bodies: ArenaBody[] = [];
  readonly o: Required<Omit<ArenaOpts, 'bounds' | 'avatar' | 'spawn' | 'action'>> & ArenaOpts;
  onDash?: (b: ArenaBody) => void;
  onAction?: (b: ArenaBody, down: boolean) => void;
  onBump?: (a: ArenaBody, b: ArenaBody, power: number) => void;
  /** Dash only works when this returns true (e.g. not while holding something). */
  canDash: (b: ArenaBody) => boolean = () => true;
  /** Impulse multiplier when a dashing body hits another. */
  dashHit = 1.15;

  constructor(private readonly g: BaseMinigame, opts: ArenaOpts = {}) {
    this.o = {
      speed: 150, accel: 900, grip: 1, radius: 12, dash: true, dashSpeed: 420, dashCooldown: 0.9,
      collide: true, bounce: 0.9, ...opts,
    };
    const W = g.vw, H = g.vh;
    for (const p of g.players) {
      const s = opts.spawn?.(p) ?? { x: (p % 2 === 0 ? 0.28 : 0.72) * W, y: (p < 2 ? 0.3 : 0.7) * H };
      const avatar = new Avatar(g, p, s.x, s.y, { ring: true, ...opts.avatar });
      avatar.markerAngle = g.angleFor(p);
      const b: ArenaBody = {
        p, avatar, x: s.x, y: s.y, vx: 0, vy: 0, r: this.o.radius, dashT: 0, dashCd: 0, stun: 0, invuln: 0,
        alive: true, ix: 0, iy: 0, speedMul: 1, botDash: false, botAction: false, data: {},
      };
      avatar.face(s.x < W / 2 ? 1 : -1);
      if (!g.isCpu(p)) {
        b.stick = new DragStick(g, g.touch, p);
        const btns: TouchButton[] = [];
        if (this.o.dash) {
          b.dashBtn = new TouchButton(g, g.touch, p, 0.82, 0.74, 'dash');
          b.dashBtn.onPress = () => this.tryDash(b);
          btns.push(b.dashBtn);
        }
        if (opts.action) {
          b.actBtn = new TouchButton(g, g.touch, p, this.o.dash ? 0.6 : 0.82, this.o.dash ? 0.84 : 0.74, opts.action);
          b.actBtn.onPress = () => this.onAction?.(b, true);
          b.actBtn.onRelease = () => this.onAction?.(b, false);
          btns.push(b.actBtn);
        }
        b.stick.exclude = btns;
      }
      this.bodies.push(b);
    }
  }

  body(p: PlayerIndex): ArenaBody | undefined {
    return this.bodies.find((b) => b.p === p);
  }

  get alive(): ArenaBody[] {
    return this.bodies.filter((b) => b.alive);
  }

  tryDash(b: ArenaBody): void {
    if (!b.alive || b.dashCd > 0 || b.stun > 0 || this.g.state !== 'play' || !this.canDash(b)) return;
    let dx = b.ix, dy = b.iy;
    if (Math.hypot(dx, dy) < 0.2) { dx = b.avatar.facing; dy = 0; }
    const l = Math.hypot(dx, dy) || 1;
    b.vx = (dx / l) * this.o.dashSpeed;
    b.vy = (dy / l) * this.o.dashSpeed;
    b.dashT = 0.22;
    b.dashCd = this.o.dashCooldown;
    Audio.sfx('dash', 1 + b.p * 0.1);
    Vfx.speedLines(this.g, b.x, b.y - 16, (Math.atan2(dy, dx) * 180) / Math.PI);
    Vfx.squash(this.g, b.avatar.sprite, 1.3, 0.75, 160);
    this.onDash?.(b);
  }

  /** Knock a body away from a point. */
  knock(b: ArenaBody, fromX: number, fromY: number, power: number, stun = 0.25): void {
    const dx = b.x - fromX, dy = b.y - fromY;
    const l = Math.hypot(dx, dy) || 1;
    b.vx += (dx / l) * power;
    b.vy += (dy / l) * power;
    b.stun = Math.max(b.stun, stun);
  }

  update(dt: number, playing: boolean): void {
    const W = this.g.vw, H = this.g.vh;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      b.dashCd = Math.max(0, b.dashCd - dt);
      b.dashT = Math.max(0, b.dashT - dt);
      b.stun = Math.max(0, b.stun - dt);
      b.invuln = Math.max(0, b.invuln - dt);
      // input
      if (!playing) { b.ix = b.iy = 0; }
      else if (b.stick) { b.ix = b.stick.vx; b.iy = b.stick.vy; }
      else if (b.botTarget) {
        const dx = b.botTarget.x - b.x, dy = b.botTarget.y - b.y;
        const d = Math.hypot(dx, dy);
        const k = d < 6 ? 0 : Math.min(1, d / 40);
        b.ix = d ? (dx / d) * k : 0;
        b.iy = d ? (dy / d) * k : 0;
        if (b.botDash) { b.botDash = false; this.tryDash(b); }
      } else { b.ix = b.iy = 0; }
      if (b.stun > 0) { b.ix *= 0.15; b.iy *= 0.15; }
      // accelerate toward desired velocity (knockback decays the same way)
      if (b.dashT <= 0) {
        const max = this.o.speed * b.speedMul;
        const tx = b.ix * max, ty = b.iy * max;
        const hasInput = Math.hypot(b.ix, b.iy) > 0.05;
        const a = this.o.accel * this.o.grip * (hasInput ? 1 : 0.7) * dt;
        const dvx = tx - b.vx, dvy = ty - b.vy;
        const dl = Math.hypot(dvx, dvy);
        if (dl > 0) {
          const step = Math.min(dl, a);
          b.vx += (dvx / dl) * step;
          b.vy += (dvy / dl) * step;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (this.o.bounds) {
        const r = this.o.bounds;
        if (b.x < r.x + b.r) { b.x = r.x + b.r; b.vx = Math.abs(b.vx) * this.o.bounce; }
        if (b.x > r.right - b.r) { b.x = r.right - b.r; b.vx = -Math.abs(b.vx) * this.o.bounce; }
        if (b.y < r.y + b.r) { b.y = r.y + b.r; b.vy = Math.abs(b.vy) * this.o.bounce; }
        if (b.y > r.bottom - b.r) { b.y = r.bottom - b.r; b.vy = -Math.abs(b.vy) * this.o.bounce; }
      } else {
        b.x = Phaser.Math.Clamp(b.x, -200, W + 200);
        b.y = Phaser.Math.Clamp(b.y, -200, H + 200);
      }
    }
    if (this.o.collide) this.collide();
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const sp = Math.hypot(b.vx, b.vy);
      const av = b.avatar;
      if (Math.abs(b.vx) > 8) av.face(b.vx);
      if (b.stun > 0.05) av.play('stun');
      else if (b.dashT > 0) av.play('attack');
      else if (sp > 25) av.play('run');
      else av.play('idle');
      av.sprite.anims.timeScale = sp > 25 ? Math.min(1.6, 0.6 + sp / this.o.speed) : 1;
      av.setPos(b.x, b.y);
      av.setAlpha(b.invuln > 0 && Math.floor(b.invuln * 20) % 2 === 0 ? 0.4 : 1);
    }
  }

  private collide(): void {
    const list = this.alive;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.r + b.r;
        if (d >= min || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        const overlap = min - d;
        a.x -= nx * overlap / 2; a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2; b.y += ny * overlap / 2;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0) continue;
        // Dashing bodies hit much harder.
        const aPow = a.dashT > 0 ? this.dashHit : 1, bPow = b.dashT > 0 ? this.dashHit : 1;
        const imp = rel * (1 + this.o.bounce) / 2;
        b.vx += nx * imp * aPow; b.vy += ny * imp * aPow;
        a.vx -= nx * imp * bPow; a.vy -= ny * imp * bPow;
        if (a.dashT > 0) { b.stun = 0.35; b.lastHitBy = a.p; }
        if (b.dashT > 0) { a.stun = 0.35; a.lastHitBy = b.p; }
        const power = rel * Math.max(aPow, bPow);
        if (power > 120) {
          Vfx.hit(this.g, (a.x + b.x) / 2, (a.y + b.y) / 2 - 14);
          Audio.sfx(power > 300 ? 'bigHit' : 'hit');
          if (power > 300) { Vfx.shake(this.g, 0.006, 140); this.g.hitStop(55); }
          Vfx.hitFlash(this.g, a.dashT > 0 ? b.avatar.sprite : a.avatar.sprite);
        } else if (power > 40) Audio.sfx('bounce');
        this.onBump?.(a, b, power);
      }
    }
  }

  /** Simple CPU: chase a target, dash when close and lined up. */
  botChase(b: ArenaBody, target: { x: number; y: number }, dashRange = 90, skill = 0.6): void {
    b.botTarget = target;
    const d = Math.hypot(target.x - b.x, target.y - b.y);
    if (d < dashRange && b.dashCd <= 0 && Math.random() < skill * 0.08) b.botDash = true;
  }

  kill(b: ArenaBody): void {
    b.alive = false;
    b.vx = b.vy = 0;
  }

  destroy(): void {
    for (const b of this.bodies) b.avatar.destroy();
  }
}

import Phaser from 'phaser';
import { S } from '../../art/common';
import { makeTexture, rng, type Painter } from '../../art/Painter';
import { shift } from '../../art/color';

const shiftc = (c: number) => shift(c, -0.15);

/** Snow sphere: white with cool shading toward the bottom-right (light from top-left). */
function snowBall(p: Painter, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const l = -nx * 0.55 - ny * 0.65 + Math.sqrt(1 - d) * 0.6;
      p.px(x, y, l > 0.62 ? 0xffffff : l > 0.25 ? 0xeef4fc : l > 0.02 ? 0xd5e2f3 : 0xb4c8e4);
    }
  }
}
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const M = 18;
const TIER_T = [0, 0.45, 0.95];
const TIER = [
  { speed: 280, range: 190, r: 9, stun: 0.7, knock: 90, tex: 'snowball-b0' },
  { speed: 360, range: 290, r: 12, stun: 0.95, knock: 170, tex: 'snowball-b1' },
  { speed: 450, range: 420, r: 16, stun: 1.25, knock: 280, tex: 'snowball-b2' },
];
const FORT_HP = 4;
const REBUILD = 9;

interface Fort {
  x: number; y: number; w: number; h: number; // footprint rect (centre)
  hp: number; img: Phaser.GameObjects.Image; key: string; down: number; solid: boolean;
}

interface Ball {
  owner: PlayerIndex; tier: number;
  x: number; y: number; vx: number; vy: number; z: number; dist: number; range: number;
  img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; alive: boolean;
}

interface Thrower {
  b: ArenaBody;
  ax: number; ay: number;
  packing: boolean; pack: number; tier: number; cd: number;
  hand: Phaser.GameObjects.Image;
  splat: Phaser.GameObjects.Image;
  dots: Phaser.GameObjects.Image[];
  stepT: number;
  // CPU
  target?: PlayerIndex; retarget: number; want: number; strafe: number; strafeT: number; skill: number; dodgeCd: number;
}

/** #47 — Hold to pack a snowball, release to throw. Forts block and crumble. */
export default class SnowballShowdown extends BaseMinigame {
  private kit!: ArenaKit;
  private th: Thrower[] = [];
  private forts: Fort[] = [];
  private balls: Ball[] = [];
  private steps: Phaser.GameObjects.Image[] = [];
  private stepI = 0;
  private field!: Phaser.Geom.Rectangle;
  private snowman = { x: 0, y: 0, r: 17 };

  constructor() {
    super(CATALOG['snowball-showdown']);
  }

  setup(): void {
    this.th = [];
    this.forts = [];
    this.balls = [];
    this.steps = [];
    this.stepI = 0;
    this.field = new Phaser.Geom.Rectangle(M, M, this.vw - M * 2, this.vh - M * 2);
    this.paintArt();
    this.buildYard();
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 900, grip: 0.55, radius: 12, dashSpeed: 380, dashCooldown: 1.3, action: 'throw', bounds: this.field, bounce: 0.4,
      spawn: (p) => ({ x: (p % 2 === 0 ? 0.14 : 0.86) * this.vw, y: (p < 2 ? 0.2 : 0.8) * this.vh }),
    });
    this.kit.dashHit = 0.7;
    this.kit.onAction = (b, down) => {
      const t = this.thrower(b.p);
      if (!t) return;
      if (down) this.startPack(t);
      else this.release(t);
    };
    for (const b of this.kit.bodies) {
      const dx = this.vw / 2 - b.x, dy = this.vh / 2 - b.y, l = Math.hypot(dx, dy);
      const hand = this.add.image(b.x, b.y, 'snowball-b0').setScale(S).setVisible(false);
      const splat = this.add.image(b.x, b.y, 'snowball-facesplat').setScale(S).setVisible(false);
      const dots = [0, 1, 2, 3, 4].map((i) => this.add.image(0, 0, i === 4 ? 'snowball-aimend' : 'snowball-aimdot').setScale(S).setTint(PLAYER_COLORS[b.p].light).setVisible(false).setDepth(-40));
      this.th.push({
        b, ax: dx / l, ay: dy / l, packing: false, pack: 0, tier: 0, cd: 0, hand, splat, dots, stepT: 0,
        retarget: 0, want: 1, strafe: 1, strafeT: 0, skill: 0.55 + Math.random() * 0.4, dodgeCd: 0,
      });
    }
  }

  private thrower(p: PlayerIndex): Thrower | undefined {
    return this.th.find((t) => t.b.p === p);
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    makeTexture(this, `snowball-yard-${aw}x${ah}`, aw, ah, (p) => {
      const r = rng(47);
      p.rect(0, 0, aw, ah, 0xeef6ff);
      // soft drifts
      for (let i = 0; i < 40; i++) p.ellipse(r() * aw, r() * ah, 10 + r() * 24, 4 + r() * 8, i % 3 ? 0xe2eefb : 0xf7fbff);
      for (let i = 0; i < aw * ah * 0.03; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), r() < 0.5 ? 0xd8e6f6 : 0xffffff);
      // old court lines peeking through the snow
      const m = M / S;
      const cx = aw / 2, cy = ah / 2;
      const line = (x: number, y: number) => { if (r() < 0.55) p.px(x, y, 0xf2c94c); };
      for (let a = 0; a < Math.PI * 2; a += 0.012) line(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46);
      for (let y = m + 8; y < ah - m - 8; y++) line(cx, y);
      for (let x = m + 14; x < aw - m - 14; x++) { line(x, m + 10); line(x, ah - m - 11); }
      // hopscotch
      for (let k = 0; k < 4; k++) for (let i = 0; i < 9; i++) { if (r() < 0.6) p.px(30 + k * 9 + i, ah - m - 26, 0x8fb8f0); if (r() < 0.6) p.px(aw - 66 + k * 9 + i, m + 25, 0x8fb8f0); }
      // fence border with snow cap
      for (let x = 0; x < aw; x++) {
        for (let y = 0; y < m; y++) { p.px(x, y, y < m - 3 ? 0x8a6a4a : 0x6a4a32); p.px(x, ah - 1 - y, y < m - 3 ? 0x8a6a4a : 0x6a4a32); }
        if (x % 6 < 2) { p.vline(x, 0, m - 1, 0xa8805a); p.vline(x, ah - m + 1, m - 1, 0xa8805a); }
        p.hline(x, 1, 1, 0xffffff); p.px(x, 2 + ((x * 7) % 3 === 0 ? 1 : 0), 0xffffff);
        p.px(x, ah - m + 1, 0xffffff); p.px(x, ah - m + 2 + ((x * 5) % 3 === 0 ? 1 : 0), 0xffffff);
      }
      for (let y = 0; y < ah; y++) {
        for (let x = 0; x < m; x++) { p.px(x, y, x < m - 3 ? 0x8a6a4a : 0x6a4a32); p.px(aw - 1 - x, y, x < m - 3 ? 0x8a6a4a : 0x6a4a32); }
        if (y % 6 < 2) { p.hline(0, y, m - 1, 0xa8805a); p.hline(aw - m + 1, y, m - 1, 0xa8805a); }
        p.px(1, y, 0xffffff); p.px(aw - 2, y, 0xffffff);
      }
      // inner shadow under the fence
      for (let x = m; x < aw - m; x++) { p.px(x, m, 0xc9d8ee); p.px(x, m + 1, 0xdbe6f5); }
      for (let y = m; y < ah - m; y++) { p.px(m, y, 0xc9d8ee); p.px(aw - m - 1, y, 0xdbe6f5); }
    });
    makeTexture(this, 'snowball-pine', 22, 30, (p) => {
      p.rect(9, 24, 4, 6, 0x6a4a32);
      for (let k = 0; k < 3; k++) {
        const y = 2 + k * 7, hw = 4 + k * 3;
        p.tri(11 - hw - 1, y + 10, 11 + hw + 1, y + 10, 11, y, 0x2f7a4a);
        p.tri(11 - hw, y + 9, 11, y + 9, 11, y + 1, 0x3f9a5a);
        p.hline(11 - hw, y + 9, hw * 2 + 1, 0xffffff);
        p.hline(11 - hw + 2, y + 8, hw, 0xeef6ff);
      }
      p.px(11, 1, 0xffffff); p.px(10, 2, 0xffffff);
      p.outline(-0.6);
    });
    makeTexture(this, 'snowball-bench', 26, 12, (p) => {
      p.rect(2, 6, 2, 6, 0x56618a); p.rect(22, 6, 2, 6, 0x56618a);
      p.box(0, 2, 26, 5, 0xc98a4b);
      p.hline(0, 4, 26, 0x9a6232);
      p.rect(1, 0, 24, 3, 0xffffff); p.hline(1, 2, 24, 0xdbe6f5);
      p.outline(-0.6);
    });
    makeTexture(this, 'snowball-snowman', 26, 36, (p) => {
      p.ellipse(13, 33, 11, 3, 0xc9d8ee);
      snowBall(p, 13, 26, 10, 8);
      snowBall(p, 13, 14, 7.5, 6.5);
      snowBall(p, 13, 5, 5.5, 5);
      p.rect(8, 9, 10, 2, 0xff5a6e); p.rect(14, 10, 3, 5, 0xd9405a);
      p.px(11, 4, 0x1b1f3b); p.px(15, 4, 0x1b1f3b);
      p.tri(13, 5, 13, 7, 18, 6, 0xff9f43);
      for (const y of [15, 19, 24]) p.px(13, y, 0x1b1f3b);
      p.line(5, 14, 0, 9, 0x6a4a32); p.line(21, 14, 25, 10, 0x6a4a32);
      p.rect(9, 0, 8, 1, 0x2b2f45);
      p.outline(-0.85);
    });
    for (const [i, d] of [[0, 5], [1, 7], [2, 10]] as const) {
      makeTexture(this, `snowball-b${i}`, d, d, (p) => { snowBall(p, d / 2, d / 2, d / 2 - 0.1, d / 2 - 0.1); p.outline(-0.9); });
    }
    makeTexture(this, 'snowball-aimdot', 3, 3, (p) => { p.rect(0, 1, 3, 1, 0xffffff); p.rect(1, 0, 1, 3, 0xffffff); });
    makeTexture(this, 'snowball-aimend', 7, 7, (p) => { p.ring(3.5, 3.5, 3.4, 0xffffff, 1); p.px(3, 3, 0xffffff); });
    makeTexture(this, 'snowball-splat', 16, 8, (p) => {
      const r = rng(7);
      p.ellipse(8, 4, 6, 3, 0xffffff);
      for (let i = 0; i < 7; i++) { const a = r() * Math.PI * 2; p.ellipse(8 + Math.cos(a) * 6, 4 + Math.sin(a) * 3, 1.4, 1, 0xf4f9ff); }
      p.ellipse(7, 3, 3, 1.4, 0xffffff);
      p.outline(-0.2);
    });
    makeTexture(this, 'snowball-facesplat', 14, 11, (p) => {
      p.ball(7, 5, 5, 4.5, 0xf7fbff);
      for (const [x, y] of [[1, 2], [12, 3], [2, 9], [11, 9], [7, 0]]) p.circle(x, y, 1.3, 0xf7fbff);
      p.vline(4, 9, 2, 0xf7fbff); p.vline(9, 9, 1, 0xf7fbff);
      p.outline(-0.35);
    });
    makeTexture(this, 'snowball-step', 3, 2, (p) => { p.rect(0, 0, 3, 2, 0xb9cce6); p.px(1, 0, 0xc9d8ee); });
    makeTexture(this, 'snowball-flake', 2, 2, (p) => { p.rect(0, 0, 2, 2, 0xffffff); });
  }

  private fortTexture(w: number, h: number, stage: number): string {
    const fw = Math.round(w / S), fd = Math.round(h / S), H = 8;
    return makeTexture(this, `snowball-fort-${fw}x${fd}-${stage}`, fw, fd + H, (p) => {
      if (stage <= 0) {
        // rubble
        const r = rng(fw * 7 + fd);
        for (let i = 0; i < (fw * fd) / 8; i++) p.ball(1 + r() * (fw - 2), H + 1 + r() * (fd - 2), 1.5 + r() * 1.5, 1 + r(), r() < 0.5 ? 0xf4f9ff : 0xdbe6f5, false);
        p.outline(-0.25);
        return;
      }
      const top = H - Math.round((H * (stage - 1)) / (FORT_HP - 1)) + (stage === FORT_HP ? 0 : 1);
      const fh = fd + H - top;
      const r = rng(fw * 13 + fd * 3 + stage);
      // top surface + front face of stacked snow bricks
      for (let y = top; y < fd + H; y++) for (let x = 0; x < fw; x++) {
        let c: number;
        if (y < top + fd) {
          c = (x * 7 + y * 3) % 11 === 0 ? 0xe8f0fa : 0xfbfdff;
          if (x === 0 || y === top) c = 0xffffff;
          if (x === fw - 1) c = 0xd8e4f4;
        } else {
          const fy = y - top - fd;
          const row = Math.floor(fy / 3);
          const bx = (x + (row % 2) * 3) % 6;
          c = fy % 3 === 2 || bx === 0 ? 0x9fb6d8 : fy % 3 === 0 ? 0xe2ecf8 : 0xc9d8ee;
          if (x === fw - 1) c = shiftc(c);
        }
        p.px(x, y, c);
      }
      // chips knocked out as it gets damaged
      for (let i = 0; i < (FORT_HP - stage) * 5; i++) {
        const x = Math.floor(r() * fw), y = top + Math.floor(r() * (fh - 2));
        p.px(x, y, 0x9fb6d8);
        p.px(x + 1, y, 0xb9cce6);
      }
      p.outline(-0.85);
    });
  }

  private buildYard(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    this.add.image(0, 0, `snowball-yard-${aw}x${ah}`).setOrigin(0).setScale(S).setDepth(-100);
    const W = this.vw, H = this.vh;
    // decorative trees & benches around the fence (outside the play field)
    for (const [x, y] of [[12, 30], [W - 12, 30], [12, H - 4], [W - 12, H - 4], [W * 0.35, 18], [W * 0.65, H - 2]] as const) {
      this.add.image(x, y, 'snowball-pine').setOrigin(0.5, 1).setScale(S).setDepth(y + 400);
    }
    this.add.image(W * 0.5, 30, 'snowball-bench').setScale(S).setDepth(-60);
    this.add.image(W * 0.5, H - 30, 'snowball-bench').setScale(S).setDepth(H);
    // snowman centrepiece (solid)
    this.snowman = { x: W / 2, y: H / 2, r: 17 };
    this.add.image(W / 2, H / 2 + 8, 'snowball-snowman').setOrigin(0.5, 1).setScale(S).setDepth(H / 2 + 8);
    this.add.image(W / 2, H / 2 + 6, 'shadow').setScale(S * 1.4).setAlpha(0.15).setDepth(-50);
    // forts (symmetric)
    const defs: [number, number, number, number][] = [
      [W * 0.5, H * 0.2, 84, 20], [W * 0.5, H * 0.8, 84, 20],
      [W * 0.3, H * 0.5, 20, 72], [W * 0.7, H * 0.5, 20, 72],
      [W * 0.2, H * 0.5, 44, 18], [W * 0.8, H * 0.5, 44, 18],
    ];
    for (const [x, y, w, h] of defs) {
      const key = this.fortTexture(w, h, FORT_HP);
      for (let s = 0; s < FORT_HP; s++) this.fortTexture(w, h, s);
      const img = this.add.image(x, y + h / 2, key).setOrigin(0.5, 1).setScale(S).setDepth(y + h / 2);
      this.add.image(x + 3, y + h / 2 + 2, 'px').setDisplaySize(w + 4, 6).setTint(0x9fb6d8).setAlpha(0.35).setDepth(-55);
      this.forts.push({ x, y, w, h, hp: FORT_HP, img, key: `${w}x${h}`, down: 0, solid: true });
    }
    // falling snow over everything (orientation-neutral drift)
    this.add.particles(0, 0, 'snowball-flake', {
      x: { min: -40, max: W + 40 }, y: { min: -20, max: H },
      speedX: { min: 8, max: 26 }, speedY: { min: 10, max: 30 }, lifespan: 4200, frequency: 45,
      alpha: { start: 0.95, end: 0 }, scale: { min: 0.8, max: 1.6 },
    }).setDepth(3000);
    // footprint pool
    for (let i = 0; i < 90; i++) this.steps.push(this.add.image(-50, -50, 'snowball-step').setScale(S).setDepth(-70).setAlpha(0));
  }

  private setFortStage(f: Fort): void {
    const [w, h] = f.key.split('x').map(Number);
    f.img.setTexture(this.fortTexture(w, h, Math.max(0, f.hp)));
  }

  // ───────────────────────────── throwing ─────────────────────────────

  private startPack(t: Thrower): void {
    if (this.state !== 'play' || t.packing || t.cd > 0 || t.b.stun > 0 || !t.b.alive) return;
    t.packing = true;
    t.pack = 0;
    t.tier = 0;
    t.hand.setTexture(TIER[0].tex).setVisible(true);
    Audio.sfx('pop', 0.8 + t.b.p * 0.08);
  }

  private release(t: Thrower): void {
    if (!t.packing) return;
    t.packing = false;
    t.hand.setVisible(false);
    for (const d of t.dots) d.setVisible(false);
    if (this.state !== 'play' || t.b.stun > 0) return;
    const tier = TIER[t.tier];
    const b = t.b;
    const img = this.add.image(b.x, b.y, tier.tex).setScale(S);
    const shadow = this.add.image(b.x, b.y, 'shadow').setScale(S * (0.25 + t.tier * 0.1)).setAlpha(0.25);
    this.balls.push({
      owner: b.p, tier: t.tier, x: b.x + t.ax * 14, y: b.y + t.ay * 8, vx: t.ax * tier.speed, vy: t.ay * tier.speed,
      z: 26, dist: 0, range: tier.range, img, shadow, alive: true,
    });
    t.cd = 0.3;
    b.data.throwT = 0.22;
    if (Math.abs(t.ax) > 0.15) b.avatar.face(t.ax);
    Vfx.squash(this, b.avatar.sprite, 1.25, 0.8, 140);
    Audio.sfx('throw', 1 + b.p * 0.1 - t.tier * 0.12);
    if (t.tier === 2) Vfx.speedLines(this, b.x, b.y - 20, (Math.atan2(t.ay, t.ax) * 180) / Math.PI + 180, 0xdff6ff);
  }

  private landBall(bl: Ball, hitFort = false): void {
    bl.alive = false;
    bl.img.destroy();
    bl.shadow.destroy();
    const big = bl.tier === 2;
    burst(this, bl.x, bl.y - (hitFort ? 10 : 2), {
      tex: 'dot3', count: 8 + bl.tier * 6, tint: [0xffffff, 0xe6f0ff, 0xc9d8ee], speed: [40, 120 + bl.tier * 40], life: 420, gravity: 260, depth: bl.y + 20,
    });
    if (!hitFort) {
      const sp = this.add.image(bl.x, bl.y, 'snowball-splat').setScale(S * (big ? 1.5 : 1)).setDepth(-65);
      this.tweens.add({ targets: sp, alpha: 0, delay: 2500, duration: 1500, onComplete: () => sp.destroy() });
    }
    Audio.sfx(big ? 'splash' : 'land', 1.2);
  }

  private hitPlayer(bl: Ball, b: ArenaBody): void {
    const tier = TIER[bl.tier];
    const t = this.thrower(b.p)!;
    b.stun = Math.max(b.stun, tier.stun);
    b.invuln = tier.stun + 0.6;
    this.kit.knock(b, bl.x - bl.vx * 0.05, bl.y - bl.vy * 0.05, tier.knock, tier.stun);
    if (t.packing) { t.packing = false; t.hand.setVisible(false); for (const d of t.dots) d.setVisible(false); }
    this.addScore(bl.owner, 1);
    const thr = this.kit.body(bl.owner);
    if (thr) Vfx.popText(this, thr.x, thr.y - 70, '+1', toCss(PLAYER_COLORS[bl.owner].light), 20, this.angleFor(bl.owner));
    Vfx.popText(this, b.x, b.y - 64, bl.tier === 2 ? 'โดนเต็มๆ!' : 'โดน!', '#ffffff', 16, this.angleFor(b.p));
    Vfx.hitFlash(this, b.avatar.sprite);
    burst(this, b.x, b.y - 30, { tex: 'dot3', count: 16 + bl.tier * 6, tint: [0xffffff, 0xe6f0ff, 0xbfe3ff], speed: [60, 200], life: 500, gravity: 300, depth: b.y + 30 });
    Audio.sfx('hit', 1.1 + b.p * 0.05);
    Audio.sfx('freeze', 1);
    if (bl.tier === 2) Vfx.shake(this, 0.006, 140);
    t.splat.setVisible(true).setScale(S * 0.4).setAlpha(1);
    this.tweens.add({ targets: t.splat, scale: S, duration: 140, ease: 'Back.easeOut' });
    t.b.data.splat = tier.stun + 0.4;
    bl.alive = false;
    bl.img.destroy();
    bl.shadow.destroy();
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    const playing = this.state === 'play';
    for (const t of this.th) t.b.speedMul = t.packing ? 0.5 : 1;
    this.kit.update(dt, playing);
    // solid snowman + forts
    for (const b of this.kit.alive) {
      this.pushOutCircle(b, this.snowman.x, this.snowman.y, this.snowman.r);
      for (const f of this.forts) if (f.solid) this.pushOutRect(b, f);
      b.avatar.setPos(b.x, b.y);
    }
    for (const t of this.th) this.syncThrower(t, dt);
    // rebuild crumbled forts
    for (const f of this.forts) {
      if (f.solid) continue;
      f.down -= dt;
      const blocked = this.kit.alive.some((b) => Math.abs(b.x - f.x) < f.w / 2 + b.r && Math.abs(b.y - f.y) < f.h / 2 + b.r);
      if (f.down <= 0 && !blocked) {
        f.solid = true;
        f.hp = FORT_HP;
        this.setFortStage(f);
        Vfx.sparkle(this, f.x, f.y - 6, [0xffffff, 0xbfe3ff]);
        this.tweens.add({ targets: f.img, scaleY: { from: S * 0.3, to: S }, duration: 300, ease: 'Back.easeOut' });
        Audio.sfx('freeze', 1.4);
      }
    }
  }

  private pushOutRect(b: ArenaBody, f: Fort): void {
    const cx = Phaser.Math.Clamp(b.x, f.x - f.w / 2, f.x + f.w / 2);
    const cy = Phaser.Math.Clamp(b.y, f.y - f.h / 2, f.y + f.h / 2);
    const dx = b.x - cx, dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    if (d >= b.r) return;
    if (d === 0) {
      // centre inside: push along the shallow axis
      const ox = f.w / 2 + b.r - Math.abs(b.x - f.x), oy = f.h / 2 + b.r - Math.abs(b.y - f.y);
      if (ox < oy) b.x += Math.sign(b.x - f.x || 1) * ox; else b.y += Math.sign(b.y - f.y || 1) * oy;
      return;
    }
    const k = (b.r - d) / d;
    b.x += dx * k;
    b.y += dy * k;
    const nx = dx / d, ny = dy / d;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= vn * nx; b.vy -= vn * ny; }
  }

  private pushOutCircle(b: ArenaBody, x: number, y: number, r: number): void {
    const dx = b.x - x, dy = b.y - y, d = Math.hypot(dx, dy) || 1;
    const min = r + b.r;
    if (d >= min) return;
    b.x = x + (dx / d) * min;
    b.y = y + (dy / d) * min;
  }

  private syncThrower(t: Thrower, dt: number): void {
    const b = t.b;
    if (b.data.splat > 0) {
      b.data.splat -= dt;
      t.splat.setPosition(b.x + b.avatar.facing * 2, b.y - 46).setDepth(b.y + 1);
      if (b.data.splat <= 0.3) t.splat.setAlpha(Math.max(0, b.data.splat / 0.3));
      if (b.data.splat <= 0) t.splat.setVisible(false);
    }
    if (t.packing) {
      const k = Phaser.Math.Clamp(t.pack / TIER_T[2], 0, 1);
      t.hand.setPosition(b.x + b.avatar.facing * 4, b.y - 66 - t.tier * 2 + Math.sin(this.time.now / 60) * (t.tier === 2 ? 1 : 0)).setDepth(b.y + 2);
      // dotted aim preview
      const range = TIER[t.tier].range * (0.85 + 0.15 * k);
      t.dots.forEach((d, i) => {
        const f = i === 4 ? 1 : (i + 1) / 5;
        d.setVisible(true).setPosition(b.x + t.ax * range * f, b.y + t.ay * range * f).setAlpha(0.45 + 0.1 * i);
      });
      if (b.stun <= 0) b.avatar.play('cheer');
      if (Math.abs(t.ax) > 0.2) b.avatar.face(t.ax);
    } else if (b.data.throwT > 0) {
      b.data.throwT -= dt;
      if (b.stun <= 0) b.avatar.play('attack');
    }
    // footprints
    const sp = Math.hypot(b.vx, b.vy);
    t.stepT -= dt * (sp / 60);
    if (sp > 30 && t.stepT <= 0) {
      t.stepT = 0.6;
      const img = this.steps[this.stepI++ % this.steps.length];
      const side = (this.stepI % 2 ? 1 : -1) * 3;
      img.setPosition(b.x - (b.vy / sp) * side, b.y + 2 + (b.vx / sp) * side).setAlpha(0.8);
      this.tweens.killTweensOf(img);
      this.tweens.add({ targets: img, alpha: 0, delay: 2500, duration: 1500 });
    }
  }

  tick(dt: number): void {
    for (const t of this.th) {
      const b = t.b;
      t.cd = Math.max(0, t.cd - dt);
      // aim follows the stick (or the CPU's choice)
      if (!this.isCpu(b.p)) {
        const l = Math.hypot(b.ix, b.iy);
        if (l > 0.3) { t.ax = b.ix / l; t.ay = b.iy / l; }
      }
      if (t.packing) {
        t.pack += dt;
        const tier = t.pack >= TIER_T[2] ? 2 : t.pack >= TIER_T[1] ? 1 : 0;
        if (tier !== t.tier) {
          t.tier = tier;
          t.hand.setTexture(TIER[tier].tex);
          Vfx.squash(this, t.hand, 1.5, 1.5, 160);
          Audio.sfx(tier === 2 ? 'power' : 'pop', 1 + tier * 0.2 + b.p * 0.05);
          if (tier === 2) Vfx.sparkle(this, t.hand.x, t.hand.y, [0xffffff, 0xbfe3ff]);
        }
      }
      if (this.isCpu(b.p)) this.bot(t, dt);
    }
    this.stepBalls(dt);
  }

  private stepBalls(dt: number): void {
    for (const bl of this.balls) {
      if (!bl.alive) continue;
      const step = Math.hypot(bl.vx, bl.vy) * dt;
      bl.x += bl.vx * dt;
      bl.y += bl.vy * dt;
      bl.dist += step;
      const k = bl.dist / bl.range;
      bl.z = 26 * (1 - k * k) + Math.sin(Math.min(1, k) * Math.PI) * 10;
      bl.img.setPosition(bl.x, bl.y - bl.z).setDepth(bl.y + 1);
      bl.shadow.setPosition(bl.x, bl.y).setDepth(-45);
      const r = TIER[bl.tier].r;
      // bounds
      if (!Phaser.Geom.Rectangle.Contains(this.field, bl.x, bl.y)) { this.landBall(bl, true); continue; }
      // snowman
      if (Math.hypot(bl.x - this.snowman.x, bl.y - this.snowman.y) < this.snowman.r + r * 0.5) { this.landBall(bl, true); continue; }
      // forts
      const f = this.forts.find((o) => o.solid && Math.abs(bl.x - o.x) < o.w / 2 + r * 0.4 && Math.abs(bl.y - o.y) < o.h / 2 + r * 0.4);
      if (f) {
        f.hp -= bl.tier === 2 ? 2 : 1;
        this.landBall(bl, true);
        Vfx.squash(this, f.img, 1.08, 0.92, 120);
        if (f.hp <= 0) {
          f.solid = false;
          f.down = REBUILD;
          Audio.sfx('bigHit', 1.2);
          burst(this, f.x, f.y - 8, { tex: 'puff', count: 14, tint: [0xffffff, 0xe6f0ff], speed: [40, 140], life: 600, depth: f.y + 40 });
        }
        this.setFortStage(f);
        continue;
      }
      // players
      const target = this.kit.alive.find((b) => b.p !== bl.owner && b.invuln <= 0 && Math.hypot(b.x - bl.x, b.y - 8 - bl.y) < r + b.r);
      if (target) { this.hitPlayer(bl, target); continue; }
      if (bl.dist >= bl.range) this.landBall(bl);
    }
    this.balls = this.balls.filter((b) => b.alive);
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private blocked(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 10);
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (Math.hypot(x - this.snowman.x, y - this.snowman.y) < this.snowman.r + 4) return true;
      if (this.forts.some((f) => f.solid && Math.abs(x - f.x) < f.w / 2 + 3 && Math.abs(y - f.y) < f.h / 2 + 3)) return true;
    }
    return false;
  }

  private bot(t: Thrower, dt: number): void {
    const b = t.b;
    t.retarget -= dt;
    t.strafeT -= dt;
    t.dodgeCd -= dt;
    const others = this.kit.alive.filter((o) => o !== b);
    if (!others.length) return;
    if (t.retarget <= 0 || t.target === undefined || !others.some((o) => o.p === t.target)) {
      // prefer close targets, but not always the same one
      const sorted = [...others].sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y));
      t.target = (Math.random() < 0.65 ? sorted[0] : sorted[Math.floor(Math.random() * sorted.length)]).p;
      t.retarget = 2.5 + Math.random() * 2.5;
    }
    if (t.strafeT <= 0) { t.strafe = Math.random() < 0.5 ? -1 : 1; t.strafeT = 0.8 + Math.random() * 1.4; }
    const tg = this.kit.body(t.target!)!;
    const dx = tg.x - b.x, dy = tg.y - b.y, d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    const ideal = 150 + t.skill * 40;
    const along = d > ideal + 40 ? 1 : d < ideal - 50 ? -0.8 : 0;
    const clear = !this.blocked(b.x, b.y - 8, tg.x, tg.y - 8);
    const sx = -ny * t.strafe * (clear ? 0.5 : 1), sy = nx * t.strafe * (clear ? 0.5 : 1);
    b.botTarget = {
      x: Phaser.Math.Clamp(b.x + (nx * along + sx) * 60, this.field.x + 20, this.field.right - 20),
      y: Phaser.Math.Clamp(b.y + (ny * along + sy) * 60, this.field.y + 20, this.field.bottom - 20),
    };
    // dodge incoming balls
    if (t.dodgeCd <= 0 && b.dashCd <= 0 && !t.packing) {
      const inc = this.balls.find((bl) => bl.owner !== b.p && Math.hypot(bl.x - b.x, bl.y - b.y) < 90 && (b.x - bl.x) * bl.vx + (b.y - bl.y) * bl.vy > 0);
      if (inc) {
        t.dodgeCd = 1;
        if (Math.random() < t.skill * 0.55) {
          const l = Math.hypot(inc.vx, inc.vy) || 1;
          b.botTarget = { x: b.x - (inc.vy / l) * 80 * t.strafe, y: b.y + (inc.vx / l) * 80 * t.strafe };
          b.botDash = true;
        }
      }
    }
    // pack & throw
    if (!t.packing && t.cd <= 0 && b.stun <= 0 && d < 380 && Math.random() < dt * 3) {
      this.startPack(t);
      const roll = Math.random();
      t.want = d > 280 ? 2 : roll < 0.45 ? 0 : roll < 0.85 ? 1 : 2;
    }
    if (t.packing) {
      const tier = TIER[t.want];
      const fly = d / tier.speed;
      const err = (1 - t.skill) * 0.35;
      const lx = tg.x + tg.vx * fly * t.skill - b.x, ly = tg.y + tg.vy * fly * t.skill - b.y;
      const a = Math.atan2(ly, lx) + (Math.random() - 0.5) * err;
      t.ax = Math.cos(a);
      t.ay = Math.sin(a);
      const reach = TIER[t.tier].range;
      if (t.tier >= t.want && (clear || t.pack > 2) && reach > d * 0.85) this.release(t);
      else if (t.pack > 2.5) this.release(t);
    }
  }

  shutdown(): void {
    this.kit?.destroy();
  }
}

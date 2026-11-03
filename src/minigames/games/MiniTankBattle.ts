import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { DragStick, TouchButton } from '../../ui/Controls';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';

const M = 18;
const DIRS = 32;
const TANK_R = 13;
const MAX_HP = 3;
const SPEED = 118;
const TURN = 4.4;
const SHELL_V = 300;
const SHELL_R = 3;
const FIRE_CD = 0.55;

interface Wall { x: number; y: number; w: number; h: number }

interface Tank {
  p: PlayerIndex;
  x: number; y: number; a: number; vx: number; vy: number;
  hp: number; alive: boolean; inv: number; cd: number; recoil: number;
  img: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  mark: Phaser.GameObjects.Image;
  pips: Phaser.GameObjects.Image[];
  stick?: DragStick;
  fire?: TouchButton;
  tread: number; trackT: number;
  wantA: number; throttle: number;
  hits: number; diedAt: number;
  smoke?: Phaser.GameObjects.Particles.ParticleEmitter;
  // CPU
  target?: PlayerIndex; retarget: number; avoid: number; avoidDir: number; react: number; skill: number; wobble: number;
}

interface Shell { owner: PlayerIndex; x: number; y: number; vx: number; vy: number; bounces: number; life: number; img: Phaser.GameObjects.Image; alive: boolean; age: number }

/** #49 — Toy tanks on a classroom desk. Shells bounce once. 3 HP, last tank rolling wins. */
export default class MiniTankBattle extends BaseMinigame {
  private tanks: Tank[] = [];
  private walls: Wall[] = [];
  private shells: Shell[] = [];
  private tracks: Phaser.GameObjects.Image[] = [];
  private trackI = 0;
  private field!: Phaser.Geom.Rectangle;
  private wrench?: { x: number; y: number; img: Phaser.GameObjects.Image };
  private wrenchT = 0;
  private planeT = 0;
  private t = 0;

  constructor() {
    super(CATALOG['mini-tank-battle']);
  }

  setup(): void {
    this.tanks = [];
    this.walls = [];
    this.shells = [];
    this.tracks = [];
    this.trackI = 0;
    this.wrench = undefined;
    this.wrenchT = 10;
    this.planeT = 4;
    this.t = 0;
    this.field = new Phaser.Geom.Rectangle(M, M, this.vw - M * 2, this.vh - M * 2);
    this.paintArt();
    this.buildDesk();
    const W = this.vw, H = this.vh;
    const spawns = [[0.12, 0.27], [0.88, 0.27], [0.12, 0.73], [0.88, 0.73]];
    for (const p of this.players) {
      const [fx, fy] = spawns[p];
      const x = fx * W, y = fy * H;
      const a = Math.atan2(H / 2 - y, W / 2 - x);
      const img = this.add.sprite(x, y, `tank-${p}`, 0).setScale(S);
      const shadow = this.add.image(x + 3, y + 5, 'tank-shadow').setScale(S).setAlpha(0.28).setDepth(-30);
      const mark = this.add.image(x, y, playerMarkerKey(this, p)).setScale(S * 0.8).setDepth(2000).setAngle(this.angleFor(p));
      const pips = [0, 1, 2].map(() => this.add.image(x, y, 'tank-pip', 0).setScale(S).setDepth(2000).setAngle(this.angleFor(p)));
      const tk: Tank = {
        p, x, y, a, vx: 0, vy: 0, hp: MAX_HP, alive: true, inv: 0, cd: 0.4, recoil: 0, img, shadow, mark, pips,
        tread: 0, trackT: 0, wantA: a, throttle: 0, hits: 0, diedAt: -1,
        retarget: 0, avoid: 0, avoidDir: 1, react: 0, skill: 0.5 + Math.random() * 0.45, wobble: Math.random() * 6,
      };
      if (!this.isCpu(p)) {
        tk.fire = new TouchButton(this, this.touch, p, 0.82, 0.74, 'fire', 16);
        tk.fire.onPress = () => this.shoot(tk);
        tk.stick = new DragStick(this, this.touch, p);
        tk.stick.exclude = [tk.fire];
      }
      this.tanks.push(tk);
    }
    for (const tk of this.tanks) this.syncTank(tk);
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) this.paintTank(p);
    makeTexture(this, 'tank-shadow', 20, 20, (p) => p.ellipse(10, 10, 8, 8, 0x2a1a10));
    makeSheet(this, 'tank-pip', 5, 5, 2, (p, i) => {
      p.rect(0, 1, 5, 3, i ? 0x56618a : 0xff4d6d); p.rect(1, 0, 3, 5, i ? 0x56618a : 0xff4d6d);
      if (!i) p.px(1, 1, 0xffc2cc);
      p.outline(-0.7);
    });
    makeTexture(this, 'tank-shell', 5, 5, (p) => { p.ball(2.5, 2.5, 2.2, 2.2, 0xffe066); p.outline(-0.8); });
    makeTexture(this, 'tank-muzzle', 9, 9, (p) => { p.circle(4.5, 4.5, 4, 0xff9f43); p.circle(4.5, 4.5, 2.6, 0xffe066); p.circle(4.5, 4.5, 1.3, 0xffffff); });
    makeTexture(this, 'tank-track', 3, 3, (p) => { p.rect(0, 0, 3, 3, 0x6a4424, 150); });
    makeTexture(this, 'tank-wrench', 13, 13, (p) => {
      p.stroke(3, 10, 9, 4, 2, 0xc7c9d6);
      p.circle(10, 3, 3, 0xc7c9d6); p.rect(10, 1, 3, 3, 0x000000); p.clear(10, 2); p.clear(11, 2); p.clear(11, 1); p.clear(12, 1); p.clear(12, 2);
      p.circle(2.5, 10.5, 2.5, 0xff5a6e);
      p.px(2, 10, 0xffc2cc);
      p.outline(-0.8);
    });
    makeTexture(this, 'tank-plane', 18, 12, (p) => {
      p.tri(0, 6, 18, 0, 10, 6, 0xffffff);
      p.tri(0, 6, 18, 12, 10, 6, 0xe8ecf5);
      p.line(0, 6, 12, 6, 0xc7c9d6);
      p.outline(-0.5);
    });
    makeTexture(this, 'tank-planeshadow', 18, 12, (p) => { p.tri(0, 6, 18, 0, 18, 12, 0x2a1a10); });
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    makeTexture(this, `tank-desk-${aw}x${ah}`, aw, ah, (p) => {
      const r = rng(49);
      // wood planks
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const plank = Math.floor(y / 22);
        const g = Math.sin((x + plank * 37) * 0.09 + Math.sin(y * 0.3 + plank) * 1.4);
        let c = plank % 2 ? 0xd8a46a : 0xd09a60;
        if (g > 0.75) c = shift(c, -0.12);
        else if (g < -0.85) c = shift(c, 0.1);
        if (y % 22 === 0) c = 0x9a6a3e;
        p.px(x, y, c);
      }
      for (let i = 0; i < 9; i++) { const x = r() * aw, y = r() * ah; p.ellipse(x, y, 2.5, 1.5, 0xa8743e); p.ellipse(x, y, 1.2, 0.8, 0x8a5a32); }
      // doodles / stains
      p.ring(aw * 0.18, ah * 0.62, 9, 0xb8845a, 2);
      p.ring(aw * 0.82, ah * 0.36, 9, 0xb8845a, 2);
      for (let i = 0; i < 26; i++) p.px(aw * 0.62 + i, ah * 0.86 + Math.sin(i * 0.6) * 2, 0x7a8ac8, 160);
      for (let i = 0; i < 20; i++) p.px(aw * 0.3 + i, ah * 0.13 + Math.cos(i * 0.5) * 2, 0x7a8ac8, 160);
      // desk rim
      const m = M / S;
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const d = Math.min(x, y, aw - 1 - x, ah - 1 - y);
        if (d < m) p.px(x, y, d < 2 ? 0x5a3a22 : d < m - 2 ? 0x8a5a32 : 0x6a4424);
      }
      for (let x = m; x < aw - m; x++) p.px(x, m, 0xb8845a);
      // sticky notes in the corners
      p.box(4, 4, 12, 12, 0xffe066); p.hline(6, 8, 7, 0xc9a83a); p.hline(6, 11, 5, 0xc9a83a);
      p.box(aw - 16, ah - 16, 12, 12, 0x7ee8b0); p.hline(aw - 14, ah - 12, 7, 0x4fb07a);
      p.box(aw - 16, 4, 12, 12, 0xff9fc0); p.box(4, ah - 16, 12, 12, 0x9fd8ff);
    });
    makeTexture(this, 'tank-mote', 2, 2, (p) => p.rect(0, 0, 2, 2, 0xfff1d0));
    makeTexture(this, 'tank-sun', 60, 40, (p) => {
      for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) {
        const nx = (x - 30) / 30, ny = (y - 20) / 20;
        const d = nx * nx + ny * ny;
        if (d < 1) p.px(x, y, 0xfff1c0, Math.round(70 * (1 - d)));
      }
    });
  }

  /** Paint the 32 rotations x 2 tread phases of a tank by sampling shapes in tank space. */
  private paintTank(p: PlayerIndex): void {
    const c = PLAYER_COLORS[p];
    makeSheet(this, `tank-${p}`, 22, 22, DIRS * 2, (g: Painter, i) => {
      const dir = i % DIRS, phase = Math.floor(i / DIRS);
      const a = (dir / DIRS) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let y = 0; y < 22; y++) for (let x = 0; x < 22; x++) {
        const dx = x + 0.5 - 11, dy = y + 0.5 - 11;
        const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
        const lit = -(dx + dy); // light from top-left
        let col = -1;
        if (Math.abs(u) <= 7.8 && Math.abs(v) >= 4.4 && Math.abs(v) <= 6.9) {
          const stripe = Math.floor(u + 8 + phase) % 2 === 0;
          col = stripe ? 0x5a6078 : 0x3b3f55;
        }
        if (Math.abs(u) <= 7 && Math.abs(v) <= 4.9) {
          col = lit > 5 ? c.light : lit < -6 ? c.dark : c.main;
          if (u > 5.6) col = shift(c.main, -0.25);
        }
        const tu = u + 0.8;
        if (tu * tu + v * v <= 4.1 * 4.1) col = lit > 2 ? c.light : lit < -3 ? shift(c.main, -0.2) : c.main;
        if (tu * tu + v * v <= 1.6 * 1.6) col = c.dark;
        if (u >= 2.5 && u <= 10.4 && Math.abs(v) <= 1.1) col = u > 9.4 ? 0x2b2f45 : lit > 0 ? 0x8a97bf : 0x56618a;
        if (col !== -1) g.px(x, y, col);
      }
      g.outline(-0.75);
    });
  }

  private wallTex(w: number, h: number, kind: number): string {
    const fw = Math.round(w / S), fd = Math.round(h / S), H = 6;
    return makeTexture(this, `tank-wall-${kind}-${fw}x${fd}`, fw, fd + H, (p) => {
      const top = [0x3d9bff, 0xff7a85, 0xffe066, 0x7ee8b0, 0xfff8e7][kind];
      const side = shift(top, -0.35);
      p.rect(0, fd, fw, H, side);
      p.hline(0, fd + H - 1, fw, shift(top, -0.6));
      p.box(0, 0, fw, fd, top);
      if (kind === 0) {
        // pencil box: lid seam + pencils printed
        p.hline(1, Math.floor(fd / 2), fw - 2, shift(top, -0.2));
        for (let i = 0; i < 4; i++) { p.rect(4 + i * 8, 2, 6, 2, [0xffe066, 0xff5a6e, 0x7ee8b0, 0xffffff][i]); p.px(10 + i * 8, 2, 0x1b1f3b); }
        p.rect(fw - 6, fd + 2, 3, 2, 0xc7c9d6);
      } else if (kind === 1 || kind === 3) {
        // book: pages on the side, title band
        p.rect(1, fd, fw - 2, H - 1, 0xfff8e7);
        for (let y = fd + 1; y < fd + H - 1; y++) p.hline(1, y, fw - 2, y % 2 ? 0xe8e0d0 : 0xfff8e7);
        p.rect(0, 0, 2, fd, shift(top, -0.3));
        p.rect(3, Math.floor(fd * 0.3), fw - 6, 3, 0xfff8e7);
        p.hline(4, Math.floor(fd * 0.3) + 1, fw - 10, shift(top, -0.3));
      } else if (kind === 2) {
        // ruler: tick marks
        for (let x = 1; x < fw - 1; x += 2) p.vline(x, 0, x % 10 === 1 ? 4 : 2, 0x8a6a1a);
      } else {
        // eraser: blue sleeve
        p.rect(Math.floor(fw * 0.45), 0, Math.ceil(fw * 0.55), fd, 0x3d9bff);
        p.rect(Math.floor(fw * 0.45), fd, Math.ceil(fw * 0.55), H, 0x1d5bb3);
        p.hline(Math.floor(fw * 0.45), 1, Math.ceil(fw * 0.55) - 1, 0x8fc6ff);
      }
      p.outline(-0.7);
    });
  }

  private buildDesk(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    this.add.image(0, 0, `tank-desk-${aw}x${ah}`).setOrigin(0).setScale(S).setDepth(-100);
    const W = this.vw, H = this.vh;
    // symmetric layout: [x, y, w, h, kind]
    const defs: [number, number, number, number, number][] = [
      [W * 0.5, H * 0.5, 76, 46, 1],
      [W * 0.5, H * 0.17, 100, 22, 0], [W * 0.5, H * 0.83, 100, 22, 0],
      [W * 0.24, H * 0.5, 24, 92, 2], [W * 0.76, H * 0.5, 24, 92, 2],
      [W * 0.33, H * 0.27, 30, 22, 4], [W * 0.67, H * 0.73, 30, 22, 4],
      [W * 0.67, H * 0.27, 30, 22, 4], [W * 0.33, H * 0.73, 30, 22, 4],
    ];
    for (const [x, y, w, h, kind] of defs) {
      this.walls.push({ x, y, w, h });
      this.add.image(x + 5, y + 7, 'px').setDisplaySize(w + 2, h + 4).setTint(0x3a2412).setAlpha(0.25).setDepth(-60);
      this.add.image(x, y - h / 2, this.wallTex(w, h, kind)).setOrigin(0.5, 0).setScale(S).setDepth(y + h / 2);
    }
    // book stack on top of the centre book
    this.add.image(W * 0.5 + 4, H * 0.5 - 30, this.wallTex(56, 30, 3)).setOrigin(0.5, 0).setScale(S).setDepth(H * 0.5 + 24);
    // sunlight through the window + dust motes
    const sun = this.add.image(W * 0.7, H * 0.35, 'tank-sun').setScale(S * 3).setDepth(-20).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: sun, alpha: 0.6, x: W * 0.74, duration: 4000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.particles(0, 0, 'tank-mote', {
      x: { min: 0, max: W }, y: { min: 0, max: H }, speedX: { min: -8, max: 8 }, speedY: { min: -6, max: 6 },
      lifespan: 4000, frequency: 160, alpha: { start: 0, end: 0.7, ease: (k: number) => Math.sin(k * Math.PI) }, scale: { min: 0.6, max: 1.2 },
    }).setDepth(1500);
    for (let i = 0; i < 70; i++) this.tracks.push(this.add.image(-50, -50, 'tank-track').setScale(S).setDepth(-50).setAlpha(0));
  }

  // ───────────────────────────── gameplay ─────────────────────────────

  private shoot(tk: Tank): void {
    if (this.state !== 'play' || !tk.alive || tk.cd > 0) return;
    if (this.shells.filter((s) => s.alive && s.owner === tk.p).length >= 2) return;
    tk.cd = FIRE_CD;
    const ca = Math.cos(tk.a), sa = Math.sin(tk.a);
    const mx = tk.x + ca * 22, my = tk.y + sa * 22;
    // don't spawn inside a wall
    if (this.wallAt(mx, my, SHELL_R)) { Audio.sfx('wrong', 1.6); return; }
    const img = this.add.image(mx, my, 'tank-shell').setScale(S).setDepth(1000);
    this.shells.push({ owner: tk.p, x: mx, y: my, vx: ca * SHELL_V, vy: sa * SHELL_V, bounces: 0, life: 3, img, alive: true, age: 0 });
    tk.recoil = 1;
    tk.vx -= ca * 70; tk.vy -= sa * 70;
    const fl = this.add.image(mx, my, 'tank-muzzle').setScale(S).setDepth(1001);
    this.tweens.add({ targets: fl, scale: S * 1.6, alpha: 0, duration: 120, onComplete: () => fl.destroy() });
    burst(this, mx, my, { tex: 'puff', count: 4, tint: [0xffffff, 0xe0e0e8], speed: [10, 40], life: 400, scale: [S * 0.6, S * 0.2], alpha: [0.7, 0], depth: 999 });
    Audio.sfx('shoot', 1 + tk.p * 0.1);
  }

  private wallAt(x: number, y: number, r: number): Wall | undefined {
    return this.walls.find((w) => Math.abs(x - w.x) < w.w / 2 + r && Math.abs(y - w.y) < w.h / 2 + r);
  }

  private damage(tk: Tank, sh: Shell): void {
    tk.hp--;
    tk.inv = 0.6;
    tk.vx += sh.vx * 0.35; tk.vy += sh.vy * 0.35;
    if (sh.owner !== tk.p) {
      const att = this.tanks.find((t) => t.p === sh.owner);
      if (att) att.hits++;
    }
    Vfx.hit(this, tk.x, tk.y, [0xffffff, 0xffe066, PLAYER_COLORS[tk.p].main]);
    Vfx.hitFlash(this, tk.img);
    Audio.sfx('hit', 1 + tk.p * 0.1);
    const own = sh.owner === tk.p;
    Vfx.popText(this, tk.x, tk.y - 30, own ? 'ยิงตัวเอง!' : '-1', own ? '#ffe066' : '#ff9fae', own ? 15 : 18, this.angleFor(tk.p));
    if (tk.hp <= 0) this.destroyTank(tk);
  }

  private destroyTank(tk: Tank): void {
    tk.alive = false;
    tk.diedAt = this.elapsed;
    Vfx.explosion(this, tk.x, tk.y, 1.2);
    Audio.sfx('explode', 1);
    Audio.sfx('bigHit', 0.8);
    burst(this, tk.x, tk.y, { tex: 'dot3', count: 18, tint: [PLAYER_COLORS[tk.p].main, 0x3b3f55, 0xffe066], speed: [80, 260], life: 700, rotate: true, depth: 1200 });
    tk.img.setTint(0x4a4038);
    this.tweens.add({ targets: tk.img, y: tk.img.y - 14, yoyo: true, duration: 220, ease: 'Quad.easeOut' });
    tk.mark.setVisible(false);
    for (const pip of tk.pips) pip.setVisible(false);
    tk.smoke = this.add.particles(tk.x, tk.y, 'puff', {
      speedY: { min: -40, max: -20 }, speedX: { min: -10, max: 10 }, lifespan: 1400, frequency: 140,
      scale: { start: S * 0.6, end: S * 1.4 }, alpha: { start: 0.5, end: 0 }, tint: [0x4a4a5c, 0x6b6b80],
    }).setDepth(1300);
    Vfx.popText(this, tk.x, tk.y - 40, 'บึ้ม!!', '#ff9f43', 22, this.angleFor(tk.p));
    this.eliminate(tk.p);
  }

  ambient(dt: number): void {
    this.t += dt;
    for (const tk of this.tanks) this.syncTank(tk);
    // paper plane fly-over (cosmetic)
    this.planeT -= dt;
    if (this.planeT <= 0) {
      this.planeT = 9 + Math.random() * 6;
      const ltr = Math.random() < 0.5;
      const y0 = this.vh * (0.2 + Math.random() * 0.6), y1 = this.vh * (0.2 + Math.random() * 0.6);
      const x0 = ltr ? -30 : this.vw + 30, x1 = ltr ? this.vw + 30 : -30;
      const pl = this.add.image(x0, y0, 'tank-plane').setScale(S).setDepth(2500).setFlipX(!ltr);
      const sh = this.add.image(x0, y0 + 40, 'tank-planeshadow').setScale(S).setDepth(-25).setAlpha(0.18).setFlipX(!ltr);
      this.tweens.add({ targets: pl, x: x1, y: y1, duration: 3200, ease: 'Sine.easeInOut', onComplete: () => pl.destroy() });
      this.tweens.add({ targets: sh, x: x1, y: y1 + 40, duration: 3200, ease: 'Sine.easeInOut', onComplete: () => sh.destroy() });
    }
    if (this.wrench) this.wrench.img.setY(this.wrench.y - 6 + Math.sin(this.t * 4) * 3);
  }

  tick(dt: number): void {
    for (const tk of this.tanks) {
      if (!tk.alive) continue;
      tk.cd = Math.max(0, tk.cd - dt);
      tk.inv = Math.max(0, tk.inv - dt);
      tk.recoil = Math.max(0, tk.recoil - dt * 6);
      if (this.isCpu(tk.p)) this.bot(tk, dt);
      else if (tk.stick) {
        const m = Math.hypot(tk.stick.vx, tk.stick.vy);
        tk.throttle = m > 0.25 ? Math.min(1, m) : 0;
        if (m > 0.25) tk.wantA = Math.atan2(tk.stick.vy, tk.stick.vx);
      }
      this.drive(tk, dt);
    }
    this.collideTanks();
    this.stepShells(dt);
    // repair wrench pickup
    this.wrenchT -= dt;
    if (!this.wrench && this.wrenchT <= 0) this.spawnWrench();
    if (this.wrench) {
      const w = this.wrench;
      const tk = this.tanks.find((t) => t.alive && Math.hypot(t.x - w.x, t.y - w.y) < TANK_R + 10);
      if (tk) {
        if (tk.hp < MAX_HP) {
          tk.hp++;
          Vfx.popText(this, tk.x, tk.y - 34, '+1 HP', '#7ee8b0', 18, this.angleFor(tk.p));
        }
        Audio.sfx('power', 1 + tk.p * 0.1);
        Vfx.sparkle(this, w.x, w.y, [0xffffff, 0x7ee8b0]);
        w.img.destroy();
        this.wrench = undefined;
        this.wrenchT = 11;
      }
    }
    for (const tk of this.tanks) this.hudText[tk.p] = tk.alive ? `${'♥'.repeat(tk.hp)}${'·'.repeat(MAX_HP - tk.hp)}` : 'OUT';
  }

  private spawnWrench(): void {
    for (let tries = 0; tries < 20; tries++) {
      const x = this.field.x + 40 + Math.random() * (this.field.width - 80);
      const y = this.field.y + 40 + Math.random() * (this.field.height - 80);
      if (this.wallAt(x, y, 18) || this.tanks.some((t) => t.alive && Math.hypot(t.x - x, t.y - y) < 60)) continue;
      const img = this.add.image(x, y, 'tank-wrench').setScale(S).setDepth(y);
      img.setScale(0);
      this.tweens.add({ targets: img, scale: S, duration: 300, ease: 'Back.easeOut' });
      this.wrench = { x, y, img };
      Audio.sfx('pop', 1.2);
      return;
    }
    this.wrenchT = 2;
  }

  private drive(tk: Tank, dt: number): void {
    // turn toward the wanted heading, then roll
    let diff = Phaser.Math.Angle.Wrap(tk.wantA - tk.a);
    if (tk.throttle > 0) {
      const step = Math.min(Math.abs(diff), TURN * dt);
      tk.a = Phaser.Math.Angle.Wrap(tk.a + Math.sign(diff) * step);
      diff = Phaser.Math.Angle.Wrap(tk.wantA - tk.a);
    }
    const align = Math.max(0, Math.cos(diff));
    const sp = SPEED * tk.throttle * align * align;
    const ca = Math.cos(tk.a), sa = Math.sin(tk.a);
    // knock-back decays, drive velocity is direct
    tk.vx *= Math.pow(0.02, dt); tk.vy *= Math.pow(0.02, dt);
    const mx = (ca * sp + tk.vx) * dt, my = (sa * sp + tk.vy) * dt;
    tk.x += mx; tk.y += my;
    this.resolveWalls(tk);
    const moved = Math.hypot(mx, my);
    if (moved > 0.1 || (tk.throttle > 0 && Math.abs(diff) > 0.05)) {
      tk.tread += moved / 3 + dt * 4;
      tk.trackT -= moved;
      if (tk.trackT <= 0) {
        tk.trackT = 9;
        for (const s of [-1, 1]) {
          const img = this.tracks[this.trackI++ % this.tracks.length];
          img.setPosition(tk.x - sa * 10 * s - ca * 8, tk.y + ca * 10 * s - sa * 8).setAlpha(0.32);
          this.tweens.killTweensOf(img);
          this.tweens.add({ targets: img, alpha: 0, delay: 1800, duration: 1400 });
        }
      }
    }
  }

  private resolveWalls(tk: Tank): void {
    const f = this.field;
    tk.x = Phaser.Math.Clamp(tk.x, f.x + TANK_R, f.right - TANK_R);
    tk.y = Phaser.Math.Clamp(tk.y, f.y + TANK_R, f.bottom - TANK_R);
    for (const w of this.walls) {
      const cx = Phaser.Math.Clamp(tk.x, w.x - w.w / 2, w.x + w.w / 2);
      const cy = Phaser.Math.Clamp(tk.y, w.y - w.h / 2, w.y + w.h / 2);
      const dx = tk.x - cx, dy = tk.y - cy, d = Math.hypot(dx, dy);
      if (d >= TANK_R) continue;
      if (d === 0) {
        const ox = w.w / 2 + TANK_R - Math.abs(tk.x - w.x), oy = w.h / 2 + TANK_R - Math.abs(tk.y - w.y);
        if (ox < oy) tk.x += Math.sign(tk.x - w.x || 1) * ox; else tk.y += Math.sign(tk.y - w.y || 1) * oy;
      } else {
        tk.x += (dx / d) * (TANK_R - d);
        tk.y += (dy / d) * (TANK_R - d);
      }
    }
  }

  private collideTanks(): void {
    const list = this.tanks.filter((t) => t.alive);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      if (d >= TANK_R * 2) continue;
      const o = (TANK_R * 2 - d) / 2;
      a.x -= (dx / d) * o; a.y -= (dy / d) * o;
      b.x += (dx / d) * o; b.y += (dy / d) * o;
      this.resolveWalls(a); this.resolveWalls(b);
    }
    // wrecks are solid too
    for (const w of this.tanks.filter((t) => !t.alive)) for (const a of list) {
      const dx = a.x - w.x, dy = a.y - w.y, d = Math.hypot(dx, dy) || 1;
      if (d < TANK_R * 2) { a.x = w.x + (dx / d) * TANK_R * 2; a.y = w.y + (dy / d) * TANK_R * 2; this.resolveWalls(a); }
    }
  }

  private stepShells(dt: number): void {
    const f = this.field;
    for (const s of this.shells) {
      if (!s.alive) continue;
      s.life -= dt;
      s.age += dt;
      const steps = 3;
      for (let k = 0; k < steps && s.alive; k++) {
        const px = s.x, py = s.y;
        s.x += (s.vx * dt) / steps;
        s.y += (s.vy * dt) / steps;
        let bounced = false;
        if (s.x < f.x + SHELL_R || s.x > f.right - SHELL_R) { s.vx = -s.vx; s.x = Phaser.Math.Clamp(s.x, f.x + SHELL_R, f.right - SHELL_R); bounced = true; }
        if (s.y < f.y + SHELL_R || s.y > f.bottom - SHELL_R) { s.vy = -s.vy; s.y = Phaser.Math.Clamp(s.y, f.y + SHELL_R, f.bottom - SHELL_R); bounced = true; }
        const w = this.wallAt(s.x, s.y, SHELL_R);
        if (w && !bounced) {
          // reflect on the axis we came through
          const inX = Math.abs(px - w.x) < w.w / 2 + SHELL_R;
          if (inX) { s.vy = -s.vy; s.y = py; } else { s.vx = -s.vx; s.x = px; }
          bounced = true;
        }
        if (bounced) {
          s.bounces++;
          if (s.bounces > 1) { this.popShell(s); break; }
          Audio.sfx('bounce', 1.6);
          burst(this, s.x, s.y, { tex: 'spark', count: 4, tint: [0xffffff, 0xffe066], speed: [30, 90], life: 200, depth: 1000 });
        }
        const hit = this.tanks.find((t) => t.alive && t.inv <= 0 && (t.p !== s.owner || s.bounces > 0) && Math.hypot(t.x - s.x, t.y - s.y) < TANK_R + SHELL_R);
        if (hit) { this.damage(hit, s); this.popShell(s); break; }
        // shells cancel each other
        const other = this.shells.find((o) => o !== s && o.alive && Math.hypot(o.x - s.x, o.y - s.y) < SHELL_R * 2.5);
        if (other) { this.popShell(other); this.popShell(s); Audio.sfx('pop', 1); break; }
      }
      if (s.alive && s.life <= 0) this.popShell(s);
      if (s.alive) s.img.setPosition(s.x, s.y).setDepth(s.y + 10);
    }
    this.shells = this.shells.filter((s) => s.alive);
  }

  private popShell(s: Shell): void {
    if (!s.alive) return;
    s.alive = false;
    s.img.destroy();
    burst(this, s.x, s.y, { tex: 'dot2', count: 6, tint: [0xffe066, 0xff9f43, 0xffffff], speed: [30, 100], life: 260, depth: 1000 });
  }

  private syncTank(tk: Tank): void {
    const dir = ((Math.round((tk.a / (Math.PI * 2)) * DIRS) % DIRS) + DIRS) % DIRS;
    const phase = Math.floor(tk.tread) % 2;
    const ca = Math.cos(tk.a), sa = Math.sin(tk.a);
    const rx = tk.x - ca * tk.recoil * 3, ry = tk.y - sa * tk.recoil * 3;
    if (tk.alive) tk.img.setFrame(dir + phase * DIRS);
    tk.img.setPosition(rx, ry - 2).setDepth(tk.y + 12);
    tk.img.setAlpha(tk.alive && tk.inv > 0 && Math.floor(tk.inv * 20) % 2 === 0 ? 0.5 : 1);
    tk.shadow.setPosition(rx + 3, ry + 4);
    if (!tk.alive) { tk.smoke?.setPosition(tk.x, tk.y - 6); return; }
    // marker + HP pips float "above" the tank from the owner's seat
    const up = this.angleFor(tk.p) === 180 ? 1 : -1;
    tk.mark.setPosition(tk.x, tk.y + up * 44 + Math.sin(this.t * 4 + tk.p) * 2);
    tk.pips.forEach((pip, i) => pip.setPosition(tk.x + (i - 1) * 12 * -up, tk.y + up * 28).setFrame(i < tk.hp ? 0 : 1));
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private los(x0: number, y0: number, x1: number, y1: number): boolean {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
    for (let i = 1; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (this.wallAt(x, y, SHELL_R + 1)) return false;
    }
    return true;
  }

  private bot(tk: Tank, dt: number): void {
    tk.retarget -= dt;
    tk.avoid -= dt;
    const others = this.tanks.filter((t) => t.alive && t !== tk);
    if (!others.length) { tk.throttle = 0; return; }
    if (tk.retarget <= 0 || !others.some((o) => o.p === tk.target)) {
      const sorted = others.sort((a, b) => Math.hypot(a.x - tk.x, a.y - tk.y) - Math.hypot(b.x - tk.x, b.y - tk.y));
      tk.target = (Math.random() < 0.7 ? sorted[0] : sorted[sorted.length - 1]).p;
      tk.retarget = 3 + Math.random() * 3;
    }
    const tg = this.tanks.find((t) => t.p === tk.target)!;
    const dx = tg.x - tk.x, dy = tg.y - tk.y, d = Math.hypot(dx, dy);
    const see = this.los(tk.x, tk.y, tg.x, tg.y);
    // go for the repair kit when hurt
    if (this.wrench && tk.hp < MAX_HP && Math.hypot(this.wrench.x - tk.x, this.wrench.y - tk.y) < 260) {
      tk.wantA = Math.atan2(this.wrench.y - tk.y, this.wrench.x - tk.x);
      tk.throttle = 1;
    } else if (see) {
      const fly = d / SHELL_V;
      const aim = Math.atan2(tg.y + tg.vy * 0 + Math.sin(tg.a) * SPEED * tg.throttle * fly * tk.skill - tk.y, tg.x + Math.cos(tg.a) * SPEED * tg.throttle * fly * tk.skill - tk.x);
      const err = Math.sin(this.t * 1.7 + tk.wobble) * 0.26 * (1.25 - tk.skill);
      tk.wantA = aim + err;
      tk.throttle = d > 200 ? 0.9 : d < 110 ? 0.25 : 0.12;
      const off = Math.abs(Phaser.Math.Angle.Wrap(aim - tk.a));
      if (off < 0.14 && tk.cd <= 0) {
        tk.react -= dt;
        if (tk.react <= 0) { this.shoot(tk); tk.react = 0.3 + Math.random() * 0.7 * (1.3 - tk.skill); }
      }
      if (tk.throttle < 0.3) tk.throttle = 0.2; // keep turning
    } else {
      tk.wantA = Math.atan2(dy, dx);
      tk.throttle = 1;
    }
    // avoid walls ahead
    if (tk.avoid > 0) tk.wantA = tk.a + tk.avoidDir * 1.2;
    else {
      const ax = tk.x + Math.cos(tk.a) * 30, ay = tk.y + Math.sin(tk.a) * 30;
      const f = this.field;
      if (tk.throttle > 0.5 && (this.wallAt(ax, ay, 6) || ax < f.x + 10 || ax > f.right - 10 || ay < f.y + 10 || ay > f.bottom - 10)) {
        tk.avoid = 0.45 + Math.random() * 0.3;
        tk.avoidDir = Math.random() < 0.5 ? -1 : 1;
      }
    }
    // dodge shells
    const inc = this.shells.find((s) => s.owner !== tk.p && Math.hypot(s.x - tk.x, s.y - tk.y) < 110 && (tk.x - s.x) * s.vx + (tk.y - s.y) * s.vy > 0);
    if (inc && Math.random() < tk.skill * 0.08) { tk.wantA = Math.atan2(inc.vx, -inc.vy); tk.throttle = 1; tk.avoid = 0.3; tk.avoidDir = 0; }
  }

  results(): PlayerResult[] {
    const tank = (p: PlayerIndex) => this.tanks.find((t) => t.p === p);
    const v = (p: PlayerIndex) => {
      const tk = tank(p);
      if (!tk) return 0;
      return tk.alive ? 10000 + tk.hp * 100 + tk.hits : tk.diedAt * 10 + tk.hits * 0.01;
    };
    return rankBy(this.players, v).map((r) => ({ ...r, score: tank(r.player)?.hp ?? 0 }));
  }
}

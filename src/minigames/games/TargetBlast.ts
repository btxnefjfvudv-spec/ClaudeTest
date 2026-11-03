import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { DragStick, TouchButton } from '../../ui/Controls';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';

type Kind = 'duck' | 'can' | 'teacher' | 'gold' | 'bomb';

const KINDS: Record<Kind, { pts: number; r: number; speed: number }> = {
  duck: { pts: 1, r: 15, speed: 1 },
  can: { pts: 2, r: 11, speed: 1.15 },
  teacher: { pts: 3, r: 16, speed: 1.3 },
  gold: { pts: 5, r: 14, speed: 1.7 },
  bomb: { pts: -3, r: 14, speed: 0.95 },
};

const COOLDOWN = 0.42;
const BUBBLE_SPEED = 620;
const CROSS_SPEED = 400;

interface Target {
  kind: Kind;
  lane: number;
  x: number;
  y: number;
  vx: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  alive: boolean;
  t: number;
  bob: number;
}

interface Bubble { p: PlayerIndex; x0: number; y0: number; x1: number; y1: number; t: number; dur: number; img: Phaser.GameObjects.Image }

interface Shooter {
  p: PlayerIndex;
  cx: number;
  cy: number;
  cool: number;
  stun: number;
  streak: number;
  hits: number;
  shots: number;
  gunX: number;
  gunY: number;
  gun: Phaser.GameObjects.Image;
  cross: Phaser.GameObjects.Image;
  crossNum: Phaser.GameObjects.Text;
  reload: Phaser.GameObjects.Graphics;
  stick?: DragStick;
  btn?: TouchButton;
  // CPU
  skill: number;
  think: number;
  goal?: { x: number; y: number; target?: Target };
  wantFire: boolean;
}

/** #24 — Bubble-gun shooting gallery over a carnival duck pond. */
export default class TargetBlast extends BaseMinigame {
  private lanes: { y: number; dir: number; speed: number; next: number; water: Phaser.GameObjects.TileSprite }[] = [];
  private targets: Target[] = [];
  private bubbles: Bubble[] = [];
  private shooters: Shooter[] = [];
  private bulbs: Phaser.GameObjects.Image[] = [];
  private flags: Phaser.GameObjects.Image[] = [];
  private rand: () => number = Math.random;
  private t = 0;
  private fever = false;
  private top = 0;
  private bottom = 0;

  constructor() {
    super(CATALOG['target-blast']);
  }

  setup(): void {
    this.targets = [];
    this.bubbles = [];
    this.shooters = [];
    this.bulbs = [];
    this.flags = [];
    this.lanes = [];
    this.t = 0;
    this.fever = false;
    this.rand = rng(2401 + Math.floor(Math.random() * 1000));
    const laneH = 58;
    const n = 4;
    this.top = this.vh / 2 - (laneH * n) / 2;
    this.bottom = this.vh / 2 + (laneH * n) / 2;
    this.paintBooth(laneH);
    this.paintTargets();
    const speeds = [62, 92, 92, 62];
    for (let i = 0; i < n; i++) {
      const y = this.top + laneH * (i + 0.5);
      const dir = i % 2 === 0 ? 1 : -1;
      const water = this.add.tileSprite(0, y - laneH / 2 + 4, this.vw / S, (laneH - 8) / S, 'target-blast-water').setOrigin(0).setScale(S).setDepth(-90);
      this.lanes.push({ y, dir, speed: speeds[i], next: 0.2 + i * 0.35, water });
    }
    // pre-fill lanes so the pond is busy from the first second
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) this.spawn(i, 60 + k * (this.vw / 3) + this.rand() * 60);
    }
    this.makeShooters();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintBooth(laneH: number): void {
    const W = Math.ceil(this.vw / S), H = Math.ceil(this.vh / S);
    const top = this.top / S, bot = this.bottom / S, lh = laneH / S;
    const key = makeTexture(this, `target-blast-bg-${W}`, W, H, (p) => {
      const r = rng(24);
      // boardwalk planks
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const plank = Math.floor(x / 14) % 2;
        p.px(x, y, plank ? 0xb5794a : 0xa86f44);
      }
      for (let x = 0; x < W; x += 14) p.vline(x, 0, H, 0x7e4e2e);
      for (let i = 0; i < 260; i++) p.px(Math.floor(r() * W), Math.floor(r() * H), r() > 0.5 ? 0xc48858 : 0x93603a);
      for (let x = 7; x < W; x += 14) for (let y = Math.floor(r() * 30); y < H; y += 40) { p.px(x, y, 0x5e3a22); p.px(x + 4, y, 0x5e3a22); }
      // counters (top and bottom) with candy stripes
      for (const ty of [0, 1]) {
        const y0 = ty === 0 ? top - 26 : bot + 8, y1 = ty === 0 ? top - 8 : bot + 26;
        p.rect(0, y0, W, y1 - y0, 0xe9dcc0);
        for (let x = 0; x < W; x++) for (let y = y0; y < y1; y++) if (Math.floor((x + (ty ? -y : y)) / 6) % 2) p.px(x, y, 0xff5a6e);
        p.hline(0, y0, W, 0xffffff);
        p.hline(0, y1 - 1, W, 0x9b2c3c);
        p.hline(0, ty === 0 ? y1 : y0 - 1, W, 0x5e3a22);
      }
      // pond basin
      p.rect(0, top - 6, W, bot - top + 12, 0x6e4a2c);
      p.rect(0, top - 4, W, bot - top + 8, 0x1b4a7a);
      for (let i = 0; i <= 4; i++) {
        const y = Math.round(top + i * lh);
        p.rect(0, y - 2, W, 4, 0xc0834a);
        p.hline(0, y - 2, W, 0xe0a96c);
        p.hline(0, y + 1, W, 0x7a4a2c);
        for (let x = 6; x < W; x += 24) { p.px(x, y, 0x5e3a22); }
      }
      // tunnels at both ends
      for (const left of [true, false]) {
        const x0 = left ? 0 : W - 16;
        for (let i = 0; i < 4; i++) {
          const y = top + i * lh + 2;
          p.rect(x0, y, 16, lh - 4, 0x2b1a2e);
          for (let x = 0; x < 16; x += 2) p.vline(x0 + x, y, 3 + ((x / 2) % 2) * 2, x % 4 ? 0xffc93d : 0x8455d6);
          p.vline(left ? x0 + 15 : x0, y, lh - 4, 0x6e4a2c);
        }
      }
      // tent awning valance along the outer edges
      for (const ty of [0, 1]) {
        for (let x = 0; x < W; x++) {
          const stripe = Math.floor(x / 10) % 2;
          const sc = 3 + Math.round(Math.abs(Math.sin(((x % 10) / 10) * Math.PI)) * 3);
          for (let y = 0; y < 9 + sc; y++) {
            const yy = ty === 0 ? y : H - 1 - y;
            p.px(x, yy, y >= 8 + sc ? 0x7a2030 : stripe ? 0xff5a6e : 0xfff8e7);
          }
        }
      }
      // tiny prizes on the counters (plush toys)
      const prize = (x: number, y: number, c: number) => {
        p.ball(x, y, 4, 3.5, c);
        p.ball(x - 3, y - 3, 1.6, 1.6, c);
        p.ball(x + 3, y - 3, 1.6, 1.6, c);
        p.px(x - 1, y - 1, 0x1b1f3b); p.px(x + 1, y - 1, 0x1b1f3b);
      };
      const pc = [0xff9fc0, 0x8fd6ff, 0xb8f0a0, 0xffe066, 0xc9b8ff];
      for (let i = 0; i < 6; i++) {
        prize(10 + i * 8, top - 17, pc[i % 5]);
        prize(W - 10 - i * 8, top - 17, pc[(i + 2) % 5]);
        prize(10 + i * 8, bot + 17, pc[(i + 3) % 5]);
        prize(W - 10 - i * 8, bot + 17, pc[(i + 1) % 5]);
      }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
    makeTexture(this, 'target-blast-water', 32, 25, (p) => {
      p.rect(0, 0, 32, 25, 0x2f8fd0);
      const r = rng(9);
      for (let i = 0; i < 12; i++) p.hline(Math.floor(r() * 32), Math.floor(r() * 25), 3 + Math.floor(r() * 4), 0x56aee6);
      for (let i = 0; i < 5; i++) p.hline(Math.floor(r() * 32), Math.floor(r() * 25), 2, 0xbfeaff);
      p.hline(0, 0, 32, 0x2271b0);
    });
    // string of bulbs along both counters + pennant flags
    const bulb = makeTexture(this, 'target-blast-bulb', 5, 5, (p) => { p.circle(2.5, 2.5, 2.4, 0xffffff); p.px(1, 1, 0xffffff); });
    for (const y of [this.top - 66, this.bottom + 66]) {
      const sag = (x: number) => Math.abs(Math.sin((x / this.vw) * Math.PI * 5)) * 8 * (y < this.vh / 2 ? 1 : -1);
      const wire = this.add.graphics().setDepth(-81);
      wire.lineStyle(2, 0x3a2622, 1);
      wire.beginPath();
      for (let x = 0; x <= this.vw; x += 6) (x === 0 ? wire.moveTo(x, y + sag(x)) : wire.lineTo(x, y + sag(x)));
      wire.strokePath();
      for (let x = 13; x < this.vw; x += 26) this.bulbs.push(this.add.image(x, y + sag(x) + (y < this.vh / 2 ? 4 : -4), bulb).setScale(S * 0.8).setDepth(-80));
    }
    const flag = makeTexture(this, 'target-blast-pennant', 8, 9, (p) => { p.tri(0, 0, 8, 0, 4, 9, 0xffffff); p.outline(-0.5); });
    const fc = [0xff5a6e, 0xffe066, 0x3d9bff, 0x3ed17a, 0xb8a6ff];
    for (const yy of [this.top - 66, this.bottom + 66]) {
      const sag = (x: number) => Math.abs(Math.sin((x / this.vw) * Math.PI * 5)) * 8 * (yy < this.vh / 2 ? 1 : -1);
      for (let x = 26; x < this.vw - 10; x += 26) {
        const f = this.add.image(x, yy + sag(x), flag).setScale(S).setDepth(-79).setTint(fc[(x / 22) % 5 | 0]).setOrigin(0.5, 0);
        if (yy > this.vh / 2) f.setFlipY(true).setOrigin(0.5, 1);
        this.flags.push(f);
      }
    }
  }

  private paintTargets(): void {
    // Duck (facing right; flipped for left lanes)
    const duck = (key: string, body: number, bill: number, crown: boolean) => makeTexture(this, key, 22, 22, (q) => {
      const p = q.sub(0, 4, 22, 18);
      p.ellipse(10, 11, 9, 6, shift(body, -0.3));
      p.ball(10, 10, 8.5, 5.5, body);
      p.ball(16, 6, 4.2, 4.2, body);
      p.rect(19, 6, 3, 2, bill);
      p.px(21, 7, shift(bill, -0.3));
      p.px(17, 5, 0x1b1f3b);
      p.px(17, 4, 0xffffff);
      p.hline(6, 9, 6, shift(body, -0.18));
      p.px(5, 8, shift(body, -0.18));
      p.tri(1, 7, 4, 9, 2, 11, body);
      if (crown) {
        q.rect(13, 1, 7, 3, 0xffe066);
        q.px(13, 0, 0xffe066); q.px(16, 0, 0xffffff); q.px(19, 0, 0xffe066);
        q.px(15, 2, 0xff5a6e); q.px(18, 2, 0x3d9bff);
        p.px(8, 8, 0xffffff); p.px(9, 7, 0xffffff); p.px(12, 12, 0xfff3c4);
      }
      q.outline(-0.8);
    });
    duck('target-blast-duck', 0xfff07a, 0xff8a3d, false);
    duck('target-blast-gold', 0xffb52e, 0xff5a3d, true);
    makeTexture(this, 'target-blast-can', 16, 18, (p) => {
      p.ellipse(8, 13, 7.5, 4, 0x5b3a26); // little float
      p.rect(2, 3, 12, 10, 0xd8dbe4);
      p.rect(2, 6, 12, 5, 0xff5a6e);
      p.hline(2, 8, 12, 0xffe066);
      p.vline(3, 3, 10, 0xffffff);
      p.vline(12, 3, 10, 0x9aa3b8);
      p.ellipse(8, 3, 6, 2, 0xeef1f8);
      p.ellipse(8, 3, 4, 1.2, 0xb8bfd0);
      p.outline(-0.8);
    });
    makeTexture(this, 'target-blast-teacher', 22, 26, (p) => {
      p.rect(9, 18, 4, 8, 0x8a5a34); // stick
      p.ellipse(11, 12, 10, 11, 0xc9a06a); // cardboard edge
      p.ellipse(11, 12, 8.5, 9.5, 0xffd9b8);
      p.ellipse(11, 4.5, 8, 4, 0x3a2622); // hair
      p.ball(11, 1.5, 3, 2.4, 0x3a2622); // bun
      p.ring(7.5, 11, 2.6, 0x1b1f3b); p.ring(14.5, 11, 2.6, 0x1b1f3b);
      p.hline(10, 11, 2, 0x1b1f3b);
      p.px(7, 11, 0x1b1f3b); p.px(14, 11, 0x1b1f3b);
      p.hline(9, 16, 4, 0xc0504a);
      p.px(4, 14, 0xff9fa0); p.px(18, 14, 0xff9fa0);
      p.outline(-0.8);
    });
    makeSheet(this, 'target-blast-bomb', 18, 20, 2, (p, i) => {
      p.ball(8, 12, 7.5, 7.5, 0x3a3348);
      p.rect(6, 3, 4, 3, 0x6b7290);
      p.line(8, 3, 11, 0, 0xc9b27a);
      p.hline(4, 13, 9, 0xff5a6e);
      p.px(5, 9, 0xb8bfd0); p.px(4, 10, 0xb8bfd0);
      if (i === 0) { p.px(12, 0, 0xffe066); p.px(13, 1, 0xff9f43); p.px(11, 1, 0xffffff); }
      else { p.px(12, 1, 0xff9f43); p.px(13, 0, 0xffe066); p.px(14, 1, 0xffffff); }
      p.outline(-0.8);
    });
    if (!this.anims.exists('target-blast-fuse')) this.anims.create({ key: 'target-blast-fuse', frames: this.anims.generateFrameNumbers('target-blast-bomb', {}), frameRate: 10, repeat: -1 });
    makeTexture(this, 'target-blast-bubble', 12, 12, (p) => {
      p.circle(6, 6, 5.5, 0xbfeaff, 110);
      p.ring(6, 6, 5.5, 0xffffff, 1);
      p.px(4, 3, 0xffffff); p.px(3, 4, 0xffffff);
    });
    makeTexture(this, 'target-blast-wake', 6, 3, (p) => { p.hline(0, 1, 6, 0xffffff); p.px(1, 0, 0xffffff); p.px(4, 2, 0xffffff); });
  }

  private gunKey(p: PlayerIndex): string {
    const c = PLAYER_COLORS[p];
    // pointing right; rotated toward the crosshair
    return makeTexture(this, `target-blast-gun-${p}`, 26, 14, (g) => {
      g.box(2, 4, 16, 7, c.main);
      g.hline(3, 5, 13, c.light);
      g.rect(17, 5, 6, 5, 0xbfeaff);
      g.rect(23, 4, 3, 7, 0xffffff);
      g.ball(8, 3, 4, 3, 0x7ee8b0);
      g.px(7, 2, 0xffffff);
      g.rect(5, 10, 4, 4, shift(c.main, -0.35));
      g.outline(-0.8);
    });
  }

  private crossKey(p: PlayerIndex): string {
    const c = PLAYER_COLORS[p];
    return makeTexture(this, `target-blast-cross-${p}`, 21, 21, (g) => {
      g.ring(10.5, 10.5, 9, c.main, 2);
      g.ring(10.5, 10.5, 9.8, 0xffffff, 1);
      g.rect(9, 0, 3, 6, c.main); g.rect(9, 15, 3, 6, c.main);
      g.rect(0, 9, 6, 3, c.main); g.rect(15, 9, 6, 3, c.main);
      g.px(10, 10, 0xffffff);
      g.outline(-0.8);
    });
  }

  // ───────────────────────────── PLAYERS ─────────────────────────────

  private makeShooters(): void {
    for (const p of this.players) {
      const left = p % 2 === 0, top = p < 2;
      const gunX = this.vw * (left ? 0.3 : 0.7), gunY = top ? this.top - 44 : this.bottom + 44;
      const gun = this.add.image(gunX, gunY, this.gunKey(p)).setScale(S).setDepth(300).setOrigin(0.3, 0.5);
      const cx = this.vw * (left ? 0.3 : 0.7), cy = top ? this.top + 50 : this.bottom - 50;
      const cross = this.add.image(cx, cy, this.crossKey(p)).setScale(S).setDepth(900);
      const crossNum = txt(this, cx, cy, `${p + 1}`, { size: 10, color: toCss(PLAYER_COLORS[p].light), strokeWidth: 3 }).setDepth(901).setAngle(this.angleFor(p));
      const reload = this.add.graphics().setDepth(899);
      const s: Shooter = {
        p, cx, cy, cool: 0, stun: 0, streak: 0, hits: 0, shots: 0, gunX, gunY, gun, cross, crossNum, reload,
        skill: 0.45 + Math.random() * 0.45, think: 0, wantFire: false,
      };
      if (!this.isCpu(p)) {
        s.btn = new TouchButton(this, this.touch, p, 0.84, 0.72, 'fire', 16);
        s.btn.onPress = () => this.fire(s);
        s.stick = new DragStick(this, this.touch, p, 34);
        s.stick.exclude = [s.btn];
      }
      this.shooters.push(s);
    }
  }

  private fire(s: Shooter): void {
    if (this.state !== 'play' || s.cool > 0 || s.stun > 0) return;
    s.cool = COOLDOWN;
    s.shots++;
    const ang = Math.atan2(s.cy - s.gunY, s.cx - s.gunX);
    const mx = s.gunX + Math.cos(ang) * 34, my = s.gunY + Math.sin(ang) * 34;
    const dur = Math.hypot(s.cx - mx, s.cy - my) / BUBBLE_SPEED;
    const img = this.add.image(mx, my, 'target-blast-bubble').setScale(S * 0.6).setDepth(850);
    this.bubbles.push({ p: s.p, x0: mx, y0: my, x1: s.cx, y1: s.cy, t: 0, dur, img });
    Audio.sfx('shoot', 1.2 + s.p * 0.1);
    Vfx.squash(this, s.gun, 0.75, 1.25, 120);
    burst(this, mx, my, { tex: 'dot2', count: 5, tint: [0xbfeaff, 0xffffff], speed: [30, 80], life: 250 });
  }

  // ───────────────────────────── TARGETS ─────────────────────────────

  private pickKind(): Kind {
    const r = this.rand();
    const gold = this.fever ? 0.16 : 0.06;
    if (r < gold) return 'gold';
    if (r < gold + 0.15) return 'bomb';
    if (r < gold + 0.33) return 'teacher';
    if (r < gold + 0.55) return 'can';
    return 'duck';
  }

  private spawn(lane: number, x?: number): void {
    const L = this.lanes[lane];
    const kind = this.pickKind();
    const k = KINDS[kind];
    const sx = x ?? (L.dir > 0 ? -20 : this.vw + 20);
    const key = kind === 'bomb' ? 'target-blast-bomb' : `target-blast-${kind}`;
    const shadow = this.add.image(sx, L.y + 8, 'shadow').setScale(S * 0.8, S * 0.5).setAlpha(0.25).setDepth(-50);
    let img: Phaser.GameObjects.Image;
    if (kind === 'bomb') {
      const spr = this.add.sprite(sx, L.y, key, 0).setScale(S).setDepth(100 + lane);
      spr.play('target-blast-fuse');
      img = spr;
    } else img = this.add.image(sx, L.y, key).setScale(S).setDepth(100 + lane);
    if (kind === 'duck' || kind === 'gold') img.setFlipX(L.dir < 0);
    if (kind === 'teacher' && this.rand() < 0.5) img.setAngle(180);
    const t: Target = { kind, lane, x: sx, y: L.y, vx: L.dir * L.speed * k.speed, img, shadow, alive: true, t: 0, bob: this.rand() * 6 };
    if (kind === 'teacher') { t.img.setScale(S, 0); this.tweens.add({ targets: t.img, scaleY: S, duration: 260, ease: 'Back.easeOut' }); }
    this.targets.push(t);
  }

  private hitAt(b: Bubble): void {
    const s = this.shooters.find((x) => x.p === b.p)!;
    let best: Target | undefined;
    let bd = Infinity;
    for (const t of this.targets) {
      if (!t.alive) continue;
      const d = Math.hypot(t.x - b.x1, t.y - b.y1);
      if (d < KINDS[t.kind].r + 9 && d < bd) { bd = d; best = t; }
    }
    const ang = this.angleFor(b.p);
    const col = toCss(PLAYER_COLORS[b.p].light);
    if (!best) {
      s.streak = 0;
      Audio.sfx('pop', 0.8);
      burst(this, b.x1, b.y1, { tex: 'dot2', count: 7, tint: [0xbfeaff, 0xffffff], speed: [30, 90], life: 300 });
      return;
    }
    best.alive = false;
    const k = KINDS[best.kind];
    if (best.kind === 'bomb') {
      s.streak = 0;
      s.stun = 1.1;
      this.addScore(b.p, k.pts);
      Vfx.explosion(this, best.x, best.y, 0.6);
      Audio.sfx('explode');
      Vfx.popText(this, best.x, best.y - 10, `${k.pts} ตูม!`, '#ff7a85', 20, ang);
      best.img.destroy();
      best.shadow.destroy();
      return;
    }
    s.hits++;
    s.streak++;
    const mult = s.streak >= 6 ? 2 : 1;
    const pts = k.pts * mult;
    this.addScore(b.p, pts);
    Audio.sfx(best.kind === 'gold' ? 'power' : best.kind === 'teacher' ? 'right' : 'coin', 1 + b.p * 0.08);
    Vfx.hit(this, best.x, best.y, [0xffffff, PLAYER_COLORS[b.p].light, 0xbfeaff]);
    if (best.kind === 'gold') { Vfx.confetti(this, best.x, best.y, 30); Vfx.sparkle(this, best.x, best.y); }
    Vfx.popText(this, best.x, best.y + (ang === 180 ? 16 : -16), `+${pts}${mult > 1 ? ' x2' : ''}`, best.kind === 'gold' ? '#ffe066' : col, best.kind === 'gold' ? 22 : 17, ang);
    if (s.streak === 6) Vfx.popText(this, s.cx, s.cy + (ang === 180 ? -26 : 26), 'STREAK x2!', '#ffe066', 14, ang);
    // knocked-over animation
    const img = best.img, sh = best.shadow;
    this.tweens.add({ targets: img, scaleY: 0, angle: img.angle + (best.vx > 0 ? 25 : -25), y: img.y + 6, duration: 260, ease: 'Quad.easeIn', onComplete: () => img.destroy() });
    this.tweens.add({ targets: sh, alpha: 0, duration: 260, onComplete: () => sh.destroy() });
    burst(this, best.x, best.y + 6, { tex: 'dot2', count: 8, tint: [0xbfeaff, 0xffffff], speed: [40, 110], angle: [200, 340], gravity: 300, life: 450 });
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const L of this.lanes) L.water.tilePositionX -= L.dir * L.speed * 0.35 * dt;
    const pal = [0xffe066, 0xff7a85, 0x7ee8b0, 0x6ec6ff];
    this.bulbs.forEach((b, i) => {
      const ph = (Math.floor(this.t * 4) + i) % 3;
      b.setTint(pal[(i + Math.floor(this.t * 2)) % 4]).setAlpha(ph === 0 ? 1 : 0.45);
    });
    this.flags.forEach((f, i) => f.setAngle(Math.sin(this.t * 3 + i) * 8));
    for (const t of this.targets) {
      if (!t.alive) continue;
      t.bob += dt * 3;
      t.img.y = t.y + Math.sin(t.bob) * 1.5;
      if (t.kind === 'can') t.img.setAngle(Math.sin(t.bob * 1.3) * 8);
      if (t.kind === 'duck' || t.kind === 'gold') t.img.setAngle(Math.sin(t.bob) * 4);
    }
    for (const s of this.shooters) {
      if (!this.isCpu(s.p) && s.stick && this.state === 'play' && s.stun <= 0) {
        s.cx += s.stick.vx * CROSS_SPEED * dt;
        s.cy += s.stick.vy * CROSS_SPEED * dt;
      }
      s.cx = Phaser.Math.Clamp(s.cx, 16, this.vw - 16);
      s.cy = Phaser.Math.Clamp(s.cy, this.top + 6, this.bottom - 6);
      const jit = s.stun > 0 ? (Math.random() - 0.5) * 6 : 0;
      s.cross.setPosition(s.cx + jit, s.cy + jit).setAlpha(s.cool > 0 || s.stun > 0 ? 0.55 : 1).setAngle(s.stun > 0 ? this.t * 600 : 0);
      s.crossNum.setPosition(s.cx + (this.angleFor(s.p) === 180 ? -16 : 16), s.cy + (this.angleFor(s.p) === 180 ? -16 : 16));
      s.gun.setRotation(Math.atan2(s.cy - s.gunY, s.cx - s.gunX));
      s.reload.clear();
      if (s.cool > 0) {
        s.reload.lineStyle(3, PLAYER_COLORS[s.p].light, 0.9);
        s.reload.beginPath();
        s.reload.arc(s.cx, s.cy, 25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - s.cool / COOLDOWN));
        s.reload.strokePath();
      }
    }
  }

  tick(dt: number): void {
    if (!this.fever && this.timeLeft <= 15) {
      this.fever = true;
      Audio.sfx('power');
      for (const [deg, y] of [[0, this.vh * 0.62], [180, this.vh * 0.38]] as const) {
        const tx = txt(this, this.vw / 2, y, 'เป้าทองเพียบ! GOLD RUSH!', { size: 26, color: '#ffe066', strokeWidth: 7 }).setAngle(deg).setDepth(3000);
        this.tweens.add({ targets: tx, scale: { from: 0.3, to: 1 }, duration: 300, ease: 'Back.easeOut' });
        this.tweens.add({ targets: tx, alpha: 0, delay: 1300, duration: 300, onComplete: () => tx.destroy() });
      }
    }
    const ramp = 1 + this.elapsed / 45;
    this.lanes.forEach((L, i) => {
      L.next -= dt * ramp;
      if (L.next <= 0) {
        this.spawn(i);
        L.next = 1.4 + this.rand() * 1.4;
      }
    });
    for (const t of this.targets) {
      if (!t.alive) continue;
      t.x += t.vx * dt * (1 + this.elapsed / 90);
      t.img.x = t.x;
      t.shadow.setPosition(t.x, t.y + 9);
      if (t.kind === 'gold' && Math.random() < 0.3) burst(this, t.x + (Math.random() - 0.5) * 20, t.y, { tex: 'spark', count: 1, tint: [0xffe066, 0xffffff], speed: [5, 20], life: 400 });
      if (Math.random() < 0.08) {
        const w = this.add.image(t.x - Math.sign(t.vx) * 14, t.y + 8, 'target-blast-wake').setScale(S).setAlpha(0.6).setDepth(-60);
        this.tweens.add({ targets: w, alpha: 0, x: w.x - Math.sign(t.vx) * 10, duration: 500, onComplete: () => w.destroy() });
      }
      if (t.x < -40 || t.x > this.vw + 40) {
        t.alive = false;
        t.img.destroy();
        t.shadow.destroy();
      }
    }
    this.targets = this.targets.filter((t) => t.alive || t.img.active);
    for (const b of this.bubbles) {
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const arc = Math.sin(k * Math.PI) * 10;
      b.img.setPosition(b.x0 + (b.x1 - b.x0) * k, b.y0 + (b.y1 - b.y0) * k - arc).setScale(S * (0.6 + k * 0.6));
      if (k >= 1) {
        b.img.destroy();
        this.hitAt(b);
      }
    }
    this.bubbles = this.bubbles.filter((b) => b.t < b.dur);
    for (const s of this.shooters) {
      s.cool = Math.max(0, s.cool - dt);
      s.stun = Math.max(0, s.stun - dt);
      if (this.isCpu(s.p)) this.bot(s, dt);
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(s: Shooter, dt: number): void {
    s.think -= dt;
    if (s.think <= 0) {
      s.think = 0.12 + (1 - s.skill) * 0.25 + Math.random() * 0.1;
      let best: { x: number; y: number; target?: Target } | undefined;
      let bv = -Infinity;
      const speedMul = 1 + this.elapsed / 90;
      for (const t of this.targets) {
        if (!t.alive || t.kind === 'bomb') continue;
        const k = KINDS[t.kind];
        const d = Math.hypot(t.x - s.cx, t.y - s.cy);
        const tMove = d / (CROSS_SPEED * 0.9);
        const tFly = Math.hypot(t.x - s.gunX, t.y - s.gunY) / BUBBLE_SPEED;
        const px = t.x + t.vx * speedMul * (tMove + tFly + 0.1);
        if (px < 20 || px > this.vw - 20) continue;
        // avoid targets travelling right next to a bomb
        const bombNear = this.targets.some((o) => o.alive && o.kind === 'bomb' && o.lane === t.lane && Math.abs(o.x - t.x) < 34);
        const v = k.pts / (1 + d / 170) - (bombNear ? 2 : 0) + Math.random() * 0.4;
        if (v > bv) { bv = v; best = { x: px, y: t.y, target: t }; }
      }
      s.goal = best;
    }
    const g = s.goal;
    if (!g || s.stun > 0) return;
    // track the target: re-lead every frame
    let gx = g.x, gy = g.y;
    if (g.target && g.target.alive) {
      const tFly = Math.hypot(g.target.x - s.gunX, g.target.y - s.gunY) / BUBBLE_SPEED;
      gx = g.target.x + g.target.vx * (1 + this.elapsed / 90) * tFly;
      gy = g.target.y;
    }
    const err = (1 - s.skill) * 14;
    gx += Math.sin(this.t * 3 + s.p * 2) * err;
    const dx = gx - s.cx, dy = gy - s.cy;
    const d = Math.hypot(dx, dy);
    const m = Math.min(1, d / 26);
    if (d > 0.5) { s.cx += (dx / d) * m * CROSS_SPEED * 0.92 * dt; s.cy += (dy / d) * m * CROSS_SPEED * 0.92 * dt; }
    if (d < 8 + (1 - s.skill) * 8 && s.cool <= 0 && Math.random() < 0.25 + s.skill * 0.3) this.fire(s);
  }
}

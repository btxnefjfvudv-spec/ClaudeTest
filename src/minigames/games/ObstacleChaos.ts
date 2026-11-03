import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const R = 214;
const HUB = 34;
const BROOM_IN = 38;
const BROOM_OUT = 156;
const HAMMER_PIVOT = 118;
const HAMMER_ARM = 66;
const HEAD_R = 15;
const POST_R = 11;
const BUMPER_R = 19;
const BASE_R = 30;
const BASE_DIST = R - 42;
const WIN = 3;

interface Hammer { px: number; py: number; a: number; w: number; arm: Phaser.GameObjects.Image; post: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }
interface Bumper { x: number; y: number; img: Phaser.GameObjects.Sprite; lit: number }

type FlagState = 'home' | 'carried' | 'loose' | 'respawn';

/** #4 — Grab the flag in the middle of a machine arena and carry it home. */
export default class ObstacleChaos extends BaseMinigame {
  private kit!: ArenaKit;
  private cx = 0;
  private cy = 0;
  private broomA = 0;
  private broomW = 1;
  private broomFlipT = 0;
  private broom!: Phaser.GameObjects.Image;
  private broomShadow!: Phaser.GameObjects.Image;
  private hammers: Hammer[] = [];
  private bumpers: Bumper[] = [];
  private flag!: Phaser.GameObjects.Sprite;
  private flagShadow!: Phaser.GameObjects.Image;
  private flagState: FlagState = 'home';
  private flagX = 0;
  private flagY = 0;
  private flagZ = 0;
  private carrier: PlayerIndex | -1 = -1;
  private flagT = 0;
  private carryTime = [0, 0, 0, 0];
  private baseStars: Phaser.GameObjects.Image[][] = [];
  private bulbs: Phaser.GameObjects.Image[] = [];
  private spots: Phaser.GameObjects.Image[] = [];
  private t = 0;

  constructor() {
    super(CATALOG['obstacle-chaos']);
  }

  private baseOf(p: PlayerIndex): { x: number; y: number } {
    const a = [225, 315, 135, 45][p] * (Math.PI / 180);
    return { x: this.cx + Math.cos(a) * BASE_DIST, y: this.cy + Math.sin(a) * BASE_DIST };
  }

  setup(): void {
    this.cx = this.vw / 2;
    this.cy = this.vh / 2;
    this.broomA = -Math.PI / 2;
    this.broomW = 1.0;
    this.broomFlipT = 9;
    this.hammers = [];
    this.bumpers = [];
    this.baseStars = [];
    this.bulbs = [];
    this.spots = [];
    this.carrier = -1;
    this.flagState = 'home';
    this.flagT = 0;
    this.carryTime = [0, 0, 0, 0];
    this.t = 0;
    this.paintArt();
    this.buildStage();
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 900, radius: 12, dashSpeed: 380, dashCooldown: 1.1, bounce: 0.7,
      spawn: (p) => this.baseOf(p),
    });
    this.kit.dashHit = 1.25;
    this.kit.canDash = (b) => this.carrier !== b.p;
    this.kit.onBump = (a, b) => {
      if (this.carrier === a.p && b.dashT > 0) this.dropFlag(a, b.p);
      else if (this.carrier === b.p && a.dashT > 0) this.dropFlag(b, a.p);
    };
    for (const b of this.kit.bodies) { b.data.skill = 0.5 + Math.random() * 0.45; b.data.wait = 0; b.data.jit = Math.random() * 6; }
    this.flagShadow = this.add.image(this.cx, this.cy, 'shadow').setScale(S * 0.5).setAlpha(0.3);
    this.flag = this.add.sprite(this.cx, this.cy, 'obstacle-chaos-flag', 0).setOrigin(0.2, 1).setScale(S);
    this.flag.play('obstacle-chaos-wave');
    this.homeFlag();
    this.refresh();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const ccx = this.vw / 2 / S, ccy = this.vh / 2 / S, rr = R / S;
    makeTexture(this, `obstacle-chaos-stage-${aw}`, aw, ah, (p) => {
      // studio floor: dark checker
      for (let y = 0; y < ah; y += 12) for (let x = 0; x < aw; x += 12) p.rect(x, y, 12, 12, ((x + y) / 12) % 2 ? 0x2b2f5e : 0x262a54);
      const r = rng(5);
      for (let i = 0; i < 300; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), 0x30356a);
      // arena shadow
      p.ellipse(ccx + 3, ccy + 5, rr + 6, rr + 6, 0x14172e);
      // padded wall ring: red/white segments
      const segs = 32;
      for (let y = Math.floor(ccy - rr - 6); y <= ccy + rr + 6; y++) for (let x = Math.floor(ccx - rr - 6); x <= ccx + rr + 6; x++) {
        const dx = x + 0.5 - ccx, dy = y + 0.5 - ccy;
        const d = Math.hypot(dx, dy);
        if (d > rr + 5 || d < rr - 2) continue;
        const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
        const seg = Math.floor(a * segs) % 2;
        let c = seg ? 0xff5a6e : 0xfff1f0;
        if (d > rr + 3.5) c = shift(c, -0.45);
        else if (d < rr - 0.5) c = shift(c, 0.2);
        else if (dy > 0) c = shift(c, -0.15);
        p.px(x, y, c);
      }
      // foam floor: alternating ring bands and wedge seams
      for (let y = Math.floor(ccy - rr); y <= ccy + rr; y++) for (let x = Math.floor(ccx - rr); x <= ccx + rr; x++) {
        const dx = x + 0.5 - ccx, dy = y + 0.5 - ccy;
        const d = Math.hypot(dx, dy);
        if (d >= rr - 2) continue;
        const a = (Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2);
        const band = Math.floor(d / 13);
        const wedge = Math.floor(a * 16);
        let c = (band + wedge) % 2 ? 0x9fe8d0 : 0xc8f4e2;
        if (d < 22) c = (wedge % 2) ? 0xffe9a8 : 0xfff3c9;
        const fa = a * 16 - wedge;
        if (fa < 0.04 * (40 / Math.max(10, d))) c = shift(c, -0.18);
        if (d % 13 < 0.9) c = shift(c, -0.14);
        p.px(x, y, c);
      }
      // hazard stripes around the hub
      for (let y = Math.floor(ccy - 20); y <= ccy + 20; y++) for (let x = Math.floor(ccx - 20); x <= ccx + 20; x++) {
        const d = Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy);
        if (d > 19 || d < 16.5) continue;
        p.px(x, y, (Math.floor((x + y) / 2) % 2) ? 0x2b2f5e : 0xffc93d);
      }
    });
    // bases (player coloured pads)
    for (const pl of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[pl];
      makeTexture(this, `obstacle-chaos-base-${pl}`, 34, 28, (p) => {
        p.ellipse(17, 15, 16.5, 12, shift(c.main, -0.55));
        p.ellipse(17, 13, 16, 11.5, c.dark);
        p.ellipse(17, 13, 14, 9.5, c.main);
        p.ellipse(17, 12, 10, 6, c.light);
        p.ellipse(17, 13, 6, 3.5, c.main);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          p.px(17 + Math.cos(a) * 12.5, 13 + Math.sin(a) * 8.5, 0xffffff);
        }
      });
    }
    makeTexture(this, 'obstacle-chaos-star', 9, 9, (p) => {
      p.stamp(0, 0, ['....a....', '...aba...', 'aaaabaaaa', '.abbbbba.', '..abbba..', '.abbabba.', '.aba.aba.', 'aa.....aa', '.........'], { a: 0xb3861a, b: 0xffe066 });
    });
    // flag (3-frame wave)
    makeSheet(this, 'obstacle-chaos-flag', 16, 24, 3, (p, i) => {
      p.rect(1, 2, 2, 22, 0x8a8fa8);
      p.vline(1, 2, 22, 0xd8dbe4);
      p.ball(2, 2, 2, 2, 0xffe066);
      for (let x = 0; x < 12; x++) {
        const wy = Math.round(Math.sin(x / 2.2 + i * 2.1) * 1.2);
        for (let y = 0; y < 9; y++) {
          const chk = (Math.floor(x / 3) + Math.floor(y / 3)) % 2;
          let c = chk ? 0xffe066 : 0xff9f43;
          if (y === 0) c = shift(c, 0.3);
          if (y === 8) c = shift(c, -0.3);
          p.px(3 + x, 4 + y + wy, c);
        }
      }
      p.outline(-0.75);
    });
    if (!this.anims.exists('obstacle-chaos-wave')) {
      this.anims.create({ key: 'obstacle-chaos-wave', frames: this.anims.generateFrameNumbers('obstacle-chaos-flag', {}), frameRate: 8, repeat: -1 });
    }
    // hub pedestal
    makeTexture(this, 'obstacle-chaos-hub', 30, 26, (p) => {
      p.ellipse(15, 15, 14.5, 10, 0x4a4f72);
      p.ellipse(15, 12, 14, 9.5, 0x8f98a8);
      p.ellipse(15, 11, 12, 7.5, 0xc6cdd9);
      p.ellipse(15, 11, 7, 4, 0x8f98a8);
      p.ellipse(14, 10, 5, 2.5, 0xe8edf4);
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; p.px(15 + Math.cos(a) * 10.5, 11.5 + Math.sin(a) * 6.5, 0x5d6584); }
      p.outline(-0.7);
    });
    // giant broom: transparent inner gap, handle, bristles at the far end
    const bl = Math.round(BROOM_OUT / S) + 4;
    makeTexture(this, 'obstacle-chaos-broom', bl, 18, (p) => {
      const g = Math.round(BROOM_IN / S) - 6;
      p.rect(g, 7, bl - g - 20, 4, 0xc0834a);
      p.hline(g, 7, bl - g - 20, 0xe8b07a);
      p.hline(g, 10, bl - g - 20, 0x8a5530);
      for (let x = g + 6; x < bl - 22; x += 9) p.vline(x, 7, 4, 0xa86f3c);
      // band
      p.rect(bl - 24, 5, 4, 8, 0xff5a6e);
      p.vline(bl - 24, 5, 8, 0xffb3bd);
      // bristles
      for (let y = 1; y < 17; y++) {
        const len = 18 - Math.abs(y - 9) * 0.4;
        for (let x = 0; x < len; x++) {
          const c = (y + x) % 3 === 0 ? 0xd4a24a : (y % 2 ? 0xf0c86a : 0xe2b456);
          p.px(bl - 21 + x, y, x === Math.floor(len) - 1 ? 0xb3832e : c);
        }
      }
      p.outline(-0.75);
    });
    makeTexture(this, 'obstacle-chaos-broom-shadow', bl, 18, (p) => {
      const g = Math.round(BROOM_IN / S) - 6;
      p.rect(g, 7, bl - g - 20, 4, 0x000000);
      p.rect(bl - 22, 1, 20, 16, 0x000000);
    });
    // hammer arm + toy mallet head
    const hl = Math.round((HAMMER_ARM + HEAD_R) / S) + 2;
    makeTexture(this, 'obstacle-chaos-hammer', hl, 24, (p) => {
      p.rect(0, 10, hl - 10, 4, 0x8f98a8);
      p.hline(0, 10, hl - 10, 0xd8dbe4);
      p.hline(0, 13, hl - 10, 0x5d6584);
      const hx = hl - 15;
      p.box(hx, 0, 14, 24, 0xff5a3d, 1);
      p.rect(hx + 2, 2, 10, 4, 0xffffff);
      p.rect(hx + 2, 18, 10, 4, 0xffffff);
      p.hline(hx + 2, 2, 10, 0xfff1f0);
      p.rect(hx + 1, 9, 12, 6, 0xffc93d);
      p.hline(hx + 1, 9, 12, 0xffe9a8);
      p.outline(-0.75);
    });
    makeTexture(this, 'obstacle-chaos-hammer-shadow', hl, 24, (p) => {
      p.rect(0, 10, hl - 10, 4, 0x000000);
      p.rect(hl - 15, 0, 14, 24, 0x000000);
    });
    makeTexture(this, 'obstacle-chaos-post', 16, 16, (p) => {
      p.ball(8, 8, 7.5, 7.5, 0x8f98a8);
      p.ball(8, 8, 4, 4, 0xffc93d);
      p.px(7, 7, 0xffffff);
      p.outline(-0.75);
    });
    makeSheet(this, 'obstacle-chaos-bumper', 24, 22, 2, (p, i) => {
      p.ellipse(12, 13, 11.5, 8.5, 0x3a2a6a);
      p.ellipse(12, 11, 11, 8, i ? 0xffffff : 0x8455d6);
      p.ellipse(12, 10, 9, 6.2, i ? 0xfff1a8 : 0xb8a6ff);
      p.ellipse(12, 10, 5.5, 3.6, i ? 0xffe066 : 0xff7a85);
      p.ellipse(11, 9, 2.5, 1.4, 0xffffff);
      p.outline(-0.7);
    });
    makeSheet(this, 'obstacle-chaos-bulb', 5, 5, 2, (p, i) => {
      p.ball(2.5, 2.5, 2.3, 2.3, i ? 0xfff1a8 : 0xff9f43);
      if (i) p.px(2, 1, 0xffffff);
    });
    makeTexture(this, 'obstacle-chaos-spot', 64, 40, (p) => {
      for (let y = 0; y < 40; y++) for (let x = 0; x < 64; x++) {
        const d = Math.hypot((x - 32) / 32, (y - 20) / 20);
        if (d < 1) p.px(x, y, 0xfff1c9, Math.round((1 - d) * (1 - d) * 70));
      }
    });
  }

  private buildStage(): void {
    const aw = Math.ceil(this.vw / S);
    this.add.image(0, 0, `obstacle-chaos-stage-${aw}`).setOrigin(0).setScale(S).setDepth(-200);
    // sweeping spotlights
    for (let i = 0; i < 3; i++) {
      const s = this.add.image(this.cx, this.cy, 'obstacle-chaos-spot').setScale(S * 1.6).setDepth(-150).setBlendMode(Phaser.BlendModes.ADD);
      s.setData('ph', i * 2.1);
      this.spots.push(s);
    }
    // marquee bulbs around the arena
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2;
      const b = this.add.image(this.cx + Math.cos(a) * (R + 16), this.cy + Math.sin(a) * (R + 16), 'obstacle-chaos-bulb', 0).setScale(S).setDepth(-140);
      this.bulbs.push(b);
    }
    // bases with score stars
    for (const p of this.players) {
      const b = this.baseOf(p);
      this.add.image(b.x, b.y, `obstacle-chaos-base-${p}`).setScale(S).setDepth(-120);
      const stars: Phaser.GameObjects.Image[] = [];
      for (let k = 0; k < WIN; k++) {
        const a = Math.atan2(b.y - this.cy, b.x - this.cx) + (k - 1) * 0.16;
        stars.push(this.add.image(this.cx + Math.cos(a) * (R - 12), this.cy + Math.sin(a) * (R - 12), 'obstacle-chaos-star').setScale(S).setDepth(-110).setAlpha(0.25).setTint(0x666688));
      }
      this.baseStars[p] = stars;
    }
    this.add.image(this.cx, this.cy + 2, 'obstacle-chaos-hub').setScale(S).setDepth(this.cy - 30);
    // broom
    this.broomShadow = this.add.image(this.cx + 6, this.cy + 10, 'obstacle-chaos-broom-shadow').setOrigin(0, 0.5).setScale(S).setDepth(-100).setAlpha(0.22);
    this.broom = this.add.image(this.cx, this.cy, 'obstacle-chaos-broom').setOrigin(0, 0.5).setScale(S).setDepth(-90);
    // hammers
    for (const side of [-1, 1]) {
      const px = this.cx + side * HAMMER_PIVOT, py = this.cy;
      const shadow = this.add.image(px + 6, py + 12, 'obstacle-chaos-hammer-shadow').setOrigin(0, 0.5).setScale(S).setAlpha(0.22).setDepth(-95);
      const arm = this.add.image(px, py - 10, 'obstacle-chaos-hammer').setOrigin(0, 0.5).setScale(S).setDepth(600);
      const post = this.add.image(px, py - 10, 'obstacle-chaos-post').setScale(S).setDepth(601);
      this.hammers.push({ px, py, a: side < 0 ? 0 : Math.PI / 2, w: side < 0 ? 2.1 : -1.75, arm, post, shadow });
    }
    for (const side of [-1, 1]) {
      const x = this.cx, y = this.cy + side * 122;
      const img = this.add.sprite(x, y, 'obstacle-chaos-bumper', 0).setScale(S).setDepth(y - 5);
      this.bumpers.push({ x, y, img, lit: 0 });
    }
  }

  // ───────────────────────────── FLAG ─────────────────────────────

  private homeFlag(): void {
    this.flagState = 'home';
    this.flagX = this.cx;
    this.flagY = this.cy + 2;
    this.flagZ = 22;
    this.carrier = -1;
    this.flag.setVisible(true).setAlpha(1);
  }

  private pickUp(b: ArenaBody): void {
    this.flagState = 'carried';
    this.carrier = b.p;
    b.speedMul = 0.72;
    Audio.sfx('coin', 1 + b.p * 0.1);
    Vfx.sparkle(this, b.x, b.y - 40);
    Vfx.popText(this, b.x, b.y - 70, 'ได้ธง!', toCss(PLAYER_COLORS[b.p].light), 16, this.angleFor(b.p));
  }

  private dropFlag(b: ArenaBody, by: PlayerIndex | -1): void {
    if (this.carrier !== b.p) return;
    this.carrier = -1;
    b.speedMul = 1;
    this.flagState = 'loose';
    this.flagT = 0.45;
    const a = Math.random() * Math.PI * 2;
    let tx = b.x + Math.cos(a) * 44, ty = b.y + Math.sin(a) * 44;
    const d = Math.hypot(tx - this.cx, ty - this.cy);
    if (d > R - 30) { tx = this.cx + ((tx - this.cx) / d) * (R - 30); ty = this.cy + ((ty - this.cy) / d) * (R - 30); }
    const sx = b.x, sy = b.y;
    this.tweens.addCounter({ from: 0, to: 1, duration: 420, ease: 'Linear', onUpdate: (tw) => {
      const u = tw.getValue() ?? 0;
      this.flagX = sx + (tx - sx) * u;
      this.flagY = sy + (ty - sy) * u;
      this.flagZ = Math.sin(u * Math.PI) * 46;
    }, onComplete: () => { this.flagZ = 0; } });
    Audio.sfx('throw', 0.9);
    Vfx.popText(this, b.x, b.y - 60, 'ธงหลุด!', '#ffffff', 15, this.angleFor(b.p));
    if (by !== -1) Audio.sfx('bigHit');
  }

  private scoreFlag(b: ArenaBody): void {
    this.carrier = -1;
    b.speedMul = 1;
    this.addScore(b.p, 1);
    this.flagState = 'respawn';
    this.flagT = 1.4;
    this.flag.setVisible(false);
    const base = this.baseOf(b.p);
    Audio.sfx('power', 1 + b.p * 0.08);
    Audio.sfx('explode', 1.4);
    Vfx.confetti(this, base.x, base.y - 20, 50);
    Vfx.flash(this, PLAYER_COLORS[b.p].main, 120);
    b.avatar.play('cheer', true);
    const star = this.baseStars[b.p]?.[this.score[b.p] - 1];
    if (star) { star.clearTint().setAlpha(1); this.tweens.add({ targets: star, scale: { from: S * 2.4, to: S }, duration: 380, ease: 'Back.easeOut' }); }
    for (const [deg, y] of [[0, this.vh * 0.64], [180, this.vh * 0.36]] as const) {
      const t = txt(this, this.vw / 2, y, `P${b.p + 1} ทำแต้ม! ${this.score[b.p]}/${WIN}`, { size: 26, color: toCss(PLAYER_COLORS[b.p].light), strokeWidth: 6 }).setAngle(deg).setDepth(3000);
      this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 280, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
    }
    this.refresh();
    if (this.score[b.p] >= WIN) this.time.delayedCall(400, () => this.finish());
  }

  private refresh(): void {
    for (const p of this.players) this.hudText[p] = `${this.score[p]}/${WIN}`;
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    const playing = this.state === 'play';
    this.kit.update(dt, playing);
    if (playing || this.state === 'countdown' || this.state === 'intro') this.spinMachines(dt, playing);
    this.collideStatics();
    // visuals
    this.spots.forEach((s) => {
      const ph = s.getData('ph') as number;
      s.setPosition(this.cx + Math.cos(this.t * 0.5 + ph) * 190, this.cy + Math.sin(this.t * 0.37 + ph * 1.3) * 150);
    });
    this.bulbs.forEach((b, i) => b.setFrame((Math.floor(this.t * 6) + i) % 3 === 0 ? 1 : 0));
    for (const bm of this.bumpers) {
      bm.lit = Math.max(0, bm.lit - dt);
      bm.img.setFrame(bm.lit > 0 ? 1 : 0);
    }
    // flag follows its carrier
    if (this.flagState === 'carried') {
      const b = this.kit.body(this.carrier as PlayerIndex);
      if (b) { this.flagX = b.x - 6 * b.avatar.facing; this.flagY = b.y + 1; this.flagZ = 54; }
      if (Math.random() < dt * 12) burst(this, this.flagX, this.flagY - this.flagZ - 10, { tex: 'spark', count: 1, tint: [0xffe066, 0xffffff], speed: [10, 40], life: 400 });
    } else if (this.flagState === 'home') {
      this.flagZ = 22 + Math.sin(this.t * 3) * 3;
    }
    this.flag.setPosition(this.flagX, this.flagY - this.flagZ).setDepth(this.flagY + (this.flagState === 'carried' ? 2 : 1));
    this.flagShadow.setPosition(this.flagX, this.flagY).setDepth(this.flagY - 900).setVisible(this.flag.visible && this.flagState !== 'carried');
  }

  private spinMachines(dt: number, playing: boolean): void {
    const speedUp = playing ? 1 + Math.min(0.6, this.elapsed / 90) : 0.5;
    if (playing) {
      this.broomFlipT -= dt;
      if (this.broomFlipT <= 0) {
        this.broomW = -this.broomW;
        this.broomFlipT = 7 + Math.random() * 5;
        Audio.sfx('whoosh', 0.6);
      }
    }
    this.broomA += this.broomW * 1.05 * speedUp * dt;
    this.broom.setPosition(this.cx, this.cy - 6).setRotation(this.broomA);
    this.broomShadow.setPosition(this.cx + 5, this.cy + 6).setRotation(this.broomA);
    for (const h of this.hammers) {
      h.a += h.w * speedUp * dt;
      h.arm.setRotation(h.a);
      h.shadow.setRotation(h.a);
    }
    if (!playing) return;
    const bw = this.broomW * 1.05 * speedUp;
    for (const b of this.kit.alive) {
      // broom sweep
      const ux = Math.cos(this.broomA), uy = Math.sin(this.broomA);
      const rx = b.x - this.cx, ry = b.y - this.cy;
      const along = rx * ux + ry * uy;
      const perp = -rx * uy + ry * ux;
      if (along > BROOM_IN && along < BROOM_OUT + 8 && Math.abs(perp) < b.r + (along > BROOM_OUT - 40 ? 18 : 8) && b.invuln <= 0) {
        // bar moves toward +perp when rotating positive
        const dir = Math.sign(bw) || 1;
        if (perp * dir > -4) {
          const v = Math.abs(bw) * along;
          const tx = -uy * dir, ty = ux * dir;
          b.x += tx * (b.r + 20 - perp * dir) * 0.5;
          b.y += ty * (b.r + 20 - perp * dir) * 0.5;
          b.vx = tx * (v + 260) + ux * 60;
          b.vy = ty * (v + 260) + uy * 60;
          b.stun = 0.45;
          b.invuln = 0.5;
          this.hitFx(b, 'ไม้กวาด!');
        }
      }
      // hammers
      for (const h of this.hammers) {
        const hx = h.px + Math.cos(h.a) * HAMMER_ARM, hy = h.py + Math.sin(h.a) * HAMMER_ARM;
        const d = Math.hypot(b.x - hx, b.y - hy);
        if (d < HEAD_R + b.r && b.invuln <= 0) {
          const tx = -Math.sin(h.a) * Math.sign(h.w), ty = Math.cos(h.a) * Math.sign(h.w);
          const nx = (b.x - hx) / (d || 1), ny = (b.y - hy) / (d || 1);
          b.vx = (tx * 0.7 + nx * 0.5) * 520;
          b.vy = (ty * 0.7 + ny * 0.5) * 520;
          b.stun = 0.7;
          b.invuln = 0.6;
          this.hitFx(b, 'โป๊ก!');
          Vfx.shake(this, 0.008, 160);
        }
      }
    }
  }

  private hitFx(b: ArenaBody, word: string): void {
    Audio.sfx('bigHit', 1 + b.p * 0.05);
    Audio.sfx('stun', 1 + b.p * 0.1);
    Vfx.hit(this, b.x, b.y - 20);
    Vfx.hitFlash(this, b.avatar.sprite);
    Vfx.popText(this, b.x, b.y - 56, word, '#ffffff', 15, this.angleFor(b.p));
    this.dropFlag(b, -1);
  }

  /** Circular arena wall, machine posts and bumpers. */
  private collideStatics(): void {
    for (const b of this.kit.alive) {
      const dx = b.x - this.cx, dy = b.y - this.cy;
      const d = Math.hypot(dx, dy);
      const max = R - 8 - b.r;
      if (d > max) {
        const nx = dx / d, ny = dy / d;
        b.x = this.cx + nx * max; b.y = this.cy + ny * max;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= nx * vn * 1.7; b.vy -= ny * vn * 1.7;
          if (vn > 150) { Audio.sfx('bounce', 0.8); Vfx.dust(this, b.x + nx * 10, b.y + ny * 10); }
        }
      }
      for (const h of this.hammers) this.pushOut(b, h.px, h.py, POST_R, 0.6);
      for (const bm of this.bumpers) {
        if (this.pushOut(b, bm.x, bm.y, BUMPER_R, 0) && this.state === 'play') {
          const nx = (b.x - bm.x), ny = (b.y - bm.y);
          const l = Math.hypot(nx, ny) || 1;
          b.vx = (nx / l) * 360; b.vy = (ny / l) * 360;
          b.stun = Math.max(b.stun, 0.15);
          if (bm.lit <= 0) { Audio.sfx('bounce', 1.4); Audio.sfx('pop', 1.2); }
          bm.lit = 0.15;
          Vfx.squash(this, bm.img, 1.3, 0.7, 160);
          burst(this, bm.x, bm.y - 8, { tex: 'spark', count: 6, tint: [0xffe066, 0xffffff, 0xb8a6ff], speed: [60, 140], life: 300 });
        }
      }
    }
  }

  private pushOut(b: ArenaBody, x: number, y: number, r: number, bounce: number): boolean {
    const dx = b.x - x, dy = b.y - y;
    const d = Math.hypot(dx, dy);
    const min = r + b.r;
    if (d >= min || d === 0) return false;
    const nx = dx / d, ny = dy / d;
    b.x = x + nx * min; b.y = y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= nx * vn * (1 + bounce); b.vy -= ny * vn * (1 + bounce); }
    return true;
  }

  tick(dt: number): void {
    if (this.flagState === 'respawn') {
      this.flagT -= dt;
      if (this.flagT <= 0) {
        this.homeFlag();
        Audio.sfx('pop');
        Vfx.sparkle(this, this.cx, this.cy - 30);
        this.tweens.add({ targets: this.flag, scale: { from: S * 2, to: S }, duration: 300, ease: 'Back.easeOut' });
      }
    } else if (this.flagState === 'loose') {
      this.flagT -= dt;
    }
    if (this.flagState === 'home' || (this.flagState === 'loose' && this.flagT <= 0)) {
      for (const b of this.kit.alive) {
        if (b.stun > 0) continue;
        if (Math.hypot(b.x - this.flagX, b.y - this.flagY) < 22) { this.pickUp(b); break; }
      }
    }
    if (this.flagState === 'carried') {
      const b = this.kit.body(this.carrier as PlayerIndex)!;
      this.carryTime[b.p] += dt;
      const base = this.baseOf(b.p);
      if (Math.hypot(b.x - base.x, b.y - base.y) < BASE_R) this.scoreFlag(b);
    }
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b, dt);
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    let goal: { x: number; y: number };
    if (this.carrier === b.p) goal = this.baseOf(b.p);
    else if (this.flagState === 'carried') {
      const c = this.kit.body(this.carrier as PlayerIndex)!;
      goal = { x: c.x + c.vx * 0.25, y: c.y + c.vy * 0.25 };
      const d = Math.hypot(c.x - b.x, c.y - b.y);
      if (d < 85 && b.dashCd <= 0 && Math.random() < 0.06 * b.data.skill) { b.ix = (c.x - b.x) / d; b.iy = (c.y - b.y) / d; b.botDash = true; }
    } else if (this.flagState === 'respawn') {
      const a = Math.atan2(b.y - this.cy, b.x - this.cx);
      goal = { x: this.cx + Math.cos(a) * 80, y: this.cy + Math.sin(a) * 80 };
    } else goal = { x: this.flagX, y: this.flagY };
    // Avoidance (skilled CPUs dodge more often)
    let ax = goal.x - b.x, ay = goal.y - b.y;
    const gl = Math.hypot(ax, ay) || 1;
    ax /= gl; ay /= gl;
    if (Math.sin(this.t * 0.9 + b.data.jit) < b.data.skill * 1.6 - 0.3) {
      for (const h of this.hammers) {
        const hx = h.px + Math.cos(h.a) * HAMMER_ARM, hy = h.py + Math.sin(h.a) * HAMMER_ARM;
        const d = Math.hypot(b.x - hx, b.y - hy);
        if (d < 64) { ax += ((b.x - hx) / d) * (64 - d) / 30; ay += ((b.y - hy) / d) * (64 - d) / 30; }
        const pd = Math.hypot(b.x - h.px, b.y - h.py);
        if (pd < HAMMER_ARM + 26) { ax += ((b.x - h.px) / pd) * 0.6; ay += ((b.y - h.py) / pd) * 0.6; }
      }
      // broom approaching: back off radially
      const rx = b.x - this.cx, ry = b.y - this.cy;
      const r = Math.hypot(rx, ry);
      const th = Math.atan2(ry, rx);
      let diff = Phaser.Math.Angle.Wrap(th - this.broomA) * Math.sign(this.broomW);
      if (r > HUB && r < BROOM_OUT + 20 && diff > 0 && diff < 0.75) {
        const out = r > 90 ? 1 : -1;
        ax = (rx / r) * out * 1.4; ay = (ry / r) * out * 1.4;
        diff = 0;
      }
    }
    b.botTarget = { x: b.x + ax * 60, y: b.y + ay * 60 };
    void dt;
  }

  results(): PlayerResult[] {
    return rankBy(this.players, (p) => this.score[p] * 1000 + Math.round(this.carryTime[p] * 10)).map((r) => ({ ...r, score: this.score[r.player] }));
  }
}

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

const ID = 'bomb-tag';

/** Pop-up text above everything (Vfx.popText draws below depth-sorted avatars). */
function say(scene: Phaser.Scene, x: number, y: number, s: string, color: string, size: number, angle: number): void {
  const t = txt(scene, x, y, s, { size, color, strokeWidth: 4 }).setDepth(4500).setAngle(angle).setScale(0.4);
  const up = angle === 180 ? 26 : -26;
  scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: t, y: y + up, alpha: 0, delay: 420, duration: 420, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
}
const PASS_LOCK = 0.5;
const HOLDER_SPEED = 1.15;
const HARD_CAP = 150;
/** 3x5 digits 1..6 for the painted hopscotch. */
const NUMS = [
  ['.a.', 'aa.', '.a.', '.a.', 'aaa'], ['aa.', '..a', '.a.', 'a..', 'aaa'], ['aa.', '..a', '.a.', '..a', 'aa.'],
  ['a.a', 'a.a', 'aaa', '..a', '..a'], ['aaa', 'a..', 'aa.', '..a', 'aa.'], ['.aa', 'a..', 'aa.', 'a.a', '.a.'],
];

interface Obstacle { x: number; y: number; r: number; img: Phaser.GameObjects.Image }

/** #9 — Hot-potato tag with a lit bomb. Touch a rival to pass it before it blows. */
export default class BombTag extends BaseMinigame {
  private kit!: ArenaKit;
  private obstacles: Obstacle[] = [];
  private holder: PlayerIndex | -1 = -1;
  private fuse = 0;
  private passLock = 0;
  private giver: PlayerIndex | -1 = -1;
  private nextBombT = 0;
  private tickT = 0;
  private dropT = 0;
  private flight = { t: 1, fx: 0, fy: 0 };
  private bomb!: Phaser.GameObjects.Image;
  private bombShadow!: Phaser.GameObjects.Image;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;
  private danger!: Phaser.GameObjects.Image;
  private glow!: Phaser.GameObjects.Image;
  private survived = [0, 0, 0, 0];
  private ambientFx: ((dt: number) => void)[] = [];
  private bounds!: Phaser.Geom.Rectangle;
  private bombsUsed = 0;

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.obstacles = [];
    this.ambientFx = [];
    this.holder = -1;
    this.giver = -1;
    this.fuse = 0;
    this.passLock = 0;
    this.nextBombT = 0.6;
    this.dropT = 0;
    this.tickT = 0;
    this.bombsUsed = 0;
    this.flight = { t: 1, fx: 0, fy: 0 };
    this.survived = [0, 0, 0, 0];
    const W = this.vw, H = this.vh;
    this.bounds = new Phaser.Geom.Rectangle(34, 38, W - 68, H - 76);
    this.paintArt();
    this.paintBackground();
    this.buildObstacles();
    this.buildAmbient();
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 1000, radius: 12, dashSpeed: 400, dashCooldown: 1.2, bounce: 0.6, bounds: this.bounds,
      spawn: (p) => ({ x: W / 2 + (p % 2 === 0 ? -1 : 1) * W * 0.24, y: H / 2 + (p < 2 ? -1 : 1) * H * 0.22 }),
    });
    this.kit.dashHit = 0.9;
    for (const b of this.kit.bodies) {
      b.data.skill = 0.55 + Math.random() * 0.4;
      b.data.think = 0;
      b.data.tx = b.x;
      b.data.ty = b.y;
      b.data.wait = 0;
    }
    // bomb visuals
    this.glow = this.add.image(0, 0, `${ID}-glow`).setScale(S).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
    this.bombShadow = this.add.image(0, 0, 'shadow').setScale(S * 0.5).setAlpha(0.25).setVisible(false);
    this.bomb = this.add.image(0, 0, `${ID}-bomb`).setScale(S).setVisible(false).setOrigin(0.5, 0.6);
    this.danger = this.add.image(0, 0, `${ID}-danger`).setScale(S).setVisible(false);
    this.sparks = this.add.particles(0, 0, 'spark', {
      speed: { min: 20, max: 80 }, angle: { min: 200, max: 340 }, lifespan: { min: 150, max: 320 }, gravityY: 120,
      scale: { start: S * 0.6, end: 0 }, tint: [0xffffff, 0xffe066, 0xff9f43], frequency: 60, quantity: 1, emitting: false,
    });
    for (const p of this.players) this.hudText[p] = 'SAFE';
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    makeTexture(this, `${ID}-bomb`, 16, 17, (p) => {
      p.ball(7.5, 10.5, 6.5, 6.5, 0x3a3f6b);
      p.px(4, 7, 0xffffff); p.px(5, 7, 0xffffff); p.px(4, 8, 0xc8d0ff);
      p.box(5, 2, 6, 3, 0x9aa3b8);
      p.px(11, 2, 0xd9b77a); p.px(12, 1, 0xd9b77a); p.px(13, 1, 0xc49a5a); p.px(14, 0, 0xd9b77a);
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-glow`, 24, 24, (p) => {
      for (let r = 12; r > 0; r -= 1.5) p.circle(12, 12, r, 0xff5a3d, Math.round(18 + (12 - r) * 6));
    });
    makeTexture(this, `${ID}-danger`, 30, 12, (p) => {
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        if (i % 2) continue;
        const x = 15 + Math.cos(a) * 13.5, y = 6 + Math.sin(a) * 4.8;
        p.rect(Math.round(x - 0.5), Math.round(y - 0.5), 2, 1, 0xff5a3d);
      }
    });
    makeTexture(this, `${ID}-scorch`, 30, 14, (p) => {
      const r = rng(4);
      for (let y = 0; y < 14; y++) for (let x = 0; x < 30; x++) {
        const nx = (x + 0.5 - 15) / 15, ny = (y + 0.5 - 7) / 7;
        const d = nx * nx + ny * ny + (r() - 0.5) * 0.35;
        if (d < 0.35) p.px(x, y, 0x26222e);
        else if (d < 0.75) p.px(x, y, 0x3c3540, (x + y) % 2 ? 255 : 170);
        else if (d < 1) if ((x + y) % 2 === 0) p.px(x, y, 0x4a4250, 140);
      }
    });
    // Explosion: fireball → smoke, 9 frames.
    makeSheet(this, `${ID}-boom`, 56, 56, 9, (p, i) => {
      const R = [8, 13, 18, 21, 22, 22, 21, 19, 16][i];
      const puffs = Array.from({ length: 7 }, (_, k) => {
        const a = (k / 7) * Math.PI * 2 + 0.4;
        const rise = i > 3 ? (i - 3) * 1.6 : 0;
        return { x: 28 + Math.cos(a) * R * 0.6, y: 28 + Math.sin(a) * R * 0.55 - rise, r: R * (0.42 + (k % 3) * 0.06) };
      });
      if (i === 0) {
        p.circle(28, 28, 10, 0xfff1a8); p.circle(28, 28, 7, 0xffffff); p.ring(28, 28, 13, 0xffffff, 1);
        return;
      }
      if (i <= 3) {
        for (const q of puffs) p.circle(q.x, q.y, q.r + 1, 0xd8432f);
        for (const q of puffs) p.circle(q.x, q.y, q.r, 0xff5a3d);
        for (const q of puffs) p.circle(q.x - 1, q.y - 1, q.r * 0.72, 0xff9f43);
        p.circle(28, 28, R * 0.62, 0xffc93d);
        p.circle(27, 27, R * 0.45, i === 1 ? 0xffffff : 0xffe066);
        if (i === 1) p.ring(28, 28, R + 6, 0xffffff, 1);
        if (i === 2) p.ring(28, 28, R + 8, 0xfff1a8, 1);
        p.outline(-0.6);
        return;
      }
      const k = (i - 4) / 5;
      p.ball(28, 26 - (i - 3) * 1.6, R * 0.6 * (1 - k * 0.7), R * 0.55 * (1 - k * 0.7), 0x77728a, false);
      for (const q of puffs) {
        const pr = q.r * (1 - k * 0.85);
        if (pr < 1) continue;
        p.ball(q.x, q.y, pr, pr, i === 4 ? 0x8a6a68 : 0x77728a, false);
      }
      if (i === 4) p.circle(28, 30, R * 0.35, 0xff9f43);
      p.outline(-0.5);
    });
    if (!this.anims.exists(`${ID}-boom`)) {
      this.anims.create({ key: `${ID}-boom`, frames: this.anims.generateFrameNumbers(`${ID}-boom`, {}), frameRate: 16, repeat: 0 });
    }
    makeTexture(this, `${ID}-tires`, 26, 26, (p) => {
      const cols = [0xff5a6e, 0x3d9bff, 0xffc93d];
      for (let k = 0; k < 3; k++) {
        const y = 19 - k * 6;
        p.ellipse(13, y + 1, 12, 5, 0x262a3a);
        p.ellipse(13, y, 12, 5, 0x3e4458);
        p.ellipse(13, y - 1, 12, 4.5, 0x515a72);
        p.hline(5, y - 4, 8, 0x7a84a0);
        p.hline(4, y + 2, 18, 0x2f3446);
        p.ellipse(13, y - 1, 6, 2.2, shift(cols[k], -0.3));
        p.ellipse(13, y - 1.5, 5, 1.6, cols[k]);
        p.hline(6, y - 3, 6, 0x5c6277);
      }
      p.ellipse(13, 6, 5, 2, 0x16181f);
      p.outline(-0.6);
    });
    makeTexture(this, `${ID}-bush`, 30, 26, (p) => {
      p.box(6, 16, 18, 9, 0xc98a4b);
      p.hline(6, 18, 18, 0xa86f3a);
      p.ball(10, 12, 8, 7, 0x4fa040, false);
      p.ball(20, 12, 8, 7, 0x4fa040, false);
      p.ball(15, 8, 9, 7, 0x5db34a);
      p.ball(9, 11, 5, 4, 0x6ac255, false);
      p.px(12, 6, 0xff7a85); p.px(19, 9, 0xffe066); p.px(8, 12, 0xffffff); p.px(22, 13, 0xff7a85); p.px(16, 12, 0xffffff);
      p.outline(-0.75);
    });
    makeSheet(this, `${ID}-fly`, 7, 5, 2, (p, i) => {
      const c = 0xffe066;
      if (i === 0) { p.rect(0, 0, 3, 3, c); p.rect(4, 0, 3, 3, c); p.px(1, 3, 0xff9f43); p.px(5, 3, 0xff9f43); }
      else { p.rect(1, 1, 2, 3, c); p.rect(4, 1, 2, 3, c); }
      p.vline(3, 1, 4, 0x2b3263);
    });
    makeTexture(this, `${ID}-cloudshadow`, 60, 30, (p) => {
      p.ellipse(30, 15, 29, 13, 0x1b3a2a);
      p.ellipse(16, 12, 14, 9, 0x1b3a2a);
      p.ellipse(44, 14, 14, 10, 0x1b3a2a);
    });
    makeTexture(this, `${ID}-flower`, 5, 6, (p) => {
      p.px(2, 0, 0xffffff); p.px(1, 1, 0xffffff); p.px(3, 1, 0xffffff); p.px(2, 2, 0xffffff); p.px(2, 1, 0xffe066);
      p.vline(2, 3, 3, 0x3f8a3a); p.px(1, 4, 0x3f8a3a);
    });
  }

  private paintBackground(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const b = this.bounds;
    const mx = Math.round(b.x / S), my = Math.round(b.y / S), mw = Math.round(b.width / S), mh = Math.round(b.height / S);
    const key = makeTexture(this, `${ID}-bg-${aw}`, aw, ah, (p) => {
      const r = rng(909);
      // grass
      p.rect(0, 0, aw, ah, 0x5aae48);
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) if (((x + y * 2) >> 4) % 2 === 0) p.px(x, y, 0x60b54d);
      for (let i = 0; i < aw * ah * 0.05; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), r() < 0.5 ? 0x6cc556 : 0x4c9c3e);
      // rubber play mat with concrete curb
      const inRR = (x: number, y: number, x0: number, y0: number, w: number, h: number, rad: number) => {
        const cx = Math.min(Math.max(x, x0 + rad), x0 + w - 1 - rad), cy = Math.min(Math.max(y, y0 + rad), y0 + h - 1 - rad);
        return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
      };
      for (let y = my - 4; y < my + mh + 5; y++) for (let x = mx - 4; x < mx + mw + 4; x++) {
        if (inRR(x, y, mx - 4, my - 4, mw + 8, mh + 9, 10)) p.px(x, y, y > my + mh ? 0x8f93a6 : 0xd8dae6);
      }
      for (let y = my; y < my + mh; y++) for (let x = mx; x < mx + mw; x++) {
        if (!inRR(x, y, mx, my, mw, mh, 7)) continue;
        const tile = (((x - mx) >> 3) + ((y - my) >> 3)) % 2;
        let c = tile ? 0x3fa8a0 : 0x3a9e97;
        const n = r();
        if (n < 0.06) c = 0x48b5ac; else if (n < 0.1) c = 0x358f89;
        p.px(x, y, c);
      }
      // inner shadow under curb (top-left light)
      p.hline(mx + 7, my, mw - 14, 0x2e7f7a); p.vline(mx, my + 7, mh - 14, 0x2e7f7a);
      // painted lines: centre circle, four-square, hopscotch
      const cx = Math.round(aw / 2), cy = Math.round(ah / 2);
      const paint = 0xf4fff8;
      p.ring(cx, cy, 22, paint, 1);
      p.ring(cx, cy, 3, paint, 1);
      p.vline(cx, my + 4, mh - 8, 0xdff3ee);
      for (const sx of [-1, 1]) {
        // four-square boxes
        const bx = cx + sx * 62 - 14, by = cy - 14;
        p.rect(bx, by, 28, 1, paint); p.rect(bx, by + 28, 28, 1, paint); p.rect(bx, by, 1, 29, paint); p.rect(bx + 28, by, 1, 29, paint);
        p.rect(bx + 14, by, 1, 29, paint); p.rect(bx, by + 14, 28, 1, paint);
      }
      // hopscotch along top & bottom
      for (const [y0, dir] of [[my + 8, 1], [my + mh - 18, -1]] as const) {
        for (let k = 0; k < 6; k++) {
          const x0 = cx - 54 + k * 18;
          p.rect(x0, y0, 12, 1, 0xffe066); p.rect(x0, y0 + 10, 12, 1, 0xffe066);
          p.rect(x0, y0, 1, 11, 0xffe066); p.rect(x0 + 11, y0, 1, 11, 0xffe066);
          // bottom row reads upright for the near seats, top row for the far seats
          if (dir > 0) p.stamp(x0 + 4, y0 + 3, [...NUMS[5 - k]].reverse(), { a: 0xfff1a8 }, true);
          else p.stamp(x0 + 5, y0 + 3, NUMS[k], { a: 0xfff1a8 });
        }
      }
      // corner colour patches (spawn areas in player colours)
      const corners: [number, number, number][] = [[mx + 18, my + 16, 0], [mx + mw - 30, my + 16, 1], [mx + 18, my + mh - 28, 2], [mx + mw - 30, my + mh - 28, 3]];
      for (const [x0, y0, q] of corners) {
        const c = PLAYER_COLORS[q].main;
        p.ring(x0 + 6, y0 + 6, 6, c, 1);
        p.circle(x0 + 6, y0 + 6, 2, c);
      }
      // picket fences top & bottom
      for (const [fy, h] of [[2, 12], [ah - 15, 12]] as const) {
        p.rect(0, fy + 3, aw, 2, 0xe6e2d6);
        p.rect(0, fy + 8, aw, 2, 0xe6e2d6);
        for (let x = 1; x < aw; x += 6) {
          p.rect(x, fy + 1, 4, h, 0xfaf7ee);
          p.px(x + 1, fy, 0xfaf7ee); p.px(x + 2, fy, 0xfaf7ee);
          p.vline(x + 3, fy + 1, h, 0xcfcabb);
          p.hline(x, fy + h, 4, 0x3f7f37);
        }
      }
      // hedges left & right
      for (const hx of [0, aw - 14]) {
        for (let y = 10; y < ah - 10; y += 7) {
          const ox = hx + 7 + (r() - 0.5) * 3;
          p.ball(ox, y, 7, 5, 0x3f8f3a, false);
        }
        for (let y = 10; y < ah - 10; y += 7) {
          p.ball(hx + 6 + (r() - 0.5) * 2, y - 1, 4, 3, 0x56aa4a, false);
          if (r() < 0.4) p.px(hx + 4 + Math.floor(r() * 6), y - 2, r() < 0.5 ? 0xff7a85 : 0xffe066);
        }
      }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-3000);
  }

  private buildObstacles(): void {
    const cx = this.vw / 2, cy = this.vh / 2;
    const list: [number, number, number, string][] = [
      [cx - this.vw * 0.21, cy, 20, `${ID}-tires`],
      [cx + this.vw * 0.21, cy, 20, `${ID}-tires`],
      [cx, cy - 104, 22, `${ID}-bush`],
      [cx, cy + 104, 22, `${ID}-bush`],
    ];
    for (const [x, y, r, k] of list) {
      this.add.image(x, y + 6, 'shadow').setScale(S * 1.4, S * 1.2).setAlpha(0.3).setDepth(y - 1000);
      const img = this.add.image(x, y + 8, k).setOrigin(0.5, 1).setScale(S).setDepth(y + 8);
      this.obstacles.push({ x, y, r, img });
    }
  }

  private buildAmbient(): void {
    // drifting cloud shadows
    for (let i = 0; i < 3; i++) {
      const c = this.add.image(Math.random() * this.vw, 60 + i * 150, `${ID}-cloudshadow`).setScale(S * 2.2).setAlpha(0.1).setDepth(-1500);
      const sp = 8 + i * 4;
      this.ambientFx.push((dt) => { c.x += sp * dt; if (c.x > this.vw + 140) c.x = -140; });
    }
    // butterflies
    for (let i = 0; i < 4; i++) {
      const f = this.add.sprite(0, 0, `${ID}-fly`, 0).setScale(S).setDepth(920);
      f.setTint([0xffffff, 0xffb3bd, 0xa8d3ff, 0xffe9a8][i]);
      let t = Math.random() * 100;
      const ox = this.vw * (0.15 + Math.random() * 0.7), oy = this.vh * (0.15 + Math.random() * 0.7);
      this.ambientFx.push((dt) => {
        t += dt;
        f.setPosition(ox + Math.sin(t * 0.37 + i) * 140, oy + Math.sin(t * 0.53 + i * 2) * 80 + Math.sin(t * 6) * 4);
        f.setFrame(Math.floor(t * 9) % 2);
      });
    }
    // swaying flowers along the fences
    const r = rng(33);
    for (let i = 0; i < 26; i++) {
      const top = i % 2 === 0;
      const x = 20 + r() * (this.vw - 40), y = top ? 34 : this.vh - 4;
      const fl = this.add.image(x, y, `${ID}-flower`).setOrigin(0.5, 1).setScale(S).setDepth(-2000).setTint([0xffffff, 0xffb3bd, 0xffe9a8][i % 3]);
      this.tweens.add({ targets: fl, angle: { from: -10, to: 10 }, yoyo: true, repeat: -1, duration: 900 + r() * 700, ease: 'Sine.easeInOut', delay: r() * 800 });
    }
  }

  // ─────────────────────────── BOMB LOGIC ───────────────────────────

  private headPos(b: ArenaBody): { x: number; y: number } {
    return { x: b.x, y: b.y - 82 + Math.sin(this.elapsed * 10) * 1.5 };
  }

  private giveNewBomb(): void {
    const alive = this.kit.alive;
    if (alive.length < 2) return;
    const b = alive[Math.floor(Math.random() * alive.length)];
    this.holder = b.p;
    this.giver = -1;
    this.bombsUsed++;
    this.fuse = 10 + Math.random() * 10;
    this.passLock = 0.9;
    this.dropT = 0.7;
    this.tickT = 0.9;
    this.flight = { t: 0, fx: b.x, fy: b.y - 260 };
    this.bomb.setVisible(true);
    Audio.sfx('whoosh');
    this.announce(this.bombsUsed === 1 ? 'ระเบิดมาแล้ว!' : 'ลูกใหม่มาแล้ว!', '#ff9f8a');
    say(this, b.x, b.y - 90, 'โดนระเบิด!', toCss(PLAYER_COLORS[b.p].light), 18, this.angleFor(b.p));
    this.refreshHud();
  }

  private announce(s: string, color: string): void {
    for (const [deg, y] of [[0, this.vh * 0.64], [180, this.vh * 0.36]] as const) {
      const t = txt(this, this.vw / 2, y, s, { size: 30, color, strokeWidth: 6 }).setAngle(deg).setDepth(3500);
      this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
    }
  }

  private pass(from: ArenaBody, to: ArenaBody): void {
    const h = this.headPos(from);
    this.flight = { t: 0, fx: h.x, fy: h.y };
    this.holder = to.p;
    this.giver = from.p;
    this.passLock = PASS_LOCK;
    to.stun = Math.max(to.stun, 0.28);
    to.lastHitBy = from.p;
    this.addScore(from.p, 1);
    Audio.sfx('throw', 1 + from.p * 0.1);
    Audio.sfx('hit', 1.3);
    Vfx.hit(this, (from.x + to.x) / 2, (from.y + to.y) / 2 - 20, [0xffffff, 0xffe066, 0xff5a3d]);
    Vfx.squash(this, to.avatar.sprite, 1.3, 0.75, 180);
    say(this, to.x, to.y - 92, 'รับไป!', toCss(PLAYER_COLORS[to.p].light), 16, this.angleFor(to.p));
    say(this, from.x, from.y - 80, 'รอด!', '#a6f0c4', 14, this.angleFor(from.p));
    this.refreshHud();
  }

  private refreshHud(): void {
    for (const p of this.players) this.hudText[p] = !this.alive(p) ? 'OUT' : p === this.holder ? 'BOMB!' : 'SAFE';
  }

  private explode(b: ArenaBody): void {
    const x = b.x, y = b.y - 20;
    this.holder = -1;
    this.bomb.setVisible(false);
    this.bombShadow.setVisible(false);
    this.danger.setVisible(false);
    this.glow.setVisible(false);
    this.sparks.emitting = false;
    Audio.sfx('explode');
    Audio.sfx('bigHit', 0.7);
    Vfx.explosion(this, x, y, 1.5);
    const boom = this.add.sprite(x, y - 10, `${ID}-boom`, 0).setScale(S * 1.5).setDepth(4000);
    boom.play(`${ID}-boom`);
    boom.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => boom.destroy());
    this.add.image(b.x, b.y, `${ID}-scorch`).setScale(S).setDepth(-1800).setAlpha(0.85);
    burst(this, x, y, { tex: 'spark', count: 24, tint: [0xffe066, 0xff9f43, 0xffffff], speed: [160, 360], life: 500, scale: [S, 0] });
    // blast pushes everyone nearby
    for (const o of this.kit.alive) {
      if (o === b) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d < 150) {
        this.kit.knock(o, b.x, b.y, 420 * (1 - d / 150) + 80, 0.45);
        Vfx.hitFlash(this, o.avatar.sprite);
      }
    }
    // the victim: sooty, launched into the air, gone
    this.kit.kill(b);
    this.survived[b.p] = this.elapsed;
    const av = b.avatar;
    av.sprite.setTint(0x3a3448);
    av.play('stun', true);
    av.marker?.setVisible(false);
    av.ring?.setVisible(false);
    av.shadow?.setVisible(false);
    const s = av.sprite;
    this.tweens.add({ targets: s, y: s.y - 90, angle: 360 * (Math.random() < 0.5 ? -1 : 1), duration: 520, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: s, alpha: 0, scale: S * 0.3, delay: 380, duration: 380, onComplete: () => s.setVisible(false) });
    say(this, b.x, b.y - 70, 'ตูม!!', '#ffe066', 30, this.angleFor(b.p));
    this.eliminate(b.p);
    this.refreshHud();
    if (this.kit.alive.length >= 2) this.nextBombT = 2.2;
  }

  // ─────────────────────────── LOOP ───────────────────────────

  ambient(dt: number): void {
    for (const f of this.ambientFx) f(dt);
    for (const b of this.kit.bodies) b.speedMul = b.p === this.holder ? HOLDER_SPEED : 1;
    this.kit.update(dt, this.state === 'play');
    this.pushOutOfObstacles();
    this.syncBomb(dt);
  }

  private pushOutOfObstacles(): void {
    for (const b of this.kit.alive) {
      for (const o of this.obstacles) {
        const dx = b.x - o.x, dy = b.y - o.y;
        const d = Math.hypot(dx, dy), min = o.r + b.r;
        if (d >= min || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        b.x = o.x + nx * min;
        b.y = o.y + ny * min;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) {
          b.vx -= nx * vn * 1.5;
          b.vy -= ny * vn * 1.5;
          if (vn < -150) {
            Audio.sfx('bounce');
            this.tweens.add({ targets: o.img, scaleX: S * 1.12, scaleY: S * 0.9, yoyo: true, duration: 80 });
          }
        }
        b.avatar.setPos(b.x, b.y);
      }
    }
  }

  private syncBomb(dt: number): void {
    const hb = this.holder === -1 ? undefined : this.kit.body(this.holder);
    if (!hb) return;
    // lift the holder's number marker above the bomb
    if (hb.avatar.marker) hb.avatar.marker.y -= 46;
    const h = this.headPos(hb);
    let x = h.x, y = h.y;
    if (this.flight.t < 1) {
      const dur = this.dropT > 0 ? 0.7 : 0.16;
      this.flight.t = Math.min(1, this.flight.t + dt / dur);
      const k = this.dropT > 0 ? Phaser.Math.Easing.Bounce.Out(this.flight.t) : this.flight.t;
      x = Phaser.Math.Linear(this.flight.fx, h.x, k);
      y = Phaser.Math.Linear(this.flight.fy, h.y, k) - (this.dropT > 0 ? 0 : Math.sin(this.flight.t * Math.PI) * 26);
      if (this.flight.t >= 1 && this.dropT > 0) Audio.sfx('land');
    }
    const hot = this.fuse < 3 ? 2 : this.fuse < 6 ? 1 : 0;
    const pulse = 1 + Math.max(0, this.tickT < 0.08 ? 0.18 : 0) + hot * 0.06;
    this.bomb.setVisible(true).setPosition(x, y).setScale(S * pulse).setDepth(hb.y + 1500);
    this.bomb.setAngle(Math.sin(this.elapsed * (6 + hot * 8)) * (4 + hot * 4));
    if (hot === 2 && Math.floor(this.elapsed * 10) % 2 === 0) this.bomb.setTint(0xff7a6a);
    else if (hot === 1 && Math.floor(this.elapsed * 4) % 2 === 0) this.bomb.setTint(0xffb0a0);
    else this.bomb.clearTint();
    this.glow.setVisible(hot > 0).setPosition(x, y).setDepth(hb.y + 1499).setScale(S * (1.4 + hot * 0.6 + Math.sin(this.elapsed * 20) * 0.15)).setAlpha(0.5 + hot * 0.2);
    this.bombShadow.setVisible(false);
    this.danger.setVisible(true).setPosition(hb.x, hb.y + 1).setDepth(hb.y - 998).setScale(S * (1.1 + Math.sin(this.elapsed * (8 + hot * 8)) * 0.1));
    this.sparks.setPosition(x + 12, y - 18).setDepth(hb.y + 1501);
    this.sparks.emitting = this.state === 'play' && this.dropT <= 0;
    this.sparks.frequency = [70, 35, 14][hot];
  }

  tick(dt: number): void {
    if (this.elapsed > HARD_CAP) return this.finish();
    if (this.holder === -1) {
      this.nextBombT -= dt;
      if (this.nextBombT <= 0 && this.kit.alive.length >= 2) this.giveNewBomb();
    } else {
      const hb = this.kit.body(this.holder)!;
      if (this.dropT > 0) {
        this.dropT -= dt;
      } else {
        this.fuse -= dt;
        this.passLock -= dt;
        this.tickT -= dt;
        if (this.tickT <= 0) {
          const hot = this.fuse < 3 ? 2 : this.fuse < 6 ? 1 : 0;
          this.tickT = [0.75, 0.38, 0.16][hot];
          Audio.sfx('tick', 1 + hot * 0.25);
        }
        if (this.fuse <= 0) this.explode(hb);
        else if (this.passLock <= 0) {
          for (const o of this.kit.alive) {
            if (o === hb) continue;
            if (Math.hypot(o.x - hb.x, o.y - hb.y) <= o.r + hb.r + 6) { this.pass(hb, o); break; }
          }
        }
      }
    }
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b, dt);
  }

  // ─────────────────────────── CPU ───────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    const others = this.kit.alive.filter((o) => o !== b);
    if (!others.length) return;
    b.data.think -= dt;
    const skill = b.data.skill;
    if (b.p === this.holder) {
      // chase the nearest rival (not the one who just gave it, if possible)
      let cand = others.filter((o) => o.p !== this.giver || this.passLock < 0);
      if (!cand.length) cand = others;
      const dist = (o: ArenaBody) => Math.hypot(o.x - b.x, o.y - b.y);
      const t = cand.reduce((m, o) => (dist(o) < dist(m) ? o : m));
      const lead = 0.25 * skill;
      b.botTarget = { x: t.x + t.vx * lead, y: t.y + t.vy * lead };
      if (dist(t) < 95 && b.dashCd <= 0 && this.dropT <= 0 && Math.random() < skill * 6 * dt) b.botDash = true;
      return;
    }
    const hb = this.holder === -1 ? undefined : this.kit.body(this.holder);
    if (!hb) {
      // between bombs: drift toward open space near the middle
      if (b.data.think <= 0) {
        b.data.think = 0.8 + Math.random();
        b.data.tx = this.vw / 2 + (Math.random() - 0.5) * this.vw * 0.5;
        b.data.ty = this.vh / 2 + (Math.random() - 0.5) * this.vh * 0.4;
      }
      b.botTarget = { x: b.data.tx, y: b.data.ty };
      return;
    }
    const dh = Math.hypot(hb.x - b.x, hb.y - b.y);
    if (b.data.think <= 0) {
      b.data.think = 0.18 + (1 - skill) * 0.35 + Math.random() * 0.1;
      // pick the best of several escape points
      let best = { x: b.x, y: b.y }, bestScore = -1e9;
      const R = this.bounds;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
        const px = b.x + Math.cos(a) * 80, py = b.y + Math.sin(a) * 80;
        const wall = Math.min(px - R.x, R.right - px, py - R.y, R.bottom - py);
        let sc = Math.hypot(px - hb.x, py - hb.y) * (0.6 + skill * 0.6);
        if (wall < 30) sc -= (30 - wall) * 6;
        for (const o of this.obstacles) if (Math.hypot(px - o.x, py - o.y) < o.r + 14) sc -= 80;
        for (const o of others) if (o !== hb) sc -= Math.max(0, 70 - Math.hypot(px - o.x, py - o.y)) * 1.2;
        sc += Math.random() * 30;
        if (sc > bestScore) { bestScore = sc; best = { x: px, y: py }; }
      }
      b.data.tx = best.x;
      b.data.ty = best.y;
    }
    b.botTarget = { x: b.data.tx, y: b.data.ty };
    // panic dodge
    const closing = ((b.x - hb.x) * hb.vx + (b.y - hb.y) * hb.vy) / Math.max(1, dh);
    if (dh < 55 && closing > 60 && b.dashCd <= 0 && Math.random() < skill * 8 * dt) {
      const sx = -(hb.y - b.y) / dh, sy = (hb.x - b.x) / dh;
      const side = Math.random() < 0.5 ? 1 : -1;
      b.ix = sx * side; b.iy = sy * side;
      b.botTarget = { x: b.x + sx * side * 60, y: b.y + sy * side * 60 };
      b.botDash = true;
    }
  }

  results(): PlayerResult[] {
    for (const p of this.players) if (this.alive(p)) this.survived[p] = this.elapsed;
    const order = (p: PlayerIndex) => {
      const i = this.eliminated.indexOf(p);
      return i === -1 ? 100 + this.survived[p] : i;
    };
    return rankBy(this.players, order).map((r) => ({ ...r, score: Math.round(this.survived[r.player]) }));
  }
}

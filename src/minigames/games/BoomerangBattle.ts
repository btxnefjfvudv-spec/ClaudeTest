import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'boomerang-battle';
const LIVES = 3;
const THROW_V = 330;
const CURVE = 2.1;
const OUT_T = 0.55;
const CATCH_R = 22;
const HIT_R = 13;
const BOOM_Z = 18;
const CRATE_H = 15;

interface Crate { x: number; y: number; img: Phaser.GameObjects.Image }

interface Thrower {
  b: ArenaBody;
  fa: number;
  lives: number;
  hits: number;
  // boomerang
  flying: boolean;
  bx: number; by: number; bvx: number; bvy: number; bt: number; spin: number;
  hitSet: Set<PlayerIndex>;
  boom: Phaser.GameObjects.Image;
  boomShadow: Phaser.GameObjects.Image;
  trailT: number;
  arrow: Phaser.GameObjects.Image;
  hearts: Phaser.GameObjects.Image[];
  chip: Phaser.GameObjects.Image;
  out: boolean;
  // CPU
  skill: number; think: number; wait: number; strafe: number; dodge: number; dodgeX: number; dodgeY: number;
}

function say(scene: Phaser.Scene, x: number, y: number, s: string, color: string, size: number, angle: number): void {
  const t = txt(scene, x, y, s, { size, color, strokeWidth: 4 }).setDepth(4500).setAngle(angle).setScale(0.4);
  const up = angle === 180 ? 26 : -26;
  scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: t, y: y + up, alpha: 0, delay: 420, duration: 420, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
}

/** #13 — Curving boomerangs that come back. Throw, dodge, catch. 3 lives. */
export default class BoomerangBattle extends BaseMinigame {
  private kit!: ArenaKit;
  private throwers: Thrower[] = [];
  private crates: Crate[] = [];
  private bounds!: Phaser.Geom.Rectangle;
  private ambientFx: ((dt: number) => void)[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.throwers = [];
    this.crates = [];
    this.ambientFx = [];
    const W = this.vw, H = this.vh;
    this.bounds = new Phaser.Geom.Rectangle(34, 44, W - 68, H - 84);
    this.paintArt();
    this.paintBackground();
    this.buildCrates();
    this.buildAmbient();
    const cx = W / 2, cy = H / 2;
    this.kit = new ArenaKit(this, {
      speed: 140, accel: 1000, radius: 12, dash: false, action: 'throw', bounce: 0.4, bounds: this.bounds,
      spawn: (p) => ({ x: cx + (p % 2 === 0 ? -1 : 1) * W * 0.31, y: cy + (p < 2 ? -1 : 1) * H * 0.25 }),
    });
    for (const b of this.kit.bodies) {
      b.avatar.marker?.setVisible(false);
      const fa = Math.atan2(cy - b.y, cx - b.x);
      const t: Thrower = {
        b, fa, lives: LIVES, hits: 0, flying: false, bx: b.x, by: b.y, bvx: 0, bvy: 0, bt: 0, spin: 0, hitSet: new Set(),
        boom: this.add.image(b.x, b.y, `${ID}-boom-${b.p}`).setScale(S),
        boomShadow: this.add.image(b.x, b.y, 'shadow').setScale(S * 0.45).setAlpha(0.25).setVisible(false),
        trailT: 0,
        arrow: this.add.image(b.x, b.y, `${ID}-arrow-${b.p}`).setScale(S).setAlpha(0.85),
        hearts: [0, 1, 2].map(() => this.add.image(b.x, b.y, `${ID}-heart`).setScale(S).setDepth(930)),
        chip: this.add.image(b.x, b.y, playerMarkerKey(this, b.p)).setScale(S * 0.8).setDepth(931).setAngle(this.angleFor(b.p)),
        out: false,
        skill: 0.5 + Math.random() * 0.45, think: Math.random() * 0.3, wait: 0.6 + Math.random() * 0.8, strafe: Math.random() < 0.5 ? 1 : -1,
        dodge: 0, dodgeX: 0, dodgeY: 0,
      };
      this.throwers.push(t);
    }
    this.kit.onAction = (b, down) => { if (down) { const t = this.thrower(b.p); if (t) this.throwBoom(t); } };
    this.refreshHud();
  }

  private thrower(p: PlayerIndex): Thrower | undefined {
    return this.throwers.find((t) => t.b.p === p);
  }

  private refreshHud(): void {
    for (const t of this.throwers) this.hudText[t.b.p] = t.out ? 'OUT' : `♥${t.lives}`;
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[p];
      makeTexture(this, `${ID}-boom-${p}`, 14, 14, (g) => {
        // V-shaped boomerang, wood with a player-colour stripe
        g.stroke(2, 11, 7, 3, 3, 0xc98a4b);
        g.stroke(7, 3, 12, 11, 3, 0xc98a4b);
        g.line(2, 10, 7, 2, 0xe8b070);
        g.line(7, 2, 12, 10, 0xe8b070);
        g.stroke(3, 9, 5, 6, 2, c.main);
        g.stroke(9, 6, 11, 9, 2, c.main);
        g.outline(-0.75);
      });
      makeTexture(this, `${ID}-arrow-${p}`, 8, 7, (g) => {
        g.tri(0, 0, 7, 3.5, 0, 7, c.main);
        g.tri(1, 1.5, 5, 3.5, 1, 5.5, c.light);
        g.outline(-0.6);
      });
    }
    makeTexture(this, `${ID}-heart`, 7, 6, (g) =>
      g.stamp(0, 0, ['.aa.aa.', 'abbaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..', '...a...'], { a: 0xff4d6d, b: 0xffc2cc }),
    );
    makeTexture(this, `${ID}-heart-empty`, 7, 6, (g) =>
      g.stamp(0, 0, ['.aa.aa.', 'a..a..a', 'a.....a', '.a...a.', '..a.a..', '...a...'], { a: 0x5a4a5e }),
    );
    makeTexture(this, `${ID}-crate`, 18, 22, (g) => {
      const wood = 0xc98a4b;
      // top face
      g.rect(1, 1, 16, 7, shift(wood, 0.3));
      g.hline(1, 1, 16, shift(wood, 0.55));
      for (let x = 5; x < 17; x += 4) g.vline(x, 2, 6, shift(wood, 0.1));
      // front face
      g.box(1, 8, 16, 13, wood);
      for (let y = 12; y < 20; y += 4) g.hline(2, y, 14, shift(wood, -0.3));
      g.line(2, 9, 15, 19, shift(wood, -0.25));
      g.line(2, 10, 15, 20, shift(wood, 0.2));
      // metal corners
      for (const [x, y] of [[1, 8], [15, 8], [1, 19], [15, 19]]) g.rect(x, y, 2, 2, 0x8f98a8);
      g.outline(-0.75);
    });
    makeSheet(this, `${ID}-tumble`, 16, 16, 1, (g) => {
      const r = rng(9);
      for (let i = 0; i < 26; i++) {
        const a = r() * Math.PI * 2, rr = 3 + r() * 4;
        g.line(8, 8, Math.round(8 + Math.cos(a) * rr), Math.round(8 + Math.sin(a) * rr), r() < 0.5 ? 0xa8834a : 0xc9a060);
      }
      g.ring(8, 8, 6.5, 0x9a7440, 1);
      g.ring(8, 8, 4, 0xb89050, 1);
      g.outline(-0.5);
    });
    makeTexture(this, `${ID}-cactus`, 14, 22, (g) => {
      const c = 0x4f9a52;
      g.box(5, 2, 5, 20, c);
      g.box(0, 7, 4, 8, c); g.rect(2, 13, 4, 3, c);
      g.box(10, 5, 4, 7, c); g.rect(9, 10, 3, 3, c);
      g.vline(7, 3, 18, shift(c, 0.4));
      g.px(6, 1, 0xff7a85); g.px(7, 0, 0xffe066); g.px(8, 1, 0xff7a85);
      g.outline(-0.75);
    });
    makeTexture(this, `${ID}-rock`, 18, 12, (g) => {
      g.ball(9, 7, 8.5, 5, 0xc0794a);
      g.ball(6, 6, 4, 3, 0xd8925e, false);
      g.outline(-0.7);
    });
    makeTexture(this, `${ID}-vulture`, 24, 10, (g) => {
      g.ellipse(12, 5, 3, 3, 0x000000);
      g.tri(0, 3, 12, 4, 12, 7, 0x000000);
      g.tri(24, 3, 12, 4, 12, 7, 0x000000);
    });
  }

  private paintBackground(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const key = makeTexture(this, `${ID}-bg-${aw}`, aw, ah, (p) => {
      const r = rng(4242);
      p.rect(0, 0, aw, ah, 0xe6bf78);
      // dune ripples
      for (let k = 0; k < 40; k++) {
        const y0 = Math.floor(r() * ah), x0 = Math.floor(r() * aw), len = 20 + Math.floor(r() * 40);
        for (let i = 0; i < len; i++) {
          const y = Math.round(y0 + Math.sin((x0 + i) * 0.18) * 2);
          p.px(x0 + i, y, 0xd8ad65);
          p.px(x0 + i, y - 1, 0xf0cf8e);
        }
      }
      for (let i = 0; i < aw * ah * 0.04; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), r() < 0.5 ? 0xdcb26c : 0xefcd8c);
      // pebbles
      for (let i = 0; i < 40; i++) { const x = Math.floor(r() * aw), y = Math.floor(r() * ah); p.px(x, y, 0xb08050); p.px(x + 1, y, 0xc89868); }
      // centre target painted in the sand
      const cx = Math.round(aw / 2), cy = Math.round(ah / 2);
      p.ring(cx, cy, 34, 0xd09a58, 1);
      p.ring(cx, cy, 20, 0xd09a58, 1);
      // canyon walls top & bottom (strata)
      const wallTop = 20, wallBot = 18;
      for (let x = 0; x < aw; x++) {
        const h1 = wallTop + Math.round(Math.sin(x * 0.07) * 2 + Math.sin(x * 0.23) * 1.5);
        for (let y = 0; y < h1; y++) {
          const band = (((Math.floor((y + Math.sin(x * 0.05) * 2) / 4)) % 3) + 3) % 3;
          p.px(x, y, [0xb5603a, 0xc8714a, 0xa35234][band]);
        }
        p.px(x, h1, 0x7f3e2a); p.px(x, h1 + 1, 0xc99a5e);
        const h2 = wallBot + Math.round(Math.sin(x * 0.09 + 2) * 2 + Math.sin(x * 0.31) * 1.2);
        for (let y = ah - h2; y < ah; y++) {
          const band = (((Math.floor((y + Math.sin(x * 0.05) * 2) / 4)) % 3) + 3) % 3;
          p.px(x, y, [0xb5603a, 0xc8714a, 0xa35234][band]);
        }
        p.px(x, ah - h2, 0xe08a5a); p.px(x, ah - h2 + 1, 0xd4794c);
        p.px(x, ah - h2 - 1, 0xbf8a50);
      }
      // side shadows
      for (let y = 0; y < ah; y++) { p.px(0, y, 0xc79a58); p.px(1, y, 0xd4a862); p.px(aw - 1, y, 0xc79a58); p.px(aw - 2, y, 0xd4a862); }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-3000);
    // props on the edges
    const r = rng(17);
    for (let i = 0; i < 6; i++) {
      const left = i % 2 === 0;
      const x = left ? 14 + r() * 6 : this.vw - 14 - r() * 6;
      const y = 90 + (i >> 1) * 140 + r() * 30;
      this.add.image(x, y, i % 3 === 0 ? `${ID}-rock` : `${ID}-cactus`).setOrigin(0.5, 1).setScale(S).setDepth(y);
    }
  }

  private buildCrates(): void {
    const cx = this.vw / 2, cy = this.vh / 2;
    const dx = Math.min(140, this.vw * 0.2);
    const spots: [number, number][] = [[cx, cy], [cx - dx, cy - 80], [cx + dx, cy - 80], [cx - dx, cy + 80], [cx + dx, cy + 80], [cx - dx * 1.75, cy], [cx + dx * 1.75, cy]];
    for (const [x, y] of spots) {
      this.add.image(x + 3, y + 14, 'shadow').setScale(S * 1.9, S * 1.6).setAlpha(0.22).setDepth(-2000);
      const img = this.add.image(x, y + CRATE_H + 6, `${ID}-crate`).setOrigin(0.5, 1).setScale(S).setDepth(y + CRATE_H);
      this.crates.push({ x, y, img });
    }
  }

  private buildAmbient(): void {
    const W = this.vw, H = this.vh;
    // tumbleweeds rolling across
    for (let i = 0; i < 2; i++) {
      const tw = this.add.image(-40, 0, `${ID}-tumble`, 0).setScale(S).setDepth(900);
      const sh = this.add.image(-40, 0, 'shadow').setScale(S * 0.7).setAlpha(0.2).setDepth(-1900);
      let x = -40 - i * 400, t = 0;
      let y0 = 100 + i * 220;
      this.ambientFx.push((dt) => {
        t += dt;
        x += (60 + i * 15) * dt;
        if (x > W + 60) { x = -60 - Math.random() * 300; y0 = 70 + Math.random() * (H - 140); }
        const hop = Math.abs(Math.sin(t * 4 + i)) * 10;
        tw.setPosition(x, y0 - hop).setAngle(t * 300);
        sh.setPosition(x, y0 + 8);
      });
    }
    // circling vulture shadows
    for (let i = 0; i < 2; i++) {
      const v = this.add.image(0, 0, `${ID}-vulture`).setScale(S * 1.3).setAlpha(0.1).setDepth(-1800);
      let t = i * 3;
      this.ambientFx.push((dt) => {
        t += dt * 0.35;
        v.setPosition(W / 2 + Math.cos(t) * W * 0.3, H / 2 + Math.sin(t) * H * 0.28).setAngle((t * 180) / Math.PI + 90);
        v.setScale(S * 1.3, S * (1.1 + Math.sin(t * 12) * 0.25));
      });
    }
    // little dust devils
    let dt0 = 1.5;
    this.ambientFx.push((dt) => {
      dt0 -= dt;
      if (dt0 > 0) return;
      dt0 = 0.5 + Math.random() * 0.8;
      burst(this, 40 + Math.random() * (W - 80), 50 + Math.random() * (H - 100), { tex: 'dust', count: 3, tint: [0xf0d8a8, 0xe6c890], speed: [10, 30], life: 900, scale: [S * 0.6, 0], gravity: -20, depth: -1500, alpha: [0.5, 0] });
    });
  }

  // ─────────────────────────── BOOMERANGS ───────────────────────────

  private throwBoom(t: Thrower): void {
    if (t.out || this.state !== 'play') return;
    if (t.flying) { Audio.sfx('wrong', 1.2); return; }
    if (t.b.stun > 0) return;
    t.flying = true;
    t.bt = 0;
    t.hitSet.clear();
    const fx = Math.cos(t.fa), fy = Math.sin(t.fa);
    t.bx = t.b.x + fx * 14;
    t.by = t.b.y + fy * 14;
    t.bvx = fx * THROW_V;
    t.bvy = fy * THROW_V;
    Audio.sfx('throw', 1 + t.b.p * 0.1);
    t.b.avatar.play('attack', true);
    Vfx.squash(this, t.b.avatar.sprite, 1.2, 0.85, 140);
  }

  private updateBoom(t: Thrower, dt: number): void {
    t.bt += dt;
    const sp0 = Math.hypot(t.bvx, t.bvy) || 1;
    let vx = t.bvx, vy = t.bvy;
    if (t.bt < OUT_T) {
      const a = CURVE * dt;
      const c = Math.cos(a), s = Math.sin(a);
      [vx, vy] = [vx * c - vy * s, vx * s + vy * c];
    } else {
      // home back to the owner
      const ox = t.b.x - t.bx, oy = t.b.y - 12 - t.by;
      const want = Math.atan2(oy, ox);
      const cur = Math.atan2(vy, vx);
      const turn = (t.bt > 2.5 ? 14 : 5 + (t.bt - OUT_T) * 3) * dt;
      const na = Phaser.Math.Angle.RotateTo(cur, want, turn);
      const sp = Math.min(420, sp0 + 60 * dt);
      vx = Math.cos(na) * sp; vy = Math.sin(na) * sp;
    }
    t.bvx = vx; t.bvy = vy;
    let nx = t.bx + vx * dt, ny = t.by + vy * dt;
    // bounce off crates
    for (const c of this.crates) {
      const hx = CRATE_H + 4, hy = CRATE_H + 4;
      if (Math.abs(nx - c.x) < hx && Math.abs(ny - c.y) < hy) {
        const px = hx - Math.abs(nx - c.x), py = hy - Math.abs(ny - c.y);
        if (px < py) { t.bvx = -t.bvx; nx = c.x + Math.sign(nx - c.x) * hx; }
        else { t.bvy = -t.bvy; ny = c.y + Math.sign(ny - c.y) * hy; }
        Audio.sfx('bounce', 1.4);
        burst(this, nx, ny - BOOM_Z, { tex: 'dot2', count: 6, tint: [0xe8b070, 0xffffff], speed: [40, 110], life: 250, depth: 4000 });
        this.tweens.add({ targets: c.img, scaleX: S * 1.08, scaleY: S * 0.92, yoyo: true, duration: 70 });
        if (t.bt < OUT_T) t.bt = OUT_T; // a bounce sends it home early
      }
    }
    // bounce off the arena walls
    const R = this.bounds;
    if (nx < R.x) { nx = R.x; t.bvx = Math.abs(t.bvx); Audio.sfx('bounce', 1.2); if (t.bt < OUT_T) t.bt = OUT_T; }
    if (nx > R.right) { nx = R.right; t.bvx = -Math.abs(t.bvx); Audio.sfx('bounce', 1.2); if (t.bt < OUT_T) t.bt = OUT_T; }
    if (ny < R.y - 10) { ny = R.y - 10; t.bvy = Math.abs(t.bvy); Audio.sfx('bounce', 1.2); if (t.bt < OUT_T) t.bt = OUT_T; }
    if (ny > R.bottom) { ny = R.bottom; t.bvy = -Math.abs(t.bvy); Audio.sfx('bounce', 1.2); if (t.bt < OUT_T) t.bt = OUT_T; }
    t.bx = nx; t.by = ny;
    // hit rivals
    for (const o of this.throwers) {
      if (o === t || o.out || o.b.invuln > 0 || t.hitSet.has(o.b.p)) continue;
      if (Math.hypot(o.b.x - t.bx, o.b.y - 10 - t.by) < HIT_R) this.hit(t, o);
    }
    // catch
    if (t.bt > 0.3 && Math.hypot(t.b.x - t.bx, t.b.y - 12 - t.by) < CATCH_R) {
      t.flying = false;
      Audio.sfx('coin', 1 + t.b.p * 0.1);
      Vfx.sparkle(this, t.b.x, t.b.y - 26, [0xffffff, PLAYER_COLORS[t.b.p].light]);
      if (this.isCpu(t.b.p)) t.wait = 1.6 + (1 - t.skill) * 1.6 + Math.random() * 1.4;
    }
  }

  private hit(t: Thrower, o: Thrower): void {
    t.hitSet.add(o.b.p);
    o.lives--;
    t.hits++;
    this.addScore(t.b.p, 1);
    o.b.invuln = 2.4;
    const sp = Math.hypot(t.bvx, t.bvy) || 1;
    o.b.vx += (t.bvx / sp) * 260;
    o.b.vy += (t.bvy / sp) * 260;
    o.b.stun = Math.max(o.b.stun, 0.35);
    Vfx.hit(this, o.b.x, o.b.y - 24, [0xffffff, PLAYER_COLORS[t.b.p].light, 0xffe066]);
    Vfx.hitFlash(this, o.b.avatar.sprite);
    Audio.sfx('bigHit', 1 + o.b.p * 0.1);
    Vfx.shake(this, 0.004, 120);
    // a heart pops off
    const hx = o.b.x - 8 + o.lives * 8, hy = o.b.y - 76;
    const pop = this.add.image(hx, hy, `${ID}-heart`).setScale(S).setDepth(4000);
    this.tweens.add({ targets: pop, y: hy - 22, scale: S * 1.8, alpha: 0, duration: 450, onComplete: () => pop.destroy() });
    say(this, t.b.x, t.b.y - 84, 'โดน!', toCss(PLAYER_COLORS[t.b.p].light), 16, this.angleFor(t.b.p));
    if (o.lives <= 0) this.knockOut(o);
    else say(this, o.b.x, o.b.y - 92, `♥ ${o.lives}`, '#ffc2cc', 16, this.angleFor(o.b.p));
    this.refreshHud();
  }

  private knockOut(o: Thrower): void {
    o.out = true;
    const b = o.b;
    o.flying = false;
    o.boom.setVisible(false);
    o.boomShadow.setVisible(false);
    o.arrow.setVisible(false);
    for (const h of o.hearts) h.setVisible(false);
    o.chip.setVisible(false);
    this.time.delayedCall(250, () => {
      this.kit.kill(b);
      Audio.sfx('pop', 0.8);
      burst(this, b.x, b.y - 20, { tex: 'puff', count: 14, tint: [0xffffff, 0xf0d8a8, 0xe6c890], speed: [40, 140], life: 700, scale: [S * 1.2, 0], depth: 4000 });
      Vfx.sparkle(this, b.x, b.y - 30, [0xffe066, 0xffffff]);
      b.avatar.play('lose', true);
      const s = b.avatar.sprite;
      this.tweens.add({ targets: [s, b.avatar.ring!, b.avatar.shadow!].filter(Boolean), alpha: 0, delay: 500, duration: 500 });
      this.tweens.add({ targets: s, y: s.y - 10, delay: 500, duration: 500 });
    });
    say(this, b.x, b.y - 92, 'ออก!', '#ff7a85', 20, this.angleFor(b.p));
    this.eliminate(b.p);
  }

  // ─────────────────────────── LOOP ───────────────────────────

  ambient(dt: number): void {
    for (const f of this.ambientFx) f(dt);
    for (const t of this.throwers) {
      const st = t.b.stick;
      if (st && Math.hypot(st.vx, st.vy) > 0.3) t.fa = Math.atan2(st.vy, st.vx);
    }
    this.kit.update(dt, this.state === 'play');
    this.pushOutOfCrates();
    for (const t of this.throwers) this.syncThrower(t, dt);
  }

  private pushOutOfCrates(): void {
    for (const b of this.kit.alive) {
      for (const c of this.crates) {
        const h = CRATE_H + b.r * 0.6;
        const dx = b.x - c.x, dy = b.y - c.y;
        if (Math.abs(dx) >= h || Math.abs(dy) >= h) continue;
        const px = h - Math.abs(dx), py = h - Math.abs(dy);
        if (px < py) { b.x = c.x + Math.sign(dx || 1) * h; b.vx *= -0.3; }
        else { b.y = c.y + Math.sign(dy || 1) * h; b.vy *= -0.3; }
        b.avatar.setPos(b.x, b.y);
      }
    }
  }

  private syncThrower(t: Thrower, dt: number): void {
    const b = t.b;
    if (t.out) return;
    if (Math.abs(Math.cos(t.fa)) > 0.2 && Math.hypot(b.vx, b.vy) < 30) b.avatar.face(Math.cos(t.fa));
    // aim arrow on the ground
    t.arrow.setPosition(b.x + Math.cos(t.fa) * 22, b.y + Math.sin(t.fa) * 13).setRotation(t.fa).setDepth(b.y - 998);
    t.arrow.setAlpha(t.flying ? 0.3 : 0.9);
    // hearts + number chip above the head
    const top = b.y - 74;
    t.chip.setPosition(b.x - 18, top);
    t.hearts.forEach((h, i) => h.setPosition(b.x - 4 + i * 10, top + 1).setTexture(i < t.lives ? `${ID}-heart` : `${ID}-heart-empty`));
    if (t.flying) {
      t.spin += dt * 1100;
      t.boom.setPosition(t.bx, t.by - BOOM_Z).setAngle(t.spin).setDepth(t.by + 40).setScale(S);
      t.boomShadow.setVisible(true).setPosition(t.bx, t.by + 4).setDepth(-1000);
      t.trailT -= dt;
      if (t.trailT <= 0) {
        t.trailT = 0.03;
        const ghost = this.add.image(t.bx, t.by - BOOM_Z, `${ID}-boom-${b.p}`).setScale(S).setAngle(t.spin).setAlpha(0.35).setDepth(t.by + 39).setTint(PLAYER_COLORS[b.p].light);
        this.tweens.add({ targets: ghost, alpha: 0, scale: S * 0.6, duration: 180, onComplete: () => ghost.destroy() });
      }
    } else {
      // held in the hand
      const f = b.avatar.facing;
      t.boom.setPosition(b.x + f * 10, b.y - 26 - b.avatar.z + Math.sin(this.elapsed * 6) * 1).setAngle(f > 0 ? 20 : -20).setDepth(b.y + 2).setScale(S * 0.9);
      t.boomShadow.setVisible(false);
    }
  }

  tick(dt: number): void {
    for (const t of this.throwers) if (t.flying && !t.out) this.updateBoom(t, dt);
    for (const t of this.throwers) if (!t.out && this.isCpu(t.b.p)) this.bot(t, dt);
  }

  // ─────────────────────────── CPU ───────────────────────────

  private lineClear(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let k = 1; k < 8; k++) {
      const f = k / 8;
      const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
      for (const c of this.crates) if (Math.abs(x - c.x) < CRATE_H + 4 && Math.abs(y - c.y) < CRATE_H + 4) return false;
    }
    return true;
  }

  private bot(t: Thrower, dt: number): void {
    const b = t.b;
    const foes = this.throwers.filter((o) => o !== t && !o.out);
    if (!foes.length) return;
    t.think -= dt;
    t.wait -= dt;
    t.dodge -= dt;
    const dist = (o: Thrower) => Math.hypot(o.b.x - b.x, o.b.y - b.y);
    const tgt = foes.reduce((m, o) => (dist(o) + o.lives * 30 < dist(m) + m.lives * 30 ? o : m));
    const d = dist(tgt);
    // dodge incoming boomerangs
    if (t.dodge <= 0) {
      for (const o of foes) {
        if (!o.flying) continue;
        const rx = b.x - o.bx, ry = b.y - 10 - o.by;
        const sp2 = o.bvx * o.bvx + o.bvy * o.bvy || 1;
        const tc = (rx * o.bvx + ry * o.bvy) / sp2;
        if (tc < 0 || tc > 0.55) continue;
        const cx = o.bx + o.bvx * tc, cy = o.by + o.bvy * tc;
        const miss = Math.hypot(b.x - cx, b.y - 10 - cy);
        if (miss < 36 && Math.random() < 0.5 + t.skill * 0.5) {
          const sp = Math.sqrt(sp2);
          let px = -o.bvy / sp, py = o.bvx / sp;
          if ((b.x - cx) * px + (b.y - cy) * py < 0) { px = -px; py = -py; }
          t.dodge = 0.35 + t.skill * 0.15;
          t.dodgeX = b.x + px * 70; t.dodgeY = b.y + py * 70;
          break;
        }
      }
    }
    if (t.dodge > 0) {
      b.botTarget = { x: t.dodgeX, y: t.dodgeY };
    } else {
      if (t.think <= 0) { t.think = 0.6 + Math.random() * 0.8; if (Math.random() < 0.35) t.strafe = -t.strafe; }
      const want = t.flying ? 120 : 170;
      const ux = (tgt.b.x - b.x) / (d || 1), uy = (tgt.b.y - b.y) / (d || 1);
      let tx = b.x + ux * (d - want) * 0.6 - uy * t.strafe * 50;
      let ty = b.y + uy * (d - want) * 0.6 + ux * t.strafe * 50;
      // drift toward my own returning boomerang to catch it sooner
      if (t.flying && t.bt > OUT_T) { tx = (tx + t.bx) / 2; ty = (ty + t.by) / 2; }
      b.botTarget = { x: tx, y: ty };
    }
    // aim & throw
    if (!t.flying) {
      const lead = (d / THROW_V) * 0.6 * t.skill;
      const px = tgt.b.x + tgt.b.vx * lead, py = tgt.b.y + tgt.b.vy * lead;
      const pd = Math.hypot(px - b.x, py - b.y);
      const curveComp = (CURVE * Math.min(OUT_T, pd / THROW_V)) / 2;
      const aim = Math.atan2(py - b.y, px - b.x) - curveComp + (Math.random() - 0.5) * 1.1 * (1.3 - t.skill);
      t.fa = Phaser.Math.Angle.RotateTo(t.fa, aim, 8 * dt);
      if (t.wait <= 0 && pd < 250 && Phaser.Math.Angle.ShortestBetween((t.fa * 180) / Math.PI, (aim * 180) / Math.PI) ** 2 < 100 && this.lineClear(b.x, b.y, px, py)) {
        this.throwBoom(t);
        t.wait = 0.8 + Math.random() * 0.8;
      }
    } else if (Math.hypot(b.vx, b.vy) > 20) t.fa = Math.atan2(b.vy, b.vx);
  }

  results(): PlayerResult[] {
    const val = (p: PlayerIndex) => {
      const i = this.eliminated.indexOf(p);
      const t = this.thrower(p);
      return i === -1 ? 1000 + (t?.lives ?? 0) * 10 + (t?.hits ?? 0) * 0.01 : i;
    };
    return rankBy(this.players, val).map((r) => ({ ...r, score: this.thrower(r.player)?.hits ?? 0 }));
  }
}

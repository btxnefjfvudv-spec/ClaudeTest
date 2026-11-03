import Phaser from 'phaser';
import { S } from '../../art/common';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'ice-survival';
const TILE = 32;
/** Seconds of standing per crack stage. */
const STAGE_T = 0.65;
const HOP_T = 0.62;
const HOP_H = 34;
const HOP_CD = 0.95;
const MELT_AT = 28;
const HARD_CAP = 100;

interface Tile {
  gx: number; gy: number; x: number; y: number;
  img: Phaser.GameObjects.Image; crack: Phaser.GameObjects.Image; side: Phaser.GameObjects.Image;
  stage: number; stress: number; broken: boolean; breakT: number;
}

function say(scene: Phaser.Scene, x: number, y: number, s: string, color: string, size: number, angle: number): void {
  const t = txt(scene, x, y, s, { size, color, strokeWidth: 4 }).setDepth(4500).setAngle(angle).setScale(0.4);
  const up = angle === 180 ? 26 : -26;
  scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: t, y: y + up, alpha: 0, delay: 420, duration: 420, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
}

/** #10 — Slippery ice that cracks under your feet. Hop the holes, last one dry wins. */
export default class IceSurvival extends BaseMinigame {
  private kit!: ArenaKit;
  private tiles: Tile[] = [];
  private grid = new Map<string, Tile>();
  private ox = 0;
  private oy = 0;
  private ambientFx: ((dt: number) => void)[] = [];
  private meltT = 0;
  private survived = [0, 0, 0, 0];
  private meltWarned = false;
  /** Debug: how players fell in (read by test tools). */
  deaths: string[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.tiles = [];
    this.grid.clear();
    this.ambientFx = [];
    this.meltT = 0;
    this.meltWarned = false;
    this.deaths = [];
    this.survived = [0, 0, 0, 0];
    this.paintArt();
    this.buildWater();
    this.buildIce();
    this.buildAmbient();
    const W = this.vw, H = this.vh;
    this.kit = new ArenaKit(this, {
      speed: 140, accel: 1400, grip: 0.08, radius: 11, dash: false, action: 'jump', bounce: 0.85,
      spawn: (p) => this.tileCenter(p % 2 === 0 ? -3 : 3, p < 2 ? -2 : 2),
    });
    for (const b of this.kit.bodies) {
      b.data.z = 0; b.data.vz = 0; b.data.air = 0; b.data.hopCd = 0; b.data.coyote = 0;
      b.data.skill = 0.55 + Math.random() * 0.4;
      b.data.think = Math.random() * 0.3;
      b.data.tx = b.x; b.data.ty = b.y;
      b.avatar.face(b.x < W / 2 ? 1 : -1);
    }
    void H;
    this.kit.onAction = (b, down) => { if (down) this.hop(b); };
    for (const p of this.players) this.hudText[p] = 'OK';
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    for (let v = 0; v < 3; v++) {
      makeTexture(this, `${ID}-tile-${v}`, 16, 16, (p) => {
        const r = rng(50 + v);
        p.rect(0, 0, 16, 16, 0xbfe9fb);
        p.dither(0, 9, 16, 7, 0xbfe9fb, 0xa9dcf5, 0.5);
        p.hline(0, 0, 16, 0xf2fcff); p.vline(0, 0, 16, 0xe2f6ff);
        p.hline(0, 15, 16, 0x8fc8ea); p.vline(15, 0, 16, 0x98cfee);
        // frosty streaks
        for (let i = 0; i < 3; i++) {
          const x = 2 + Math.floor(r() * 9), y = 2 + Math.floor(r() * 10);
          p.line(x, y + 3, x + 3, y, 0xe9f9ff);
        }
        // trapped bubbles
        for (let i = 0; i < 2 + v; i++) p.px(2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12), 0xdff5ff);
        p.px(11, 4, 0xffffff); p.px(12, 4, 0xffffff); p.px(12, 3, 0xffffff);
      });
    }
    makeTexture(this, `${ID}-side`, 16, 6, (p) => {
      p.rect(0, 0, 16, 6, 0x5fa6d3);
      p.hline(0, 0, 16, 0x7fc1e6);
      p.hline(0, 5, 16, 0x2f6f9f);
      for (const x of [2, 7, 12]) { p.px(x, 6 - 1, 0x9fd8f4); }
      p.px(4, 2, 0x8fcdee); p.px(10, 3, 0x8fcdee);
    });
    // crack overlays (stage 1..3)
    makeSheet(this, `${ID}-crack`, 16, 16, 3, (p, i) => {
      const line = 0xffffff, deep = 0x5d97c4;
      const segs: [number, number, number, number][][] = [
        [[8, 8, 4, 4], [8, 8, 11, 6]],
        [[8, 8, 4, 4], [8, 8, 11, 6], [8, 8, 6, 13], [4, 4, 1, 3], [11, 6, 14, 9]],
        [[8, 8, 4, 4], [8, 8, 11, 6], [8, 8, 6, 13], [4, 4, 1, 3], [11, 6, 14, 9], [8, 8, 13, 13], [8, 8, 9, 1], [6, 13, 2, 14], [4, 4, 2, 9]],
      ];
      for (const [x0, y0, x1, y1] of segs[i]) { p.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1, deep); }
      for (const [x0, y0, x1, y1] of segs[i]) p.line(x0, y0, x1, y1, line);
      if (i === 2) {
        // fragments darkening between cracks
        p.dither(1, 9, 5, 4, 0x8cc3e6, 0x6fadd8, 0.5);
        p.dither(10, 2, 4, 3, 0x8cc3e6, 0x6fadd8, 0.5);
        p.px(8, 8, 0x3f7fb0);
      }
    });
    makeTexture(this, `${ID}-shard`, 8, 8, (p) => {
      p.tri(0, 7, 7, 6, 3, 0, 0xbfe9fb);
      p.line(3, 1, 1, 6, 0xf2fcff);
      p.outline(-0.5);
    });
    makeTexture(this, `${ID}-water`, 48, 48, (p) => {
      const r = rng(77);
      p.rect(0, 0, 48, 48, 0x17476d);
      for (let i = 0; i < 30; i++) p.hline(Math.floor(r() * 48), Math.floor(r() * 48), 3 + Math.floor(r() * 5), 0x1d5580);
      for (let i = 0; i < 14; i++) p.px(Math.floor(r() * 48), Math.floor(r() * 48), 0x123a5a);
    });
    makeTexture(this, `${ID}-water-hi`, 64, 64, (p) => {
      const r = rng(78);
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(r() * 60), y = Math.floor(r() * 62);
        p.hline(x, y, 5, 0x5d9fcf); p.hline(x + 1, y + 1, 3, 0x3c7cab);
      }
      for (let i = 0; i < 6; i++) p.px(Math.floor(r() * 64), Math.floor(r() * 64), 0xcfeeff);
    });
    makeTexture(this, `${ID}-floe`, 30, 18, (p) => {
      p.ellipse(15, 11, 14, 6, 0x5fa6d3);
      p.ellipse(15, 9, 14, 6.5, 0xdff4ff);
      p.ellipse(12, 8, 8, 3, 0xf6fdff);
      p.outline(-0.6);
    });
    makeTexture(this, `${ID}-floe-s`, 16, 10, (p) => {
      p.ellipse(8, 6, 7, 3.5, 0x5fa6d3);
      p.ellipse(8, 5, 7, 3.5, 0xdff4ff);
      p.outline(-0.6);
    });
    makeSheet(this, `${ID}-penguin`, 12, 15, 2, (p, i) => {
      const b = 0x2b3263;
      p.ball(6, 9, 4.5, 5.5, b, false);
      p.ellipse(6, 10, 3, 4, 0xfff8e7);
      p.ball(6, 4, 3.5, 3.2, b, false);
      p.px(5, 4, 0xffffff); p.px(7, 4, 0xffffff); p.px(5, 4, 0x1b1f3b);
      p.rect(5, 5, 3, 1, 0xff9f43);
      p.rect(3, 14, 2, 1, 0xff9f43); p.rect(7, 14, 2, 1, 0xff9f43);
      if (i === 0) { p.px(1, 8, b); p.px(1, 9, b); p.px(11, 8, b); p.px(11, 9, b); }
      else { p.px(0, 7, b); p.px(1, 8, b); p.px(11, 7, b); p.px(12, 6, b); }
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-fish`, 10, 6, (p) => {
      p.ellipse(4, 3, 4, 2, 0xff9f43);
      p.tri(7, 3, 10, 0, 10, 6, 0xff7a3d);
      p.px(2, 2, 0x1b1f3b);
      p.outline(-0.6);
    });
    makeTexture(this, `${ID}-cube`, 24, 26, (p) => {
      p.rect(1, 3, 22, 22, 0x8fd0f0, 150);
      p.rect(2, 2, 20, 20, 0xbfe9fb, 120);
      p.hline(2, 2, 20, 0xffffff); p.vline(2, 2, 20, 0xf2fcff);
      p.line(4, 6, 8, 2, 0xffffff); p.line(5, 9, 10, 4, 0xe9f9ff);
      p.hline(1, 24, 22, 0x5fa6d3); p.vline(22, 3, 22, 0x6fb3d9);
    });
    makeTexture(this, `${ID}-snow`, 3, 3, (p) => { p.px(1, 0, 0xffffff); p.px(0, 1, 0xffffff); p.px(1, 1, 0xffffff); p.px(2, 1, 0xffffff); p.px(1, 2, 0xffffff); });
  }

  private buildWater(): void {
    const W = this.vw, H = this.vh;
    const a = this.add.tileSprite(0, 0, W / S, H / S, `${ID}-water`).setOrigin(0).setScale(S).setDepth(-3000);
    const b = this.add.tileSprite(0, 0, W / S, H / S, `${ID}-water-hi`).setOrigin(0).setScale(S).setDepth(-2990).setAlpha(0.7);
    let t = 0;
    this.ambientFx.push((dt) => {
      t += dt;
      a.tilePositionX = Math.sin(t * 0.3) * 8;
      a.tilePositionY = t * 2;
      b.tilePositionX = -t * 5;
      b.tilePositionY = Math.cos(t * 0.5) * 5;
      b.setAlpha(0.5 + Math.sin(t * 1.7) * 0.2);
    });
  }

  private tileCenter(gx: number, gy: number): { x: number; y: number } {
    return { x: this.ox + gx * TILE, y: this.oy + gy * TILE };
  }

  private buildIce(): void {
    this.ox = Math.round(this.vw / 2);
    this.oy = Math.round(this.vh / 2);
    const nx = Math.floor((this.vw - 120) / TILE / 2);
    const ny = Math.floor((this.vh - 90) / TILE / 2);
    const r = rng(1010);
    // symmetric ragged ice sheet: ellipse with a few bays
    const holes = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const hx = 1 + Math.floor(r() * (nx - 1)), hy = Math.floor(r() * ny);
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) holes.add(`${hx * sx},${hy * sy}`);
    }
    for (let gy = -ny; gy <= ny; gy++) {
      for (let gx = -nx; gx <= nx; gx++) {
        const e = (gx / (nx + 0.6)) ** 2 + (gy / (ny + 0.6)) ** 2;
        if (e > 1) continue;
        if (holes.has(`${gx},${gy}`) && Math.abs(gx) > 0 && Math.abs(gy) > 0 && e > 0.25) continue;
        const { x, y } = this.tileCenter(gx, gy);
        const depth = -2500 + (gy + ny) * 4;
        const side = this.add.image(x, y + TILE / 2 + 5, `${ID}-side`).setScale(S).setDepth(depth - 2);
        const img = this.add.image(x, y, `${ID}-tile-${(Math.abs(gx * 7 + gy * 13)) % 3}`).setScale(S).setDepth(depth);
        const crack = this.add.image(x, y, `${ID}-crack`, 0).setScale(S).setDepth(depth + 1).setVisible(false);
        const t: Tile = { gx, gy, x, y, img, crack, side, stage: 0, stress: 0, broken: false, breakT: 0 };
        this.tiles.push(t);
        this.grid.set(`${gx},${gy}`, t);
      }
    }
    // frosty sparkle glints on random tiles
    this.ambientFx.push(() => {
      if (Math.random() < 0.08) {
        const t = this.tiles[Math.floor(Math.random() * this.tiles.length)];
        if (t && !t.broken) {
          const g = this.add.image(t.x + (Math.random() - 0.5) * 20, t.y + (Math.random() - 0.5) * 20, 'spark').setScale(S * 0.6).setDepth(-2000).setTint(0xffffff);
          this.tweens.add({ targets: g, scale: S * 1.1, alpha: 0, angle: 45, duration: 500, onComplete: () => g.destroy() });
        }
      }
    });
  }

  private buildAmbient(): void {
    const W = this.vw, H = this.vh;
    // drifting floes, some with penguins
    const spots = [[30, 70], [W - 40, 120], [40, H - 90], [W - 30, H - 60], [W * 0.5, 22], [W * 0.5 + 120, H - 18]];
    spots.forEach(([x0, y0], i) => {
      const big = i < 4;
      const f = this.add.image(x0, y0, big ? `${ID}-floe` : `${ID}-floe-s`).setScale(S).setDepth(-2800);
      const peng = big && i % 2 === 0 ? this.add.sprite(x0, y0 - 4, `${ID}-penguin`, 0).setOrigin(0.5, 1).setScale(S).setDepth(-2799) : undefined;
      let t = i * 3;
      this.ambientFx.push((dt) => {
        t += dt;
        const x = x0 + Math.sin(t * 0.25) * 14, y = y0 + Math.sin(t * 0.9) * 2;
        f.setPosition(x, y);
        if (peng) {
          peng.setPosition(x, y + 2);
          peng.setFrame(Math.floor(t * 1.3) % 5 === 0 ? 1 : 0);
          peng.setFlipX(Math.sin(t * 0.25) < 0);
        }
      });
    });
    // falling snow
    const snow = this.add.particles(0, 0, `${ID}-snow`, {
      x: { min: -40, max: W + 40 }, y: -10, lifespan: 9000, speedY: { min: 18, max: 36 }, speedX: { min: -6, max: 14 },
      scale: { min: S * 0.5, max: S }, alpha: { start: 0.85, end: 0.4 }, frequency: 160, quantity: 1,
    });
    snow.setDepth(3000);
    snow.fastForward(9000);
    // occasional fish jump
    let fishT = 3;
    this.ambientFx.push((dt) => {
      fishT -= dt;
      if (fishT > 0) return;
      fishT = 4 + Math.random() * 5;
      const edge = Math.random() < 0.5;
      const x = edge ? 24 + Math.random() * 40 : W - 24 - Math.random() * 40;
      const y = 40 + Math.random() * (H - 80);
      if (this.onIce(x, y)) return;
      const fish = this.add.image(x, y, `${ID}-fish`).setScale(S).setDepth(-2700).setFlipX(!edge);
      this.tweens.add({ targets: fish, y: y - 30, angle: edge ? -40 : 40, duration: 380, ease: 'Quad.easeOut', yoyo: true, onComplete: () => { fish.destroy(); this.ripple(x, y); } });
      this.ripple(x, y);
    });
  }

  private ripple(x: number, y: number): void {
    const ring = this.add.image(x, y, 'ring').setScale(0.4, 0.2).setDepth(-2790).setTint(0xcfeeff).setAlpha(0.8);
    this.tweens.add({ targets: ring, scaleX: 1.6, scaleY: 0.7, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
  }

  // ─────────────────────────── ICE ───────────────────────────

  private tileAt(x: number, y: number): Tile | undefined {
    const gx = Math.round((x - this.ox) / TILE), gy = Math.round((y - this.oy) / TILE);
    return this.grid.get(`${gx},${gy}`);
  }

  private onIce(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return !!t && !t.broken;
  }

  private stress(t: Tile, amount: number): void {
    if (t.broken || t.stage >= 4) return;
    t.stress += amount;
    while (t.stress >= 1 && t.stage < 4) {
      t.stress -= 1;
      t.stage++;
      if (t.stage <= 3) this.showCrack(t);
      else this.breakTile(t);
    }
  }

  private showCrack(t: Tile): void {
    t.crack.setVisible(true).setFrame(t.stage - 1);
    t.img.setTint([0xffffff, 0xeef8ff, 0xd9edff, 0xbcd8f5][t.stage]);
    Audio.sfx(t.stage === 3 ? 'stun' : 'tick', 1.6 + t.stage * 0.25);
    burst(this, t.x, t.y, { tex: 'dot2', count: 3 + t.stage * 2, tint: [0xffffff, 0xdff4ff], speed: [30, 80], life: 300, depth: -1990 });
    this.tweens.add({ targets: [t.img, t.crack], x: t.x + 1.5, yoyo: true, repeat: 2, duration: 40, onComplete: () => { t.img.x = t.x; t.crack.x = t.x; } });
  }

  private breakTile(t: Tile): void {
    t.broken = true;
    t.img.setVisible(false);
    t.crack.setVisible(false);
    t.side.setVisible(false);
    Audio.sfx('splash', 1.1 + Math.random() * 0.3);
    Audio.sfx('hit', 1.8);
    for (let i = 0; i < 4; i++) {
      const sx = t.x + (i % 2 ? 7 : -7), sy = t.y + (i < 2 ? -7 : 7);
      const sh = this.add.image(sx, sy, `${ID}-shard`).setScale(S).setDepth(-2600).setAngle(i * 90 + Math.random() * 30);
      this.tweens.add({
        targets: sh, x: sx + (i % 2 ? 10 : -10), y: sy + (i < 2 ? -6 : 10), angle: sh.angle + Phaser.Math.Between(-60, 60),
        scale: S * 0.5, alpha: 0, duration: 900, ease: 'Quad.easeIn', onComplete: () => sh.destroy(),
      });
      sh.setTint(0xa9dcf5);
    }
    burst(this, t.x, t.y, { tex: 'dot3', count: 12, tint: [0xffffff, 0xbfeaff, 0x6cc8f4], speed: [50, 150], angle: [190, 350], gravity: 300, life: 600, depth: -1980 });
    this.ripple(t.x, t.y);
    // the tile above now shows its icy edge
    const above = this.grid.get(`${t.gx},${t.gy - 1}`);
    if (above && !above.broken) above.side.setVisible(true);
  }

  // ─────────────────────────── PLAYERS ───────────────────────────

  private hop(b: ArenaBody): void {
    if (!b.alive || this.state !== 'play' || b.data.air > 0 || b.data.hopCd > 0) return;
    b.data.air = HOP_T;
    b.data.hopCd = HOP_CD;
    // a little push in the stick direction so you can clear gaps
    let dx = b.ix, dy = b.iy;
    const l = Math.hypot(dx, dy);
    if (l < 0.2) { const sp = Math.hypot(b.vx, b.vy) || 1; dx = b.vx / sp; dy = b.vy / sp; }
    else { dx /= l; dy /= l; }
    b.vx += dx * 55; b.vy += dy * 55;
    Audio.sfx('jump', 1 + b.p * 0.1);
    Vfx.squash(this, b.avatar.sprite, 0.75, 1.3, 180);
    burst(this, b.x, b.y, { tex: 'dot2', count: 6, tint: [0xffffff, 0xdff4ff], speed: [30, 70], angle: [180, 360], life: 300, depth: -1000 });
  }

  private land(b: ArenaBody): void {
    Audio.sfx('land', 1 + b.p * 0.1);
    Vfx.squash(this, b.avatar.sprite, 1.3, 0.75, 160);
    const t = this.tileAt(b.x, b.y);
    if (t && !t.broken) {
      // heavy landing cracks the ice a stage
      this.stress(t, 1);
      burst(this, b.x, b.y, { tex: 'dust', count: 6, tint: [0xffffff, 0xe9f9ff], speed: [30, 70], angle: [180, 360], life: 350, scale: [S * 0.7, 0], depth: -1000 });
    }
  }

  private fall(b: ArenaBody): void {
    const ht = this.tileAt(b.x - b.vx * 0.2, b.y - b.vy * 0.2);
    this.deaths.push(`${b.p}:v${Math.round(Math.hypot(b.vx, b.vy))} hit${b.lastHitBy ?? '-'} st${b.stun.toFixed(1)} prev${ht ? ht.stage + (ht.broken ? 'B' : '') : '-'}`);
    this.kit.kill(b);
    this.survived[b.p] = this.elapsed;
    const av = b.avatar;
    av.play('fall', true);
    av.marker?.setVisible(false);
    av.ring?.setVisible(false);
    av.shadow?.setVisible(false);
    const s = av.sprite;
    s.setTint(0x9fd8ff);
    Audio.sfx('splash', 0.9);
    Vfx.shake(this, 0.005, 160);
    burst(this, b.x, b.y, { tex: 'dot3', count: 24, tint: [0xffffff, 0xbfeaff, 0x6cc8f4], speed: [60, 220], angle: [200, 340], gravity: 500, life: 700, depth: 2000 });
    this.ripple(b.x, b.y);
    this.tweens.add({ targets: s, y: s.y + 26, alpha: 0, scaleY: S * 0.6, duration: 450, ease: 'Quad.easeIn' });
    say(this, b.x, b.y - 50, 'หนาวววว!', '#bfeaff', 18, this.angleFor(b.p));
    // pop back up frozen in an ice cube, bobbing in the water
    const x = b.x, y = b.y;
    this.time.delayedCall(700, () => {
      const c = this.add.container(x, y).setDepth(-1500);
      const frozen = this.add.sprite(0, -2, av.key, 13).setOrigin(0.5, 0.5).setScale(S * 0.45).setTint(0x9fcff0).setAngle(-12);
      const cube = this.add.image(0, 0, `${ID}-cube`).setScale(S * 0.72);
      const tag = this.add.image(0, -28, av.marker?.texture.key ?? 'px').setScale(S * 0.8).setAngle(this.angleFor(b.p));
      c.add([frozen, cube, tag]);
      c.setScale(0.3);
      this.tweens.add({ targets: c, scale: 1, duration: 300, ease: 'Back.easeOut' });
      this.tweens.add({ targets: c, y: y + 3, angle: 6, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.easeInOut' });
      this.ripple(x, y);
      Audio.sfx('freeze', 1 + b.p * 0.1);
    });
    this.eliminate(b.p);
    for (const p of this.players) this.hudText[p] = this.alive(p) ? 'OK' : 'OUT';
  }

  ambient(dt: number): void {
    for (const f of this.ambientFx) f(dt);
    for (const b of this.kit.alive) {
      // hop arc
      if (b.data.air > 0) {
        b.data.air = Math.max(0, b.data.air - dt);
        const k = 1 - b.data.air / HOP_T;
        b.avatar.z = Math.sin(k * Math.PI) * HOP_H;
        if (b.data.air === 0) { b.avatar.z = 0; if (this.state === 'play') this.land(b); }
      }
      b.data.hopCd = Math.max(0, b.data.hopCd - dt);
    }
    this.kit.update(dt, this.state === 'play');
    for (const b of this.kit.alive) {
      if (b.data.air > 0) b.avatar.play(b.data.air > HOP_T / 2 ? 'jump' : 'fall');
      else if (Math.hypot(b.vx, b.vy) > 25 && Math.hypot(b.ix, b.iy) < 0.1) b.avatar.play('idle'); // sliding
    }
  }

  tick(dt: number): void {
    if (this.elapsed > HARD_CAP) return this.finish();
    // ice under feet cracks
    for (const b of this.kit.alive) {
      if (b.data.air > 0) continue;
      const t = this.tileAt(b.x, b.y);
      if (t && !t.broken) {
        b.data.coyote = 0.08;
        this.stress(t, dt / STAGE_T);
      } else {
        b.data.coyote -= dt;
        if (b.data.coyote <= 0) this.fall(b);
      }
    }
    // sudden death: the sun comes out and the ice starts melting by itself
    if (this.elapsed > MELT_AT) {
      if (!this.meltWarned) {
        this.meltWarned = true;
        Audio.sfx('power', 0.8);
        for (const [deg, y] of [[0, this.vh * 0.64], [180, this.vh * 0.36]] as const) {
          const t = txt(this, this.vw / 2, y, 'น้ำแข็งเริ่มละลาย!', { size: 26, color: '#bfeaff', strokeWidth: 6 }).setAngle(deg).setDepth(3500);
          this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
          this.tweens.add({ targets: t, alpha: 0, delay: 1300, duration: 300, onComplete: () => t.destroy() });
        }
      }
      this.meltT -= dt;
      if (this.meltT <= 0) {
        this.meltT = Math.max(0.12, 0.6 - (this.elapsed - MELT_AT) * 0.012);
        const left = this.tiles.filter((t) => !t.broken);
        if (left.length) this.stress(left[Math.floor(Math.random() * left.length)], 1);
      }
    }
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b, dt);
  }

  // ─────────────────────────── CPU ───────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    const skill = b.data.skill;
    b.data.think -= dt;
    const here = this.tileAt(b.x, b.y);
    const look = 0.3 + skill * 0.15;
    const danger = !this.onIce(b.x + b.vx * look, b.y + b.vy * look);
    const atTarget = Math.hypot(b.data.tx - b.x, b.data.ty - b.y) < 18;
    const tt = this.tileAt(b.data.tx, b.data.ty);
    const targetBad = !tt || tt.broken || tt.stage >= 2;
    if (b.data.think <= 0 || atTarget || targetBad) {
      b.data.think = 1.2 + Math.random() * 0.6;
      void danger;
      const solid = this.tiles.filter((t) => !t.broken);
      let mx = 0, my = 0;
      for (const t of solid) { mx += t.x; my += t.y; }
      mx /= Math.max(1, solid.length); my /= Math.max(1, solid.length);
      let best: Tile | undefined, bestSc = -1e9;
      for (const t of solid) {
        const d = Math.hypot(t.x - b.x, t.y - b.y);
        if (d > TILE * 4.5) continue;
        let sc = -t.stage * 35 - Math.max(0, Math.hypot(t.x - mx, t.y - my) - TILE * 3) * 0.3 - Math.abs(d - TILE * 2.5) * 0.25 - (d < TILE * 0.8 ? 40 : 0);
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const q = this.grid.get(`${t.gx + dx},${t.gy + dy}`);
          if (q && !q.broken) n += q.stage < 2 ? 1 : 0.4;
        }
        sc += n * 12;
        if (t === here) sc -= 60;
        // is the straight slide there safe?
        for (let k = 1; k <= 4; k++) {
          const f = k / 4;
          if (!this.onIce(b.x + (t.x - b.x) * f, b.y + (t.y - b.y) * f)) { sc -= skill > 0.75 ? 60 : 110; break; }
        }
        for (const o of this.kit.alive) {
          if (o === b) continue;
          const od = Math.hypot(o.x - t.x, o.y - t.y);
          if (od < 100) sc -= (100 - od) * 1.3;
        }
        sc += Math.random() * 30 * (1.3 - skill);
        if (sc > bestSc) { bestSc = sc; best = t; }
      }
      if (best) { b.data.tx = best.x; b.data.ty = best.y; }
    }
    // PD steering: aim the acceleration, not just the direction, so we brake on ice
    const kp = 2.2, kd = 0.9 + skill * 0.45;
    const ax = (b.data.tx - b.x) * kp - b.vx * kd;
    const ay = (b.data.ty - b.y) * kp - b.vy * kd;
    const al = Math.hypot(ax, ay);
    b.botTarget = al < 8 ? { x: b.x, y: b.y } : { x: b.x + (ax / al) * 60, y: b.y + (ay / al) * 60 };
    // about to slide into the water: slam the brakes (skilled CPUs notice sooner)
    if (danger && b.data.air <= 0 && Math.random() < 0.4 + skill * 0.6) {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      b.botTarget = { x: b.x - (b.vx / sp) * 60, y: b.y - (b.vy / sp) * 60 };
    }
    // hop over the water we are sliding into
    if (danger && b.data.air <= 0 && b.data.hopCd <= 0 && Math.random() < (2 + skill * 12) * dt) {
      const lx = b.x + b.vx * HOP_T * 1.1, ly = b.y + b.vy * HOP_T * 1.1;
      if (this.onIce(lx, ly) || Math.random() < 0.2) this.hop(b);
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


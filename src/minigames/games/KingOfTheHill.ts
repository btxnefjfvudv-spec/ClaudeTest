import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { crownKey } from '../../art/stage';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'king-of-the-hill';
const M = 22;
const ZONE_ART_R = 30;
const PTS_EVERY = 0.25;

/** #43 — Hold the drifting crown zone alone to score; shove rivals out with dashes. */
export default class KingOfTheHill extends BaseMinigame {
  private kit!: ArenaKit;
  private field!: Phaser.Geom.Rectangle;
  private zx = 0;
  private zy = 0;
  private zr = 58;
  private phase = 0;
  private fill!: Phaser.GameObjects.Image;
  private ring!: Phaser.GameObjects.Image;
  private beam!: Phaser.GameObjects.Image;
  private crown!: Phaser.GameObjects.Image;
  private crowns: Phaser.GameObjects.Image[] = [];
  private king: PlayerIndex | -1 = -1;
  private holdT = [0, 0, 0, 0];
  private kingTime = [0, 0, 0, 0];
  private crackleT = 0;
  private bolts: Phaser.GameObjects.Sprite[] = [];
  private cloudShadows: Phaser.GameObjects.Image[] = [];
  private butterflies: { img: Phaser.GameObjects.Sprite; t: number; x: number; y: number; s: number }[] = [];
  private stage = 0;
  private contested = false;
  private streak = 0;

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.king = -1;
    this.holdT = [0, 0, 0, 0];
    this.kingTime = [0, 0, 0, 0];
    this.crowns = [];
    this.bolts = [];
    this.cloudShadows = [];
    this.butterflies = [];
    this.stage = 0;
    this.phase = Math.random() * 10;
    this.zr = 58;
    this.contested = false;
    this.streak = 0;
    this.zoneClock = 0;
    const W = this.vw, H = this.vh;
    this.field = new Phaser.Geom.Rectangle(M, M, W - M * 2, H - M * 2);
    this.paintArt();
    this.paintHill();
    this.placeZone(0);
    this.kit = new ArenaKit(this, {
      speed: 155, accel: 900, radius: 13, dashSpeed: 460, dashCooldown: 1.05, bounce: 0.85, bounds: this.field,
      spawn: (p) => ({ x: (p % 2 === 0 ? 0.16 : 0.84) * W, y: (p < 2 ? 0.24 : 0.76) * H }),
    });
    this.kit.dashHit = 1.6;
    this.kit.onBump = (a, b, power) => {
      // A dash hit really launches the victim (it's a shove game).
      for (const [hitter, victim] of [[a, b], [b, a]] as const) {
        if (hitter.dashT <= 0 || victim.dashT > 0) continue;
        this.kit.knock(victim, hitter.x, hitter.y, 230, 0.55);
        Vfx.popText(this, victim.x, victim.y - 80, 'ปั้ก!', '#ffffff', 15, this.angleFor(victim.p));
        burst(this, victim.x, victim.y - 20, { tex: 'dust', count: 8, tint: [0xe9e2d0, 0xffffff], speed: [60, 160], life: 400, scale: [S, 0] });
      }
      void power;
    };
    for (const b of this.kit.bodies) {
      b.data.skill = 0.55 + Math.random() * 0.4;
      b.data.react = 0;
      b.data.ox = 0;
      b.data.oy = 0;
      this.crowns[b.p] = this.add.image(b.x, b.y, crownKey(this)).setScale(S).setVisible(false);
    }
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    const D = ZONE_ART_R * 2 + 2;
    makeTexture(this, `${ID}-fill`, D, D, (p) => {
      const c = ZONE_ART_R + 1;
      for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / ZONE_ART_R;
        if (d > 1) continue;
        const th = (((x & 1) * 2 + (y & 1)) + 0.5) / 4;
        // solid centre, dithered brighter band toward the rim
        p.px(x, y, d > 0.72 && 0.4 + (d - 0.72) * 2 > th ? 0xffffff : 0xd8d8d8);
      }
      // radial "sun" spokes
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        for (let r = 6; r < ZONE_ART_R * 0.68; r++) p.px(c + Math.cos(a) * r, c + Math.sin(a) * r, 0xffffff);
      }
    });
    makeTexture(this, `${ID}-ring`, D + 2, D + 2, (p) => {
      const c = ZONE_ART_R + 2;
      for (let a = 0; a < Math.PI * 2; a += 0.008) {
        const seg = Math.floor((a / (Math.PI * 2)) * 20);
        for (const rr of [ZONE_ART_R - 0.5, ZONE_ART_R - 1.5, ZONE_ART_R - 2.5]) p.px(c + Math.cos(a) * rr, c + Math.sin(a) * rr, seg % 2 ? 0xd0d0d0 : 0xffffff);
      }
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        p.rect(c + Math.cos(a) * (ZONE_ART_R - 1.5) - 1.5, c + Math.sin(a) * (ZONE_ART_R - 1.5) - 1.5, 4, 4, 0xffffff);
      }
      p.outline(-0.9);
    });
    makeTexture(this, `${ID}-beam`, 30, 90, (p) => {
      for (let y = 0; y < 90; y++) {
        const half = 13 - (y / 90) * 4;
        const a = Math.round(90 * (y / 90));
        for (let x = 0; x < 30; x++) {
          const dx = Math.abs(x + 0.5 - 15) / half;
          if (dx <= 1) p.px(x, y, 0xffffff, Math.round(a * (1 - dx * dx)));
        }
      }
    });
    makeSheet(this, `${ID}-bolt`, 10, 18, 3, (p, i) => {
      const r = rng(31 + i * 7);
      let x = 5, y = 0;
      while (y < 17) {
        const nx = Phaser.Math.Clamp(x + Math.round((r() - 0.5) * 6), 1, 8), ny = y + 2 + Math.floor(r() * 3);
        p.line(x, y, nx, Math.min(17, ny), 0xffffff);
        p.line(x + 1, y, nx + 1, Math.min(17, ny), 0xc8f0ff);
        x = nx; y = ny;
      }
    });
    makeSheet(this, `${ID}-fly`, 8, 6, 2, (p, i) => {
      const col = 0xffb3e6;
      if (i === 0) { p.ellipse(2, 2, 2, 2, col); p.ellipse(6, 2, 2, 2, col); p.ellipse(2.5, 4.5, 1.5, 1.2, shift(col, -0.2)); p.ellipse(5.5, 4.5, 1.5, 1.2, shift(col, -0.2)); }
      else { p.rect(1, 2, 2, 2, col); p.rect(5, 2, 2, 2, col); }
      p.vline(4, 1, 4, 0x5a3a2a);
    });
    if (!this.anims.exists(`${ID}-flap`)) this.anims.create({ key: `${ID}-flap`, frames: this.anims.generateFrameNumbers(`${ID}-fly`, {}), frameRate: 10, repeat: -1 });
    makeTexture(this, `${ID}-cloud`, 70, 34, (p) => {
      const r = rng(4);
      for (let i = 0; i < 6; i++) {
        const cx = 14 + i * 9 + r() * 4, cy = 17 + (r() - 0.5) * 8, rx = 12 + r() * 6, ry = 9 + r() * 4;
        for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          const nx = (x - cx) / rx, ny = (y - cy) / ry;
          if (nx * nx + ny * ny <= 1 && ((x + y) & 1) === 0) p.px(x, y, 0x0a2a1a);
        }
      }
    });
    makeTexture(this, `${ID}-tuft`, 9, 7, (p) => {
      p.line(1, 6, 0, 2, 0x3f8f4a); p.line(3, 6, 3, 0, 0x5fbf5a); p.line(5, 6, 6, 1, 0x4a9f50); p.line(7, 6, 8, 3, 0x3f8f4a);
      p.px(3, 0, 0x9be08a);
    });
    makeTexture(this, `${ID}-flag`, 16, 28, (p) => {
      p.rect(2, 2, 2, 26, 0xd8dbe4);
      p.vline(2, 2, 26, 0xfff8e7);
      p.tri(4, 3, 15, 7, 4, 11, 0xff5a6e);
      p.tri(4, 3, 12, 6, 4, 8, 0xff7a85);
      p.circle(3, 2, 2, 0xffc93d);
      p.outline(-0.7);
    });
  }

  private paintHill(): void {
    const W = this.vw, H = this.vh;
    const aw = Math.ceil(W / S), ah = Math.ceil(H / S);
    const key = makeTexture(this, `${ID}-hill-${aw}`, aw, ah, (p) => {
      const r = rng(12);
      const cx = aw / 2, cy = ah / 2;
      const greens = [0x2f7a40, 0x3a8a46, 0x46994d, 0x52a855, 0x5fb75c, 0x6cc463, 0x7bd06c];
      const level = (x: number, y: number) => {
        const dx = (x - cx) / (aw * 0.62), dy = (y - cy) / (ah * 0.62);
        const wob = Math.sin(Math.atan2(dy, dx) * 3 + 1) * 0.04 + Math.sin(Math.atan2(dy, dx) * 5) * 0.02;
        const d = Math.sqrt(dx * dx + dy * dy) + wob;
        return Math.max(0, Math.min(greens.length - 1, Math.floor((1 - d) * 7.5)));
      };
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const l = level(x, y);
        let c = greens[l];
        // contour edge: the pixel below a step is a darker lip (light from the top-left)
        if (level(x, y - 1) > l || level(x - 1, y) > l) c = shift(greens[l], -0.25);
        else if (level(x, y + 1) < l) c = shift(greens[l], 0.15);
        p.px(x, y, c);
      }
      // grass speckle + tufts
      for (let i = 0; i < aw * ah * 0.05; i++) {
        const x = Math.floor(r() * aw), y = Math.floor(r() * ah);
        const c = p.get(x, y);
        if (c !== -1) p.px(x, y, shift(c, r() < 0.5 ? 0.18 : -0.18));
      }
      for (let i = 0; i < 70; i++) {
        const x = Math.floor(r() * aw), y = Math.floor(r() * ah);
        const c = p.get(x, y);
        if (c === -1) continue;
        p.px(x, y, shift(c, -0.3)); p.px(x + 1, y - 1, shift(c, 0.25)); p.px(x + 2, y, shift(c, -0.3));
      }
      // flowers
      const fl = [0xffffff, 0xffe066, 0xffb3e6, 0xb8a6ff];
      for (let i = 0; i < 90; i++) {
        const x = Math.floor(r() * aw), y = Math.floor(r() * ah);
        const c = fl[Math.floor(r() * fl.length)];
        p.px(x, y, c); p.px(x - 1, y, shift(c, -0.2)); p.px(x + 1, y, shift(c, -0.2)); p.px(x, y - 1, shift(c, 0.2)); p.px(x, y + 1, 0x2f7a40);
      }
      // stones scattered on the slopes
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2, d = 0.38 + r() * 0.15;
        const x = cx + Math.cos(a) * aw * d, y = cy + Math.sin(a) * ah * d;
        p.ball(x, y, 2.5 + r() * 1.5, 1.8 + r(), 0xa8a8b8);
        p.hline(Math.round(x) - 2, Math.round(y) + 2, 5, 0x2f7a40);
      }
      // hedge border
      const m = M / S;
      p.rect(0, 0, aw, m, 0x235c34); p.rect(0, ah - m, aw, m, 0x235c34); p.rect(0, 0, m, ah, 0x235c34); p.rect(aw - m, 0, m, ah, 0x235c34);
      const bush = (x: number, y: number) => { p.ball(x, y, 6, 5, r() < 0.5 ? 0x2f7a40 : 0x34864a); if (r() < 0.2) p.px(x - 2, y - 2, 0xff7a85); };
      for (let x = 0; x < aw + 6; x += 8) { bush(x, m / 2 + 1); bush(x + 4, ah - m / 2); }
      for (let y = 0; y < ah + 6; y += 8) { bush(m / 2, y); bush(aw - m / 2, y + 4); }
      p.hline(m, m, aw - m * 2, 0x1f4a2c); p.vline(m, m, ah - m * 2, 0x1f4a2c);
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
    // swaying tufts
    const r = rng(5);
    for (let i = 0; i < 26; i++) {
      const x = M + 10 + r() * (W - M * 2 - 20), y = M + 10 + r() * (H - M * 2 - 20);
      const t = this.add.image(x, y, `${ID}-tuft`).setScale(S).setOrigin(0.5, 1).setDepth(-80);
      this.tweens.add({ targets: t, angle: { from: -8, to: 8 }, duration: 1100 + r() * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: r() * 1000 });
    }
    // corner flags in player colours (home markers)
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const fk = makeTexture(this, `${ID}-flag-${p}`, 16, 28, (g) => {
        const c = PLAYER_COLORS[p];
        g.rect(2, 2, 2, 26, 0xd8dbe4); g.vline(2, 2, 26, 0xfff8e7);
        g.tri(4, 3, 15, 7, 4, 11, c.main); g.tri(4, 3, 12, 6, 4, 8, c.light);
        g.circle(3, 2, 2, 0xffc93d); g.outline(-0.7);
      });
      const x = p % 2 === 0 ? M + 64 : W - M - 64, y = p < 2 ? M + 74 : H - M - 14;
      const f = this.add.image(x, y, fk).setScale(S).setOrigin(0.2, 1).setDepth(y);
      if (!this.players.includes(p)) f.setAlpha(0.4);
      this.tweens.add({ targets: f, scaleX: S * 0.9, duration: 500 + p * 70, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    // cloud shadows drift over the field
    for (let i = 0; i < 3; i++) {
      const c = this.add.image(r() * W, 60 + r() * (H - 120), `${ID}-cloud`).setScale(S * (1.4 + r() * 0.6)).setAlpha(0.13).setDepth(1500);
      this.cloudShadows.push(c);
    }
    for (let i = 0; i < 4; i++) {
      const img = this.add.sprite(0, 0, `${ID}-fly`).setScale(S).setDepth(1400).play(`${ID}-flap`);
      img.anims.setProgress(r());
      if (i % 2) img.setTint(0xfff1a0);
      this.butterflies.push({ img, t: r() * 100, x: M + 40 + r() * (W - 120), y: M + 40 + r() * (H - 120), s: 0.5 + r() * 0.5 });
    }
    // the crown zone
    this.beam = this.add.image(0, 0, `${ID}-beam`).setScale(S * 1.3, S * 1.1).setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setDepth(1300);
    this.fill = this.add.image(0, 0, `${ID}-fill`).setScale(S).setDepth(-70).setAlpha(0.42);
    this.ring = this.add.image(0, 0, `${ID}-ring`).setScale(S).setDepth(-69);
    this.crown = this.add.image(0, 0, crownKey(this)).setScale(S * 1.5).setDepth(-68).setAlpha(0.9);
  }

  /** The zone drifts along a slow Lissajous path that speeds up over time. */
  private zoneAt(t: number): { x: number; y: number } {
    const f = this.field;
    const ax = (f.width / 2 - 70), ay = (f.height / 2 - 66);
    return {
      x: this.vw / 2 + Math.sin(t * 0.29 + this.phase) * ax * 0.95 + Math.sin(t * 0.71) * 18,
      y: this.vh / 2 + Math.sin(t * 0.41 + this.phase * 1.7) * ay * 0.9,
    };
  }

  private zoneClock = 0;

  private placeZone(dt: number): void {
    const speed = 1 + Math.min(1, this.elapsed / 60) * 0.9;
    this.zoneClock += dt * speed;
    const z = this.zoneAt(this.zoneClock);
    this.zx = z.x; this.zy = z.y;
  }

  // ───────────────────────────── loop ─────────────────────────────

  private inZone(b: ArenaBody): boolean {
    return b.alive && Math.hypot(b.x - this.zx, (b.y - this.zy) * 1.1) < this.zr;
  }

  ambient(dt: number): void {
    this.kit.update(dt, this.state === 'play');
    const now = this.time.now;
    const k = this.zr / (ZONE_ART_R * S);
    this.fill.setPosition(this.zx, this.zy).setScale(S * k, S * k * 0.92);
    this.ring.setPosition(this.zx, this.zy).setScale(S * k * (1 + Math.sin(now / 200) * 0.03), S * k * 0.92 * (1 + Math.sin(now / 200) * 0.03)).setAngle(now / 30);
    this.crown.setPosition(this.zx, this.zy + Math.sin(now / 300) * 3);
    let tint = 0xffe066;
    if (this.contested) tint = Math.floor(now / 70) % 2 ? 0xffffff : 0xff6a5a;
    else if (this.king !== -1) tint = PLAYER_COLORS[this.king].main;
    this.fill.setTint(tint);
    this.ring.setTint(this.contested ? 0xffffff : this.king !== -1 ? PLAYER_COLORS[this.king].light : 0xfff1a0);
    this.crown.setVisible(this.king === -1);
    this.beam.setPosition(this.zx, this.zy + 6).setTint(this.king !== -1 ? PLAYER_COLORS[this.king].light : 0xfff1a0);
    this.beam.setAlpha(Phaser.Math.Linear(this.beam.alpha, this.king !== -1 ? 0.26 + Math.sin(now / 90) * 0.05 : 0.06, 0.15));
    for (const b of this.kit.bodies) {
      const cr = this.crowns[b.p];
      const isKing = this.king === b.p;
      cr.setVisible(isKing);
      if (isKing) {
        const mk = b.avatar.marker;
        cr.setPosition(b.x, b.y - 72 + Math.sin(now / 120) * 2).setDepth(b.y + 1999);
        if (mk) mk.y -= 18;
      }
    }
    for (const c of this.cloudShadows) {
      c.x += dt * 9;
      if (c.x > this.vw + 90) { c.x = -90; c.y = 60 + Math.random() * (this.vh - 120); }
    }
    for (const f of this.butterflies) {
      f.t += dt * f.s;
      f.img.setPosition(f.x + Math.sin(f.t * 0.9) * 60 + Math.sin(f.t * 2.3) * 10, f.y + Math.sin(f.t * 1.3) * 40 - Math.abs(Math.sin(f.t * 6)) * 6);
      f.img.setFlipX(Math.cos(f.t * 0.9) < 0);
    }
    for (const bo of this.bolts) if (bo.active) bo.setAlpha(bo.alpha - dt * 6);
    this.bolts = this.bolts.filter((bo) => { if (bo.alpha <= 0) { bo.destroy(); return false; } return true; });
  }

  tick(dt: number): void {
    this.placeZone(dt);
    // stage changes
    if (this.stage === 0 && this.elapsed > 30) { this.stage = 1; this.banner('วงหดแล้ว!', '#ffe066'); }
    if (this.stage === 1 && this.timeLeft < 10) { this.stage = 2; this.banner('10 วิสุดท้าย แต้ม x2!', '#ff9f8a'); }
    const targetR = this.stage === 0 ? 58 : 46;
    this.zr += (targetR - this.zr) * Math.min(1, dt * 2);

    const inside = this.kit.alive.filter((b) => this.inZone(b));
    this.contested = inside.length > 1;
    const newKing: PlayerIndex | -1 = inside.length === 1 ? inside[0].p : -1;
    if (newKing !== this.king) {
      if (newKing !== -1) {
        Audio.sfx('power', 1 + newKing * 0.1);
        Vfx.sparkle(this, this.zx, this.zy - 20, [0xffe066, PLAYER_COLORS[newKing].light, 0xffffff]);
        const b = this.kit.body(newKing)!;
        Vfx.squash(this, this.crowns[newKing], 1.6, 0.5, 220);
        Vfx.popText(this, b.x, b.y - 96, 'ราชา!', toCss(PLAYER_COLORS[newKing].light), 15, this.angleFor(newKing));
        this.streak = 0;
      }
      this.king = newKing;
    }
    const mult = this.stage === 2 ? 2 : 1;
    if (this.king !== -1) {
      const p = this.king;
      this.kingTime[p] += dt;
      this.holdT[p] += dt;
      if (this.holdT[p] >= PTS_EVERY) {
        this.holdT[p] -= PTS_EVERY;
        this.streak++;
        this.addScore(p, mult);
        Audio.sfx('coin', 0.9 + Math.min(0.8, this.streak * 0.025) + p * 0.04);
        const b = this.kit.body(p)!;
        if (this.streak % 4 === 0) Vfx.popText(this, b.x + 18, b.y - 60, `+${4 * mult}`, '#ffe066', 13, this.angleFor(p));
        burst(this, this.zx + (Math.random() - 0.5) * this.zr * 1.4, this.zy + (Math.random() - 0.5) * this.zr, {
          tex: 'spark', count: 2, tint: [0xffe066, PLAYER_COLORS[p].light], speed: [20, 50], angle: [250, 290], life: 600, gravity: -60, depth: 1350,
        });
      }
    }
    if (this.contested) {
      this.crackleT -= dt;
      if (this.crackleT <= 0) {
        this.crackleT = 0.09 + Math.random() * 0.1;
        const a = Math.random() * Math.PI * 2;
        const bo = this.add.sprite(this.zx + Math.cos(a) * this.zr * 0.85, this.zy + Math.sin(a) * this.zr * 0.75, `${ID}-bolt`, Phaser.Math.Between(0, 2))
          .setScale(S).setAngle(Phaser.Math.Between(-40, 40)).setDepth(1360).setTint(Math.random() < 0.5 ? 0xffffff : 0xfff1a0).setBlendMode(Phaser.BlendModes.ADD);
        this.bolts.push(bo);
        if (Math.random() < 0.35) Audio.sfx('tick');
        if (Math.random() < 0.3) burst(this, bo.x, bo.y, { tex: 'dot2', count: 4, tint: [0xffffff, 0xc8f0ff], speed: [40, 120], life: 220, depth: 1360 });
      }
    }
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b, dt);
  }

  private banner(text: string, color: string): void {
    Audio.sfx('power');
    for (const [deg, y] of [[0, this.vh * 0.64], [180, this.vh * 0.36]] as const) {
      const t = txt(this, this.vw / 2, y, text, { size: 24, color, strokeWidth: 6 }).setAngle(deg).setDepth(3000);
      this.tweens.add({ targets: t, scale: { from: 0.4, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, delay: 1300, duration: 400, onComplete: () => t.destroy() });
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    b.data.react -= dt;
    if (b.data.react <= 0) {
      b.data.react = 0.25 + (1 - b.data.skill) * 0.6 + Math.random() * 0.2;
      // aim for a spot inside the zone, a bit ahead of its drift
      const ahead = this.zoneAt(this.zoneClock + 0.6 * b.data.skill);
      const a = Math.random() * Math.PI * 2, d = Math.random() * this.zr * 0.45;
      b.data.ox = ahead.x - this.zx + Math.cos(a) * d;
      b.data.oy = ahead.y - this.zy + Math.sin(a) * d;
    }
    const goal = { x: this.zx + b.data.ox, y: this.zy + b.data.oy };
    const mine = this.inZone(b);
    // a rival in (or near) the zone: line up and shove them away from its centre
    let rival: ArenaBody | undefined;
    let best = 1e9;
    for (const o of this.kit.alive) {
      if (o === b) continue;
      const dz = Math.hypot(o.x - this.zx, o.y - this.zy);
      if (dz > this.zr + 30) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d < best) { best = d; rival = o; }
    }
    if (rival && best < 150 && (mine || Math.hypot(b.x - this.zx, b.y - this.zy) < this.zr + 50)) {
      const ox = rival.x - this.zx, oy = rival.y - this.zy;
      const ol = Math.hypot(ox, oy) || 1;
      const behind = { x: rival.x - (ox / ol) * 26, y: rival.y - (oy / ol) * 26 };
      const lined = Math.hypot(behind.x - b.x, behind.y - b.y) < 30;
      b.botTarget = lined || best < 40 ? { x: rival.x, y: rival.y } : behind;
      if (best < 75 && b.dashCd <= 0 && Math.random() < 0.05 + b.data.skill * 0.06) b.botDash = true;
      return;
    }
    // far away: dash toward the zone sometimes to get there first
    const dz = Math.hypot(goal.x - b.x, goal.y - b.y);
    if (dz > 160 && b.dashCd <= 0 && Math.random() < 0.01 * b.data.skill) b.botDash = true;
    b.botTarget = goal;
  }

  results(): PlayerResult[] {
    return rankBy(this.players, (p) => this.score[p] * 1000 + Math.round(this.kingTime[p] * 10)).map((r) => ({ ...r, score: this.score[r.player] }));
  }

  shutdown(): void {
    this.kit?.destroy();
  }
}

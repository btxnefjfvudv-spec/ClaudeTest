import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Avatar } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { SplitKit } from '../kit/SplitKit';

const BASE_Y = -700; // ground (feet) in world y, per course copy
const LANE_GAP = 1400; // x distance between the four course copies
const GRAV = 720;
const THRUST = 1560;
const MAX_UP = 330;
const SAFE = 215; // max landing speed
const STEER = 130;
const BURN = 0.5;
const PX_PER_M = 20;
const N_PLAT = 80;

interface Plat { h: number; cx: number; w: number; amp: number; spd: number; ph: number; style: number }

interface Pilot {
  p: PlayerIndex;
  x0: number;
  av: Avatar;
  pack: Phaser.GameObjects.Image;
  flame: Phaser.GameObjects.Sprite;
  gauge: Phaser.GameObjects.Sprite;
  fuelBg: Phaser.GameObjects.Rectangle;
  fuelBar: Phaser.GameObjects.Rectangle;
  x: number; h: number; vx: number; vy: number;
  on: number; // index of platform standing on (-1 airborne)
  banked: number;
  fuel: number;
  boom: number;
  inv: number;
  thrusting: boolean;
  plats: Phaser.GameObjects.Image[];
  marks: Phaser.GameObjects.Image[];
  skies: Phaser.GameObjects.Image[];
  stars: Phaser.GameObjects.TileSprite;
  city: Phaser.GameObjects.Image;
  clouds: { img: Phaser.GameObjects.Image; x: number; s: number }[];
  smokeT: number;
  camY: number;
  best: number;
  bankT: number;
  // CPU
  cpuWait: number;
  cpuClear: number;
  cpuSafe: number;
  cpuHold: boolean;
  cpuSkill: number;
}

/** #48 — Hold to thrust, release to fall; land softly on the next platform to bank height. */
export default class RocketJump extends BaseMinigame {
  private split!: SplitKit;
  private pilots: Pilot[] = [];
  private platDefs: Plat[] = [];
  private t = 0;

  constructor() {
    super(CATALOG['rocket-jump']);
  }

  setup(): void {
    this.pilots = [];
    this.t = 0;
    this.split = new SplitKit(this);
    this.buildCourse();
    this.paintArt();
    for (const p of this.players) this.makeLane(p);
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) if (!this.players.includes(p)) this.split.cams[p].setVisible(false);
  }

  private buildCourse(): void {
    const r = rng(4848);
    const vw = this.split.viewW;
    this.platDefs = [{ h: 0, cx: vw / 2, w: vw + 40, amp: 0, spd: 0, ph: 0, style: -1 }];
    let h = 0;
    let cx = vw / 2;
    for (let i = 1; i < N_PLAT; i++) {
      h += Math.min(150, 96 + i * 1.1 + r() * 18);
      const w = i < 6 ? 120 : i < 18 ? (r() < 0.5 ? 120 : 96) : i < 32 ? (r() < 0.5 ? 96 : 72) : 72;
      const moving = i >= 7 && r() < Math.min(0.75, 0.3 + i * 0.015);
      const style = i < 14 ? 0 : i < 30 ? 1 : 2;
      // next platform within steering reach of the last one
      cx = Phaser.Math.Clamp(cx + (r() - 0.5) * 170, w / 2 + 16, vw - w / 2 - 16);
      const amp = moving ? Math.min(cx - w / 2 - 8, vw - cx - w / 2 - 8, 50 + r() * 60) : 0;
      this.platDefs.push({ h, cx, w, amp: Math.max(0, amp), spd: 0.8 + r() * 0.9 + i * 0.01, ph: r() * Math.PI * 2, style });
    }
  }

  private platX(i: number): number {
    const d = this.platDefs[i];
    return d.cx + Math.sin(this.t * d.spd + d.ph) * d.amp;
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    const aw = Math.ceil(this.split.viewW / S) + 2, ah = Math.ceil(this.split.viewH / S) + 2;
    makeTexture(this, `rocket-sky0-${aw}`, aw, ah, (p) => p.gradient(0, 0, aw, ah, [0x5fb8f5, 0x8fd2ff, 0xc9ecff]));
    makeTexture(this, `rocket-sky1-${aw}`, aw, ah, (p) => p.gradient(0, 0, aw, ah, [0x3a3f9a, 0x8a5ab8, 0xff8a7a, 0xffc98a]));
    makeTexture(this, `rocket-sky2-${aw}`, aw, ah, (p) => p.gradient(0, 0, aw, ah, [0x070720, 0x120f3a, 0x241a5a]));
    makeTexture(this, 'rocket-stars', 96, 96, (p) => {
      const r = rng(77);
      for (let i = 0; i < 46; i++) p.px(Math.floor(r() * 96), Math.floor(r() * 96), [0xffffff, 0xbfe3ff, 0xffe9a8][i % 3], 140 + Math.floor(r() * 115));
      for (let i = 0; i < 4; i++) { const x = 8 + Math.floor(r() * 80), y = 8 + Math.floor(r() * 80); p.px(x, y, 0xffffff); p.px(x - 1, y, 0xbfe3ff); p.px(x + 1, y, 0xbfe3ff); p.px(x, y - 1, 0xbfe3ff); p.px(x, y + 1, 0xbfe3ff); }
    });
    makeTexture(this, `rocket-city-${aw}`, aw, 60, (p) => {
      const r = rng(12);
      let x = 0;
      while (x < aw) {
        const w = 10 + Math.floor(r() * 16), h = 18 + Math.floor(r() * 36);
        const c = [0x7f9ac8, 0x6d88ba, 0x8aa6d2][Math.floor(r() * 3)];
        p.rect(x, 60 - h, w, h, c);
        p.vline(x, 60 - h, h, shift(c, 0.2));
        for (let wy = 60 - h + 3; wy < 58; wy += 5) for (let wx = x + 2; wx < x + w - 2; wx += 4) if (r() < 0.6) p.rect(wx, wy, 2, 2, r() < 0.3 ? 0xfff1a8 : 0xa8c4ea);
        x += w + Math.floor(r() * 3);
      }
    });
    // school rooftop (ground)
    makeTexture(this, `rocket-roof-${aw}`, aw, 40, (p) => {
      p.rect(0, 4, aw, 36, 0xc98a6a);
      p.dither(0, 10, aw, 30, 0xc98a6a, 0xb97a5e, 0.35);
      p.rect(0, 0, aw, 5, 0x8a97bf); p.hline(0, 0, aw, 0xc7c9d6); p.hline(0, 4, aw, 0x56618a);
      for (let x = 2; x < aw; x += 8) { p.rect(x, -1, 1, 1, 0x8a97bf); }
      for (let x = 6; x < aw; x += 22) for (let y = 14; y < 38; y += 10) p.rect(x, y, 12, 7, 0x6ec6ff), p.hline(x, y, 12, 0xbfe3ff), p.rect(x + 5, y, 1, 7, 0xfff8e7);
    });
    makeTexture(this, 'rocket-tank', 30, 38, (p) => {
      p.rect(5, 26, 2, 12, 0x56618a); p.rect(23, 26, 2, 12, 0x56618a); p.line(5, 37, 25, 27, 0x56618a);
      p.box(2, 6, 26, 21, 0x8ab8d8);
      p.ellipse(15, 6, 13, 4, 0xa8d0ea);
      for (let y = 10; y < 26; y += 5) p.hline(3, y, 24, 0x6a98ba);
      p.rect(9, 13, 12, 5, 0xfff8e7); p.hline(10, 15, 10, 0xff5a6e);
      p.outline(-0.6);
    });
    makeTexture(this, 'rocket-rail', 16, 10, (p) => {
      p.hline(0, 1, 16, 0xc7c9d6); p.hline(0, 2, 16, 0x8a97bf);
      p.vline(1, 1, 9, 0x8a97bf); p.vline(9, 1, 9, 0x8a97bf);
      p.hline(0, 6, 16, 0xa8aec4);
    });
    // platforms: 0 girder, 1 cloud, 2 space metal
    for (const w of [72, 96, 120]) {
      const a = w / S;
      makeTexture(this, `rocket-plat-0-${w}`, a, 10, (p) => {
        p.box(0, 0, a, 4, 0xff9f43);
        p.hline(0, 0, a, 0xffd08a);
        for (let x = 0; x < a - 2; x += 6) { p.line(x, 4, x + 3, 8, 0xd9772a); p.line(x + 6, 4, x + 3, 8, 0xd9772a); }
        p.hline(0, 8, a, 0xd9772a); p.hline(0, 9, a, 0xa8571a);
        for (let x = 2; x < a; x += 6) p.px(x, 2, 0x8a4a1a);
        p.outline(-0.6);
      });
      makeTexture(this, `rocket-plat-1-${w}`, a, 12, (p) => {
        const r = rng(a);
        for (let x = 4; x < a - 3; x += 6) p.ball(x, 6 + r() * 1.5, 5, 4.5, 0xffffff, false);
        p.ellipse(a / 2, 9, a / 2 - 1, 3, 0xdbe9f7);
        p.hline(3, 1, a - 6, 0xffffff);
        for (let x = 4; x < a - 4; x += 3) p.px(x, 10, 0xb9cce6);
        p.outline(-0.4);
      });
      makeTexture(this, `rocket-plat-2-${w}`, a, 10, (p) => {
        p.box(0, 0, a, 5, 0x8a97bf);
        p.hline(0, 0, a, 0x3fe0e0);
        p.rect(2, 5, a - 4, 3, 0x3b4466);
        for (let x = 4; x < a - 4; x += 8) p.rect(x, 6, 3, 1, 0xff7af0);
        p.rect(a / 2 - 3, 8, 6, 2, 0x56618a);
        p.outline(-0.6);
      });
    }
    makeTexture(this, 'rocket-pmark', 6, 4, (p) => { p.tri(0, 0, 6, 0, 3, 3.5, 0xffffff); });
    makeTexture(this, 'rocket-cloud', 44, 16, (p) => {
      p.ball(14, 9, 10, 6, 0xffffff, false); p.ball(26, 7, 9, 6, 0xffffff, false); p.ball(34, 10, 7, 5, 0xffffff, false);
      p.hline(6, 14, 34, 0xdbe9f7); p.hline(8, 15, 28, 0xdbe9f7);
    });
    makeSheet(this, 'rocket-bird', 9, 6, 2, (p, i) => {
      if (i === 0) { p.line(0, 1, 4, 3, 0x2b3263); p.line(8, 1, 4, 3, 0x2b3263); }
      else { p.line(0, 4, 4, 2, 0x2b3263); p.line(8, 4, 4, 2, 0x2b3263); }
      p.px(4, 3, 0x2b3263);
    });
    makeTexture(this, 'rocket-planet', 30, 30, (p) => {
      p.ball(15, 15, 13, 13, 0x7ee8b0);
      for (let y = 6; y < 26; y += 5) p.hline(4, y, 22, 0x5fc89a, 120);
      p.ball(22, 9, 2.5, 2, 0xa6f0c4, false);
      p.outline(-0.6);
    });
    makeTexture(this, 'rocket-pack', 10, 13, (p) => {
      p.box(1, 0, 8, 10, 0xc7c9d6);
      p.rect(2, 2, 6, 3, 0xff5a6e);
      p.rect(2, 10, 2, 3, 0x56618a); p.rect(6, 10, 2, 3, 0x56618a);
      p.px(3, 6, 0x3fe0e0);
      p.outline(-0.7);
    });
    makeSheet(this, 'rocket-flame', 10, 14, 3, (p, i) => {
      const len = [10, 13, 8][i];
      for (const x of [3, 7]) {
        p.tri(x - 2, 0, x + 2, 0, x, len, 0xff9f43);
        p.tri(x - 1, 0, x + 1, 0, x, len * 0.65, 0xffe066);
        p.px(x, 0, 0xffffff); p.px(x, 1, 0xffffff);
      }
    });
    if (!this.anims.exists('rocket-flame-go')) {
      this.anims.create({ key: 'rocket-flame-go', frames: this.anims.generateFrameNumbers('rocket-flame', {}), frameRate: 18, repeat: -1 });
      this.anims.create({ key: 'rocket-bird-fly', frames: this.anims.generateFrameNumbers('rocket-bird', {}), frameRate: 6, repeat: -1 });
    }
    makeSheet(this, 'rocket-gauge', 7, 7, 3, (p, i) => {
      const c = [0x7ee8b0, 0xffe066, 0xff5a6e][i];
      p.tri(0, 1, 7, 1, 3.5, 6, c);
      p.outline(-0.7);
    });
  }

  private platKey(i: number): string {
    const d = this.platDefs[i];
    return `rocket-plat-${d.style}-${d.w}`;
  }

  private makeLane(p: PlayerIndex): void {
    const x0 = p * LANE_GAP;
    const vw = this.split.viewW;
    const aw = Math.ceil(vw / S) + 2;
    const skies = [0, 1, 2].map((k) => this.add.image(x0, 0, `rocket-sky${k}-${aw}`).setOrigin(0).setScale(S).setDepth(-200 + k));
    const stars = this.add.tileSprite(x0, 0, aw, Math.ceil(this.split.viewH / S) + 2, 'rocket-stars').setOrigin(0).setScale(S).setDepth(-196);
    const planet = this.add.image(x0 + vw * 0.7, BASE_Y - 5600, 'rocket-planet').setScale(S).setDepth(-150);
    this.tweens.add({ targets: planet, y: planet.y - 8, yoyo: true, repeat: -1, duration: 3000, ease: 'Sine.easeInOut' });
    const city = this.add.image(x0 - S, BASE_Y, `rocket-city-${aw}`).setOrigin(0, 1).setScale(S).setDepth(-180);
    // rooftop
    this.add.image(x0 - S, BASE_Y - 2, `rocket-roof-${aw}`).setOrigin(0, 0).setScale(S).setDepth(-100);
    for (let x = 0; x < vw + 32; x += 32) this.add.image(x0 + x, BASE_Y - 2, 'rocket-rail').setOrigin(0, 1).setScale(S).setDepth(-101);
    this.add.image(x0 + vw - 50, BASE_Y - 2, 'rocket-tank').setOrigin(0.5, 1).setScale(S).setDepth(-99);
    const sign = txt(this, x0 + 74, BASE_Y + 20, 'ROOF 5/8', { size: 12, color: '#fff8e7', strokeWidth: 3 }).setDepth(-98);
    void sign;
    // clouds & birds (same layout for everyone)
    const r = rng(9);
    const clouds: Pilot['clouds'] = [];
    for (let i = 0; i < 40; i++) {
      const h = 140 + i * 120 + r() * 60;
      const img = this.add.image(x0, BASE_Y - h, 'rocket-cloud').setScale(S).setAlpha(h > 4400 ? 0.25 : 0.85).setDepth(-160 + (i % 3));
      clouds.push({ img, x: r() * vw, s: 6 + r() * 14 });
    }
    for (let i = 0; i < 6; i++) {
      const b = this.add.sprite(x0 + r() * vw, BASE_Y - 160 - r() * 900, 'rocket-bird', 0).setScale(S).setDepth(-150);
      b.play({ key: 'rocket-bird-fly', startFrame: i % 2 });
      this.tweens.add({ targets: b, x: b.x + (r() < 0.5 ? -1 : 1) * 140, duration: 5000 + r() * 3000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', onYoyo: () => b.toggleFlipX(), onRepeat: () => b.toggleFlipX() });
    }
    // height signs every 50 m
    for (let m = 50; m * PX_PER_M < this.platDefs[N_PLAT - 1].h; m += 50) {
      const y = BASE_Y - m * PX_PER_M;
      this.add.rectangle(x0 + 2, y, 18, 2, 0xffffff, 0.5).setOrigin(0, 0.5).setDepth(-140);
      txt(this, x0 + 24, y, `${m} m`, { size: 10, color: '#ffffff', strokeWidth: 3, origin: [0, 0.5] }).setDepth(-140).setAlpha(0.8);
    }
    // platforms
    const plats: Phaser.GameObjects.Image[] = [];
    const marks: Phaser.GameObjects.Image[] = [];
    this.platDefs.forEach((d, i) => {
      if (i === 0) { plats.push(this.add.image(-9999, 0, 'px').setVisible(false)); marks.push(this.add.image(-9999, 0, 'px').setVisible(false)); return; }
      plats.push(this.add.image(x0 + d.cx, BASE_Y - d.h, this.platKey(i)).setOrigin(0.5, 0).setScale(S).setDepth(-50));
      marks.push(this.add.image(x0 + d.cx, BASE_Y - d.h - 14, 'rocket-pmark').setScale(S).setDepth(-49).setTint(PLAYER_COLORS[p].light).setVisible(false));
    });

    const av = new Avatar(this, p, x0 + vw / 2, BASE_Y, { depthSort: false, shadow: false, marker: false });
    av.sprite.setDepth(10);
    const pack = this.add.image(0, 0, 'rocket-pack').setScale(S).setDepth(9);
    const flame = this.add.sprite(0, 0, 'rocket-flame', 0).setOrigin(0.5, 0).setScale(S).setDepth(8).setVisible(false);
    flame.play('rocket-flame-go');
    const gauge = this.add.sprite(0, 0, 'rocket-gauge', 0).setScale(S).setDepth(12).setVisible(false);
    const fuelBg = this.add.rectangle(0, 0, 6, 34, 0x1b1f3b, 0.8).setOrigin(0.5, 1).setDepth(12).setStrokeStyle(1.5, 0x1b1f3b);
    const fuelBar = this.add.rectangle(0, 0, 4, 32, 0xffc93d).setOrigin(0.5, 1).setDepth(13);
    const pl: Pilot = {
      p, x0, av, pack, flame, gauge, fuelBg, fuelBar, x: vw / 2, h: 0, vx: 0, vy: 0, on: 0, banked: 0, fuel: 1, boom: 0, inv: 0,
      thrusting: false, plats, marks, skies, stars, city, clouds, smokeT: 0, camY: BASE_Y - 60, best: 0, bankT: 0,
      cpuWait: 0.5, cpuClear: 30, cpuSafe: 150, cpuHold: false, cpuSkill: 0.55 + Math.random() * 0.4,
    };
    this.pilots.push(pl);
    this.syncPilot(pl, 0);
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const pl of this.pilots) this.syncPilot(pl, dt);
  }

  tick(dt: number): void {
    for (const pl of this.pilots) {
      if (this.isCpu(pl.p)) this.bot(pl, dt);
      this.stepPilot(pl, dt);
      this.hudText[pl.p] = `${Math.floor(this.platDefs[pl.banked].h / PX_PER_M)} m`;
    }
  }

  private wantsThrust(pl: Pilot): boolean {
    return this.isCpu(pl.p) ? pl.cpuHold : this.touch.isHeld(pl.p);
  }

  /** Platform the rocket steers toward while airborne. */
  private targetPlat(pl: Pilot): number {
    let k = pl.banked + 1;
    for (let i = pl.banked + 1; i < N_PLAT; i++) {
      if (this.platDefs[i].h <= pl.h + 30) k = i;
      else break;
    }
    return Math.min(N_PLAT - 1, k);
  }

  private stepPilot(pl: Pilot, dt: number): void {
    pl.inv = Math.max(0, pl.inv - dt);
    if (pl.boom > 0) {
      pl.boom -= dt;
      if (pl.boom <= 0) this.respawn(pl);
      return;
    }
    const want = this.wantsThrust(pl) && pl.fuel > 0;
    if (want && !pl.thrusting) Audio.sfx('dash', 0.7 + pl.p * 0.06);
    pl.thrusting = want;
    if (pl.on >= 0) {
      // standing: ride moving platforms, refuel
      const d = this.platDefs[pl.on];
      if (d.amp > 0) pl.x = this.platX(pl.on) + ((pl.av.sprite.getData('off') as number) ?? 0);
      pl.fuel = Math.min(1, pl.fuel + dt * 1.6);
      pl.vx = 0;
      if (want) {
        pl.on = -1;
        pl.vy = 120;
        Vfx.dust(this, pl.x0 + pl.x, BASE_Y - pl.h);
        Vfx.squash(this, pl.av.sprite, 0.8, 1.25, 160);
      }
      return;
    }
    // airborne
    if (want) {
      pl.vy = Math.min(MAX_UP, pl.vy + THRUST * dt);
      pl.fuel = Math.max(0, pl.fuel - BURN * dt);
      if (pl.fuel <= 0) Audio.sfx('wrong', 1.4);
    }
    pl.vy -= GRAV * dt;
    const tx = this.platX(this.targetPlat(pl));
    pl.vx = Phaser.Math.Clamp((tx - pl.x) * 3.5, -STEER, STEER);
    pl.x += pl.vx * dt;
    const prevH = pl.h;
    pl.h += pl.vy * dt;
    if (pl.vy < 0) {
      // landing check: crossing a platform top from above
      for (let i = Math.min(N_PLAT - 1, pl.banked + 4); i >= 0; i--) {
        const d = this.platDefs[i];
        if (prevH >= d.h && pl.h <= d.h) {
          const px = i === 0 ? pl.x : this.platX(i);
          if (i !== 0 && Math.abs(pl.x - px) > d.w / 2 + 4) continue;
          pl.h = d.h;
          if (-pl.vy > SAFE && pl.inv <= 0) this.explode(pl, i);
          else this.land(pl, i, -pl.vy);
          break;
        }
      }
    }
    if (pl.h < 0) { pl.h = 0; this.land(pl, 0, -pl.vy); }
  }

  private land(pl: Pilot, i: number, speed: number): void {
    pl.on = i;
    pl.vy = 0;
    pl.thrusting = false;
    const px = i === 0 ? pl.x : this.platX(i);
    pl.av.sprite.setData('off', pl.x - px);
    const wx = pl.x0 + pl.x, wy = BASE_Y - pl.h;
    Vfx.dust(this, wx, wy);
    Vfx.squash(this, pl.av.sprite, 1.3, 0.75, 180);
    Audio.sfx('land', 1 + pl.p * 0.08);
    if (i > pl.banked) {
      const gain = i - pl.banked;
      pl.banked = i;
      pl.best = this.platDefs[i].h;
      pl.bankT = this.elapsed;
      const perfect = speed < 90;
      Audio.sfx(perfect ? 'power' : 'coin', 1 + pl.p * 0.08);
      Vfx.sparkle(this, wx, wy - 10, [0xffffff, 0xffe066, PLAYER_COLORS[pl.p].light]);
      const label = gain > 1 ? `ข้าม ${gain} ชั้น!` : perfect ? 'นุ่มมาก!' : 'ลงจอด!';
      Vfx.popText(this, wx, wy - 70, label, perfect || gain > 1 ? '#ffe066' : '#a6f0c4', 16, 0);
      const img = pl.plats[i];
      this.tweens.add({ targets: img, y: img.y + 4, yoyo: true, duration: 90 });
    }
  }

  private explode(pl: Pilot, i: number): void {
    pl.boom = 1.5;
    pl.on = -1;
    pl.thrusting = false;
    const wx = pl.x0 + pl.x, wy = BASE_Y - pl.h;
    burst(this, wx, wy - 20, { tex: 'puff', count: 16, tint: [0xffffff, 0xffe066, 0xff9f43, 0xff5a3d], speed: [60, 220], life: 650, scale: [S * 1.6, 0], depth: 30 });
    burst(this, wx, wy - 20, { tex: 'puff', count: 10, tint: [0x6b6b80, 0x4a4a5c], speed: [20, 100], life: 1100, scale: [S * 2, S * 0.5], gravity: -80, alpha: [0.8, 0], depth: 29 });
    Audio.sfx('explode', 1 + pl.p * 0.05);
    this.split.cams[pl.p].shake(260, 0.014);
    Vfx.popText(this, wx, wy - 80, 'ตูม!! แรงไป', '#ff9f43', 18, 0);
    const s = pl.av.sprite;
    s.setTint(0x3a3a4a);
    pl.av.play('stun', true);
    this.tweens.add({ targets: s, angle: 720, y: s.y - 70, duration: 700, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: s, y: s.y + 20, alpha: 0, delay: 700, duration: 500, ease: 'Quad.easeIn' });
    pl.flame.setVisible(false);
    const img = pl.plats[i];
    if (img && i > 0) this.tweens.add({ targets: img, y: img.y + 8, yoyo: true, duration: 120 });
  }

  private respawn(pl: Pilot): void {
    const i = pl.banked;
    pl.on = i;
    pl.h = this.platDefs[i].h;
    pl.x = i === 0 ? this.split.viewW / 2 : this.platX(i);
    pl.av.sprite.setData('off', 0);
    pl.vx = pl.vy = 0;
    pl.fuel = 1;
    pl.inv = 1.2;
    const s = pl.av.sprite;
    this.tweens.killTweensOf(s);
    s.clearTint().setAngle(0).setAlpha(1);
    pl.av.play('idle', true);
    Vfx.sparkle(this, pl.x0 + pl.x, BASE_Y - pl.h - 20);
    Audio.sfx('pop', 1.3);
  }

  private syncPilot(pl: Pilot, dt: number): void {
    const vw = this.split.viewW, vh = this.split.viewH;
    const wx = pl.x0 + pl.x, wy = BASE_Y - pl.h;
    // platforms (moving)
    for (let i = Math.max(1, pl.banked - 3); i < Math.min(N_PLAT, pl.banked + 8); i++) {
      const d = this.platDefs[i];
      if (d.amp > 0) {
        const x = pl.x0 + this.platX(i);
        pl.plats[i].setX(x);
        pl.marks[i].setX(x);
      }
    }
    const tgt = this.state === 'play' && pl.boom <= 0 ? this.targetPlat(pl) : -1;
    pl.marks.forEach((m, i) => {
      const show = i === tgt && i > pl.banked;
      if (m.visible !== show) m.setVisible(show);
      if (show) m.setY(BASE_Y - this.platDefs[i].h - 12 + Math.sin(this.t * 6) * 3);
    });
    if (pl.boom <= 0) {
      if (pl.on >= 0 && this.platDefs[pl.on].amp > 0) {
        pl.x = this.platX(pl.on) + ((pl.av.sprite.getData('off') as number) ?? 0);
      }
      pl.av.setPos(pl.x0 + pl.x, wy);
      const a = pl.av;
      if (this.state === 'end') a.play('win');
      else if (pl.on >= 0) a.play('idle');
      else a.play(pl.vy > 0 ? 'jump' : 'fall');
      a.sprite.setAlpha(pl.inv > 0 && Math.floor(pl.inv * 16) % 2 === 0 ? 0.4 : 1);
    }
    const f = pl.av.facing;
    pl.pack.setPosition(pl.x0 + pl.x - f * 9, BASE_Y - pl.h - 30).setFlipX(f < 0).setVisible(pl.boom <= 0);
    pl.flame.setPosition(pl.x0 + pl.x - f * 9, BASE_Y - pl.h - 18).setVisible(pl.thrusting && pl.boom <= 0);
    if (pl.thrusting && pl.boom <= 0) {
      pl.smokeT -= dt;
      if (pl.smokeT <= 0) {
        pl.smokeT = 0.05;
        burst(this, pl.x0 + pl.x - f * 9, BASE_Y - pl.h - 2, { tex: 'puff', count: 1, tint: [0xffffff, 0xdbe3f0], speed: [20, 50], angle: [70, 110], life: 500, scale: [S * 0.6, S * 1.2], alpha: [0.7, 0], depth: 7 });
      }
    }
    // landing-speed gauge while falling
    const falling = pl.on < 0 && pl.vy < -40 && pl.boom <= 0;
    pl.gauge.setVisible(falling);
    if (falling) {
      const v = -pl.vy;
      pl.gauge.setFrame(v < SAFE * 0.7 ? 0 : v < SAFE ? 1 : 2).setPosition(wx + f * 22, wy + 8);
    }
    pl.fuelBg.setPosition(wx - f * 24, wy - 8).setVisible(pl.boom <= 0);
    pl.fuelBar.setPosition(wx - f * 24, wy - 9).setVisible(pl.boom <= 0);
    pl.fuelBar.setDisplaySize(4, Math.max(0.5, 32 * pl.fuel));
    pl.fuelBar.setFillStyle(pl.fuel > 0.5 ? 0xffc93d : pl.fuel > 0.2 ? 0xff9f43 : 0xff5a6e);
    // camera
    const want = wy - 40;
    pl.camY += (want - pl.camY) * Math.min(1, dt * 5 + (dt === 0 ? 1 : 0));
    pl.camY = Math.min(pl.camY, BASE_Y - vh / 2 + 40);
    this.split.look(pl.p, pl.x0 + vw / 2, pl.camY);
    const top = pl.camY - vh / 2 - S;
    // sky blend by height
    const hgt = BASE_Y - pl.camY;
    const k1 = Phaser.Math.Clamp((hgt - 1800) / 1400, 0, 1), k2 = Phaser.Math.Clamp((hgt - 3600) / 1400, 0, 1);
    pl.skies.forEach((s) => s.setY(top));
    pl.skies[1].setAlpha(k1);
    pl.skies[2].setAlpha(k2);
    pl.stars.setY(top).setAlpha(Phaser.Math.Clamp((hgt - 2800) / 1600, 0, 1));
    pl.stars.tilePositionY = top * 0.05 / S;
    pl.city.setY(BASE_Y + (top + vh / 2 - BASE_Y) * 0.35 + 10);
    for (const c of pl.clouds) {
      c.x += c.s * dt;
      if (c.x > vw + 60) c.x = -60;
      c.img.setX(pl.x0 + c.x);
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(pl: Pilot, dt: number): void {
    if (pl.boom > 0) { pl.cpuHold = false; return; }
    const ti = this.targetPlat(pl);
    const d = this.platDefs[ti];
    if (pl.on >= 0) {
      pl.cpuHold = false;
      pl.cpuWait -= dt;
      const tx = this.platX(ti);
      const reach = d.w / 2 + STEER * 0.6 - 10;
      // moving targets: launch when it is (or soon will be) overhead
      const lead = d.amp > 0 ? Math.cos(this.t * d.spd + d.ph) * d.amp * d.spd * 0.5 : 0;
      if (pl.cpuWait <= 0 && pl.fuel > 0.95 && Math.abs(tx + lead - pl.x) < reach) {
        pl.cpuHold = true;
        pl.cpuWait = (0.15 + Math.random() * 0.6) * (1.7 - pl.cpuSkill);
        pl.cpuClear = 18 + Math.random() * 30;
        const greedy = Math.random() > pl.cpuSkill;
        pl.cpuSafe = greedy ? SAFE * (0.95 + Math.random() * 0.25) : SAFE * (0.4 + Math.random() * 0.4);
      }
      return;
    }
    // airborne: climb above the next platform, wait until lined up, then control the descent
    const T = Math.min(N_PLAT - 1, pl.banked + 1);
    const dT = this.platDefs[T];
    const above = pl.h - dT.h;
    const aligned = Math.abs(this.platX(T) - pl.x) < dT.w / 2 - 6;
    if (pl.vy >= 0 && above < pl.cpuClear) pl.cpuHold = pl.vy < 260;
    else if (!aligned && above > -6 && above < 90) pl.cpuHold = pl.vy < -15; // hover until lined up
    else {
      const fall = -pl.vy;
      const brakeDist = Math.max(0, (fall * fall - pl.cpuSafe * pl.cpuSafe) / (2 * (THRUST - GRAV)));
      pl.cpuHold = fall > pl.cpuSafe * 0.7 && above < brakeDist + 24 + (1 - pl.cpuSkill) * 18;
      if (above < 0 && pl.vy < 200) pl.cpuHold = true;
    }
    void d;
  }

  results(): PlayerResult[] {
    const pilot = (p: PlayerIndex) => this.pilots.find((x) => x.p === p);
    const m = (p: PlayerIndex) => { const pl = pilot(p); return pl ? Math.floor(this.platDefs[pl.banked].h / PX_PER_M) : 0; };
    // same height → whoever got there first ranks higher
    const v = (p: PlayerIndex) => { const pl = pilot(p); return pl ? pl.banked * 1000 - Math.round(pl.bankT * 10) : 0; };
    return rankBy(this.players, v).map((r) => ({ ...r, score: m(r.player) }));
  }
}

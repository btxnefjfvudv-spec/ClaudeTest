import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Avatar } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { zonePoint } from '../../ui/Controls';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';

const ID = 'teamwork-tug';
const WIN_DIST = 86;
const PERFECT = 0.075;
const GOOD = 0.17;
const R_TARGET = 24;
const R_START = 74;
const PULL = 4.2;
const TEAM_COL = [0xff5a6e, 0x3d9bff];

type Grade = 'perfect' | 'good' | 'miss';

interface Puller {
  p: PlayerIndex;
  team: number;
  av: Avatar;
  /** Offset from the flag along the rope (negative = left). */
  off: number;
  y: number;
  drum: { x: number; y: number };
  drumImg: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  combo: Phaser.GameObjects.Text;
  /** Index of the beat this player must hit next. */
  next: number;
  streak: number;
  perfects: number;
  goods: number;
  contrib: number;
  lean: number;
  strain: number;
  /** CPU: planned tap time for beat `next`. */
  cpuAt: number;
  cpuSigma: number;
  cpuMissChance: number;
  hitBeat: number;
  lastGrade?: Grade;
}

/** #29 — 2v2 rhythm tug-of-war. Left team P1+P3, right team P2+P4. */
export default class TeamworkTug extends BaseMinigame {
  private pullers: Puller[] = [];
  private beats: number[] = [];
  private beatGrades = new Map<number, Map<PlayerIndex, Grade>>();
  private pos = 0;
  private target = 0;
  private vel = 0;
  private winner = -1;
  private endT = 0;
  private t = 0;
  private lastBeatSfx = -1;
  private rope!: Phaser.GameObjects.TileSprite;
  private ropeShadow!: Phaser.GameObjects.TileSprite;
  private flag!: Phaser.GameObjects.Sprite;
  private ropeY = 0;
  private feetY = 0;
  private crowd: { img: Phaser.GameObjects.Sprite; base: number; ph: number; team: number }[] = [];
  private clouds!: Phaser.GameObjects.TileSprite;
  private meter: Phaser.GameObjects.Image[] = [];
  private twang = 0;
  private resolved = false;

  constructor() {
    super(CATALOG[ID]);
  }

  private team(p: PlayerIndex): number {
    return p % 2 === 0 ? 0 : 1;
  }

  // ───────────────────────────── setup ─────────────────────────────

  setup(): void {
    this.pullers = [];
    this.crowd = [];
    this.meter = [];
    this.beatGrades = new Map();
    this.pos = this.target = this.vel = 0;
    this.winner = -1;
    this.endT = 0;
    this.t = 0;
    this.twang = 0;
    this.lastBeatSfx = -1;
    this.resolved = false;
    this.feetY = this.vh / 2 + 26;
    this.ropeY = this.feetY - 24;
    this.buildBeats();
    this.paintTextures();
    this.paintField();
    this.buildRope();
    this.buildCrowd();
    for (const p of this.players) this.makePuller(p);
  }

  /** Shared beat grid: starts relaxed, speeds up towards the end. */
  private buildBeats(): void {
    this.beats = [];
    let t = 1.0;
    while (t < this.meta.duration + 2) {
      this.beats.push(t);
      const k = Math.min(1, t / this.meta.duration);
      t += 0.92 - 0.3 * k;
    }
  }

  private paintTextures(): void {
    makeTexture(this, `${ID}-rope`, 8, 5, (p) => {
      p.rect(0, 1, 8, 3, 0xd9b77a);
      for (let x = 0; x < 8; x += 4) { p.line(x, 3, x + 2, 1, 0xf6e2b0); p.px(x + 3, 3, 0xa8844a); }
      p.hline(0, 4, 8, 0x8a6a3a);
      p.hline(0, 0, 8, 0x8a6a3a);
    });
    makeTexture(this, `${ID}-ropesh`, 8, 3, (p) => p.rect(0, 0, 8, 3, 0x1e3a1a));
    makeSheet(this, `${ID}-flag`, 12, 16, 4, (p, i) => {
      p.rect(5, 0, 2, 3, 0xfff8e7);
      for (let y = 0; y < 12; y++) {
        const dx = Math.round(Math.sin(y * 0.6 + i * 1.6) * 1.2);
        p.hline(3 + dx, 3 + y, 6 - Math.floor(y / 3), y < 6 ? 0xffe066 : 0xffb020);
      }
      p.px(4, 4, 0xfffbe0);
      p.outline(-0.7);
    });
    if (!this.anims.exists(`${ID}-flag-wave`)) this.anims.create({ key: `${ID}-flag-wave`, frames: this.anims.generateFrameNumbers(`${ID}-flag`, {}), frameRate: 9, repeat: -1 });
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[p];
      makeTexture(this, `${ID}-drum-${p}`, 36, 36, (g) => {
        g.circle(18, 19.5, 17, shift(c.main, -0.6));
        g.circle(18, 18, 17, c.dark);
        g.circle(18, 18, 16, c.main);
        for (let a = 0; a < 12; a++) {
          const r = (a / 12) * Math.PI * 2;
          g.px(Math.round(18 + Math.cos(r) * 14.5), Math.round(18 + Math.sin(r) * 14.5), 0xfff1c9);
        }
        g.circle(18, 18, 13, 0xf0e2c0);
        g.circle(18, 18, 12.5, 0xfff6e0);
        g.ellipse(14, 13, 6, 3, 0xffffff);
        g.ring(18, 18, 12, shift(c.main, -0.2), 1);
        g.ring(18, 18, 6, 0xe8d6b0, 1);
        g.outline(-0.8);
      });
    }
    for (const team of [0, 1]) {
      const shirt = team === 0 ? 0xff7a85 : 0x6ec6ff;
      const hairs = [0x3a2a2a, 0x5a3a20, 0x2b2b3a];
      makeSheet(this, `${ID}-kid${team}`, 12, 16, 6, (p, i) => {
        const skin = [0xf2c8a0, 0xe0b080, 0xf6d6b4][i % 3];
        const hair = hairs[i % 3];
        const up = i >= 3 ? -1 : 0;
        p.ball(6, 5 + up, 3.5, 3.5, skin, false);
        p.rect(3, 1 + up, 7, 3, hair);
        if (i % 3 === 1) { p.px(2, 4 + up, hair); p.px(10, 4 + up, hair); p.px(2, 5 + up, hair); p.px(10, 5 + up, hair); }
        p.rect(3, 9 + up, 7, 5, shirt);
        p.hline(3, 9 + up, 7, shift(shirt, 0.3));
        p.rect(3, 13 + up, 7, 3, 0x2b3263);
        p.px(5, 5 + up, 0x1b1f3b); p.px(8, 5 + up, 0x1b1f3b);
        p.px(6, 7 + up, 0xd0705a);
        if (up) { p.vline(1, 2, 7, skin); p.vline(11, 2, 7, skin); p.px(1, 1, 0xffffff); p.px(11, 1, 0xffffff); }
        else { p.vline(2, 9, 4, skin); p.vline(10, 9, 4, skin); }
        p.outline(-0.7);
      });
      for (let v = 0; v < 3; v++) {
        const k = `${ID}-kid${team}-${v}`;
        if (!this.anims.exists(k)) this.anims.create({ key: k, frames: [{ key: `${ID}-kid${team}`, frame: v }, { key: `${ID}-kid${team}`, frame: v + 3 }], frameRate: 4, repeat: -1 });
      }
    }
    makeTexture(this, `${ID}-pennant`, 7, 6, (p) => { p.tri(0, 0, 7, 0, 3.5, 6, 0xffffff); });
    makeTexture(this, `${ID}-cloud`, 160, 120, (p) => {
      const r = rng(9);
      for (let i = 0; i < 3; i++) {
        const cx = 25 + i * 50 + r() * 15, cy = 25 + r() * 70;
        for (let k = 0; k < 5; k++) p.ellipse(cx + (r() - 0.5) * 22, cy + (r() - 0.5) * 10, 10 + r() * 8, 6 + r() * 4, 0x10304a);
      }
    });
    makeTexture(this, `${ID}-pip`, 6, 6, (p) => { p.ball(3, 3, 2.6, 2.6, 0xffffff); p.outline(-0.7); });
  }

  private paintField(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const cx = aw / 2, fy = this.feetY / S;
    const key = makeTexture(this, `${ID}-field-${aw}`, aw, ah, (p) => {
      const r = rng(5);
      for (let x = 0; x < aw; x += 12) p.rect(x, 0, 12, ah, (x / 12) % 2 ? 0x6cbf5e : 0x64b656);
      for (let i = 0; i < aw * ah * 0.05; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), r() > 0.5 ? 0x78c96a : 0x5aa64e);
      // dirt strip under the rope
      const top = fy - 26, bot = fy + 12;
      p.rect(0, top, aw, bot - top, 0xc9a06a);
      for (let x = 0; x < aw; x++) {
        if (r() < 0.6) p.px(x, top + Math.floor(r() * 2), 0x6cbf5e);
        if (r() < 0.6) p.px(x, bot - 1 - Math.floor(r() * 2), 0x6cbf5e);
      }
      for (let i = 0; i < aw * 6; i++) p.px(Math.floor(r() * aw), top + 2 + Math.floor(r() * (bot - top - 4)), r() > 0.5 ? 0xd8b07a : 0xb58c58);
      // mud pit in the middle
      p.ellipse(cx, fy - 6, 24, 13, 0x6a4a2e);
      p.ellipse(cx, fy - 6, 22, 11.5, 0x7a5636);
      p.ellipse(cx - 6, fy - 10, 9, 3, 0x8a6644);
      p.px(cx + 8, fy - 3, 0xa0805a); p.px(cx - 10, fy - 1, 0xa0805a);
      // chalk lines: centre + team lines
      const lx = cx - WIN_DIST / S, rx = cx + WIN_DIST / S;
      for (let y = top - 6; y < bot + 6; y += 3) { p.rect(cx, y, 1, 2, 0xfff8e7); }
      for (let y = top - 10; y < bot + 10; y++) { p.rect(lx - 1, y, 3, 1, 0xff7a85); p.rect(rx - 1, y, 3, 1, 0x6ec6ff); }
      p.rect(lx - 1, top - 10, 3, 1, 0xffd0d6); p.rect(rx - 1, top - 10, 3, 1, 0xcfe8ff);
      // running-track arcs at top/bottom edges
      for (const yy of [8, ah - 9]) {
        p.rect(0, yy - 3, aw, 6, 0xd9604a);
        p.hline(0, yy - 3, aw, 0xf07a62);
        p.hline(0, yy, aw, 0xffffff);
        p.hline(0, yy + 3, aw, shift(0xd9604a, -0.4));
      }
      // flowers
      for (let i = 0; i < 70; i++) {
        const x = Math.floor(r() * aw), y = Math.floor(r() * ah);
        if (y > top - 4 && y < bot + 4) continue;
        const c = [0xffffff, 0xffe066, 0xff8fa8][Math.floor(r() * 3)];
        p.px(x, y, c); p.px(x + 1, y, c); p.px(x, y + 1, c);
      }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);
    makeTexture(this, `${ID}-tree`, 22, 26, (p) => {
      p.ellipse(11, 23, 8, 3, 0x2e6b3a, 120);
      p.rect(9, 15, 4, 9, 0x7a4a2c);
      p.vline(9, 15, 9, 0x9a643c);
      p.ball(11, 10, 10, 9, 0x4fae52);
      p.ball(7, 8, 5, 5, 0x5fc060, false);
      p.ball(15, 12, 5, 4, 0x3f9a48, false);
      p.px(6, 5, 0xb8f0a0); p.px(7, 5, 0xb8f0a0);
      p.outline(-0.75);
    });
    makeTexture(this, `${ID}-bench`, 30, 10, (p) => {
      p.box(0, 0, 30, 4, 0xc0834a);
      p.box(0, 5, 30, 3, 0xa86a3a);
      p.rect(2, 8, 2, 2, 0x5a5a6a); p.rect(26, 8, 2, 2, 0x5a5a6a);
      p.outline(-0.7);
    });
    const W = this.vw, H = this.vh;
    for (const [x, y, kind] of [[28, 120, 0], [W - 28, 120, 0], [28, H - 110, 0], [W - 28, H - 110, 0], [W / 2, 96, 1], [W / 2, H - 96, 1]] as const) {
      if (kind === 0) {
        const t = this.add.image(x, y + 20, `${ID}-tree`).setOrigin(0.5, 0.92).setScale(S).setDepth(y + 20);
        this.tweens.add({ targets: t, angle: { from: -2, to: 2 }, yoyo: true, repeat: -1, duration: 1500 + x, ease: 'Sine.easeInOut' });
      } else {
        this.add.image(x, y, `${ID}-bench`).setScale(S).setDepth(y).setAngle(y < H / 2 ? 180 : 0);
      }
    }
    this.clouds = this.add.tileSprite(0, 0, this.vw / S, this.vh / S, `${ID}-cloud`).setOrigin(0).setScale(S).setAlpha(0.12).setDepth(2500);
    // team banners at the line ends
    for (const [team, sx] of [[0, -1], [1, 1]] as const) {
      const x = this.vw / 2 + sx * WIN_DIST;
      for (const yy of [this.feetY - 70, this.feetY + 22]) {
        const pen = this.add.image(x, yy, `${ID}-pennant`).setScale(S).setTint(TEAM_COL[team]).setDepth(yy);
        this.tweens.add({ targets: pen, scaleX: S * 0.8, yoyo: true, repeat: -1, duration: 400 + team * 60, ease: 'Sine.easeInOut' });
      }
    }
  }

  private buildRope(): void {
    const len = this.vw + 200;
    this.ropeShadow = this.add.tileSprite(this.vw / 2, this.feetY + 4, len / S, 3, `${ID}-ropesh`).setScale(S).setAlpha(0.25).setDepth(-50);
    this.rope = this.add.tileSprite(this.vw / 2, this.ropeY, len / S, 5, `${ID}-rope`).setScale(S).setDepth(this.feetY + 5);
    this.flag = this.add.sprite(this.vw / 2, this.ropeY + 2, `${ID}-flag`).setOrigin(0.5, 0).setScale(S).setDepth(this.feetY + 6);
    this.flag.play(`${ID}-flag-wave`);
    // Shared position meter shown to both sides of the table
    for (const [deg, y] of [[0, this.vh / 2 + 58], [180, this.vh / 2 - 92]] as const) {
      const bar = this.add.rectangle(this.vw / 2, y, WIN_DIST * 2 + 12, 8, 0x1b1f3b, 0.85).setDepth(940).setAngle(deg);
      const l = this.add.rectangle(this.vw / 2 - WIN_DIST - 4, y, 6, 12, TEAM_COL[0]).setDepth(941);
      const r = this.add.rectangle(this.vw / 2 + WIN_DIST + 4, y, 6, 12, TEAM_COL[1]).setDepth(941);
      void bar; void l; void r;
      this.meter.push(this.add.image(this.vw / 2, y, `${ID}-pip`).setScale(S).setDepth(942).setTint(0xffe066));
    }
  }

  private buildCrowd(): void {
    const ys = [this.feetY - 56, this.feetY - 30, this.feetY + 6];
    for (const team of [0, 1]) {
      for (let row = 0; row < ys.length; row++) {
        for (let k = 0; k < 2; k++) {
          const x = team === 0 ? 18 + k * 18 + (row % 2) * 8 : this.vw - 18 - k * 18 - (row % 2) * 8;
          const y = ys[row] + k * 4;
          const img = this.add.sprite(x, y, `${ID}-kid${team}`).setOrigin(0.5, 1).setScale(S).setDepth(y);
          img.play({ key: `${ID}-kid${team}-${(k + row * 2 + team) % 3}`, startFrame: (k + row) % 2 });
          img.anims.timeScale = 0.6 + Math.random() * 0.6;
          img.setFlipX(team === 1);
          this.crowd.push({ img, base: y, ph: Math.random() * 6, team });
        }
      }
    }
  }

  private makePuller(p: PlayerIndex): void {
    const team = this.team(p);
    const sign = team === 0 ? -1 : 1;
    const front = p < 2;
    const off = sign * (front ? 42 : 84);
    const y = this.feetY + (front ? -3 : 3);
    const av = new Avatar(this, p, this.vw / 2 + off, y, { ring: false });
    av.markerAngle = this.angleFor(p);
    av.face(-sign);
    av.play('run');
    const zone = this.zoneOf(p);
    const drum = zonePoint(this.touch, zone, 0.5, 0.6);
    const drumImg = this.add.image(drum.x, drum.y, `${ID}-drum-${p}`).setScale(S).setDepth(900);
    const ring = this.add.graphics().setDepth(905);
    const ang = this.angleFor(p);
    const up = ang === 180 ? 1 : -1; // world dy toward the player's "far" side
    const label = txt(this, drum.x, drum.y + up * 62, '', { size: 18, color: '#ffffff', strokeWidth: 5 }).setAngle(ang).setDepth(910);
    const combo = txt(this, drum.x, drum.y - up * 52, team === 0 ? 'ทีมซ้าย' : 'ทีมขวา', { size: 12, color: toCss(PLAYER_COLORS[p].light) }).setAngle(ang).setDepth(910);
    const hint = txt(this, drum.x, drum.y, 'แตะ!', { size: 14, color: toCss(PLAYER_COLORS[p].dark), strokeWidth: 0, shadow: false }).setAngle(ang).setDepth(906);
    this.tweens.add({ targets: hint, alpha: 0.35, yoyo: true, repeat: -1, duration: 400 });
    const skill = Math.random();
    const pl: Puller = {
      p, team, av, off, y, drum, drumImg, ring, label, combo, next: 0, streak: 0, perfects: 0, goods: 0, contrib: 0,
      lean: 0, strain: 0, cpuAt: -1, cpuSigma: 0.075 + skill * 0.06, cpuMissChance: 0.03 + skill * 0.05, hitBeat: -1,
    };
    this.pullers.push(pl);
    if (!this.isCpu(p)) {
      this.touch.on('down', (t: { player: PlayerIndex }) => {
        if (t.player === p && this.state === 'play' && this.winner < 0) this.tap(pl, this.elapsed);
      });
    }
  }

  // ───────────────────────────── rhythm ─────────────────────────────

  private judge(pl: Puller, grade: Grade): void {
    const beat = pl.next;
    pl.next++;
    pl.cpuAt = -1;
    pl.lastGrade = grade;
    let g = this.beatGrades.get(beat);
    if (!g) { g = new Map(); this.beatGrades.set(beat, g); }
    g.set(pl.p, grade);
    const sign = pl.team === 0 ? -1 : 1;
    const col = toCss(PLAYER_COLORS[pl.p].light);
    const ang = this.angleFor(pl.p);
    if (grade === 'miss') {
      pl.streak = 0;
      pl.label.setText('MISS').setColor('#9aa0b8');
      Audio.sfx('wrong', 1.4);
      Vfx.squash(this, pl.drumImg, 0.9, 0.9, 140);
    } else {
      const perfect = grade === 'perfect';
      pl.streak = perfect ? pl.streak + 1 : 0;
      const comboMul = pl.streak >= 3 ? 1.25 : 1;
      let pull = (perfect ? 1 : 0.5) * comboMul;
      // Teamwork: both teammates perfect on the same beat → sync bonus
      const mate = this.pullers.find((o) => o !== pl && o.team === pl.team);
      let sync = false;
      if (perfect && mate && g.get(mate.p) === 'perfect') { pull += 0.6; sync = true; }
      this.target += sign * pull * PULL;
      pl.contrib += perfect ? 3 : 1;
      if (perfect) pl.perfects++; else pl.goods++;
      this.score[pl.p] = pl.contrib;
      this.addScore(pl.p, 0);
      pl.strain = 1;
      pl.label.setText(sync ? 'SYNC!!' : perfect ? 'PERFECT!' : 'GOOD').setColor(sync ? '#7ee8b0' : perfect ? '#ffe066' : col);
      Audio.sfx(perfect ? 'right' : 'drum', 1 + pl.p * 0.08);
      if (sync) { Audio.sfx('power', 1.1); Vfx.popText(this, this.vw / 2 + this.pos, this.ropeY - 40, 'SYNC!', '#7ee8b0', 16, ang); }
      Vfx.squash(this, pl.drumImg, 1.2, 0.85, 160);
      burst(this, pl.drum.x, pl.drum.y, { tex: perfect ? 'star' : 'spark', count: perfect ? 10 : 5, tint: perfect ? [0xffe066, 0xffffff, PLAYER_COLORS[pl.p].main] : [0xffffff, PLAYER_COLORS[pl.p].light], speed: [60, 160], life: 420, depth: 920 });
      Vfx.dust(this, pl.av.x - sign * 8, pl.av.y, sign);
      this.twang = 1;
    }
    pl.combo.setText(pl.streak >= 2 ? `${pl.streak} COMBO${pl.streak >= 3 ? ' ×1.25' : ''}` : '');
    this.tweens.killTweensOf(pl.label);
    pl.label.setScale(1.5).setAlpha(1);
    this.tweens.add({ targets: pl.label, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: pl.label, alpha: 0, delay: 380, duration: 200 });
    void ang;
  }

  private tap(pl: Puller, now: number): void {
    const bt = this.beats[pl.next];
    if (bt === undefined) return;
    const d = now - bt;
    // Tapping way before the ring arrives still uses up this beat (no spamming).
    const grade: Grade = Math.abs(d) <= PERFECT ? 'perfect' : Math.abs(d) <= GOOD ? 'good' : 'miss';
    this.judge(pl, grade);
  }

  private interval(i: number): number {
    return (this.beats[i + 1] ?? this.beats[i] + 0.62) - this.beats[i];
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    const now = this.elapsed;
    // rope physics (spring toward target for a heavy, satisfying lurch)
    const k = this.winner >= 0 ? 0 : 1;
    this.vel += ((this.target - this.pos) * 40 - this.vel * 9) * dt * k;
    this.pos += this.vel * dt;
    this.twang = Math.max(0, this.twang - dt * 3);
    const wob = Math.sin(this.t * 40) * this.twang * 1.5;
    const rx = this.vw / 2 + this.pos;
    this.rope.setPosition(this.vw / 2, this.ropeY + wob);
    this.rope.tilePositionX = -this.pos / S;
    this.ropeShadow.tilePositionX = -this.pos / S;
    this.flag.setPosition(rx, this.ropeY + wob + 2);
    for (let i = 0; i < this.meter.length; i++) {
      const m = this.meter[i];
      m.x = this.vw / 2 + Phaser.Math.Clamp(this.pos, -WIN_DIST, WIN_DIST);
    }
    // pullers
    for (const pl of this.pullers) {
      pl.strain = Math.max(0, pl.strain - dt * 3);
      const sign = pl.team === 0 ? -1 : 1;
      const x = rx + pl.off;
      const av = pl.av;
      if (this.winner < 0) {
        // being dragged toward the middle = leaning forward; pulling = leaning back
        const dragged = Math.sign(this.vel) === -sign && Math.abs(this.vel) > 18;
        const lean = dragged ? 4 : -16 - pl.strain * 12;
        pl.lean += (lean - pl.lean) * Math.min(1, dt * 10);
        av.sprite.setAngle(pl.lean * -sign);
        av.play(this.state === 'play' ? (dragged ? 'run' : 'walk') : 'idle');
        av.sprite.anims.timeScale = this.state === 'play' ? (dragged ? 0.7 : 0.35 + pl.strain * 0.8) : 1;
        if (dragged && Math.random() < 0.25) Vfx.dust(this, x, pl.y, sign);
        av.setPos(x, pl.y);
      } else {
        av.setPos(x, pl.y);
      }
      // ring
      const g = pl.ring;
      g.clear();
      if (this.state === 'play' && this.winner < 0) {
        const bt = this.beats[pl.next];
        if (bt !== undefined) {
          const iv = this.interval(Math.max(0, pl.next - 1));
          const f = (bt - now) / iv; // 1 → just spawned, 0 → on target
          if (f <= 1.05) {
            const r = R_TARGET + (R_START - R_TARGET) * Math.max(0, f);
            const rr = f < 0 ? R_TARGET * (1 + f * 2) : r;
            const close = Math.abs(bt - now) <= PERFECT;
            g.lineStyle(7, 0x1b1f3b, 0.5).strokeCircle(pl.drum.x, pl.drum.y, Math.max(4, rr));
            g.lineStyle(4, close ? 0xffe066 : 0xffffff, Math.min(1, 1.6 - f)).strokeCircle(pl.drum.x, pl.drum.y, Math.max(4, rr));
          }
        }
        g.lineStyle(2, 0xffffff, 0.35).strokeCircle(pl.drum.x, pl.drum.y, R_TARGET);
      }
    }
    // crowd
    const lead = Math.sign(this.pos);
    for (const c of this.crowd) {
      if (c.ph < 0) continue;
      const hype = lead === (c.team === 0 ? -1 : 1) ? 3 : 1;
      c.img.y = c.base - Math.abs(Math.sin(this.t * (3 + hype) + c.ph)) * hype;
    }
    this.clouds.tilePositionX = this.t * 6;
    this.clouds.tilePositionY = this.t * 2;
    // beat pulse on the drums (shared tempo)
    if (this.state === 'play') {
      const bi = this.beats.findIndex((b) => b > now) - 1;
      if (bi >= 0 && bi !== this.lastBeatSfx) {
        this.lastBeatSfx = bi;
        Audio.sfx('drum', 0.9);
      }
    }
  }

  tick(dt: number): void {
    const now = this.elapsed;
    if (this.winner >= 0) {
      this.endT -= dt;
      if (this.endT <= 0) this.finish();
      return;
    }
    for (const pl of this.pullers) {
      const bt = this.beats[pl.next];
      if (bt === undefined) continue;
      // CPU plays its own drum
      if (this.isCpu(pl.p)) {
        if (pl.cpuAt < 0) {
          const g = (Math.random() + Math.random() + Math.random() - 1.5) * 2 * pl.cpuSigma;
          pl.cpuAt = Math.random() < pl.cpuMissChance ? bt + 9 : bt + g;
        }
        if (now >= pl.cpuAt) this.tap(pl, now);
      }
      if (now > bt + GOOD) this.judge(pl, 'miss');
    }
    if (Math.abs(this.pos) >= WIN_DIST || Math.abs(this.target) >= WIN_DIST + 6) {
      this.pos = Phaser.Math.Clamp(this.pos, -WIN_DIST - 4, WIN_DIST + 4);
      this.resolve(this.pos < 0 ? 0 : 1);
    }
    void dt;
  }

  /** A team pulled the flag over its line: celebrate, then results. */
  private resolve(team: number): void {
    if (this.winner >= 0) return;
    this.winner = team;
    this.endT = 1.6;
    this.playEnding(team);
  }

  private playEnding(team: number): void {
    if (this.resolved) return;
    this.resolved = true;
    Audio.sfx('explode');
    Audio.sfx('power');
    Vfx.shake(this, 0.01, 260);
    if (team >= 0) {
      const sign = team === 0 ? -1 : 1;
      this.vel = 0;
      for (const pl of this.pullers) {
        const s = pl.av.sprite;
        this.tweens.killTweensOf(s);
        if (pl.team === team) {
          // winners tumble backwards with the rope, then cheer
          pl.av.play('fall', true);
          this.tweens.add({ targets: pl, off: pl.off + sign * 26, duration: 380, ease: 'Quad.easeOut' });
          this.tweens.add({ targets: s, angle: 70 * sign, duration: 260, yoyo: true, hold: 300, ease: 'Quad.easeOut', onComplete: () => pl.av.play('cheer', true) });
          Vfx.dust(this, pl.av.x, pl.av.y, sign);
        } else {
          // losers face-plant toward the mud
          pl.av.play('hit', true);
          this.tweens.add({ targets: pl, off: pl.off + sign * 30, duration: 420, ease: 'Quad.easeIn' });
          this.tweens.add({ targets: s, angle: 85 * sign, duration: 420, ease: 'Bounce.easeOut', onComplete: () => { pl.av.play('lose', true); burst(this, pl.av.x + sign * 20, pl.av.y, { tex: 'dot3', count: 12, tint: [0x7a5636, 0x5a3a20, 0x8a6644], speed: [60, 140], angle: [200, 340], gravity: 400, life: 600 }); Audio.sfx('splash'); } });
        }
      }
      this.tweens.add({ targets: this, pos: this.pos + sign * 26, duration: 380, ease: 'Quad.easeOut' });
      Vfx.confetti(this, this.vw / 2 + sign * 150, this.vh / 2, 70);
      const label = team === 0 ? 'ทีมซ้ายชนะ!' : 'ทีมขวาชนะ!';
      for (const [deg, y] of [[0, this.vh * 0.84], [180, this.vh * 0.16]] as const) {
        const t = txt(this, this.vw / 2, y, label, { size: 34, color: toCss(shift(TEAM_COL[team], 0.3)), strokeWidth: 7 }).setAngle(deg).setDepth(4000);
        this.tweens.add({ targets: t, scale: { from: 0.3, to: 1 }, duration: 320, ease: 'Back.easeOut' });
      }
    } else {
      for (const pl of this.pullers) pl.av.play('lose', true);
    }
    for (const pl of this.pullers) pl.ring.clear();
  }

  finish(): void {
    if (this.winner < 0 && !this.resolved) {
      const team = Math.abs(this.pos) < 1 ? -1 : this.pos < 0 ? 0 : 1;
      this.winner = team === -1 ? 2 : team;
      this.playEnding(team);
    }
    super.finish();
  }

  results(): PlayerResult[] {
    const w = this.winner === 2 ? -1 : this.winner >= 0 ? this.winner : Math.abs(this.pos) < 1 ? -1 : this.pos < 0 ? 0 : 1;
    return this.players.map((p) => {
      const t = this.team(p);
      const pl = this.pullers.find((o) => o.p === p);
      return { player: p, rank: w === -1 ? 2 : w === t ? 1 : 3, score: pl?.contrib ?? 0, team: t };
    });
  }
}

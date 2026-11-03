import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Avatar, playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { TouchButton } from '../../ui/Controls';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { SplitKit } from '../kit/SplitKit';

const ID = 'wobble-race';
const START_X = 70;
const LENGTH = 1500;
const FINISH_X = START_X + LENGTH;
const BEAM = 138;
const WATER = 172;
/** Unstable pendulum gain (1/s²). */
const G = 6.5;
const FALL_ANGLE = 1.0;
const SWAY = 1.65;
const STEP = 18;
const PX_PER_M = 30;

interface Zone { x0: number; x1: number; kind: 'wind' | 'wobbly'; dir: number }

interface Walker {
  p: PlayerIndex;
  av: Avatar;
  x: number;
  shownX: number;
  th: number;
  w: number;
  lastSide: number;
  fallT: number;
  grace: number;
  finished: number;
  best: number;
  layers: { ts: Phaser.GameObjects.TileSprite; f: number }[];
  sky: Phaser.GameObjects.Image;
  water: Phaser.GameObjects.TileSprite[];
  gauge: Phaser.GameObjects.Image;
  needle: Phaser.GameObjects.Image;
  wobblies: { img: Phaser.GameObjects.TileSprite; y: number }[];
  fans: Phaser.GameObjects.Image[];
  winds: Phaser.GameObjects.Particles.ParticleEmitter[];
  btnL?: TouchButton;
  btnR?: TouchButton;
  hintL?: Phaser.GameObjects.Image;
  hintR?: Phaser.GameObjects.Image;
  steps: number;
  // CPU
  skill: number;
  thr: number;
  react: number;
  idle: number;
  nextThr: number;
}

/** #15 — Balance-beam race over a pool: step under your lean, left and right, or splash. */
export default class WobbleRace extends BaseMinigame {
  private split!: SplitKit;
  private walkers: Walker[] = [];
  private zones: Zone[] = [];
  private finishOrder: PlayerIndex[] = [];
  private bars: Phaser.GameObjects.Image[][] = [];
  private t = 0;

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.walkers = [];
    this.finishOrder = [];
    this.t = 0;
    this.zones = [
      { x0: 380, x1: 520, kind: 'wind', dir: 1 },
      { x0: 640, x1: 760, kind: 'wobbly', dir: 0 },
      { x0: 900, x1: 1040, kind: 'wind', dir: -1 },
      { x0: 1150, x1: 1280, kind: 'wobbly', dir: 0 },
      { x0: 1360, x1: 1480, kind: 'wind', dir: 1 },
    ];
    this.split = new SplitKit(this);
    this.paintArt();
    for (const p of this.players) this.makeTrack(p);
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) if (!this.players.includes(p)) this.split.cams[p].setVisible(false);
    this.buildProgressBars();
    for (const w of this.walkers) this.hudText[w.p] = '0m';
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const vw = Math.ceil(this.split.viewW / S), vh = Math.ceil(this.split.viewH / S);
    makeTexture(this, `${ID}-sky-${vw}`, vw, vh, (p) => p.gradient(0, 0, vw, vh, [0x5fb8f5, 0x8fd3ff, 0xc9ecff, 0xe8f8ff]));
    makeTexture(this, `${ID}-clouds`, 160, 40, (p) => {
      const r = rng(15);
      for (let i = 0; i < 3; i++) {
        const cx = 20 + i * 55 + r() * 10, cy = 12 + r() * 16;
        p.ball(cx, cy, 12, 6, 0xffffff, false); p.ball(cx + 10, cy - 3, 9, 6, 0xffffff, false); p.hline(cx - 10, cy + 5, 26, 0xdbe9f7);
      }
    });
    // far: water-park slides + palms
    makeTexture(this, `${ID}-far`, 220, 70, (p) => {
      const r = rng(23);
      // slide tower
      p.box(30, 18, 18, 52, 0xf0e0c8);
      p.rect(28, 14, 22, 5, 0xff7a85);
      for (let y = 22; y < 68; y += 10) p.hline(31, y, 16, 0xd8c8b0);
      // swirly slides
      for (let k = 0; k < 40; k++) {
        const t = k / 40;
        const x = 48 + t * 60, y = 22 + t * 44 + Math.sin(t * 9) * 6;
        p.circle(x, y, 2.5, 0x3d9bff);
        const x2 = 30 - t * 26, y2 = 24 + t * 42 + Math.cos(t * 8) * 4;
        p.circle(x2, y2, 2.5, 0xffc93d);
      }
      // palms
      for (let i = 0; i < 3; i++) {
        const px = 130 + i * 30 + r() * 8, top = 20 + r() * 10;
        for (let y = top; y < 70; y++) p.px(px + Math.round(Math.sin((y - top) * 0.06) * 3), y, 0x9a6a3f);
        for (let a = 0; a < 6; a++) {
          const ang = (a / 6) * Math.PI * 2;
          for (let l = 0; l < 12; l++) p.px(px + Math.round(Math.cos(ang) * l), Math.round(top + Math.sin(ang) * l * 0.6 + (l * l) / 24), 0x3f9a4a);
        }
      }
      p.rect(0, 66, 220, 4, 0xbfe3d0);
    });
    makeTexture(this, `${ID}-fence`, 64, 30, (p) => {
      p.rect(0, 22, 64, 8, 0xe8e2d6);
      p.hline(0, 22, 64, 0xffffff);
      for (let x = 4; x < 64; x += 16) { p.rect(x, 4, 3, 20, 0xffffff); p.vline(x + 2, 4, 20, 0xc9ccd6); }
      p.rect(0, 8, 64, 2, 0xffffff);
      // lifebuoy
      p.ring(40, 14, 6, 0xff5a6e, 3);
      for (const [x, y] of [[40, 8], [40, 19], [34, 14], [45, 14]]) p.rect(x - 1, y - 1, 2, 2, 0xffffff);
    });
    makeTexture(this, `${ID}-water`, 32, 40, (p) => {
      p.gradient(0, 0, 32, 40, [0x4fc3f0, 0x2f9fd8, 0x1f7fc0, 0x186aa8]);
      p.hline(0, 0, 32, 0xbff0ff);
      for (let x = 0; x < 32; x += 8) { p.hline(x, 1, 4, 0x9fe3ff); }
      const r = rng(5);
      for (let i = 0; i < 14; i++) p.hline(Math.floor(r() * 30), 4 + Math.floor(r() * 34), 3, 0x6cd0f8);
    });
    makeTexture(this, `${ID}-water-hi`, 48, 40, (p) => {
      const r = rng(6);
      for (let i = 0; i < 12; i++) { const x = Math.floor(r() * 44), y = 3 + Math.floor(r() * 34); p.hline(x, y, 4, 0xdff8ff); }
    });
    makeTexture(this, `${ID}-beam`, 32, 8, (p) => {
      p.rect(0, 0, 32, 6, 0xd49a58);
      p.hline(0, 0, 32, 0xf0c080);
      p.hline(0, 5, 32, 0x9a6a3f);
      p.px(8, 2, 0xb07a48); p.px(22, 3, 0xb07a48); p.vline(31, 0, 6, 0xb07a48);
      p.rect(0, 6, 32, 2, 0x1b3a5a);
    });
    makeTexture(this, `${ID}-beam-wob`, 32, 8, (p) => {
      for (let x = 0; x < 32; x += 8) { p.rect(x, 0, 4, 6, 0xff5a6e); p.rect(x + 4, 0, 4, 6, 0xfff8e7); }
      p.hline(0, 0, 32, 0xffffff);
      p.hline(0, 5, 32, 0xb3263a);
      p.rect(0, 6, 32, 2, 0x1b3a5a);
    });
    makeTexture(this, `${ID}-post`, 6, 26, (p) => {
      p.rect(1, 0, 4, 26, 0xc7c9d6); p.vline(4, 0, 26, 0x8f93a6); p.vline(1, 0, 26, 0xe8eaf2);
    });
    makeTexture(this, `${ID}-deck`, 16, 16, (p) => {
      p.box(0, 0, 16, 16, 0xe8eef8);
      p.box(0, 0, 8, 8, 0xd8e4f2); p.box(8, 8, 8, 8, 0xd8e4f2);
    });
    makeTexture(this, `${ID}-flag`, 22, 46, (p) => {
      p.rect(0, 0, 2, 46, 0xd8dbe4);
      for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) p.rect(2 + x * 4, 2 + y * 4, 4, 4, (x + y) % 2 ? 0x1b1f3b : 0xffffff);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-sign`, 14, 12, (p) => {
      p.box(0, 0, 14, 8, 0xfff8e7);
      p.rect(6, 8, 2, 4, 0x9a6a3f);
      p.outline(-0.7);
    });
    makeSheet(this, `${ID}-fan`, 18, 18, 2, (p, i) => {
      p.ring(9, 9, 8.5, 0x8f98a8, 1);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + i * 0.5;
        p.stroke(9, 9, Math.round(9 + Math.cos(a) * 7), Math.round(9 + Math.sin(a) * 7), 3, 0x6ec6ff);
      }
      p.circle(9, 9, 2, 0x3a3f6b);
      p.outline(-0.6);
    });
    makeTexture(this, `${ID}-gauge`, 30, 16, (p) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 30; x++) {
        const dx = x + 0.5 - 15, dy = y + 0.5 - 15;
        const d = Math.hypot(dx, dy);
        if (d > 14.5 || d < 10 || dy > 0) continue;
        const a = Math.abs(Math.atan2(dx, -dy));
        const c = a < 0.3 ? 0x3ed17a : a < 0.65 ? 0xffc93d : 0xff5a3d;
        p.px(x, y, d > 13.5 || d < 11 ? shift(c, -0.35) : c);
      }
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-needle`, 3, 12, (p) => { p.rect(1, 0, 1, 11, 0xffffff); p.rect(0, 9, 3, 3, 0x1b1f3b); });
    makeTexture(this, `${ID}-hint`, 40, 40, (p) => { p.ring(20, 20, 19, 0xffffff, 3); p.ring(20, 20, 15, 0xffffff, 1); });
  }

  private makeTrack(p: PlayerIndex): void {
    const y0 = this.split.offsetY(p);
    const vw = this.split.viewW;
    const sky = this.add.image(0, y0, `${ID}-sky-${Math.ceil(vw / S)}`).setOrigin(0).setScale(S).setDepth(-100);
    const layers = [
      { ts: this.add.tileSprite(0, y0 + 2, vw / S, 40, `${ID}-clouds`).setOrigin(0).setScale(S).setDepth(-95), f: 0.06 },
      { ts: this.add.tileSprite(0, y0 + 36, vw / S, 70, `${ID}-far`).setOrigin(0).setScale(S).setDepth(-90), f: 0.22 },
      { ts: this.add.tileSprite(0, y0 + 114, vw / S, 30, `${ID}-fence`).setOrigin(0).setScale(S).setDepth(-85), f: 0.55 },
    ];
    // pool water (two layers) spanning the whole course
    const wLen = (FINISH_X + 700) / S;
    const water = [
      this.add.tileSprite(-300, y0 + WATER, wLen, 40, `${ID}-water`).setOrigin(0).setScale(S).setDepth(-60),
      this.add.tileSprite(-300, y0 + WATER, wLen, 40, `${ID}-water-hi`).setOrigin(0).setScale(S).setDepth(-59).setAlpha(0.7),
    ];
    // start & finish decks
    this.add.tileSprite(-300, y0 + BEAM, (START_X + 300) / S, 60, `${ID}-deck`).setOrigin(0).setScale(S).setDepth(-50);
    this.add.tileSprite(FINISH_X, y0 + BEAM, 400 / S, 60, `${ID}-deck`).setOrigin(0).setScale(S).setDepth(-50);
    // the beam
    this.add.tileSprite(START_X, y0 + BEAM, LENGTH / S, 8, `${ID}-beam`).setOrigin(0).setScale(S).setDepth(-40);
    for (let x = START_X + 60; x < FINISH_X; x += 140) this.add.image(x, y0 + BEAM + 16, `${ID}-post`).setOrigin(0.5, 0).setScale(S).setDepth(-55);
    const wobblies: { img: Phaser.GameObjects.TileSprite; y: number }[] = [];
    const fans: Phaser.GameObjects.Image[] = [];
    const winds: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
    for (const z of this.zones) {
      if (z.kind === 'wobbly') {
        const img = this.add.tileSprite(z.x0, y0 + BEAM, (z.x1 - z.x0) / S, 8, `${ID}-beam-wob`).setOrigin(0).setScale(S).setDepth(-39);
        wobblies.push({ img, y: y0 + BEAM });
      } else {
        const fx = z.dir > 0 ? z.x0 - 20 : z.x1 + 20;
        this.add.image(fx, y0 + BEAM + 30, `${ID}-post`).setOrigin(0.5, 0).setScale(S, S * 0.6).setDepth(-38);
        const fan = this.add.sprite(fx, y0 + BEAM - 24, `${ID}-fan`, 0).setScale(S).setDepth(-37);
        fans.push(fan);
        const em = this.add.particles(0, 0, 'line', {
          x: { min: z.x0, max: z.x1 }, y: { min: y0 + BEAM - 80, max: y0 + BEAM - 10 }, lifespan: 500,
          speedX: { min: 160 * z.dir, max: 260 * z.dir }, scale: { start: S * 0.8, end: S * 0.3 }, alpha: { start: 0.7, end: 0 }, frequency: 70,
        });
        em.setDepth(-30);
        winds.push(em);
      }
    }
    // distance signs every 5 m
    for (let m = 5; m * PX_PER_M < LENGTH; m += 5) {
      const x = START_X + m * PX_PER_M;
      this.add.image(x, y0 + BEAM - 2, `${ID}-sign`).setOrigin(0.5, 1).setScale(S).setDepth(-45);
      txt(this, x, y0 + BEAM - 16, `${m}`, { size: 9, color: '#1b1f3b', strokeWidth: 0, shadow: false }).setDepth(-44);
    }
    this.add.image(FINISH_X + 6, y0 + BEAM + 2, `${ID}-flag`).setOrigin(0.5, 1).setScale(S).setDepth(-35);
    txt(this, FINISH_X + 60, y0 + BEAM - 70, 'FINISH', { size: 14, color: '#ffe066' }).setDepth(-34);

    const av = new Avatar(this, p, START_X - 20, y0 + BEAM, { depthSort: false });
    av.sprite.setDepth(10);
    av.shadow?.setVisible(false);
    av.marker?.setVisible(false);
    const gauge = this.add.image(0, 0, `${ID}-gauge`).setScale(S).setDepth(12).setOrigin(0.5, 1);
    const needle = this.add.image(0, 0, `${ID}-needle`).setScale(S).setDepth(13).setOrigin(0.5, 0.85);
    const w: Walker = {
      p, av, x: START_X - 20, shownX: START_X - 20, th: (Math.random() < 0.5 ? -1 : 1) * 0.06, w: 0, lastSide: 0, fallT: 0, grace: 0.6,
      finished: -1, best: 0, layers, sky, water, gauge, needle, wobblies, fans, winds, steps: 0,
      skill: 0.5 + Math.random() * 0.45, thr: 0.3, react: 0, idle: 0, nextThr: 0.3,
    };
    w.nextThr = this.cpuThreshold(w);
    if (!this.isCpu(p)) {
      w.btnL = new TouchButton(this, this.touch, p, 0.14, 0.78, 'left', 18);
      w.btnR = new TouchButton(this, this.touch, p, 0.86, 0.78, 'right', 18);
      w.btnL.onPress = () => this.step(w, -1);
      w.btnR.onPress = () => this.step(w, 1);
      const ang = this.angleFor(p);
      w.hintL = this.add.image(w.btnL.x, w.btnL.y, `${ID}-hint`).setScale(S).setDepth(899).setAngle(ang).setAlpha(0);
      w.hintR = this.add.image(w.btnR.x, w.btnR.y, `${ID}-hint`).setScale(S).setDepth(899).setAngle(ang).setAlpha(0);
    }
    this.walkers.push(w);
    this.split.look(p, START_X + this.split.viewW * 0.2, y0 + this.split.viewH / 2);
  }

  private buildProgressBars(): void {
    this.bars = [];
    for (const [deg, y] of [[0, this.vh / 2 + 9], [180, this.vh / 2 - 9]] as const) {
      const x0 = 60, x1 = this.vw - 60;
      this.add.rectangle(this.vw / 2, y, x1 - x0 + 8, 6, 0x1b1f3b, 0.85).setDepth(940);
      this.add.rectangle(deg === 0 ? x1 : x0, y, 4, 10, 0xffe066).setDepth(940);
      this.bars.push(this.players.map((p) => this.add.image(x0, y, playerMarkerKey(this, p)).setScale(S * 0.7).setDepth(942).setAngle(deg)));
    }
  }

  // ─────────────────────────── WALKING ───────────────────────────

  private zoneAt(x: number): Zone | undefined {
    return this.zones.find((z) => x >= z.x0 && x <= z.x1);
  }

  private step(w: Walker, side: number): void {
    if (this.state !== 'play' || w.finished >= 0 || w.fallT > 0) return;
    const y0 = this.split.offsetY(w.p);
    const lean = w.th * side; // > 0: leaning toward this foot
    const a = Math.abs(w.th);
    let adv = 0;
    let label = '';
    if (lean > -0.05) {
      // stepping under the lean catches you and sways you the other way
      if (a < 0.1) { adv = STEP * 0.45; w.w = -side * SWAY * 0.7; w.th *= 0.5; }
      else if (a < 0.6) {
        const perfect = a >= 0.24 && a <= 0.5;
        adv = perfect ? STEP * 1.35 : STEP;
        w.w = -side * SWAY;
        w.th *= 0.35;
        if (perfect) label = 'เป๊ะ!';
      } else { adv = STEP * 0.6; w.w = -side * SWAY * 1.25; w.th *= 0.55; label = 'เฉียด!'; }
      if (w.lastSide === side) adv *= 0.6; // shuffling the same foot is slower
      Audio.sfx('land', 1.1 + (side > 0 ? 0.15 : 0) + w.p * 0.05);
      if (label === 'เป๊ะ!') {
        Audio.sfx('coin', 1.3 + w.p * 0.05);
        Vfx.sparkle(this, w.x + 10, y0 + BEAM - 60, [0xffffff, 0xffe066]);
      }
    } else {
      // wrong foot: you push yourself further over
      adv = STEP * 0.2;
      w.w += -side * 1.3;
      label = 'ผิดขา!';
      Audio.sfx('wrong', 1 + w.p * 0.05);
    }
    w.lastSide = side;
    w.steps++;
    w.x = Math.min(FINISH_X + 30, w.x + adv);
    if (label) Vfx.popText(this, w.x, y0 + BEAM - 118, label, label === 'ผิดขา!' ? '#ff7a85' : '#ffe066', 14, 0);
    burst(this, w.x - side * 4, y0 + BEAM, { tex: 'dust', count: 3, tint: [0xffffff, 0xf0e0c8], speed: [20, 50], angle: [190, 350], life: 300, scale: [S * 0.6, 0] });
    Vfx.squash(this, w.av.sprite, 1.12, 0.9, 120);
    w.av.sprite.anims.nextFrame?.();
  }

  private fall(w: Walker): void {
    const y0 = this.split.offsetY(w.p);
    w.fallT = 1.7;
    const dir = Math.sign(w.th) || 1;
    Audio.sfx('whoosh', 1 + w.p * 0.05);
    const s = w.av.sprite;
    w.av.play('fall', true);
    this.tweens.add({ targets: s, y: y0 + WATER + 18, x: s.x + dir * 22, angle: dir * 150, duration: 420, ease: 'Quad.easeIn', onComplete: () => {
      Audio.sfx('splash', 1 + w.p * 0.08);
      burst(this, s.x, y0 + WATER + 2, { tex: 'dot3', count: 22, tint: [0xffffff, 0xbfeaff, 0x6cc8f4], speed: [70, 220], angle: [200, 340], gravity: 500, life: 700, depth: 20 });
      const ring = this.add.image(s.x, y0 + WATER + 4, 'ring').setScale(0.5, 0.2).setDepth(-58).setTint(0xdff6ff);
      this.tweens.add({ targets: ring, scaleX: 3, scaleY: 0.8, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
      s.setAlpha(0.0);
    } });
    Vfx.popText(this, w.x, y0 + BEAM - 100, 'ตูม! ตกน้ำ', '#bfeaff', 16, 0);
    w.gauge.setVisible(false);
    w.needle.setVisible(false);
  }

  private respawn(w: Walker): void {
    w.x = Math.max(START_X - 20, w.x - 90);
    w.shownX = w.x;
    w.th = (Math.random() < 0.5 ? -1 : 1) * 0.05;
    w.w = 0;
    w.grace = 0.7;
    w.lastSide = 0;
    const s = w.av.sprite;
    this.tweens.killTweensOf(s);
    s.setAngle(0).setAlpha(1);
    w.gauge.setVisible(true);
    w.needle.setVisible(true);
    w.av.play('idle', true);
    Vfx.squash(this, s, 0.7, 1.3, 200);
    Audio.sfx('jump', 1 + w.p * 0.05);
  }

  ambient(dt: number): void {
    this.t += dt;
    for (const w of this.walkers) this.syncWalker(w, dt);
  }

  tick(dt: number): void {
    for (const w of this.walkers) {
      if (this.isCpu(w.p)) this.bot(w, dt);
      this.physicsStep(w, dt);
    }
    // HUD: metres or finish place
    for (const w of this.walkers) {
      const i = this.finishOrder.indexOf(w.p);
      this.hudText[w.p] = i >= 0 ? `🏁${i + 1}` : `${Math.max(0, Math.floor((w.x - START_X) / PX_PER_M))}m`;
    }
    if (this.walkers.every((w) => w.finished >= 0)) this.finish();
  }

  private physicsStep(w: Walker, dt: number): void {
    if (w.finished >= 0) return;
    if (w.fallT > 0) {
      w.fallT -= dt;
      if (w.fallT <= 0) this.respawn(w);
      return;
    }
    if (w.grace > 0) { w.grace -= dt; w.th = (Math.sign(w.th) || 1) * 0.07; w.w = 0; return; }
    const z = this.zoneAt(w.x);
    let g = G * (z?.kind === 'wobbly' ? 1.45 : 1);
    let torque = g * Math.sin(w.th);
    if (z?.kind === 'wind') torque += z.dir * 1.3;
    // tiny random wobble so you can't stand still forever
    torque += Math.sin(this.t * 2.3 + w.p * 1.7) * 0.4;
    w.w += torque * dt;
    w.w *= Math.exp(-0.35 * dt);
    w.th += w.w * dt;
    if (Math.abs(w.th) > FALL_ANGLE) this.fall(w);
    w.best = Math.max(w.best, w.x);
    if (w.x >= FINISH_X) {
      w.finished = this.elapsed;
      this.finishOrder.push(w.p);
      const place = this.finishOrder.length;
      const y0 = this.split.offsetY(w.p);
      Audio.sfx(place === 1 ? 'power' : 'coin');
      Vfx.confetti(this, w.x, y0 + 40, 40);
      Vfx.popText(this, w.x, y0 + 70, ['ที่ 1!', 'ที่ 2!', 'ที่ 3!', 'ที่ 4!'][place - 1], toCss(PLAYER_COLORS[w.p].light), 22, 0);
      w.th = 0; w.w = 0;
      w.av.play('win', true);
    }
  }

  private syncWalker(w: Walker, dt: number): void {
    const y0 = this.split.offsetY(w.p);
    w.shownX += (w.x - w.shownX) * Math.min(1, dt * 14);
    const z = this.zoneAt(w.shownX);
    const bob = z?.kind === 'wobbly' ? Math.sin(this.t * 7) * 2 : 0;
    const av = w.av;
    if (w.fallT <= 0) {
      av.setPos(w.shownX, y0 + BEAM + bob);
      av.sprite.setAngle((w.th * 180) / Math.PI * 0.9);
      av.marker?.setAngle(0);
      const moving = Math.abs(w.x - w.shownX) > 1;
      if (w.finished >= 0) av.play('win');
      else if (Math.abs(w.th) > 0.62) av.play('stun');
      else av.play(moving ? 'walk' : 'idle');
      // marker hovers over the head even when leaning
      w.gauge.setPosition(w.shownX, y0 + BEAM - 78 + bob).setVisible(w.finished < 0);
      w.needle.setPosition(w.shownX, y0 + BEAM - 80 + bob).setRotation(Phaser.Math.Clamp(w.th, -1.2, 1.2) * 1.25).setVisible(w.finished < 0);
    }
    for (const wb of w.wobblies) wb.img.y = wb.y + Math.sin(this.t * 7) * 2;
    for (const f of w.fans) f.setFrame(Math.floor(this.t * 16) % 2);
    // hints on the human's buttons: which foot catches the lean
    if (w.hintL && w.hintR) {
      const need = w.fallT > 0 || w.finished >= 0 || Math.abs(w.th) < 0.12 ? 0 : Math.sign(w.th);
      const pulse = 0.5 + Math.sin(this.t * 14) * 0.3 + Math.min(0.3, Math.abs(w.th) * 0.4);
      w.hintL.setAlpha(need < 0 ? pulse : 0).setTint(Math.abs(w.th) > 0.6 ? 0xff7a85 : 0xffe066);
      w.hintR.setAlpha(need > 0 ? pulse : 0).setTint(Math.abs(w.th) > 0.6 ? 0xff7a85 : 0xffe066);
    }
    // camera + parallax
    const camX = Phaser.Math.Clamp(w.shownX + this.split.viewW * 0.12, this.split.viewW / 2, FINISH_X + 120);
    this.split.look(w.p, camX, y0 + this.split.viewH / 2);
    const left = camX - this.split.viewW / 2;
    w.sky.x = left;
    for (const l of w.layers) { l.ts.x = left; l.ts.tilePositionX = (left * l.f) / S; }
    w.water[0].tilePositionX = this.t * 6;
    w.water[1].tilePositionX = -this.t * 10;
    w.water[1].setAlpha(0.5 + Math.sin(this.t * 2 + w.p) * 0.2);
    // progress bars
    const k = this.players.indexOf(w.p);
    const prog = Phaser.Math.Clamp((w.shownX - START_X) / LENGTH, 0, 1);
    const x0 = 60, x1 = this.vw - 60;
    if (this.bars[0]?.[k]) this.bars[0][k].x = x0 + (x1 - x0) * prog;
    if (this.bars[1]?.[k]) this.bars[1][k].x = x1 - (x1 - x0) * prog;
  }

  // ─────────────────────────── CPU ───────────────────────────

  private cpuThreshold(w: Walker): number {
    // good CPUs wait for the sweet spot, weaker ones panic early or late
    const centre = 0.36;
    const spread = 0.08 + (1 - w.skill) * 0.3;
    return Phaser.Math.Clamp(centre + (Math.random() - 0.5) * 2 * spread, 0.08, 0.85);
  }

  private bot(w: Walker, dt: number): void {
    if (w.finished >= 0 || w.fallT > 0 || w.grace > 0) return;
    const a = Math.abs(w.th);
    w.idle += dt;
    if (a >= w.nextThr || w.idle > 1.1) {
      w.react -= dt;
      if (w.react <= 0) {
        const side = Math.sign(w.th) || 1;
        const oops = Math.random() < 0.03 + (1 - w.skill) * 0.08;
        this.step(w, oops ? -side : side);
        w.nextThr = this.cpuThreshold(w);
        w.react = 0.03 + Math.random() * (0.05 + (1 - w.skill) * 0.12);
        w.idle = 0;
      }
    }
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => {
      const i = this.finishOrder.indexOf(p);
      if (i >= 0) return 100000 - i;
      return this.walkers.find((w) => w.p === p)?.best ?? 0;
    };
    return rankBy(this.players, value).map((r) => {
      const w = this.walkers.find((x) => x.p === r.player)!;
      return { ...r, score: Math.max(0, Math.floor((Math.min(w.best, FINISH_X) - START_X) / PX_PER_M)) };
    });
  }
}

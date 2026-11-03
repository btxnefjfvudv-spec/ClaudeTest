import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { playerMarkerKey } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { SplitKit } from '../kit/SplitKit';

const CEIL = 22;
const FLOOR = 222;
const START_X = 80;
const COURSE = 15000;
const GRAV = 300;
const LIFT = 165;
const MAX_FALL = 120;
const BASE_V = 150;
const WALL_W = 28;
const PLANE_R = 7;

type ObKind = 'wall' | 'fan' | 'draft' | 'star';
interface Ob { kind: ObKind; x: number; gy: number; gh: number; w: number }

interface Plane {
  p: PlayerIndex;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wobble: number;
  invuln: number;
  boost: number;
  crashes: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  layers: { ts: Phaser.GameObjects.TileSprite; f: number }[];
  sky: Phaser.GameObjects.Image;
  ghosts: { q: PlayerIndex; img: Phaser.GameObjects.Image; mark: Phaser.GameObjects.Image }[];
  stars: (Phaser.GameObjects.Image | undefined)[];
  got: Set<number>;
  fans: Phaser.GameObjects.Sprite[];
  streaks: { img: Phaser.GameObjects.Image; ob: Ob; ph: number }[];
  hint?: Phaser.GameObjects.Text;
  floorT: number;
  // CPU
  cpuT: number;
  skill: number;
  aimErr: number;
}

/** #25 — Tap to keep a paper plane aloft through the school building. */
export default class PaperPlaneRace extends BaseMinigame {
  private split!: SplitKit;
  private obs: Ob[] = [];
  private planes: Plane[] = [];
  private t = 0;

  constructor() {
    super(CATALOG['paper-plane-race']);
  }

  setup(): void {
    this.planes = [];
    this.t = 0;
    this.split = new SplitKit(this);
    this.buildCourse();
    this.paintArt();
    for (const p of this.players) this.makeTrack(p);
    for (const pl of this.planes) {
      for (const q of this.players) {
        if (q === pl.p) continue;
        const y0 = this.split.offsetY(pl.p);
        const img = this.add.image(START_X, y0 + 120, `paper-plane-race-plane-${q}`).setScale(S).setAlpha(0.3).setDepth(y0 + 500);
        const mark = this.add.image(START_X, y0 + 100, playerMarkerKey(this, q)).setScale(S * 0.6).setAlpha(0.45).setDepth(y0 + 501);
        pl.ghosts.push({ q, img, mark });
      }
    }
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) if (!this.players.includes(p)) this.split.cams[p].setVisible(false);
    this.touch.on('down', (t: { player: PlayerIndex }) => {
      const pl = this.planes.find((x) => x.p === t.player);
      if (pl && !this.isCpu(pl.p)) this.flap(pl);
    });
  }

  // ───────────────────────────── COURSE ─────────────────────────────

  private buildCourse(): void {
    const r = rng(2525);
    this.obs = [];
    let x = 520;
    let lastGap = 120;
    let n = 0;
    while (x < COURSE) {
      const roll = r();
      const diff = Math.min(1, x / 9000);
      if (roll < 0.58 || n < 2) {
        const gh = 96 - diff * 26 + r() * 14;
        let gy = lastGap + (r() - 0.5) * (80 + diff * 50);
        if (r() < 0.22) gy = r() < 0.5 ? CEIL + gh / 2 + 4 : FLOOR - gh / 2 - 4; // pillar: gap hugs the ceiling or floor
        gy = Phaser.Math.Clamp(gy, CEIL + gh / 2 + 2, FLOOR - gh / 2 - 2);
        // an updraft just before a high gap helps
        if (gy < 100 && r() < 0.7) this.obs.push({ kind: 'draft', x: x - 150, gy: 0, gh: 0, w: 56 });
        this.obs.push({ kind: 'wall', x, gy, gh, w: WALL_W });
        if (r() < 0.45) this.obs.push({ kind: 'star', x: x + 2, gy, gh: 0, w: 0 });
        lastGap = gy;
        x += 270 + r() * 120 - diff * 40;
      } else if (roll < 0.82) {
        const fy = CEIL + 34 + r() * 46;
        this.obs.push({ kind: 'fan', x, gy: fy, gh: 14, w: 66 });
        if (r() < 0.5) this.obs.push({ kind: 'star', x, gy: fy + 62, gh: 0, w: 0 });
        lastGap = Phaser.Math.Clamp(fy + 70, 110, 190);
        x += 230 + r() * 100;
      } else {
        this.obs.push({ kind: 'draft', x, gy: 0, gh: 0, w: 56 });
        this.obs.push({ kind: 'star', x: x + 40, gy: CEIL + 40 + r() * 30, gh: 0, w: 0 });
        lastGap = 80;
        x += 200 + r() * 80;
      }
      n++;
    }
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const vw = Math.ceil(this.split.viewW / S);
    makeTexture(this, `paper-plane-race-sky-${vw}`, vw, 120, (p) => p.gradient(0, 0, vw, 120, [0x6ec6ff, 0x9fdcff, 0xe3f6ff]));
    makeTexture(this, 'paper-plane-race-clouds', 180, 40, (p) => {
      const r = rng(4);
      for (let i = 0; i < 4; i++) {
        const cx = 18 + i * 44 + r() * 8, cy = 12 + r() * 14;
        p.ball(cx, cy, 11, 5, 0xffffff, false); p.ball(cx + 9, cy - 3, 8, 5, 0xffffff, false); p.hline(cx - 9, cy + 4, 22, 0xd9ecfa);
      }
    });
    makeTexture(this, 'paper-plane-race-outside', 200, 60, (p) => {
      const r = rng(6);
      for (let x = 0; x < 200; x += 50) {
        p.box(x + 6, 22, 38, 38, 0xf0c9a0);
        p.rect(x + 4, 19, 42, 4, 0xc55a4a);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) p.rect(x + 10 + i * 12, 28 + j * 13, 7, 8, 0x7ab4dc);
      }
      for (let i = 0; i < 9; i++) p.ball(r() * 200, 46 + r() * 10, 10, 9, i % 2 ? 0x58b05a : 0x4a9a4e, false);
      p.rect(0, 54, 200, 6, 0x7cc46a);
    });
    // classroom wall with see-through windows
    makeTexture(this, 'paper-plane-race-wall', 220, 120, (p) => {
      const WALL = 0xf3e9cf;
      p.gradient(0, 0, 220, 86, [0xfaf3df, WALL, shift(WALL, -0.1)]);
      p.rect(0, 0, 220, 11, 0xe1d7bf);
      p.hline(0, 11, 220, shift(WALL, -0.35));
      // windows (transparent glass)
      for (const wx of [14, 120]) {
        p.box(wx - 3, 18, 62, 52, 0xc0834a);
        for (let y = 21; y < 67; y++) for (let x = wx; x < wx + 56; x++) p.clear(x, y);
        p.rect(wx + 27, 21, 2, 46, 0xc0834a);
        p.rect(wx, 43, 56, 2, 0xc0834a);
        p.rect(wx - 4, 69, 64, 3, 0xe0a96c);
        p.hline(wx - 4, 72, 64, 0x8a5a34);
      }
      // poster + clock between windows
      p.box(84, 24, 22, 28, 0xff7a85);
      p.rect(87, 28, 16, 8, 0xfff8e7);
      p.rect(87, 40, 10, 2, 0xfff8e7); p.rect(87, 44, 13, 2, 0xfff8e7);
      p.circle(200, 30, 7, 0xffffff); p.ring(200, 30, 7, 0x2b3263); p.vline(200, 25, 5, 0x2b3263); p.hline(200, 30, 4, 0x2b3263);
      // wainscot
      p.rect(0, 86, 220, 26, 0x5fa89a);
      p.hline(0, 86, 220, 0x7cc4b5);
      p.hline(0, 87, 220, 0x4a8a7e);
      for (let x = 0; x < 220; x += 22) p.vline(x, 88, 24, 0x548f84);
      p.rect(0, 108, 220, 4, 0x3f7268);
      p.rect(0, 112, 220, 8, 0x3f7268);
    });
    makeTexture(this, 'paper-plane-race-desks', 160, 34, (p) => {
      for (let i = 0; i < 2; i++) {
        const x = 10 + i * 80;
        p.box(x, 8, 46, 5, 0xc0834a);
        p.rect(x + 3, 13, 3, 21, 0x8a5a34); p.rect(x + 40, 13, 3, 21, 0x8a5a34);
        p.box(x + 52, 14, 16, 3, 0x5a6b8c); p.rect(x + 66, 2, 3, 15, 0x5a6b8c);
        p.rect(x + 53, 17, 2, 17, 0x3f4a63); p.rect(x + 64, 17, 2, 17, 0x3f4a63);
        p.box(x + 8, 2, 10, 6, 0x3d9bff); p.box(x + 20, 4, 8, 4, 0xffe066);
      }
    });
    makeTexture(this, 'paper-plane-race-floor', 32, 12, (p) => {
      p.rect(0, 0, 32, 12, 0xcf9a62);
      p.hline(0, 0, 32, 0xe8b880);
      for (let x = 0; x < 32; x += 16) p.vline(x, 0, 12, 0xa8764a);
      p.hline(0, 6, 32, 0xb8854f);
      p.px(5, 3, 0xa8764a); p.px(22, 9, 0xa8764a);
    });
    // obstacles
    makeTexture(this, 'paper-plane-race-column', 14, 16, (p) => {
      // hanging brick column
      p.rect(0, 0, 14, 16, 0xb8584a);
      for (let y = 0; y < 16; y += 4) {
        p.hline(0, y, 14, 0x8a3c36);
        const o = (y / 4) % 2 ? 0 : 4;
        for (let x = o; x < 14; x += 8) p.vline(x, y, 4, 0x8a3c36);
        p.hline(1, y + 1, 12, 0xcf7060);
      }
      p.vline(0, 0, 16, 0xe08a78);
      p.vline(13, 0, 16, 0x6e2e2a);
    });
    makeTexture(this, 'paper-plane-race-locker', 14, 22, (p) => {
      p.rect(0, 0, 14, 22, 0x4f7fc0);
      p.vline(0, 0, 22, 0x7aa4dc);
      p.vline(13, 0, 22, 0x2f5590);
      for (let y = 3; y < 9; y += 2) p.hline(3, y, 8, 0x2f5590);
      p.rect(10, 12, 2, 3, 0xd8dbe4);
      p.hline(0, 21, 14, 0x2f5590);
    });
    makeTexture(this, 'paper-plane-race-sill', 18, 4, (p) => { p.box(0, 0, 18, 4, 0xc0834a); p.hline(1, 1, 16, 0xe0a96c); p.outline(-0.6); });
    makeSheet(this, 'paper-plane-race-fan', 44, 22, 4, (p, i) => {
      p.rect(21, 0, 2, 10, 0x6b7290);
      p.ball(22, 12, 5, 3.5, 0xd8dbe4);
      const len = [20, 12, 4, 12][i];
      p.rect(22 - len, 13, len * 2, 3, 0x8a5a34);
      p.hline(22 - len, 13, len * 2, 0xc0834a);
      if (i === 1 || i === 3) { p.px(22 - len - 2, 14, 0xffffff, 120); p.px(22 + len + 1, 14, 0xffffff, 120); }
      p.outline(-0.7);
    });
    if (!this.anims.exists('paper-plane-race-spin')) this.anims.create({ key: 'paper-plane-race-spin', frames: this.anims.generateFrameNumbers('paper-plane-race-fan', {}), frameRate: 16, repeat: -1 });
    makeTexture(this, 'paper-plane-race-vent', 30, 10, (p) => {
      p.box(0, 2, 30, 8, 0x9aa3b8);
      for (let x = 3; x < 28; x += 3) p.vline(x, 4, 5, 0x4a5068);
      p.rect(10, 0, 10, 2, 0x6b7290);
      p.outline(-0.7);
    });
    makeTexture(this, 'paper-plane-race-streak', 2, 10, (p) => { p.vline(0, 0, 10, 0xffffff); p.vline(1, 2, 6, 0xdff6ff); });
    makeTexture(this, 'paper-plane-race-star', 11, 11, (p) => {
      p.tri(5.5, 0, 8, 7, 3, 7, 0xffe066);
      p.tri(0, 4, 11, 4, 5.5, 8, 0xffe066);
      p.tri(1.5, 11, 5.5, 6, 4, 4, 0xffe066);
      p.tri(9.5, 11, 5.5, 6, 7, 4, 0xffe066);
      p.px(5, 4, 0xffffff); p.px(4, 5, 0xfff3c4);
      p.outline(-0.8);
    });
    for (const q of this.players) {
      const c = PLAYER_COLORS[q];
      makeTexture(this, `paper-plane-race-plane-${q}`, 20, 10, (p) => {
        p.tri(0, 1, 19, 5, 0, 5, 0xffffff);
        p.tri(2, 5, 19, 5, 4, 9, 0xd8dee8);
        p.line(0, 5, 19, 5, 0xb8c0d0);
        p.line(1, 2, 14, 4, c.main);
        p.line(1, 3, 12, 4, c.main);
        p.rect(4, 6, 6, 1, shift(c.main, -0.2));
        p.outline(-0.7);
      });
    }
  }

  private makeTrack(p: PlayerIndex): void {
    const y0 = this.split.offsetY(p);
    const vw = this.split.viewW;
    const sky = this.add.image(0, y0, `paper-plane-race-sky-${Math.ceil(vw / S)}`).setOrigin(0).setScale(S).setDepth(y0 - 100);
    const layers = [
      { ts: this.add.tileSprite(0, y0 + 26, vw / S, 40, 'paper-plane-race-clouds').setOrigin(0).setScale(S).setDepth(y0 - 95), f: 0.08 },
      { ts: this.add.tileSprite(0, y0 + 40, vw / S, 60, 'paper-plane-race-outside').setOrigin(0).setScale(S).setDepth(y0 - 90), f: 0.18 },
      { ts: this.add.tileSprite(0, y0, vw / S, 120, 'paper-plane-race-wall').setOrigin(0).setScale(S).setDepth(y0 - 85).setTint(0xe4ddd2), f: 0.45 },
      { ts: this.add.tileSprite(0, y0 + FLOOR - 66, vw / S, 34, 'paper-plane-race-desks').setOrigin(0).setScale(S).setDepth(y0 - 80).setTint(0xcfc8c0), f: 0.7 },
    ];
    this.add.tileSprite(-200, y0 + FLOOR, (COURSE + 1200) / S, 12, 'paper-plane-race-floor').setOrigin(0).setScale(S).setDepth(y0 - 60);
    this.add.rectangle(-200, y0 + FLOOR + 22, COURSE + 1200, 60, 0x8a5a34).setOrigin(0).setDepth(y0 - 61);
    this.add.rectangle(-200, y0 - 40, COURSE + 1200, CEIL + 40, 0xd8ceb4).setOrigin(0).setDepth(y0 - 59);
    this.add.rectangle(-200, y0 + CEIL - 2, COURSE + 1200, 3, 0xb0a588).setOrigin(0).setDepth(y0 - 58);
    const stars: (Phaser.GameObjects.Image | undefined)[] = [];
    const fans: Phaser.GameObjects.Sprite[] = [];
    const streaks: Plane['streaks'] = [];
    this.obs.forEach((o, i) => {
      if (o.kind === 'wall') {
        const top = o.gy - o.gh / 2, bot = o.gy + o.gh / 2;
        if (top > CEIL) this.add.tileSprite(o.x, y0 + top, WALL_W / S, (top - CEIL + 40) / S, 'paper-plane-race-column').setOrigin(0.5, 1).setScale(S).setDepth(y0 - 20);
        if (bot < FLOOR) this.add.tileSprite(o.x, y0 + bot, WALL_W / S, (FLOOR - bot + 4) / S, 'paper-plane-race-locker').setOrigin(0.5, 0).setScale(S).setDepth(y0 - 20);
        if (top > CEIL + 4) this.add.image(o.x, y0 + top, 'paper-plane-race-sill').setScale(S).setDepth(y0 - 19);
        if (bot < FLOOR - 4) this.add.image(o.x, y0 + bot, 'paper-plane-race-sill').setScale(S).setDepth(y0 - 19);
      } else if (o.kind === 'fan') {
        this.add.rectangle(o.x, y0 + CEIL, 3, o.gy - CEIL - 10, 0x6b7290).setOrigin(0.5, 0).setDepth(y0 - 21);
        const f = this.add.sprite(o.x, y0 + o.gy - 13, 'paper-plane-race-fan', 0).setScale(S * 1.5, S).setDepth(y0 - 18);
        f.play({ key: 'paper-plane-race-spin', startFrame: i % 4 });
        fans.push(f);
      } else if (o.kind === 'draft') {
        this.add.image(o.x, y0 + FLOOR - 6, 'paper-plane-race-vent').setScale(S).setDepth(y0 - 19);
        for (let k = 0; k < 6; k++) {
          const img = this.add.image(o.x + (k - 2.5) * 9, y0 + FLOOR - 20, 'paper-plane-race-streak').setScale(S).setDepth(y0 - 17).setAlpha(0.5);
          streaks.push({ img, ob: o, ph: (k * 0.37) % 1 });
        }
      } else if (o.kind === 'star') {
        stars[i] = this.add.image(o.x, y0 + o.gy, 'paper-plane-race-star').setScale(S).setDepth(y0 - 10);
      }
    });
    // finish banner far away (nobody should reach it, but it's there)
    const shadow = this.add.image(START_X, y0 + FLOOR, 'shadow').setScale(S * 0.6, S * 0.4).setAlpha(0.2).setDepth(y0 - 55);
    const img = this.add.image(START_X, y0 + 120, `paper-plane-race-plane-${p}`).setScale(S * 1.25).setDepth(y0 + 600);
    const pl: Plane = {
      p, x: START_X, y: 120, vx: BASE_V, vy: 0, wobble: 0, invuln: 0, boost: 0, crashes: 0, img, shadow, layers, sky,
      ghosts: [], stars, got: new Set(), fans, streaks, floorT: 0,
      cpuT: 0, skill: 0.5 + Math.random() * 0.45, aimErr: 0,
    };
    if (!this.isCpu(p)) {
      pl.hint = txt(this, 0, 0, 'แตะ = เชิดหัว!', { size: 14, color: '#ffe066' }).setDepth(y0 + 700);
      this.tweens.add({ targets: pl.hint, alpha: 0.35, yoyo: true, repeat: -1, duration: 420 });
    }
    this.planes.push(pl);
    this.split.look(p, START_X + vw * 0.2, y0 + this.split.viewH / 2);
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  private flap(pl: Plane): void {
    if (this.state !== 'play') return;
    pl.vy = Math.max(-LIFT * 1.35, Math.min(pl.vy, 20) - LIFT);
    Audio.sfx('whoosh', 1.4 + pl.p * 0.08);
    Vfx.squash(this, pl.img, 0.85, 1.2, 120, S * 1.25);
    if (pl.hint) { pl.hint.destroy(); pl.hint = undefined; }
  }

  ambient(dt: number): void {
    this.t += dt;
    for (const pl of this.planes) this.sync(pl);
  }

  tick(dt: number): void {
    for (const pl of this.planes) {
      if (this.isCpu(pl.p)) this.bot(pl, dt);
      this.fly(pl, dt);
    }
    const order = this.planes;
    order.forEach((pl) => (this.hudText[pl.p] = `${this.meters(pl)}m`));
  }

  private meters(pl: Plane): number {
    return Math.max(0, Math.round((pl.x - START_X) / 10));
  }

  private fly(pl: Plane, dt: number): void {
    const y0 = this.split.offsetY(pl.p);
    pl.wobble = Math.max(0, pl.wobble - dt);
    pl.invuln = Math.max(0, pl.invuln - dt);
    pl.boost = Math.max(0, pl.boost - dt);
    pl.floorT = Math.max(0, pl.floorT - dt);
    // gravity with glide drag
    pl.vy = Math.min(MAX_FALL, pl.vy + GRAV * dt);
    // updrafts
    for (const o of this.obs) {
      if (o.kind !== 'draft' || Math.abs(pl.x - o.x) > o.w / 2) continue;
      pl.vy -= 820 * dt;
      if (Math.random() < 0.2) burst(this, pl.x, y0 + pl.y + 8, { tex: 'dot2', count: 1, tint: 0xffffff, speed: [20, 50], angle: [250, 290], life: 300 });
    }
    // energy: diving speeds you up, climbing slows you a touch
    const cruise = BASE_V + Math.min(80, this.elapsed * 1.8) + (pl.boost > 0 ? 110 : 0);
    pl.vx += (pl.vy * 0.35 + (cruise - pl.vx) * 1.2) * dt;
    pl.vx = Phaser.Math.Clamp(pl.vx, 40, 360);
    pl.x += pl.vx * dt;
    pl.y += pl.vy * dt;
    if (pl.y < CEIL + PLANE_R) { pl.y = CEIL + PLANE_R; pl.vy = 40; Audio.sfx('bounce', 1.6); }
    if (pl.y > FLOOR - PLANE_R) {
      pl.y = FLOOR - PLANE_R;
      pl.vy = -70;
      pl.vx *= 0.75;
      if (pl.floorT <= 0) {
        pl.floorT = 0.4;
        pl.wobble = Math.max(pl.wobble, 0.35);
        Audio.sfx('land');
        Vfx.dust(this, pl.x, y0 + FLOOR);
      }
    }
    // obstacles
    this.obs.forEach((o, i) => {
      if (Math.abs(o.x - pl.x) > 60) return;
      if (o.kind === 'star') {
        if (!pl.got.has(i) && Math.hypot(o.x - pl.x, o.gy - pl.y) < 18) {
          pl.got.add(i);
          pl.boost = 1.2;
          pl.vx = Math.max(pl.vx, cruise + 80);
          const s = pl.stars[i];
          if (s) { this.tweens.add({ targets: s, scale: S * 2, alpha: 0, duration: 250, onComplete: () => s.destroy() }); pl.stars[i] = undefined; }
          Audio.sfx('coin', 1 + pl.p * 0.08);
          Vfx.sparkle(this, o.x, y0 + o.gy, [0xffe066, 0xffffff]);
          Vfx.popText(this, o.x, y0 + o.gy - 20, 'BOOST!', '#ffe066', 14, 0);
        }
        return;
      }
      if (pl.invuln > 0) return;
      let hit = false;
      if (o.kind === 'wall') {
        if (Math.abs(pl.x - o.x) < o.w / 2 + PLANE_R && Math.abs(pl.y - o.gy) > o.gh / 2 - PLANE_R) hit = true;
      } else if (o.kind === 'fan') {
        if (Math.abs(pl.x - o.x) < o.w / 2 + PLANE_R - 4 && Math.abs(pl.y - o.gy) < o.gh / 2 + PLANE_R) hit = true;
      }
      if (hit) this.crash(pl, o);
    });
  }

  private crash(pl: Plane, o: Ob): void {
    const y0 = this.split.offsetY(pl.p);
    pl.crashes++;
    pl.vx = Math.max(40, pl.vx * 0.3);
    pl.wobble = 1.1;
    pl.invuln = 1.2;
    pl.boost = 0;
    if (o.kind === 'fan') pl.vy = 90;
    else pl.vy = pl.y < o.gy ? -60 : 60;
    Audio.sfx('hit', 1 + pl.p * 0.1);
    Vfx.hit(this, pl.x + 8, y0 + pl.y, [0xffffff, 0xd8dee8, PLAYER_COLORS[pl.p].light]);
    burst(this, pl.x, y0 + pl.y, { tex: 'confetti', count: 6, tint: [0xffffff, 0xe8ecf4], speed: [40, 120], gravity: 200, life: 700, rotate: true, scale: [S, S], alpha: [1, 0.6] });
    Vfx.popText(this, pl.x, y0 + pl.y - 22, 'ชน!', '#ff7a85', 16, 0);
    this.split.cams[pl.p].shake(160, 0.008);
  }

  private sync(pl: Plane): void {
    const y0 = this.split.offsetY(pl.p);
    let ang = Math.atan2(pl.vy, Math.max(60, pl.vx)) * 0.9;
    if (pl.wobble > 0) ang += Math.sin(this.t * 30) * 0.5 * pl.wobble;
    pl.img.setPosition(pl.x, y0 + pl.y).setRotation(ang);
    pl.img.setAlpha(pl.invuln > 0 && Math.floor(pl.invuln * 14) % 2 === 0 ? 0.45 : 1);
    pl.shadow.setPosition(pl.x, y0 + FLOOR + 2).setScale(S * (0.3 + (pl.y / FLOOR) * 0.4), S * 0.35);
    if (pl.hint) pl.hint.setPosition(pl.x + 60, y0 + pl.y - 30);
    if (pl.boost > 0 && Math.random() < 0.5) Vfx.speedLines(this, pl.x - 14, y0 + pl.y, 0, 0xffe066);
    else if (pl.vx > 220 && Math.random() < 0.15) Vfx.speedLines(this, pl.x - 14, y0 + pl.y, 0, 0xffffff);
    const camX = Math.max(this.split.viewW / 2, pl.x + this.split.viewW * 0.22);
    this.split.look(pl.p, camX, y0 + this.split.viewH / 2);
    const left = camX - this.split.viewW / 2;
    pl.sky.x = left;
    for (const l of pl.layers) {
      l.ts.x = left;
      l.ts.tilePositionX = (left * l.f) / S;
    }
    for (const s of pl.streaks) {
      if (Math.abs(s.ob.x - pl.x) > this.split.viewW) continue;
      const k = (this.t * 1.4 + s.ph) % 1;
      s.img.setY(y0 + FLOOR - 16 - k * (FLOOR - CEIL - 40)).setAlpha(0.55 * Math.sin(k * Math.PI));
    }
    for (const g of pl.ghosts) {
      const o = this.planes.find((x) => x.p === g.q);
      if (!o) continue;
      g.img.setPosition(o.x, y0 + o.y).setRotation(o.img.rotation);
      g.mark.setPosition(o.x, y0 + o.y - 16);
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(pl: Plane, dt: number): void {
    pl.cpuT -= dt;
    // find what's ahead
    let target = 130;
    const look = 120 + pl.vx * 0.9;
    for (const o of this.obs) {
      if (o.x + 30 < pl.x || o.x - pl.x > look) continue;
      if (o.kind === 'wall') { target = o.gy; break; }
      if (o.kind === 'fan') { target = Math.min(FLOOR - 30, o.gy + 52); break; }
      if (o.kind === 'star' && o.x - pl.x < 140 && pl.skill > 0.6) { target = o.gy; break; }
    }
    if (Math.random() < 0.02) pl.aimErr = (Math.random() - 0.5) * (1 - pl.skill) * 70;
    target += pl.aimErr;
    const predY = pl.y + pl.vy * 0.22 + 0.5 * GRAV * 0.22 * 0.22;
    if (pl.cpuT <= 0 && predY > target + 6 - pl.skill * 4) {
      pl.cpuT = 0.16 + (1 - pl.skill) * 0.2 + Math.random() * 0.12;
      this.flap(pl);
    }
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => Math.round(this.planes.find((x) => x.p === p)?.x ?? 0);
    return rankBy(this.players, value).map((r) => ({ ...r, score: this.meters(this.planes.find((x) => x.p === r.player)!) }));
  }
}

import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
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

const LENGTH = 3600;
const START_X = 60;
const GROUND = 150;
const GRAV = 1500;
const JUMP_V = 480;
const MAX_V = 330;
const TAP_V = 34;

type ObKind = 'hurdle' | 'puddle' | 'boost';
interface Ob { kind: ObKind; x: number; w: number }

interface Runner {
  p: PlayerIndex;
  av: Avatar;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastSide: number;
  stun: number;
  boost: number;
  finished: number;
  ghosts: Phaser.GameObjects.Sprite[];
  ghostMarks: Phaser.GameObjects.Image[];
  hurdles: Phaser.GameObjects.Image[];
  knocked: Set<number>;
  layers: { ts: Phaser.GameObjects.TileSprite; f: number }[];
  sky: Phaser.GameObjects.Image;
  btnL?: TouchButton;
  btnR?: TouchButton;
  btnJ?: TouchButton;
  cpuT: number;
  cpuSkill: number;
  wasPuddle: boolean;
}

/** #1 — Alternate L/R to sprint, jump hurdles, hit boost pads. Split screen per player. */
export class ClassroomDash extends BaseMinigame {
  private split!: SplitKit;
  private runners: Runner[] = [];
  private obs: Ob[] = [];
  private finishOrder: PlayerIndex[] = [];
  private bars: Phaser.GameObjects.Image[][] = [];
  private firstFinishAt = -1;

  constructor() {
    super(CATALOG['classroom-dash']);
  }

  setup(): void {
    this.runners = [];
    this.finishOrder = [];
    this.firstFinishAt = -1;
    this.split = new SplitKit(this);
    this.buildCourse();
    this.paintArt();
    for (const p of this.players) this.makeTrack(p);
    // Unused quadrants: show a resting view of track 0
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) if (!this.players.includes(p)) this.split.cams[p].setVisible(false);
    this.buildProgressBars();
  }

  private buildCourse(): void {
    const r = rng(1234);
    this.obs = [];
    let x = 420;
    while (x < LENGTH - 250) {
      const roll = r();
      if (roll < 0.55) this.obs.push({ kind: 'hurdle', x, w: 26 });
      else if (roll < 0.78) this.obs.push({ kind: 'puddle', x, w: 110 });
      else this.obs.push({ kind: 'boost', x, w: 60 });
      x += 230 + r() * 220;
    }
  }

  private paintArt(): void {
    const vw = Math.ceil(this.split.viewW / S);
    makeTexture(this, `dash-sky-${vw}`, vw, 100, (p) => p.gradient(0, 0, vw, 100, [0x6ec6ff, 0x9fdcff, 0xd9f3ff]));
    makeTexture(this, 'dash-clouds', 160, 50, (p) => {
      const r = rng(5);
      for (let i = 0; i < 3; i++) {
        const cx = 20 + i * 55 + r() * 10, cy = 14 + r() * 20;
        p.ball(cx, cy, 12, 6, 0xffffff, false); p.ball(cx + 10, cy - 3, 9, 6, 0xffffff, false); p.hline(cx - 10, cy + 5, 26, 0xdbe9f7);
      }
    });
    makeTexture(this, 'dash-far', 200, 70, (p) => {
      // far school building + trees
      p.box(20, 22, 110, 48, 0xf0c9a0);
      p.rect(16, 18, 118, 6, 0xc55a4a);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) p.rect(26 + i * 17, 30 + j * 18, 10, 11, 0x7ab4dc);
      p.rect(70, 4, 12, 18, 0xe8e0d0); p.circle(76, 10, 4, 0xffffff); p.vline(76, 7, 3, 0x2b3263);
      const r = rng(8);
      for (let i = 0; i < 6; i++) p.ball(140 + r() * 55, 40 + r() * 20, 10, 12, i % 2 ? 0x58b05a : 0x4a9a4e, false);
      p.rect(0, 66, 200, 4, 0x7cc46a);
    });
    makeTexture(this, 'dash-fence', 64, 40, (p) => {
      for (let x = 2; x < 64; x += 8) { p.rect(x, 8, 4, 30, 0xf4f4f4); p.tri(x, 8, x + 4, 8, x + 2, 4, 0xf4f4f4); p.vline(x + 3, 8, 30, 0xc9ccd6); }
      p.rect(0, 14, 64, 3, 0xe0e0e8); p.rect(0, 28, 64, 3, 0xe0e0e8);
      const r = rng(2);
      for (let i = 0; i < 10; i++) p.ball(r() * 64, 34 + r() * 4, 6, 5, i % 2 ? 0x6cbf5e : 0x5aa858, false);
    });
    makeTexture(this, 'dash-ground', 32, 20, (p) => {
      p.rect(0, 0, 32, 20, 0xd9604a);
      p.hline(0, 0, 32, 0xf07a62);
      p.hline(0, 1, 32, 0xffffff);
      p.hline(0, 10, 32, 0xffffff);
      p.hline(0, 19, 32, shift(0xd9604a, -0.4));
      const r = rng(3);
      for (let i = 0; i < 18; i++) p.px(Math.floor(r() * 32), 2 + Math.floor(r() * 17), r() > 0.5 ? 0xe5745e : 0xc44f3c);
    });
    makeTexture(this, 'dash-hurdle', 16, 18, (p) => {
      p.rect(1, 2, 2, 16, 0xd8dbe4); p.rect(13, 2, 2, 16, 0xd8dbe4);
      for (let x = 0; x < 16; x += 4) p.rect(x, 0, 4, 5, (x / 4) % 2 ? 0xffffff : 0xff5a6e);
      p.outline(-0.7);
    });
    makeTexture(this, 'dash-puddle', 56, 6, (p) => {
      p.ellipse(28, 3, 28, 3, 0x4aa8e0);
      p.ellipse(24, 2, 18, 1.5, 0x8fd6ff);
      p.hline(10, 3, 6, 0xffffff);
    });
    makeTexture(this, 'dash-boost', 30, 8, (p) => {
      p.box(0, 2, 30, 6, 0x3fe0e0);
      for (let i = 0; i < 3; i++) { p.tri(4 + i * 9, 3, 4 + i * 9, 7, 9 + i * 9, 5, 0xffffff); }
    });
    makeTexture(this, 'dash-finish', 24, 100, (p) => {
      p.rect(0, 0, 3, 100, 0xd8dbe4); p.rect(21, 0, 3, 100, 0xd8dbe4);
      p.rect(0, 0, 24, 14, 0xffffff);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 6; x++) if ((x + y) % 2) p.rect(x * 4, 2 + y * 5, 4, 5, 0x1b1f3b);
      for (let y = 90; y < 100; y += 2) for (let x = 0; x < 24; x += 2) if (((x + y) / 2) % 2) p.rect(x, y, 2, 2, 0x1b1f3b);
      p.outline(-0.7);
    });
    makeTexture(this, 'dash-flower', 6, 6, (p) => { p.px(2, 0, 0xffe066); p.px(1, 1, 0xffffff); p.px(3, 1, 0xffffff); p.px(2, 2, 0xffe066); p.vline(2, 3, 3, 0x4a9a4e); });
  }

  private makeTrack(p: PlayerIndex): void {
    const y0 = this.split.offsetY(p);
    const vw = this.split.viewW;
    const sky = this.add.image(0, y0, `dash-sky-${Math.ceil(vw / S)}`).setOrigin(0).setScale(S).setDepth(-100);
    const layers = [
      { ts: this.add.tileSprite(0, y0 - 4, vw / S, 50, 'dash-clouds').setOrigin(0).setScale(S).setDepth(-95), f: 0.08 },
      { ts: this.add.tileSprite(0, y0 + 12, vw / S, 70, 'dash-far').setOrigin(0).setScale(S).setDepth(-90), f: 0.25 },
      { ts: this.add.tileSprite(0, y0 + 76, vw / S, 40, 'dash-fence').setOrigin(0).setScale(S).setDepth(-85), f: 0.6 },
    ];
    // ground for the whole course
    this.add.tileSprite(-200, y0 + GROUND - 6, (LENGTH + 800) / S, 20, 'dash-ground').setOrigin(0).setScale(S).setDepth(-80);
    this.add.rectangle(-200, y0 + GROUND + 34, LENGTH + 800, 120, 0x7cc46a).setOrigin(0).setDepth(-81);
    const hurdles: Phaser.GameObjects.Image[] = [];
    this.obs.forEach((o, i) => {
      if (o.kind === 'hurdle') hurdles[i] = this.add.image(o.x, y0 + GROUND + 2, 'dash-hurdle').setOrigin(0.5, 1).setScale(S).setDepth(y0 + GROUND + 1);
      else if (o.kind === 'puddle') this.add.image(o.x + o.w / 2, y0 + GROUND + 4, 'dash-puddle').setScale(S).setDepth(-70);
      else {
        const b = this.add.image(o.x + o.w / 2, y0 + GROUND + 4, 'dash-boost').setScale(S).setDepth(-70);
        this.tweens.add({ targets: b, alpha: 0.6, yoyo: true, repeat: -1, duration: 300 });
      }
    });
    this.add.image(LENGTH, y0 + GROUND + 8, 'dash-finish').setOrigin(0.5, 1).setScale(S).setDepth(-60);
    const fl = rng(77 + p);
    for (let x = 0; x < LENGTH + 400; x += 40 + fl() * 60) this.add.image(x, y0 + GROUND + 30 + fl() * 6, 'dash-flower').setScale(S).setDepth(y0 + 500);
    // Start line
    this.add.rectangle(START_X + 20, y0 + GROUND + 2, 4, 36, 0xffffff).setDepth(-69);

    const av = new Avatar(this, p, START_X, y0 + GROUND, { depthSort: false });
    av.sprite.setDepth(y0 + GROUND + 10);
    av.shadow?.setDepth(y0 + GROUND + 9);
    av.marker?.setDepth(y0 + GROUND + 11).setAngle(0);
    const ghosts: Phaser.GameObjects.Sprite[] = [];
    const ghostMarks: Phaser.GameObjects.Image[] = [];
    for (const q of this.players) {
      if (q === p) continue;
      const g = this.add.sprite(START_X, y0 + GROUND - 2, av.key, 0).setOrigin(0.5, 1).setScale(S).setAlpha(0.32).setDepth(y0 + GROUND + 5).setData('q', q);
      ghosts.push(g);
      ghostMarks.push(this.add.image(START_X, y0 + GROUND - 70, playerMarkerKey(this, q)).setScale(S * 0.7).setAlpha(0.5).setDepth(y0 + GROUND + 6).setData('q', q));
    }
    const r: Runner = {
      p, av, x: START_X, y: 0, vx: 0, vy: 0, lastSide: 0, stun: 0, boost: 0, finished: -1, ghosts, ghostMarks,
      hurdles, knocked: new Set(), layers, sky, cpuT: 0, cpuSkill: 0, wasPuddle: false,
    };
    if (!this.isCpu(p)) {
      r.btnL = new TouchButton(this, this.touch, p, 0.13, 0.8, 'left', 16);
      r.btnR = new TouchButton(this, this.touch, p, 0.33, 0.8, 'right', 16);
      r.btnJ = new TouchButton(this, this.touch, p, 0.85, 0.78, 'jump', 18);
      r.btnL.onPress = () => this.step(r, -1);
      r.btnR.onPress = () => this.step(r, 1);
      r.btnJ.onPress = () => this.jump(r);
    }
    // ghosts of other runners' avatars need their own textures
    ghosts.forEach((g) => {
      const q = g.getData('q') as PlayerIndex;
      const other = this.runners.find((o) => o.p === q);
      if (other) g.setTexture(other.av.key, 0);
    });
    this.runners.push(r);
    // fix ghost textures for earlier runners referencing this one
    for (const o of this.runners) for (const g of o.ghosts) if (g.getData('q') === p) g.setTexture(av.key, 0);
    this.split.look(p, START_X + this.split.viewW * 0.25, y0 + this.split.viewH / 2);
  }

  private buildProgressBars(): void {
    this.bars = [];
    for (const [deg, y] of [[0, this.vh / 2 + 9], [180, this.vh / 2 - 9]] as const) {
      const x0 = 60, x1 = this.vw - 60;
      const line = this.add.rectangle(this.vw / 2, y, x1 - x0, 4, 0x1b1f3b, 0.8).setDepth(940);
      const flag = txt(this, deg === 0 ? x1 + 10 : x0 - 10, y, '🏁', { size: 12, strokeWidth: 0 }).setDepth(941).setAngle(deg);
      const marks = this.players.map((p) => this.add.image(x0, y, playerMarkerKey(this, p)).setScale(S * 0.7).setDepth(942).setAngle(deg));
      this.bars.push(marks);
      void line; void flag;
    }
  }

  private step(r: Runner, side: number): void {
    if (this.state !== 'play' || r.finished >= 0 || r.stun > 0) return;
    if (r.lastSide === side) {
      // Same foot twice: stumble a little.
      r.vx *= 0.82;
      Vfx.squash(this, r.av.sprite, 1.1, 0.9, 120);
    } else {
      r.vx = Math.min(MAX_V + (r.boost > 0 ? 90 : 0), r.vx + TAP_V);
      if (r.y === 0 && Math.random() < 0.3) Vfx.dust(this, r.x - 10, this.split.offsetY(r.p) + GROUND, -1);
    }
    r.lastSide = side;
  }

  private jump(r: Runner): void {
    if (this.state !== 'play' || r.finished >= 0 || r.y > 0 || r.stun > 0) return;
    r.vy = JUMP_V;
    r.y = 0.01;
    Audio.sfx('jump', 1 + r.p * 0.08);
    Vfx.squash(this, r.av.sprite, 0.75, 1.3, 180);
    Vfx.dust(this, r.x, this.split.offsetY(r.p) + GROUND);
  }

  ambient(dt: number): void {
    for (const r of this.runners) this.syncRunner(r, dt);
  }

  tick(dt: number): void {
    for (const r of this.runners) {
      if (this.isCpu(r.p)) this.bot(r, dt);
      this.physics_(r, dt);
    }
    // ranking text in HUD
    const order = [...this.runners].sort((a, b) => (a.finished >= 0 ? -1e6 + a.finished : 0) - (b.finished >= 0 ? -1e6 + b.finished : 0) || b.x - a.x);
    order.forEach((r, i) => (this.hudText[r.p] = r.finished >= 0 ? `🏁 ${['1st', '2nd', '3rd', '4th'][this.finishOrder.indexOf(r.p)]}` : ['1st', '2nd', '3rd', '4th'][i]));
    const allDone = this.runners.every((r) => r.finished >= 0);
    if (allDone || (this.firstFinishAt >= 0 && this.elapsed - this.firstFinishAt > 12) || this.elapsed > 75) this.finish();
  }

  private physics_(r: Runner, dt: number): void {
    const y0 = this.split.offsetY(r.p);
    r.stun = Math.max(0, r.stun - dt);
    r.boost = Math.max(0, r.boost - dt);
    if (r.finished >= 0) {
      r.vx = Math.max(0, r.vx - 300 * dt);
    } else {
      // Drag ∝ speed: faster tapping = faster running (≈34 px/s per tap/s).
      r.vx = Math.max(0, r.vx - r.vx * (r.boost > 0 ? 0.35 : 1.0) * dt - 10 * dt);
    }
    // jump arc
    if (r.y > 0) {
      r.vy -= GRAV * dt;
      r.y += r.vy * dt;
      if (r.y <= 0) {
        r.y = 0;
        r.vy = 0;
        Audio.sfx('land');
        Vfx.squash(this, r.av.sprite, 1.3, 0.75, 160);
        Vfx.dust(this, r.x, y0 + GROUND);
      }
    }
    const prevX = r.x;
    r.x += r.vx * dt;
    // obstacles
    let inPuddle = false;
    this.obs.forEach((o, i) => {
      if (o.kind === 'hurdle') {
        if (r.knocked.has(i)) return;
        if (r.x + 10 > o.x - o.w / 2 && prevX - 10 < o.x + o.w / 2 && r.y < 26) {
          r.knocked.add(i);
          r.vx = 30;
          r.stun = 0.55;
          Audio.sfx('hit', 1 + r.p * 0.1);
          Vfx.hit(this, o.x, y0 + GROUND - 20);
          Vfx.shake(this, 0.004, 120);
          const h = r.hurdles[i];
          if (h) this.tweens.add({ targets: h, angle: 80, x: h.x + 14, y: h.y + 2, duration: 220, ease: 'Quad.easeOut' });
        }
      } else if (r.x > o.x && r.x < o.x + o.w && r.y === 0) {
        if (o.kind === 'puddle') {
          inPuddle = true;
          r.vx = Math.min(r.vx, 120);
          if (Math.random() < 0.3) burst(this, r.x, y0 + GROUND, { tex: 'dot2', count: 3, tint: [0x8fd6ff, 0xffffff], speed: [40, 90], angle: [200, 340], gravity: 400, life: 400 });
        } else if (r.boost <= 0) {
          r.boost = 0.9;
          r.vx = Math.max(r.vx, MAX_V + 60);
          Audio.sfx('power', 1 + r.p * 0.08);
          Vfx.speedLines(this, r.x - 20, y0 + GROUND - 30, 0, 0x3fe0e0);
        }
      }
    });
    if (inPuddle && !r.wasPuddle) Audio.sfx('splash');
    r.wasPuddle = inPuddle;
    if (r.boost > 0 && Math.random() < 0.4) Vfx.speedLines(this, r.x - 30, y0 + GROUND - 20 - Math.random() * 30, 0, 0xffffff);
    if (r.finished < 0 && r.x >= LENGTH) {
      r.finished = this.elapsed;
      this.finishOrder.push(r.p);
      if (this.firstFinishAt < 0) this.firstFinishAt = this.elapsed;
      const place = this.finishOrder.length;
      Audio.sfx(place === 1 ? 'power' : 'coin');
      Vfx.confetti(this, r.x, y0 + 60, 40);
      Vfx.popText(this, r.x, y0 + 80, ['ที่ 1!', 'ที่ 2!', 'ที่ 3!', 'ที่ 4!'][place - 1], toCss(PLAYER_COLORS[r.p].light), 22, 0);
      this.score[r.p] = 5 - place;
    }
  }

  private syncRunner(r: Runner, _dt: number): void {
    const y0 = this.split.offsetY(r.p);
    const av = r.av;
    av.setPos(r.x, y0 + GROUND, r.y);
    av.marker?.setAngle(0);
    if (r.finished >= 0 && r.vx < 20) av.play('win');
    else if (r.stun > 0) av.play('hit');
    else if (r.y > 0) av.play(r.vy > 0 ? 'jump' : 'fall');
    else if (r.vx > 15) av.play('run');
    else av.play('idle');
    av.sprite.anims.timeScale = av.anim === 'run' ? 0.5 + r.vx / 200 : 1;
    // camera + parallax
    const camX = Math.max(this.split.viewW / 2, r.x + this.split.viewW * 0.18);
    this.split.look(r.p, camX, y0 + this.split.viewH / 2);
    const left = camX - this.split.viewW / 2;
    r.sky.x = left;
    for (const l of r.layers) {
      l.ts.x = left;
      l.ts.tilePositionX = (left * l.f) / S;
    }
    // ghosts of rivals in this lane
    r.ghosts.forEach((g, i) => {
      const q = g.getData('q') as PlayerIndex;
      const o = this.runners.find((x) => x.p === q);
      if (!o) return;
      g.setPosition(o.x, y0 + GROUND - 2 - o.y);
      g.setFrame(o.av.sprite.frame.name);
      g.setFlipX(false);
      r.ghostMarks[i].setPosition(o.x, y0 + GROUND - 72 - o.y);
    });
    // progress bars
    const k = this.players.indexOf(r.p);
    const prog = Phaser.Math.Clamp((r.x - START_X) / (LENGTH - START_X), 0, 1);
    const x0 = 60, x1 = this.vw - 60;
    if (this.bars[0]?.[k]) this.bars[0][k].x = x0 + (x1 - x0) * prog;
    if (this.bars[1]?.[k]) this.bars[1][k].x = x1 - (x1 - x0) * prog;
  }

  private bot(r: Runner, dt: number): void {
    if (r.finished >= 0 || r.stun > 0) return;
    r.cpuT -= dt;
    const rate = (r.cpuSkill ||= 6.2 + Math.random() * 1.6) + Math.sin(this.elapsed * 0.7 + r.p) * 0.7;
    if (r.cpuT <= 0) {
      r.cpuT = 1 / rate;
      this.step(r, r.lastSide === 1 ? -1 : 1);
    }
    const next = this.obs.find((o, i) => o.kind === 'hurdle' && !r.knocked.has(i) && o.x > r.x);
    if (next && r.y === 0) {
      const lead = 40 + r.vx * 0.22;
      const d = next.x - r.x;
      if (d < lead && d > lead - 30 && Math.random() > 0.06) this.jump(r);
    }
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => {
      const i = this.finishOrder.indexOf(p);
      if (i >= 0) return 100000 - i;
      return this.runners.find((r) => r.p === p)?.x ?? 0;
    };
    return rankBy(this.players, value).map((r) => {
      const run = this.runners.find((x) => x.p === r.player)!;
      return { ...r, score: run.finished >= 0 ? Math.round(run.finished * 10) / 10 : Math.round(run.x) };
    });
  }
}



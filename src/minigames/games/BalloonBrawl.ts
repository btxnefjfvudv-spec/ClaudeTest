import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'balloon-brawl';
const N_BALLOONS = 3;
const ROPE_DOTS = 7;
const PIN_LEN = 22;
const POP_R = 12;
const FLOAT_H = 40;

interface Balloon {
  x: number; y: number; vx: number; vy: number; len: number; alive: boolean;
  img: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image; dots: Phaser.GameObjects.Image[]; bob: number;
}

interface Brawler {
  b: ArenaBody;
  balloons: Balloon[];
  pops: number;
  pin: Phaser.GameObjects.Image;
  pinDir: number;
  pinLive: number;
  out: boolean;
  outOrder: number;
  /** Brief protection after losing a balloon. */
  shield: number;
  // CPU
  skill: number; think: number; tx: number; ty: number; strafe: number; aggro: boolean;
}

function say(scene: Phaser.Scene, x: number, y: number, s: string, color: string, size: number, angle: number): void {
  const t = txt(scene, x, y, s, { size, color, strokeWidth: 4 }).setDepth(4500).setAngle(angle).setScale(0.4);
  const up = angle === 180 ? 26 : -26;
  scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: t, y: y + up, alpha: 0, delay: 420, duration: 420, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
}

/** #14 — Three balloons on springy strings trail behind you. Dash with your pin to pop the others'. */
export default class BalloonBrawl extends BaseMinigame {
  private kit!: ArenaKit;
  private brawlers: Brawler[] = [];
  private bounds!: Phaser.Geom.Rectangle;
  private ambientFx: ((dt: number) => void)[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.brawlers = [];
    this.ambientFx = [];
    const W = this.vw, H = this.vh;
    this.bounds = new Phaser.Geom.Rectangle(36, 46, W - 72, H - 92);
    this.paintArt();
    this.paintBackground();
    this.buildAmbient();
    const cx = W / 2, cy = H / 2;
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 900, radius: 12, dashSpeed: 430, dashCooldown: 0.95, bounce: 0.8, bounds: this.bounds,
      spawn: (p) => ({ x: cx + (p % 2 === 0 ? -1 : 1) * W * 0.27, y: cy + (p < 2 ? -1 : 1) * H * 0.22 }),
    });
    this.kit.dashHit = 1.05;
    for (const b of this.kit.bodies) {
      const p = b.p;
      const away = Math.atan2(b.y - cy, b.x - cx);
      const balloons: Balloon[] = [];
      for (let i = 0; i < N_BALLOONS; i++) {
        const len = 40 + (i === 1 ? 10 : 0);
        const a = away + (i - 1) * 0.5;
        balloons.push({
          x: b.x + Math.cos(a) * len * 0.8, y: b.y + Math.sin(a) * len * 0.8, vx: 0, vy: 0, len, alive: true,
          img: this.add.image(0, 0, `${ID}-balloon-${p}`).setScale(S),
          shadow: this.add.image(0, 0, 'shadow').setScale(S * 0.4).setAlpha(0.18).setDepth(-1500),
          dots: Array.from({ length: ROPE_DOTS }, () => this.add.image(0, 0, 'px').setScale(S).setTint(0xfff8e7)),
          bob: Math.random() * 6,
        });
      }
      const pin = this.add.image(b.x, b.y, `${ID}-pin-${p}`).setScale(S).setOrigin(0.15, 0.5);
      this.brawlers.push({
        b, balloons, pops: 0, pin, pinDir: -away, pinLive: 0, out: false, outOrder: -1, shield: 0,
        skill: 0.5 + Math.random() * 0.45, think: Math.random() * 0.5, tx: b.x, ty: b.y, strafe: Math.random() < 0.5 ? 1 : -1, aggro: Math.random() < 0.6,
      });
    }
    this.kit.onDash = (b) => {
      const br = this.brawler(b.p);
      if (!br) return;
      br.pinLive = 0.34;
      br.pinDir = Math.atan2(b.vy, b.vx);
    };
    this.refreshHud();
  }

  private brawler(p: PlayerIndex): Brawler | undefined {
    return this.brawlers.find((x) => x.b.p === p);
  }

  private left(br: Brawler): number {
    return br.balloons.filter((x) => x.alive).length;
  }

  private refreshHud(): void {
    for (const br of this.brawlers) this.hudText[br.b.p] = br.out ? `OUT ${br.pops}` : `${'●'.repeat(this.left(br))} ${br.pops}`;
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[p];
      makeTexture(this, `${ID}-balloon-${p}`, 14, 18, (g) => {
        g.ball(7, 7, 6.5, 7, c.main);
        g.px(4, 3, 0xffffff); g.px(4, 4, 0xffffff); g.px(5, 3, 0xffffff);
        g.tri(5.5, 14, 8.5, 14, 7, 12.5, shift(c.main, -0.3));
        g.px(7, 15, 0xfff8e7); g.px(7, 16, 0xfff8e7); g.px(6, 17, 0xfff8e7);
        g.outline(-0.75);
      });
      makeTexture(this, `${ID}-pin-${p}`, 14, 5, (g) => {
        g.hline(3, 2, 11, 0xd8dbe4);
        g.hline(3, 1, 9, 0xf4f6fa);
        g.px(13, 2, 0xffffff);
        g.ball(2, 2, 2.2, 2.2, c.main);
        g.outline(-0.7);
      });
      makeTexture(this, `${ID}-shred-${p}`, 3, 3, (g) => { g.px(0, 0, c.main); g.px(1, 1, c.main); g.px(2, 1, shift(c.main, -0.3)); g.px(1, 2, c.light); });
    }
    makeTexture(this, `${ID}-flag`, 7, 8, (g) => {
      g.tri(0, 0, 7, 0, 3.5, 8, 0xffffff);
      g.hline(0, 0, 7, 0xdddddd);
    });
    makeTexture(this, `${ID}-bulb`, 3, 3, (g) => { g.rect(0, 0, 3, 3, 0xffffff); g.px(0, 0, 0xdddddd); });
    makeTexture(this, `${ID}-cart`, 30, 28, (g) => {
      // popcorn cart
      g.box(3, 14, 24, 10, 0xff5a6e);
      for (let x = 4; x < 26; x += 4) g.rect(x, 15, 2, 8, 0xfff8e7);
      g.rect(5, 6, 20, 8, 0xbfeaff, 200);
      g.hline(5, 6, 20, 0xffffff);
      for (let i = 0; i < 14; i++) g.px(6 + ((i * 7) % 18), 9 + (i % 4), i % 2 ? 0xffe066 : 0xfff8e7);
      g.tri(2, 6, 28, 6, 15, 0, 0xffc93d);
      g.circle(7, 25, 3, 0x3a3f6b); g.circle(23, 25, 3, 0x3a3f6b);
      g.outline(-0.75);
    });
    makeTexture(this, `${ID}-candy`, 22, 30, (g) => {
      // cotton candy stand
      g.box(2, 18, 18, 10, 0x6ec6ff);
      g.hline(2, 20, 18, 0xffffff);
      g.vline(10, 6, 12, 0xfff8e7);
      g.ball(10, 7, 7, 6, 0xffb3d9, false);
      g.ball(8, 5, 3, 2, 0xffd6ec, false);
      g.vline(16, 10, 8, 0xfff8e7);
      g.ball(16, 9, 4, 3.5, 0xb8a6ff, false);
      g.outline(-0.75);
    });
  }

  private paintBackground(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const key = makeTexture(this, `${ID}-bg-${aw}`, aw, ah, (p) => {
      const r = rng(1414);
      p.rect(0, 0, aw, ah, 0x6cc25a);
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) if (((x >> 3) + (y >> 3)) % 2 === 0) p.px(x, y, 0x66ba55);
      for (let i = 0; i < aw * ah * 0.05; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), r() < 0.5 ? 0x78cf64 : 0x5aa84b);
      // round dance floor of planks in the middle
      const cx = aw / 2, cy = ah / 2, R = Math.min(aw, ah) * 0.36;
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const d = Math.hypot((x + 0.5 - cx) / 1.25, y + 0.5 - cy);
        if (d < R + 3 && d >= R) p.px(x, y, 0x8a5a34);
        else if (d < R) {
          const plank = Math.floor((y + 0.5) / 6);
          let c = plank % 2 ? 0xd9a066 : 0xcf955c;
          if ((y + 1) % 6 === 0) c = 0xb07a48;
          if (((x + plank * 11) % 37) === 0) c = 0xb07a48;
          p.px(x, y, c);
        }
      }
      p.ring(cx, cy, 10, 0xffe066, 1);
      // a big star in the centre
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2, a2 = a + Math.PI / 5, a0 = a - Math.PI / 5;
        p.tri(cx, cy, cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, cx + Math.cos(a2) * 4, cy + Math.sin(a2) * 4, 0xffe066);
        p.tri(cx, cy, cx + Math.cos(a) * 9, cy + Math.sin(a) * 9, cx + Math.cos(a0) * 4, cy + Math.sin(a0) * 4, 0xffe066);
      }
      // picnic blankets in the four corners (player colours)
      const blankets: [number, number, number][] = [[22, 26, 0], [aw - 50, 26, 1], [22, ah - 50, 2], [aw - 50, ah - 50, 3]];
      for (const [bx, by, q] of blankets) {
        const c = PLAYER_COLORS[q].main;
        for (let y = 0; y < 24; y++) for (let x = 0; x < 28; x++) {
          const chk = ((x >> 2) + (y >> 2)) % 2;
          p.px(bx + x, by + y, chk ? 0xfff8e7 : shift(c, 0.25));
        }
        p.hline(bx, by + 24, 28, shift(c, -0.4));
      }
      // flower borders
      for (let i = 0; i < 90; i++) {
        const top = i % 2 === 0;
        const x = Math.floor(r() * aw), y = top ? 2 + Math.floor(r() * 12) : ah - 3 - Math.floor(r() * 12);
        p.px(x, y, [0xffffff, 0xffb3bd, 0xffe066, 0xb8a6ff][i % 4]);
        p.px(x, y + 1, 0x3f8a3a);
      }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-3000);
    // stands at the sides
    this.add.image(18, this.vh * 0.5, `${ID}-cart`).setScale(S).setDepth(-2000).setOrigin(0.3, 0.5);
    this.add.image(this.vw - 16, this.vh * 0.5, `${ID}-candy`).setScale(S).setDepth(-2000).setOrigin(0.7, 0.5);
  }

  private buildAmbient(): void {
    const W = this.vw, H = this.vh;
    const cols = [0xff5a6e, 0x3d9bff, 0x3ed17a, 0xffc93d, 0xb8a6ff, 0xff9f43];
    // bunting garlands along the top and bottom edges
    for (const [y, deg] of [[8, 0], [H - 8, 180]] as const) {
      const n = Math.floor(W / 22);
      for (let i = 0; i <= n; i++) {
        const x = 8 + i * ((W - 16) / n);
        const sag = Math.sin((i / n) * Math.PI * 4) * 3;
        const f = this.add.image(x, y + (deg === 0 ? sag : -sag), `${ID}-flag`).setScale(S).setOrigin(0.5, 0).setAngle(deg).setTint(cols[i % cols.length]).setDepth(920);
        this.tweens.add({ targets: f, angle: deg + 10, yoyo: true, repeat: -1, duration: 600 + (i % 5) * 120, ease: 'Sine.easeInOut', delay: i * 40 });
      }
    }
    // fairy lights down the sides
    const bulbs: Phaser.GameObjects.Image[] = [];
    for (const x of [6, W - 6]) {
      for (let y = 40; y < H - 40; y += 18) bulbs.push(this.add.image(x, y + Math.sin(y * 0.1) * 2, `${ID}-bulb`).setScale(S).setDepth(920));
    }
    let t = 0;
    this.ambientFx.push((dt) => {
      t += dt;
      bulbs.forEach((b, i) => {
        const on = (Math.floor(t * 3) + i) % 3 !== 0;
        b.setTint(on ? cols[i % cols.length] : 0x4a4a5c);
      });
    });
    // drifting confetti in the air
    const conf = this.add.particles(0, 0, 'confetti', {
      x: { min: 0, max: W }, y: -6, lifespan: 7000, speedY: { min: 14, max: 30 }, speedX: { min: -12, max: 12 },
      rotate: { min: 0, max: 360 }, scale: S, tint: cols, frequency: 260, alpha: { start: 0.9, end: 0.5 },
    });
    conf.setDepth(910);
    conf.fastForward(7000);
  }

  // ─────────────────────────── BALLOONS ───────────────────────────

  private simBalloons(br: Brawler, dt: number): void {
    const b = br.b;
    const sp = Math.hypot(b.vx, b.vy);
    const back = sp > 20 ? Math.atan2(-b.vy, -b.vx) : Math.atan2(br.balloons[0].y - b.y, br.balloons[0].x - b.x);
    const drag = Math.exp(-2.4 * dt);
    br.balloons.forEach((bl, i) => {
      if (!bl.alive) return;
      bl.bob += dt;
      // float gently behind the owner, fanning out
      const a = back + (i - 1) * 0.8;
      const hx = b.x + Math.cos(a) * bl.len * 0.85, hy = b.y + Math.sin(a) * bl.len * 0.85;
      bl.vx += (hx - bl.x) * 3.2 * dt + Math.sin(bl.bob * 1.7 + i) * 14 * dt;
      bl.vy += (hy - bl.y) * 3.2 * dt + Math.cos(bl.bob * 1.3 + i * 2) * 14 * dt;
      // repel siblings
      for (const o of br.balloons) {
        if (o === bl || !o.alive) continue;
        const dx = bl.x - o.x, dy = bl.y - o.y, d = Math.hypot(dx, dy);
        if (d > 0 && d < 24) { bl.vx += (dx / d) * (24 - d) * 24 * dt; bl.vy += (dy / d) * (24 - d) * 24 * dt; }
      }
      bl.vx *= drag; bl.vy *= drag;
      bl.x += bl.vx * dt; bl.y += bl.vy * dt;
      // springy rope: can't drift further than its length
      const dx = bl.x - b.x, dy = bl.y - b.y, d = Math.hypot(dx, dy);
      if (d > bl.len) {
        const nx = dx / d, ny = dy / d;
        bl.x = b.x + nx * bl.len; bl.y = b.y + ny * bl.len;
        const vn = bl.vx * nx + bl.vy * ny;
        if (vn > 0) { bl.vx -= nx * vn * 1.35; bl.vy -= ny * vn * 1.35; }
        // the rope tugs the balloon along with the owner
        bl.vx += b.vx * 0.06; bl.vy += b.vy * 0.06;
      }
    });
  }

  private drawBalloons(br: Brawler): void {
    const b = br.b;
    const hx = b.x + b.avatar.facing * 6, hy = b.y - 26;
    br.balloons.forEach((bl) => {
      if (!bl.alive) return;
      const h = FLOAT_H + Math.sin(bl.bob * 2.2) * 3;
      const top = bl.y - h;
      bl.img.setPosition(bl.x, top).setDepth(bl.y + 60).setAngle(Phaser.Math.Clamp((bl.x - b.x) * 0.4, -20, 20));
      bl.shadow.setPosition(bl.x, bl.y + 2);
      // string from the hand to the knot, with a little sag
      const kx = bl.x, ky = top + 16;
      bl.dots.forEach((dot, k) => {
        const f = (k + 1) / (ROPE_DOTS + 1);
        const sag = Math.sin(f * Math.PI) * 6;
        dot.setPosition(Phaser.Math.Linear(hx, kx, f), Phaser.Math.Linear(hy, ky, f) + sag).setDepth(bl.y + 59);
      });
    });
    // pin in hand, pointing where we're heading
    if (!br.out) {
      const sp = Math.hypot(b.vx, b.vy);
      const want = br.pinLive > 0 ? br.pinDir : sp > 20 ? Math.atan2(b.vy, b.vx) : br.pinDir;
      if (br.pinLive <= 0) br.pinDir = Phaser.Math.Angle.RotateTo(br.pinDir, want, 0.3);
      const ext = br.pinLive > 0 ? 12 : 4;
      br.pin.setPosition(b.x + Math.cos(br.pinDir) * ext, b.y - 18 + Math.sin(br.pinDir) * ext * 0.8)
        .setRotation(br.pinDir).setDepth(b.y + (Math.sin(br.pinDir) < -0.3 ? -1 : 2)).setScale(br.pinLive > 0 ? S * 1.15 : S);
    }
  }

  private checkPins(br: Brawler): void {
    const b = br.b;
    if (br.pinLive <= 0 || br.out) return;
    const dx = Math.cos(br.pinDir), dy = Math.sin(br.pinDir);
    for (const o of this.brawlers) {
      if (o === br || o.out || o.shield > 0) continue;
      for (const bl of o.balloons) {
        if (!bl.alive) continue;
        // test along the pin from the body to its tip
        for (let k = 0; k <= 2; k++) {
          const f = 0.6 + (k / 2) * 0.4;
          const px = b.x + dx * PIN_LEN * f * 1.4, py = b.y + dy * PIN_LEN * f * 1.4;
          if (Math.hypot(px - bl.x, py - bl.y) < POP_R) { this.pop(br, o, bl); break; }
        }
      }
    }
  }

  private pop(by: Brawler, owner: Brawler, bl: Balloon): void {
    bl.alive = false;
    by.pops++;
    this.addScore(by.b.p, 1);
    const x = bl.x, y = bl.y - FLOAT_H;
    bl.img.setVisible(false);
    bl.shadow.setVisible(false);
    for (const d of bl.dots) this.tweens.add({ targets: d, y: d.y + 18 + Math.random() * 10, alpha: 0, duration: 500, ease: 'Quad.easeIn' });
    Audio.sfx('pop', 1 + owner.b.p * 0.1);
    Audio.sfx('hit', 1.5);
    burst(this, x, y, { tex: `${ID}-shred-${owner.b.p}`, count: 14, speed: [80, 200], life: 500, gravity: 300, scale: [S, S * 0.6], depth: 4000, rotate: true, alpha: [1, 0.8] });
    const ring = this.add.image(x, y, 'ring').setScale(0.4).setDepth(4000).setTint(PLAYER_COLORS[owner.b.p].light);
    this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 260, onComplete: () => ring.destroy() });
    Vfx.sparkle(this, x, y, [0xffffff, PLAYER_COLORS[owner.b.p].light]);
    say(this, x, y - 18, 'POP!', toCss(PLAYER_COLORS[by.b.p].light), 20, this.angleFor(by.b.p));
    Vfx.squash(this, owner.b.avatar.sprite, 1.2, 0.8, 150);
    const n = this.left(owner);
    owner.shield = 2;
    if (n === 0) this.knockOut(owner);
    else say(this, owner.b.x, owner.b.y - 84, `เหลือ ${n}`, toCss(PLAYER_COLORS[owner.b.p].light), 14, this.angleFor(owner.b.p));
    this.refreshHud();
  }

  private knockOut(br: Brawler): void {
    br.out = true;
    br.outOrder = this.eliminated.length;
    const b = br.b;
    this.kit.kill(b);
    br.pin.setVisible(false);
    b.avatar.play('lose', true);
    b.avatar.marker?.setAlpha(0.5);
    this.tweens.add({ targets: [b.avatar.sprite, b.avatar.ring!].filter(Boolean), alpha: 0.35, duration: 500 });
    burst(this, b.x, b.y - 20, { tex: 'puff', count: 10, tint: [0xffffff, 0xe8e8f0], speed: [30, 90], life: 600, depth: 4000 });
    say(this, b.x, b.y - 96, 'หมดแล้ว!', '#ff7a85', 18, this.angleFor(b.p));
    this.eliminate(b.p);
  }

  // ─────────────────────────── LOOP ───────────────────────────

  ambient(dt: number): void {
    for (const f of this.ambientFx) f(dt);
    this.kit.update(dt, this.state === 'play');
    for (const br of this.brawlers) {
      br.pinLive = Math.max(0, br.pinLive - dt);
      br.shield = Math.max(0, br.shield - dt);
      for (const bl of br.balloons) if (bl.alive) bl.img.setAlpha(br.shield > 0 && Math.floor(br.shield * 12) % 2 === 0 ? 0.45 : 1);
      if (!br.out) this.simBalloons(br, dt);
      this.drawBalloons(br);
    }
  }

  tick(dt: number): void {
    for (const br of this.brawlers) this.checkPins(br);
    for (const br of this.brawlers) if (!br.out && this.isCpu(br.b.p)) this.bot(br, dt);
  }

  // ─────────────────────────── CPU ───────────────────────────

  private bot(br: Brawler, dt: number): void {
    const b = br.b;
    const foes = this.brawlers.filter((o) => o !== br && !o.out);
    if (!foes.length) return;
    br.think -= dt;
    // closest rival balloon
    let best: Balloon | undefined, owner: Brawler | undefined, bd = 1e9;
    for (const o of foes) for (const bl of o.balloons) {
      if (!bl.alive) continue;
      const d = Math.hypot(bl.x - b.x, bl.y - b.y) + (o.b.dashCd <= 0 ? 10 : 0);
      if (d < bd) { bd = d; best = bl; owner = o; }
    }
    // threat: a rival close and able to dash at my balloons
    const threat = foes.find((o) => o.b.dashCd < 0.2 && Math.hypot(o.b.x - b.x, o.b.y - b.y) < 90);
    if (br.think <= 0) {
      br.think = 0.5 + Math.random() * 0.6;
      br.aggro = Math.random() < 0.35 + br.skill * 0.3 + this.elapsed / 50 || !threat;
      if (Math.random() < 0.4) br.strafe = -br.strafe;
    }
    if (best && owner && (br.aggro || b.dashCd <= 0)) {
      // swing around to come at the balloon from the side away from its owner
      const ax = best.x - owner.b.x, ay = best.y - owner.b.y, al = Math.hypot(ax, ay) || 1;
      const side = { x: best.x + (ax / al) * 20 - (ay / al) * br.strafe * 16, y: best.y + (ay / al) * 20 + (ax / al) * br.strafe * 16 };
      const lead = 0.15 * br.skill;
      const err = (1 - br.skill) * 22;
      const aim = { x: best.x + best.vx * lead + (Math.random() - 0.5) * err, y: best.y + best.vy * lead + (Math.random() - 0.5) * err };
      const da = Math.hypot(aim.x - b.x, aim.y - b.y);
      const ownerD = Math.hypot(owner.b.x - b.x, owner.b.y - b.y);
      b.botTarget = da < 95 || ownerD > da + 10 ? aim : side;
      if (da < 95 && da > 18 && owner.shield <= 0 && b.dashCd <= 0 && Math.random() < (0.8 + br.skill * 2) * dt) {
        b.ix = (aim.x - b.x) / da; b.iy = (aim.y - b.y) / da;
        b.botDash = true;
      }
    } else if (threat) {
      // keep moving, balloons away from the threat
      const ux = b.x - threat.b.x, uy = b.y - threat.b.y, ul = Math.hypot(ux, uy) || 1;
      b.botTarget = { x: b.x + (ux / ul) * 50 - (uy / ul) * br.strafe * 60, y: b.y + (uy / ul) * 50 + (ux / ul) * br.strafe * 60 };
    }
    // stay inside
    const R = this.bounds;
    if (b.botTarget) {
      b.botTarget.x = Phaser.Math.Clamp(b.botTarget.x, R.x + 30, R.right - 30);
      b.botTarget.y = Phaser.Math.Clamp(b.botTarget.y, R.y + 30, R.bottom - 30);
    }
  }

  results(): PlayerResult[] {
    const val = (p: PlayerIndex) => {
      const br = this.brawler(p);
      if (!br) return 0;
      return this.left(br) * 1000 + br.pops * 10 + (br.out ? br.outOrder : 5);
    };
    return rankBy(this.players, val).map((r) => ({ ...r, score: this.brawler(r.player)?.pops ?? 0 }));
  }
}

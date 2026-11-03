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
import { TouchButton } from '../../ui/Controls';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'boxing-buddies';
const MAX_HP = 100;
const WINDUP = 0.11;
const ACTIVE = 0.09;
const RECOVER = 0.24;
const RANGE = 46;
const CONE = (58 * Math.PI) / 180;
const DMG = 10;
const PARRY_WIN = 0.2;
const GUARD_DRAIN = 30;
const GUARD_REGEN = 22;

interface Boxer {
  b: ArenaBody;
  fa: number;
  hp: number;
  guard: number;
  blocking: boolean;
  blockT: number;
  /** <0 idle, otherwise seconds since punch started */
  punchT: number;
  hitDone: boolean;
  side: number;
  combo: number;
  comboTarget: PlayerIndex | -1;
  comboT: number;
  guardBroken: number;
  gloves: Phaser.GameObjects.Image[];
  barBg: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Rectangle;
  guardBar: Phaser.GameObjects.Rectangle;
  chip: Phaser.GameObjects.Image;
  blockBtn?: TouchButton;
  ko: boolean;
  // CPU
  skill: number;
  think: number;
  holdBlock: number;
  strafe: number;
  wantPunch: number;
  shownHp: number;
}

function say(scene: Phaser.Scene, x: number, y: number, s: string, color: string, size: number, angle: number): void {
  const t = txt(scene, x, y, s, { size, color, strokeWidth: 4 }).setDepth(4500).setAngle(angle).setScale(0.4);
  const up = angle === 180 ? 26 : -26;
  scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: t, y: y + up, alpha: 0, delay: 420, duration: 420, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
}

const angDiff = (a: number, b: number) => Math.abs(Phaser.Math.Angle.Wrap(a - b));

/** #12 — Four-way boxing: punch, hold to block, block at the last moment to parry. */
export default class BoxingBuddies extends BaseMinigame {
  private kit!: ArenaKit;
  private boxers: Boxer[] = [];
  private ring!: Phaser.Geom.Rectangle;
  private ambientFx: ((dt: number) => void)[] = [];
  private ropes: Phaser.GameObjects.Image[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.boxers = [];
    this.ambientFx = [];
    this.ropes = [];
    const W = this.vw, H = this.vh;
    const rw = Math.min(480, W - 190), rh = 372;
    this.ring = new Phaser.Geom.Rectangle(Math.round((W - rw) / 2), Math.round((H - rh) / 2) + 6, rw, rh);
    this.paintArt();
    this.paintArena();
    this.buildCrowd();
    const R = this.ring;
    const inner = new Phaser.Geom.Rectangle(R.x + 18, R.y + 26, R.width - 36, R.height - 40);
    this.kit = new ArenaKit(this, {
      speed: 125, accel: 1100, radius: 13, dash: false, action: 'punch', bounce: 0.5, bounds: inner,
      spawn: (p) => ({ x: R.centerX + (p % 2 === 0 ? -1 : 1) * R.width * 0.28, y: R.centerY + (p < 2 ? -1 : 1) * R.height * 0.26 }),
      avatar: { ring: true },
    });
    this.kit.dashHit = 1;
    for (const b of this.kit.bodies) {
      const p = b.p;
      b.avatar.marker?.setVisible(false);
      const fa = Math.atan2(R.centerY - b.y, R.centerX - b.x);
      const gloves = [0, 1].map(() => this.add.image(b.x, b.y, `${ID}-glove-${p}`).setScale(S));
      const barBg = this.add.image(b.x, b.y, `${ID}-bar`).setScale(S).setDepth(3000);
      const bar = this.add.rectangle(b.x, b.y, 34, 4, PLAYER_COLORS[p].main).setOrigin(0, 0.5).setDepth(3001);
      const guardBar = this.add.rectangle(b.x, b.y, 34, 2, 0x9fe3ff).setOrigin(0, 0.5).setDepth(3001);
      const chip = this.add.image(b.x, b.y, playerMarkerKey(this, p)).setScale(S * 0.8).setDepth(3002).setAngle(this.angleFor(p));
      const bx: Boxer = {
        b, fa, hp: MAX_HP, guard: 100, blocking: false, blockT: 0, punchT: -1, hitDone: false, side: 1, combo: 0, comboTarget: -1, comboT: 0,
        guardBroken: 0, gloves, barBg, bar, guardBar, chip, ko: false,
        skill: 0.5 + Math.random() * 0.45, think: Math.random() * 0.4, holdBlock: 0, strafe: Math.random() < 0.5 ? 1 : -1, wantPunch: 0, shownHp: MAX_HP,
      };
      if (!this.isCpu(p)) {
        bx.blockBtn = new TouchButton(this, this.touch, p, 0.6, 0.86, 'shield');
        bx.blockBtn.onPress = () => this.setBlock(bx, true);
        bx.blockBtn.onRelease = () => this.setBlock(bx, false);
        b.stick?.exclude.push(bx.blockBtn);
      }
      this.boxers.push(bx);
    }
    this.kit.onAction = (b, down) => { if (down) { const bx = this.boxer(b.p); if (bx) this.punch(bx); } };
    for (const p of this.players) this.hudText[p] = `${MAX_HP}`;
  }

  private boxer(p: PlayerIndex): Boxer | undefined {
    return this.boxers.find((x) => x.b.p === p);
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[p];
      makeTexture(this, `${ID}-glove-${p}`, 10, 10, (g) => {
        g.ball(5, 4.5, 4.5, 4, c.main);
        g.ball(2.5, 5, 1.8, 2, shift(c.main, -0.1), false);
        g.rect(3, 8, 5, 2, 0xfff8e7);
        g.hline(3, 9, 5, 0xd8d2c0);
        g.outline(-0.75);
      });
    }
    makeTexture(this, `${ID}-bar`, 19, 5, (g) => {
      g.rect(0, 0, 19, 5, 0x1b1f3b);
      g.rect(1, 1, 17, 3, 0x3a2f45);
    });
    makeTexture(this, `${ID}-kostar`, 40, 40, (g) => {
      const pts: number[] = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
        const r = i % 2 ? 9 : 19;
        pts.push(20 + Math.cos(a) * r, 20 + Math.sin(a) * r);
      }
      for (let i = 0; i < 20; i++) {
        const j = (i + 1) % 20;
        g.tri(20, 20, pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1], i % 2 ? 0xffc93d : 0xffe066);
      }
      g.circle(20, 20, 9, 0xff5a3d);
      g.stamp(13, 16, ['a..a.aaa', 'a.a..a.a', 'aa...a.a', 'a.a..a.a', 'a..a.aaa'], { a: 0xffffff });
      g.px(22, 22, 0xff5a3d);
      g.outline(-0.8);
    });
    makeTexture(this, `${ID}-tinystar`, 7, 7, (g) => {
      g.stamp(0, 0, ['...a...', '..aba..', 'aabbbaa', '.abbba.', '.ab.ba.', 'aa...aa', '.......'], { a: 0xffc93d, b: 0xfff1a8 });
    });
    makeSheet(this, `${ID}-fan`, 8, 10, 6, (g, i) => {
      const r = rng(300 + i);
      const skins = [0xf2c29b, 0xd99a6c, 0xb87a4b, 0xffd9b8, 0x8f5a3a, 0xe8b48a];
      const hair = [0x2b2b3a, 0x5a3a2a, 0xffd166, 0x1b1f3b, 0xc0583a, 0x3a2b4a];
      const shirt = [0xff5a6e, 0x3d9bff, 0x3ed17a, 0xffc93d, 0xb8a6ff, 0xff9f43];
      g.rect(1, 7, 6, 3, shirt[(i + Math.floor(r() * 3)) % 6]);
      g.ball(4, 4, 3, 3, skins[i], false);
      g.rect(1, 0, 6, 2, hair[i]); g.px(1, 2, hair[i]); g.px(6, 2, hair[i]);
      g.px(3, 4, 0x1b1f3b); g.px(5, 4, 0x1b1f3b);
      g.outline(-0.7);
    });
    makeTexture(this, `${ID}-spot`, 48, 32, (g) => {
      for (let k = 0; k < 6; k++) g.ellipse(24, 16, 24 - k * 3.5, 16 - k * 2.4, 0xfff6d8, 30 + k * 10);
    });
    makeTexture(this, `${ID}-flash`, 9, 9, (g) => {
      g.vline(4, 0, 9, 0xffffff); g.hline(0, 4, 9, 0xffffff); g.rect(3, 3, 3, 3, 0xffffff);
    });
    makeTexture(this, `${ID}-shieldfx`, 16, 8, (g) => {
      for (let x = 0; x < 16; x++) {
        const y = Math.round(6 - Math.sin((x / 15) * Math.PI) * 5);
        g.px(x, y, 0xbfeaff); g.px(x, y + 1, 0x6cc8f4);
      }
    });
  }

  private paintArena(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    const R = this.ring;
    const x0 = Math.round(R.x / S), y0 = Math.round(R.y / S), w = Math.round(R.width / S), h = Math.round(R.height / S);
    const key = makeTexture(this, `${ID}-bg-${aw}`, aw, ah, (p) => {
      const r = rng(1212);
      // arena floor
      p.gradient(0, 0, aw, ah, [0x231d3d, 0x2b2550, 0x231d3d]);
      for (let i = 0; i < aw * ah * 0.03; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ah), 0x302a58);
      // crowd stands (steps) left and right
      for (const side of [0, 1]) {
        for (let k = 0; k < 4; k++) {
          const sx = side === 0 ? x0 - 18 - k * 12 : x0 + w + 6 + k * 12;
          p.rect(sx, 6, 11, ah - 12, k % 2 ? 0x3a3266 : 0x41387a);
          p.vline(side === 0 ? sx : sx + 10, 6, ah - 12, 0x2a2450);
        }
      }
      // ring apron (blue skirt seen from above-front)
      p.rect(x0 - 6, y0 - 4, w + 12, h + 14, 0x1d5bb3);
      p.rect(x0 - 6, y0 + h + 2, w + 12, 8, 0x16488f);
      for (let x = x0 - 4; x < x0 + w + 6; x += 10) p.rect(x, y0 + h + 4, 5, 4, 0xffe066);
      // canvas
      p.rect(x0, y0, w, h, 0xe9e6f2);
      p.dither(x0, y0 + h - 30, w, 30, 0xe9e6f2, 0xdcd7ea, 0.5);
      for (let i = 0; i < w * h * 0.03; i++) p.px(x0 + Math.floor(r() * w), y0 + Math.floor(r() * h), 0xdcd7ea);
      // centre logo
      const cx = x0 + w / 2, cy = y0 + h / 2;
      p.circle(cx, cy, 30, 0xd6d0e8);
      p.ring(cx, cy, 30, 0xff9f43, 2);
      p.ring(cx, cy, 25, 0xc8c1de, 1);
      const five8 = ['aaa...a.aaa', 'a....a..a.a', 'aaa..a..aaa', '..a.a...a.a', 'aaa.a...aaa']
        .flatMap((row) => { const r2 = row.split('').map((ch) => ch + ch).join(''); return [r2, r2]; });
      p.stamp(Math.round(cx - 11), Math.round(cy - 4), five8.map((s) => s.replace(/a/g, 'b')), { b: 0xb3a9d4 }, false);
      p.stamp(Math.round(cx - 11), Math.round(cy - 5), five8, { a: 0x8455d6 }, false);
      // canvas border band
      p.rect(x0, y0, w, 3, 0xd3cde6); p.rect(x0, y0 + h - 3, w, 3, 0xd3cde6);
      p.rect(x0, y0, 3, h, 0xd3cde6); p.rect(x0 + w - 3, y0, 3, h, 0xd3cde6);
      // player-colour corner pads on the canvas
      const corners: [number, number, number][] = [[x0, y0, 0], [x0 + w, y0, 1], [x0, y0 + h, 2], [x0 + w, y0 + h, 3]];
      for (const [qx, qy, q] of corners) {
        const c = PLAYER_COLORS[q].main;
        p.tri(qx, qy, qx + (q % 2 ? -22 : 22), qy, qx, qy + (q < 2 ? 22 : -22), shift(c, 0.5));
      }
      // back ropes (top edge) and side ropes
      const ropeC = [0xff5a6e, 0xfff8e7, 0x3d9bff];
      ropeC.forEach((c, i) => {
        p.hline(x0, y0 - 10 + i * 4, w, c);
        p.hline(x0, y0 - 9 + i * 4, w, shift(c, -0.5));
        p.vline(x0 - 2 - i, y0 - 10 + i * 4, h + 8 - i * 4, c);
        p.vline(x0 + w + 1 + i, y0 - 10 + i * 4, h + 8 - i * 4, c);
      });
      // shadow of ropes on the canvas
      p.hline(x0, y0 + 2, w, 0xcfc8e0);
      // top crowd silhouettes behind the far ropes
      for (let x = 0; x < aw; x += 5) p.ball(x + 2, 4 + (x % 3), 3, 3, 0x3a3266, false);
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-3000);
    // corner posts (with depth so boxers pass behind the front ones)
    const postKey = (p: PlayerIndex) => makeTexture(this, `${ID}-post-${p}`, 8, 26, (g) => {
      const c = PLAYER_COLORS[p];
      g.rect(2, 4, 4, 22, 0xc7c9d6); g.vline(5, 4, 22, 0x8f93a6);
      g.box(0, 0, 8, 10, c.main);
      g.hline(1, 1, 5, c.light);
      g.outline(-0.7);
    });
    const R2 = this.ring;
    const posts: [number, number, PlayerIndex][] = [[R2.x - 4, R2.y - 2, 0], [R2.right + 4, R2.y - 2, 1], [R2.x - 4, R2.bottom + 10, 2], [R2.right + 4, R2.bottom + 10, 3]];
    for (const [x, y, p] of posts) this.add.image(x, y, postKey(p)).setOrigin(0.5, 1).setScale(S).setDepth(y + 30);
    // front ropes drawn over the boxers
    const fw = Math.round(R2.width / S) + 6;
    const front = makeTexture(this, `${ID}-front-${fw}`, fw, 14, (g) => {
      const cols = [0xff5a6e, 0xfff8e7, 0x3d9bff];
      cols.forEach((c, i) => { g.hline(0, 1 + i * 4, fw, c); g.hline(0, 2 + i * 4, fw, shift(c, -0.5)); });
    });
    const rope = this.add.image(R2.centerX, R2.bottom - 8, front).setOrigin(0.5, 0).setScale(S).setDepth(R2.bottom + 50);
    this.ropes.push(rope);
  }

  private buildCrowd(): void {
    const R = this.ring;
    const r = rng(55);
    const spots: [number, number][] = [];
    for (let k = 0; k < 4; k++) {
      for (let y = 30; y < this.vh - 20; y += 22) {
        spots.push([R.x - 46 - k * 24 + (r() - 0.5) * 6, y + (k % 2) * 11]);
        spots.push([R.right + 22 + k * 24 + (r() - 0.5) * 6, y + (k % 2) * 11]);
      }
    }
    for (const [x, y] of spots) {
      if (x < 8 || x > this.vw - 8) continue;
      const f = this.add.image(x, y, `${ID}-fan`, Math.floor(r() * 6)).setScale(S).setDepth(-2500);
      this.tweens.add({ targets: f, y: y - 3, yoyo: true, repeat: -1, duration: 260 + r() * 300, delay: r() * 500, ease: 'Sine.easeInOut' });
    }
    // sweeping spotlights
    for (let i = 0; i < 2; i++) {
      const s = this.add.image(R.centerX, R.centerY, `${ID}-spot`).setScale(S * 2.4).setDepth(-2000).setAlpha(0.22).setBlendMode(Phaser.BlendModes.ADD);
      let t = i * 2.5;
      this.ambientFx.push((dt) => {
        t += dt;
        s.setPosition(R.centerX + Math.sin(t * 0.45 + i * 2) * R.width * 0.32, R.centerY + Math.cos(t * 0.33 + i) * R.height * 0.25);
      });
    }
    // camera flashes in the crowd
    let ft = 0;
    this.ambientFx.push((dt) => {
      ft -= dt;
      if (ft > 0) return;
      ft = 0.15 + Math.random() * 0.5;
      const [x, y] = spots[Math.floor(Math.random() * spots.length)];
      const fl = this.add.image(x, y - 6, `${ID}-flash`).setScale(S * 0.6).setDepth(-2400).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: fl, scale: S * 1.3, alpha: 0, duration: 220, onComplete: () => fl.destroy() });
    });
  }

  // ─────────────────────────── COMBAT ───────────────────────────

  private setBlock(bx: Boxer, on: boolean): void {
    if (on) {
      if (bx.ko || bx.guardBroken > 0 || this.state !== 'play') return;
      if (!bx.blocking) { bx.blocking = true; bx.blockT = 0; }
    } else bx.blocking = false;
  }

  private punch(bx: Boxer): void {
    if (bx.ko || this.state !== 'play' || bx.punchT >= 0 || bx.b.stun > 0 || bx.guardBroken > 0) return;
    bx.blocking = false;
    // gentle aim assist toward a rival close to the punch direction
    let best: Boxer | undefined, bestD = 1e9;
    for (const o of this.boxers) {
      if (o === bx || o.ko) continue;
      const d = Math.hypot(o.b.x - bx.b.x, o.b.y - bx.b.y);
      const a = Math.atan2(o.b.y - bx.b.y, o.b.x - bx.b.x);
      if (d < RANGE + 30 && angDiff(a, bx.fa) < 1.1 && d < bestD) { bestD = d; best = o; }
    }
    if (best) bx.fa = Math.atan2(best.b.y - bx.b.y, best.b.x - bx.b.x);
    bx.punchT = 0;
    bx.hitDone = false;
    bx.side = -bx.side;
    Audio.sfx('whoosh', 1.3 + bx.b.p * 0.08);
  }

  private resolvePunch(bx: Boxer): void {
    bx.hitDone = true;
    const a = bx.b;
    for (const o of this.boxers) {
      if (o === bx || o.ko) continue;
      const d = Math.hypot(o.b.x - a.x, o.b.y - a.y);
      if (d > RANGE) continue;
      const ang = Math.atan2(o.b.y - a.y, o.b.x - a.x);
      if (angDiff(ang, bx.fa) > CONE) continue;
      this.landHit(bx, o);
    }
  }

  private landHit(atk: Boxer, def: Boxer): void {
    const a = atk.b, d = def.b;
    const hx = (a.x + d.x) / 2, hy = (a.y + d.y) / 2 - 22;
    if (def.blocking) {
      if (def.blockT <= PARRY_WIN) {
        // PARRY: attacker is stunned and shoved away
        a.stun = Math.max(a.stun, 1.1);
        this.kit.knock(a, d.x, d.y, 260, 1.1);
        atk.punchT = -1;
        Audio.sfx('power', 1.4);
        Audio.sfx('stun', 1 + a.p * 0.1);
        Vfx.sparkle(this, hx, hy, [0xffffff, 0x9fe3ff, 0x6cc8f4]);
        burst(this, hx, hy, { tex: 'star', count: 8, tint: [0xffffff, 0xbfeaff], speed: [80, 180], life: 400, depth: 4000 });
        say(this, d.x, d.y - 86, 'PARRY!', '#9fe3ff', 20, this.angleFor(d.p));
        say(this, a.x, a.y - 86, 'มึน!', toCss(PLAYER_COLORS[a.p].light), 16, this.angleFor(a.p));
        this.addScore(d.p, 0);
        return;
      }
      // blocked: chip damage, guard drain
      this.damage(def, DMG * 0.2, atk);
      def.guard -= 22;
      this.kit.knock(d, a.x, a.y, 120, 0.05);
      Audio.sfx('bounce', 0.8);
      burst(this, hx, hy, { tex: 'dot2', count: 6, tint: [0xbfeaff, 0xffffff], speed: [60, 120], life: 250, depth: 4000 });
      if (def.guard <= 0) {
        def.guard = 0;
        def.blocking = false;
        def.guardBroken = 1.0;
        d.stun = Math.max(d.stun, 0.9);
        Audio.sfx('wrong');
        say(this, d.x, d.y - 86, 'การ์ดแตก!', '#ffb3bd', 16, this.angleFor(d.p));
      }
      return;
    }
    // clean hit: combos build up to a power punch
    if (atk.comboTarget === d.p && atk.comboT > 0) atk.combo++;
    else atk.combo = 1;
    atk.comboTarget = d.p;
    atk.comboT = 1.3;
    const power = atk.combo >= 3;
    if (power) atk.combo = 0;
    const dmg = power ? DMG * 1.8 : DMG;
    def.punchT = -1;
    this.kit.knock(d, a.x, a.y, power ? 430 : 230, power ? 0.5 : 0.25);
    Vfx.hit(this, hx, hy, power ? [0xffffff, 0xffe066, 0xff5a3d] : [0xffffff, 0xffe066, 0xff9f43]);
    Vfx.hitFlash(this, d.avatar.sprite);
    Audio.sfx(power ? 'bigHit' : 'hit', 1 + a.p * 0.08);
    if (power) {
      Vfx.shake(this, 0.006, 140);
      say(this, hx, hy - 30, 'POW!', '#ffe066', 22, this.angleFor(a.p));
    }
    this.damage(def, dmg, atk);
  }

  private damage(def: Boxer, n: number, atk: Boxer): void {
    def.hp = Math.max(0, def.hp - n);
    this.hudText[def.b.p] = `${Math.ceil(def.hp)}`;
    if (n >= DMG) this.addScore(atk.b.p, 0);
    if (def.hp <= 0 && !def.ko) this.knockOut(def, atk);
  }

  private knockOut(def: Boxer, atk: Boxer): void {
    def.ko = true;
    def.blocking = false;
    const b = def.b;
    this.kit.knock(b, atk.b.x, atk.b.y, 520, 3);
    Audio.sfx('explode', 1.3);
    Audio.sfx('bigHit', 0.8);
    Vfx.shake(this, 0.01, 260);
    Vfx.flash(this, 0xffffff, 90);
    const x = b.x, y = b.y - 40;
    const star = this.add.image(x, y, `${ID}-kostar`).setScale(0.2).setDepth(4200).setAngle(this.angleFor(b.p));
    this.tweens.add({ targets: star, scale: S * 1.3, angle: star.angle + 20, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: star, alpha: 0, scale: S * 1.6, delay: 900, duration: 300, onComplete: () => star.destroy() });
    burst(this, x, y, { tex: 'star', count: 16, tint: [0xffe066, 0xffffff, 0xff9f43], speed: [120, 280], life: 700, depth: 4100, rotate: true });
    Vfx.confetti(this, x, y, 24);
    say(this, atk.b.x, atk.b.y - 90, 'K.O.!', toCss(PLAYER_COLORS[atk.b.p].light), 20, this.angleFor(atk.b.p));
    this.addScore(atk.b.p, 0);
    // slide a bit, then lie down with dizzy stars
    this.time.delayedCall(350, () => {
      this.kit.kill(b);
      const s = b.avatar.sprite;
      b.avatar.play('stun', true);
      this.tweens.add({ targets: s, angle: b.avatar.facing > 0 ? -90 : 90, y: s.y + 8, duration: 220, ease: 'Bounce.easeOut' });
      for (const g of def.gloves) this.tweens.add({ targets: g, alpha: 0, duration: 400 });
      const stars = [0, 1, 2].map(() => this.add.image(b.x, b.y - 30, `${ID}-tinystar`).setScale(S).setDepth(4000));
      let t = 0;
      const orbit = (dt: number) => {
        t += dt;
        stars.forEach((st, i) => {
          const a = t * 5 + (i * Math.PI * 2) / 3;
          st.setPosition(b.x + Math.cos(a) * 14, b.y - 20 + Math.sin(a) * 5);
        });
      };
      this.ambientFx.push(orbit);
      this.tweens.add({ targets: [s, ...stars, b.avatar.ring!, b.avatar.shadow!].filter(Boolean), alpha: 0, delay: 1800, duration: 500 });
    });
    for (const o of [def.barBg, def.bar, def.guardBar, def.chip]) this.tweens.add({ targets: o, alpha: 0, duration: 300 });
    this.hudText[b.p] = 'KO';
    this.eliminate(b.p);
  }

  // ─────────────────────────── LOOP ───────────────────────────

  ambient(dt: number): void {
    for (const f of this.ambientFx) f(dt);
    for (const bx of this.boxers) {
      const b = bx.b;
      if (bx.ko) continue;
      // facing from stick / movement
      if (b.stick && Math.hypot(b.stick.vx, b.stick.vy) > 0.35 && bx.punchT < 0) bx.fa = Math.atan2(b.stick.vy, b.stick.vx);
      // movement slowdowns
      b.speedMul = bx.blocking ? 0.45 : bx.punchT >= 0 ? 0.55 : 1;
    }
    this.kit.update(dt, this.state === 'play');
    for (const bx of this.boxers) this.syncBoxer(bx, dt);
  }

  private syncBoxer(bx: Boxer, dt: number): void {
    const b = bx.b;
    const top = b.y - 70;
    const hpW = 34 * (bx.hp / MAX_HP);
    bx.shownHp += (bx.hp - bx.shownHp) * Math.min(1, dt * 10);
    bx.barBg.setPosition(b.x + 4, top + 1);
    bx.bar.setPosition(b.x - 13, top).setSize(Math.max(0, hpW), 4);
    bx.bar.setFillStyle(bx.hp < 30 ? 0xff5a3d : PLAYER_COLORS[b.p].main);
    bx.guardBar.setPosition(b.x - 13, top + 3).setSize(34 * (bx.guard / 100), 1).setVisible(bx.guard < 99.5 && !bx.ko);
    bx.guardBar.setFillStyle(bx.guardBroken > 0 ? 0xff7a85 : 0x9fe3ff);
    bx.chip.setPosition(b.x - 24, top + 1);
    if (bx.ko) return;
    if (Math.abs(Math.cos(bx.fa)) > 0.25) b.avatar.face(Math.cos(bx.fa));
    // gloves around the body in the facing direction
    const cx = b.x, cy = b.y - 24;
    const fx = Math.cos(bx.fa), fy = Math.sin(bx.fa) * 0.8;
    const nx = -Math.sin(bx.fa), ny = Math.cos(bx.fa) * 0.8;
    const bob = Math.sin(this.elapsed * 9 + b.p) * 1.5;
    const behind = fy < -0.2;
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? 1 : -1;
      let fwd = 9, lat = 9 * sd, lift = bob * (i ? 1 : -1);
      if (bx.blocking) { fwd = 13; lat = 4 * sd; lift = -6; }
      if (bx.punchT >= 0 && sd === bx.side) {
        const t = bx.punchT;
        if (t < WINDUP) fwd = 9 - (t / WINDUP) * 7;
        else if (t < WINDUP + ACTIVE) fwd = 2 + ((t - WINDUP) / ACTIVE) * 26;
        else fwd = 28 - ((t - WINDUP - ACTIVE) / RECOVER) * 19;
        lat = 3 * sd;
      }
      const g = bx.gloves[i];
      g.setPosition(cx + fx * fwd + nx * lat, cy + fy * fwd + ny * lat + lift);
      g.setDepth(b.y + (behind ? -1 : 1));
      g.setFlipX(fx < 0);
      if (bx.blocking) g.setTint(bx.blockT <= PARRY_WIN ? 0xdff6ff : 0xbfd8ff);
      else g.clearTint();
    }
    b.avatar.sprite.setTint(bx.guardBroken > 0 && Math.floor(this.elapsed * 12) % 2 ? 0xffb0b0 : 0xffffff);
  }

  tick(dt: number): void {
    for (const bx of this.boxers) {
      if (bx.ko) continue;
      const b = bx.b;
      bx.comboT = Math.max(0, bx.comboT - dt);
      bx.guardBroken = Math.max(0, bx.guardBroken - dt);
      if (bx.blocking) {
        bx.blockT += dt;
        bx.guard -= GUARD_DRAIN * dt;
        if (bx.guard <= 0) {
          bx.guard = 0; bx.blocking = false; bx.guardBroken = 1; b.stun = Math.max(b.stun, 0.8);
          Audio.sfx('wrong');
          say(this, b.x, b.y - 86, 'การ์ดแตก!', '#ffb3bd', 16, this.angleFor(b.p));
        }
      } else bx.guard = Math.min(100, bx.guard + GUARD_REGEN * dt);
      // human still holding the block button after a guard break → resume when allowed
      if (bx.blockBtn?.isDown && !bx.blocking && bx.guardBroken <= 0 && bx.guard > 15) this.setBlock(bx, true);
      if (bx.punchT >= 0) {
        if (b.stun > 0) bx.punchT = -1;
        else {
          bx.punchT += dt;
          if (!bx.hitDone && bx.punchT >= WINDUP) this.resolvePunch(bx);
          if (bx.punchT >= WINDUP + ACTIVE + RECOVER) bx.punchT = -1;
        }
      }
    }
    for (const bx of this.boxers) if (!bx.ko && this.isCpu(bx.b.p)) this.bot(bx, dt);
  }

  // ─────────────────────────── CPU ───────────────────────────

  private bot(bx: Boxer, dt: number): void {
    const b = bx.b;
    const foes = this.boxers.filter((o) => o !== bx && !o.ko);
    if (!foes.length) return;
    bx.think -= dt;
    const dist = (o: Boxer) => Math.hypot(o.b.x - b.x, o.b.y - b.y);
    // pick a target: close and hurt
    const tgt = foes.reduce((m, o) => (dist(o) + o.hp * 0.8 < dist(m) + m.hp * 0.8 ? o : m));
    const d = dist(tgt);
    const ang = Math.atan2(tgt.b.y - b.y, tgt.b.x - b.x);
    if (bx.punchT < 0) bx.fa = Phaser.Math.Angle.RotateTo(bx.fa, ang, (4 + bx.skill * 6) * dt);
    // defend: someone winding up at us
    const threat = foes.find((o) => o.punchT >= 0 && o.punchT < WINDUP && dist(o) < RANGE + 8 &&
      angDiff(Math.atan2(b.y - o.b.y, b.x - o.b.x), o.fa) < CONE);
    if (threat && !bx.blocking && bx.punchT < 0 && bx.guard > 25 && bx.think <= 0) {
      bx.think = 0.25;
      if (Math.random() < 0.25 + bx.skill * 0.5) { this.setBlock(bx, true); bx.holdBlock = 0.22 + Math.random() * 0.3; }
    }
    if (bx.blocking) {
      bx.holdBlock -= dt;
      if (bx.holdBlock <= 0) this.setBlock(bx, false);
    }
    if (bx.think <= 0) {
      bx.think = 0.4 + Math.random() * 0.5;
      if (Math.random() < 0.3) bx.strafe = -bx.strafe;
    }
    // footwork: hold just inside punch range and circle
    const want = bx.guard < 30 || bx.hp < 25 && tgt.hp > bx.hp ? RANGE + 40 : RANGE - 8;
    const radial = d - want;
    const ux = (tgt.b.x - b.x) / (d || 1), uy = (tgt.b.y - b.y) / (d || 1);
    const tx = b.x + ux * radial + -uy * bx.strafe * 24;
    const ty = b.y + uy * radial + ux * bx.strafe * 24;
    b.botTarget = { x: tx, y: ty };
    // attack
    if (bx.punchT < 0 && !bx.blocking && d < RANGE + 2 && angDiff(ang, bx.fa) < 0.5 && b.stun <= 0) {
      bx.wantPunch -= dt;
      if (bx.wantPunch <= 0) {
        this.punch(bx);
        bx.wantPunch = 0.12 + (1 - bx.skill) * 0.5 + Math.random() * 0.35;
      }
    }
  }

  results(): PlayerResult[] {
    const val = (p: PlayerIndex) => {
      const i = this.eliminated.indexOf(p);
      const bx = this.boxer(p);
      return i === -1 ? 1000 + (bx?.hp ?? 0) : i;
    };
    return rankBy(this.players, val).map((r) => ({ ...r, score: Math.ceil(this.boxer(r.player)?.hp ?? 0) }));
  }
}

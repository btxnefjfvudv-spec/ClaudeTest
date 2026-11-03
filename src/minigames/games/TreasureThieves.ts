import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const ID = 'treasure-thieves';
const MAX_CARRY = 5;
const VAULT_R = 46;
const WALL_T = 34; // top wall thickness (world units)
const WALL_S = 16; // side / bottom wall thickness

type Kind = 'coin' | 'gem' | 'ruby';
const VALUE: Record<Kind, number> = { coin: 1, gem: 3, ruby: 5 };

interface Loot {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  img: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  delay: number;
  alive: boolean;
  age: number;
}

interface Vault {
  p: PlayerIndex;
  x: number;
  y: number;
  door: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  pile: Phaser.GameObjects.Image[];
}

interface Chest {
  x: number;
  y: number;
  t: number;
  img: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  opened: boolean;
}

/** #41 — Grab coins and gems, carry them home to your vault, dash rivals to make them spill. */
export default class TreasureThieves extends BaseMinigame {
  private kit!: ArenaKit;
  private loot: Loot[] = [];
  private carry: Kind[][] = [[], [], [], []];
  private stacks: Phaser.GameObjects.Image[][] = [[], [], [], []];
  private vaults: Vault[] = [];
  private chest?: Chest;
  private spawnT = 0;
  private chestT = 0;
  private field!: Phaser.Geom.Rectangle;
  private warned = false;
  private torches: Phaser.GameObjects.Image[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.loot = [];
    this.carry = [[], [], [], []];
    this.stacks = [[], [], [], []];
    this.vaults = [];
    this.chest = undefined;
    this.spawnT = 0;
    this.chestT = 9;
    this.warned = false;
    this.torches = [];
    const W = this.vw, H = this.vh;
    this.field = new Phaser.Geom.Rectangle(WALL_S, WALL_T - 4, W - WALL_S * 2, H - WALL_T - WALL_S + 4);
    this.paintArt();
    this.paintRoom();
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) this.makeVault(p);

    this.kit = new ArenaKit(this, {
      speed: 150, accel: 850, radius: 12, dashSpeed: 430, dashCooldown: 1.0, bounce: 0.7,
      bounds: this.field,
      spawn: (p) => { const v = this.vaultPos(p); return { x: v.x, y: v.y + (p < 2 ? 46 : -46) }; },
    });
    this.kit.dashHit = 1.25;
    this.kit.onBump = (a, b) => {
      if (a.dashT > 0) this.robbed(b, a);
      if (b.dashT > 0) this.robbed(a, b);
    };
    for (const b of this.kit.bodies) {
      b.data.greed = 3 + Math.floor(Math.random() * 3);
      b.data.aggro = 0.35 + Math.random() * 0.5;
      b.data.think = 0;
      b.data.tx = b.x;
      b.data.ty = b.y;
      b.data.mode = 0;
    }
    // Opening scatter of treasure so the first seconds are a scramble.
    const r = rng(77);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + r() * 0.3;
      const d = 60 + r() * 120;
      this.spawnLoot(i % 6 === 0 ? 'gem' : 'coin', W / 2 + Math.cos(a) * d * 1.3, H / 2 + 6 + Math.sin(a) * d * 0.75);
    }
    this.refreshHud();
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    makeSheet(this, `${ID}-gem`, 10, 10, 6, (p, i) => {
      const c = 0x3fe0e0;
      p.tri(1, 4, 9, 4, 5, 9, shift(c, -0.3));
      p.tri(1, 4, 5, 4, 5, 9, c);
      p.rect(2, 2, 6, 2, shift(c, 0.3));
      p.px(3, 2, 0xffffff); p.px(4, 3, 0xffffff);
      p.hline(1, 4, 8, shift(c, 0.55));
      p.outline(-0.7);
      if (i === 2) { p.px(7, 1, 0xffffff); p.px(8, 0, 0xffffff); }
      if (i === 3) { p.px(6, 2, 0xffffff); p.px(8, 2, 0xffffff); p.px(7, 1, 0xffffff); p.px(7, 3, 0xffffff); }
    });
    makeSheet(this, `${ID}-ruby`, 12, 12, 6, (p, i) => {
      const c = 0xff4d6d;
      p.ball(6, 6, 5, 5, c);
      p.tri(3, 3, 9, 3, 6, 9, shift(c, 0.2));
      p.rect(4, 3, 4, 2, shift(c, 0.5));
      p.px(4, 3, 0xffffff);
      p.outline(-0.75);
      if (i === 1) { p.px(9, 2, 0xffffff); p.px(10, 1, 0xffffff); }
      if (i === 2) { p.px(8, 1, 0xffffff); p.px(10, 1, 0xffffff); p.px(9, 0, 0xffffff); p.px(9, 2, 0xffffff); }
    });
    for (const k of ['gem', 'ruby']) {
      if (!this.anims.exists(`${ID}-${k}-spin`)) {
        this.anims.create({ key: `${ID}-${k}-spin`, frames: this.anims.generateFrameNumbers(`${ID}-${k}`, {}), frameRate: 7, repeat: -1 });
      }
    }
    // tiny stack pieces shown above a carrier's head
    makeTexture(this, `${ID}-stack-coin`, 10, 4, (p) => { p.ellipse(5, 2, 5, 2, 0xffc93d); p.hline(2, 1, 5, 0xffe9a8); p.hline(1, 3, 8, 0xc98a1c); p.outline(-0.7); });
    makeTexture(this, `${ID}-stack-gem`, 10, 5, (p) => { p.ellipse(5, 2.5, 5, 2.5, 0x3fe0e0); p.hline(2, 1, 5, 0xc8fbff); p.hline(1, 4, 8, 0x1f9aa8); p.outline(-0.7); });
    makeTexture(this, `${ID}-stack-ruby`, 10, 5, (p) => { p.ellipse(5, 2.5, 5, 2.5, 0xff4d6d); p.hline(2, 1, 5, 0xffc2cc); p.hline(1, 4, 8, 0xb3263a); p.outline(-0.7); });
    // torch flame (4 frames)
    makeSheet(this, `${ID}-flame`, 10, 14, 4, (p, i) => {
      const sway = [0, 1, 0, -1][i];
      p.ellipse(5 + sway * 0.5, 9, 3.6, 4.6, 0xff5a3d);
      p.ellipse(5 + sway, 7.5, 2.6, 4, 0xff9f43);
      p.ellipse(5 + sway, 8.5, 1.5, 2.6, 0xffe066);
      p.px(5 + sway * 2, 2 + (i % 2), 0xffb070);
    });
    if (!this.anims.exists(`${ID}-flame-burn`)) this.anims.create({ key: `${ID}-flame-burn`, frames: this.anims.generateFrameNumbers(`${ID}-flame`, {}), frameRate: 9, repeat: -1 });
    makeTexture(this, `${ID}-glow`, 48, 48, (p) => {
      for (let r = 24; r > 0; r -= 3) p.circle(24, 24, r, 0xffb060, Math.round(30 * (1 - r / 26)));
    });
    makeTexture(this, `${ID}-chest`, 28, 22, (p) => {
      const wood = 0x9a5a2e;
      p.box(1, 9, 26, 13, wood, 1);
      p.ellipse(14, 9, 13, 6, shift(wood, 0.15));
      p.rect(1, 9, 26, 2, shift(wood, -0.3));
      for (const x of [5, 21]) { p.rect(x, 4, 3, 18, 0xffc93d); p.vline(x, 4, 18, 0xffe9a8); }
      p.rect(12, 10, 4, 5, 0xffe066); p.px(13, 12, 0x5a3a2a);
      p.outline(-0.75);
    });
    makeTexture(this, `${ID}-chest-open`, 28, 22, (p) => {
      const wood = 0x9a5a2e;
      p.ellipse(14, 4, 12, 4, shift(wood, -0.2));
      p.box(1, 9, 26, 13, wood, 1);
      p.rect(3, 8, 22, 4, 0xffc93d);
      for (let i = 0; i < 7; i++) p.ball(5 + i * 3, 8 - (i % 2), 2, 2, 0xffe066, false);
      for (const x of [5, 21]) { p.rect(x, 9, 3, 13, 0xffc93d); }
      p.outline(-0.75);
    });
    makeTexture(this, `${ID}-mote`, 2, 2, (p) => { p.px(0, 0, 0xfff1c9); p.px(1, 1, 0xffe066, 180); });
  }

  private vaultPos(p: PlayerIndex): { x: number; y: number } {
    const left = p % 2 === 0;
    const top = p < 2;
    return { x: left ? 140 : this.vw - 140, y: top ? WALL_T + 12 : this.vh - WALL_S - 14 };
  }

  private paintRoom(): void {
    const W = this.vw, H = this.vh;
    const aw = Math.ceil(W / S), ah = Math.ceil(H / S);
    const key = makeTexture(this, `${ID}-room-${aw}`, aw, ah, (p) => {
      const r = rng(9);
      const stone = [0x4b4470, 0x45406a, 0x524a78, 0x4e4774];
      // floor tiles 16x12 staggered
      for (let y = 0; y < ah; y += 12) {
        const off = (y / 12) % 2 ? 8 : 0;
        for (let x = -16; x < aw + 16; x += 16) {
          const c = stone[Math.floor(r() * stone.length)];
          p.rect(x + off, y, 15, 11, c);
          p.hline(x + off, y, 15, shift(c, 0.18));
          p.hline(x + off, y + 10, 15, shift(c, -0.2));
          p.hline(x + off - 1, y + 11, 17, 0x2e2950);
          p.vline(x + off + 15, y, 12, 0x2e2950);
          if (r() < 0.25) { const cx = x + off + 3 + Math.floor(r() * 9); p.line(cx, y + 2, cx + 3, y + 6, shift(c, -0.3)); }
          if (r() < 0.12) p.px(x + off + 2 + Math.floor(r() * 11), y + 2 + Math.floor(r() * 7), 0xffe066);
        }
      }
      // central mosaic: gold ring + star
      const cx = aw / 2, cy = ah / 2 + 4;
      p.ellipse(cx, cy, 46, 30, 0x3a3462);
      p.ellipse(cx, cy, 44, 28, 0x5e3a6e);
      for (let a = 0; a < Math.PI * 2; a += 0.05) p.px(cx + Math.cos(a) * 40, cy + Math.sin(a) * 25, 0xd9a23a);
      for (let a = 0; a < Math.PI * 2; a += 0.07) p.px(cx + Math.cos(a) * 34, cy + Math.sin(a) * 21, 0xb07a2a);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        p.line(cx, cy, cx + Math.cos(a) * 30, cy + Math.sin(a) * 18, k % 2 ? 0x8a5a9a : 0xd9a23a);
      }
      p.ellipse(cx, cy, 8, 5, 0xffc93d);
      p.ellipse(cx - 1, cy - 1, 4, 2, 0xffe9a8);
      // carpet runners to each vault (player colour edge)
      // vignette dither near walls
      p.dither(0, WALL_T / S, aw, 6, 0x2e2950, stone[0], 0.5);
      // walls: top (tall, bricks)
      const tw = WALL_T / S, sw = WALL_S / S;
      p.rect(0, 0, aw, tw, 0x2b2546);
      for (let y = 0; y < tw - 4; y += 5) {
        const off = (y / 5) % 2 ? 6 : 0;
        for (let x = -12; x < aw; x += 12) {
          const c = [0x3d355f, 0x433a68, 0x39325a][Math.floor(r() * 3)];
          p.rect(x + off, y, 11, 4, c);
          p.hline(x + off, y, 11, shift(c, 0.2));
        }
      }
      p.rect(0, tw - 4, aw, 4, 0x221d3a);
      p.hline(0, tw - 4, aw, 0x6a5a9a);
      // bottom + side walls (seen from above: thick rim)
      p.rect(0, ah - sw, aw, sw, 0x2b2546);
      p.hline(0, ah - sw, aw, 0x6a5a9a);
      for (let x = 0; x < aw; x += 12) p.rect(x + 1, ah - sw + 2, 10, sw - 4, 0x3a3260);
      p.rect(0, 0, sw, ah, 0x2b2546);
      p.rect(aw - sw, 0, sw, ah, 0x2b2546);
      p.vline(sw - 1, tw - 4, ah - tw + 4 - sw, 0x6a5a9a);
      p.vline(aw - sw, tw - 4, ah - tw + 4 - sw, 0x6a5a9a);
      for (let y = tw; y < ah - sw; y += 12) { p.rect(1, y + 1, sw - 3, 10, 0x3a3260); p.rect(aw - sw + 2, y + 1, sw - 3, 10, 0x3a3260); }
      // gold piles in the four room corners
      const pile = (px0: number, py0: number) => {
        for (let i = 0; i < 26; i++) {
          const a = r() * Math.PI, d = r() * 12;
          p.ball(px0 + Math.cos(a) * d * 1.4, py0 - Math.sin(a) * d * 0.6, 2.2, 1.6, r() < 0.15 ? 0x3fe0e0 : 0xffc93d, false);
        }
      };
      pile(sw + 12, tw + 8); pile(aw - sw - 12, tw + 8); pile(sw + 12, ah - sw - 3); pile(aw - sw - 12, ah - sw - 3);
      // banners on the top wall between vaults
      for (const bx of [aw * 0.5 - 30, aw * 0.5 + 30]) {
        p.rect(bx - 6, 1, 12, 13, 0x8455d6);
        p.tri(bx - 6, 14, bx + 6, 14, bx, 18, 0x8455d6);
        p.rect(bx - 6, 1, 12, 2, 0xffc93d);
        p.ball(bx, 8, 2.5, 2.5, 0xffc93d);
      }
    });
    this.add.image(0, 0, key).setOrigin(0).setScale(S).setDepth(-100);

    // Torches on the top wall + glow + flickering floor light pools
    const tx = [W * 0.32, W * 0.68, 46, W - 46];
    tx.forEach((x, i) => {
      const y = i < 2 ? 14 : WALL_T + 120;
      const flame = this.add.sprite(x, y, `${ID}-flame`).setScale(S).setDepth(-40).play(`${ID}-flame-burn`);
      flame.anims.setProgress(i * 0.25);
      const glow = this.add.image(x, y + 8, `${ID}-glow`).setScale(S * 2.4).setDepth(-45).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55);
      this.torches.push(glow);
      void flame;
    });
    // side torch brackets on the side walls
    const bracket = makeTexture(this, `${ID}-bracket`, 6, 8, (p) => { p.rect(1, 3, 4, 5, 0x6b6b80); p.rect(0, 2, 6, 2, 0x8f98a8); p.outline(-0.6); });
    for (const [x, y] of [[W * 0.32, 26], [W * 0.68, 26], [46, WALL_T + 132], [W - 46, WALL_T + 132]]) this.add.image(x, y, bracket).setScale(S).setDepth(-41);
    // floating dust motes catching torch light
    for (let i = 0; i < 26; i++) {
      const m = this.add.image(Phaser.Math.Between(30, W - 30), Phaser.Math.Between(50, H - 30), `${ID}-mote`).setScale(S).setDepth(600).setAlpha(0);
      this.tweens.add({
        targets: m, alpha: { from: 0, to: 0.7 }, y: m.y - Phaser.Math.Between(20, 50), x: m.x + Phaser.Math.Between(-20, 20),
        duration: Phaser.Math.Between(2200, 4200), yoyo: true, repeat: -1, delay: Phaser.Math.Between(0, 3000), ease: 'Sine.easeInOut',
      });
    }
  }

  private makeVault(p: PlayerIndex): void {
    const c = PLAYER_COLORS[p];
    const { x, y } = this.vaultPos(p);
    const top = p < 2;
    const doorKey = makeTexture(this, `${ID}-vault-${p}`, 40, 30, (g) => {
      // stone frame + round safe door in player colour
      g.box(0, 0, 40, 30, 0x5a5080, 1);
      g.rect(2, 2, 36, 26, 0x2b2546);
      g.ball(20, 15, 12, 11, shift(c.main, -0.15));
      g.ring(20, 15, 12, shift(c.main, -0.55), 1);
      g.ring(20, 15, 8, c.light, 1);
      g.circle(20, 15, 3, 0xd8dbe4);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        g.px(20 + Math.cos(a) * 5, 15 + Math.sin(a) * 5, 0xfff8e7);
      }
      g.rect(30, 13, 4, 4, 0xd8dbe4);
      for (const bx of [4, 34]) for (const by of [4, 24]) g.px(bx, by, 0xffe066);
      g.outline(-0.8);
    });
    const padKey = makeTexture(this, `${ID}-pad-${p}`, 50, 30, (g) => {
      g.ellipse(25, 15, 25, 15, shift(c.main, -0.55));
      g.ellipse(25, 15, 22, 12.5, shift(c.main, -0.35));
      for (let a = 0; a < Math.PI * 2; a += 0.18) g.px(25 + Math.cos(a) * 19, 15 + Math.sin(a) * 10, c.light);
    });
    const padY = y + (top ? 34 : -30);
    this.add.image(x, padY, padKey).setScale(S).setDepth(-60).setAlpha(0.8);
    const glow = this.add.image(x, padY, `${ID}-glow`).setScale(S * 1.3).setDepth(-59).setTint(c.main).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.15);
    const door = this.add.image(x, y, doorKey).setScale(S).setDepth(top ? -30 : y + 40).setFlipY(!top);
    if (!this.players.includes(p)) { door.setAlpha(0.45); glow.setVisible(false); }
    this.tweens.add({ targets: glow, alpha: 0.32, yoyo: true, repeat: -1, duration: 900 + p * 120, ease: 'Sine.easeInOut' });
    this.vaults.push({ p, x, y: padY, door, glow, pile: [] });
  }

  // ───────────────────────────── loot ─────────────────────────────

  private spawnLoot(kind: Kind, x: number, y: number, vx = 0, vy = 0, vz = 0, delay = 0): Loot {
    const f = this.field;
    x = Phaser.Math.Clamp(x, f.x + 10, f.right - 10);
    y = Phaser.Math.Clamp(y, f.y + 14, f.bottom - 8);
    const tex = kind === 'coin' ? 'coin' : `${ID}-${kind}`;
    const img = this.add.sprite(x, y, tex).setScale(S).setOrigin(0.5, 1);
    img.play(kind === 'coin' ? 'coin-spin' : `${ID}-${kind}-spin`);
    img.anims.setProgress(Math.random());
    const shadow = this.add.image(x, y, 'shadow').setScale(S * 0.38).setAlpha(0.3);
    const l: Loot = { kind, x, y, z: vz ? 2 : 0, vx, vy, vz, img, shadow, delay, alive: true, age: 0 };
    if (!vz && !vx) {
      img.setScale(0);
      this.tweens.add({ targets: img, scale: S, duration: 260, ease: 'Back.easeOut' });
    }
    this.loot.push(l);
    return l;
  }

  private randomSpot(): { x: number; y: number } {
    const f = this.field;
    for (let k = 0; k < 20; k++) {
      // Biased toward the middle of the room.
      const x = Phaser.Math.Linear(f.x + 30, f.right - 30, (Math.random() + Math.random()) / 2);
      const y = Phaser.Math.Linear(f.y + 40, f.bottom - 30, (Math.random() + Math.random() + Math.random()) / 3);
      if (this.vaults.every((v) => Math.hypot(v.x - x, v.y - y) > VAULT_R + 50)) return { x, y };
    }
    return { x: this.vw / 2, y: this.vh / 2 };
  }

  private rollKind(): Kind {
    const r = Math.random();
    return r < 0.05 ? 'ruby' : r < 0.22 ? 'gem' : 'coin';
  }

  private scatter(kind: Kind, x: number, y: number, power = 1, delay = 0.35): void {
    const a = Math.random() * Math.PI * 2;
    const sp = (60 + Math.random() * 110) * power;
    this.spawnLoot(kind, x, y, Math.cos(a) * sp, Math.sin(a) * sp * 0.8, 140 + Math.random() * 120, delay);
  }

  private updateLoot(dt: number): void {
    const f = this.field;
    for (const l of this.loot) {
      if (!l.alive) continue;
      l.age += dt;
      l.delay = Math.max(0, l.delay - dt);
      if (l.z > 0 || l.vz !== 0) {
        l.vz -= 600 * dt;
        l.z += l.vz * dt;
        l.x += l.vx * dt;
        l.y += l.vy * dt;
        if (l.x < f.x + 8 || l.x > f.right - 8) { l.vx *= -0.6; l.x = Phaser.Math.Clamp(l.x, f.x + 8, f.right - 8); }
        if (l.y < f.y + 12 || l.y > f.bottom - 6) { l.vy *= -0.6; l.y = Phaser.Math.Clamp(l.y, f.y + 12, f.bottom - 6); }
        if (l.z <= 0) {
          l.z = 0;
          if (Math.abs(l.vz) > 90) {
            l.vz = -l.vz * 0.4;
            l.vx *= 0.55; l.vy *= 0.55;
            if (Math.random() < 0.5) Audio.sfx('coin', 1.6 + Math.random() * 0.4);
          } else { l.vz = 0; l.vx = 0; l.vy = 0; }
        }
      }
      l.img.setPosition(l.x, l.y - l.z + Math.sin(l.age * 4 + l.x) * (l.z === 0 ? 1 : 0)).setDepth(l.y);
      l.shadow.setPosition(l.x, l.y + 1).setDepth(l.y - 1000);
    }
    this.loot = this.loot.filter((l) => l.alive);
  }

  private pickUp(b: ArenaBody): void {
    const bag = this.carry[b.p];
    if (bag.length >= MAX_CARRY || b.stun > 0) return;
    for (const l of this.loot) {
      if (!l.alive || l.delay > 0 || l.z > 6) continue;
      if (Math.hypot(l.x - b.x, l.y - b.y) > 20) continue;
      l.alive = false;
      bag.push(l.kind);
      const img = l.img, sh = l.shadow;
      this.tweens.add({ targets: img, y: b.y - 70, x: b.x, scale: S * 0.6, alpha: 0, duration: 180, onComplete: () => img.destroy() });
      sh.destroy();
      Audio.sfx('coin', 1 + b.p * 0.1 + bag.length * 0.05);
      Vfx.coinPop(this, l.x, l.y - 8);
      Vfx.squash(this, b.avatar.sprite, 1.15, 0.9, 120);
      if (bag.length >= MAX_CARRY) {
        Vfx.popText(this, b.x, b.y - 92, 'เต็ม! กลับฐาน!', '#ffe066', 13, this.angleFor(b.p));
        Audio.sfx('select', 0.8);
      }
      this.refreshStack(b.p);
      if (bag.length >= MAX_CARRY) return;
    }
  }

  private refreshStack(p: PlayerIndex): void {
    const bag = this.carry[p];
    const st = this.stacks[p];
    while (st.length < bag.length) st.push(this.add.image(0, 0, `${ID}-stack-coin`).setScale(S));
    while (st.length > bag.length) st.pop()!.destroy();
    bag.forEach((k, i) => st[i].setTexture(`${ID}-stack-${k}`));
    const b = this.kit.body(p);
    if (b) b.speedMul = 1 - bag.length * 0.075;
  }

  private robbed(victim: ArenaBody, thief: ArenaBody): void {
    const bag = this.carry[victim.p];
    if (victim.invuln > 0 || this.state !== 'play') return;
    victim.invuln = 1.1;
    victim.stun = Math.max(victim.stun, 0.5);
    if (!bag.length) return;
    const n = Math.ceil(bag.length / 2);
    const drop = bag.splice(bag.length - n, n);
    for (const k of drop) this.scatter(k, victim.x, victim.y - 4, 1.1, 0.3);
    this.refreshStack(victim.p);
    Audio.sfx('bigHit', 1 + thief.p * 0.08);
    Audio.sfx('coin', 0.7);
    Vfx.shake(this, 0.006, 140);
    burst(this, victim.x, victim.y - 50, { tex: 'spark', count: 12, tint: [0xffe066, 0xffffff], speed: [60, 160], life: 420 });
    Vfx.popText(this, victim.x, victim.y - 86, `ร่วง ${n}!`, '#ff9f8a', 16, this.angleFor(victim.p));
    Vfx.popText(this, thief.x, thief.y - 86, 'ปล้น!', toCss(PLAYER_COLORS[thief.p].light), 15, this.angleFor(thief.p));
  }

  private bank(b: ArenaBody, v: Vault): void {
    const bag = this.carry[b.p];
    if (!bag.length) return;
    let total = 0;
    bag.forEach((k, i) => {
      total += VALUE[k];
      const tex = k === 'coin' ? 'coin' : `${ID}-${k}`;
      const fly = this.add.image(b.x, b.y - 72 - i * 7, tex).setScale(S).setDepth(2500);
      this.tweens.add({
        targets: fly, x: v.x + Phaser.Math.Between(-8, 8), y: this.vaultPos(b.p).y, scale: S * 0.5, delay: i * 70, duration: 260, ease: 'Quad.easeIn',
        onComplete: () => { fly.destroy(); Audio.sfx('coin', 1.1 + i * 0.12); Vfx.coinPop(this, v.x, this.vaultPos(b.p).y); },
      });
    });
    this.carry[b.p] = [];
    this.refreshStack(b.p);
    this.addScore(b.p, total);
    this.refreshHud();
    Audio.sfx('power', 1 + b.p * 0.08);
    const door = v.door;
    this.tweens.add({ targets: door, scaleX: S * 1.15, scaleY: S * 1.15, yoyo: true, duration: 120 });
    this.tweens.add({ targets: v.glow, alpha: 0.8, scale: S * 2.2, yoyo: true, duration: 200 });
    Vfx.popText(this, v.x, v.y + (b.p < 2 ? 30 : -30), `+${total}`, toCss(PLAYER_COLORS[b.p].light), 24, this.angleFor(b.p));
    b.avatar.play('cheer', true);
  }

  private refreshHud(): void {
    for (const p of this.players) {
      const n = this.carry[p].reduce((s, k) => s + VALUE[k], 0);
      this.hudText[p] = n ? `${this.score[p]} +${n}` : `${this.score[p]}`;
    }
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.kit.update(dt, this.state === 'play');
    this.updateLoot(dt);
    // stacks over heads (and lift the number marker above them)
    for (const b of this.kit.bodies) {
      const st = this.stacks[b.p];
      const bob = Math.sin(this.time.now / 160 + b.p) * 1;
      st.forEach((img, i) => img.setPosition(b.x + Math.sin(i * 1.7 + b.x * 0.02) * 1.5, b.y - 70 - i * 6 + bob).setDepth(b.y + 1 + i * 0.01));
      if (b.avatar.marker) b.avatar.marker.y -= st.length * 6;
    }
    for (const [i, g] of this.torches.entries()) g.setAlpha(0.45 + Math.sin(this.time.now / 90 + i * 2) * 0.05 + Math.random() * 0.06);
    if (this.chest) {
      const c = this.chest;
      c.img.setPosition(c.x, c.y).setDepth(c.y);
    }
    // vault glows brighten when their owner is home with loot
    for (const v of this.vaults) {
      const b = this.kit.body(v.p);
      if (b && this.carry[v.p].length && Math.hypot(b.x - v.x, b.y - v.y) < 140) v.glow.setScale(S * (1.6 + Math.sin(this.time.now / 80) * 0.12));
    }
  }

  tick(dt: number): void {
    // spawning
    this.spawnT -= dt;
    const onFloor = this.loot.length;
    if (this.spawnT <= 0 && onFloor < 16) {
      const s = this.randomSpot();
      this.spawnLoot(this.rollKind(), s.x, s.y);
      this.spawnT = 0.55 + Math.random() * 0.4;
    }
    this.tickChest(dt);
    for (const b of this.kit.alive) {
      this.pickUp(b);
      const v = this.vaults.find((x) => x.p === b.p)!;
      if (Math.hypot(b.x - v.x, b.y - v.y) < VAULT_R) this.bank(b, v);
      if (this.isCpu(b.p)) this.bot(b, dt);
    }
    if (!this.warned && this.timeLeft < 10) {
      this.warned = true;
      Audio.sfx('power');
      for (const [deg, y] of [[0, this.vh * 0.64], [180, this.vh * 0.36]] as const) {
        const t = txt(this, this.vw / 2, y, '10 วิสุดท้าย! รีบฝาก!', { size: 24, color: '#ffe066', strokeWidth: 6 }).setAngle(deg).setDepth(3000);
        this.tweens.add({ targets: t, scale: { from: 0.4, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        this.tweens.add({ targets: t, alpha: 0, delay: 1400, duration: 400, onComplete: () => t.destroy() });
      }
    }
    this.refreshHud();
  }

  private tickChest(dt: number): void {
    this.chestT -= dt;
    if (!this.chest && this.chestT <= 0 && this.timeLeft > 6) {
      const x = this.vw / 2, y = this.vh / 2 + 8;
      const shadow = this.add.image(x, y + 4, 'shadow').setScale(S * 1.4).setAlpha(0.35).setDepth(-20);
      const img = this.add.image(x, -40, `${ID}-chest`).setScale(S).setOrigin(0.5, 1);
      this.chest = { x, y: -40, t: 0, img, shadow, opened: false };
      const c = this.chest;
      Audio.sfx('whoosh');
      for (const [deg, yy] of [[0, this.vh * 0.62], [180, this.vh * 0.38]] as const) {
        const t = txt(this, this.vw / 2, yy, 'หีบสมบัติ!', { size: 22, color: '#ffe066', strokeWidth: 6 }).setAngle(deg).setDepth(3000);
        this.tweens.add({ targets: t, scale: { from: 0.4, to: 1 }, duration: 240, ease: 'Back.easeOut' });
        this.tweens.add({ targets: t, alpha: 0, delay: 900, duration: 300, onComplete: () => t.destroy() });
      }
      this.tweens.add({
        targets: c, y, duration: 500, ease: 'Quad.easeIn',
        onComplete: () => { Audio.sfx('land'); Audio.sfx('drum'); Vfx.shake(this, 0.006, 160); Vfx.dust(this, x - 16, y); Vfx.dust(this, x + 16, y); Vfx.squash(this, img, 1.3, 0.7, 200); },
      });
    }
    if (this.chest) {
      const c = this.chest;
      c.t += dt;
      if (!c.opened && c.t > 1.6) {
        c.opened = true;
        c.img.setTexture(`${ID}-chest-open`);
        Audio.sfx('explode', 1.3);
        Vfx.sparkle(this, c.x, c.y - 20, [0xffe066, 0xffffff, 0x3fe0e0]);
        Vfx.flash(this, 0xffe066, 90);
        for (let i = 0; i < 10; i++) this.scatter(i < 2 ? 'gem' : i === 2 && Math.random() < 0.5 ? 'ruby' : 'coin', c.x, c.y - 14, 1.3, 0.35);
      }
      if (c.t > 3.2) {
        const { img, shadow } = c;
        this.tweens.add({ targets: [img, shadow], alpha: 0, duration: 400, onComplete: () => { img.destroy(); shadow.destroy(); } });
        this.chest = undefined;
        this.chestT = 13 + Math.random() * 4;
      }
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    const bag = this.carry[b.p];
    const v = this.vaults.find((x) => x.p === b.p)!;
    const dHome = Math.hypot(v.x - b.x, v.y - b.y);
    const carried = bag.reduce((s, k) => s + VALUE[k], 0);
    b.data.think -= dt;
    const goHome = bag.length >= MAX_CARRY || bag.length >= b.data.greed || (carried > 0 && this.timeLeft < 3 + dHome / 110) || carried >= 8;
    if (goHome) {
      // Weave a little around threats on the way home.
      const threat = this.kit.alive.find((o) => o !== b && o.dashCd <= 0 && Math.hypot(o.x - b.x, o.y - b.y) < 70);
      let tx = v.x, ty = v.y;
      if (threat) { tx += (b.x - threat.x) * 0.6; ty += (b.y - threat.y) * 0.6; }
      b.botTarget = { x: tx, y: ty };
      return;
    }
    if (b.data.think <= 0) {
      b.data.think = 0.25 + Math.random() * 0.35;
      // Rob: a loaded rival nearby?
      let victim: ArenaBody | undefined;
      let best = 0;
      for (const o of this.kit.alive) {
        if (o === b || o.invuln > 0) continue;
        const val = this.carry[o.p].reduce((s, k) => s + VALUE[k], 0);
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        const want = (val * b.data.aggro * 40) / (d + 30);
        if (val >= 2 && d < 170 && want > best) { best = want; victim = o; }
      }
      b.data.mode = victim && best > 0.6 ? victim.p + 1 : 0;
      if (!b.data.mode) {
        let target: Loot | undefined;
        let score = -1;
        for (const l of this.loot) {
          if (!l.alive) continue;
          const d = Math.hypot(l.x - b.x, l.y - b.y);
          // Avoid loot a rival is clearly closer to.
          const rival = this.kit.alive.some((o) => o !== b && Math.hypot(l.x - o.x, l.y - o.y) < d * 0.5);
          const s = (VALUE[l.kind] + 0.6) / (d + 40) * (rival ? 0.5 : 1) * (0.85 + Math.random() * 0.3);
          if (s > score) { score = s; target = l; }
        }
        if (target) { b.data.tx = target.x; b.data.ty = target.y; }
        else { const s = this.randomSpot(); b.data.tx = s.x; b.data.ty = s.y; }
      }
    }
    if (b.data.mode) {
      const o = this.kit.body((b.data.mode - 1) as PlayerIndex);
      if (o && o.alive && this.carry[o.p].length) {
        // lead the target a little
        const tx = o.x + o.vx * 0.15, ty = o.y + o.vy * 0.15;
        b.botTarget = { x: tx, y: ty };
        const d = Math.hypot(tx - b.x, ty - b.y);
        if (d < 80 && b.dashCd <= 0 && Math.random() < 0.12) b.botDash = true;
        return;
      }
      b.data.mode = 0;
    }
    b.botTarget = { x: b.data.tx, y: b.data.ty };
  }

  shutdown(): void {
    this.kit?.destroy();
  }
}

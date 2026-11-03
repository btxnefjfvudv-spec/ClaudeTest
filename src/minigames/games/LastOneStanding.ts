import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture, rng } from '../../art/Painter';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx } from '../../systems/vfx/Vfx';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';
import { addWater, splash } from '../kit/water';

const TILE = 32;

interface Tile { gx: number; gy: number; img: Phaser.GameObjects.Image; state: 'ok' | 'warn' | 'gone'; d: number }

/** #6 — Sumo on a raft that breaks apart ring by ring. */
export default class LastOneStanding extends BaseMinigame {
  private kit!: ArenaKit;
  private tiles: Tile[] = [];
  private grid = new Map<string, Tile>();
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private shrinkT = 0;
  private water!: (dt: number) => void;

  constructor() {
    super(CATALOG['last-one-standing']);
  }

  setup(): void {
    this.tiles = [];
    this.grid.clear();
    this.cx = this.vw / 2;
    this.cy = this.vh / 2;
    this.water = addWater(this, this.vw, this.vh);
    this.paintTiles();
    // Floating ducks for life
    const duck = makeTexture(this, 'duck', 12, 10, (p) => {
      p.ball(6, 6, 5, 3.5, 0xffd84d);
      p.ball(9, 3, 2.6, 2.6, 0xffd84d);
      p.rect(11, 3, 2, 1, 0xff8a3d);
      p.px(9, 2, 0x1b1f3b);
      p.outline(-0.7);
    });
    for (let i = 0; i < 5; i++) {
      const x = Phaser.Math.Between(20, this.vw - 20), y = i % 2 ? 24 + i * 6 : this.vh - 30 - i * 6;
      const d = this.add.image(x, y, duck).setScale(S).setDepth(-60);
      this.tweens.add({ targets: d, y: y + 3, angle: 6, yoyo: true, repeat: -1, duration: 900 + i * 200, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: d, x: x + Phaser.Math.Between(-40, 40), yoyo: true, repeat: -1, duration: 5000 + i * 900, ease: 'Sine.easeInOut' });
    }
    const R = this.radius;
    this.kit = new ArenaKit(this, {
      speed: 140, accel: 700, dashSpeed: 330, dashCooldown: 1.1, radius: 13, bounce: 0.8,
      spawn: (p) => {
        const a = [-135, -45, 135, 45][p] * (Math.PI / 180);
        return { x: this.cx + Math.cos(a) * R * 0.5, y: this.cy + Math.sin(a) * R * 0.5 };
      },
    });
    this.kit.dashHit = 0.95;
    for (const b of this.kit.bodies) b.data.wait = 1.5 + Math.random() * 1.5;
    this.shrinkT = 6;
  }

  private paintTiles(): void {
    const r = rng(42);
    const variants = [0, 1, 2].map((v) =>
      makeTexture(this, `raft-${v}`, 16, 16, (p) => {
        const wood = [0xc98a4b, 0xb97a3e, 0xd49a58][v];
        p.box(0, 0, 16, 16, wood);
        for (let y = 4; y < 16; y += 5) p.hline(1, y, 14, shift(wood, -0.35));
        p.px(3, 2, shift(wood, -0.5)); p.px(12, 7, shift(wood, -0.5)); p.px(5, 12, shift(wood, -0.5));
        p.px(2 + v * 3, 9, shift(wood, 0.4));
      }),
    );
    const shadow = makeTexture(this, 'raft-shadow', 16, 16, (p) => p.rect(0, 0, 16, 16, 0x0b3c66));
    const maxR = Math.min(this.vh * 0.45, this.vw * 0.42);
    this.radius = maxR;
    const n = Math.ceil(maxR / TILE);
    for (let gy = -n; gy <= n; gy++) {
      for (let gx = -n; gx <= n; gx++) {
        const x = this.cx + gx * TILE, y = this.cy + gy * TILE;
        const d = Math.hypot(gx * TILE, gy * TILE);
        if (d > maxR) continue;
        this.add.image(x + 4, y + 6, shadow).setScale(S).setDepth(-55).setAlpha(0.35);
        const img = this.add.image(x, y, variants[Math.floor(r() * 3)]).setScale(S).setDepth(-50);
        const t: Tile = { gx, gy, img, state: 'ok', d };
        this.tiles.push(t);
        this.grid.set(`${gx},${gy}`, t);
      }
    }
    // rope ring
    const rope = makeTexture(this, 'rope', 4, 4, (p) => { p.rect(0, 0, 4, 4, 0xfff1c9); p.px(0, 0, 0xd9b77a); p.px(2, 2, 0xd9b77a); });
    for (let a = 0; a < Math.PI * 2; a += 0.06) {
      this.add.image(this.cx + Math.cos(a) * (maxR - 4), this.cy + Math.sin(a) * (maxR - 4), rope).setScale(S * 0.9).setDepth(-49).setData('rope', 1);
    }
  }

  private onPlatform(x: number, y: number): boolean {
    const gx = Math.round((x - this.cx) / TILE), gy = Math.round((y - this.cy) / TILE);
    const t = this.grid.get(`${gx},${gy}`);
    return !!t && t.state !== 'gone';
  }

  private shrink(): void {
    this.radius -= TILE;
    const doomed = this.tiles.filter((t) => t.state === 'ok' && t.d > this.radius);
    if (!doomed.length) return;
    // remove rope pieces outside
    this.children.list.filter((o) => o.getData('rope')).forEach((o) => (o as Phaser.GameObjects.Image).destroy());
    Audio.sfx('stun');
    for (const t of doomed) {
      t.state = 'warn';
      this.tweens.add({ targets: t.img, x: t.img.x + 1.5, yoyo: true, repeat: 7, duration: 60 });
      t.img.setTint(0xffb0a0);
    }
    this.time.delayedCall(1100, () => {
      Audio.sfx('splash');
      for (const t of doomed) {
        t.state = 'gone';
        this.tweens.add({ targets: t.img, scale: S * 0.6, alpha: 0, y: t.img.y + 10, angle: Phaser.Math.Between(-30, 30), duration: 500, ease: 'Quad.easeIn' });
        if (Math.random() < 0.25) splash(this, t.img.x, t.img.y);
      }
    });
  }

  private dropTile(t: Tile): void {
    t.state = 'warn';
    t.img.setTint(0xffb0a0);
    this.tweens.add({ targets: t.img, x: t.img.x + 1.5, yoyo: true, repeat: 7, duration: 60 });
    this.time.delayedCall(1000, () => {
      t.state = 'gone';
      Audio.sfx('splash');
      splash(this, t.img.x, t.img.y);
      this.tweens.add({ targets: t.img, scale: S * 0.6, alpha: 0, y: t.img.y + 10, duration: 450, ease: 'Quad.easeIn' });
    });
  }

  private fall(b: ArenaBody): void {
    this.kit.kill(b);
    const s = b.avatar.sprite;
    b.avatar.play('fall');
    b.avatar.marker?.setVisible(false);
    b.avatar.ring?.setVisible(false);
    b.avatar.shadow?.setVisible(false);
    this.tweens.add({ targets: s, scale: S * 0.4, y: s.y + 26, alpha: 0, angle: 180, duration: 600, ease: 'Quad.easeIn', onComplete: () => splash(this, b.x, b.y) });
    Vfx.shake(this, 0.006, 200);
    if (b.lastHitBy !== undefined && b.lastHitBy !== b.p) {
      this.addScore(b.lastHitBy, 1);
      Vfx.popText(this, b.x, b.y - 40, 'ตกน้ำ!', '#bfeaff', 18, this.angleFor(b.p));
    }
    this.eliminate(b.p);
  }

  ambient(dt: number): void {
    this.water(dt);
    this.kit.update(dt, this.state === 'play');
  }

  tick(dt: number): void {
    this.shrinkT -= dt;
    if (this.shrinkT <= 0) {
      if (this.radius > TILE * 1.5) {
        this.shrink();
        this.shrinkT = Math.max(3.5, 6 - this.elapsed * 0.05);
      } else {
        // Sudden death: random tiles of what's left start dropping.
        const left = this.tiles.filter((t) => t.state === 'ok');
        if (left.length) this.dropTile(left[Math.floor(Math.random() * left.length)]);
        this.shrinkT = 1.6;
      }
    }
    for (const b of this.kit.alive) {
      if (!this.onPlatform(b.x, b.y)) this.fall(b);
      else if (this.isCpu(b.p)) this.bot(b);
    }
  }

  private bot(b: ArenaBody): void {
    const others = this.kit.alive.filter((o) => o !== b);
    if (!others.length) return;
    const dist = (o: ArenaBody) => Math.hypot(o.x - b.x, o.y - b.y);
    const near = others.reduce((m, o) => (dist(o) < dist(m) ? o : m));
    const dc = Math.hypot(b.x - this.cx, b.y - this.cy);
    const margin = this.radius - dc;
    // Edge danger: walk back toward the middle.
    if (margin < Math.min(56, this.radius * 0.3)) {
      b.botTarget = { x: this.cx, y: this.cy };
      return;
    }
    // Approach from the centre side so a hit pushes them outward.
    const ox = near.x - this.cx, oy = near.y - this.cy;
    const ol = Math.hypot(ox, oy) || 1;
    const behind = { x: near.x - (ox / ol) * 30, y: near.y - (oy / ol) * 30 };
    const lined = Math.hypot(behind.x - b.x, behind.y - b.y) < 26;
    b.botTarget = lined ? { x: near.x, y: near.y } : behind;
    b.data.wait -= 1 / 60;
    if (lined && dist(near) < 70 && margin > Math.min(90, this.radius * 0.45) && b.dashCd <= 0 && b.data.wait <= 0) {
      b.botDash = true;
      b.data.wait = 1.2 + Math.random() * 1.4;
    }
  }

  shutdown(): void {
    this.kit?.destroy();
  }
}


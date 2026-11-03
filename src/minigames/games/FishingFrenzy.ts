import Phaser from 'phaser';
import { S } from '../../art/common';
import { makeSheet, makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Avatar } from '../../systems/players/Avatar';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

/** Water surface in panel-local y. */
const SURF = -40;
const BITE_WINDOW = 0.6;
const BAR_H = 144;

type State = 'ready' | 'cast' | 'wait' | 'bite' | 'reel' | 'catch' | 'fail';

interface FishType {
  key: string;
  name: string;
  value: number;
  zone: number; // green zone size (fraction of bar)
  speed: number; // how fast it darts
  jumpy: number; // chance per second to make a big dart
  gain: number; // progress per second inside
  color: string;
}

const FISH: FishType[] = [
  { key: 'fishing-f0', name: 'ปลาซิว', value: 10, zone: 0.34, speed: 0.55, jumpy: 0.5, gain: 0.5, color: '#bfe3ff' },
  { key: 'fishing-f1', name: 'ปลาคาร์ป', value: 20, zone: 0.3, speed: 0.8, jumpy: 0.8, gain: 0.44, color: '#ffc29a' },
  { key: 'fishing-f2', name: 'ปลาทอง!', value: 50, zone: 0.26, speed: 1.1, jumpy: 1.2, gain: 0.4, color: '#ffe066' },
  { key: 'fishing-f3', name: 'ปลาตำนาน!!', value: 120, zone: 0.22, speed: 1.45, jumpy: 1.7, gain: 0.34, color: '#e6b3ff' },
  { key: 'fishing-boot', name: 'รองเท้าบู๊ต...', value: 2, zone: 0.4, speed: 0.15, jumpy: 0.1, gain: 0.7, color: '#c7c9d6' },
];

interface Angler {
  p: PlayerIndex;
  pn: Panel;
  av: Avatar;
  rod: Phaser.GameObjects.Image;
  line: Phaser.GameObjects.Graphics;
  bobber: Phaser.GameObjects.Sprite;
  aim: Phaser.GameObjects.Image;
  aimArrow: Phaser.GameObjects.Image;
  hint: Phaser.GameObjects.Text;
  bang: Phaser.GameObjects.Text;
  shadow: Phaser.GameObjects.Image;
  hooked: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Container;
  zoneImg: Phaser.GameObjects.Image;
  fishIcon: Phaser.GameObjects.Image;
  prog: Phaser.GameObjects.Rectangle;
  bucket: Phaser.GameObjects.Image;
  log: Phaser.GameObjects.Image[];
  state: State;
  t: number; // time in state
  power: number;
  powerDir: number;
  castX: number;
  waitT: number;
  nibbles: number[];
  fish: FishType;
  zoneY: number; // 0..1 bottom of zone
  zoneV: number;
  fishY: number;
  fishTarget: number;
  progress: number;
  reelClick: number;
  catches: number;
  // cpu
  cpuWant: number;
  cpuReact: number;
  cpuHold: boolean;
  cpuThink: number;
  cpuSkill: number;
}

/** #46 — Cast, wait for the bite, hook it in time, then win the reel tug. */
export default class FishingFrenzy extends BaseMinigame {
  private panels!: PanelKit;
  private anglers: Angler[] = [];
  private amb: { img: Phaser.GameObjects.Image; p: PlayerIndex; x: number; y: number; s: number; ph: number; dir: number; range: number }[] = [];
  private clouds: { ts: Phaser.GameObjects.TileSprite; k: number }[] = [];
  private shimmer: Phaser.GameObjects.TileSprite[] = [];
  private t = 0;

  constructor() {
    super(CATALOG['fishing-frenzy']);
  }

  setup(): void {
    this.anglers = [];
    this.amb = [];
    this.clouds = [];
    this.shimmer = [];
    this.t = 0;
    this.panels = new PanelKit(this, { frame: true, inset: 3 });
    this.paintArt();
    for (const pn of this.panels.panels) this.buildPond(pn);
    this.panels.onDown((p) => this.tap(p));
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    const pn = this.panels.panels[0];
    const aw = Math.ceil(pn.w / S), ah = Math.ceil(pn.h / S);
    const surf = Math.round(ah / 2 + SURF / S);
    makeTexture(this, `fishing-bg-${aw}x${ah}`, aw, ah, (p) => {
      // sky
      p.gradient(0, 0, aw, surf, [0x7fd0ff, 0xb6e6ff, 0xffe9c9]);
      p.ball(aw - 30, 12, 7, 7, 0xfff1a8, false);
      p.circle(aw - 30, 12, 5, 0xffffff);
      // far hills + trees
      const r = rng(31);
      for (let x = 0; x < aw; x++) {
        const h = 7 + Math.sin(x * 0.07) * 3 + Math.sin(x * 0.19 + 1) * 1.5;
        p.vline(x, surf - h, h, 0x8fc98a);
      }
      for (let i = 0; i < 16; i++) {
        const tx = r() * aw, ty = surf - 6 - r() * 4;
        p.ball(tx, ty, 4 + r() * 3, 5 + r() * 2, i % 2 ? 0x4f9e5a : 0x5fb06a, false);
      }
      p.hline(0, surf - 1, aw, 0x6aa86e);
      // water
      p.gradient(0, surf, aw, ah - surf, [0x4cb8e8, 0x2c8cc8, 0x1d5f9e, 0x163f72]);
      p.hline(0, surf, aw, 0xc9f1ff);
      p.hline(0, surf + 1, aw, 0x8fdcff);
      // sloping sandy bottom (deeper further from the pier)
      for (let x = 0; x < aw; x++) {
        const by = Math.round(ah - 26 + 22 * (1 - x / aw) * (1 - x / aw) - 12 * (1 - x / aw) + 10);
        for (let y = by; y < ah; y++) p.px(x, y, y === by ? 0xd9c08a : (x + y) % 5 === 0 ? 0xa88a5a : 0xbfa06a);
      }
      // rocks & weeds
      for (let i = 0; i < 7; i++) {
        const x = 30 + r() * (aw - 40), y = ah - 6 - r() * 6;
        p.ball(x, y, 3 + r() * 3, 2 + r() * 2, 0x6b6f8a, false);
      }
      // light rays
      for (let i = 0; i < 4; i++) {
        const x0 = 40 + i * 34;
        for (let y = surf + 2; y < ah - 10; y++) p.px(x0 + (y - surf) * 0.35, y, 0xbfe9ff, 26);
      }
    });
    makeTexture(this, 'fishing-cloud', 80, 22, (p) => {
      p.ball(20, 12, 12, 6, 0xffffff, false); p.ball(30, 9, 9, 6, 0xffffff, false); p.hline(9, 16, 26, 0xdbe9f7);
      p.ball(62, 14, 9, 4, 0xffffff, false); p.ball(68, 11, 6, 4, 0xffffff, false); p.hline(54, 17, 18, 0xdbe9f7);
    });
    makeTexture(this, 'fishing-shimmer', 48, 6, (p) => {
      const r = rng(4);
      for (let i = 0; i < 7; i++) p.hline(Math.floor(r() * 44), Math.floor(r() * 6), 3 + Math.floor(r() * 3), 0xe6f8ff, 200);
    });
    // pier: deck + posts
    makeTexture(this, 'fishing-pier', 46, 46, (p) => {
      for (const x of [3, 20, 37]) {
        p.rect(x, 4, 5, 42, 0x8a5a32);
        p.vline(x, 4, 42, 0xa8703e);
        p.rect(x, 20, 5, 26, 0x4a4a6a, 120);
      }
      p.box(0, 0, 46, 6, 0xc98a4b);
      for (let x = 0; x < 46; x += 7) p.vline(x, 0, 6, 0x9a6232);
      p.hline(0, 6, 46, 0x6a3e22);
      p.outline(-0.6);
    });
    makeTexture(this, 'fishing-bucket', 12, 11, (p) => {
      p.rect(1, 2, 10, 9, 0x8a97bf);
      p.vline(1, 2, 9, 0xc7c9d6); p.vline(10, 2, 9, 0x56618a);
      p.hline(0, 1, 12, 0xc7c9d6);
      p.rect(2, 2, 8, 2, 0x2c8cc8);
      p.hline(3, 6, 6, 0x56618a);
      p.outline(-0.6);
    });
    makeTexture(this, 'fishing-rod', 34, 30, (p) => {
      p.line(3, 27, 32, 1, 0x8a5a32);
      p.line(4, 27, 32, 2, 0xc98a4b);
      p.rect(1, 25, 4, 4, 0x3b4466);
      p.ball(6, 24, 2.2, 2.2, 0xc7c9d6);
      p.px(32, 1, 0xff5a6e);
    });
    makeTexture(this, 'fishing-rod-bent', 34, 30, (p) => {
      let px = 3, py = 27;
      for (let i = 1; i <= 24; i++) {
        const k = i / 24;
        const x = 3 + 29 * k, y = 27 - 26 * Math.sin(k * 1.3) + 10 * k * k;
        p.line(px, py, x, y, 0x8a5a32);
        p.px(x, y + 1, 0xc98a4b);
        px = x; py = y;
      }
      p.rect(1, 25, 4, 4, 0x3b4466);
      p.ball(6, 24, 2.2, 2.2, 0xc7c9d6);
    });
    makeSheet(this, 'fishing-bobber', 8, 11, 3, (p, i) => {
      const dy = i === 2 ? 4 : 0;
      p.vline(4, 0 + dy, 3, 0x1b1f3b);
      p.ball(4, 5 + dy, 3.5, 3, 0xff5a6e);
      p.rect(0, 6 + dy, 8, 3, 0xffffff);
      p.ellipse(4, 7 + dy, 3.5, 1.5, 0xf0f0f0);
      if (i === 1) p.px(4, 0, 0xffe066);
      p.outline(-0.6);
      if (i === 2) for (let y = 7; y < 11; y++) p.hline(0, y, 8, 0x2c8cc8, 0);
    });
    makeTexture(this, 'fishing-aim', 15, 6, (p) => {
      p.ellipse(7.5, 3, 7.5, 3, 0xffffff);
      p.ellipse(7.5, 3, 5.5, 1.8, 0x000000, 0);
      for (let y = 0; y < 6; y++) for (let x = 0; x < 15; x++) {
        const nx = (x + 0.5 - 7.5) / 5.6, ny = (y + 0.5 - 3) / 1.9;
        if (nx * nx + ny * ny < 1) p.clear(x, y);
      }
    });
    makeTexture(this, 'fishing-arrow', 7, 6, (p) => {
      p.tri(0, 0, 7, 0, 3.5, 5, 0xffe066);
      p.outline(-0.7);
    });
    makeTexture(this, 'fishing-shadow', 16, 7, (p) => {
      p.ellipse(7, 3.5, 6, 3, 0x0d2f5a);
      p.tri(11, 3.5, 16, 0, 16, 7, 0x0d2f5a);
    });
    makeTexture(this, 'fishing-shadowbig', 30, 12, (p) => {
      p.ellipse(12, 6, 11, 5, 0x0a2448);
      p.tri(20, 6, 30, 0, 30, 12, 0x0a2448);
    });
    // fish
    const fish = (p: Painter, w: number, h: number, body: number, belly: number, fin: number, extra?: (p: Painter) => void) => {
      const cx = w * 0.42, cy = h / 2;
      p.tri(w * 0.72, cy, w, 0, w, h - 1, fin);
      p.ball(cx, cy, w * 0.4, h * 0.42, body);
      p.ellipse(cx + 1, cy + h * 0.2, w * 0.28, h * 0.14, belly);
      p.tri(cx - 2, 1, cx + 4, 1, cx + 3, cy - 1, fin);
      p.px(Math.round(w * 0.16), Math.round(cy - 1), 0xffffff);
      p.px(Math.round(w * 0.16), Math.round(cy), 0x1b1f3b);
      extra?.(p);
      p.outline(-0.7);
    };
    makeTexture(this, 'fishing-f0', 14, 8, (p) => fish(p, 14, 8, 0x8fb8d8, 0xdff2ff, 0x5a86b0));
    makeTexture(this, 'fishing-f1', 17, 10, (p) => fish(p, 17, 10, 0xff8a4a, 0xffe0c0, 0xe0603a, (g) => { g.px(6, 3, 0xffffff); g.px(9, 4, 0xffd0a0); }));
    makeTexture(this, 'fishing-f2', 18, 11, (p) => fish(p, 18, 11, 0xffc93d, 0xfff1a8, 0xff9f43, (g) => { g.px(7, 3, 0xffffff); g.px(8, 3, 0xffffff); g.px(10, 6, 0xfff8e7); }));
    makeTexture(this, 'fishing-f3', 26, 14, (p) => fish(p, 26, 14, 0x9a5ae0, 0xffb3f0, 0x3fe0e0, (g) => {
      for (let i = 0; i < 4; i++) g.vline(8 + i * 3, 4, 6, [0xff7a85, 0xffe066, 0x7ee8b0, 0x6ec6ff][i]);
      g.px(9, 3, 0xffffff); g.px(10, 3, 0xffffff);
    }));
    makeTexture(this, 'fishing-boot', 13, 13, (p) => {
      p.rect(2, 0, 6, 9, 0x8a5a32);
      p.vline(2, 0, 9, 0xa8703e);
      p.rect(2, 8, 10, 4, 0x6a3e22);
      p.hline(1, 12, 12, 0x3b2a1e);
      p.px(5, 3, 0xd9c08a); p.px(5, 5, 0xd9c08a);
      p.px(10, 0, 0x7ee8b0); p.px(11, 1, 0x5fb06a);
      p.outline(-0.6);
    });
    // reel bar UI
    makeTexture(this, 'fishing-bar', 14, BAR_H / S + 8, (p) => {
      const h = BAR_H / S + 8;
      p.box(0, 0, 14, h, 0xc98a4b, 1);
      p.rect(2, 3, 10, h - 6, 0x163f72);
      p.dither(2, 3, 10, h - 6, 0x163f72, 0x1d5f9e, 0.3);
      p.rect(5, 0, 4, 2, 0x8a5a32);
      p.outline(-0.6);
    });
    for (const f of FISH) {
      const zh = Math.round((f.zone * BAR_H) / S);
      makeTexture(this, `fishing-zone-${zh}`, 10, zh, (p) => {
        p.rect(0, 0, 10, zh, 0x5fe08a);
        p.hline(0, 0, 10, 0xc9ffd8); p.hline(0, zh - 1, 10, 0x2fa05a);
        p.vline(0, 0, zh, 0xa6f0c4); p.vline(9, 0, zh, 0x3ed17a);
        p.dither(1, 1, 8, zh - 2, 0x5fe08a, 0x7ee8b0, 0.3);
      });
    }
    makeSheet(this, 'fishing-reed', 8, 22, 3, (p, i) => {
      const lean = [-1, 0, 1][i];
      for (let k = 0; k < 3; k++) {
        const bx = 1 + k * 3;
        for (let y = 0; y < 22; y++) {
          const x = bx + Math.round(lean * (1 - y / 22) * 2);
          if (y > 2 + k * 3) p.px(x, y, y > 16 ? 0x3f8a4a : 0x5fb06a);
        }
        p.rect(bx + Math.round(lean * 2) - (k === 1 ? 0 : 0), 2 + k * 3, 2, 5, 0x8a5a32);
      }
    });
    if (!this.anims.exists('fishing-reed-sway')) {
      this.anims.create({ key: 'fishing-reed-sway', frames: [0, 1, 2, 1].map((f) => ({ key: 'fishing-reed', frame: f })), frameRate: 3, repeat: -1 });
    }
    makeTexture(this, 'fishing-lily', 12, 5, (p) => {
      p.ellipse(6, 2.5, 6, 2.5, 0x5fb06a);
      p.tri(6, 2.5, 9, 0, 12, 1, 0x000000);
      for (let y = 0; y < 3; y++) for (let x = 7; x < 12; x++) if (y < (x - 6) * 0.6) p.clear(x, y);
      p.px(3, 1, 0xa6f0c4);
      p.px(4, 1, 0xffb3d0); p.px(4, 0, 0xffffff);
      p.outline(-0.6);
    });
  }

  private buildPond(pn: Panel): void {
    const p = pn.p;
    const c = pn.c;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { c.add(o); return o; };
    const aw = Math.ceil(pn.w / S), ah = Math.ceil(pn.h / S);
    add(this.add.image(0, 0, `fishing-bg-${aw}x${ah}`).setScale(S));
    const cl = add(this.add.tileSprite(0, -pn.h / 2 + 4, pn.w / S, 22, 'fishing-cloud').setOrigin(0.5, 0).setScale(S).setAlpha(0.95));
    this.clouds.push({ ts: cl, k: 3 + p * 0.7 });
    const sh = add(this.add.tileSprite(0, SURF + 2, pn.w / S, 6, 'fishing-shimmer').setOrigin(0.5, 0).setScale(S).setAlpha(0.8));
    this.shimmer.push(sh);
    // ambient fish silhouettes
    const r = rng(100 + p);
    for (let i = 0; i < 5; i++) {
      const big = i === 0;
      const y = big ? 70 : SURF + 30 + r() * 70;
      const img = add(this.add.image(0, y, big ? 'fishing-shadowbig' : 'fishing-shadow').setScale(S).setAlpha(big ? 0.5 : 0.35));
      this.amb.push({ img, p, x: -40 + r() * 160, y, s: (big ? 14 : 18 + r() * 18), ph: r() * 6, dir: r() < 0.5 ? 1 : -1, range: big ? 70 : 60 + r() * 50 });
    }
    // lily pads & reeds
    for (const [x, y] of [[pn.w / 2 - 40, SURF + 1], [pn.w / 2 - 66, SURF + 3], [10, SURF + 2]] as const) add(this.add.image(x, y, 'fishing-lily').setScale(S));
    for (const x of [pn.w / 2 - 14, pn.w / 2 - 26]) {
      const reed = add(this.add.sprite(x, SURF + 6, 'fishing-reed', 0).setOrigin(0.5, 1).setScale(S));
      reed.play({ key: 'fishing-reed-sway', startFrame: Math.floor(r() * 3) });
    }
    // pier + angler
    const pierX = -pn.w / 2 + 46;
    add(this.add.image(pierX, SURF - 12, 'fishing-pier').setOrigin(0.5, 0).setScale(S));
    const bucket = add(this.add.image(pierX - 34, SURF - 12, 'fishing-bucket').setOrigin(0.5, 1).setScale(S));
    const av = new Avatar(this, p, 0, 0, { depthSort: false, shadow: false, marker: false });
    c.add(av.sprite);
    av.sprite.setPosition(pierX + 2, SURF - 11);
    av.face(1);
    const rod = add(this.add.image(pierX + 10, SURF - 38, 'fishing-rod').setOrigin(0.08, 0.92).setScale(S));
    const line = add(this.add.graphics());
    const shadow = add(this.add.image(0, SURF + 24, 'fishing-shadow').setScale(S).setAlpha(0).setFlipX(true));
    const hooked = add(this.add.image(0, SURF + 30, FISH[0].key).setScale(S).setVisible(false));
    const bobber = add(this.add.sprite(0, SURF, 'fishing-bobber', 0).setOrigin(0.5, 0.75).setScale(S).setVisible(false));
    const aim = add(this.add.image(0, SURF + 2, 'fishing-aim').setScale(S).setTint(PLAYER_COLORS[p].light));
    const aimArrow = add(this.add.image(0, SURF - 16, 'fishing-arrow').setScale(S));
    const hint = add(txt(this, 40, SURF - 46, 'แตะ = เหวี่ยงเบ็ด!', { size: 13, color: '#ffffff', strokeWidth: 4 }));
    const bang = add(txt(this, 0, SURF - 40, '!', { size: 34, color: '#ff4d6d', strokeWidth: 6 }).setVisible(false));
    // reel bar (right side)
    const bar = add(this.add.container(pn.w / 2 - 34, -8).setVisible(false));
    bar.add(this.add.image(0, 0, 'fishing-bar').setScale(S));
    const zoneImg = this.add.image(0, 0, `fishing-zone-${Math.round((FISH[0].zone * BAR_H) / S)}`).setOrigin(0.5, 1).setScale(S);
    const fishIcon = this.add.image(0, 0, 'fishing-f0').setScale(S * 0.8);
    const progBg = this.add.rectangle(-22, BAR_H / 2, 8, BAR_H, 0x1b1f3b, 0.85).setOrigin(0.5, 1).setStrokeStyle(2, 0x1b1f3b);
    const prog = this.add.rectangle(-22, BAR_H / 2, 6, BAR_H, 0x7ee8b0).setOrigin(0.5, 1);
    bar.add([zoneImg, fishIcon, progBg, prog]);
    const a: Angler = {
      p, pn, av, rod, line, bobber, aim, aimArrow, hint, bang, shadow, hooked, bar, zoneImg, fishIcon, prog, bucket, log: [],
      state: 'ready', t: 0, power: Math.random(), powerDir: 1, castX: 0, waitT: 0, nibbles: [], fish: FISH[0],
      zoneY: 0, zoneV: 0, fishY: 0.5, fishTarget: 0.5, progress: 0, reelClick: 0, catches: 0,
      cpuWant: 0.7, cpuReact: 0.3, cpuHold: false, cpuThink: 0, cpuSkill: 0.6 + Math.random() * 0.35,
    };
    if (!this.players.includes(p)) { hint.setVisible(false); aim.setVisible(false); aimArrow.setVisible(false); }
    this.anglers.push(a);
    this.enter(a, 'ready');
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private castRange(a: Angler): [number, number] {
    return [-a.pn.w / 2 + 120, a.pn.w / 2 - 56];
  }

  private rodTip(a: Angler): { x: number; y: number } {
    const bent = a.rod.texture.key === 'fishing-rod-bent';
    const ox = a.rod.x - 0.08 * 34 * S, oy = a.rod.y - 0.92 * 30 * S;
    return bent ? { x: ox + 31 * S, y: oy + 9 * S } : { x: ox + 32 * S, y: oy + 1 * S };
  }

  /** Particle burst inside a player's panel (local coords, so it reads right for every seat). */
  private lburst(a: Angler, x: number, y: number, tint: number[], count = 10, gravity = 300, speed: [number, number] = [40, 140], angle: [number, number] = [200, 340]): void {
    const em = this.add.particles(x, y, 'dot2', {
      speed: { min: speed[0], max: speed[1] }, angle: { min: angle[0], max: angle[1] }, gravityY: gravity,
      lifespan: { min: 300, max: 600 }, scale: { start: S, end: 0 }, tint, emitting: false,
    });
    a.pn.c.add(em);
    em.explode(count);
    this.time.delayedCall(700, () => em.destroy());
  }

  private ltext(a: Angler, x: number, y: number, s: string, color: string, size = 18, hold = 600): void {
    const t = txt(this, x, y, s, { size, color, strokeWidth: 5 });
    a.pn.c.add(t);
    t.setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, delay: hold, duration: 400, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
  }

  private ripple(a: Angler, x: number, big = false): void {
    const ring = this.add.image(x, SURF + 2, 'ring').setScale(0.4, 0.15).setTint(0xdff6ff);
    a.pn.c.add(ring);
    this.tweens.add({ targets: ring, scaleX: big ? 2.6 : 1.6, scaleY: big ? 0.8 : 0.5, alpha: 0, duration: big ? 700 : 500, onComplete: () => ring.destroy() });
  }

  private enter(a: Angler, s: State): void {
    a.state = s;
    a.t = 0;
    const playing = this.players.includes(a.p);
    a.hint.setVisible(s === 'ready' && playing);
    a.aim.setVisible(s === 'ready' && playing);
    a.aimArrow.setVisible(s === 'ready' && playing);
    a.bang.setVisible(false);
    a.bar.setVisible(s === 'reel');
    a.rod.setTexture(s === 'reel' ? 'fishing-rod-bent' : 'fishing-rod');
    if (s === 'ready') {
      a.bobber.setVisible(false);
      a.hooked.setVisible(false);
      a.shadow.setAlpha(0);
      a.av.play('idle');
      a.cpuWant = 0.45 + Math.random() * 0.55 * a.cpuSkill + 0.1;
      a.cpuThink = 0.25 + Math.random() * 0.5;
    }
    if (s === 'wait') {
      a.waitT = 1.1 + Math.random() * 2.4;
      a.nibbles = [];
      const n = Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) a.nibbles.push(0.3 + Math.random() * (a.waitT - 0.6));
      a.shadow.setPosition(a.castX + 70, SURF + 34).setAlpha(0);
    }
    if (s === 'bite') {
      a.cpuReact = 0.2 + Math.random() * (0.25 + (1 - a.cpuSkill) * 0.5);
    }
  }

  private pickFish(a: Angler): FishType {
    const [x0, x1] = this.castRange(a);
    const d = Phaser.Math.Clamp((a.castX - x0) / (x1 - x0), 0, 1);
    const w = [0.42 - 0.22 * d, 0.27, 0.1 + 0.14 * d, 0.025 + 0.075 * d, 0.16 - 0.08 * d];
    let r = Math.random() * w.reduce((s, v) => s + v, 0);
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return FISH[i]; }
    return FISH[0];
  }

  // ───────────────────────────── input ─────────────────────────────

  private tap(p: PlayerIndex): void {
    const a = this.anglers.find((x) => x.p === p);
    if (!a || this.isCpu(p)) return;
    this.press(a);
  }

  private press(a: Angler): void {
    if (this.state !== 'play') return;
    if (a.state === 'ready') this.cast(a);
    else if (a.state === 'wait') this.tooEarly(a);
    else if (a.state === 'bite') this.hook(a);
  }

  private cast(a: Angler): void {
    const [x0, x1] = this.castRange(a);
    a.castX = x0 + (x1 - x0) * a.power;
    this.enter(a, 'cast');
    a.av.play('attack', true);
    a.bobber.setVisible(true).setFrame(0);
    Audio.sfx('throw', 1 + a.p * 0.1);
  }

  private tooEarly(a: Angler): void {
    this.ltext(a, a.castX, SURF - 30, 'เร็วไป! ปลาหนี', '#ffb3bd', 15);
    Audio.sfx('wrong', 1);
    a.av.play('lose', true);
    this.ripple(a, a.castX + 20, true);
    if (a.shadow.alpha > 0) this.tweens.add({ targets: a.shadow, x: a.shadow.x + 120, alpha: 0, duration: 400 });
    this.enter(a, 'fail');
  }

  private hook(a: Angler): void {
    a.fish = this.pickFish(a);
    this.enter(a, 'reel');
    a.zoneY = 0.35;
    a.zoneV = 0;
    a.fishY = 0.5;
    a.fishTarget = 0.5;
    a.progress = 0.3;
    const zh = Math.round((a.fish.zone * BAR_H) / S);
    a.zoneImg.setTexture(`fishing-zone-${zh}`);
    a.fishIcon.setTexture(a.fish.key);
    a.hooked.setTexture(a.fish.key).setVisible(true).setPosition(a.castX, SURF + 30).setFlipX(true);
    a.av.play('hit', true);
    Audio.sfx('right', 1 + a.p * 0.1);
    Audio.sfx('splash', 1);
    this.ripple(a, a.castX, true);
    this.lburst(a, a.castX, SURF, [0xffffff, 0xbfeaff, 0x6cc8f4], 12, 400);
    this.ltext(a, a.castX, SURF - 34, 'ติดเบ็ด!', '#7ee8b0', 18, 350);
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    for (const cl of this.clouds) cl.ts.tilePositionX += cl.k * dt;
    for (const s of this.shimmer) { s.tilePositionX -= 5 * dt; s.setAlpha(0.6 + Math.sin(this.t * 2) * 0.25); }
    for (const f of this.amb) {
      const x = f.x + Math.sin(this.t * (f.s / f.range) + f.ph) * f.range;
      const vx = Math.cos(this.t * (f.s / f.range) + f.ph);
      f.img.setPosition(x, f.y + Math.sin(this.t * 1.3 + f.ph) * 3).setFlipX(vx > 0);
    }
    for (const a of this.anglers) {
      if (a.state === 'ready' && this.players.includes(a.p)) {
        // sweeping cast target
        a.power += a.powerDir * dt * 0.9;
        if (a.power > 1) { a.power = 1; a.powerDir = -1; }
        if (a.power < 0) { a.power = 0; a.powerDir = 1; }
        const [x0, x1] = this.castRange(a);
        const x = x0 + (x1 - x0) * a.power;
        a.aim.setX(x).setAlpha(0.6 + Math.sin(this.t * 10) * 0.3);
        a.aimArrow.setPosition(x, SURF - 14 + Math.sin(this.t * 8) * 3);
        a.hint.setAlpha(this.state === 'play' ? 0.75 + Math.sin(this.t * 5) * 0.25 : 0.9);
      }
      this.drawLine(a);
    }
  }

  tick(dt: number): void {
    for (const a of this.anglers) {
      if (!this.players.includes(a.p)) continue;
      a.t += dt;
      if (this.isCpu(a.p)) this.bot(a, dt);
      this.stepAngler(a, dt);
    }
  }

  private stepAngler(a: Angler, dt: number): void {
    switch (a.state) {
      case 'cast': {
        const dur = 0.5;
        const k = Math.min(1, a.t / dur);
        const tip = this.rodTip(a);
        const x = Phaser.Math.Linear(tip.x, a.castX, k);
        const y = Phaser.Math.Linear(tip.y, SURF, k) - Math.sin(k * Math.PI) * 50;
        a.bobber.setPosition(x, y);
        if (k >= 1) {
          Audio.sfx('splash', 1.2 + a.p * 0.05);
          this.ripple(a, a.castX);
          this.lburst(a, a.castX, SURF, [0xffffff, 0xbfeaff], 6, 300, [30, 90]);
          a.av.play('idle');
          this.enter(a, 'wait');
        }
        break;
      }
      case 'wait': {
        let dip = Math.sin(this.t * 3 + a.p) * 1.5;
        for (const n of a.nibbles) {
          const d = a.t - n;
          if (d > 0 && d < 0.18) {
            dip += 4;
            if (d < dt * 1.5) { Audio.sfx('tick', 0.8); this.ripple(a, a.castX); }
          }
        }
        a.bobber.setPosition(a.castX, SURF + dip).setFrame(0);
        // a fish shadow sneaks up in the last second
        const left = a.waitT - a.t;
        if (left < 1.2) {
          const k = 1 - Math.max(0, left) / 1.2;
          a.shadow.setPosition(a.castX + 70 * (1 - k) + 4, SURF + 34 - 14 * k).setAlpha(0.5 * k);
        }
        if (a.t >= a.waitT) {
          this.enter(a, 'bite');
          Audio.sfx('pop', 1.4);
          Audio.sfx('splash', 1.6);
          this.ripple(a, a.castX, true);
          this.lburst(a, a.castX, SURF, [0xffffff, 0xbfeaff], 8, 350, [40, 110]);
          a.bang.setVisible(true).setPosition(a.castX, SURF - 40).setScale(0.3);
          this.tweens.add({ targets: a.bang, scale: 1.2, duration: 120, ease: 'Back.easeOut' });
        }
        break;
      }
      case 'bite': {
        a.bobber.setPosition(a.castX + Math.sin(a.t * 60) * 1.5, SURF + 4).setFrame(2);
        a.bang.setAngle(Math.sin(a.t * 40) * 8);
        a.shadow.setPosition(a.castX + 4, SURF + 20).setAlpha(0.6);
        if (a.t > BITE_WINDOW) {
          this.ltext(a, a.castX, SURF - 30, 'หลุดแล้ว!', '#ffb3bd', 16);
          Audio.sfx('wrong', 1.1);
          a.av.play('lose', true);
          this.tweens.add({ targets: a.shadow, x: a.shadow.x + 140, alpha: 0, duration: 500 });
          this.enter(a, 'fail');
        }
        break;
      }
      case 'reel':
        this.stepReel(a, dt);
        break;
      case 'catch':
        if (a.t > 1.1) this.enter(a, 'ready');
        break;
      case 'fail': {
        // reel the empty line back in
        const tip = this.rodTip(a);
        const k = Math.min(1, a.t / 0.5);
        a.bobber.setPosition(Phaser.Math.Linear(a.castX, tip.x, k), Phaser.Math.Linear(SURF, tip.y, k) - Math.sin(k * Math.PI) * 14).setFrame(0);
        if (a.t > 0.75) this.enter(a, 'ready');
        break;
      }
      default:
        break;
    }
  }

  private stepReel(a: Angler, dt: number): void {
    const f = a.fish;
    const hold = this.isCpu(a.p) ? a.cpuHold : this.touch.isHeld(a.p);
    // player-controlled green zone: hold = rise, release = sink
    a.zoneV += (hold ? 3.4 : -2.8) * dt;
    a.zoneV = Phaser.Math.Clamp(a.zoneV, -1.4, 1.4);
    a.zoneY += a.zoneV * dt;
    const top = 1 - f.zone;
    if (a.zoneY < 0) { a.zoneY = 0; a.zoneV = Math.abs(a.zoneV) * 0.3; }
    if (a.zoneY > top) { a.zoneY = top; a.zoneV = Math.min(0, a.zoneV); }
    if (hold) {
      a.reelClick -= dt;
      if (a.reelClick <= 0) { a.reelClick = 0.11; Audio.sfx('tick', 1.3 + a.p * 0.05); }
    }
    // the fish fights
    if (Math.random() < f.jumpy * dt) a.fishTarget = Math.random();
    else if (Math.abs(a.fishTarget - a.fishY) < 0.03) a.fishTarget = Phaser.Math.Clamp(a.fishY + (Math.random() - 0.5) * 0.4, 0.04, 0.96);
    const dir = Math.sign(a.fishTarget - a.fishY);
    a.fishY += dir * Math.min(Math.abs(a.fishTarget - a.fishY), f.speed * dt * (0.6 + Math.random() * 0.8));
    a.fishY = Phaser.Math.Clamp(a.fishY, 0.03, 0.97);
    const inside = a.fishY >= a.zoneY && a.fishY <= a.zoneY + f.zone;
    a.progress += (inside ? f.gain : -0.3) * dt;
    // visuals
    const y = (v: number) => BAR_H / 2 - v * BAR_H;
    a.zoneImg.setY(y(a.zoneY)).setAlpha(inside ? 1 : 0.7);
    a.fishIcon.setPosition(Math.sin(this.t * 30) * (inside ? 0.5 : 1.5), y(a.fishY)).setFlipX(true);
    a.prog.setDisplaySize(6, Math.max(1, BAR_H * Phaser.Math.Clamp(a.progress, 0, 1)));
    a.prog.setFillStyle(a.progress > 0.66 ? 0x7ee8b0 : a.progress > 0.33 ? 0xffe066 : 0xff7a85);
    // underwater thrash + bobber tug
    const fx = a.castX + Math.sin(this.t * 9) * 10 - a.progress * 40;
    a.hooked.setPosition(fx, SURF + 26 + (1 - a.fishY) * 30).setAngle(0);
    a.bobber.setPosition(fx + 4, SURF + 3 + Math.sin(this.t * 25) * 1.5).setFrame(2);
    if (Math.random() < dt * 4) this.lburst(a, fx, SURF, [0xffffff, 0xbfeaff], 3, 300, [30, 80]);
    a.av.play(hold ? 'attack' : 'hit');
    if (a.progress >= 1) this.landFish(a);
    else if (a.progress <= 0) {
      this.ltext(a, a.castX, SURF - 34, 'สายขาด!', '#ff7a85', 18);
      Audio.sfx('wrong', 0.9);
      a.av.play('lose', true);
      this.tweens.add({ targets: a.hooked, x: a.hooked.x + 120, alpha: 0, duration: 500, onComplete: () => a.hooked.setAlpha(1).setVisible(false) });
      this.enter(a, 'fail');
    }
  }

  private landFish(a: Angler): void {
    const f = a.fish;
    this.enter(a, 'catch');
    a.hooked.setVisible(false);
    a.bobber.setVisible(false);
    a.av.play('cheer', true);
    this.addScore(a.p, f.value);
    a.catches++;
    const flyer = this.add.image(a.castX, SURF, f.key).setScale(S * 1.2);
    a.pn.c.add(flyer);
    const bx = a.bucket.x, by = a.bucket.y - 16;
    this.tweens.add({ targets: flyer, x: bx, duration: 650, ease: 'Sine.easeInOut' });
    this.tweens.add({
      targets: flyer, y: { from: SURF, to: by }, duration: 650,
      ease: (k: number) => k - Math.sin(k * Math.PI) * 1.9,
      onComplete: () => {
        flyer.destroy();
        Audio.sfx('pop', 1.2);
        this.lburst(a, bx, by, [0xffffff, 0xbfeaff], 6, 300, [30, 80]);
        this.tweens.add({ targets: a.bucket, scaleX: S * 1.25, scaleY: S * 0.8, yoyo: true, duration: 90 });
      },
    });
    this.tweens.add({ targets: flyer, angle: 540, duration: 650 });
    this.lburst(a, a.castX, SURF, [0xffffff, 0xbfeaff, 0x6cc8f4], 16, 420, [60, 180]);
    this.ripple(a, a.castX, true);
    const rare = f.value >= 50;
    Audio.sfx(rare ? 'power' : f.value <= 2 ? 'bounce' : 'coin', 1 + a.p * 0.08);
    if (rare) {
      this.lburst(a, a.castX, SURF - 30, [0xffe066, 0xffffff, 0xff9f43], 24, 120, [80, 200], [0, 360]);
      this.cameras.main.flash(120, 255, 240, 180, false);
    }
    this.ltext(a, 10, -70, `${f.name}  +${f.value}`, f.color, rare ? 22 : 18, 800);
    // trophy line of catches (top-right sky)
    const i = a.log.length;
    const lx = a.pn.w / 2 - 20 - (i % 10) * 26, ly = -a.pn.h / 2 + 18;
    const icon = this.add.image(lx, ly, f.key).setScale(S * 0.75).setAngle(-90);
    a.pn.c.add(icon);
    icon.setScale(0);
    this.tweens.add({ targets: icon, scale: S * 0.75, duration: 260, delay: 500, ease: 'Back.easeOut' });
    a.log.push(icon);
    if (a.log.length > 10) a.log.shift()?.destroy();
  }

  private drawLine(a: Angler): void {
    const g = a.line;
    g.clear();
    if (!a.bobber.visible) return;
    const tip = this.rodTip(a);
    const bx = a.bobber.x, by = a.bobber.y - 4;
    const sag = a.state === 'reel' ? 2 : a.state === 'cast' ? 4 : 14;
    g.lineStyle(1.5, 0xf4f8ff, 0.85);
    g.beginPath();
    g.moveTo(tip.x, tip.y);
    for (let i = 1; i <= 12; i++) {
      const k = i / 12;
      g.lineTo(Phaser.Math.Linear(tip.x, bx, k), Phaser.Math.Linear(tip.y, by, k) + Math.sin(k * Math.PI) * sag);
    }
    g.strokePath();
    if (a.state === 'reel') {
      g.lineStyle(1, 0xf4f8ff, 0.6);
      g.lineBetween(bx, by + 4, a.hooked.x - 10, a.hooked.y);
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(a: Angler, dt: number): void {
    switch (a.state) {
      case 'ready': {
        // the CPU sweeps its own aim too
        a.power += a.powerDir * dt * 0.9;
        if (a.power > 1) { a.power = 1; a.powerDir = -1; }
        if (a.power < 0) { a.power = 0; a.powerDir = 1; }
        a.cpuThink -= dt;
        if (a.cpuThink <= 0 && Math.abs(a.power - Math.min(0.98, a.cpuWant)) < 0.05) this.cast(a);
        break;
      }
      case 'wait':
        if (Math.random() < 0.012 * dt * (1 - a.cpuSkill) * 60 * 0.15) this.tooEarly(a);
        break;
      case 'bite':
        if (a.t >= a.cpuReact) this.hook(a);
        break;
      case 'reel': {
        a.cpuThink -= dt;
        if (a.cpuThink <= 0) {
          a.cpuThink = 0.05 + Math.random() * 0.12 * (1.4 - a.cpuSkill);
          const mid = a.zoneY + a.fish.zone / 2;
          const err = (Math.random() - 0.5) * 0.12 * (1.5 - a.cpuSkill);
          const want = a.fishY + err - mid;
          // look-ahead on zone velocity
          a.cpuHold = want - a.zoneV * 0.25 > 0;
        }
        break;
      }
      default:
        break;
    }
  }
}

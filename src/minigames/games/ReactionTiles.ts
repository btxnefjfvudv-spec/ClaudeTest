import Phaser from 'phaser';
import { ICONS, S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng, type Painter } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

type Kind = 'normal' | 'gold' | 'bomb';
const POINTS: Record<Kind, number> = { normal: 1, gold: 3, bomb: -3 };
const TILE = 56;
const GAP = 6;
const GRID_Y = -14;

interface Spawn { t: number; cell: number; kind: Kind; life: number }

interface Cell {
  base: Phaser.GameObjects.Image;
  face: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Rectangle;
  /** index into the spawn schedule currently lit here, or -1 */
  ev: number;
}

interface Floor {
  p: PlayerIndex;
  pn: Panel;
  cells: Cell[];
  speakers: Phaser.GameObjects.Sprite[];
  beams: { img: Phaser.GameObjects.Image; ph: number }[];
  combo: Phaser.GameObjects.Text;
  streak: number;
  /** CPU: planned taps (event index → time) */
  plan: Map<number, number>;
  cpuSkill: number;
}

/** #20 — Whack the lit tiles on your own 3×3 dance floor. Gold is worth 3, bombs cost 3. */
export default class ReactionTiles extends BaseMinigame {
  private panels!: PanelKit;
  private floors: Floor[] = [];
  private schedule: Spawn[] = [];
  private next = 0;
  private announced = 0;

  constructor() {
    super(CATALOG['reaction-tiles']);
  }

  setup(): void {
    this.floors = [];
    this.next = 0;
    this.announced = 0;
    this.buildSchedule();
    this.paintArt();
    this.cameras.main.setBackgroundColor(0x120a22);
    this.panels = new PanelKit(this, { frame: false, inset: 4 });
    for (const pn of this.panels.panels) this.buildPanel(pn);
    this.panels.onDown((p, lx, ly) => {
      if (this.isCpu(p)) return;
      const k = this.cellAt(lx, ly);
      if (k >= 0) this.hit(p, k);
    });
  }

  /** Same random seed → same tiles for every player. */
  private buildSchedule(): void {
    const r = rng(Math.floor(Math.random() * 1e9));
    const dur = this.meta.duration;
    const busy = new Array(9).fill(-1);
    this.schedule = [];
    let t = 0.4;
    while (t < dur - 0.3) {
      const f = t / dur;
      const life = 1.35 - f * 0.6;
      const free = [...Array(9).keys()].filter((c) => busy[c] < t);
      if (free.length) {
        const cell = free[Math.floor(r() * free.length)];
        const roll = r();
        const bombP = 0.14 + f * 0.12;
        const kind: Kind = roll < bombP ? 'bomb' : roll < bombP + 0.1 ? 'gold' : 'normal';
        const l = kind === 'gold' ? life * 0.8 : kind === 'bomb' ? life * 1.3 : life;
        this.schedule.push({ t, cell, kind, life: l });
        busy[cell] = t + l + 0.1;
      }
      // speeds up: gap shrinks from ~0.8 s to ~0.3 s, with occasional double spawns
      const gap = 0.8 - f * 0.5;
      t += r() < 0.2 + f * 0.25 ? 0.06 : gap * (0.7 + r() * 0.6);
    }
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    const T = TILE / S;
    makeTexture(this, 'rt-tile', T, T + 2, (p) => {
      p.rect(0, 2, T, T, 0x0a0614);
      p.box(0, 0, T, T, 0x2a1e44, 1);
      p.rect(2, 2, T - 4, T - 4, 0x1e1534);
      for (let i = 0; i < T - 6; i += 2) p.px(3 + i, 3 + Math.floor(i / 3), 0x2e2450);
      p.hline(2, T - 3, T - 4, 0x160f28);
      p.rect(3, 3, 3, 1, 0x4a3a70);
    });
    const face = (key: string, c: number, icon: (p: Painter) => void) =>
      makeTexture(this, key, T, T, (p) => {
        p.box(1, 1, T - 2, T - 2, c, 2);
        p.dither(3, 3, T - 6, T - 6, c, shift(c, 0.25), 0.25);
        p.rect(3, 3, T - 6, 2, shift(c, 0.6));
        icon(p);
      });
    face('rt-normal', 0x2ee6d6, (p) => {
      const m = T / 2;
      p.stamp(m - 5, m - 4, ICONS.star, { a: 0x0e6a66 });
      p.stamp(m - 5, m - 5, ICONS.star, { a: 0xffffff });
    });
    face('rt-gold', 0xffc93d, (p) => {
      const m = T / 2;
      p.ball(m, m, 7, 7, 0xffe066);
      p.ring(m, m, 7, 0xb3861a, 1);
      p.stamp(m - 1, m - 2, ['aaa', '..a', 'aaa', '..a', 'aaa'], { a: 0x8a5a10 });
    });
    face('rt-bomb', 0xd8344a, (p) => {
      const m = T / 2;
      p.ball(m - 1, m + 1, 7, 7, 0x2b2b3a);
      p.rect(m + 2, m - 7, 3, 3, 0x5a5a70);
      p.line(m + 4, m - 7, m + 7, m - 10, 0xc9a06a);
      p.px(m - 4, m - 2, 0x8a8aa0); p.px(m - 3, m - 3, 0x8a8aa0);
    });
    makeTexture(this, 'rt-flash', T, T, (p) => p.box(1, 1, T - 2, T - 2, 0xffffff, 2));
    makeSheet(this, 'rt-speaker', 22, 34, 2, (p, i) => {
      p.box(0, 0, 22, 34, 0x2b2238, 1);
      p.rect(2, 2, 18, 30, 0x1e1828);
      p.circle(11, 9, 5, 0x3a3048); p.circle(11, 9, 3, 0x14101c); p.px(10, 8, 0x5a5070);
      const r = i ? 8.5 : 7.5;
      p.circle(11, 23, r, 0x3a3048); p.circle(11, 23, r - 2, 0x241c30); p.circle(11, 23, 2.5, 0x4a4060);
      p.ring(11, 23, r, 0x5a5070, 1);
      p.outline(-0.6);
    });
    makeTexture(this, 'rt-beam', 30, 90, (p) => {
      for (let y = 0; y < 90; y++) {
        const w = 2 + (y / 90) * 26;
        const a = Math.round(130 * (1 - y / 100));
        for (let x = 0; x < 30; x++) if (Math.abs(x - 15) < w / 2 && ((x + y) & 1) === 0) p.px(x, y, 0xffffff, a);
      }
    });
    makeTexture(this, 'rt-shard', 3, 3, (p) => p.rect(0, 0, 3, 3, 0xffffff));
  }

  private paintBg(pn: Panel): string {
    const aw = Math.ceil(pn.w / S), ah = Math.ceil(pn.h / S);
    return makeTexture(this, `rt-bg-${aw}x${ah}`, aw, ah, (p) => {
      p.gradient(0, 0, aw, ah, [0x1a0e34, 0x2a1450, 0x1e1040]);
      const r = rng(31);
      // back wall of glowing panels
      for (let y = 4; y < ah * 0.55; y += 10) for (let x = 2; x < aw; x += 12) {
        const c = [0x3a1e6a, 0x2e1a5a, 0x46207a][Math.floor(r() * 3)];
        p.rect(x, y, 10, 8, c);
        p.hline(x, y, 10, shift(c, 0.25));
      }
      // stage floor
      const fy = Math.floor(ah * 0.55);
      p.rect(0, fy, aw, ah - fy, 0x140c26);
      p.hline(0, fy, aw, 0xff6ad0);
      p.hline(0, fy + 1, aw, 0x8a3ad0);
      for (let i = 0; i < 30; i++) p.px(Math.floor(r() * aw), fy + 3 + Math.floor(r() * (ah - fy - 3)), [0x3fe0e0, 0xff6ad0, 0xffe066][i % 3], 140);
      for (let y = 0; y < ah; y++) { p.px(0, y, 0x000000, 120); p.px(aw - 1, y, 0x000000, 120); }
    });
  }

  private cellPos(k: number): { x: number; y: number } {
    const cx = (k % 3) - 1, cy = Math.floor(k / 3) - 1;
    return { x: cx * (TILE + GAP), y: GRID_Y + cy * (TILE + GAP) };
  }

  private buildPanel(pn: Panel): void {
    const p = pn.p;
    const c = pn.c;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { c.add(o); return o; };
    add(this.add.image(0, 0, this.paintBg(pn)).setScale(S));
    const beams = [0, 1, 2].map((i) => ({
      img: add(this.add.image((i - 1) * pn.w * 0.34, -pn.h / 2, 'rt-beam').setScale(S).setOrigin(0.5, 0)
        .setTint([0xff6ad0, 0x3fe0e0, 0xffe066][i]).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7)),
      ph: Math.random() * 6,
    }));
    const col = PLAYER_COLORS[p];
    add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));
    const sx = (TILE + GAP) * 1.5 + 34;
    const speakers = [-1, 1].map((d) => add(this.add.sprite(d * sx, GRID_Y + 8, 'rt-speaker', 0).setScale(S)));
    add(this.add.rectangle(0, GRID_Y + 2, (TILE + GAP) * 3 + 8, (TILE + GAP) * 3 + 8, 0x0a0614, 0.55).setStrokeStyle(2, col.main, 0.8));
    const cells: Cell[] = [];
    for (let k = 0; k < 9; k++) {
      const { x, y } = this.cellPos(k);
      const base = add(this.add.image(x, y + 2, 'rt-tile').setScale(S));
      const face = add(this.add.image(x, y, 'rt-normal').setScale(S).setVisible(false));
      const bar = add(this.add.rectangle(x - TILE / 2 + 5, y + TILE / 2 - 6, TILE - 10, 3, 0xffffff).setOrigin(0, 0.5).setVisible(false));
      cells.push({ base, face, bar, ev: -1 });
    }
    const combo = add(txt(this, sx, GRID_Y - 58, '', { size: 12, color: toCss(col.light) }));
    this.floors.push({ p, pn, cells, speakers, beams, combo, streak: 0, plan: new Map(), cpuSkill: 0.3 + Math.random() * 0.15 });
  }

  // ───────────────────────────── PLAY ─────────────────────────────

  private cellAt(lx: number, ly: number): number {
    for (let k = 0; k < 9; k++) {
      const { x, y } = this.cellPos(k);
      if (Math.abs(lx - x) <= (TILE + GAP) / 2 && Math.abs(ly - y) <= (TILE + GAP) / 2) return k;
    }
    return -1;
  }

  private light(f: Floor, ev: number): void {
    const s = this.schedule[ev];
    const cell = f.cells[s.cell];
    cell.ev = ev;
    cell.face.setTexture(`rt-${s.kind}`).setVisible(true).setAlpha(1).setScale(S * 0.5);
    this.tweens.add({ targets: cell.face, scale: S, duration: 120, ease: 'Back.easeOut' });
    cell.bar.setVisible(true).setFillStyle(s.kind === 'bomb' ? 0xff5a6e : s.kind === 'gold' ? 0xffe066 : 0xffffff);
    if (this.isCpu(f.p)) {
      // CPU decides now whether (and when) it will tap this tile
      const rt = f.cpuSkill + Math.random() * 0.35 + (Math.random() < 0.15 ? 0.4 : 0);
      const want = s.kind === 'bomb' ? Math.random() < 0.08 : Math.random() < 0.93;
      if (want && rt < s.life) f.plan.set(ev, this.elapsed + rt);
    }
  }

  private clearCell(f: Floor, k: number): void {
    const cell = f.cells[k];
    cell.ev = -1;
    cell.bar.setVisible(false);
    this.tweens.killTweensOf(cell.face);
    this.tweens.add({ targets: cell.face, alpha: 0, scale: S * 0.7, duration: 120, onComplete: () => cell.face.setVisible(false).setScale(S) });
  }

  private hit(p: PlayerIndex, k: number): void {
    const f = this.floors[p];
    if (!f || this.state !== 'play') return;
    const cell = f.cells[k];
    const { x, y } = this.cellPos(k);
    const w = this.panels.toWorld(p, x, y);
    const up = this.angleFor(p);
    Vfx.squash(this, cell.base, 0.92, 0.92, 120);
    if (cell.ev < 0) {
      Audio.sfx('click', 0.7 + p * 0.05);
      return;
    }
    const s = this.schedule[cell.ev];
    f.plan.delete(cell.ev);
    const pts = POINTS[s.kind];
    this.addScore(p, pts);
    const fl = this.add.image(x, y, 'rt-flash').setScale(S);
    f.pn.c.add(fl);
    this.tweens.add({ targets: fl, alpha: 0, scale: S * 1.15, duration: 220, onComplete: () => fl.destroy() });
    if (s.kind === 'bomb') {
      f.streak = 0;
      Vfx.explosion(this, w.x, w.y, 0.45);
      Audio.sfx('explode', 1 + p * 0.05);
      Vfx.popText(this, w.x, w.y, '-3', '#ff7a85', 22, up);
      const bx = f.pn.rect.centerX;
      this.tweens.add({ targets: f.pn.c, x: { from: bx + 6, to: bx }, duration: 260, ease: 'Elastic.easeOut' });
    } else {
      f.streak++;
      const gold = s.kind === 'gold';
      burst(this, w.x, w.y, { tex: 'rt-shard', count: gold ? 16 : 9, tint: gold ? [0xffe066, 0xffffff, 0xffc93d] : [0x2ee6d6, 0xffffff, 0x9ffff4], speed: [70, 190], life: 420, scale: [S, 0] });
      if (gold) Vfx.sparkle(this, w.x, w.y);
      Vfx.popText(this, w.x, w.y, gold ? '+3' : '+1', gold ? '#ffe066' : '#bff7f0', gold ? 22 : 17, up);
      Audio.sfx(gold ? 'coin' : 'pop', 1 + p * 0.1);
      if (f.streak >= 5 && f.streak % 5 === 0) Audio.sfx('right', 1.2 + p * 0.05);
    }
    this.clearCell(f, k);
  }

  tick(_dt: number): void {
    const t = this.elapsed;
    while (this.next < this.schedule.length && this.schedule[this.next].t <= t) {
      for (const f of this.floors) if (this.players.includes(f.p)) this.light(f, this.next);
      this.next++;
    }
    for (const f of this.floors) {
      if (!this.players.includes(f.p)) continue;
      f.cells.forEach((cell, k) => {
        if (cell.ev < 0) return;
        const s = this.schedule[cell.ev];
        const left = s.t + s.life - t;
        if (left <= 0) {
          if (s.kind !== 'bomb') f.streak = 0;
          if (s.kind === 'bomb') {
            const { x, y } = this.cellPos(k);
            const w = this.panels.toWorld(f.p, x, y);
            burst(this, w.x, w.y, { tex: 'puff', count: 5, tint: [0x6a6a80, 0x4a4a5c], speed: [10, 40], life: 500, scale: [S, 0] });
          }
          this.clearCell(f, k);
          return;
        }
        cell.bar.width = (TILE - 10) * (left / s.life);
        if (left < 0.4) cell.face.setAlpha(Math.floor(t * 16) % 2 ? 0.55 : 1);
      });
      for (const [ev, at] of f.plan) {
        if (t >= at) {
          f.plan.delete(ev);
          const k = this.schedule[ev].cell;
          if (f.cells[k].ev === ev) this.hit(f.p, k);
        }
      }
      const label = f.streak >= 3 ? `คอมโบ x${f.streak}` : '';
      if (f.combo.text !== label) {
        f.combo.setText(label);
        if (label) this.tweens.add({ targets: f.combo, scale: { from: 1.4, to: 1 }, duration: 160 });
      }
    }
    const stage = t > 28 ? 2 : t > 14 ? 1 : 0;
    if (stage > this.announced) {
      this.announced = stage;
      Audio.sfx('power');
      for (const [deg, y] of [[0, this.vh * 0.5 + 20], [180, this.vh * 0.5 - 20]] as const) {
        const tx = txt(this, this.vw / 2, y, stage === 2 ? 'ไฟกระพริบรัว!' : 'เร็วขึ้น!', { size: 28, color: '#ffe066', strokeWidth: 7 }).setAngle(deg).setDepth(3000);
        this.tweens.add({ targets: tx, scale: { from: 0.3, to: 1 }, duration: 260, ease: 'Back.easeOut' });
        this.tweens.add({ targets: tx, alpha: 0, delay: 900, duration: 300, onComplete: () => tx.destroy() });
      }
    }
  }

  ambient(_dt: number): void {
    const now = this.time.now / 1000;
    const beat = Math.floor(now * 2.2) % 2;
    for (const f of this.floors) {
      for (const sp of f.speakers) sp.setFrame(beat);
      for (const b of f.beams) {
        b.img.x = Math.sin(now * 0.7 + b.ph) * f.pn.w * 0.35;
        b.img.setAlpha(0.45 + 0.25 * Math.sin(now * 2 + b.ph));
      }
    }
  }
}

import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { Audio, TRACKS } from '../../systems/audio/AudioManager';
import { Avatar } from '../../systems/players/Avatar';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const ID = 'dance-off';
const BPM = TRACKS.game.bpm; // 150
const STEP = 60 / BPM / 2; // one 8th note
const MUSIC_DELAY = 0.08; // AudioManager schedules the first step this far ahead
const LEAD = 1.1; // seconds a note is visible before it reaches the line
const LANE_X = [-56, 0, 56];
const TOP_Y = -36;
const HIT_Y = 60;
const BTN_Y = 90;
const PERFECT = 0.07;
const GOOD = 0.14;
const LANE_COL = [0xff7ab8, 0x7ee8b0, 0x6ec6ff];

interface Note { t: number; lane: number }

interface Seat {
  p: PlayerIndex;
  pn: Panel;
  av?: Avatar;
  next: number; // first note index not yet judged
  hit: boolean[];
  sprites: Map<number, Phaser.GameObjects.Image>;
  layer?: Phaser.GameObjects.Container;
  combo: number;
  best: number;
  perfects: number;
  btns: Phaser.GameObjects.Image[];
  recs: Phaser.GameObjects.Image[];
  pressT: number[];
  comboTxt?: Phaser.GameObjects.Text;
  move: number;
  moveT: number;
  hop: number;
  spin: number;
  missT: number;
  floor: Phaser.GameObjects.Image[];
  crowd: Phaser.GameObjects.Image[];
  disco?: Phaser.GameObjects.Image;
  // CPU
  plan: Map<number, number>;
  planned: number;
  sigma: number;
  missP: number;
}

/** #37 — Three-lane rhythm battle synced to the music; combos make your dancer go wild. */
export default class DanceOff extends BaseMinigame {
  private panels!: PanelKit;
  private seats: Seat[] = [];
  private notes: Note[] = [];
  private beams: Phaser.GameObjects.Image[] = [];
  private speakers: Phaser.GameObjects.Image[] = [];

  constructor() {
    super(CATALOG[ID]);
  }

  /** Song time (s): note times are measured against this. */
  private get songT(): number {
    return this.state === 'play' || this.state === 'end' ? this.elapsed - MUSIC_DELAY : -LEAD - 1;
  }

  setup(): void {
    this.seats = [];
    this.beams = [];
    this.speakers = [];
    this.notes = this.chart(Math.floor(Math.random() * 1e6));
    this.panels = new PanelKit(this, { frame: false, inset: 3 });
    this.paintArt();
    for (const pn of this.panels.panels) this.buildPanel(pn);
    this.panels.onDown((p, lx, ly) => {
      if (this.isCpu(p) || ly < TOP_Y - 10) return;
      let lane = 0, bd = 1e9;
      LANE_X.forEach((x, i) => { const d = Math.abs(lx - x); if (d < bd) { bd = d; lane = i; } });
      if (bd < 46) this.press(this.seats[p], lane);
    });
  }

  onStart(): void {
    // restart the track so beat 0 lines up with GO
    Audio.stopMusic();
    Audio.playMusic('game');
  }

  // ───────────────────────────── chart ─────────────────────────────

  private chart(seed: number): Note[] {
    const r = rng(seed);
    const drums = (TRACKS.game.drums ?? '').split(' ');
    const out: Note[] = [];
    let lastLane = 1, same = 0;
    for (let i = 8; i * STEP < this.meta.duration - 1.2; i++) {
      const sec = i * STEP;
      const d = drums[i % drums.length];
      const dens = sec < 11 ? 0 : sec < 24 ? 1 : 2;
      const quarter = i % 2 === 0;
      const strong = d === 'k' || d === 's';
      const p = quarter ? (strong ? 0.9 : 0.6) : dens === 0 ? 0 : strong ? (dens === 1 ? 0.3 : 0.55) : dens === 2 ? 0.12 : 0;
      if (r() >= p) continue;
      let lane = Math.floor(r() * 3);
      if (lane === lastLane && ++same >= 2) lane = (lane + 1 + Math.floor(r() * 2)) % 3;
      if (lane !== lastLane) same = 0;
      // notes in one lane are always at least a beat apart (readable, no overlap)
      const tooClose = (l: number) => out.some((n) => n.lane === l && sec - n.t < STEP * 1.9);
      if (tooClose(lane)) lane = [0, 1, 2].find((l) => !tooClose(l)) ?? -1;
      if (lane < 0) continue;
      lastLane = lane;
      out.push({ t: sec, lane });
      const l2 = (lane + 1 + Math.floor(r() * 2)) % 3;
      if (quarter && dens >= 1 && d === 'k' && r() < 0.18 * dens && !tooClose(l2)) out.push({ t: sec, lane: l2 });
    }
    return out;
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    const arrow = (p: import('../../art/Painter').Painter, lane: number, base: number, hollow: boolean) => {
      // arrow pointing up, rotated per lane: 0 = left, 1 = up, 2 = right
      const rows = [
        '.......aa.......',
        '......aaaa......',
        '.....aaaaaa.....',
        '....aaaaaaaa....',
        '...aaaaaaaaaa...',
        '..aaaaaaaaaaaa..',
        '.aaaaaaaaaaaaaa.',
        '.....aaaaaa.....',
        '.....aaaaaa.....',
        '.....aaaaaa.....',
        '.....aaaaaa.....',
        '.....aaaaaa.....',
        '.....aaaaaa.....',
      ];
      const put = (x: number, y: number, c: number) => {
        if (lane === 0) p.px(y + 1, 15 - x, c);
        else if (lane === 2) p.px(14 - y, x, c);
        else p.px(x, y + 1, c);
      };
      rows.forEach((row, y) => {
        for (let x = 0; x < 16; x++) {
          if (row[x] !== 'a') continue;
          const edge = rows[y - 1]?.[x] !== 'a' || rows[y + 1]?.[x] !== 'a' || row[x - 1] !== 'a' || row[x + 1] !== 'a';
          if (hollow) { if (edge) put(x, y, base); continue; }
          const light = y < 6 ? x < 8 : x < 7;
          put(x, y, edge ? shift(base, -0.45) : light ? shift(base, 0.3) : base);
        }
      });
      if (!hollow) p.outline(-0.7);
    };
    makeSheet(this, `${ID}-note`, 16, 16, 3, (p, i) => arrow(p, i, LANE_COL[i], false));
    makeSheet(this, `${ID}-rec`, 16, 16, 6, (p, i) => arrow(p, i % 3, i < 3 ? 0xd8dbe4 : 0xffffff, true));
    makeSheet(this, `${ID}-btn`, 20, 22, 6, (p, i) => {
      const lane = i % 3, down = i >= 3;
      const c = LANE_COL[lane];
      const cy = down ? 12 : 10;
      if (!down) p.ellipse(10, 13, 9.5, 8.5, shift(c, -0.65));
      p.ellipse(10, cy, 9.5, 8.5, shift(c, -0.4));
      p.ellipse(10, cy, 8.5, 7.5, c);
      p.ellipse(8, cy - 3, 4.5, 3, shift(c, 0.3));
      p.px(6, cy - 5, 0xffffff);
      // white arrow glyph (points up, rotated per lane)
      const g = ['...a...', '..aaa..', '.aaaaa.', 'aaaaaaa', '..aaa..', '..aaa..'];
      g.forEach((row, gy) => {
        for (let gx = 0; gx < 7; gx++) {
          if (row[gx] !== 'a') continue;
          const x = gx - 3, y = gy - 3;
          const [rx, ry] = lane === 0 ? [y, -x] : lane === 2 ? [-y, x] : [x, y];
          p.px(10 + rx, cy + ry, 0xffffff);
        }
      });
      p.outline(-0.8);
    });
    makeTexture(this, `${ID}-cone`, 26, 52, (p) => {
      for (let y = 0; y < 52; y++) {
        const half = 1.5 + y * 0.24;
        for (let x = 0; x < 26; x++) {
          const d = Math.abs(x + 0.5 - 13) / half;
          if (d < 1) p.px(x, y, 0xfff3c0, Math.round((1 - d * 0.6) * (1 - y / 60) * 60));
        }
      }
    });
    makeSheet(this, `${ID}-speaker`, 16, 22, 2, (p, i) => {
      p.box(0, 0, 16, 22, 0x2b2b3a);
      p.circle(8, 6, 3, 0x4a4a5c); p.circle(8, 6, 1.5, 0x8f98a8);
      const r = i ? 6 : 5;
      p.circle(8, 15, r, 0x4a4a5c); p.circle(8, 15, r - 2, 0x1b1f3b); p.circle(8, 15, 1.5, 0x8f98a8);
      p.outline(-0.6);
    });
    makeSheet(this, `${ID}-tile`, 12, 6, 2, (p, i) => {
      p.box(0, 0, 12, 6, i ? 0xffe066 : 0x6b4a8a);
      if (i) p.hline(1, 1, 6, 0xfff7c0);
    });
    makeSheet(this, `${ID}-fan`, 12, 14, 4, (p, i) => {
      const skin = [0xffd9b8, 0xdca37a, 0xf5c29a, 0xb97f56][i];
      const hair = [0x2b2030, 0x5a3426, 0x1f1a26, 0x40281e][i];
      p.ellipse(6, 14, 6, 5, [0x3d9bff, 0xff7a85, 0x7ee8b0, 0xffe066][i]);
      p.ball(6, 6, 4, 4, skin, false);
      p.ellipse(6, 3, 4.5, 2.5, hair);
      p.px(4, 6, 0x1b1f3b); p.px(8, 6, 0x1b1f3b);
      p.hline(5, 8, 3, 0xb3263a);
      p.outline(-0.7);
    });
    makeTexture(this, `${ID}-disco`, 12, 14, (p) => {
      p.vline(6, 0, 3, 0xc9ccd6);
      p.ball(6, 8, 5.5, 5.5, 0xb9bdca);
      for (let y = 3; y < 14; y += 2) for (let x = 1; x < 12; x += 2) if (p.get(x, y) !== -1) p.px(x, y, (x + y) % 4 ? 0xe8ecf4 : 0x8f98a8);
      p.px(4, 5, 0xffffff);
      p.outline(-0.7);
    });
  }

  private bgKey(w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    return makeTexture(this, `${ID}-bg-${aw}x${ah}`, aw, ah, (p) => {
      const stageB = Math.round((TOP_Y + h / 2) / S); // stage front edge (art y)
      // back wall with fairy lights
      p.gradient(0, 0, aw, stageB, [0x2a1a4a, 0x3d2466, 0x4a2a78]);
      const r = rng(9);
      for (let i = 0; i < 26; i++) {
        const x = Math.floor(r() * aw), y = Math.floor(r() * (stageB - 16));
        p.px(x, y, [0xffe066, 0xff7ab8, 0x6ec6ff, 0xffffff][i % 4]);
      }
      // curtains
      for (const side of [0, 1]) {
        for (let x = 0; x < 22; x++) {
          const cx = side ? aw - 1 - x : x;
          const fold = Math.sin(x * 0.9) > 0.3;
          const len = stageB - 4 - Math.floor(Math.sin(x * 0.35) * 3) - (x > 16 ? (x - 16) * 3 : 0);
          p.vline(cx, 0, Math.max(4, len), fold ? 0xc23a4a : 0xe0505e);
        }
      }
      p.rect(0, 0, aw, 5, 0xa82a3a);
      for (let x = 0; x < aw; x += 6) p.ellipse(x + 3, 5, 3, 2, 0xa82a3a);
      p.hline(0, 1, aw, 0xffc93d);
      // stage floor
      p.rect(0, stageB - 8, aw, 8, 0x9a5a34);
      for (let x = 0; x < aw; x += 10) p.vline(x, stageB - 8, 8, 0x7a4426);
      p.hline(0, stageB - 8, aw, 0xc88050);
      p.rect(0, stageB, aw, 3, 0x5e3420);
      p.hline(0, stageB, aw, 0xffe066);
      // dance hall below
      p.rect(0, stageB + 3, aw, ah - stageB - 3, 0x1e1a36);
      for (let y = stageB + 3; y < ah; y += 8) p.hline(0, y, aw, 0x262046);
      for (let x = 4; x < aw; x += 8) p.vline(x, stageB + 3, ah - stageB - 3, 0x241e42);
      // lanes
      const hy = Math.round((HIT_Y + h / 2) / S);
      LANE_X.forEach((lx, i) => {
        const cx = Math.round((lx + w / 2) / S);
        const c = LANE_COL[i];
        for (let y = stageB + 3; y < ah - 2; y++) {
          const t = (y - stageB) / (ah - stageB);
          for (let x = cx - 12; x <= cx + 12; x++) p.px(x, y, shift(0x2b2450, t * 0.15));
          p.px(cx - 13, y, shift(c, -0.55)); p.px(cx + 13, y, shift(c, -0.55));
        }
        for (let x = cx - 13; x <= cx + 13; x++) { p.px(x, hy, shift(c, -0.2)); p.px(x, hy + 1, shift(c, -0.6)); }
      });
    });
  }

  private frameKey(p: PlayerIndex, w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    const c = PLAYER_COLORS[p];
    return makeTexture(this, `${ID}-frame-${p}-${aw}x${ah}`, aw, ah, (g) => {
      for (let i = 0; i < 2; i++) {
        const col = i === 0 ? shift(c.main, -0.5) : c.main;
        g.rect(i, i, aw - i * 2, 1, col); g.rect(i, ah - 1 - i, aw - i * 2, 1, col);
        g.rect(i, i, 1, ah - i * 2, col); g.rect(aw - 1 - i, i, 1, ah - i * 2, col);
      }
      g.hline(3, 2, aw - 6, c.light);
    });
  }

  // ───────────────────────────── build ─────────────────────────────

  private buildPanel(pn: Panel): void {
    const { c, w, h, p } = pn;
    c.add(this.add.image(0, 0, this.bgKey(w, h)).setScale(S));
    // light-up stage tiles
    const floor: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < 9; i++) {
      const t = this.add.image(-96 + i * 24, TOP_Y - 9, `${ID}-tile`, 0).setScale(S);
      c.add(t);
      floor.push(t);
    }
    // spotlights
    for (const sx of [-120, 120]) {
      const cone = this.add.image(sx, -h / 2 + 6, `${ID}-cone`).setOrigin(0.5, 0).setScale(S).setBlendMode(Phaser.BlendModes.ADD);
      c.add(cone);
      this.beams.push(cone);
    }
    for (const sx of [-1, 1]) {
      const sp = this.add.image(sx * 100, TOP_Y - 30, `${ID}-speaker`, 0).setScale(S).setFlipX(sx > 0);
      c.add(sp);
      this.speakers.push(sp);
    }
    const disco = this.add.image(-54, -h / 2 + 16, `${ID}-disco`).setScale(S);
    c.add(disco);
    // the dancer
    const av = new Avatar(this, p, 0, TOP_Y - 10, { shadow: false, marker: false, depthSort: false });
    c.add(av.sprite);
    const comboTxt = txt(this, 92, -h / 2 + 18, '', { size: 13, color: '#ffe066', strokeWidth: 3 });
    c.add(comboTxt);
    // crowd at the sides of the dance floor
    const crowd: Phaser.GameObjects.Image[] = [];
    for (const side of [-1, 1]) for (let k = 0; k < 2; k++) {
      const f = this.add.image(side * (126 + k * 22), TOP_Y + 28 + k * 30, `${ID}-fan`, (k * 2 + (side > 0 ? 1 : 0) + p) % 4).setScale(S).setFlipX(side > 0).setData('y0', TOP_Y + 28 + k * 30);
      c.add(f);
      crowd.push(f);
    }
    const layer = this.add.container(0, 0);
    c.add(layer);
    const recs = LANE_X.map((x, i) => {
      const img = this.add.image(x, HIT_Y, `${ID}-rec`, i).setScale(S).setAlpha(0.8);
      c.add(img);
      return img;
    });
    const btns = LANE_X.map((x, i) => {
      const img = this.add.image(x, BTN_Y, `${ID}-btn`, i).setScale(S);
      c.add(img);
      return img;
    });
    c.add(this.add.image(0, 0, this.frameKey(p, w, h)).setScale(S));
    const cpu = this.isCpu(p);
    const skill = Math.random();
    this.seats[p] = {
      p, pn, av, next: 0, hit: this.notes.map(() => false), sprites: new Map(), layer, combo: 0, best: 0, perfects: 0,
      btns, recs, pressT: [0, 0, 0], comboTxt, move: 0, moveT: 0, hop: 0, spin: 0, missT: 0, floor, crowd, disco,
      plan: new Map(), planned: 0, sigma: cpu ? 0.03 + skill * 0.045 : 0, missP: cpu ? 0.04 + skill * 0.08 : 0,
    };
  }

  // ───────────────────────────── input / judge ─────────────────────────────

  private press(s: Seat, lane: number): void {
    if (this.state !== 'play') return;
    s.pressT[lane] = 0.12;
    s.btns[lane].setFrame(lane + 3);
    const t = this.songT;
    // closest unjudged note in this lane
    let best = -1, bd = 1e9;
    for (let i = s.next; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.t - t > GOOD + 0.06) break;
      if (n.lane !== lane || s.hit[i]) continue;
      const d = Math.abs(n.t - t);
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0 || bd > GOOD) {
      // tapping off-beat breaks your flow
      if (s.combo >= 5) this.judge(s, lane, 'miss');
      else Audio.sfx('tick', 0.7);
      return;
    }
    s.hit[best] = true;
    const spr = s.sprites.get(best);
    if (spr) { spr.destroy(); s.sprites.delete(best); }
    this.judge(s, lane, bd <= PERFECT ? 'perfect' : 'good');
  }

  private judge(s: Seat, lane: number, j: 'perfect' | 'good' | 'miss'): void {
    const col = PLAYER_COLORS[s.p];
    const lx = LANE_X[lane];
    const w = this.panels.toWorld(s.p, lx, HIT_Y - 24);
    const ang = this.angleFor(s.p);
    if (j === 'miss') {
      if (s.combo >= 10) Vfx.popText(this, w.x, w.y, 'คอมโบหลุด!', '#ff8a95', 12, ang);
      s.combo = 0;
      s.missT = 0.45;
      Vfx.popText(this, w.x, w.y + (ang === 180 ? 14 : -14) * 0, 'Miss', '#ff6b7a', 14, ang);
      Audio.sfx('wrong', 1.3);
      if (s.av) { s.av.sprite.anims.stop(); s.av.sprite.setFrame(13); }
      return;
    }
    s.combo++;
    s.best = Math.max(s.best, s.combo);
    const pts = (j === 'perfect' ? 100 : 50) + Math.min(50, s.combo) * 2;
    if (j === 'perfect') s.perfects++;
    this.addScore(s.p, pts);
    Vfx.popText(this, w.x, w.y, j === 'perfect' ? 'Perfect!' : 'Good', j === 'perfect' ? '#ffe066' : '#8fe8ff', j === 'perfect' ? 15 : 13, ang);
    const hw = this.panels.toWorld(s.p, lx, HIT_Y);
    burst(this, hw.x, hw.y, { tex: j === 'perfect' ? 'star' : 'spark', count: j === 'perfect' ? 8 : 5, tint: [LANE_COL[lane], 0xffffff], speed: [50, 130], life: 300 });
    s.recs[lane].setFrame(lane + 3).setAlpha(1);
    Vfx.squash(this, s.recs[lane], 1.35, 1.35, 140);
    Audio.sfx(j === 'perfect' ? 'pop' : 'click', 1 + lane * 0.12 + s.p * 0.04);
    // dance move
    s.move = lane;
    s.moveT = 0.32;
    s.hop = s.combo >= 30 ? 26 : s.combo >= 15 ? 18 : s.combo >= 5 ? 11 : 6;
    if (s.av) {
      s.av.sprite.anims.stop();
      const frames = lane === 0 ? [22, 23] : lane === 1 ? [16, 17, 18, 10] : [29, 30];
      s.av.sprite.setFrame(frames[s.combo % frames.length]);
      s.av.face(lane === 0 ? -1 : lane === 2 ? 1 : s.combo % 2 ? 1 : -1);
    }
    if (s.combo >= 20 && s.combo % 10 === 0) {
      s.spin = 1;
      const aw = this.panels.toWorld(s.p, 0, TOP_Y - 40);
      Vfx.confetti(this, aw.x, aw.y, 24);
      Audio.sfx('power', 1 + s.p * 0.08);
      Vfx.popText(this, aw.x, aw.y, `${s.combo} COMBO!`, toCss(col.light), 16, ang);
    }
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    const st = this.songT;
    const beat = st / (STEP * 2);
    const ph = beat - Math.floor(beat); // 0 on the beat
    const pulse = st > 0 ? Math.max(0, 1 - ph * 3) : 0;
    const t = this.time.now / 1000;
    this.beams.forEach((l, i) => l.setAngle(Math.sin(t * 1.3 + i * 2) * 28 + (i ? 12 : -12)).setAlpha(0.6 + pulse * 0.4));
    this.speakers.forEach((sp) => sp.setScale(S * (1 + pulse * 0.08)).setFrame(pulse > 0.5 ? 1 : 0));
    for (const s of this.seats) {
      const fever = s.combo >= 20;
      s.floor.forEach((f, i) => f.setFrame((i + Math.floor(Math.max(0, beat))) % (fever ? 2 : 3) === 0 ? 1 : 0));
      s.crowd.forEach((f, i) => {
        const jump = s.combo >= 10 ? 6 : 2;
        f.y = (f.getData('y0') as number) - pulse * jump * (i % 2 ? 1 : 0.7);
      });
      if (s.disco) { s.disco.setAngle(Math.sin(t * 2) * 8); s.disco.setTint(fever ? [0xffffff, 0xffe066, 0xff7ab8, 0x6ec6ff][Math.floor(t * 8) % 4] : 0xffffff); }
      for (let l = 0; l < 3; l++) {
        if (s.pressT[l] > 0) {
          s.pressT[l] -= dt;
          if (s.pressT[l] <= 0) { s.btns[l].setFrame(l); s.recs[l].setFrame(l).setAlpha(0.8); }
        }
      }
      // dancer
      const av = s.av;
      if (!av) continue;
      s.moveT = Math.max(0, s.moveT - dt);
      s.missT = Math.max(0, s.missT - dt);
      if (s.spin > 0) s.spin = Math.max(0, s.spin - dt * 2.2);
      const hop = s.moveT > 0 ? Math.sin((s.moveT / 0.32) * Math.PI) * s.hop : pulse * 3;
      av.sprite.setPosition(0, TOP_Y - 10 - hop);
      av.sprite.setAngle(s.spin > 0 ? (1 - s.spin) * 360 : 0);
      if (s.moveT <= 0 && s.missT <= 0 && st > 0) {
        // groove on the beat between hits
        av.sprite.anims.stop();
        const groove = s.combo >= 10 ? [25, 27, 16, 29] : [0, 2, 0, 3];
        av.sprite.setFrame(groove[Math.floor(Math.max(0, beat)) % 4]);
      } else if (st <= 0 && av.anim !== 'idle') {
        av.play('idle');
      }
      if (s.comboTxt) {
        const label = s.combo >= 3 ? `${s.combo} COMBO` : '';
        if (s.comboTxt.text !== label) {
          s.comboTxt.setText(label).setColor(s.combo >= 20 ? '#ff9ad5' : '#ffe066');
          if (label) this.tweens.add({ targets: s.comboTxt, scale: { from: 1.3, to: 1 }, duration: 120 });
        }
      }
    }
    this.renderNotes();
  }

  private renderNotes(): void {
    const t = this.songT;
    for (const s of this.seats) {
      for (let i = s.next; i < this.notes.length; i++) {
        const n = this.notes[i];
        const dtn = n.t - t;
        if (dtn > LEAD) break;
        if (s.hit[i]) continue;
        let spr = s.sprites.get(i);
        if (!spr) {
          spr = this.add.image(LANE_X[n.lane], TOP_Y, `${ID}-note`, n.lane).setScale(S);
          s.layer!.add(spr);
          s.sprites.set(i, spr);
        }
        const y = HIT_Y - (dtn / LEAD) * (HIT_Y - TOP_Y);
        spr.setY(y).setAlpha(Phaser.Math.Clamp((y - TOP_Y) / 22, 0, 1) * (dtn < -GOOD ? 0.4 : 1));
      }
    }
  }

  tick(dt: number): void {
    void dt;
    const t = this.songT;
    for (const s of this.seats) {
      if (!this.players.includes(s.p)) continue;
      // notes that slipped past the line
      while (s.next < this.notes.length && (s.hit[s.next] || this.notes[s.next].t < t - GOOD)) {
        if (!s.hit[s.next]) {
          s.hit[s.next] = true;
          const spr = s.sprites.get(s.next);
          if (spr) {
            s.sprites.delete(s.next);
            this.tweens.add({ targets: spr, alpha: 0, y: spr.y + 14, duration: 200, onComplete: () => spr.destroy() });
          }
          this.judge(s, this.notes[s.next].lane, 'miss');
        }
        s.next++;
      }
      if (this.isCpu(s.p)) this.bot(s, t);
    }
  }

  private bot(s: Seat, t: number): void {
    // plan taps a little ahead of time
    while (s.planned < this.notes.length && this.notes[s.planned].t - t < 0.6) {
      const i = s.planned++;
      const busy = this.notes.filter((n) => Math.abs(n.t - this.notes[i].t) < STEP * 1.5).length;
      const miss = s.missP * (busy > 2 ? 1.8 : 1) + (this.notes[i].t > 24 ? 0.03 : 0);
      if (Math.random() < miss) continue;
      const g = (Math.random() + Math.random() + Math.random() - 1.5) * 2;
      s.plan.set(i, this.notes[i].t + g * s.sigma);
    }
    for (const [i, at] of s.plan) {
      if (t >= at) {
        s.plan.delete(i);
        if (!s.hit[i]) this.press(s, this.notes[i].lane);
      }
    }
  }
}

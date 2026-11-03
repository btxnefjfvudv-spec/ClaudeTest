import Phaser from 'phaser';
import { S } from '../../art/common';
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

const ID = 'silly-faces';
const EMOTIONS = ['ดีใจ', 'เศร้า', 'โกรธ', 'ตกใจ', 'ง่วง', 'อาย', 'หลงรัก'];
const SPECIES = 6;
const FW = 30; // face art size
const SLOT_X = [-117, -39, 39, 117];
const FACE_Y = 14;
const LOCK = 1.5;
const ROUND_MAX = 6.5;

interface Face { species: number; emo: number }

interface Seat {
  p: PlayerIndex;
  pn: Panel;
  lock: number;
  slots: Phaser.GameObjects.Container[];
  faces: Phaser.GameObjects.Image[];
  word?: Phaser.GameObjects.Text;
  shade?: Phaser.GameObjects.Rectangle;
  lockTxt?: Phaser.GameObjects.Text;
  bunting: Phaser.GameObjects.Image[];
  // CPU
  skill: number;
  answerAt: number;
  wrongAt: number;
}

/** #38 — Read the emotion, tap the matching face before everyone else. Wrong tap = short lockout. */
export default class SillyFaces extends BaseMinigame {
  private panels!: PanelKit;
  private seats: Seat[] = [];
  private faces: Face[] = [];
  private order = [0, 1, 2, 3]; // order[slot] = face index shown in that slot
  private target = 0; // face index
  private roundT = 0;
  private between = 0;
  private rounds = 0;
  private shuffleAt = -1;
  private lastEmo = -1;
  private resolved = false;

  constructor() {
    super(CATALOG[ID]);
  }

  setup(): void {
    this.seats = [];
    this.rounds = 0;
    this.lastEmo = -1;
    this.between = 0;
    this.resolved = true;
    this.panels = new PanelKit(this, { frame: false, inset: 3 });
    this.paintArt();
    for (const pn of this.panels.panels) this.buildPanel(pn);
    this.panels.onDown((p, lx, ly) => {
      if (!this.isCpu(p)) this.tapAt(this.seats[p], lx, ly);
    });
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    makeSheet(this, `${ID}-face`, FW, FW, SPECIES * EMOTIONS.length * 2, (p, i) => {
      const f = i % 2, e = Math.floor(i / 2) % EMOTIONS.length, sp = Math.floor(i / 2 / EMOTIONS.length);
      paintFace(p, sp, e, f);
    });
    makeSheet(this, `${ID}-frame`, 36, 40, 2, (p, i) => {
      const gold = i ? 0xffe066 : 0xd4a04a;
      p.rect(0, 0, 36, 40, shift(gold, -0.45));
      p.rect(1, 1, 34, 38, gold);
      p.hline(1, 1, 34, shift(gold, 0.4)); p.vline(1, 1, 38, shift(gold, 0.4));
      p.hline(1, 38, 34, shift(gold, -0.3)); p.vline(34, 1, 38, shift(gold, -0.3));
      for (let k = 4; k < 34; k += 6) { p.px(k, 2, shift(gold, 0.5)); p.px(k, 37, shift(gold, -0.4)); }
      p.rect(3, 4, 30, 32, 0x000000);
      for (let y = 4; y < 36; y++) for (let x = 3; x < 33; x++) p.clear(x, y);
      p.hline(3, 3, 30, shift(gold, -0.55)); p.vline(2, 3, 34, shift(gold, -0.55));
    });
    const bgCols = [0xd8ecff, 0xffe0ec, 0xe4f7d8, 0xfff1c9, 0xe6e0ff, 0xd8f4f0];
    makeSheet(this, `${ID}-matte`, 30, 32, bgCols.length, (p, i) => {
      p.rect(0, 0, 30, 32, bgCols[i]);
      for (let y = 0; y < 32; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 30; x += 4) p.px(x, y, shift(bgCols[i], -0.08));
      p.hline(0, 0, 30, shift(bgCols[i], -0.25));
    });
    makeTexture(this, `${ID}-lamp`, 14, 7, (p) => {
      p.rect(5, 0, 4, 2, 0x4a4a5c);
      p.tri(1, 6, 13, 6, 7, 1, 0x2b3263);
      p.hline(2, 6, 11, 0xfff3c0);
      p.outline(-0.6);
    });
    makeTexture(this, `${ID}-glow`, 36, 30, (p) => {
      for (let y = 0; y < 30; y++) {
        const half = 4 + y * 0.5;
        for (let x = 0; x < 36; x++) {
          const d = Math.abs(x + 0.5 - 18) / half;
          if (d < 1) p.px(x, y, 0xfff3c0, Math.round((1 - d) * (1 - y / 30) * 50));
        }
      }
    });
    makeSheet(this, `${ID}-flag`, 8, 9, 4, (p, i) => {
      const c = [0xff7a85, 0xffe066, 0x6ec6ff, 0x7ee8b0][i];
      p.tri(0, 0, 8, 0, 4, 8, c);
      p.hline(0, 0, 8, shift(c, 0.3));
      p.outline(-0.6);
    });
    makeTexture(this, `${ID}-plaque`, 76, 22, (p) => {
      p.rect(0, 0, 76, 22, 0x5e3420);
      p.rect(1, 1, 74, 20, 0x9a5a34);
      p.hline(1, 1, 74, 0xc88050);
      p.rect(3, 3, 70, 16, 0x7a4426);
      p.hline(3, 18, 70, 0x9a5a34);
      for (const x of [5, 70]) { p.px(x, 10, 0xffe066); p.px(x, 11, 0xb3861a); }
    });
    makeTexture(this, `${ID}-x`, 13, 13, (p) => {
      p.stroke(2, 2, 10, 10, 3, 0xff4d5e);
      p.stroke(10, 2, 2, 10, 3, 0xff4d5e);
      p.outline(-0.8);
    });
    for (const q of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[q];
      makeTexture(this, `${ID}-ribbon-${q}`, 13, 16, (p) => {
        p.circle(6.5, 6, 5.5, c.main);
        p.circle(6.5, 6, 3.5, c.light);
        p.circle(6.5, 6, 2, c.main);
        p.tri(2, 9, 6, 9, 3, 16, c.main);
        p.tri(7, 9, 11, 9, 10, 16, shift(c.main, -0.2));
        p.outline(-0.7);
      });
    }
  }

  private bgKey(w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    return makeTexture(this, `${ID}-bg-${aw}x${ah}`, aw, ah, (p) => {
      // damask-ish wallpaper
      p.rect(0, 0, aw, ah, 0x5a4fa0);
      for (let y = 0; y < ah; y += 10) for (let x = (y / 10) % 2 ? 6 : 0; x < aw; x += 12) {
        p.px(x + 3, y + 1, 0x6a5fb3); p.px(x + 2, y + 2, 0x6a5fb3); p.px(x + 4, y + 2, 0x6a5fb3); p.px(x + 3, y + 3, 0x6a5fb3);
        p.px(x + 3, y + 2, 0x7a70c4);
      }
      for (let x = 0; x < aw; x += 24) p.vline(x, 0, ah, 0x4f4590);
      // dado rail + wainscot
      const ry = ah - 24;
      p.rect(0, ry, aw, 3, 0xc88050);
      p.hline(0, ry, aw, 0xe8a070);
      p.rect(0, ry + 3, aw, ah - ry - 3, 0x3a2f6e);
      for (let x = 4; x < aw; x += 20) { p.rect(x, ry + 6, 16, ah - ry - 9, 0x433878); p.hline(x, ry + 6, 16, 0x4f4590); }
      // bunting string
      for (let x = 0; x < aw; x++) p.px(x, 6 + Math.round(Math.sin((x / aw) * Math.PI) * 4), 0xfff8e7);
      const r = rng(3);
      for (let i = 0; i < 30; i++) p.px(Math.floor(r() * aw), Math.floor(r() * ry), 0x7a70c4);
    });
  }

  private frameKey(p: PlayerIndex, w: number, h: number): string {
    const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
    const c = PLAYER_COLORS[p];
    return makeTexture(this, `${ID}-border-${p}-${aw}x${ah}`, aw, ah, (g) => {
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
    const bunting: Phaser.GameObjects.Image[] = [];
    const aw = Math.ceil(w / S);
    for (let i = 0; i < 11; i++) {
      const ax = 8 + i * ((aw - 16) / 10);
      const ay = 6 + Math.round(Math.sin((ax / aw) * Math.PI) * 4);
      const f = this.add.image(-w / 2 + ax * S, -h / 2 + ay * S, `${ID}-flag`, i % 4).setOrigin(0.5, 0).setScale(S);
      c.add(f);
      bunting.push(f);
    }
    c.add(this.add.image(0, -h / 2 + 34, `${ID}-plaque`).setScale(S));
    const word = txt(this, 0, -h / 2 + 33, 'พร้อม?', { size: 20, color: '#fff8e7', stroke: '#3a1f10', strokeWidth: 4 });
    c.add(word);
    const slots: Phaser.GameObjects.Container[] = [];
    const faces: Phaser.GameObjects.Image[] = [];
    SLOT_X.forEach((x, k) => {
      c.add(this.add.image(x, FACE_Y - 46, `${ID}-lamp`).setScale(S));
      c.add(this.add.image(x, FACE_Y - 40, `${ID}-glow`).setOrigin(0.5, 0).setScale(S).setBlendMode(Phaser.BlendModes.ADD));
      const sc = this.add.container(x, FACE_Y);
      const matte = this.add.image(0, 0, `${ID}-matte`, k).setScale(S);
      const face = this.add.image(0, -1, `${ID}-face`, 0).setScale(S);
      const frame = this.add.image(0, 0, `${ID}-frame`, 0).setScale(S);
      sc.add([matte, face, frame]);
      c.add(sc);
      slots.push(sc);
      faces.push(face);
    });
    const shade = this.add.rectangle(0, FACE_Y, w - 8, 92, 0x14172e, 0.55).setVisible(false);
    const lockTxt = txt(this, 0, FACE_Y + 62, '', { size: 14, color: '#ff8a95' });
    c.add([shade, lockTxt]);
    c.add(this.add.image(0, 0, this.frameKey(p, w, h)).setScale(S));
    this.seats[p] = { p, pn, lock: 0, slots, faces, word, shade, lockTxt, bunting, skill: 0.85 + Math.random() * 0.3, answerAt: 99, wrongAt: -1 };
    for (const sc of slots) sc.setScale(0);
  }

  // ───────────────────────────── rounds ─────────────────────────────

  onStart(): void {
    this.newRound();
  }

  private newRound(): void {
    this.rounds++;
    this.resolved = false;
    this.roundT = 0;
    let emo = Math.floor(Math.random() * EMOTIONS.length);
    if (emo === this.lastEmo) emo = (emo + 1 + Math.floor(Math.random() * 6)) % EMOTIONS.length;
    this.lastEmo = emo;
    const others = Phaser.Utils.Array.Shuffle([...EMOTIONS.keys()].filter((e) => e !== emo)).slice(0, 3);
    const emos = Phaser.Utils.Array.Shuffle([emo, ...others]);
    // later rounds use the same character more often: read the expression, not the hair!
    const same = this.elapsed > 18 && Math.random() < 0.5;
    const sp0 = Math.floor(Math.random() * SPECIES);
    const species = Phaser.Utils.Array.Shuffle([...Array(SPECIES).keys()]);
    this.faces = emos.map((e, k) => ({ emo: e, species: same ? sp0 : species[k] }));
    this.target = emos.indexOf(emo);
    this.order = [0, 1, 2, 3];
    this.shuffleAt = this.elapsed > 12 && Math.random() < 0.55 ? 0.7 : -1;
    Audio.sfx('whoosh');
    for (const s of this.seats) {
      s.lock = 0;
      s.shade?.setVisible(false);
      s.lockTxt?.setText('');
      s.word?.setText(EMOTIONS[emo]).setColor('#fff8e7');
      if (s.word) this.tweens.add({ targets: s.word, scale: { from: 1.5, to: 1 }, duration: 260, ease: 'Back.easeOut' });
      s.slots.forEach((sc, k) => {
        this.tweens.killTweensOf(sc);
        sc.setPosition(SLOT_X[k], FACE_Y).setAngle(0).setAlpha(1);
      });
      this.layoutSeat(s);
      s.slots.forEach((sc, k) => {
        sc.setScale(0.2);
        this.tweens.add({ targets: sc, scale: 1, delay: k * 50, duration: 240, ease: 'Back.easeOut' });
      });
      if (this.isCpu(s.p)) {
        const think = (0.8 + Math.random() * 0.9 + Math.random() * Math.random() * 1.2) / s.skill;
        s.answerAt = think + (this.shuffleAt > 0 ? 0.9 : 0);
        s.wrongAt = Math.random() < 0.15 ? s.answerAt * 0.7 : -1;
      }
    }
  }

  /** (Re)build each slot's matte/face/frame for the current faces. */
  private layoutSeat(s: Seat): void {
    s.slots.forEach((sc, k) => {
      const f = this.faces[this.order[k]];
      sc.removeAll(true);
      const matte = this.add.image(0, 0, `${ID}-matte`, f.species).setScale(S);
      const face = this.add.image(0, -1, `${ID}-face`, (f.species * EMOTIONS.length + f.emo) * 2).setScale(S);
      const frame = this.add.image(0, 0, `${ID}-frame`, 0).setScale(S);
      sc.add([matte, face, frame]);
      s.faces[k] = face;
      sc.setData('face', this.order[k]);
    });
  }

  private tapAt(s: Seat | undefined, lx: number, ly: number): void {
    if (!s || s.lock > 0 || this.resolved || this.between > 0) return;
    if (Math.abs(ly - FACE_Y) > 46) return;
    let slot = -1;
    s.slots.forEach((sc, k) => { if (Math.abs(lx - sc.x) < 37) slot = k; });
    if (slot < 0) return;
    this.pick(s, slot);
  }

  private pick(s: Seat, slot: number): void {
    const sc = s.slots[slot];
    const fi = sc.getData('face') as number;
    if (fi === this.target) return this.win(s, slot);
    s.lock = LOCK;
    Audio.sfx('wrong', 1 + s.p * 0.05);
    this.tweens.add({ targets: sc, angle: { from: -8, to: 8 }, yoyo: true, repeat: 2, duration: 60, onComplete: () => sc.setAngle(0) });
    const x = this.add.image(0, 0, `${ID}-x`).setScale(S * 1.6);
    sc.add(x);
    Vfx.squash(this, x, 1.6, 1.6, 200, S * 1.6);
    s.shade?.setVisible(true);
    const w = this.panels.toWorld(s.p, sc.x, FACE_Y - 50);
    Vfx.popText(this, w.x, w.y, `ไม่ใช่ ${EMOTIONS[this.faces[fi].emo]}!`, '#ff8a95', 13, this.angleFor(s.p));
  }

  private win(s: Seat, slot: number): void {
    this.resolved = true;
    this.between = 1.1;
    this.addScore(s.p, 1);
    const col = PLAYER_COLORS[s.p];
    Audio.sfx('right', 1 + s.p * 0.1);
    Audio.sfx('coin', 1.1 + s.p * 0.1);
    for (const o of this.seats) {
      const sc = o.slots[slot];
      // the winning face reacts in every panel; the winner's colour ribbon is pinned on it
      const fr = sc.list[2] as Phaser.GameObjects.Image;
      fr?.setFrame(1);
      const rib = this.add.image(26, -30, `${ID}-ribbon-${s.p}`).setScale(S);
      sc.add(rib);
      this.tweens.add({ targets: sc, scale: { from: 1.25, to: 1.08 }, duration: 300, ease: 'Back.easeOut' });
      o.slots.forEach((other, k) => { if (k !== slot) this.tweens.add({ targets: other, alpha: 0.45, scale: 0.9, duration: 200 }); });
      o.shade?.setVisible(false);
      const w = this.panels.toWorld(o.p, sc.x, FACE_Y);
      if (o.p === s.p) {
        Vfx.sparkle(this, w.x, w.y, [col.light, 0xffffff, 0xffe066]);
        burst(this, w.x, w.y, { tex: 'star', count: 10, tint: [0xffe066, col.light], speed: [70, 160], life: 500 });
        const t = this.panels.toWorld(o.p, 0, FACE_Y + 62);
        Vfx.popText(this, t.x, t.y, 'ถูกต้อง! +1', toCss(col.light), 18, this.angleFor(o.p));
        // camera-flash of the photo booth
        const fl = this.add.rectangle(0, 0, o.pn.w, o.pn.h, 0xffffff, 0.5);
        o.pn.c.add(fl);
        this.tweens.add({ targets: fl, alpha: 0, duration: 220, onComplete: () => fl.destroy() });
      } else if (this.players.includes(o.p)) {
        o.lockTxt?.setText(`P${s.p + 1} เร็วกว่า!`).setColor(toCss(col.light)).setAlpha(1);
      }
    }
  }

  private timeout(): void {
    this.resolved = true;
    this.between = 1.0;
    Audio.sfx('stun');
    for (const o of this.seats) {
      const k = o.slots.findIndex((sc) => sc.getData('face') === this.target);
      const sc = o.slots[k];
      if (sc) this.tweens.add({ targets: sc, scale: 1.12, yoyo: true, repeat: 1, duration: 160 });
      o.slots.forEach((other, j) => { if (j !== k) this.tweens.add({ targets: other, alpha: 0.45, duration: 200 }); });
      o.shade?.setVisible(false);
      o.lockTxt?.setText('ไม่มีใครได้!').setColor('#c7c9d6');
    }
  }

  private doShuffle(): void {
    this.shuffleAt = -1;
    // rotate faces between slots (same for everyone)
    const perm = Phaser.Utils.Array.Shuffle([0, 1, 2, 3]);
    if (perm.every((v, i) => v === i)) perm.reverse();
    Audio.sfx('whoosh', 1.4);
    for (const s of this.seats) {
      const old = [...s.slots];
      old.forEach((sc, k) => {
        const dest = perm[k];
        this.tweens.add({ targets: sc, x: SLOT_X[dest], duration: 340, ease: 'Cubic.easeInOut' });
        this.tweens.add({ targets: sc, y: FACE_Y - (k % 2 ? 16 : -10), duration: 170, yoyo: true, ease: 'Sine.easeOut' });
      });
      const next: Phaser.GameObjects.Container[] = [];
      old.forEach((sc, k) => (next[perm[k]] = sc));
      s.slots = next;
    }
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    void dt;
    const t = this.time.now / 1000;
    for (const s of this.seats) {
      s.bunting.forEach((b, i) => b.setAngle(Math.sin(t * 2 + i * 0.7) * 6));
      s.slots.forEach((sc, k) => {
        const face = sc.list[1] as Phaser.GameObjects.Image | undefined;
        if (!face) return;
        const fi = sc.getData('face') as number | undefined;
        const f = fi === undefined ? undefined : this.faces[fi];
        if (!f) return;
        const base = (f.species * EMOTIONS.length + f.emo) * 2;
        face.setFrame(base + (Math.floor(t * 2.5 + k * 0.6) % 2));
        face.y = -1 + Math.round(Math.sin(t * 3 + k) * 1);
      });
    }
  }

  tick(dt: number): void {
    for (const s of this.seats) {
      if (s.lock > 0) {
        s.lock = Math.max(0, s.lock - dt);
        if (!this.resolved) s.lockTxt?.setText(s.lock > 0 ? `พลาด! รอ ${s.lock.toFixed(1)}` : '').setColor('#ff8a95');
        if (s.lock <= 0) s.shade?.setVisible(false);
      }
    }
    if (this.between > 0) {
      this.between -= dt;
      if (this.between <= 0) this.newRound();
      return;
    }
    if (this.resolved) return;
    this.roundT += dt;
    if (this.shuffleAt > 0 && this.roundT >= this.shuffleAt) this.doShuffle();
    if (this.roundT >= ROUND_MAX) return this.timeout();
    for (const s of this.seats) {
      if (!this.isCpu(s.p) || !this.players.includes(s.p) || s.lock > 0 || this.resolved) continue;
      if (s.wrongAt > 0 && this.roundT >= s.wrongAt) {
        s.wrongAt = -1;
        const wrong = [0, 1, 2, 3].filter((k) => s.slots[k].getData('face') !== this.target);
        this.pick(s, wrong[Math.floor(Math.random() * wrong.length)]);
        s.answerAt = Math.max(s.answerAt, this.roundT + LOCK + 0.3);
      } else if (this.roundT >= s.answerAt) {
        const k = s.slots.findIndex((sc) => sc.getData('face') === this.target);
        if (k >= 0) this.pick(s, k);
      }
    }
  }
}

// ───────────────────────────── face art ─────────────────────────────

interface Look { skin: number; ink: number; blush: number; mouth: number }

const LOOKS: Look[] = [
  { skin: 0xf5c29a, ink: 0x2b1a24, blush: 0xff8a9a, mouth: 0xc23a4a }, // boy
  { skin: 0xffd9b8, ink: 0x2b1a24, blush: 0xff8a9a, mouth: 0xc23a4a }, // girl
  { skin: 0xdca37a, ink: 0x2b1a24, blush: 0xff7a85, mouth: 0xb3263a }, // teacher
  { skin: 0xffa94d, ink: 0x3a1f10, blush: 0xff7a85, mouth: 0xb3263a }, // cat
  { skin: 0xb9bdca, ink: 0x1fb8c8, blush: 0xff7ab8, mouth: 0x1b1f3b }, // robot
  { skin: 0x7ee8b0, ink: 0x1b2a3b, blush: 0xff9ad5, mouth: 0x8455d6 }, // monster
];

function paintFace(p: Painter, sp: number, e: number, f: number): void {
  const L = LOOKS[sp];
  const cx = 15, cy = 16;
  // species base
  if (sp === 3) { p.tri(4, 2, 11, 6, 5, 12, L.skin); p.tri(26, 2, 19, 6, 25, 12, L.skin); p.tri(6, 5, 9, 7, 6, 10, 0xff8fb1); p.tri(24, 5, 21, 7, 24, 10, 0xff8fb1); }
  if (sp === 4) { p.vline(15, 0, 4, 0x8f98a8); p.circle(15, 1, 1.5, 0xff5a6e); }
  if (sp === 5) { p.tri(18, 1, 22, 6, 17, 6, 0xfff8e7); }
  if (sp === 1) { p.ball(4, 18, 3.5, 4.5, 0x6a3a22); p.ball(26, 18, 3.5, 4.5, 0x6a3a22); }
  if (sp === 2) p.ball(15, 3, 5, 3.5, 0x9a9aaa);
  if (sp === 4) p.box(3, 4, 24, 24, L.skin, 1);
  else p.ball(cx, cy, 12, 12, L.skin, false);
  if (sp !== 4) {
    // simple top-left shading
    for (let y = 4; y < 29; y++) for (let x = 3; x < 28; x++) {
      const nx = (x + 0.5 - cx) / 12, ny = (y + 0.5 - cy) / 12;
      const d = nx * nx + ny * ny;
      if (d <= 1 && d > 0.78 && nx + ny > 0.45) p.px(x, y, shift(L.skin, -0.14));
      else if (d < 0.25 && nx + ny < -0.35) p.px(x, y, shift(L.skin, 0.2));
    }
  } else {
    p.rect(6, 9, 18, 16, 0x2b3263); // screen face
  }
  // hair / extras on top of the head
  if (sp === 0) { p.ellipse(15, 7, 11, 4.5, 0x2b2030); for (let x = 6; x < 25; x += 3) p.tri(x, 5, x + 3, 5, x + 1.5, 1, 0x2b2030); }
  if (sp === 1) { p.ellipse(15, 7, 11.5, 5, 0x6a3a22); p.rect(5, 7, 3, 8, 0x6a3a22); p.rect(22, 7, 3, 8, 0x6a3a22); p.px(9, 5, 0x8a5a36); }
  if (sp === 2) p.ellipse(15, 6.5, 11, 3.5, 0x9a9aaa);
  if (sp === 5) { p.px(8, 22, 0x8455d6); p.px(22, 9, 0x8455d6); p.px(23, 10, 0x8455d6); p.px(7, 11, 0x8455d6); }
  const ink = L.ink;
  const ex = [10, 20], ey = 15;
  const eyes = (fn: (x: number) => void) => ex.forEach(fn);
  switch (e) {
    case 0: // happy
      eyes((x) => { p.hline(x - 1, ey - 1, 3, ink); p.px(x - 2, ey, ink); p.px(x + 2, ey, ink); });
      p.hline(10, 20, 11, ink);
      p.rect(11, 21, 9, 2, L.mouth); p.rect(12, 23, 7, 1, L.mouth); p.hline(13, 24, 5, ink);
      p.px(10, 21, ink); p.px(20, 21, ink); p.px(11, 23, ink); p.px(19, 23, ink);
      p.hline(13, 23, 5, 0xff8fb1);
      if (f) p.hline(11, 21, 9, 0xffffff);
      p.ellipse(7, 19, 2, 1.2, L.blush); p.ellipse(23, 19, 2, 1.2, L.blush);
      break;
    case 1: // sad
      p.line(7, 12, 11, 10, ink); p.line(19, 10, 23, 12, ink);
      eyes((x) => { p.rect(x - 1, ey, 2, 2, ink); p.px(x - 1, ey, 0xffffff); });
      p.hline(12, 22, 7, ink); p.px(11, 23, ink); p.px(19, 23, ink);
      p.vline(9, 18 + f * 2, 2 + f * 2, 0x6ec6ff); p.px(9, 17 + f * 2, 0xbfeaff);
      break;
    case 2: // angry
      p.stroke(7, 10, 11, 12, 2, ink); p.stroke(19, 12, 23, 10, 2, ink);
      eyes((x) => { p.hline(x - 1, ey, 3, ink); p.px(x, ey + 1, ink); });
      p.rect(11, 20, 9, 4, ink); p.rect(12, 21, 7, 2, 0xffffff); p.vline(14, 21, 2, 0xb9bdca); p.vline(17, 21, 2, 0xb9bdca);
      for (let x = 7; x < 24; x += 2) p.px(x, 18, 0xff5a5a);
      if (f) { p.circle(4, 4, 2, 0xe8e8f0); p.circle(26, 4, 2, 0xe8e8f0); p.circle(6, 2, 1.4, 0xffffff); }
      p.px(21, 7, 0xff3a4a); p.px(23, 7, 0xff3a4a); p.px(22, 6, 0xff3a4a); p.px(22, 8, 0xff3a4a);
      break;
    case 3: { // surprised
      p.line(7, 9, 9, 8, ink); p.line(9, 8, 12, 9, ink); p.line(18, 9, 21, 8, ink); p.line(21, 8, 23, 9, ink);
      const r = f ? 3 : 2.6;
      eyes((x) => { p.circle(x, ey, r, 0xffffff); p.ring(x, ey, r, ink, 1); p.rect(x, ey, 1, 1, ink); });
      p.circle(15, 23, 2.8, ink); p.circle(15, 23, 1.6, 0x6a1a2a);
      if (f) { p.vline(27, 4, 3, 0xffe066); p.px(27, 8, 0xffe066); }
      break;
    }
    case 4: // sleepy
      eyes((x) => { p.hline(x - 2, ey + 1, 5, ink); p.px(x - 2, ey, ink); p.px(x + 2, ey, ink); });
      if (f) { p.ellipse(15, 22, 2.2, 1.6, ink); p.px(15, 22, 0x6a1a2a); } else { p.hline(13, 22, 4, ink); p.vline(17, 23, 2, 0x8fd6ff); }
      p.stamp(f ? 21 : 22, f ? 1 : 3, ['aaaa', '..a.', '.a..', 'aaaa'], { a: 0x5a6fd0 });
      p.stamp(26, f ? 5 : 0, ['aaa', '.a.', 'aaa'], { a: 0x8f9be8 });
      break;
    case 5: // shy
      p.line(8, 11, 11, 11, ink); p.line(19, 11, 22, 11, ink);
      eyes((x) => { p.rect(x + 1, ey, 2, 2, ink); });
      p.ellipse(8, 19, 3.2, 1.8, f ? 0xff5a7a : L.blush); p.ellipse(22, 19, 3.2, 1.8, f ? 0xff5a7a : L.blush);
      for (const bx of [6, 8, 20, 22]) p.px(bx, 19, 0xffffff);
      p.px(13, 22, ink); p.px(14, 23, ink); p.px(15, 22, ink); p.px(16, 23, ink); p.px(17, 22, ink);
      p.ellipse(25, 9 + f, 1.4, 2, 0x8fd6ff); p.px(25, 8 + f, 0xffffff);
      break;
    case 6: // in love
      eyes((x) => p.stamp(x - 2, ey - 2, ['aa.aa', 'aaaaa', '.aaa.', '..a..'], { a: 0xff3a5a }));
      eyes((x) => p.px(x - 1, ey - 2, 0xffb3c0));
      p.hline(12, 22, 7, ink); p.px(11, 21, ink); p.px(19, 21, ink); p.hline(13, 23, 5, L.mouth);
      p.ellipse(7, 19, 2, 1.2, L.blush); p.ellipse(23, 19, 2, 1.2, L.blush);
      p.stamp(23, f ? 1 : 3, ['a.a', 'aaa', '.a.'], { a: 0xff7a95 });
      break;
  }
  if (sp === 2) { eyes((x) => p.ring(x, ey + 0.5, 3.4, 0x2b3263, 1)); p.hline(13, ey, 4, 0x2b3263); }
  if (sp === 3) { p.px(15, 19, 0xff5a7a); p.hline(3, 19, 4, 0x8a4a20); p.hline(24, 19, 4, 0x8a4a20); p.hline(3, 21, 4, 0x8a4a20); p.hline(24, 21, 4, 0x8a4a20); }
  p.outline(-0.75);
}

import Phaser from 'phaser';
import { buildCharacter } from '../../art/CharacterArt';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import type { PlayerIndex, PlayerResult } from '../../core/types';
import { characterById } from '../../data/characters';
import { Audio } from '../../systems/audio/AudioManager';
import { Party, rankBy } from '../../systems/party/Party';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { PanelKit, type Panel } from '../kit/PanelKit';

const GROUND = 46;
const POP_AT = 80;
const RED_PENALTY = 3;
const SIZES = 16;
const NOZZLE_X = 48;
const PUMP_X = -82;
const BTN_Y = 86;

type Light = 'green' | 'yellow' | 'red';

interface Pumper {
  p: PlayerIndex;
  pn: Panel;
  char: Phaser.GameObjects.Sprite;
  charKey: string;
  handle: Phaser.GameObjects.Image;
  balloon: Phaser.GameObjects.Sprite;
  string: Phaser.GameObjects.Image;
  lamp: Phaser.GameObjects.Image;
  btn: Phaser.GameObjects.Image;
  bar: Phaser.GameObjects.Rectangle;
  pct: Phaser.GameObjects.Text;
  stop: Phaser.GameObjects.Text;
  place: Phaser.GameObjects.Text;
  clouds: Phaser.GameObjects.TileSprite;
  flags: Phaser.GameObjects.TileSprite;
  wheel: Phaser.GameObjects.Sprite;
  air: number;
  popped: number;
  sizeIdx: number;
  pumpT: number;
  cpuT: number;
  cpuRate: number;
  cpuReact: number;
  cpuCaution: number;
  redTaps: number;
}

/** #18 — Mash to pump your balloon; freeze when the light says หยุด! First pop wins. */
export default class ButtonMasher extends BaseMinigame {
  private panels!: PanelKit;
  private ps: Pumper[] = [];
  private light: Light = 'green';
  private lightT = 0;
  private lightAt = 0;
  private popOrder: PlayerIndex[] = [];

  constructor() {
    super(CATALOG['button-masher']);
  }

  setup(): void {
    this.ps = [];
    this.popOrder = [];
    this.light = 'green';
    this.lightT = 3 + Math.random() * 1.5;
    this.lightAt = 0;
    this.paintArt();
    this.add.tileSprite(0, 0, this.vw / S, this.vh / S, 'bm-table').setOrigin(0).setScale(S).setDepth(-100);
    this.panels = new PanelKit(this, { frame: false, inset: 4 });
    for (const pn of this.panels.panels) this.buildPanel(pn);
    this.panels.onDown((p) => { if (!this.isCpu(p)) this.pump(p); });
    this.setLight('green', true);
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    makeTexture(this, 'bm-table', 32, 32, (p) => {
      p.rect(0, 0, 32, 32, 0x24304a);
      for (let y = 0; y < 32; y += 8) p.hline(0, y, 32, 0x1c2840);
    });
    makeTexture(this, 'bm-clouds', 160, 30, (p) => {
      const r = rng(5);
      for (let i = 0; i < 4; i++) {
        const cx = 18 + i * 40 + r() * 8, cy = 14 + r() * 8;
        p.ellipse(cx, cy, 13, 5, 0xffffff); p.ellipse(cx + 7, cy - 3, 8, 5, 0xffffff); p.ellipse(cx - 7, cy - 1, 6, 4, 0xffffff);
        p.hline(cx - 12, cy + 4, 24, 0xd6eaf8);
      }
    });
    makeTexture(this, 'bm-flags', 48, 12, (p) => {
      for (let x = 0; x < 48; x++) p.px(x, 1 + Math.round(Math.sin((x / 48) * Math.PI) * 3), 0xfff8e7);
      const cols = [0xff5a6e, 0xffe066, 0x3d9bff, 0x3ed17a];
      for (let i = 0; i < 4; i++) {
        const x = 3 + i * 12, y = 2 + Math.round(Math.sin(((x + 3) / 48) * Math.PI) * 3);
        p.tri(x, y, x + 7, y, x + 3.5, y + 7, cols[i]);
        p.px(x + 1, y + 1, shift(cols[i], 0.4));
      }
    });
    makeSheet(this, 'bm-wheel', 44, 44, 4, (p, i) => {
      const c = 22;
      p.ring(c, c, 20, 0x9aa8d8, 2);
      p.ring(c, c, 12, 0x8a98c8, 1);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4 + (i * Math.PI) / 16;
        p.line(c, c, Math.round(c + Math.cos(a) * 19), Math.round(c + Math.sin(a) * 19), 0x8a98c8);
        const cx = Math.round(c + Math.cos(a) * 20), cy = Math.round(c + Math.sin(a) * 20);
        p.rect(cx - 1, cy, 3, 3, [0xff7a85, 0xffe066, 0x6ec6ff, 0x7ee8b0][k % 4]);
      }
      p.circle(c, c, 2.5, 0xb8c4e8);
    });
    makeTexture(this, 'bm-pump', 18, 34, (p) => {
      p.rect(2, 30, 14, 4, 0x5a5a70); p.hline(2, 30, 14, 0x8a8aa0);
      p.box(5, 8, 8, 23, 0xd0d6e2);
      p.vline(6, 9, 21, 0xf4f6fa); p.vline(11, 9, 21, 0x9aa2b6);
      p.rect(4, 7, 10, 2, 0x8a92a8);
      p.rect(6, 15, 6, 4, 0xff5a3d); p.hline(6, 15, 6, 0xff8a6a);
      p.outline(-0.75);
    });
    makeTexture(this, 'bm-handle', 22, 22, (p) => {
      p.rect(9, 4, 3, 18, 0xa0a8b8); p.vline(9, 4, 18, 0xd0d6e2);
      p.box(0, 0, 22, 5, 0x3a3a4a);
      p.rect(0, 0, 4, 5, 0xff5a3d); p.rect(18, 0, 4, 5, 0xff5a3d);
      p.outline(-0.6);
    });
    makeTexture(this, 'bm-hose', 70, 10, (p) => {
      // from pump base (left) along the ground to the nozzle (right)
      for (let x = 0; x < 66; x++) {
        const y = 6 - Math.round(Math.sin((x / 66) * Math.PI) * 3);
        p.rect(x, y, 1, 3, 0x2b2b3a);
        p.px(x, y, 0x5a5a70);
      }
      p.rect(64, 0, 5, 7, 0x8a92a8); p.vline(64, 0, 7, 0xc0c8d8);
      p.outline(-0.6);
    });
    makeTexture(this, 'bm-light', 16, 52, (p) => {
      p.rect(6, 34, 4, 18, 0x5a5a70); p.vline(6, 34, 18, 0x8a8aa0);
      p.box(0, 0, 16, 36, 0x2b2b3a, 1);
      p.rect(1, 0, 14, 2, 0x4a4a5c);
      for (let k = 0; k < 3; k++) p.circle(8, 6.5 + k * 11, 4.5, 0x14141e);
      p.outline(-0.6);
    });
    for (const [name, k, c] of [['red', 0, 0xff3b3b], ['yellow', 1, 0xffd23a], ['green', 2, 0x3ee07a]] as const) {
      makeTexture(this, `bm-lamp-${name}`, 16, 36, (p) => {
        p.circle(8, 6.5 + k * 11, 6.5, c, 90);
        p.circle(8, 6.5 + k * 11, 4.5, c);
        p.circle(7, 5.5 + k * 11, 2, shift(c, 0.6));
      });
    }
    makeTexture(this, 'bm-shred', 4, 3, (p) => p.rect(0, 0, 4, 3, 0xffffff));
    makeTexture(this, 'bm-puff', 6, 6, (p) => { p.circle(3, 3, 3, 0xffffff); });
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const col = PLAYER_COLORS[p];
      // Balloon at every size (pre-painted so pixels stay crisp)
      makeSheet(this, `bm-balloon-${p}`, 64, 76, SIZES, (g, i) => {
        const r = 6 + (i / (SIZES - 1)) * 21;
        const ry = r * 1.12;
        const cx = 32, cy = 72 - ry - 3;
        g.tri(cx - 2, 72, cx + 2, 72, cx, 69, shift(col.main, -0.3));
        g.ball(cx, cy, r, ry, i >= SIZES - 3 ? shift(col.main, 0.15) : col.main, false);
        g.ellipse(cx - r * 0.38, cy - ry * 0.42, Math.max(1, r * 0.22), Math.max(1, ry * 0.32), shift(col.main, 0.55));
        g.px(Math.round(cx - r * 0.55), Math.round(cy - ry * 0.1), shift(col.main, 0.7));
        g.outline(-0.7);
      });
      makeTexture(this, `bm-btn-${p}`, 34, 30, (g) => {
        g.ellipse(17, 20, 16, 9, 0x2b2b3a);
        g.ellipse(17, 18, 15.5, 8.5, 0x4a4a5c);
        g.ellipse(17, 16, 12, 6.5, shift(col.main, -0.45));
        g.ellipse(17, 14, 12, 6.5, col.main);
        g.ellipse(14, 12, 5, 2, col.light);
        g.outline(-0.7);
      });
      makeTexture(this, `bm-btn-down-${p}`, 34, 30, (g) => {
        g.ellipse(17, 20, 16, 9, 0x2b2b3a);
        g.ellipse(17, 18, 15.5, 8.5, 0x4a4a5c);
        g.ellipse(17, 17, 12, 6.5, shift(col.main, -0.25));
        g.ellipse(14, 16, 5, 2, shift(col.main, 0.25));
        g.outline(-0.7);
      });
    }
  }

  private paintBg(pn: Panel): string {
    const aw = Math.ceil(pn.w / S), ah = Math.ceil(pn.h / S);
    return makeTexture(this, `bm-bg-${aw}x${ah}`, aw, ah, (p) => {
      const gy = Math.round((pn.h / 2 + GROUND) / S);
      p.gradient(0, 0, aw, gy, [0x4aa8ff, 0x7cc6ff, 0xbfe6ff]);
      const r = rng(8);
      // distant tents
      const tent = (x: number, w: number, c: number) => {
        const top = gy - 26;
        p.tri(x, gy - 12, x + w, gy - 12, x + w / 2, top, c);
        p.rect(x + 1, gy - 12, w - 2, 10, shift(c, -0.15));
        for (let k = 2; k < w - 2; k += 4) p.vline(x + k, gy - 12, 10, 0xfff8e7);
        p.vline(Math.round(x + w / 2), top - 3, 3, 0x5a5a70);
        p.px(Math.round(x + w / 2) + 1, top - 3, 0xff5a6e);
      };
      tent(Math.floor(aw * 0.05), 22, 0xd84a5a);
      tent(Math.floor(aw * 0.62), 26, 0x5a7ad8);
      // hills
      for (let x = 0; x < aw; x++) {
        const y = Math.round(gy - 6 - Math.sin(x * 0.05 + 1) * 3 - Math.sin(x * 0.13) * 1.5);
        p.vline(x, y, gy - y, 0x6cc06a);
        p.px(x, y, 0x8ad47a);
      }
      // grass
      p.gradient(0, gy, aw, ah - gy, [0x5ab85a, 0x4aa850, 0x3e9446]);
      for (let i = 0; i < aw * 1.2; i++) {
        const x = Math.floor(r() * aw), y = gy + 1 + Math.floor(r() * (ah - gy - 1));
        p.px(x, y, r() < 0.5 ? 0x6cc86a : 0x3a8a40);
      }
      for (let i = 0; i < 12; i++) {
        const x = Math.floor(r() * aw), y = gy + 3 + Math.floor(r() * 10);
        p.px(x, y, [0xffffff, 0xffe066, 0xff9fb0][i % 3]);
      }
      // console strip for the button
      const cy = Math.round((pn.h / 2 + BTN_Y - 22) / S);
      p.rect(0, cy, aw, ah - cy, 0x3a3048);
      p.hline(0, cy, aw, 0x5a4a6a);
      p.hline(0, cy + 1, aw, 0x2a2238);
      for (let x = 4; x < aw; x += 16) p.rect(x, cy + 4, 2, 2, 0x5a4a6a);
      for (let y = 0; y < ah; y++) { p.px(0, y, 0x1b1f3b, 120); p.px(aw - 1, y, 0x1b1f3b, 120); }
    });
  }

  private buildPanel(pn: Panel): void {
    const p = pn.p;
    const c = pn.c;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { c.add(o); return o; };
    add(this.add.image(0, 0, this.paintBg(pn)).setScale(S));
    const wheel = add(this.add.sprite(-pn.w * 0.16, GROUND - 60, 'bm-wheel', 0).setScale(S).setAlpha(0.75));
    const clouds = add(this.add.tileSprite(0, -pn.h / 2 + 34, pn.w / S, 30, 'bm-clouds').setScale(S).setAlpha(0.9));
    const flags = add(this.add.tileSprite(0, -pn.h / 2 + 12, pn.w / S, 12, 'bm-flags').setScale(S));
    const col = PLAYER_COLORS[p];
    add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));

    // traffic light
    const lx = pn.w / 2 - 26;
    add(this.add.image(lx, GROUND + 2, 'bm-light').setScale(S).setOrigin(0.5, 1));
    const lamp = add(this.add.image(lx, GROUND + 2 - 104, 'bm-lamp-green').setScale(S).setOrigin(0.5, 0));
    // hose, pump, character
    add(this.add.image(PUMP_X + 4, GROUND - 4, 'bm-hose').setScale(S).setOrigin(0, 0.5));
    const string = add(this.add.image(NOZZLE_X, GROUND - 6, 'bm-shred').setScale(S * 0.5).setVisible(false));
    const balloon = add(this.add.sprite(NOZZLE_X, GROUND - 8, `bm-balloon-${p}`, 0).setScale(S).setOrigin(0.5, 1));
    const handle = add(this.add.image(PUMP_X, GROUND - 60, 'bm-handle').setScale(S).setOrigin(0.5, 0));
    add(this.add.image(PUMP_X, GROUND + 2, 'bm-pump').setScale(S).setOrigin(0.5, 1));
    const ch = characterById(Party.slots[p].characterId);
    const charKey = buildCharacter(this, ch.id, ch.look);
    add(this.add.image(PUMP_X - 40, GROUND + 1, 'shadow').setScale(S * 0.8).setAlpha(0.3));
    const char = add(this.add.sprite(PUMP_X - 40, GROUND + 2, charKey, 0).setScale(S).setOrigin(0.5, 1));
    char.play(`${charKey}-idle`);

    const btn = add(this.add.image(0, BTN_Y, `bm-btn-${p}`).setScale(S));
    add(txt(this, 0, BTN_Y - 6, 'รัว!', { size: 13, color: '#ffffff', strokeWidth: 3 }));
    const barW = pn.w * 0.42;
    add(this.add.rectangle(-pn.w / 2 + 14 + barW / 2, -pn.h / 2 + 30, barW + 4, 10, 0x1b1f3b, 0.75));
    const bar = add(this.add.rectangle(-pn.w / 2 + 16, -pn.h / 2 + 30, 0, 6, col.main).setOrigin(0, 0.5));
    const pct = add(txt(this, -pn.w / 2 + 18 + barW, -pn.h / 2 + 30, 'ลม 0%', { size: 11, color: toCss(col.light), origin: [0, 0.5] }));
    const stop = add(txt(this, -16, -40, 'หยุด!', { size: 44, color: '#ff3b3b', strokeWidth: 8 }).setVisible(false));
    const place = add(txt(this, NOZZLE_X, -30, '', { size: 34, color: '#ffe066', strokeWidth: 7 }));
    this.ps.push({
      p, pn, char, charKey, handle, balloon, string, lamp, btn, bar, pct, stop, place, clouds, flags, wheel,
      air: 0, popped: -1, sizeIdx: 0, pumpT: 0, cpuT: 0, cpuRate: 5.6 + Math.random() * 1.8, cpuReact: 0.06 + Math.random() * 0.2,
      cpuCaution: Math.random(), redTaps: 0,
    });
  }

  // ───────────────────────────── LIGHT ─────────────────────────────

  private setLight(l: Light, quiet = false): void {
    this.light = l;
    this.lightAt = this.elapsed;
    for (const s of this.ps) {
      s.lamp.setTexture(`bm-lamp-${l}`);
      this.tweens.add({ targets: s.lamp, alpha: { from: 0.3, to: 1 }, duration: 120 });
      const red = l === 'red';
      s.stop.setVisible(red && s.popped < 0);
      if (red) { s.stop.setScale(0.3); this.tweens.add({ targets: s.stop, scale: 1, duration: 200, ease: 'Back.easeOut' }); }
    }
    if (quiet) return;
    if (l === 'red') { Audio.sfx('stun'); Audio.sfx('drum'); }
    else if (l === 'green') Audio.sfx('go');
    else Audio.sfx('tick');
  }

  private nextLight(): void {
    // Later in the round reds come more often and the warning gets shorter.
    const late = this.elapsed > 18;
    if (this.light === 'green') { this.setLight('yellow'); this.lightT = late ? 0.35 + Math.random() * 0.2 : 0.55 + Math.random() * 0.2; }
    else if (this.light === 'yellow') { this.setLight('red'); this.lightT = 0.9 + Math.random() * 1.2; }
    else { this.setLight('green'); this.lightT = (late ? 1.6 : 2.2) + Math.random() * 2.4; }
  }

  // ───────────────────────────── PUMP ─────────────────────────────

  private pump(p: PlayerIndex): void {
    const s = this.ps[p];
    if (!s || s.popped >= 0 || this.state !== 'play') return;
    s.pumpT = 0.09;
    s.handle.setY(GROUND - 46);
    s.btn.setTexture(`bm-btn-down-${p}`);
    s.char.play(`${s.charKey}-land`, true);
    if (this.light === 'red') {
      s.air = Math.max(0, s.air - RED_PENALTY);
      s.redTaps++;
      const w = this.panels.toWorld(p, NOZZLE_X, GROUND - 20);
      burst(this, w.x, w.y, { tex: 'bm-puff', count: 6, tint: [0xffffff, 0xdff0ff], speed: [40, 120], life: 420, scale: [S, 0] });
      Vfx.popText(this, w.x + (this.angleFor(p) === 180 ? -20 : 20), w.y + (this.angleFor(p) === 180 ? 50 : -50), 'ลมรั่ว!', '#ff7a85', 16, this.angleFor(p));
      Audio.sfx('whoosh', 1.3);
      Audio.blip(300, 0.12, 'sawtooth', 120, 0.08);
      this.tweens.add({ targets: s.stop, scale: { from: 1.3, to: 1 }, duration: 150 });
      this.updateBalloon(s, true);
      return;
    }
    s.air += 1;
    Audio.blip(220 + s.air * 7 + p * 12, 0.035, 'square', undefined, this.isCpu(p) ? 0.025 : 0.06);
    if (Math.random() < 0.35) {
      const w = this.panels.toWorld(p, PUMP_X + 30, GROUND - 4);
      burst(this, w.x, w.y, { tex: 'bm-puff', count: 2, tint: 0xffffff, speed: [20, 50], life: 300, scale: [S * 0.7, 0], alpha: [0.6, 0] });
    }
    if (s.air >= POP_AT) this.popBalloon(s);
    else this.updateBalloon(s, false);
  }

  private updateBalloon(s: Pumper, shrink: boolean): void {
    const idx = Math.min(SIZES - 1, Math.floor((s.air / POP_AT) * SIZES));
    if (idx !== s.sizeIdx) {
      s.sizeIdx = idx;
      s.balloon.setFrame(idx);
    }
    if (shrink) Vfx.squash(this, s.balloon, 0.85, 1.1, 180);
    else if (Math.random() < 0.4) Vfx.squash(this, s.balloon, 1.06, 0.95, 90);
  }

  private popBalloon(s: Pumper): void {
    s.popped = this.popOrder.length;
    this.popOrder.push(s.p);
    s.air = POP_AT;
    s.balloon.setVisible(false);
    s.stop.setVisible(false);
    const r = 6 + 21;
    const w = this.panels.toWorld(s.p, NOZZLE_X, GROUND - 8 - r * 1.12 * S);
    const col = PLAYER_COLORS[s.p];
    burst(this, w.x, w.y, { tex: 'bm-shred', count: 26, tint: [col.main, col.light, col.dark], speed: [120, 320], life: 900, gravity: this.angleFor(s.p) === 180 ? -300 : 300, rotate: true, scale: [S, S * 0.6] });
    Vfx.confetti(this, w.x, w.y, 40);
    Vfx.flash(this, 0xffffff, 60);
    Vfx.shake(this, 0.006, 150);
    Audio.sfx('explode', 1.2);
    Audio.sfx('pop', 1 + s.p * 0.1);
    const place = s.popped + 1;
    s.place.setText(`แตก! ที่ ${place}`).setColor(place === 1 ? '#ffe066' : '#fff8e7').setScale(0.3);
    this.tweens.add({ targets: s.place, scale: 1, duration: 300, ease: 'Back.easeOut' });
    s.char.play(`${s.charKey}-${place === 1 ? 'win' : 'cheer'}`, true);
    this.score[s.p] = 5 - place;
    this.addScore(s.p, 0);
    for (const o of this.ps) o.btn.setAlpha(o.popped >= 0 ? 0.5 : 1);
    if (this.players.every((p) => this.ps[p].popped >= 0)) this.time.delayedCall(900, () => this.finish());
  }

  // ───────────────────────────── LOOP ─────────────────────────────

  tick(dt: number): void {
    this.lightT -= dt;
    if (this.lightT <= 0) this.nextLight();
    const sinceChange = this.elapsed - this.lightAt;
    for (const s of this.ps) {
      if (!this.players.includes(s.p) || !this.isCpu(s.p) || s.popped >= 0) continue;
      // CPUs keep mashing for a moment after red appears (reaction time) — and cautious ones stop at yellow.
      const stopped = (this.light === 'red' && sinceChange > s.cpuReact) || (this.light === 'yellow' && s.cpuCaution > 0.6 && sinceChange > 0.2);
      if (stopped) continue;
      s.cpuT -= dt;
      if (s.cpuT <= 0) {
        const rate = s.cpuRate + Math.sin(this.elapsed * 0.9 + s.p * 2) * 0.9;
        s.cpuT = 1 / rate * (0.8 + Math.random() * 0.4);
        this.pump(s.p);
      }
    }
    for (const p of this.players) {
      const s = this.ps[p];
      if (s.popped < 0) this.hudText[p] = `${Math.round((s.air / POP_AT) * 100)}%`;
      else this.hudText[p] = `ที่ ${s.popped + 1}`;
    }
  }

  ambient(dt: number): void {
    const now = this.time.now / 1000;
    for (const s of this.ps) {
      s.clouds.tilePositionX += dt * 5;
      s.flags.tilePositionX = Math.sin(now * 2 + s.p) * 1.5;
      s.wheel.setFrame(Math.floor(now * 3) & 3);
      if (s.pumpT > 0) {
        s.pumpT -= dt;
        if (s.pumpT <= 0) {
          s.handle.setY(GROUND - 60);
          s.btn.setTexture(`bm-btn-${s.p}`);
          if (s.popped < 0) s.char.play(`${s.charKey}-idle`, true);
        }
      }
      const f = s.air / POP_AT;
      s.bar.width = (s.pn.w * 0.42) * f;
      s.bar.fillColor = f > 0.8 ? 0xffe066 : PLAYER_COLORS[s.p].main;
      const label = s.popped >= 0 ? 'แตกแล้ว!' : `ลม ${Math.round(f * 100)}%`;
      if (s.pct.text !== label) s.pct.setText(label);
      // close to popping: the balloon trembles
      if (s.popped < 0 && f > 0.75 && !this.tweens.isTweening(s.balloon)) s.balloon.x = NOZZLE_X + Math.sin(now * 40) * (f - 0.7) * 6;
      if (s.stop.visible) s.stop.setAngle(Math.sin(now * 18) * 3);
    }
  }

  results(): PlayerResult[] {
    const value = (p: PlayerIndex) => {
      const s = this.ps[p];
      return s.popped >= 0 ? 1000 - s.popped : s.air;
    };
    return rankBy(this.players, value).map((r) => {
      const s = this.ps[r.player];
      return { ...r, score: s.popped >= 0 ? 100 : Math.round((s.air / POP_AT) * 100) };
    });
  }
}

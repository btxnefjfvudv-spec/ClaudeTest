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

const ROUNDS = 5;
const FAKES = ['ยิ้ม!', 'ยิว!', 'ยิง?', 'ยิม!', 'ยืน!'];
const GROUND_Y = 58;
const SIGN_Y = -50;
const FAKE_SHOW = 0.55;

type Phase = 'pre' | 'wait' | 'draw' | 'result';

interface Gun {
  p: PlayerIndex;
  pn: Panel;
  char: Phaser.GameObjects.Sprite;
  charKey: string;
  pistol: Phaser.GameObjects.Image;
  target: Phaser.GameObjects.Image;
  targetShadow: Phaser.GameObjects.Image;
  sign: Phaser.GameObjects.Container;
  signText: Phaser.GameObjects.Text;
  roundText: Phaser.GameObjects.Text;
  status: Phaser.GameObjects.Text;
  timeText: Phaser.GameObjects.Text;
  drops: Phaser.GameObjects.Image[];
  clouds: Phaser.GameObjects.TileSprite;
  weed: Phaser.GameObjects.Sprite;
  weedX: number;
  weedV: number;
  weedT: number;
  sun: Phaser.GameObjects.Image;
  /** Round state */
  fouled: boolean;
  rt: number;
  wins: number;
  rts: number[];
  cpuRt: number;
  cpuFoulAt: number;
  cpuBase: number;
}

/** #16 — Water-pistol duel: wait for "ยิง!", ignore the fake words, fastest finger wins the round. */
export default class QuickDraw extends BaseMinigame {
  private panels!: PanelKit;
  private guns: Gun[] = [];
  private round = 0;
  private phase: Phase = 'pre';
  private phaseT = 0;
  private waitDur = 3;
  private fakes: { t: number; word: string; shown: boolean; hidden: boolean }[] = [];
  private firstTap = -1;
  private winner: PlayerIndex | -1 = -1;

  constructor() {
    super(CATALOG['quick-draw']);
  }

  setup(): void {
    this.guns = [];
    this.round = 0;
    this.phase = 'pre';
    this.phaseT = 0;
    this.winner = -1;
    this.firstTap = -1;
    this.paintArt();
    this.add.tileSprite(0, 0, this.vw / S, this.vh / S, 'qd-table').setOrigin(0).setScale(S).setDepth(-100);
    this.panels = new PanelKit(this, { frame: false, inset: 4 });
    for (const pn of this.panels.panels) this.buildPanel(pn);
    this.panels.onDown((p) => {
      if (!this.isCpu(p)) this.tapped(p);
    });
    this.startRound();
  }

  // ───────────────────────────── ART ─────────────────────────────

  private paintArt(): void {
    makeTexture(this, 'qd-table', 32, 32, (p) => {
      p.rect(0, 0, 32, 32, 0x3a2a2e);
      for (let y = 0; y < 32; y += 8) p.hline(0, y, 32, 0x2a1e24);
      const r = rng(3);
      for (let i = 0; i < 20; i++) p.hline(Math.floor(r() * 30), Math.floor(r() * 32), 3, 0x46343a);
    });
    // clouds (tileable strip)
    makeTexture(this, 'qd-clouds', 128, 24, (p) => {
      const r = rng(11);
      for (let i = 0; i < 4; i++) {
        const cx = 14 + i * 32 + r() * 8, cy = 10 + r() * 6;
        p.ellipse(cx, cy, 12, 4, 0xffb3a0);
        p.ellipse(cx + 6, cy - 2, 8, 4, 0xffc9b0);
        p.hline(cx - 10, cy + 3, 22, 0xe0808a);
      }
    });
    makeTexture(this, 'qd-sun', 30, 30, (p) => {
      p.circle(15, 15, 14.5, 0xffb070, 90);
      p.circle(15, 15, 12, 0xffc98a, 140);
      p.circle(15, 15, 9, 0xffe9a0);
      p.circle(13, 13, 5, 0xfff6d0);
    });
    makeSheet(this, 'qd-weed', 12, 12, 4, (p, i) => {
      const a0 = (i * Math.PI) / 8;
      p.circle(6, 6, 5, 0x9a6a3a, 0);
      for (let k = 0; k < 9; k++) {
        const a = a0 + (k * Math.PI * 2) / 9;
        p.line(6, 6, Math.round(6 + Math.cos(a) * 5), Math.round(6 + Math.sin(a) * 5), k % 2 ? 0xb07c44 : 0x8a5a30);
      }
      p.ring(6, 6, 5, 0xc08a50, 1);
      p.ring(6, 6, 3, 0x8a5a30, 1);
      p.outline(-0.6);
    });
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const c = PLAYER_COLORS[p];
      makeTexture(this, `qd-pistol-${p}`, 12, 9, (g) => {
        g.box(1, 2, 8, 3, c.main);
        g.rect(9, 3, 3, 1, shift(c.main, -0.3));
        g.box(2, 4, 3, 5, shift(c.main, -0.25));
        g.ball(5, 1.8, 2.2, 1.8, 0xff9f43);
        g.px(4, 1, 0xffe6b0);
        g.px(6, 5, 0x2b2b3a);
        g.outline(-0.7);
      });
    }
    makeTexture(this, 'qd-target', 22, 34, (p) => {
      p.rect(9, 18, 4, 16, 0x8a5a30); p.vline(9, 18, 16, 0xb07c44);
      p.stroke(4, 33, 9, 26, 2, 0x7a4a28); p.stroke(17, 33, 13, 26, 2, 0x7a4a28);
      p.circle(11, 11, 10.5, 0xf4efe4);
      p.circle(11, 11, 8.5, 0xe0475a);
      p.circle(11, 11, 6.5, 0xf4efe4);
      p.circle(11, 11, 4.5, 0xe0475a);
      p.circle(11, 11, 2.2, 0xffe066);
      p.px(7, 5, 0xffffff); p.px(6, 6, 0xffffff);
      p.outline(-0.7);
    });
    makeTexture(this, 'qd-target-wet', 22, 34, (p) => {
      p.rect(9, 18, 4, 16, 0x6a4628);
      p.stroke(4, 33, 9, 26, 2, 0x5a3a20); p.stroke(17, 33, 13, 26, 2, 0x5a3a20);
      p.circle(11, 11, 10.5, 0xb8d8f0);
      p.circle(11, 11, 8.5, 0x9a3a5a);
      p.circle(11, 11, 6.5, 0xb8d8f0);
      p.circle(11, 11, 4.5, 0x9a3a5a);
      p.circle(11, 11, 2.2, 0xc0b060);
      for (const [x, y] of [[4, 14], [15, 17], [10, 20], [18, 9]]) { p.vline(x, y, 3, 0x6cc8f4); p.px(x, y + 3, 0xbfeaff); }
      p.outline(-0.7);
    });
    makeTexture(this, 'qd-sign', 76, 24, (p) => {
      p.rect(6, 20, 3, 4, 0x6a4628); p.rect(67, 20, 3, 4, 0x6a4628);
      p.box(0, 0, 76, 21, 0xe8c48a);
      for (let y = 6; y < 20; y += 6) p.hline(1, y, 74, 0xc9a06a);
      p.rect(2, 2, 2, 2, 0x8a6a4a); p.rect(72, 2, 2, 2, 0x8a6a4a); p.rect(2, 17, 2, 2, 0x8a6a4a); p.rect(72, 17, 2, 2, 0x8a6a4a);
      p.outline(-0.75);
    });
    makeTexture(this, 'qd-drop-on', 7, 9, (p) => {
      p.tri(3.5, 0, 0.5, 5, 6.5, 5, 0x3fb8ff);
      p.ball(3.5, 5.5, 3, 3, 0x3fb8ff);
      p.px(2, 5, 0xdff6ff);
      p.outline(-0.7);
    });
    makeTexture(this, 'qd-drop-off', 7, 9, (p) => {
      p.tri(3.5, 0, 0.5, 5, 6.5, 5, 0xc9b8d6);
      p.ball(3.5, 5.5, 3, 3, 0xc9b8d6, false);
      p.tri(3.5, 2.5, 2, 5, 5, 5, 0x4a3a5e);
      p.circle(3.5, 5.5, 1.8, 0x4a3a5e);
      p.outline(-0.6);
    });
    makeTexture(this, 'qd-droplet', 4, 4, (p) => { p.circle(2, 2, 2, 0x6cc8f4); p.px(1, 1, 0xffffff); });
    makeTexture(this, 'qd-balloon', 12, 14, (p) => {
      p.ball(6, 6, 5.5, 6, 0x5ac0ff);
      p.tri(4.5, 12, 7.5, 12, 6, 13.5, 0x3a90d0);
      p.outline(-0.7);
    });
  }

  private paintBg(pn: Panel): string {
    const aw = Math.ceil(pn.w / S), ah = Math.ceil(pn.h / S);
    return makeTexture(this, `qd-bg-${aw}x${ah}`, aw, ah, (p) => {
      const hz = Math.floor(ah * 0.5);
      p.gradient(0, 0, aw, hz, [0x3b2a6b, 0x7a3a78, 0xd85a6a, 0xff9a5a, 0xffd07a]);
      const r = rng(7);
      // far mesas
      let hgt = 10;
      for (let x = 0; x < aw; x++) {
        if (r() < 0.12) hgt = Phaser.Math.Clamp(hgt + (r() < 0.5 ? -4 : 4), 4, 18);
        p.vline(x, hz - hgt, hgt, 0x9a4a6a);
        p.px(x, hz - hgt, 0xb8607a);
      }
      // nearer hills + school water tower silhouette
      for (let x = 0; x < aw; x++) {
        const y = Math.round(hz - 4 - Math.sin(x * 0.07) * 3 - Math.sin(x * 0.19) * 1.5);
        p.vline(x, y, hz - y + 1, 0x6a3058);
      }
      const tx = Math.floor(aw * 0.2);
      p.rect(tx, hz - 26, 12, 9, 0x6a3058); p.rect(tx - 1, hz - 27, 14, 2, 0x5a2850);
      p.vline(tx + 1, hz - 17, 14, 0x5a2850); p.vline(tx + 10, hz - 17, 14, 0x5a2850);
      p.line(tx + 1, hz - 14, tx + 10, hz - 8, 0x5a2850); p.line(tx + 10, hz - 14, tx + 1, hz - 8, 0x5a2850);
      // ground
      p.gradient(0, hz, aw, ah - hz, [0xc07a50, 0xd9955e, 0xe6aa6a]);
      for (let i = 0; i < aw * 0.9; i++) {
        const x = Math.floor(r() * aw), y = hz + 2 + Math.floor(r() * (ah - hz - 2));
        p.hline(x, y, 1 + Math.floor(r() * 3), r() < 0.5 ? 0xb06a44 : 0xf0bc7a);
      }
      // fence
      const fy = hz + 4;
      for (let x = 2; x < aw; x += 9) { p.rect(x, fy - 6, 2, 9, 0x8a5a3a); p.px(x, fy - 6, 0xb07c50); }
      p.hline(0, fy - 4, aw, 0x9a6a44); p.hline(0, fy - 1, aw, 0x9a6a44);
      // duel lane (dusty path)
      const gy = Math.round((pn.h / 2 + GROUND_Y) / S);
      p.dither(0, gy - 4, aw, 8, 0xd9955e, 0xecb87a, 0.5);
      // cacti + tufts
      const cac = (x: number, y: number) => {
        p.rect(x, y - 10, 3, 10, 0x4a9a5a); p.vline(x, y - 10, 10, 0x6cc070);
        p.rect(x - 3, y - 7, 2, 4, 0x4a9a5a); p.rect(x - 3, y - 8, 1, 2, 0x4a9a5a);
        p.rect(x + 4, y - 6, 2, 3, 0x3a7a4a); p.rect(x + 5, y - 8, 1, 3, 0x3a7a4a);
      };
      cac(Math.floor(aw * 0.9), hz + 16);
      cac(Math.floor(aw * 0.06), hz + 26);
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(r() * aw), y = hz + 10 + Math.floor(r() * (ah - hz - 12));
        p.px(x, y, 0x8a8a40); p.px(x + 1, y - 1, 0xa0a050); p.px(x + 2, y, 0x8a8a40);
      }
      // vignette edges
      for (let y = 0; y < ah; y++) { p.px(0, y, 0x1b1f3b, 120); p.px(aw - 1, y, 0x1b1f3b, 120); }
    });
  }

  private buildPanel(pn: Panel): void {
    const p = pn.p;
    const c = pn.c;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { c.add(o); return o; };
    add(this.add.image(0, 0, this.paintBg(pn)).setScale(S));
    const hz = -pn.h / 2 + Math.floor(Math.ceil(pn.h / S) * 0.5) * S;
    const sun = add(this.add.image(-pn.w * 0.4, hz - 30, 'qd-sun').setScale(S).setAlpha(0.95));
    const clouds = add(this.add.tileSprite(0, -pn.h / 2 + 26, pn.w / S, 24, 'qd-clouds').setScale(S).setAlpha(0.85));
    const weed = add(this.add.sprite(0, GROUND_Y + 22, 'qd-weed', 0).setScale(S).setOrigin(0.5, 1).setAlpha(0));
    // frame
    const col = PLAYER_COLORS[p];
    add(this.add.rectangle(0, 0, pn.w, pn.h).setStrokeStyle(3, col.main, 0.95));
    add(this.add.rectangle(0, 0, pn.w - 6, pn.h - 6).setStrokeStyle(1, 0x1b1f3b, 0.6));

    const targetShadow = add(this.add.image(pn.w * 0.3, GROUND_Y + 1, 'shadow').setScale(S * 0.9, S * 0.8).setAlpha(0.3));
    const target = add(this.add.image(pn.w * 0.3, GROUND_Y + 2, 'qd-target').setScale(S).setOrigin(0.5, 1));
    add(this.add.image(-pn.w * 0.28, GROUND_Y + 1, 'shadow').setScale(S * 0.8, S * 0.8).setAlpha(0.3));
    const ch = characterById(Party.slots[p].characterId);
    const charKey = buildCharacter(this, ch.id, ch.look);
    const char = add(this.add.sprite(-pn.w * 0.28, GROUND_Y + 2, charKey, 0).setScale(S).setOrigin(0.5, 1));
    char.play(`${charKey}-idle`);
    const pistol = add(this.add.image(char.x + 6, GROUND_Y - 18, `qd-pistol-${p}`).setScale(S).setAngle(90));

    const sign = this.add.container(0, SIGN_Y);
    c.add(sign);
    sign.add(this.add.image(0, 0, 'qd-sign').setScale(S));
    const signText = txt(this, 0, -3, '', { size: 28, color: '#b3263a', strokeWidth: 0, shadow: false });
    sign.add(signText);

    const roundText = add(txt(this, -pn.w / 2 + 12, -pn.h / 2 + 14, '', { size: 13, color: '#fff8e7', origin: [0, 0.5] }));
    const drops: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < ROUNDS; i++) drops.push(add(this.add.image(pn.w / 2 - 14 - (ROUNDS - 1 - i) * 17, -pn.h / 2 + 15, 'qd-drop-off').setScale(S)));
    const status = add(txt(this, 0, 10, '', { size: 22, color: '#ffe066', strokeWidth: 5 }));
    const timeText = add(txt(this, char.x - 6, GROUND_Y - 76, '', { size: 14, color: toCss(col.light) }));

    this.guns.push({
      p, pn, char, charKey, pistol, target, targetShadow, sign, signText, roundText, status, timeText, drops, clouds,
      weed, weedX: -pn.w, weedV: 0, weedT: 1 + Math.random() * 4, sun,
      fouled: false, rt: -1, wins: 0, rts: [], cpuRt: 0.3, cpuFoulAt: -1, cpuBase: 0.27 + Math.random() * 0.09,
    });
  }

  // ───────────────────────────── ROUNDS ─────────────────────────────

  private active(): Gun[] {
    return this.guns.filter((g) => this.players.includes(g.p));
  }

  private startRound(): void {
    this.phase = 'pre';
    this.phaseT = 0;
    this.winner = -1;
    this.firstTap = -1;
    this.waitDur = 1.5 + Math.random() * 3.5;
    // Fake-outs: more likely in later rounds, never right before the real signal.
    this.fakes = [];
    const nFakes = this.waitDur < 2.4 ? 0 : Math.random() < 0.25 + this.round * 0.15 ? (Math.random() < 0.35 && this.waitDur > 3.6 ? 2 : 1) : 0;
    const slots = nFakes === 2 ? [0.25, 0.6] : [0.35 + Math.random() * 0.3];
    for (let i = 0; i < nFakes; i++) {
      const t = 0.8 + (this.waitDur - FAKE_SHOW - 1.2) * slots[i];
      this.fakes.push({ t, word: FAKES[Math.floor(Math.random() * FAKES.length)], shown: false, hidden: false });
    }
    for (const g of this.guns) {
      g.fouled = false;
      g.rt = -1;
      g.status.setText('');
      g.timeText.setText('');
      g.target.setTexture('qd-target').setAngle(0).setScale(S).setY(GROUND_Y + 2).setAlpha(1);
      g.targetShadow.setVisible(true);
      g.char.clearTint();
      g.char.play(`${g.charKey}-idle`, true);
      this.holster(g);
      g.roundText.setText(`รอบ ${this.round + 1}/${ROUNDS}`);
      g.signText.setText(this.round === ROUNDS - 1 ? 'รอบสุดท้าย!' : `รอบ ${this.round + 1}`).setColor('#2b3263').setFontSize(22);
      this.popSign(g);
      // CPU plan for this round
      g.cpuRt = g.cpuBase + Math.random() * 0.17 + (Math.random() < 0.12 ? 0.25 : 0);
      g.cpuFoulAt = -1;
      if (this.isCpu(g.p)) {
        for (const f of this.fakes) if (g.cpuFoulAt < 0 && Math.random() < 0.07) g.cpuFoulAt = f.t + 0.22 + Math.random() * 0.15;
        if (g.cpuFoulAt < 0 && Math.random() < 0.025) g.cpuFoulAt = 0.6 + Math.random() * (this.waitDur - 0.7);
      }
    }
  }

  private popSign(g: Gun): void {
    this.tweens.killTweensOf(g.sign);
    g.sign.setVisible(true).setScale(0.6).setAngle(0);
    this.tweens.add({ targets: g.sign, scale: 1, duration: 160, ease: 'Back.easeOut' });
  }

  private setSign(word: string, real: boolean): void {
    for (const g of this.guns) {
      g.signText.setText(word).setColor(real ? '#d62f3c' : '#d62f3c').setFontSize(34);
      this.popSign(g);
      this.tweens.add({ targets: g.sign, angle: { from: -4, to: 0 }, duration: 200 });
    }
    Audio.sfx('drum');
    Audio.sfx('whoosh');
  }

  private holster(g: Gun): void {
    g.pistol.setPosition(g.char.x + 9, GROUND_Y - 22).setAngle(90).setVisible(true);
  }

  private draw(g: Gun): void {
    g.pistol.setPosition(g.char.x + 24, GROUND_Y - 38).setAngle(0);
    g.char.play(`${g.charKey}-attack`, true);
  }

  tick(dt: number): void {
    this.phaseT += dt;
    const t = this.phaseT;
    if (this.phase === 'pre') {
      if (t >= 1.1) {
        this.phase = 'wait';
        this.phaseT = 0;
        for (const g of this.guns) {
          g.signText.setText('เตรียม...').setColor('#6a5a7a').setFontSize(20);
          this.popSign(g);
        }
        Audio.sfx('tick');
      }
    } else if (this.phase === 'wait') {
      for (const f of this.fakes) {
        if (!f.shown && t >= f.t) { f.shown = true; this.setSign(f.word, false); }
        if (f.shown && !f.hidden && t >= f.t + FAKE_SHOW) {
          f.hidden = true;
          for (const g of this.guns) { g.signText.setText('เตรียม...').setColor('#6a5a7a').setFontSize(20); }
        }
      }
      for (const g of this.active()) if (this.isCpu(g.p) && g.cpuFoulAt >= 0 && t >= g.cpuFoulAt && !g.fouled) this.tapped(g.p);
      if (t >= this.waitDur) {
        this.phase = 'draw';
        this.phaseT = 0;
        this.setSign('ยิง!', true);
      }
    } else if (this.phase === 'draw') {
      for (const g of this.active()) if (this.isCpu(g.p) && !g.fouled && g.rt < 0 && t >= g.cpuRt) this.tapped(g.p);
      const pending = this.active().filter((g) => !g.fouled && g.rt < 0);
      if ((this.firstTap >= 0 && (t > this.firstTap + 0.8 || pending.length === 0)) || t > 2.6) this.resolve();
    } else if (this.phase === 'result') {
      if (t >= 2.3) {
        this.round++;
        if (this.round >= ROUNDS) this.finish();
        else this.startRound();
      }
    }
  }

  private tapped(p: PlayerIndex): void {
    const g = this.guns[p];
    if (!g || g.fouled || g.rt >= 0) return;
    if (this.phase === 'wait') return this.foul(g);
    if (this.phase !== 'draw') return;
    g.rt = this.phaseT;
    g.rts.push(g.rt);
    const first = this.firstTap < 0;
    if (first) { this.firstTap = this.phaseT; this.winner = p; }
    this.shoot(g, first);
    g.timeText.setText(`${g.rt.toFixed(2)} วิ`);
    this.tweens.add({ targets: g.timeText, scale: { from: 1.5, to: 1 }, duration: 200, ease: 'Back.easeOut' });
  }

  private foul(g: Gun): void {
    g.fouled = true;
    g.char.play(`${g.charKey}-stun`, true);
    this.draw(g);
    g.pistol.setAngle(-130).setPosition(g.char.x + 10, GROUND_Y - 44);
    g.status.setText('ฟาวล์! ยิงก่อน').setColor('#ff7a85');
    g.status.setScale(1.6);
    this.tweens.add({ targets: g.status, scale: 1, duration: 220, ease: 'Back.easeOut' });
    // squirted yourself in the face
    const w = this.panels.toWorld(g.p, g.char.x, GROUND_Y - 52);
    burst(this, w.x, w.y, { tex: 'qd-droplet', count: 12, tint: [0xffffff, 0xbfeaff, 0x6cc8f4], speed: [40, 120], gravity: g.pn.zone.facing === 180 ? -300 : 300, life: 600, scale: [S, S * 0.4] });
    g.char.setTint(0xbfe4ff);
    Audio.sfx('wrong', 1 + g.p * 0.1);
    Audio.sfx('splash');
    Vfx.squash(this, g.char, 1.2, 0.8, 200);
  }

  private shoot(g: Gun, first: boolean): void {
    this.draw(g);
    Audio.sfx('shoot', 1 + g.p * 0.1);
    Vfx.squash(this, g.char, 0.9, 1.1, 120);
    // water jet: droplets flying in an arc to the target
    const sx = g.pistol.x + 14, sy = g.pistol.y - 2;
    const tx = g.target.x, ty = GROUND_Y - 44;
    for (let i = 0; i < 9; i++) {
      const d = this.add.image(sx, sy, 'qd-droplet').setScale(S);
      g.pn.c.add(d);
      const delay = i * 22;
      this.tweens.add({
        targets: d, x: tx + Phaser.Math.Between(-4, 4), duration: 220, delay, ease: 'Linear',
        onUpdate: (tw) => { d.y = sy + (ty - sy) * tw.progress - Math.sin(tw.progress * Math.PI) * 18; },
        onComplete: () => d.destroy(),
      });
    }
    this.time.delayedCall(240, () => {
      if (!g.target.active) return;
      const w = this.panels.toWorld(g.p, tx, ty);
      burst(this, w.x, w.y, { tex: 'qd-droplet', count: first ? 16 : 8, tint: [0xffffff, 0xbfeaff, 0x6cc8f4], speed: [50, 150], gravity: g.pn.zone.facing === 180 ? -350 : 350, life: 600, scale: [S, S * 0.4] });
      Audio.sfx('splash', 1.2);
      if (first) {
        g.target.setTexture('qd-target-wet');
        this.tweens.add({ targets: g.target, scaleX: { from: S, to: -S }, duration: 140, yoyo: true, repeat: 1 });
      } else {
        this.tweens.add({ targets: g.target, angle: { from: -6, to: 0 }, duration: 260, ease: 'Back.easeOut' });
      }
    });
  }

  private resolve(): void {
    this.phase = 'result';
    this.phaseT = 0;
    const win = this.winner;
    for (const g of this.guns) g.signText.setText(win === -1 ? 'ไม่มีใครชนะ' : 'ปัง!').setFontSize(win === -1 ? 22 : 34);
    for (const g of this.active()) {
      if (g.p === win) {
        g.wins++;
        this.addScore(g.p, 1);
        g.drops[g.wins - 1]?.setTexture('qd-drop-on');
        if (g.drops[g.wins - 1]) this.tweens.add({ targets: g.drops[g.wins - 1], scale: { from: S * 2, to: S }, duration: 300, ease: 'Back.easeOut' });
        g.status.setText('ไวที่สุด!').setColor('#ffe066').setScale(0.3);
        this.tweens.add({ targets: g.status, scale: 1, duration: 260, ease: 'Back.easeOut' });
        this.time.delayedCall(300, () => g.char.active && g.char.play(`${g.charKey}-win`, true));
        this.tweens.add({ targets: g.target, y: GROUND_Y + 8, angle: 55, alpha: 0.75, delay: 450, duration: 380, ease: 'Bounce.easeOut' });
        g.targetShadow.setVisible(false);
        const w = this.panels.toWorld(g.p, 0, 0);
        Vfx.confetti(this, w.x, w.y + (g.pn.zone.facing === 180 ? 40 : -40), 28);
        Audio.sfx('right', 1 + g.p * 0.1);
      } else {
        this.dunk(g);
        if (!g.fouled) g.status.setText(g.rt < 0 ? 'ช้าไป!' : 'เกือบแล้ว!').setColor('#a8d3ff');
      }
    }
  }

  /** A water balloon drops on a loser. */
  private dunk(g: Gun): void {
    const b = this.add.image(g.char.x, -g.pn.h / 2 + 30, 'qd-balloon').setScale(S).setAlpha(0);
    this.tweens.add({ targets: b, alpha: 1, duration: 120, delay: 200 });
    g.pn.c.add(b);
    this.tweens.add({
      targets: b, y: GROUND_Y - 56, duration: 380, delay: 200, ease: 'Quad.easeIn',
      onComplete: () => {
        b.destroy();
        if (!g.char.active) return;
        const w = this.panels.toWorld(g.p, g.char.x, GROUND_Y - 56);
        burst(this, w.x, w.y, { tex: 'qd-droplet', count: 22, tint: [0xffffff, 0xbfeaff, 0x6cc8f4, 0x3fb8ff], speed: [60, 190], gravity: g.pn.zone.facing === 180 ? -420 : 420, life: 700, scale: [S * 1.2, S * 0.4] });
        Audio.sfx('splash', 0.9 + g.p * 0.05);
        g.char.setTint(0xcdeeff);
        this.drip(g);
        g.char.play(`${g.charKey}-hit`, true);
        Vfx.squash(this, g.char, 1.35, 0.7, 260);
        g.pistol.setVisible(false);
        this.time.delayedCall(420, () => g.char.active && g.char.play(`${g.charKey}-lose`, true));
      },
    });
  }

  /** Water dripping off a soaked player for a moment. */
  private drip(g: Gun): void {
    for (let i = 0; i < 6; i++) {
      this.time.delayedCall(120 + i * 160, () => {
        if (!g.char.active) return;
        const d = this.add.image(g.char.x + Phaser.Math.Between(-12, 12), GROUND_Y - Phaser.Math.Between(20, 56), 'qd-droplet').setScale(S);
        g.pn.c.add(d);
        this.tweens.add({ targets: d, y: GROUND_Y, alpha: 0.2, duration: 380, ease: 'Quad.easeIn', onComplete: () => d.destroy() });
      });
    }
  }

  ambient(dt: number): void {
    const now = this.time.now / 1000;
    for (const g of this.guns) {
      g.clouds.tilePositionX += dt * 4;
      g.sun.setAlpha(0.88 + Math.sin(now * 1.5 + g.p) * 0.08);
      // tumbleweed bouncing across the lane now and then
      if (g.weedV === 0) {
        g.weedT -= dt;
        if (g.weedT <= 0) { g.weedV = 60 + Math.random() * 40; g.weedX = -g.pn.w / 2 + 14; }
      } else {
        g.weedX += g.weedV * dt;
        const hop = Math.abs(Math.sin(g.weedX * 0.05)) * 10;
        const edge = Math.min(g.weedX + g.pn.w / 2 - 14, g.pn.w / 2 - 14 - g.weedX);
        g.weed.setPosition(g.weedX, GROUND_Y + 22 - hop).setFrame(Math.floor(g.weedX / 8) & 3).setAlpha(Phaser.Math.Clamp(edge / 30, 0, 1));
        if (g.weedX > g.pn.w / 2 - 14) { g.weedV = 0; g.weedT = 4 + Math.random() * 6; g.weed.setAlpha(0); }
      }
      // twitchy trigger finger during the wait
      if (this.phase === 'wait' && !g.fouled) g.pistol.setY(GROUND_Y - 20 + (Math.sin(now * 9 + g.p * 2) > 0.85 ? -1 : 0));
    }
  }

  results(): PlayerResult[] {
    const avg = (g: Gun) => (g.rts.length ? g.rts.reduce((a, b) => a + b, 0) / g.rts.length : 5);
    const value = (p: PlayerIndex) => this.guns[p].wins * 100 - avg(this.guns[p]);
    return rankBy(this.players, value).map((r) => ({ ...r, score: this.guns[r.player].wins }));
  }
}

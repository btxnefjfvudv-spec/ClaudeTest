import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeSheet, makeTexture, rng } from '../../art/Painter';
import { PLAYER_COLORS, toCss } from '../../core/palette';
import { Audio } from '../../systems/audio/AudioManager';
import { Vfx, burst } from '../../systems/vfx/Vfx';
import { txt } from '../../ui/text';
import { BaseMinigame } from '../BaseMinigame';
import { CATALOG } from '../catalog';
import { ArenaKit, type ArenaBody } from '../kit/ArenaKit';

const M = 22;
const ROUND = 10;
const READ_T = 1.1;

type RuleId = 'coins' | 'bombs' | 'crown' | 'reverse' | 'giant' | 'ice' | 'fast';

interface Rule { id: RuleId; th: string; en: string; sub: string; color: number }

const RULES: Rule[] = [
  { id: 'coins', th: 'เหรียญถล่ม!', en: 'COIN RUSH', sub: 'เก็บเหรียญให้มากที่สุด +1', color: 0xffc93d },
  { id: 'bombs', th: 'ฝนระเบิด!', en: 'BOMB RAIN', sub: 'หลบเงาดำ! โดนระเบิด -2', color: 0xff5a3d },
  { id: 'crown', th: 'ยึดวงมงกุฎ!', en: 'CROWN ZONE', sub: 'ยืนในวงคนเดียว = แต้มรัวๆ', color: 0xb8a6ff },
  { id: 'reverse', th: 'กลับด้าน!', en: 'REVERSED', sub: 'ปุ่มบังคับกลับหัว! เก็บเหรียญ', color: 0x3fe0e0 },
  { id: 'giant', th: 'หัวโต!', en: 'GIANT HEADS', sub: 'พุ่งชนเพื่อน = +2', color: 0xff7af0 },
  { id: 'ice', th: 'พื้นน้ำแข็ง!', en: 'SLIPPERY ICE', sub: 'ลื่นปรื๊ด! แย่งเพชร +3', color: 0x9fe3ff },
  { id: 'fast', th: 'เร็วสุดๆ!', en: 'EVERYONE FAST', sub: 'ทุกคนเร็ว x2 เก็บเหรียญ', color: 0x7ee8b0 },
];

interface Pickup { x: number; y: number; v: number; img: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Image; alive: boolean; t: number }
interface Bomb { x: number; y: number; t: number; fall: number; img: Phaser.GameObjects.Image; warn: Phaser.GameObjects.Image; alive: boolean }

/** #50 — The finale: the rules change every 10 seconds. Points carry over. */
export default class FinalChaos extends BaseMinigame {
  private kit!: ArenaKit;
  private order: Rule[] = [];
  private ri = -1;
  private roundT = 0;
  private pickups: Pickup[] = [];
  private bombs: Bomb[] = [];
  private spawnT = 0;
  private bombT = 0;
  private crown!: Phaser.GameObjects.Image;
  private zone = { x: 0, y: 0, r: 55, img: null as unknown as Phaser.GameObjects.Image, tick: 0 };
  private heads: Phaser.GameObjects.Sprite[] = [];
  private tiles: Phaser.GameObjects.Image[] = [];
  private beams: Phaser.GameObjects.Image[] = [];
  private ice!: Phaser.GameObjects.Image;
  private ruleTags: Phaser.GameObjects.Text[] = [];
  private bulbs: Phaser.GameObjects.TileSprite[] = [];
  private speakers: Phaser.GameObjects.Image[] = [];
  private bumpCd = new Map<string, number>();
  private field!: Phaser.Geom.Rectangle;
  private t = 0;
  private warned = -1;

  constructor() {
    super(CATALOG['final-chaos']);
  }

  setup(): void {
    this.ri = -1;
    this.roundT = 0;
    this.pickups = [];
    this.bombs = [];
    this.heads = [];
    this.tiles = [];
    this.beams = [];
    this.ruleTags = [];
    this.bulbs = [];
    this.speakers = [];
    this.bumpCd.clear();
    this.t = 0;
    this.warned = -1;
    this.field = new Phaser.Geom.Rectangle(M, M, this.vw - M * 2, this.vh - M * 2);
    // six of the seven rules, shuffled (never the same twice in a row)
    const pool = Phaser.Utils.Array.Shuffle([...RULES]);
    this.order = pool.slice(0, 6);
    this.paintArt();
    this.buildStage();
    this.kit = new ArenaKit(this, {
      speed: 150, accel: 900, radius: 12, dashSpeed: 400, dashCooldown: 1.0, bounds: this.field, bounce: 0.8,
      spawn: (p) => ({ x: (p % 2 === 0 ? 0.3 : 0.7) * this.vw, y: (p < 2 ? 0.32 : 0.68) * this.vh }),
    });
    this.kit.dashHit = 1.1;
    this.kit.onBump = (a, b) => this.onBump(a, b);
    for (const b of this.kit.bodies) {
      const h = this.add.sprite(b.x, b.y, b.avatar.key, 0).setOrigin(16 / 32, 12 / 32).setScale(S * 1.9).setVisible(false);
      h.setCrop(5, 0, 22, 20);
      this.heads[b.p] = h;
      b.data.cpuT = 0;
      b.data.wrong = 0;
      b.data.skill = 0.55 + Math.random() * 0.4;
    }
    for (const [deg, y] of [[0, this.vh - 40], [180, 40]] as const) {
      this.ruleTags.push(txt(this, this.vw / 2, y, '', { size: 13, color: '#ffffff', strokeWidth: 4 }).setAngle(deg).setDepth(945).setAlpha(0));
    }
  }

  // ───────────────────────────── art ─────────────────────────────

  private paintArt(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    makeTexture(this, `chaos-floor-${aw}x${ah}`, aw, ah, (p) => {
      const m = M / S;
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const tx = Math.floor((x - m) / 16), ty = Math.floor((y - m) / 16);
        const lx = (x - m) & 15, ly = (y - m) & 15;
        let c = (tx + ty) % 2 ? 0x30296a : 0x3d3484;
        if (lx === 0 || ly === 0) c = 0x4a3f96;
        else if (lx === 15 || ly === 15) c = 0x1c1840;
        else if (lx === 1 && ly < 6) c = 0x5a4fb0;
        p.px(x, y, c);
      }
      // stage rim
      for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
        const d = Math.min(x, y, aw - 1 - x, ah - 1 - y);
        if (d < m) p.px(x, y, d < 2 ? 0x14102e : d < m - 3 ? ((x + y) % 4 < 2 ? 0x8455d6 : 0x6a3fb0) : 0x1b1f3b);
      }
      p.ring(aw / 2, ah / 2, 30, 0x5a4fb0, 1);
      p.ring(aw / 2, ah / 2, 31, 0x1c1840, 1);
    });
    makeTexture(this, 'chaos-lit', 16, 16, (p) => {
      p.rect(1, 1, 14, 14, 0xffffff, 150);
      p.rect(3, 3, 10, 10, 0xffffff, 220);
    });
    makeTexture(this, 'chaos-beam', 48, 48, (p) => {
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        const d = Math.hypot(x - 24, y - 24) / 24;
        if (d < 1) p.px(x, y, 0xffffff, Math.round(90 * (1 - d) * (1 - d)));
      }
    });
    makeSheet(this, 'chaos-bulbs', 16, 4, 2, (p, i) => {
      p.hline(0, 1, 16, 0x1b1f3b);
      const cols = [0xff5a6e, 0xffe066, 0x3d9bff, 0x7ee8b0];
      for (let k = 0; k < 4; k++) {
        const on = (k + i) % 2 === 0;
        p.rect(k * 4 + 1, 1, 2, 3, on ? cols[k] : shift(cols[k], -0.6));
        if (on) p.px(k * 4 + 1, 1, 0xffffff);
      }
    });
    makeTexture(this, 'chaos-speaker', 16, 20, (p) => {
      p.box(0, 0, 16, 20, 0x2b2f45);
      p.ball(8, 13, 5, 5, 0x56618a); p.circle(8, 13, 2.2, 0x1b1f3b);
      p.ball(8, 4.5, 2.5, 2.5, 0x56618a);
      p.outline(-0.6);
    });
    makeTexture(this, 'chaos-bomb', 14, 15, (p) => {
      p.ball(7, 9, 6, 6, 0x3b3f55);
      p.rect(5, 1, 4, 3, 0x8a97bf);
      p.line(8, 1, 11, 0, 0xc98a4b);
      p.px(12, 0, 0xffe066);
      p.px(4, 7, 0xc7c9d6);
      p.outline(-0.8);
    });
    makeTexture(this, 'chaos-warn', 40, 20, (p) => {
      p.ellipse(20, 10, 20, 10, 0x14102e, 150);
      p.ellipse(20, 10, 13, 6, 0x000000, 110);
      for (let a = 0; a < Math.PI * 2; a += 0.02) {
        p.px(20 + Math.cos(a) * 19.5, 10 + Math.sin(a) * 9.5, 0xff5a3d);
        p.px(20 + Math.cos(a) * 18.5, 10 + Math.sin(a) * 8.6, 0xffe066);
      }
      for (let i = -3; i <= 3; i++) { p.px(20 + i, 10, 0xff5a3d); p.px(20, 10 + i * 0.6, 0xff5a3d); }
    });
    makeTexture(this, 'chaos-zone', 56, 56, (p) => {
      for (let y = 0; y < 56; y++) for (let x = 0; x < 56; x++) {
        const d = Math.hypot(x + 0.5 - 28, y + 0.5 - 28);
        if (d <= 27.5 && d > 25.5) p.px(x, y, 0xffffff);
        else if (d <= 25.5 && d > 23.5) p.px(x, y, 0xe6dcff, 160);
        else if (d <= 23.5) p.px(x, y, 0xffffff, ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) ? 40 : 22);
      }
    });
    makeTexture(this, 'chaos-crown', 15, 11, (p) => {
      p.tri(0, 2, 4, 9, 0, 9, 0xffc93d); p.tri(15, 2, 11, 9, 15, 9, 0xffc93d);
      p.tri(3, 9, 7.5, 0, 12, 9, 0xffc93d);
      p.rect(1, 7, 13, 4, 0xffc93d);
      p.hline(1, 10, 13, 0xd99a1a);
      p.px(7, 8, 0xff5a6e); p.px(3, 8, 0x3d9bff); p.px(11, 8, 0x7ee8b0);
      p.px(7, 3, 0xfff1a8);
      p.outline(-0.75);
    });
    makeSheet(this, 'chaos-gem', 12, 12, 2, (p, i) => {
      p.tri(1, 4, 11, 4, 6, 11, 0x3fc8ff);
      p.tri(3, 1, 9, 1, 6, 4, 0x8fe8ff);
      p.rect(3, 1, 6, 3, 0x8fe8ff);
      p.tri(1, 4, 3, 1, 3, 4, 0x6ad8ff); p.tri(11, 4, 9, 1, 9, 4, 0x2fa0e0);
      p.tri(6, 4, 11, 4, 6, 11, 0x2a8fd0);
      p.px(4, 2, 0xffffff); if (i) { p.px(5, 2, 0xffffff); p.px(4, 5, 0xffffff); }
      p.outline(-0.8);
    });
    if (!this.anims.exists('chaos-gem-shine')) {
      this.anims.create({ key: 'chaos-gem-shine', frames: this.anims.generateFrameNumbers('chaos-gem', {}), frameRate: 4, repeat: -1 });
      this.anims.create({ key: 'chaos-bulbs-blink', frames: this.anims.generateFrameNumbers('chaos-bulbs', {}), frameRate: 3, repeat: -1 });
    }
    makeTexture(this, 'chaos-ice', aw, ah, (p) => {
      const r = rng(5);
      p.rect(0, 0, aw, ah, 0xbfeaff, 120);
      for (let i = 0; i < 40; i++) {
        const x = r() * aw, y = r() * ah, l = 6 + r() * 16, a = r() * Math.PI;
        for (let k = 0; k < l; k++) p.px(x + Math.cos(a) * k, y + Math.sin(a) * k, 0xffffff, 170);
      }
      for (let i = 0; i < 60; i++) p.px(r() * aw, r() * ah, 0xffffff, 230);
    });
  }

  private buildStage(): void {
    const aw = Math.ceil(this.vw / S), ah = Math.ceil(this.vh / S);
    this.add.image(0, 0, `chaos-floor-${aw}x${ah}`).setOrigin(0).setScale(S).setDepth(-100);
    const W = this.vw, H = this.vh;
    // disco tiles that light up in the current rule's colour
    const r = rng(50);
    for (let i = 0; i < 80; i++) {
      const gx = Math.floor(r() * Math.floor((W - M * 2) / 32)), gy = Math.floor(r() * Math.floor((H - M * 2) / 32));
      const img = this.add.image(M + gx * 32 + 16, M + gy * 32 + 16, 'chaos-lit').setScale(S).setDepth(-95).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
      img.setData('ph', r() * Math.PI * 2).setData('sp', 1.5 + r() * 2.5);
      this.tiles.push(img);
    }
    this.ice = this.add.image(0, 0, 'chaos-ice').setOrigin(0).setScale(S).setDepth(-90).setAlpha(0);
    // sweeping spotlights
    for (let i = 0; i < 3; i++) {
      this.beams.push(this.add.image(W / 2, H / 2, 'chaos-beam').setScale(S * 2.4).setDepth(-80).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.7).setData('k', i));
    }
    // string lights + speakers on the rim
    for (const y of [M / 2, H - M / 2]) {
      const b = this.add.tileSprite(W / 2, y, (W - 40) / S, 4, 'chaos-bulbs').setScale(S).setDepth(-70);
      this.bulbs.push(b);
    }
    for (const [x, y] of [[14, 14], [W - 14, 14], [14, H - 14], [W - 14, H - 14]] as const) {
      this.speakers.push(this.add.image(x, y, 'chaos-speaker').setScale(S).setDepth(-60));
    }
    this.zone.img = this.add.image(W / 2, H / 2, 'chaos-zone').setScale(S).setDepth(-75).setVisible(false);
    this.crown = this.add.image(W / 2, H / 2, 'chaos-crown').setScale(S).setDepth(2900).setVisible(false);
  }

  // ───────────────────────────── rules ─────────────────────────────

  private get rule(): Rule | undefined {
    return this.order[this.ri];
  }

  onStart(): void {
    this.nextRule();
  }

  private nextRule(): void {
    this.ri++;
    this.roundT = 0;
    this.warned = -1;
    const rule = this.rule;
    if (!rule) return;
    // clear leftovers
    for (const pk of this.pickups) if (pk.alive) this.removePickup(pk, true);
    for (const bm of this.bombs) if (bm.alive) { bm.alive = false; bm.img.destroy(); bm.warn.destroy(); }
    this.spawnT = 0;
    this.bombT = 0.5;
    const k = this.kit;
    k.o.grip = rule.id === 'ice' ? 0.08 : 1;
    k.o.speed = rule.id === 'fast' ? 270 : 150;
    k.o.accel = rule.id === 'fast' ? 1700 : 900;
    for (const b of k.bodies) {
      b.r = rule.id === 'giant' ? 19 : 12;
      this.heads[b.p].setVisible(rule.id === 'giant' && b.alive);
    }
    this.zone.img.setVisible(rule.id === 'crown');
    this.crown.setVisible(rule.id === 'crown');
    if (rule.id === 'crown') { this.zone.x = this.vw / 2; this.zone.y = this.vh / 2; this.zone.tick = 0; }
    this.tweens.add({ targets: this.ice, alpha: rule.id === 'ice' ? 1 : 0, duration: 400 });
    this.announce(rule);
  }

  private announce(rule: Rule): void {
    const col = toCss(rule.color);
    Audio.sfx('drum', 1);
    Audio.sfx('power', 0.9);
    Vfx.flash(this, rule.color, 220);
    Vfx.shake(this, 0.006, 200);
    for (const [deg, y] of [[0, this.vh * 0.72], [180, this.vh * 0.28]] as const) {
      const c = this.add.container(this.vw / 2, y).setAngle(deg).setDepth(4000);
      const band = this.add.nineslice(0, 0, 'ui-panel-dark', undefined, Math.min(this.vw - 40, 420) / S, 74 / S, 6, 6, 6, 6).setScale(S).setAlpha(0.92);
      const head = txt(this, 0, -36, `กฎใหม่! ${this.ri + 1}/6`, { size: 12, color: '#ffffff', strokeWidth: 3 });
      const title = txt(this, 0, -12, rule.th, { size: 30, color: col, strokeWidth: 7 });
      const en = txt(this, 0, 14, rule.en, { size: 12, color: '#c7c9d6', strokeWidth: 3 });
      const sub = txt(this, 0, 32, rule.sub, { size: 13, color: '#fff8e7', strokeWidth: 3 });
      c.add([band, head, title, en, sub]);
      c.setScale(0.2).setAlpha(0);
      this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
      this.tweens.add({ targets: title, scale: { from: 1.15, to: 1 }, duration: 180, yoyo: true, repeat: 3, delay: 260 });
      this.tweens.add({ targets: c, alpha: 0, scale: 0.8, delay: 1500, duration: 280, onComplete: () => c.destroy() });
    }
    for (const t of this.ruleTags) {
      t.setText(`${rule.th}  ${rule.en}`).setColor(col);
      this.tweens.add({ targets: t, alpha: 0.95, duration: 300, delay: 1500 });
    }
    Vfx.confetti(this, this.vw / 2, this.vh / 2, 40);
  }

  // ───────────────────────────── pickups ─────────────────────────────

  private spawnPickup(v: number, x?: number, y?: number): void {
    const f = this.field;
    let px = x ?? f.x + 24 + Math.random() * (f.width - 48);
    let py = y ?? f.y + 24 + Math.random() * (f.height - 48);
    px = Phaser.Math.Clamp(px, f.x + 14, f.right - 14);
    py = Phaser.Math.Clamp(py, f.y + 14, f.bottom - 14);
    const gem = v >= 3;
    const img = this.add.sprite(px, py, gem ? 'chaos-gem' : 'coin', 0).setScale(S).setDepth(py);
    img.play(gem ? 'chaos-gem-shine' : 'coin-spin');
    const shadow = this.add.image(px, py + 10, 'shadow').setScale(S * 0.5).setAlpha(0.3).setDepth(-50);
    img.setScale(0);
    this.tweens.add({ targets: img, scale: S, duration: 220, ease: 'Back.easeOut' });
    this.pickups.push({ x: px, y: py, v, img, shadow, alive: true, t: Math.random() * 6 });
  }

  private removePickup(pk: Pickup, quiet = false): void {
    pk.alive = false;
    pk.shadow.destroy();
    if (quiet) { this.tweens.add({ targets: pk.img, scale: 0, duration: 150, onComplete: () => pk.img.destroy() }); return; }
    pk.img.destroy();
  }

  private gain(b: ArenaBody, n: number, label?: string): void {
    this.addScore(b.p, n);
    Vfx.popText(this, b.x, b.y - 64, label ?? `+${n}`, toCss(PLAYER_COLORS[b.p].light), 16, this.angleFor(b.p));
  }

  // ───────────────────────────── loop ─────────────────────────────

  ambient(dt: number): void {
    this.t += dt;
    const rule = this.rule;
    const col = rule?.color ?? 0x8455d6;
    for (const img of this.tiles) {
      const a = Math.sin(this.t * (img.getData('sp') as number) + (img.getData('ph') as number));
      img.setAlpha(Math.max(0, a) * 0.5).setTint(col);
    }
    this.beams.forEach((b, i) => {
      const k = this.t * (0.35 + i * 0.12) + i * 2.1;
      b.setPosition(this.vw / 2 + Math.cos(k) * this.vw * 0.33, this.vh / 2 + Math.sin(k * 1.3) * this.vh * 0.3);
      b.setTint([col, 0xffffff, shift(col, 0.4)][i]).setAlpha(0.45 + Math.sin(this.t * 2 + i) * 0.15);
    });
    for (const b of this.bulbs) b.tilePositionX = Math.floor(this.t * 3) % 2 ? 4 : 0;
    const beat = Math.abs(Math.sin(this.t * Math.PI * 2.1));
    for (const s of this.speakers) s.setScale(S * (1 + beat * 0.06), S * (1 - beat * 0.04));
    if (this.zone.img.visible) {
      this.zone.img.setPosition(this.zone.x, this.zone.y).setAlpha(0.75 + Math.sin(this.t * 6) * 0.2);
      this.crown.setPosition(this.zone.x, this.zone.y - 70 + Math.sin(this.t * 3) * 4);
    }
    for (const pk of this.pickups) if (pk.alive) { pk.t += dt; pk.img.setY(pk.y - 6 + Math.sin(pk.t * 4) * 2); }

    // reversed controls: route the stick through the bot target, mirrored
    const rev = this.state === 'play' && rule?.id === 'reverse';
    for (const b of this.kit.bodies) {
      if (!b.data.hasStick && b.stick) b.data.hasStick = 1;
      const stick = (b as ArenaBody & { _stick?: ArenaBody['stick'] })._stick ?? b.stick;
      if (b.data.hasStick && stick) {
        (b as ArenaBody & { _stick?: ArenaBody['stick'] })._stick = stick;
        if (rev) {
          b.stick = undefined;
          const m = Math.hypot(stick.vx, stick.vy);
          b.botTarget = m > 0.05 ? { x: b.x - stick.vx * 40 * Math.min(1, m), y: b.y - stick.vy * 40 * Math.min(1, m) } : { x: b.x, y: b.y };
        } else b.stick = stick;
      }
    }
    this.kit.update(dt, this.state === 'play');
    // giant bobble-heads
    for (const b of this.kit.bodies) {
      const h = this.heads[b.p];
      if (!h.visible) continue;
      const s = b.avatar.sprite;
      h.setFrame(s.frame.name).setFlipX(s.scaleX < 0).setAlpha(s.alpha);
      h.setPosition(b.x, b.y - 40 + Math.sin(this.t * 9 + b.p) * 1.5).setDepth(b.y + 1).setAngle(Math.sin(this.t * 5 + b.p) * 6);
      b.avatar.marker?.setY(b.y - 96 + Math.sin(this.t * 4.5) * 2);
    }
  }

  tick(dt: number): void {
    const rule = this.rule;
    if (!rule) return;
    this.roundT += dt;
    // warning before the next rule
    const left = ROUND - this.roundT;
    if (this.ri < this.order.length - 1 && left < 3 && Math.ceil(left) !== this.warned) {
      this.warned = Math.ceil(left);
      Audio.sfx('tick', 1.4);
      for (const t of this.ruleTags) {
        t.setText(`กฎใหม่ใน ${this.warned}...`).setColor('#ffe066');
        this.tweens.add({ targets: t, scale: { from: 1.4, to: 1 }, duration: 220 });
      }
    }
    if (this.roundT >= ROUND && this.ri < this.order.length - 1) { this.nextRule(); return; }
    const live = this.roundT > READ_T;
    for (const [k, v] of this.bumpCd) this.bumpCd.set(k, v - dt);

    if (live) {
      this.spawnT -= dt;
      const coinsOn = this.pickups.filter((p) => p.alive).length;
      switch (rule.id) {
        case 'coins':
          if (this.spawnT <= 0 && coinsOn < 16) { this.spawnT = 0.22; this.spawnPickup(1); }
          break;
        case 'fast':
          if (this.spawnT <= 0 && coinsOn < 14) {
            this.spawnT = 0.9;
            const cx = this.field.x + 60 + Math.random() * (this.field.width - 120), cy = this.field.y + 60 + Math.random() * (this.field.height - 120);
            for (let i = 0; i < 5; i++) this.spawnPickup(1, cx + Math.cos(i * 1.26) * 26, cy + Math.sin(i * 1.26) * 26);
          }
          break;
        case 'reverse':
          if (this.spawnT <= 0 && coinsOn < 12) { this.spawnT = 0.3; this.spawnPickup(1); }
          break;
        case 'bombs':
          if (this.spawnT <= 0 && coinsOn < 6) { this.spawnT = 0.7; this.spawnPickup(1); }
          this.bombT -= dt;
          if (this.bombT <= 0) {
            this.bombT = Math.max(0.22, 0.5 - this.roundT * 0.025);
            const alive = this.kit.alive;
            const aimAt = Math.random() < 0.45 && alive.length ? alive[Math.floor(Math.random() * alive.length)] : undefined;
            const x = aimAt ? aimAt.x + (Math.random() - 0.5) * 50 : this.field.x + 20 + Math.random() * (this.field.width - 40);
            const y = aimAt ? aimAt.y + (Math.random() - 0.5) * 40 : this.field.y + 20 + Math.random() * (this.field.height - 40);
            this.dropBomb(x, y);
          }
          break;
        case 'giant':
          if (this.spawnT <= 0 && coinsOn < 6) { this.spawnT = 0.8; this.spawnPickup(1); }
          break;
        case 'ice':
          if (coinsOn === 0 && this.spawnT <= 0) { this.spawnT = 0.5; this.spawnPickup(3); }
          if (coinsOn < 4 && Math.random() < dt * 1.2) this.spawnPickup(1);
          break;
        case 'crown': {
          const k = this.roundT * 0.55;
          this.zone.x = this.vw / 2 + Math.sin(k) * this.vw * 0.27;
          this.zone.y = this.vh / 2 + Math.sin(k * 1.7) * this.vh * 0.22;
          const inside = this.kit.alive.filter((b) => Math.hypot(b.x - this.zone.x, b.y - this.zone.y) < this.zone.r);
          this.zone.tick -= dt;
          this.zone.img.setTint(inside.length > 1 ? 0xff7a85 : inside.length === 1 ? PLAYER_COLORS[inside[0].p].light : 0xffffff);
          if (this.zone.tick <= 0) {
            this.zone.tick = 0.45;
            if (inside.length === 1) {
              this.gain(inside[0], 1);
              Audio.sfx('coin', 1 + inside[0].p * 0.1);
              Vfx.sparkle(this, inside[0].x, inside[0].y - 40, [0xffe066, 0xffffff]);
            } else if (inside.length > 1 && Math.random() < 0.4) {
              Vfx.popText(this, this.zone.x, this.zone.y, 'แย่งกัน!', '#ff9fae', 14, 0);
              Vfx.popText(this, this.zone.x, this.zone.y, 'แย่งกัน!', '#ff9fae', 14, 180);
            }
          }
          break;
        }
      }
    }
    // collect pickups
    for (const pk of this.pickups) {
      if (!pk.alive) continue;
      const b = this.kit.alive.find((o) => Math.hypot(o.x - pk.x, o.y - pk.y) < o.r + 12);
      if (!b) continue;
      this.removePickup(pk);
      this.gain(b, pk.v);
      Vfx.coinPop(this, pk.x, pk.y);
      if (pk.v >= 3) Vfx.sparkle(this, pk.x, pk.y, [0x8fe8ff, 0xffffff]);
      Audio.sfx(pk.v >= 3 ? 'power' : 'coin', 1 + b.p * 0.1);
    }
    this.pickups = this.pickups.filter((p) => p.alive);
    this.stepBombs(dt);
    for (const b of this.kit.alive) if (this.isCpu(b.p)) this.bot(b, dt);
  }

  private dropBomb(x: number, y: number): void {
    x = Phaser.Math.Clamp(x, this.field.x + 16, this.field.right - 16);
    y = Phaser.Math.Clamp(y, this.field.y + 16, this.field.bottom - 16);
    const warn = this.add.image(x, y, 'chaos-warn').setScale(S * 0.4).setDepth(-45).setAlpha(0.9);
    this.tweens.add({ targets: warn, scale: S, duration: 900 });
    const img = this.add.image(x, y - 400, 'chaos-bomb').setScale(S).setDepth(3000);
    this.bombs.push({ x, y, t: 0, fall: 0.95, img, warn, alive: true });
    Audio.sfx('whoosh', 1.5);
  }

  private stepBombs(dt: number): void {
    for (const bm of this.bombs) {
      if (!bm.alive) continue;
      bm.t += dt;
      const k = Math.min(1, bm.t / bm.fall);
      bm.img.setPosition(bm.x, bm.y - 8 - 400 * (1 - k * k)).setAngle(bm.t * 300);
      if (k < 1) continue;
      bm.alive = false;
      bm.img.destroy();
      bm.warn.destroy();
      burst(this, bm.x, bm.y, { tex: 'puff', count: 12, tint: [0xffffff, 0xffe066, 0xff9f43, 0xff5a3d], speed: [60, 200], life: 500, scale: [S * 1.4, 0], depth: bm.y + 40 });
      burst(this, bm.x, bm.y, { tex: 'puff', count: 6, tint: [0x6b6b80, 0x4a4a5c], speed: [20, 70], life: 900, scale: [S * 1.6, S * 0.4], gravity: -60, alpha: [0.7, 0], depth: bm.y + 39 });
      Audio.sfx('explode', 1.1 + Math.random() * 0.3);
      Vfx.shake(this, 0.004, 120);
      for (const b of this.kit.alive) {
        if (b.invuln > 0 || Math.hypot(b.x - bm.x, b.y - bm.y) > 38) continue;
        this.kit.knock(b, bm.x, bm.y, 320, 1);
        b.invuln = 1.4;
        const lost = Math.min(2, this.score[b.p]);
        this.score[b.p] -= lost;
        Vfx.hitFlash(this, b.avatar.sprite);
        Vfx.popText(this, b.x, b.y - 64, lost ? `-${lost}` : 'ตูม!', '#ff7a85', 18, this.angleFor(b.p));
        for (let i = 0; i < lost; i++) this.spawnPickup(1, b.x + (Math.random() - 0.5) * 90, b.y + (Math.random() - 0.5) * 70);
        Audio.sfx('stun', 1);
      }
    }
    this.bombs = this.bombs.filter((b) => b.alive);
  }

  private onBump(a: ArenaBody, b: ArenaBody): void {
    if (this.rule?.id !== 'giant' || this.state !== 'play') return;
    for (const [att, vic] of [[a, b], [b, a]] as const) {
      if (att.dashT <= 0) continue;
      const key = `${att.p}-${vic.p}`;
      if ((this.bumpCd.get(key) ?? 0) > 0) continue;
      this.bumpCd.set(key, 0.8);
      this.gain(att, 2, 'บ๊อง! +2');
      Audio.sfx('bigHit', 1.3);
      Vfx.hit(this, vic.x, vic.y - 40, [0xffffff, 0xff7af0, 0xffe066]);
      this.kit.knock(vic, att.x, att.y, 220, 0.6);
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private bot(b: ArenaBody, dt: number): void {
    const rule = this.rule!;
    b.data.cpuT -= dt;
    const skill = b.data.skill;
    let target: { x: number; y: number } | undefined;
    const nearestPick = () => {
      const list = this.pickups.filter((p) => p.alive);
      if (!list.length) return undefined;
      const d = (p: Pickup) => Math.hypot(p.x - b.x, p.y - b.y) - p.v * 60 + ((p.img.x * 7 + b.p * 13) % 40);
      return list.reduce((m, p) => (d(p) < d(m) ? p : m));
    };
    if (rule.id === 'crown') {
      target = { x: this.zone.x, y: this.zone.y };
      const rival = this.kit.alive.find((o) => o !== b && Math.hypot(o.x - this.zone.x, o.y - this.zone.y) < this.zone.r && Math.hypot(o.x - b.x, o.y - b.y) < 70);
      if (rival && Math.random() < 0.03 * skill) { target = { x: rival.x, y: rival.y }; b.botDash = true; }
    } else if (rule.id === 'giant') {
      const others = this.kit.alive.filter((o) => o !== b);
      const near = others.reduce<ArenaBody | undefined>((m, o) => (!m || Math.hypot(o.x - b.x, o.y - b.y) < Math.hypot(m.x - b.x, m.y - b.y) ? o : m), undefined);
      const pk = nearestPick();
      if (near && (Math.hypot(near.x - b.x, near.y - b.y) < 150 || !pk)) {
        target = { x: near.x, y: near.y };
        if (Math.hypot(near.x - b.x, near.y - b.y) < 80 && b.dashCd <= 0 && Math.random() < 0.06 * skill) b.botDash = true;
      } else if (pk) target = pk;
    } else {
      const pk = nearestPick();
      if (pk) target = { x: pk.x, y: pk.y };
      if (pk && Math.hypot(pk.x - b.x, pk.y - b.y) > 140 && b.dashCd <= 0 && Math.random() < 0.02 * skill) b.botDash = true;
    }
    if (rule.id === 'bombs') {
      // flee shadows that are about to land
      const danger = this.bombs.find((bm) => bm.alive && bm.t > bm.fall * (0.5 - skill * 0.3) && Math.hypot(bm.x - b.x, bm.y - b.y) < 52);
      if (danger) {
        const dx = b.x - danger.x, dy = b.y - danger.y, l = Math.hypot(dx, dy) || 1;
        target = { x: b.x + (dx / l) * 80, y: b.y + (dy / l) * 80 };
        if (b.dashCd <= 0 && Math.random() < 0.2 * skill) b.botDash = true;
      }
    }
    // reversed controls confuse the CPU a little, too
    if (rule.id === 'reverse') {
      if (b.data.cpuT <= 0) { b.data.cpuT = 0.4 + Math.random() * 0.5; b.data.wrong = Math.random() < 0.35 * (1.2 - skill) ? 1 : 0; }
      if (target && b.data.wrong) target = { x: b.x - (target.x - b.x), y: b.y - (target.y - b.y) };
    }
    b.botTarget = target ?? { x: this.vw / 2 + Math.sin(this.t + b.p) * 80, y: this.vh / 2 + Math.cos(this.t * 0.8 + b.p) * 60 };
  }

  shutdown(): void {
    this.kit?.destroy();
  }
}

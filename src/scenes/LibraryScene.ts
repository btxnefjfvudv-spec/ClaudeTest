import Phaser from 'phaser';
import { shift } from '../art/color';
import { CATALOG_LIST } from '../minigames/catalog';
import { isPlayable } from '../minigames/registry';
import { CATEGORY_LABEL, type MinigameMeta } from '../minigames/types';
import { Party } from '../systems/party/Party';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';

const STATUS_TH: Record<string, string> = {
  planned: 'วางแผน', prototype: 'ต้นแบบ', 'in-development': 'กำลังทำ', implemented: 'เล่นได้', playtested: 'ทดสอบแล้ว', verified: 'ผ่าน QA',
};

/** All 50 games: 10 category columns × 5. Tap a card for details + play. */
export class LibraryScene extends BaseScene {
  private detail?: Phaser.GameObjects.Container;
  private pick = false;

  constructor() {
    super('Library');
  }

  build(data?: { pick?: boolean }): void {
    this.pick = !!data?.pick;
    this.cameras.main.setBackgroundColor(0x232a4d);
    // subtle grid paper background
    const g = this.add.graphics();
    g.lineStyle(1, 0x2d3560, 1);
    for (let x = 0; x < this.vw; x += 16) g.lineBetween(x, 0, x, this.vh);
    for (let y = 0; y < this.vh; y += 16) g.lineBetween(0, y, this.vw, y);
    txt(this, this.vw / 2, 20, `มินิเกมทั้งหมด · ${CATALOG_LIST.filter((m) => isPlayable(m.id)).length}/50 เล่นได้`, { size: 18, color: '#ffe066' });
    new Button(this, 44, 20, { w: 70, h: 30, label: '◀', size: 14, skin: 'ui-btn-grey', sound: 'back', onTap: () => this.goto('Menu') });

    const cats = [...new Set(CATALOG_LIST.map((m) => m.category))];
    const cw = (this.vw - 16) / cats.length;
    const ch = 76;
    cats.forEach((cat, ci) => {
      const x = 8 + ci * cw + cw / 2;
      txt(this, x, 48, CATEGORY_LABEL[cat], { size: 8, color: '#c7c9d6', strokeWidth: 2, wrap: cw - 2 });
      CATALOG_LIST.filter((m) => m.category === cat).forEach((m, ri) => this.card(m, x, 66 + ri * (ch + 5) + ch / 2, cw - 6, ch));
    });
  }

  private card(m: MinigameMeta, x: number, y: number, w: number, h: number): void {
    const ok = isPlayable(m.id);
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, ok ? 0xfff8e7 : 0x3a4170).setStrokeStyle(2, ok ? shift(m.color, -0.5) : 0x4a5288);
    const top = this.add.rectangle(0, -h / 2 + 9, w - 4, 16, ok ? m.color : 0x4a5288);
    const num = txt(this, 0, -h / 2 + 9, `#${m.num}`, { size: 10, color: '#ffffff', strokeWidth: 2 });
    const name = txt(this, 0, 4, m.name, { size: 8, color: ok ? '#1b1f3b' : '#8a90c0', strokeWidth: 0, shadow: false, wrap: w - 6 });
    const st = txt(this, 0, h / 2 - 10, ok ? '▶ เล่นได้' : STATUS_TH[m.status], { size: 8, color: ok ? '#2f9a5a' : '#6a70a0', strokeWidth: 0, shadow: false });
    c.add([bg, top, num, name, st]);
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerup', () => this.showDetail(m));
    c.on('pointerdown', () => this.tweens.add({ targets: c, scale: 0.94, yoyo: true, duration: 80 }));
  }

  private showDetail(m: MinigameMeta): void {
    this.detail?.destroy();
    const ok = isPlayable(m.id);
    const d = this.add.container(0, 0).setDepth(100);
    this.detail = d;
    const shade = this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.7).setOrigin(0).setInteractive();
    shade.on('pointerup', () => { d.destroy(); this.detail = undefined; });
    const cx = this.vw / 2, cy = this.vh / 2;
    const panel = this.add.nineslice(cx, cy, 'ui-panel', undefined, 200, 140, 6, 6, 6, 6).setScale(2).setInteractive();
    const strip = this.add.rectangle(cx, cy - 112, 380, 34, m.color).setStrokeStyle(2, 0x1b1f3b);
    d.add([shade, panel, strip,
      txt(this, cx, cy - 112, `#${m.num}  ${m.name}`, { size: 20, color: '#ffffff' }),
      txt(this, cx, cy - 78, `${m.nameTh} · ${CATEGORY_LABEL[m.category]}`, { size: 14, color: '#5a4fa0', strokeWidth: 0, shadow: false }),
      txt(this, cx, cy - 46, m.blurb, { size: 13, color: '#1b1f3b', strokeWidth: 0, shadow: false, wrap: 360 }),
      txt(this, cx, cy - 2, m.howTo.map((s) => '• ' + s).join('\n'), { size: 12, color: '#3b3f63', strokeWidth: 0, shadow: false, wrap: 360, bold: false }),
      txt(this, cx, cy + 40, `ควบคุม: ${m.controls}  ·  ${m.minPlayers}–${m.maxPlayers} คน${m.team ? ' (ทีม)' : ''}  ·  ${m.duration ? m.duration + ' วินาที' : 'จนกว่าจะมีผู้ชนะ'}`, { size: 11, color: '#3b3f63', strokeWidth: 0, shadow: false, bold: false, wrap: 370 }),
    ]);
    if (ok) {
      d.add(new Button(this, cx - 95, cy + 92, { w: 170, h: 44, label: this.pick ? 'เล่นเกมนี้!' : 'เล่น (ฟรีเพลย์)', size: 15, skin: 'ui-btn-mint', onTap: () => { Party.start(this.pick ? 'quick' : 'free'); this.goto(this.pick ? 'RoundIntro' : m.id, this.pick ? { gameId: m.id } : undefined); } }));
      d.add(new Button(this, cx + 95, cy + 92, { w: 170, h: 44, label: 'ฝึกซ้อม (คนเดียว)', size: 14, skin: 'ui-btn-blue', onTap: () => { Party.setHumans([false, false, true, false]); Party.start('practice'); this.goto(m.id); } }));
    } else {
      d.add(txt(this, cx, cy + 92, `สถานะ: ${STATUS_TH[m.status]} — ยังไม่พร้อมเล่น`, { size: 13, color: '#a0a6d0', strokeWidth: 0, shadow: false }));
    }
    d.setAlpha(0);
    this.tweens.add({ targets: d, alpha: 1, duration: 150 });
  }
}

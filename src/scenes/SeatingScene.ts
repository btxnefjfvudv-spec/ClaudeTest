import Phaser from 'phaser';
import { buildCharacter } from '../art/CharacterArt';
import { S } from '../art/common';
import { CHARACTERS, characterById } from '../data/characters';
import { SEATING, SEAT_LAYOUT, assign, loadSeating, seatAt } from '../data/seating';
import { Audio } from '../systems/audio/AudioManager';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';

/** The real 5/8 seating chart. Tap a desk to put a friend there. */
export class SeatingScene extends BaseScene {
  private picker?: Phaser.GameObjects.Container;

  constructor() {
    super('Seating');
  }

  build(): void {
    loadSeating();
    this.cameras.main.setBackgroundColor(0x8fd8ec);
    this.add.rectangle(0, this.vh - 60, this.vw, 60, 0xf1f4f7).setOrigin(0);
    const top = 40;
    // board, teacher desk, doors
    this.add.rectangle(this.vw / 2, top, this.vw * 0.5, 14, 0xf3eedc).setStrokeStyle(3, 0x8a5a36);
    txt(this, this.vw / 2, top, 'กระดาน', { size: 11, color: '#3e2c22', strokeWidth: 0, shadow: false });
    this.add.rectangle(54, top + 30, 70, 22, 0x8a5a36).setStrokeStyle(2, 0x5a3a22);
    txt(this, 54, top + 30, 'โต๊ะครู', { size: 11, color: '#fff8e7', strokeWidth: 2 });
    for (const y of [top + 30, this.vh - 92]) {
      this.add.rectangle(this.vw - 14, y, 14, 40, 0xd8dde3).setStrokeStyle(2, 0x8a8f9c);
      txt(this, this.vw - 30, y, 'ประตู', { size: 10, color: '#2b3263', strokeWidth: 0, shadow: false, origin: [1, 0.5] });
    }
    txt(this, this.vw / 2, 14, `ผังที่นั่งห้อง 5/8 · จัดแล้ว ${SEATING.length}/${CHARACTERS.length} คน · แตะโต๊ะเพื่อเลือกคนนั่ง`, { size: 12, color: '#1b1f3b', stroke: '#ffffff', strokeWidth: 3, shadow: false });
    // desks
    const dw = 44, dh = 34, gap = 3, groupGap = 30;
    const widthOf = (groups: number[]) => groups.reduce((a, b) => a + b, 0) * (dw + gap) + (groups.length - 1) * groupGap;
    const maxW = Math.max(...SEAT_LAYOUT.map(widthOf));
    const startX = Math.max(20, (this.vw - 40 - maxW) / 2);
    SEAT_LAYOUT.forEach((groups, row) => {
      let x = startX;
      let col = 0;
      const y = top + 74 + row * (dh + 26);
      groups.forEach((n) => {
        for (let k = 0; k < n; k++) {
          this.desk(row, col, x + dw / 2, y, dw, dh);
          x += dw + gap;
          col++;
        }
        x += groupGap;
      });
    });
    new Button(this, this.vw / 2 - 90, this.vh - 26, { w: 150, h: 38, label: '◀ กลับ', size: 15, skin: 'ui-btn-grey', sound: 'back', onTap: () => this.goto('Characters') });
    new Button(this, this.vw / 2 + 90, this.vh - 26, { w: 150, h: 38, label: 'ล้างทั้งหมด', size: 14, skin: 'ui-btn-pink', onTap: () => {
      for (const s of [...SEATING]) assign(s.row, s.column, null);
      this.scene.restart();
    } });
  }

  private desk(row: number, col: number, x: number, y: number, w: number, h: number): void {
    const seat = seatAt(row, col);
    const top = this.add.rectangle(x, y, w, h * 0.6, 0x6e2c24).setStrokeStyle(2, 0x1f1f26);
    top.setInteractive({ useHandCursor: true }).on('pointerup', () => this.openPicker(row, col));
    if (seat) {
      const ch = characterById(seat.characterId);
      const key = buildCharacter(this, ch.id, ch.look);
      this.add.image(x, y + 6, key, 0).setOrigin(0.5, 1).setScale(S * 0.9).setCrop(4, 2, 24, 17);
      txt(this, x, y + h * 0.5, ch.name, { size: 10, color: '#1b1f3b', stroke: '#ffffff', strokeWidth: 2, shadow: false });
    }
  }

  private openPicker(row: number, col: number): void {
    this.picker?.destroy();
    const c = this.add.container(0, 0).setDepth(100);
    this.picker = c;
    c.add(this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.7).setOrigin(0).setInteractive().on('pointerup', () => { c.destroy(); this.picker = undefined; }));
    c.add(this.add.nineslice(this.vw / 2, this.vh / 2, 'ui-panel', undefined, 260, 170, 6, 6, 6, 6).setScale(2));
    c.add(txt(this, this.vw / 2, this.vh / 2 - 145, `ใครนั่งโต๊ะนี้? (แถว ${row + 1} โต๊ะที่ ${col + 1})`, { size: 15, color: '#1b1f3b', strokeWidth: 0, shadow: false }));
    const opts = [...CHARACTERS.map((ch) => ({ id: ch.id as string | null, label: ch.name })), { id: null, label: 'ว่าง' }];
    opts.forEach((o, i) => {
      const bx = this.vw / 2 + ((i % 4) - 1.5) * 118, by = this.vh / 2 - 100 + Math.floor(i / 4) * 54;
      const here = seatAt(row, col)?.characterId === o.id;
      const elsewhere = o.id && SEATING.some((s) => s.characterId === o.id && !(s.row === row && s.column === col));
      c.add(new Button(this, bx, by, {
        w: 108, h: 44, label: o.label, sub: here ? 'นั่งที่นี่' : elsewhere ? 'ย้ายมานั่งที่นี่' : undefined, size: 14,
        skin: o.id === null ? 'ui-btn-grey' : here ? 'ui-btn-mint' : 'ui-btn-blue',
        onTap: () => { assign(row, col, o.id, o.label); Audio.sfx('select'); this.scene.restart(); },
      }));
    });
  }
}

import { buildCharacter } from '../art/CharacterArt';
import { S } from '../art/common';
import { CHARACTERS, characterById } from '../data/characters';
import { SEATING, SEAT_COLS, SEAT_ROWS, loadSeating, saveSeating, seatAt } from '../data/seating';
import { Audio } from '../systems/audio/AudioManager';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';

/** View / edit the classroom seating chart (name, number, character per seat). */
export class SeatingScene extends BaseScene {
  constructor() {
    super('Seating');
  }

  build(): void {
    if (!SEATING.length) loadSeating();
    this.cameras.main.setBackgroundColor(0x2f6b4f);
    txt(this, this.vw / 2, 24, 'ผังที่นั่งห้อง 5/8', { size: 22, color: '#f4f4ea' });
    txt(this, this.vw / 2, 48, 'กระดานอยู่ด้านบน · แตะที่นั่งเพื่อแก้ไข (ชื่อ / เลขที่ / ตัวละคร)', { size: 11, color: '#cfe7d8', strokeWidth: 2 });
    this.add.rectangle(this.vw / 2, 70, this.vw * 0.5, 10, 0x1f4a36).setStrokeStyle(2, 0xc0834a);
    const cw = Math.min(140, (this.vw - 40) / SEAT_COLS), ch = 104;
    for (let row = 0; row < SEAT_ROWS; row++) {
      for (let col = 0; col < SEAT_COLS; col++) {
        const x = this.vw / 2 + (col - (SEAT_COLS - 1) / 2) * cw;
        const y = 136 + row * (ch + 8);
        this.seatCard(row, col, x, y, cw - 10, ch);
      }
    }
    new Button(this, this.vw / 2 - 90, this.vh - 24, { w: 150, h: 38, label: '◀ กลับ', size: 15, skin: 'ui-btn-grey', sound: 'back', onTap: () => this.goto('Characters') });
    new Button(this, this.vw / 2 + 90, this.vh - 24, { w: 170, h: 38, label: 'รีเซ็ตเป็นค่าเริ่มต้น', size: 13, skin: 'ui-btn-pink', onTap: () => {
      try { localStorage.removeItem('c58-seating'); } catch { /* ignore */ }
      loadSeating();
      this.scene.restart();
    } });
  }

  private seatCard(row: number, col: number, x: number, y: number, w: number, h: number): void {
    const c = this.add.container(x, y);
    const desk = this.add.rectangle(0, 0, w, h, 0xc0834a).setStrokeStyle(3, 0x7a4a2c);
    const seat = seatAt(row, col);
    c.add(desk);
    if (seat) {
      const chr = characterById(seat.characterId);
      const key = buildCharacter(this, chr.id, chr.look);
      const spr = this.add.sprite(-w / 2 + 26, h / 2 - 8, key, 0).setOrigin(0.5, 1).setScale(S * 1.2);
      c.add(spr);
      c.add(txt(this, 14, -16, `${seat.number}`, { size: 18, color: '#ffe066' }));
      c.add(txt(this, 14, 12, seat.name, { size: 13, color: '#ffffff', wrap: w - 60 }));
    } else {
      c.add(txt(this, 0, 0, 'ว่าง', { size: 14, color: '#ffe8c8' }));
    }
    c.setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerup', () => this.edit(row, col));
  }

  private edit(row: number, col: number): void {
    let seat = seatAt(row, col);
    if (!seat) {
      seat = { name: 'ว่าง', number: SEATING.length + 1, row, column: col, characterId: CHARACTERS[0].id };
      SEATING.push(seat);
    }
    const choice = window.prompt(
      `ที่นั่ง แถว ${row + 1} คอลัมน์ ${col + 1}\nพิมพ์: ชื่อ,เลขที่  (เช่น  ต้น,12)\nเว้นว่างไว้ = เปลี่ยนตัวละครถัดไป`,
      `${seat.name},${seat.number}`,
    );
    if (choice === null) return;
    if (choice.trim() === '' || choice.trim() === `${seat.name},${seat.number}`) {
      const i = CHARACTERS.findIndex((c) => c.id === seat!.characterId);
      seat.characterId = CHARACTERS[(i + 1) % CHARACTERS.length].id;
    } else {
      const [name, num] = choice.split(',');
      if (name?.trim()) seat.name = name.trim().slice(0, 16);
      const n = Number(num);
      if (Number.isFinite(n) && n > 0) seat.number = Math.round(n);
    }
    saveSeating();
    Audio.sfx('select');
    this.scene.restart();
  }
}


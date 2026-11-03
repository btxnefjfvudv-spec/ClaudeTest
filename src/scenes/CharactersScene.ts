import { buildCharacter, CHAR_ANIMS } from '../art/CharacterArt';
import { S } from '../art/common';
import { CHARACTERS } from '../data/characters';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';
import { ClassroomView } from './ClassroomView';

/** Character gallery: every classmate cycling through their animations. */
export class CharactersScene extends BaseScene {
  constructor() {
    super('Characters');
  }

  build(): void {
    new ClassroomView(this, this.vw, { seated: false });
    this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.45).setOrigin(0).setDepth(10);
    txt(this, this.vw / 2, 26, 'ตัวละครห้อง 5/8', { size: 22, color: '#ffe066' }).setDepth(20);
    txt(this, this.vw / 2, 52, 'ตัวละครชั่วคราว — จะเปลี่ยนเป็นเพื่อนจริงเมื่อได้รูป + รายชื่อ', { size: 11, color: '#c7c9d6', strokeWidth: 2 }).setDepth(20);
    const anims = Object.keys(CHAR_ANIMS).filter((a) => !['sit', 'jump', 'fall', 'land', 'hit'].includes(a));
    const cols = 5;
    CHARACTERS.forEach((c, i) => {
      const x = this.vw / 2 + ((i % cols) - (cols - 1) / 2) * 120;
      const y = 180 + Math.floor(i / cols) * 150;
      const key = buildCharacter(this, c.id, c.look);
      this.add.ellipse(x, y, 60, 14, 0x000000, 0.3).setDepth(15);
      const s = this.add.sprite(x, y, key, 0).setOrigin(0.5, 1).setScale(S * 1.6).setDepth(20);
      let k = i % anims.length;
      const next = () => { s.play(`${key}-${anims[k]}`); k = (k + 1) % anims.length; };
      next();
      this.time.addEvent({ delay: 1600, loop: true, callback: next });
      txt(this, x, y + 16, c.name, { size: 12 }).setDepth(20);
    });
    new Button(this, this.vw / 2, this.vh - 26, { w: 140, h: 40, label: '◀ กลับ', size: 16, skin: 'ui-btn-grey', sound: 'back', onTap: () => this.goto('Menu') }).setDepth(30);
  }
}

import Phaser from 'phaser';
import { CHAR_ANIMS, rebuildCharacter, type Accessory, type BottomStyle, type HairStyle } from '../art/CharacterArt';
import { S } from '../art/common';
import { CHARACTERS, saveCharacterEdits, type CharacterEntry } from '../data/characters';
import { Audio } from '../systems/audio/AudioManager';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';
import { ClassroomView } from './ClassroomView';

const HAIR: HairStyle[] = ['short', 'spiky', 'buzz', 'side', 'curly', 'long', 'ponytail', 'bob', 'bun', 'twin'];
const HAIR_TH: Record<HairStyle, string> = { short: 'สั้น', spiky: 'ตั้งชี้', buzz: 'เกรียน', side: 'ปัดข้าง', curly: 'หยิก', long: 'ยาว', ponytail: 'หางม้า', bob: 'บ๊อบ', bun: 'มวย', twin: 'แกละ' };
const HAIR_COLORS = [0x1f1a26, 0x2b2030, 0x3a2622, 0x5a3426, 0x6a3a22, 0x8a5a32, 0xc98a4b, 0x7a3a8a, 0x3a5aa8];
const SKINS = [0xffe2c6, 0xffd9b8, 0xf5c29a, 0xdca37a, 0xb97f56, 0x8f5e3e];
const ACCENTS = [0xff5a6e, 0x3d9bff, 0x3ed17a, 0xffc93d, 0xb8a6ff, 0xff9f43, 0x3fe0e0, 0xff7a85, 0x7ee8b0, 0x8455d6];
const BOTTOMS: { style: BottomStyle; color: number; th: string }[] = [
  { style: 'pants', color: 0x2c2c3a, th: 'กางเกงดำ' }, { style: 'pants', color: 0x283a72, th: 'กางเกงกรม' },
  { style: 'shorts', color: 0x2c2c3a, th: 'ขาสั้น' }, { style: 'skirt', color: 0x283a72, th: 'กระโปรงกรม' }, { style: 'skirt', color: 0x2c2c3a, th: 'กระโปรงดำ' },
];
const ACC: Accessory[] = ['none', 'glasses', 'headband', 'cap', 'bandaid'];
const ACC_TH: Record<Accessory, string> = { none: 'ไม่มี', glasses: 'แว่น', headband: 'ผ้าคาดผม', cap: 'หมวก', bandaid: 'พลาสเตอร์' };

/**
 * Character gallery + editor. Until real photos arrive, the class can set each
 * friend's name, hair, skin, uniform, signature colour and accessory here.
 * Edits are saved on this iPad.
 */
export class CharactersScene extends BaseScene {
  private editor?: Phaser.GameObjects.Container;
  private sprites: Phaser.GameObjects.Sprite[] = [];
  private names: Phaser.GameObjects.Text[] = [];

  constructor() {
    super('Characters');
  }

  build(): void {
    new ClassroomView(this, this.vw, { seated: false });
    this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.45).setOrigin(0);
    txt(this, this.vw / 2, 26, 'ตัวละครห้อง 5/8', { size: 22, color: '#ffe066' });
    txt(this, this.vw / 2, 52, 'แตะตัวละครเพื่อแก้ไข · ตัวชั่วคราวจนกว่าจะได้รูปเพื่อนจริง', { size: 11, color: '#c7c9d6', strokeWidth: 2 });
    const anims = Object.keys(CHAR_ANIMS).filter((a) => !['sit', 'jump', 'fall', 'land', 'hit'].includes(a));
    const cols = 5;
    this.sprites = [];
    this.names = [];
    CHARACTERS.forEach((c, i) => {
      const x = this.vw / 2 + ((i % cols) - (cols - 1) / 2) * 120;
      const y = 190 + Math.floor(i / cols) * 150;
      const key = rebuildCharacter(this, c.id, c.look);
      this.add.ellipse(x, y, 60, 14, 0x000000, 0.3);
      const s = this.add.sprite(x, y, key, 0).setOrigin(0.5, 1).setScale(S * 1.6).setInteractive({ useHandCursor: true });
      let k = i % anims.length;
      const next = () => { s.play(`char-${c.id}-${anims[k]}`); k = (k + 1) % anims.length; };
      next();
      this.time.addEvent({ delay: 1600, loop: true, callback: next });
      s.on('pointerup', () => this.openEditor(c, i));
      this.sprites.push(s);
      this.names.push(txt(this, x, y + 16, c.name, { size: 12 }));
    });
    new Button(this, this.vw / 2, this.vh - 26, { w: 140, h: 40, label: '◀ กลับ', size: 16, skin: 'ui-btn-grey', sound: 'back', onTap: () => this.goto('Menu') });
  }

  private openEditor(c: CharacterEntry, i: number): void {
    this.editor?.destroy();
    const cx = this.vw / 2, cy = this.vh / 2;
    const e = this.add.container(0, 0).setDepth(100);
    this.editor = e;
    e.add(this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.75).setOrigin(0).setInteractive());
    e.add(this.add.nineslice(cx, cy, 'ui-panel', undefined, 290, 210, 6, 6, 6, 6).setScale(2));
    const preview = this.add.sprite(cx - 190, cy + 40, `char-${c.id}`, 0).setOrigin(0.5, 1).setScale(S * 2.4);
    e.add(preview);
    const name = txt(this, cx - 190, cy + 62, c.name, { size: 16, color: '#1b1f3b', strokeWidth: 0, shadow: false });
    e.add(name);
    const refresh = () => {
      rebuildCharacter(this, c.id, c.look);
      preview.setTexture(`char-${c.id}`, 0).play(`char-${c.id}-idle`);
      this.sprites[i].setTexture(`char-${c.id}`, 0).play(`char-${c.id}-cheer`);
      name.setText(c.name);
      this.names[i].setText(c.name);
      saveCharacterEdits();
    };
    const rows: { label: string; value: () => string; step: (d: number) => void }[] = [
      { label: 'ทรงผม', value: () => HAIR_TH[c.look.hairStyle], step: (d) => { c.look.hairStyle = cyc(HAIR, c.look.hairStyle, d); } },
      { label: 'สีผม', value: () => '■', step: (d) => { c.look.hair = cyc(HAIR_COLORS, c.look.hair, d); } },
      { label: 'สีผิว', value: () => '■', step: (d) => { c.look.skin = cyc(SKINS, c.look.skin, d); } },
      { label: 'ชุดล่าง', value: () => BOTTOMS.find((b) => b.style === c.look.bottomStyle && b.color === c.look.bottom)?.th ?? '—', step: (d) => {
        const idx = Math.max(0, BOTTOMS.findIndex((b) => b.style === c.look.bottomStyle && b.color === c.look.bottom));
        const b = BOTTOMS[(idx + d + BOTTOMS.length) % BOTTOMS.length];
        c.look.bottomStyle = b.style; c.look.bottom = b.color;
      } },
      { label: 'สีประจำตัว', value: () => '■', step: (d) => { c.look.accent = cyc(ACCENTS, c.look.accent, d); } },
      { label: 'เครื่องประดับ', value: () => ACC_TH[c.look.accessory], step: (d) => { c.look.accessory = cyc(ACC, c.look.accessory, d); } },
    ];
    rows.forEach((r, j) => {
      const y = cy - 150 + j * 48;
      e.add(txt(this, cx - 60, y, r.label, { size: 14, color: '#3b3f63', strokeWidth: 0, shadow: false, origin: [0, 0.5] }));
      const val = txt(this, cx + 170, y, r.value(), { size: 15, color: '#1b1f3b', strokeWidth: 0, shadow: false });
      const swatch = () => {
        const col = j === 1 ? c.look.hair : j === 2 ? c.look.skin : j === 4 ? c.look.accent : -1;
        val.setColor(col >= 0 ? `#${col.toString(16).padStart(6, '0')}` : '#1b1f3b').setFontSize(col >= 0 ? 26 : 15);
      };
      swatch();
      e.add(val);
      for (const d of [-1, 1]) {
        e.add(new Button(this, cx + 170 + d * 78, y, { w: 40, h: 34, label: d < 0 ? '◀' : '▶', size: 14, skin: 'ui-btn-blue', onTap: () => { r.step(d); val.setText(r.value()); swatch(); refresh(); } }));
      }
    });
    e.add(new Button(this, cx - 190, cy + 110, { w: 150, h: 38, label: 'เปลี่ยนชื่อ', size: 14, skin: 'ui-btn-pink', onTap: () => {
      const n = window.prompt('ชื่อที่จะแสดงในเกม', c.name);
      if (n && n.trim()) { c.name = n.trim().slice(0, 16); refresh(); }
    } }));
    e.add(new Button(this, cx + 170, cy + 150, { w: 150, h: 40, label: 'เสร็จ ✓', size: 16, skin: 'ui-btn-mint', onTap: () => { e.destroy(); this.editor = undefined; } }));
    preview.play(`char-${c.id}-idle`);
    Audio.sfx('select');
  }
}

function cyc<T>(list: T[], cur: T, d: number): T {
  const i = Math.max(0, list.indexOf(cur));
  return list[(i + d + list.length) % list.length];
}

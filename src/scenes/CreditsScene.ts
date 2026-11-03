import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';
import { ClassroomView } from './ClassroomView';

export class CreditsScene extends BaseScene {
  constructor() {
    super('Credits');
  }

  build(): void {
    new ClassroomView(this, this.vw);
    this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.7).setOrigin(0).setDepth(10);
    const lines = [
      'CLASSROOM 5/8 PARTY',
      '',
      'สร้างเพื่อเพื่อนห้อง 5/8',
      'Game Design · Code · Pixel Art · Music',
      'สร้างร่วมกับ Claude',
      '',
      'ภาพทั้งหมดวาดด้วยโค้ด (pixel-by-pixel)',
      'เพลงและเสียงสังเคราะห์สดใน Web Audio',
      'Engine: Phaser 3 · TypeScript · Vite',
      '',
      'ขอบคุณทุกคนที่มาเล่น — เล่นอีกตา!',
    ];
    const t = txt(this, this.vw / 2, this.vh + 20, lines.join('\n'), { size: 16, color: '#fff8e7', origin: [0.5, 0] }).setDepth(20);
    this.tweens.add({ targets: t, y: 60, duration: 6000, ease: 'Cubic.easeOut' });
    new Button(this, this.vw / 2, this.vh - 30, { w: 140, h: 40, label: '◀ กลับ', size: 16, skin: 'ui-btn-grey', sound: 'back', onTap: () => this.goto('Menu') }).setDepth(30);
  }
}

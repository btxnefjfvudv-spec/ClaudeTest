import { Party } from '../systems/party/Party';
import { playableIds } from '../minigames/registry';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';
import { ClassroomView } from './ClassroomView';

/** Party: choose rounds. Quick: random or pick a game. */
export class ModeScene extends BaseScene {
  private rounds = 5;

  constructor() {
    super('Mode');
  }

  build(data?: { next?: string }): void {
    new ClassroomView(this, this.vw, { seated: false });
    this.add.rectangle(0, 0, this.vw, this.vh, 0x14172e, 0.55).setOrigin(0).setDepth(10);
    const cx = this.vw / 2;
    const panel = this.add.nineslice(cx, 250, 'ui-panel', undefined, 170, 150, 6, 6, 6, 6).setScale(2).setDepth(20);
    void panel;
    const back = () => this.goto('PlayerSelect', { next: data?.next });
    const nGames = playableIds().length;
    if (data?.next === 'quick') {
      txt(this, cx, 130, 'เล่นด่วน · QUICK PLAY', { size: 24, color: '#1b1f3b', stroke: '#ffffff', strokeWidth: 0, shadow: false }).setDepth(30);
      new Button(this, cx, 210, { w: 260, h: 56, label: 'สุ่มเกม!', sub: `จาก ${nGames} เกมที่พร้อมเล่น`, size: 22, onTap: () => { Party.start('quick'); this.goto('RoundIntro'); } }).setDepth(30);
      new Button(this, cx, 280, { w: 260, h: 56, label: 'เลือกเกมเอง', sub: 'MINIGAME COLLECTION', skin: 'ui-btn-blue', size: 20, onTap: () => this.goto('Library', { pick: true }) }).setDepth(30);
      new Button(this, cx, 360, { w: 140, h: 40, label: '◀ กลับ', skin: 'ui-btn-grey', sound: 'back', onTap: back }).setDepth(30);
      return;
    }
    txt(this, cx, 120, 'ปาร์ตี้ · PARTY MODE', { size: 24, color: '#1b1f3b', strokeWidth: 0, shadow: false }).setDepth(30);
    txt(this, cx, 158, 'จำนวนรอบ', { size: 14, color: '#3b3f63', strokeWidth: 0, shadow: false }).setDepth(30);
    const label = txt(this, cx, 218, '', { size: 40, color: '#ff7a85', strokeWidth: 6 }).setDepth(30);
    const presets = [3, 5, 7, 10];
    const btns: Button[] = [];
    const refresh = () => {
      label.setText(`${this.rounds} รอบ`);
      btns.forEach((b, i) => b.setSkin(presets[i] === this.rounds ? 'ui-btn' : 'ui-btn-grey'));
    };
    presets.forEach((n, i) => {
      btns.push(new Button(this, cx - 135 + i * 90, 274, { w: 78, h: 40, label: `${n}`, size: 18, skin: 'ui-btn-grey', onTap: () => { this.rounds = n; refresh(); } }).setDepth(30));
    });
    new Button(this, cx - 120, 218, { w: 44, h: 40, label: '−', size: 20, skin: 'ui-btn-blue', onTap: () => { this.rounds = Math.max(1, this.rounds - 1); refresh(); } }).setDepth(30);
    new Button(this, cx + 120, 218, { w: 44, h: 40, label: '+', size: 20, skin: 'ui-btn-blue', onTap: () => { this.rounds = Math.min(30, this.rounds + 1); refresh(); } }).setDepth(30);
    txt(this, cx, 316, 'อันดับ 1 = 10 · 2 = 7 · 3 = 5 · 4 = 3 แต้ม', { size: 12, color: '#3b3f63', strokeWidth: 0, shadow: false, bold: false }).setDepth(30);
    new Button(this, cx + 60, 372, { w: 190, h: 50, label: 'เริ่มปาร์ตี้!', size: 22, skin: 'ui-btn-mint', onTap: () => { Party.start('party', this.rounds); this.goto('RoundIntro'); } }).setDepth(30);
    new Button(this, cx - 110, 372, { w: 110, h: 44, label: '◀ กลับ', skin: 'ui-btn-grey', sound: 'back', onTap: back }).setDepth(30);
    refresh();
  }
}

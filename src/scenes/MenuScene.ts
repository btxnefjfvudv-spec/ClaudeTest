import { Audio } from '../systems/audio/AudioManager';
import { Party } from '../systems/party/Party';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';
import { ClassroomView } from './ClassroomView';

/** Main menu over the living 5/8 classroom. */
export class MenuScene extends BaseScene {
  constructor() {
    super('Menu');
  }

  build(): void {
    new ClassroomView(this, this.vw, { rows: [300, 346, 392] });
    Audio.playMusic('menu');

    // Logo
    const logo = this.add.container(this.vw / 2, 70).setDepth(5000);
    const plate = this.add.nineslice(0, 6, 'ui-panel-dark', undefined, 170, 46, 6, 6, 6, 6).setScale(2).setAlpha(0.92);
    const l1 = txt(this, 0, -14, 'CLASSROOM', { size: 30, color: '#fff8e7', strokeWidth: 7 });
    const l2 = txt(this, 0, 22, '5/8 PARTY', { size: 40, color: '#ffe066', strokeWidth: 8 });
    const star = txt(this, 150, -30, '★', { size: 26, color: '#ff7a85', strokeWidth: 5 });
    logo.add([plate, l1, l2, star]);
    this.tweens.add({ targets: logo, y: 64, duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: star, angle: 360, duration: 4000, repeat: -1 });
    this.tweens.add({ targets: l2, scale: { from: 1, to: 1.04 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    const cx = this.vw / 2;
    const play = new Button(this, cx, 396, { w: 230, h: 58, label: 'เล่นปาร์ตี้!', sub: 'PARTY MODE', skin: 'ui-btn', size: 24, onTap: () => { Party.mode = 'party'; this.goto('PlayerSelect', { next: 'party' }); } });
    play.setDepth(5000);
    this.tweens.add({ targets: play, scale: { from: 1, to: 1.05 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const small = [
      { label: 'เล่นด่วน', sub: 'QUICK PLAY', skin: 'ui-btn-mint', fn: () => { Party.mode = 'quick'; this.goto('PlayerSelect', { next: 'quick' }); } },
      { label: 'มินิเกม', sub: 'MINIGAMES', skin: 'ui-btn-blue', fn: () => this.goto('Library') },
      { label: 'ตัวละคร', sub: 'CHARACTERS', skin: 'ui-btn-pink', fn: () => this.goto('Characters') },
      { label: 'ตั้งค่า', sub: 'SETTINGS', skin: 'ui-btn-purple', fn: () => this.goto('Settings') },
      { label: 'เครดิต', sub: 'CREDITS', skin: 'ui-btn-grey', fn: () => this.goto('Credits') },
    ];
    const bw = Math.min(118, (this.vw - 40) / 5 - 8);
    const total = small.length * (bw + 8) - 8;
    small.forEach((b, i) => {
      new Button(this, cx - total / 2 + bw / 2 + i * (bw + 8), 452, { w: bw, h: 44, label: b.label, sub: b.sub, size: 14, skin: b.skin, onTap: b.fn }).setDepth(5000);
    });
    txt(this, this.vw - 8, this.vh - 6, 'touch test', { size: 9, color: '#8a8fb8', strokeWidth: 0, origin: [1, 1] })
      .setDepth(5000).setInteractive().on('pointerup', () => this.goto('TouchTest'));
  }
}

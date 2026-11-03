import { Audio } from '../systems/audio/AudioManager';
import { Party } from '../systems/party/Party';
import { saveSettings } from '../systems/settings';
import { Settings } from '../systems/vfx/Vfx';
import { Button } from '../ui/Button';
import { txt } from '../ui/text';
import { BaseScene } from './BaseScene';

/** Volume (master/music/sfx/mute), CPU fill, screen shake. Saved per device. */
export class SettingsScene extends BaseScene {
  constructor() {
    super('Settings');
  }

  build(): void {
    this.cameras.main.setBackgroundColor(0x232a4d);
    const cx = this.vw / 2;
    this.add.nineslice(cx, 250, 'ui-panel', undefined, 190, 200, 6, 6, 6, 6).setScale(2);
    txt(this, cx, 76, 'ตั้งค่า · SETTINGS', { size: 22, color: '#1b1f3b', strokeWidth: 0, shadow: false });
    const rows: [string, 'master' | 'music' | 'sfx'][] = [['เสียงรวม', 'master'], ['เพลง', 'music'], ['เอฟเฟกต์', 'sfx']];
    rows.forEach(([label, key], i) => {
      const y = 126 + i * 50;
      txt(this, cx - 130, y, label, { size: 15, color: '#1b1f3b', strokeWidth: 0, shadow: false, origin: [0, 0.5] });
      const val = txt(this, cx + 60, y, '', { size: 16, color: '#ff7a85', strokeWidth: 3 });
      const bar = this.add.rectangle(cx - 10, y + 14, 140, 6, 0xd8dbe4).setOrigin(0, 0.5);
      const fill = this.add.rectangle(cx - 10, y + 14, 0, 6, 0x7ee8b0).setOrigin(0, 0.5);
      void bar;
      const show = () => { val.setText(`${Math.round(Audio.volume[key] * 10)}`); fill.width = 140 * Audio.volume[key]; };
      const set = (d: number) => { Audio.volume[key] = Math.round(Math.min(1, Math.max(0, Audio.volume[key] + d)) * 10) / 10; Audio.applyVolume(); show(); saveSettings(); Audio.sfx('click'); };
      new Button(this, cx + 12, y, { w: 40, h: 32, label: '−', size: 18, skin: 'ui-btn-blue', onTap: () => set(-0.1) });
      new Button(this, cx + 108, y, { w: 40, h: 32, label: '+', size: 18, skin: 'ui-btn-blue', onTap: () => set(0.1) });
      show();
    });
    const toggle = (y: number, label: () => string, fn: () => void) => {
      const b: Button = new Button(this, cx, y, { w: 280, h: 38, label: label(), size: 14, skin: 'ui-btn-purple', onTap: () => { fn(); b.setLabel(label()); saveSettings(); } });
    };
    toggle(286, () => (Audio.volume.muted ? 'ปิดเสียงอยู่' : 'เปิดเสียงอยู่'), () => { Audio.volume.muted = !Audio.volume.muted; Audio.applyVolume(); });
    toggle(330, () => (Party.fillCpu ? 'เติม CPU ที่นั่งว่าง: เปิด' : 'เติม CPU ที่นั่งว่าง: ปิด'), () => { Party.fillCpu = !Party.fillCpu; });
    toggle(374, () => (Settings.reduceShake ? 'ลดการสั่นจอ: เปิด' : 'ลดการสั่นจอ: ปิด'), () => { Settings.reduceShake = !Settings.reduceShake; });
    new Button(this, cx, 438, { w: 140, h: 40, label: '◀ กลับ', size: 16, skin: 'ui-btn-grey', sound: 'back', onTap: () => this.goto('Menu') });
  }
}

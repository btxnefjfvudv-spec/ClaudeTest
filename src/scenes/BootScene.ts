import Phaser from 'phaser';
import { PALETTE, toCss } from '../core/palette';
import { Audio } from '../systems/audio/AudioManager';

export const UI_FONT = '"Sukhumvit Set", "Thonburi", system-ui, -apple-system, sans-serif';

/** Temporary start screen: unlocks audio on the first tap (Safari rule). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const title = this.add
      .text(0, 0, 'CLASSROOM 5/8 PARTY', { fontFamily: UI_FONT, fontSize: '40px', fontStyle: 'bold', color: toCss(PALETTE.lemon) })
      .setOrigin(0.5);
    const sub = this.add
      .text(0, 0, 'แตะเพื่อเริ่ม · TAP TO START', { fontFamily: UI_FONT, fontSize: '20px', color: toCss(PALETTE.cream) })
      .setOrigin(0.5);
    const note = this.add
      .text(0, 0, 'Dev build — multi-touch test', { fontFamily: UI_FONT, fontSize: '12px', color: toCss(PALETTE.lavender) })
      .setOrigin(0.5);

    const layout = () => {
      const { width, height } = this.scale.gameSize;
      title.setPosition(width / 2, height * 0.4);
      sub.setPosition(width / 2, height * 0.55);
      note.setPosition(width / 2, height - 20);
    };
    layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, layout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, layout));

    this.tweens.add({ targets: sub, alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.input.once(Phaser.Input.Events.POINTER_UP, () => {
      Audio.unlock();
      Audio.blip(660, 0.12, 'square', 990);
      this.scene.start('TouchTest');
    });
  }
}

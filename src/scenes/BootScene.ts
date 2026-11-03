import Phaser from 'phaser';
import { buildCharacter } from '../art/CharacterArt';
import { buildCommonTextures, buildIconTextures } from '../art/common';
import { CHARACTERS, loadCharacterEdits } from '../data/characters';
import { Audio } from '../systems/audio/AudioManager';
import { Party } from '../systems/party/Party';
import { loadSettings } from '../systems/settings';
import { txt } from '../ui/text';
import { keepAwake } from '../systems/wakeLock';
import { BaseScene } from './BaseScene';

export { UI_FONT } from '../ui/text';

/** Generates all shared art, then waits for the first tap (Safari audio rule). */
export class BootScene extends BaseScene {
  constructor() {
    super('Boot');
  }

  build(): void {
    loadSettings();
    loadCharacterEdits();
    buildCommonTextures(this);
    buildIconTextures(this);
    for (const c of CHARACTERS) buildCharacter(this, c.id, c.look);
    this.cameras.main.setBackgroundColor(0x1b1f3b);

    const params = new URLSearchParams(location.search);
    if (params.has('fast')) Party.fast = true;
    if (params.has('speed')) Party.speed = Math.max(1, Math.min(8, Number(params.get('speed')) || 1));
    const direct = params.get('game');

    const title = txt(this, this.vw / 2, this.vh * 0.4, 'CLASSROOM 5/8\nPARTY', { size: 44, color: '#ffe066', strokeWidth: 8 });
    const sub = txt(this, this.vw / 2, this.vh * 0.7, 'แตะเพื่อเริ่ม · TAP TO START', { size: 18 });
    const subFar = txt(this, this.vw / 2, this.vh * 0.12, 'แตะเพื่อเริ่ม · TAP TO START', { size: 18 }).setAngle(180);
    this.tweens.add({ targets: title, y: title.y - 6, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: [sub, subFar], alpha: 0.35, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    txt(this, this.vw / 2, this.vh - 14, 'v0.1 · 4 players · 1 iPad', { size: 10, color: '#8a8fb8', strokeWidth: 0 });

    const go = () => {
      Audio.unlock();
      void keepAwake();
      Audio.sfx('power');
      if (direct) {
        Party.start('free');
        this.goto(direct);
      } else this.goto('Menu');
    };
    if (params.has('auto')) this.time.delayedCall(100, go);
    else this.input.once(Phaser.Input.Events.POINTER_UP, go);
  }
}

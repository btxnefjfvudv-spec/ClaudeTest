// Dev-only: paints the app icon (pixel art) and exposes it as a data URL for tools/makeIcons.cjs.
import { buildCharacter, FRAME } from '../src/art/CharacterArt';
import { CHARACTERS } from '../src/data/characters';
import Phaser from 'phaser';

class Icon extends Phaser.Scene {
  create(): void {
    const size = 64;
    const rt = this.add.renderTexture(0, 0, size, size).setOrigin(0);
    const bg = this.add.graphics();
    bg.fillStyle(0x3d6fd6).fillRect(0, 0, size, size);
    bg.fillStyle(0x2f6b4f).fillRect(6, 6, 52, 30);
    bg.fillStyle(0xc0834a).fillRect(4, 36, 56, 3);
    bg.fillStyle(0xffe066).fillRect(0, 50, size, 14);
    rt.draw(bg, 0, 0);
    bg.destroy();
    const chalk = this.add.text(32, 20, '5/8', { fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: '#f4f4ea' }).setOrigin(0.5);
    rt.draw(chalk, 32, 20);
    chalk.destroy();
    [0, 1, 3].forEach((ci, i) => {
      const c = CHARACTERS[ci];
      const key = buildCharacter(this, c.id, c.look);
      const s = this.add.image(0, 0, key, 16 + i).setOrigin(0.5, 1);
      rt.draw(s, 12 + i * 20, 62);
      s.destroy();
    });
    void FRAME;
    rt.snapshot((img) => { (window as unknown as { __icon: string }).__icon = (img as HTMLImageElement).src; });
  }
}
new Phaser.Game({ type: Phaser.CANVAS, width: 64, height: 64, pixelArt: true, parent: 'game', scene: Icon, backgroundColor: '#000000' });

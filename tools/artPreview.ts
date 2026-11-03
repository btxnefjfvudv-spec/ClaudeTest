// Dev-only page: renders every character's full sheet at 4x for art review.
import Phaser from 'phaser';
import { buildCharacter } from '../src/art/CharacterArt';
import { CHARACTERS } from '../src/data/characters';

class Preview extends Phaser.Scene {
  create(): void {
    this.cameras.main.setBackgroundColor(0x5a6a8a);
    const q = new URLSearchParams(location.search);
    const only = q.get('c');
    const max = +(q.get("n") ?? 99);
    const start = +(q.get("s") ?? 0);
    CHARACTERS.filter((c) => !only || only.split(',').includes(c.id)).forEach((c, row) => {
      const key = buildCharacter(this, c.id, c.look);
      const frames = this.textures.get(key).frameTotal - 1;
      for (let f = start; f < Math.min(frames, start + max); f++) this.add.image(20 + (f - start) * 34, 20 + row * 36, key, f).setOrigin(0);
    });
  }
}
new Phaser.Game({ type: Phaser.CANVAS, width: 1100, height: 400, zoom: +(new URLSearchParams(location.search).get('z') ?? 2), pixelArt: true, parent: 'game', scene: Preview });

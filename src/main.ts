import Phaser from 'phaser';
import { MAX_POINTERS, virtualSize } from './config';
import { PALETTE } from './core/palette';
import { BootScene } from './scenes/BootScene';
import { TouchTestScene } from './scenes/TouchTestScene';
import { Audio } from './systems/audio/AudioManager';

// Block Safari gestures CSS alone can't stop: pinch, double-tap zoom, rubber-band scroll.
const block = (e: Event) => e.preventDefault();
for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu']) {
  document.addEventListener(type, block, { passive: false });
}
document.addEventListener('touchmove', block, { passive: false });

const initial = virtualSize(window.innerWidth, window.innerHeight);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: PALETTE.table,
  pixelArt: true,
  roundPixels: true,
  width: initial.width,
  height: initial.height,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: MAX_POINTERS, touch: { capture: true } },
  scene: [BootScene, TouchTestScene],
});

game.events.once(Phaser.Core.Events.READY, () => Audio.init(game));

// Keep the virtual width matched to the screen aspect (rotation, Split View, toolbar changes).
function fitToScreen(): void {
  const { width, height } = virtualSize(window.innerWidth, window.innerHeight);
  if (width !== game.scale.gameSize.width || height !== game.scale.gameSize.height) {
    game.scale.setGameSize(width, height);
  }
  game.scale.refresh();
}
window.addEventListener('resize', fitToScreen);
window.visualViewport?.addEventListener('resize', fitToScreen);

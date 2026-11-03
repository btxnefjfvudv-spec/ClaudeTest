import Phaser from 'phaser';
import { MAX_POINTERS, View, computeView } from './config';
import { SCENES, playableIds } from './minigames/registry';
import { Party } from './systems/party/Party';
import { CHARACTERS } from './data/characters';
import { BootScene } from './scenes/BootScene';
import { CharactersScene } from './scenes/CharactersScene';
import { CreditsScene } from './scenes/CreditsScene';
import { FinalScene } from './scenes/FinalScene';
import { LibraryScene } from './scenes/LibraryScene';
import { MenuScene } from './scenes/MenuScene';
import { ModeScene } from './scenes/ModeScene';
import { PlayerSelectScene } from './scenes/PlayerSelectScene';
import { ResultsScene } from './scenes/ResultsScene';
import { RoundIntroScene } from './scenes/RoundIntroScene';
import { SettingsScene } from './scenes/SettingsScene';
import { SeatingScene } from './scenes/SeatingScene';
import { TouchTestScene } from './scenes/TouchTestScene';
import { Audio } from './systems/audio/AudioManager';

// Block Safari gestures CSS alone can't stop: pinch, double-tap zoom, rubber-band scroll.
const block = (e: Event) => e.preventDefault();
for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu']) {
  document.addEventListener(type, block, { passive: false });
}
document.addEventListener('touchmove', block, { passive: false });

computeView(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b1f3b',
  pixelArt: true,
  roundPixels: false,
  antialias: false,
  width: View.canvasW,
  height: View.canvasH,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: MAX_POINTERS, touch: { capture: true } },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
  fps: { target: 60, smoothStep: true },
  render: { powerPreference: 'high-performance', batchSize: 4096 },
  scene: [
    BootScene, MenuScene, PlayerSelectScene, ModeScene, RoundIntroScene, ResultsScene, FinalScene,
    LibraryScene, SettingsScene, CreditsScene, CharactersScene, SeatingScene, TouchTestScene, ...SCENES,
  ],
});

game.events.once(Phaser.Core.Events.READY, () => Audio.init(game));
Object.assign(window as unknown as Record<string, unknown>, { __game: game, __party: Party, __playable: playableIds(), __chars: CHARACTERS });

// Keep the canvas matched to the screen (rotation, Split View, toolbar changes).
function fitToScreen(): void {
  computeView(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  if (View.canvasW !== game.scale.gameSize.width || View.canvasH !== game.scale.gameSize.height) {
    game.scale.setGameSize(View.canvasW, View.canvasH);
  }
  game.scale.refresh();
}
window.addEventListener('resize', fitToScreen);
window.visualViewport?.addEventListener('resize', fitToScreen);

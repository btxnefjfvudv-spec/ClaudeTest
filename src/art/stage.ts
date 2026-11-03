import Phaser from 'phaser';
import { S } from './common';
import { shift } from './color';
import { makeTexture } from './Painter';

/** Shared ceremony stage: curtains, spotlights, podium blocks. */
export function buildStage(scene: Phaser.Scene, w: number, h: number): void {
  const aw = Math.ceil(w / S), ah = Math.ceil(h / S);
  const bg = makeTexture(scene, `stage-bg-${aw}`, aw, ah, (p) => {
    p.gradient(0, 0, aw, ah, [0x2a1f4a, 0x3b2a66, 0x4a3478]);
    // back curtain folds
    for (let x = 0; x < aw; x += 12) {
      p.rect(x, 0, 6, ah - 60, 0x8a2a4a);
      p.rect(x + 6, 0, 6, ah - 60, 0x6e1f3c);
      p.vline(x + 1, 0, ah - 60, 0xa53a5c);
    }
    p.dither(0, ah - 80, aw, 20, 0x6e1f3c, 0x3b2a66, 0.5);
    // floor
    p.rect(0, ah - 60, aw, 60, 0x5a3a2a);
    for (let y = ah - 60; y < ah; y += 6) p.hline(0, y, aw, 0x4a2e20);
    p.hline(0, ah - 60, aw, 0xc98a4b);
    // valance
    for (let x = 0; x < aw; x += 16) { p.ellipse(x + 8, 8, 9, 8, 0xb8324e); p.ellipse(x + 8, 6, 8, 6, 0xd04060); }
    p.rect(0, 0, aw, 4, 0xffc93d);
  });
  scene.add.image(0, 0, bg).setOrigin(0).setScale(S).setDepth(-100);
  const beam = makeTexture(scene, 'spot-beam', 60, 200, (p) => {
    for (let y = 0; y < 200; y++) {
      const half = 6 + y * 0.12;
      p.hline(Math.round(30 - half), y, Math.round(half * 2), 0xfff6c8, Math.round(70 * (1 - y / 240)));
    }
  });
  for (const x of [0.2, 0.5, 0.8]) {
    const b = scene.add.image(w * x, 0, beam).setOrigin(0.5, 0).setScale(S).setBlendMode(Phaser.BlendModes.ADD).setDepth(-90).setAlpha(0.6);
    scene.tweens.add({ targets: b, angle: { from: -12, to: 12 }, duration: 2600 + x * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
}

export function podiumKey(scene: Phaser.Scene, rank: number, color: number): string {
  const hgt = [44, 32, 24, 16][rank - 1] ?? 14;
  return makeTexture(scene, `podium-${rank}-${color}`, 40, hgt + 4, (p) => {
    p.box(0, 4, 40, hgt, color, 2);
    p.rect(0, 0, 40, 5, shift(color, 0.45));
    p.hline(0, 4, 40, shift(color, -0.3));
    const digits: Record<number, string[]> = {
      1: ['.a.', 'aa.', '.a.', '.a.', 'aaa'], 2: ['aa.', '..a', '.a.', 'a..', 'aaa'],
      3: ['aa.', '..a', '.a.', '..a', 'aa.'], 4: ['a.a', 'a.a', 'aaa', '..a', '..a'],
    };
    const d = digits[rank];
    if (d) for (const [j, row] of d.entries()) for (let i = 0; i < 3; i++) if (row[i] === 'a') p.rect(15 + i * 3, 9 + j * 3, 3, 3, 0xffffff);
    p.outline(-0.7);
  });
}

export function crownKey(scene: Phaser.Scene): string {
  return makeTexture(scene, 'crown', 14, 10, (p) => {
    p.stamp(0, 0, ['a.....a.....a.', 'aa...aaa...aa.', 'aaa.aaaaa.aaa.', 'aaaaaaaaaaaaa.', 'abaabaaabaaba.', 'aaaaaaaaaaaaa.', 'ccccccccccccc.'], { a: 0xffc93d, b: 0xff5a6e, c: 0xc98a1c });
    p.outline(-0.7);
  });
}

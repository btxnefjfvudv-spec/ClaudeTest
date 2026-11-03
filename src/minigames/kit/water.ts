import Phaser from 'phaser';
import { S } from '../../art/common';
import { makeTexture, rng } from '../../art/Painter';

/** Animated water: base tiling texture + drifting highlight layer. Returns update fn. */
export function addWater(scene: Phaser.Scene, w: number, h: number, base = 0x2f9fd8, depth = -100): (dt: number) => void {
  const r = rng(21);
  const k1 = makeTexture(scene, `water-${base}`, 32, 32, (p) => {
    p.rect(0, 0, 32, 32, base);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(r() * 32), y = Math.floor(r() * 32);
      p.hline(x, y, 3 + Math.floor(r() * 4), 0x2588c4);
    }
  });
  const k2 = makeTexture(scene, `water-hi-${base}`, 48, 48, (p) => {
    for (let i = 0; i < 9; i++) {
      const x = Math.floor(r() * 44), y = Math.floor(r() * 46);
      p.hline(x, y, 4, 0x9fe3ff);
      p.hline(x + 1, y + 1, 2, 0x6cc8f4);
    }
  });
  const a = scene.add.tileSprite(0, 0, w / S, h / S, k1).setOrigin(0).setScale(S).setDepth(depth);
  const b = scene.add.tileSprite(0, 0, w / S, h / S, k2).setOrigin(0).setScale(S).setDepth(depth + 1).setAlpha(0.8);
  let t = 0;
  return (dt: number) => {
    t += dt;
    a.tilePositionX = Math.sin(t * 0.4) * 6;
    a.tilePositionY = t * 3;
    b.tilePositionX = -t * 6;
    b.tilePositionY = Math.cos(t * 0.6) * 4;
    b.setAlpha(0.6 + Math.sin(t * 2) * 0.2);
  };
}

export function splash(scene: Phaser.Scene, x: number, y: number): void {
  const em = scene.add.particles(x, y, 'dot3', {
    speed: { min: 60, max: 200 }, angle: { min: 200, max: 340 }, gravityY: 500, lifespan: 700,
    scale: { start: S, end: 0.5 }, tint: [0xffffff, 0xbfeaff, 0x6cc8f4], emitting: false,
  });
  em.setDepth(2000);
  em.explode(22);
  const ring = scene.add.image(x, y, 'ring').setScale(0.5, 0.25).setDepth(-2000).setTint(0xdff6ff);
  scene.tweens.add({ targets: ring, scaleX: 3, scaleY: 1.4, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
  scene.time.delayedCall(800, () => em.destroy());
}

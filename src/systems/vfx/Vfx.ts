import Phaser from 'phaser';
import { S } from '../../art/common';
import { UI_FONT } from '../../ui/text';
import { View } from '../../config';

type Scene = Phaser.Scene;

interface BurstOpts {
  tex?: string;
  count?: number;
  tint?: number | number[];
  speed?: [number, number];
  life?: number;
  gravity?: number;
  scale?: [number, number];
  angle?: [number, number];
  depth?: number;
  alpha?: [number, number];
  rotate?: boolean;
}

/** One-shot particle burst that cleans itself up. */
export function burst(scene: Scene, x: number, y: number, o: BurstOpts = {}): void {
  const life = o.life ?? 500;
  const em = scene.add.particles(x, y, o.tex ?? 'dot2', {
    speed: { min: o.speed?.[0] ?? 40, max: o.speed?.[1] ?? 140 },
    angle: { min: o.angle?.[0] ?? 0, max: o.angle?.[1] ?? 360 },
    lifespan: { min: life * 0.6, max: life },
    gravityY: o.gravity ?? 0,
    scale: { start: o.scale?.[0] ?? S, end: o.scale?.[1] ?? 0 },
    alpha: { start: o.alpha?.[0] ?? 1, end: o.alpha?.[1] ?? 0.2 },
    tint: o.tint ?? 0xffffff,
    rotate: o.rotate ? { min: 0, max: 360 } : 0,
    emitting: false,
  });
  em.setDepth(o.depth ?? 50);
  em.explode(o.count ?? 12);
  scene.time.delayedCall(life + 50, () => em.destroy());
}

export const Vfx = {
  dust(scene: Scene, x: number, y: number, dir = 0): void {
    burst(scene, x, y, {
      tex: 'dust', count: 6, tint: [0xe9e2d0, 0xcfc6b0], speed: [20, 60],
      angle: dir === 0 ? [180, 360] : dir > 0 ? [190, 250] : [290, 350], life: 380, scale: [S * 0.8, 0], gravity: -40,
    });
  },
  sparkle(scene: Scene, x: number, y: number, tint: number | number[] = [0xffffff, 0xffe066]): void {
    burst(scene, x, y, { tex: 'spark', count: 10, tint, speed: [40, 130], life: 450, scale: [S, 0] });
  },
  hit(scene: Scene, x: number, y: number, tint: number | number[] = [0xffffff, 0xffe066, 0xff9f43]): void {
    burst(scene, x, y, { tex: 'dot3', count: 14, tint, speed: [90, 240], life: 320, scale: [S * 1.2, 0] });
    const ring = scene.add.image(x, y, 'ring').setScale(0.4).setDepth(51).setTint(0xffffff);
    scene.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 260, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  },
  explosion(scene: Scene, x: number, y: number, size = 1): void {
    burst(scene, x, y, { tex: 'puff', count: Math.round(14 * size), tint: [0xffffff, 0xffe066, 0xff9f43, 0xff5a3d], speed: [60 * size, 220 * size], life: 650, scale: [S * 1.6 * size, 0] });
    burst(scene, x, y, { tex: 'puff', count: Math.round(8 * size), tint: [0x6b6b80, 0x4a4a5c], speed: [20, 90 * size], life: 1100, scale: [S * 2 * size, S * 0.6], gravity: -60, alpha: [0.8, 0] });
    Vfx.shake(scene, 0.012 * size, 260);
    Vfx.flash(scene, 0xffffff, 90);
  },
  confetti(scene: Scene, x: number, y: number, count = 60): void {
    burst(scene, x, y, {
      tex: 'confetti', count, tint: [0xff5a6e, 0x3d9bff, 0x3ed17a, 0xffc93d, 0xb8a6ff, 0xffffff],
      speed: [120, 360], angle: [200, 340], life: 2200, gravity: 260, scale: [S, S], rotate: true, alpha: [1, 1],
    });
  },
  coinPop(scene: Scene, x: number, y: number): void {
    burst(scene, x, y, { tex: 'spark', count: 8, tint: [0xffe066, 0xffffff], speed: [50, 120], life: 380 });
  },
  shake(scene: Scene, intensity = 0.006, ms = 160): void {
    if (Settings.reduceShake) intensity *= 0.3;
    for (const cam of scene.cameras.cameras) cam.shake(ms, intensity);
  },
  flash(scene: Scene, color = 0xffffff, ms = 80): void {
    const r = scene.add.rectangle(0, 0, View.width, View.height, color).setOrigin(0).setDepth(999).setAlpha(0.6);
    scene.tweens.add({ targets: r, alpha: 0, duration: ms, onComplete: () => r.destroy() });
  },
  /** White flash on a sprite (hit feedback). */
  hitFlash(scene: Scene, target: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image, ms = 90): void {
    target.setTintFill(0xffffff);
    scene.time.delayedCall(ms, () => target.active && target.clearTint());
  },
  /** Squash & stretch pulse. Base scale defaults to S. */
  squash(scene: Scene, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, sx: number, sy: number, ms = 140, base = S): void {
    scene.tweens.killTweensOf(target);
    const t = target as unknown as { scaleX: number; scaleY: number };
    const signX = Math.sign(t.scaleX) || 1;
    t.scaleX = base * sx * signX;
    t.scaleY = base * sy;
    scene.tweens.add({ targets: target, scaleX: base * signX, scaleY: base, duration: ms, ease: 'Back.easeOut' });
  },
  popText(scene: Scene, x: number, y: number, text: string, color = '#ffe066', size = 18, angle = 0): void {
    const t = scene.add
      .text(x, y, text, { fontFamily: UI_FONT, fontSize: `${size}px`, fontStyle: 'bold', color, stroke: '#1b1f3b', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(2900).setResolution(View.zoom).setAngle(angle).setScale(0.4);
    const up = angle === 180 ? 26 : -26;
    scene.tweens.add({ targets: t, scale: 1, duration: 160, ease: 'Back.easeOut' });
    scene.tweens.add({ targets: t, y: y + up, alpha: 0, delay: 380, duration: 420, ease: 'Cubic.easeIn', onComplete: () => t.destroy() });
  },
  speedLines(scene: Scene, x: number, y: number, dir: number, tint = 0xffffff): void {
    burst(scene, x, y, { tex: 'line', count: 4, tint, speed: [160, 260], angle: [dir + 165, dir + 195], life: 220, scale: [S, S * 0.5], alpha: [0.8, 0] });
  },
};

/** Accessibility toggles stored in settings (filled by Settings system). */
export const Settings = { reduceShake: false };

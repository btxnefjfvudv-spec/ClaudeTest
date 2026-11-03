import Phaser from 'phaser';
import { View, WORLD_H } from '../config';

/**
 * Every scene extends this. It sets up the zoomed camera so world space is
 * always WORLD_H tall, and provides pixel-wipe transitions.
 */
export abstract class BaseScene extends Phaser.Scene {
  /** World size captured when the scene started (stable for the scene's life). */
  vw = View.width;
  vh = WORLD_H;
  private wipe?: Phaser.GameObjects.Container;

  create(data?: unknown): void {
    this.vw = View.width;
    this.vh = WORLD_H;
    this.fitCamera(this.cameras.main);
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this));
    this.build(data);
    this.wipeIn();
  }

  abstract build(data?: unknown): void;

  /** Fit a full-screen camera to this scene's world size (letterboxed if the screen changed). */
  fitCamera(cam: Phaser.Cameras.Scene2D.Camera): void {
    const zoom = Math.min(View.canvasW / this.vw, View.canvasH / this.vh);
    cam.setOrigin(0, 0);
    cam.setZoom(zoom);
    cam.setSize(View.canvasW, View.canvasH);
    const offX = (View.canvasW - this.vw * zoom) / 2 / zoom;
    const offY = (View.canvasH - this.vh * zoom) / 2 / zoom;
    cam.setScroll(-offX, -offY);
  }

  protected onResize(): void {
    this.fitCamera(this.cameras.main);
  }

  private makeWipe(): Phaser.GameObjects.Container {
    const cell = 40;
    const c = this.add.container(0, 0).setDepth(10000);
    const cols = Math.ceil(this.vw / cell) + 1, rows = Math.ceil(this.vh / cell) + 1;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const r = this.add.rectangle(x * cell + cell / 2, y * cell + cell / 2, cell + 1, cell + 1, 0x1b1f3b);
        r.setData('d', x + y);
        c.add(r);
      }
    }
    return c;
  }

  private wipeIn(): void {
    const c = this.makeWipe();
    this.wipe = c;
    const max = Math.max(...c.list.map((o) => o.getData('d') as number));
    for (const o of c.list as Phaser.GameObjects.Rectangle[]) {
      this.tweens.add({ targets: o, scale: 0, angle: 45, duration: 220, delay: (o.getData('d') / max) * 260, ease: 'Quad.easeIn' });
    }
    this.time.delayedCall(560, () => { c.destroy(); if (this.wipe === c) this.wipe = undefined; });
  }

  /** Pixel wipe out, then start another scene. */
  goto(key: string, data?: object): void {
    if (this.wipe) this.wipe.destroy();
    const c = this.makeWipe();
    this.wipe = c;
    const max = Math.max(...c.list.map((o) => o.getData('d') as number));
    for (const o of c.list as Phaser.GameObjects.Rectangle[]) {
      o.setScale(0).setAngle(45);
      this.tweens.add({ targets: o, scale: 1, angle: 0, duration: 200, delay: (o.getData('d') / max) * 240, ease: 'Quad.easeOut' });
    }
    this.time.delayedCall(480, () => this.scene.start(key, data));
  }
}

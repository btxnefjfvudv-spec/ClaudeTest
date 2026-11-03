import Phaser from 'phaser';
import { View } from '../../config';
import type { PlayerIndex } from '../../core/types';
import type { BaseMinigame } from '../BaseMinigame';

/**
 * Split screen: one camera per player in their quadrant, each looking at its
 * own copy of the course (placed TRACK_GAP apart in world Y). Cameras of
 * players across the table are rotated 180° so everyone sees their view upright.
 * The main camera (HUD/overlays) is re-ordered to draw last.
 */
export const TRACK_GAP = 2000;

export class SplitKit {
  readonly cams: Phaser.Cameras.Scene2D.Camera[] = [];
  /** World size each camera shows. */
  readonly viewW: number;
  readonly viewH: number;

  constructor(private readonly g: BaseMinigame) {
    this.viewW = g.vw / 2;
    this.viewH = g.vh / 2;
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const cam = g.cameras.add(0, 0, 10, 10, false, `p${p}`);
      this.cams.push(cam);
    }
    this.layout();
    // Main camera last so the HUD draws over the split views.
    const list = g.cameras.cameras;
    const main = g.cameras.main;
    list.splice(list.indexOf(main), 1);
    list.push(main);
    main.transparent = true;
    g.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    g.events.once(Phaser.Scenes.Events.SHUTDOWN, () => g.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this));
  }

  /** World Y offset of a player's course copy. */
  offsetY(p: PlayerIndex): number {
    return TRACK_GAP * (p + 1);
  }

  layout(): void {
    const zoom = this.g.cameras.main.zoom || View.zoom;
    const offX = -this.g.cameras.main.scrollX * zoom;
    const offY = -this.g.cameras.main.scrollY * zoom;
    const cw = (this.g.vw / 2) * zoom, ch = (this.g.vh / 2) * zoom;
    this.cams.forEach((cam, p) => {
      const zone = this.g.zoneOf(p as PlayerIndex);
      cam.setViewport(offX + zone.x * this.g.vw * zoom, offY + zone.y * this.g.vh * zoom, cw, ch);
      cam.setZoom(zoom);
      cam.setOrigin(0.5, 0.5);
      cam.setRotation(zone.facing === 180 ? Math.PI : 0);
    });
  }

  /** Centre a player's camera on a world point (x, y in their course copy). */
  look(p: PlayerIndex, x: number, y: number): void {
    const cam = this.cams[p];
    cam.centerOn(x, y);
  }

  /** Hide objects from every split camera (HUD-only objects). */
  hideFromSplit(...objs: Phaser.GameObjects.GameObject[]): void {
    for (const c of this.cams) c.ignore(objs);
  }
}

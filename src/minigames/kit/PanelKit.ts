import Phaser from 'phaser';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { PLAYER_COLORS } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import type { TouchZone, TrackedTouch } from '../../systems/input/MultiTouchManager';
import type { BaseMinigame } from '../BaseMinigame';

/**
 * Per-player panel: a container centred on the player's zone and rotated to
 * face their seat. Draw everything for that player inside `c` using LOCAL
 * coordinates: x ∈ [-w/2, w/2] (left→right as the player sees it),
 * y ∈ [-h/2, h/2] (top→bottom as the player sees it; +y is toward the player).
 */
export interface Panel {
  p: PlayerIndex;
  zone: TouchZone;
  rect: Phaser.Geom.Rectangle;
  c: Phaser.GameObjects.Container;
  w: number;
  h: number;
}

export class PanelKit {
  readonly panels: Panel[] = [];

  constructor(private readonly g: BaseMinigame, opts: { frame?: boolean; inset?: number } = {}) {
    const inset = opts.inset ?? 4;
    for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
      const zone = g.zoneOf(p);
      const rect = g.touch.zoneRect(zone);
      const sideways = zone.facing === 90 || zone.facing === 270;
      const w = (sideways ? rect.height : rect.width) - inset * 2;
      const h = (sideways ? rect.width : rect.height) - inset * 2;
      const c = g.add.container(rect.centerX, rect.centerY).setAngle(zone.facing).setDepth(10);
      if (opts.frame !== false) {
        const col = PLAYER_COLORS[p];
        c.add(g.add.rectangle(0, 0, w, h, shift(col.main, -0.75), 0.92).setStrokeStyle(3, col.main, 0.9));
      }
      if (!g.players.includes(p)) c.setAlpha(0.3);
      this.panels.push({ p, zone, rect, c, w, h });
    }
  }

  panel(p: PlayerIndex): Panel {
    return this.panels[p];
  }

  /** World point → panel-local point (see Panel docs). */
  toLocal(p: PlayerIndex, x: number, y: number): { x: number; y: number } {
    const pn = this.panels[p];
    const dx = x - pn.rect.centerX, dy = y - pn.rect.centerY;
    switch (pn.zone.facing) {
      case 180: return { x: -dx, y: -dy };
      case 90: return { x: dy, y: -dx };
      case 270: return { x: -dy, y: dx };
      default: return { x: dx, y: dy };
    }
  }

  /** Panel-local point → world point. */
  toWorld(p: PlayerIndex, lx: number, ly: number): { x: number; y: number } {
    const pn = this.panels[p];
    switch (pn.zone.facing) {
      case 180: return { x: pn.rect.centerX - lx, y: pn.rect.centerY - ly };
      case 90: return { x: pn.rect.centerX - ly, y: pn.rect.centerY + lx };
      case 270: return { x: pn.rect.centerX + ly, y: pn.rect.centerY - lx };
      default: return { x: pn.rect.centerX + lx, y: pn.rect.centerY + ly };
    }
  }

  /** Current fingers of a player in panel-local coordinates. */
  localTouches(p: PlayerIndex): { x: number; y: number; sx: number; sy: number; t: TrackedTouch }[] {
    return this.g.touch.touchesFor(p).map((t) => {
      const l = this.toLocal(p, t.x, t.y);
      const s = this.toLocal(p, t.startX, t.startY);
      return { x: l.x, y: l.y, sx: s.x, sy: s.y, t };
    });
  }

  /** Call cb(p, localX, localY) for every tap (finger down) inside a player's panel. */
  onDown(cb: (p: PlayerIndex, lx: number, ly: number) => void): void {
    this.g.touch.on('down', (t: TrackedTouch) => {
      if (this.g.state !== 'play' || !this.g.players.includes(t.player)) return;
      const l = this.toLocal(t.player, t.x, t.y);
      cb(t.player, l.x, l.y);
    });
  }

  /** Helper: add a pixel-art image into a panel at local coords. */
  image(p: PlayerIndex, lx: number, ly: number, key: string, frame?: string | number, scale = S): Phaser.GameObjects.Image {
    const img = this.g.add.image(lx, ly, key, frame).setScale(scale);
    this.panels[p].c.add(img);
    return img;
  }
}

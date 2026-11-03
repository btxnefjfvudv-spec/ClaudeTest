import Phaser from 'phaser';
import type { PlayerIndex } from '../../core/types';
import { View, WORLD_H } from '../../config';

/** A player's touch area in normalised screen space (0..1). */
export interface TouchZone {
  player: PlayerIndex;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Which way the player sits, in degrees: the rotation their UI needs to read
   * upright. 0 = bottom edge, 180 = top edge (across the table), 90 = left, 270 = right.
   */
  facing: 0 | 90 | 180 | 270;
}

export type ZoneLayout = 'quadrants' | 'columns' | 'halves';

/** Default layouts. Minigames can pass their own zones instead. */
export const ZONE_LAYOUTS: Record<ZoneLayout, TouchZone[]> = {
  // Players sit around the iPad: P1, P2 across the table (top edge), P3, P4 on the near side.
  quadrants: [
    { player: 0, x: 0, y: 0, w: 0.5, h: 0.5, facing: 180 },
    { player: 1, x: 0.5, y: 0, w: 0.5, h: 0.5, facing: 180 },
    { player: 2, x: 0, y: 0.5, w: 0.5, h: 0.5, facing: 0 },
    { player: 3, x: 0.5, y: 0.5, w: 0.5, h: 0.5, facing: 0 },
  ],
  // Everyone on one side of the iPad.
  columns: [
    { player: 0, x: 0, y: 0, w: 0.25, h: 1, facing: 0 },
    { player: 1, x: 0.25, y: 0, w: 0.25, h: 1, facing: 0 },
    { player: 2, x: 0.5, y: 0, w: 0.25, h: 1, facing: 0 },
    { player: 3, x: 0.75, y: 0, w: 0.25, h: 1, facing: 0 },
  ],
  // Two teams: P1+P3 left half, P2+P4 right half.
  halves: [
    { player: 0, x: 0, y: 0, w: 0.5, h: 0.5, facing: 180 },
    { player: 2, x: 0, y: 0.5, w: 0.5, h: 0.5, facing: 0 },
    { player: 1, x: 0.5, y: 0, w: 0.5, h: 0.5, facing: 180 },
    { player: 3, x: 0.5, y: 0.5, w: 0.5, h: 0.5, facing: 0 },
  ],
};

export interface TrackedTouch {
  pointerId: number;
  player: PlayerIndex;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startTime: number;
}

export interface SwipeInfo {
  /** Screen-space movement. */
  dx: number;
  dy: number;
  /** Movement as the player sees it from their seat (up = away from them). */
  localDx: number;
  localDy: number;
  /** Angle of the local movement. */
  angle: number;
  speed: number;
}

/** Rotate a screen-space vector into the frame of a player sitting at `facing`. */
export function toLocal(facing: number, dx: number, dy: number): { x: number; y: number } {
  switch (facing) {
    case 180: return { x: -dx, y: -dy };
    case 90: return { x: dy, y: -dx };
    case 270: return { x: -dy, y: dx };
    default: return { x: dx, y: dy };
  }
}

const TAP_MAX_MS = 350;
const TAP_MAX_MOVE = 0.03; // fraction of the shorter screen side
const SWIPE_MIN_MOVE = 0.06;

/**
 * Routes every finger to exactly one player.
 * A finger belongs to the player whose zone it first touched and stays theirs
 * until it lifts or is cancelled, even if it slides into another zone.
 *
 * Events (all receive the TrackedTouch):
 *   'down', 'move', 'up', 'tap', 'swipe' (touch, SwipeInfo), 'cancel'
 */
export class MultiTouchManager extends Phaser.Events.EventEmitter {
  private readonly scene: Phaser.Scene;
  private zones: TouchZone[];
  private readonly touches = new Map<number, TrackedTouch>();
  enabled = true;

  constructor(scene: Phaser.Scene, layout: ZoneLayout | TouchZone[] = 'quadrants') {
    super();
    this.scene = scene;
    this.zones = typeof layout === 'string' ? ZONE_LAYOUTS[layout] : layout;

    const input = scene.input;
    input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    scene.game.events.on(Phaser.Core.Events.BLUR, this.releaseAll, this);
    scene.game.events.on(Phaser.Core.Events.HIDDEN, this.releaseAll, this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.failsafe, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  setLayout(layout: ZoneLayout | TouchZone[]): void {
    this.releaseAll();
    this.zones = typeof layout === 'string' ? ZONE_LAYOUTS[layout] : layout;
  }

  getZones(): readonly TouchZone[] {
    return this.zones;
  }

  /** World size this manager maps zones onto. */
  private get world(): { width: number; height: number } {
    const s = this.scene as Phaser.Scene & { vw?: number; vh?: number };
    return { width: s.vw ?? View.width, height: s.vh ?? WORLD_H };
  }

  /** Pointer position in world units (main camera). */
  private worldOf(pointer: Phaser.Input.Pointer): { x: number; y: number } {
    const v = pointer.positionToCamera(this.scene.cameras.main) as Phaser.Math.Vector2;
    return { x: v.x, y: v.y };
  }

  /** Zone rectangle in world units. */
  zoneRect(zone: TouchZone): Phaser.Geom.Rectangle {
    const { width, height } = this.world;
    return new Phaser.Geom.Rectangle(zone.x * width, zone.y * height, zone.w * width, zone.h * height);
  }

  zoneAt(x: number, y: number): TouchZone | undefined {
    const { width, height } = this.world;
    const nx = x / width;
    const ny = y / height;
    return this.zones.find((z) => nx >= z.x && nx < z.x + z.w && ny >= z.y && ny < z.y + z.h);
  }

  playerAt(x: number, y: number): PlayerIndex | undefined {
    return this.zoneAt(x, y)?.player;
  }

  zoneOf(player: PlayerIndex): TouchZone | undefined {
    return this.zones.find((z) => z.player === player);
  }

  /** Active fingers for one player, oldest first. */
  touchesFor(player: PlayerIndex): TrackedTouch[] {
    const out: TrackedTouch[] = [];
    for (const t of this.touches.values()) if (t.player === player) out.push(t);
    return out;
  }

  isHeld(player: PlayerIndex): boolean {
    for (const t of this.touches.values()) if (t.player === player) return true;
    return false;
  }

  get activeCount(): number {
    return this.touches.size;
  }

  /** Lift every finger, e.g. on pause, scene change or app backgrounding. */
  releaseAll(): void {
    for (const t of [...this.touches.values()]) {
      this.touches.delete(t.pointerId);
      this.emit('cancel', t);
    }
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    if (!this.enabled) return;
    const w = this.worldOf(pointer);
    const player = this.playerAt(w.x, w.y);
    if (player === undefined) return;
    const t: TrackedTouch = {
      pointerId: pointer.id,
      player,
      startX: w.x,
      startY: w.y,
      x: w.x,
      y: w.y,
      startTime: this.scene.time.now,
    };
    this.touches.set(pointer.id, t);
    this.emit('down', t);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const t = this.touches.get(pointer.id);
    if (!t) return;
    const w = this.worldOf(pointer);
    t.x = w.x;
    t.y = w.y;
    this.emit('move', t);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const t = this.touches.get(pointer.id);
    if (!t) return;
    const w = this.worldOf(pointer);
    t.x = w.x;
    t.y = w.y;
    this.touches.delete(pointer.id);

    if (pointer.wasCanceled) {
      this.emit('cancel', t);
      return;
    }
    this.emit('up', t);

    const unit = Math.min(this.world.width, this.world.height);
    const dx = t.x - t.startX;
    const dy = t.y - t.startY;
    const dist = Math.hypot(dx, dy);
    const ms = Math.max(1, this.scene.time.now - t.startTime);

    if (ms <= TAP_MAX_MS && dist <= TAP_MAX_MOVE * unit) {
      this.emit('tap', t);
    } else if (dist >= SWIPE_MIN_MOVE * unit) {
      const local = toLocal(this.zoneOf(t.player)?.facing ?? 0, dx, dy);
      const swipe: SwipeInfo = {
        dx,
        dy,
        localDx: local.x,
        localDy: local.y,
        angle: Math.atan2(local.y, local.x),
        speed: dist / ms,
      };
      this.emit('swipe', t, swipe);
    }
  }

  /** Drop any finger Phaser no longer reports as down, so nothing gets stuck. */
  private failsafe(): void {
    if (this.touches.size === 0) return;
    const pointers = this.scene.input.manager.pointers;
    for (const t of [...this.touches.values()]) {
      const p = pointers.find((ptr) => ptr.id === t.pointerId);
      if (!p || !p.isDown) {
        this.touches.delete(t.pointerId);
        this.emit('cancel', t);
      }
    }
  }

  destroy(): void {
    const input = this.scene.input;
    input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    this.scene.game.events.off(Phaser.Core.Events.BLUR, this.releaseAll, this);
    this.scene.game.events.off(Phaser.Core.Events.HIDDEN, this.releaseAll, this);
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.failsafe, this);
    this.touches.clear();
    super.destroy();
  }
}

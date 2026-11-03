import Phaser from 'phaser';
import type { PlayerIndex } from '../../core/types';

/** A player's touch area in normalised screen space (0..1). */
export interface TouchZone {
  player: PlayerIndex;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ZoneLayout = 'quadrants' | 'columns' | 'halves';

/** Default layouts. Minigames can pass their own zones instead. */
export const ZONE_LAYOUTS: Record<ZoneLayout, TouchZone[]> = {
  // P1 top-left, P2 top-right, P3 bottom-left, P4 bottom-right.
  quadrants: [
    { player: 0, x: 0, y: 0, w: 0.5, h: 0.5 },
    { player: 1, x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { player: 2, x: 0, y: 0.5, w: 0.5, h: 0.5 },
    { player: 3, x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  ],
  columns: [
    { player: 0, x: 0, y: 0, w: 0.25, h: 1 },
    { player: 1, x: 0.25, y: 0, w: 0.25, h: 1 },
    { player: 2, x: 0.5, y: 0, w: 0.25, h: 1 },
    { player: 3, x: 0.75, y: 0, w: 0.25, h: 1 },
  ],
  // Two teams: P1+P3 left, P2+P4 right; each half split top/bottom.
  halves: [
    { player: 0, x: 0, y: 0, w: 0.5, h: 0.5 },
    { player: 2, x: 0, y: 0.5, w: 0.5, h: 0.5 },
    { player: 1, x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { player: 3, x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
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
  dx: number;
  dy: number;
  angle: number;
  speed: number;
}

const TAP_MAX_MS = 250;
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

  /** Zone rectangle in game pixels. */
  zoneRect(zone: TouchZone): Phaser.Geom.Rectangle {
    const { width, height } = this.scene.scale.gameSize;
    return new Phaser.Geom.Rectangle(zone.x * width, zone.y * height, zone.w * width, zone.h * height);
  }

  playerAt(x: number, y: number): PlayerIndex | undefined {
    const { width, height } = this.scene.scale.gameSize;
    const nx = x / width;
    const ny = y / height;
    for (const z of this.zones) {
      if (nx >= z.x && nx < z.x + z.w && ny >= z.y && ny < z.y + z.h) return z.player;
    }
    return undefined;
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
    const player = this.playerAt(pointer.x, pointer.y);
    if (player === undefined) return;
    const t: TrackedTouch = {
      pointerId: pointer.id,
      player,
      startX: pointer.x,
      startY: pointer.y,
      x: pointer.x,
      y: pointer.y,
      startTime: this.scene.time.now,
    };
    this.touches.set(pointer.id, t);
    this.emit('down', t);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const t = this.touches.get(pointer.id);
    if (!t) return;
    t.x = pointer.x;
    t.y = pointer.y;
    this.emit('move', t);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const t = this.touches.get(pointer.id);
    if (!t) return;
    t.x = pointer.x;
    t.y = pointer.y;
    this.touches.delete(pointer.id);

    if (pointer.wasCanceled) {
      this.emit('cancel', t);
      return;
    }
    this.emit('up', t);

    const { width, height } = this.scene.scale.gameSize;
    const unit = Math.min(width, height);
    const dx = t.x - t.startX;
    const dy = t.y - t.startY;
    const dist = Math.hypot(dx, dy);
    const ms = Math.max(1, this.scene.time.now - t.startTime);

    if (ms <= TAP_MAX_MS && dist <= TAP_MAX_MOVE * unit) {
      this.emit('tap', t);
    } else if (dist >= SWIPE_MIN_MOVE * unit) {
      const swipe: SwipeInfo = { dx, dy, angle: Math.atan2(dy, dx), speed: dist / ms };
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

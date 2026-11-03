import Phaser from 'phaser';
import { S } from '../art/common';
import { shift } from '../art/color';
import { makeTexture } from '../art/Painter';
import { PLAYER_COLORS } from '../core/palette';
import type { PlayerIndex } from '../core/types';
import { toLocal, type MultiTouchManager, type TouchZone, type TrackedTouch } from '../systems/input/MultiTouchManager';

function buttonTexture(scene: Phaser.Scene, p: PlayerIndex, r: number, down: boolean): string {
  const c = PLAYER_COLORS[p];
  const size = r * 2 + 2;
  return makeTexture(scene, `tbtn-${p}-${r}-${down ? 1 : 0}`, size, size + 2, (g) => {
    const cx = r + 1, cy = r + 1 + (down ? 2 : 0);
    if (!down) g.circle(r + 1, r + 3, r, shift(c.main, -0.6));
    g.circle(cx, cy, r, shift(c.main, -0.45));
    g.circle(cx, cy, r - 1, c.main);
    g.ellipse(cx - r * 0.25, cy - r * 0.35, r * 0.5, r * 0.3, c.light);
    g.ellipse(cx, cy + r * 0.55, r * 0.6, r * 0.22, shift(c.main, -0.2));
  });
}

/** Map a point given in the player's own frame (u,v in 0..1 of their zone) to world coords. */
export function zonePoint(mgr: MultiTouchManager, zone: TouchZone, u: number, v: number): { x: number; y: number } {
  const r = mgr.zoneRect(zone);
  switch (zone.facing) {
    case 180: return { x: r.right - u * r.width, y: r.bottom - v * r.height };
    case 90: return { x: r.x + v * r.width, y: r.bottom - u * r.height };
    case 270: return { x: r.right - v * r.width, y: r.y + u * r.height };
    default: return { x: r.x + u * r.width, y: r.y + v * r.height };
  }
}

/**
 * A round on-screen button owned by one player. Only that player's fingers
 * can press it; the hit area is generous so it works without looking.
 */
export class TouchButton {
  readonly x: number;
  readonly y: number;
  private readonly img: Phaser.GameObjects.Image;
  private readonly icon?: Phaser.GameObjects.Image;
  private readonly upKey: string;
  private readonly downKey: string;
  private down = false;
  private prev = false;
  private readonly hitR: number;
  onPress?: () => void;
  onRelease?: () => void;

  constructor(
    scene: Phaser.Scene,
    private readonly mgr: MultiTouchManager,
    readonly player: PlayerIndex,
    u: number,
    v: number,
    icon?: string,
    radius = 13,
  ) {
    const zone = mgr.zoneOf(player)!;
    const pt = zonePoint(mgr, zone, u, v);
    this.x = pt.x;
    this.y = pt.y;
    this.hitR = radius * S * 1.45;
    this.upKey = buttonTexture(scene, player, radius, false);
    this.downKey = buttonTexture(scene, player, radius, true);
    this.img = scene.add.image(pt.x, pt.y, this.upKey).setScale(S).setDepth(900).setAngle(zone.facing).setAlpha(0.92);
    if (icon) this.icon = scene.add.image(pt.x, pt.y - (zone.facing === 180 ? -1 : 1) * 1, `icon-${icon}`).setScale(S * 1.3).setDepth(901).setAngle(zone.facing).setTint(0xffffff);
    scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.poll, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.poll, this));
  }

  /** True if this touch is on the button (used by sticks to ignore button fingers). */
  owns(t: TrackedTouch): boolean {
    return Math.hypot(t.startX - this.x, t.startY - this.y) <= this.hitR;
  }

  private poll(): void {
    const touches = this.mgr.touchesFor(this.player);
    this.prev = this.down;
    this.down = touches.some((t) => Math.hypot(t.x - this.x, t.y - this.y) <= this.hitR && this.owns(t));
    if (this.down !== this.prev) {
      this.img.setTexture(this.down ? this.downKey : this.upKey);
      this.icon?.setY(this.y + (this.down ? 2 : -1) * (this.img.angle === 180 ? -1 : 1));
      if (this.down) this.onPress?.();
      else this.onRelease?.();
    }
  }

  /** Simulate a press (CPU players / tests). */
  press(): void {
    this.onPress?.();
  }

  get isDown(): boolean {
    return this.down;
  }

  get justPressed(): boolean {
    return this.down && !this.prev;
  }

  setVisible(v: boolean): this {
    this.img.setVisible(v);
    this.icon?.setVisible(v);
    return this;
  }

  destroy(): void {
    this.img.destroy();
    this.icon?.destroy();
  }
}

/**
 * Relative drag stick: put a finger anywhere in your zone and slide.
 * Gives a world-space direction (already rotated for the player's seat).
 */
export class DragStick {
  vx = 0;
  vy = 0;
  private base?: Phaser.GameObjects.Image;
  private knob?: Phaser.GameObjects.Image;
  private touchId = -1;
  private readonly radius: number;
  exclude: TouchButton[] = [];

  constructor(scene: Phaser.Scene, private readonly mgr: MultiTouchManager, readonly player: PlayerIndex, radius = 30) {
    this.radius = radius;
    const c = PLAYER_COLORS[player];
    const bk = makeTexture(scene, `stick-base-${player}`, 32, 32, (g) => { g.ring(16, 16, 15.5, c.light, 2); g.ring(16, 16, 12, c.main, 1); });
    const kk = makeTexture(scene, `stick-knob-${player}`, 14, 14, (g) => { g.ball(7, 7, 6.5, 6.5, c.main); g.outline(-0.6); });
    this.base = scene.add.image(0, 0, bk).setScale(S * radius / 30).setDepth(890).setAlpha(0.55).setVisible(false);
    this.knob = scene.add.image(0, 0, kk).setScale(S).setDepth(891).setVisible(false);
    scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.poll, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.poll, this));
  }

  private poll(): void {
    const touches = this.mgr.touchesFor(this.player).filter((t) => !this.exclude.some((b) => b.owns(t)));
    let t = touches.find((x) => x.pointerId === this.touchId);
    if (!t) t = touches[0];
    if (!t) {
      this.touchId = -1;
      this.vx = this.vy = 0;
      this.base?.setVisible(false);
      this.knob?.setVisible(false);
      return;
    }
    this.touchId = t.pointerId;
    let dx = t.x - t.startX, dy = t.y - t.startY;
    const len = Math.hypot(dx, dy);
    const max = this.radius;
    if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
    const dead = 4;
    const mag = len < dead ? 0 : Math.min(1, (Math.min(len, max) - dead) / (max - dead));
    this.vx = len ? (dx / Math.min(len, max)) * mag : 0;
    this.vy = len ? (dy / Math.min(len, max)) * mag : 0;
    this.base?.setVisible(true).setPosition(t.startX, t.startY);
    this.knob?.setVisible(true).setPosition(t.startX + dx, t.startY + dy);
  }

  /** Direction in the player's own frame (up = away from their seat). */
  local(): { x: number; y: number } {
    const zone = this.mgr.zoneOf(this.player)!;
    return toLocal(zone.facing, this.vx, this.vy);
  }

  get active(): boolean {
    return this.touchId !== -1;
  }
}

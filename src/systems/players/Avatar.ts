import Phaser from 'phaser';
import { buildCharacter } from '../../art/CharacterArt';
import { S } from '../../art/common';
import { shift } from '../../art/color';
import { makeTexture } from '../../art/Painter';
import { PLAYER_COLORS } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import { characterById } from '../../data/characters';
import { Party } from '../party/Party';

const DIGITS = [
  ['.a.', 'aa.', '.a.', '.a.', 'aaa'],
  ['aa.', '..a', '.a.', 'a..', 'aaa'],
  ['aa.', '..a', '.a.', '..a', 'aa.'],
  ['a.a', 'a.a', 'aaa', '..a', '..a'],
];

/** Floating "1..4" badge in the player's colour. */
export function playerMarkerKey(scene: Phaser.Scene, p: PlayerIndex): string {
  const c = PLAYER_COLORS[p];
  return makeTexture(scene, `pmark-${p}`, 9, 11, (g) => {
    g.rect(1, 0, 7, 8, c.main);
    g.rect(0, 1, 9, 6, c.main);
    g.hline(1, 1, 3, c.light);
    g.tri(2, 7.5, 7, 7.5, 4.5, 10.5, c.main);
    g.stamp(3, 1, DIGITS[p], { a: 0xffffff });
    g.outline(-0.8);
  });
}

/** Coloured ground ring under a player for top-down games. */
export function playerRingKey(scene: Phaser.Scene, p: PlayerIndex): string {
  const c = PLAYER_COLORS[p];
  return makeTexture(scene, `pring-${p}`, 20, 8, (g) => {
    g.ellipse(10, 4, 10, 4, shift(c.main, -0.2));
    g.ellipse(10, 4, 7.5, 2.6, 0x000000, 0);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 20; x++) {
      const nx = (x + 0.5 - 10) / 7.5, ny = (y + 0.5 - 4) / 2.6;
      if (nx * nx + ny * ny < 1) g.clear(x, y);
    }
  });
}

export interface AvatarOpts {
  scale?: number;
  marker?: boolean;
  ring?: boolean;
  shadow?: boolean;
  depthSort?: boolean;
}

/**
 * A player's character in the world: sprite + contact shadow + marker.
 * Position is the feet. `z` lifts the sprite (jumps in top-down games).
 */
export class Avatar {
  readonly scene: Phaser.Scene;
  readonly player: PlayerIndex;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow?: Phaser.GameObjects.Image;
  readonly ring?: Phaser.GameObjects.Image;
  readonly marker?: Phaser.GameObjects.Image;
  readonly key: string;
  x: number;
  y: number;
  z = 0;
  facing = 1;
  scale: number;
  private current = '';
  private depthSort: boolean;
  /** Extra marker rotation for players seated across the table. */
  markerAngle = 0;

  constructor(scene: Phaser.Scene, player: PlayerIndex, x: number, y: number, o: AvatarOpts = {}) {
    this.scene = scene;
    this.player = player;
    this.x = x;
    this.y = y;
    this.scale = o.scale ?? S;
    this.depthSort = o.depthSort ?? true;
    const ch = characterById(Party.slots[player].characterId);
    this.key = buildCharacter(scene, ch.id, ch.look);
    if (o.shadow !== false) this.shadow = scene.add.image(x, y, 'shadow').setAlpha(0.28).setScale(this.scale * 0.6);
    if (o.ring) this.ring = scene.add.image(x, y, playerRingKey(scene, player)).setScale(this.scale * 0.75).setAlpha(0.9);
    this.sprite = scene.add.sprite(x, y, this.key, 0).setOrigin(0.5, 1).setScale(this.scale);
    if (o.marker !== false) this.marker = scene.add.image(x, y, playerMarkerKey(scene, player)).setScale(this.scale * 0.9).setOrigin(0.5, 1);
    this.play('idle');
    this.sync();
  }

  play(anim: string, force = false): this {
    if (!force && this.current === anim) return this;
    this.current = anim;
    this.sprite.play(`${this.key}-${anim}`);
    return this;
  }

  get anim(): string {
    return this.current;
  }

  face(dir: number): this {
    if (dir === 0) return this;
    this.facing = dir > 0 ? 1 : -1;
    this.sprite.scaleX = Math.abs(this.sprite.scaleX) * this.facing;
    return this;
  }

  setPos(x: number, y: number, z = this.z): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this.sync();
  }

  sync(): this {
    const { x, y, z } = this;
    this.sprite.setPosition(x, y - z);
    this.shadow?.setPosition(x, y).setScale(this.scale * 0.6 * Math.max(0.4, 1 - z / 120), this.scale * 0.6 * Math.max(0.4, 1 - z / 120));
    this.ring?.setPosition(x, y + 1);
    if (this.marker) {
      const top = y - z - 33 * this.scale * Math.abs(this.sprite.scaleY / this.scale);
      this.marker.setPosition(x, top + Math.sin(this.scene.time.now / 220) * 2).setAngle(this.markerAngle);
    }
    if (this.depthSort) {
      const d = y;
      this.shadow?.setDepth(d - 1000);
      this.ring?.setDepth(d - 999);
      this.sprite.setDepth(d);
      this.marker?.setDepth(d + 2000);
    }
    return this;
  }

  setVisible(v: boolean): this {
    this.sprite.setVisible(v);
    this.shadow?.setVisible(v);
    this.ring?.setVisible(v);
    this.marker?.setVisible(v);
    return this;
  }

  setAlpha(a: number): this {
    this.sprite.setAlpha(a);
    this.marker?.setAlpha(a);
    return this;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow?.destroy();
    this.ring?.destroy();
    this.marker?.destroy();
  }
}

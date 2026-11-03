import Phaser from 'phaser';
import { buildCharacter } from '../art/CharacterArt';
import { S } from '../art/common';
import {
  CLASS_H, WALL_BOTTOM, classroomLayout, paintCloud, paintDesk, paintFloor, paintLightShaft, paintOutside, paintTree, paintWall,
} from '../art/classroom';
import { CHARACTERS, characterById } from '../data/characters';
import { SEATING, loadSeating } from '../data/seating';
import { burst } from '../systems/vfx/Vfx';

/** Classroom draws in a negative depth band so any UI (depth ≥ 0) is above it. */
const D = -10000;

export interface Seat {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Sprite;
  key: string;
  busy: boolean;
}

/**
 * Living classroom: layered background, swaying trees, drifting clouds,
 * spinning fans, dust in the sun, and seated classmates doing little things.
 */
export class ClassroomView {
  seats: Seat[] = [];
  private readonly scene: Phaser.Scene;
  private boardX = 0;

  constructor(scene: Phaser.Scene, worldW: number, opts: { rows?: number[]; seated?: boolean } = {}) {
    this.scene = scene;
    const aw = Math.ceil(worldW / S);
    const L = classroomLayout(aw);
    this.boardX = L.board.x * S;

    // Far: outside
    scene.add.image(0, 0, paintOutside(scene, aw)).setOrigin(0).setScale(S).setDepth(D + (-100));
    const cloudKey = paintCloud(scene);
    for (let i = 0; i < 3; i++) {
      const c = scene.add.image(Math.random() * worldW, 10 + Math.random() * 30, cloudKey).setScale(S).setDepth(D + (-99)).setAlpha(0.9);
      scene.tweens.add({ targets: c, x: { from: -80, to: worldW + 80 }, duration: 80000 + i * 15000, repeat: -1, delay: -i * 20000 });
    }
    const treeKey = paintTree(scene);
    for (const win of L.windows) {
      for (let k = 0; k < 2; k++) {
        const t = scene.add.image((win.x + win.w * (0.25 + k * 0.5)) * S, (win.y + win.h + 4) * S, treeKey).setOrigin(0.5, 1).setScale(S).setDepth(D + (-98));
        scene.tweens.add({ targets: t, angle: { from: -1.2, to: 1.2 }, x: t.x + 3, duration: 2400 + Math.random() * 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    }
    // Wall + floor
    scene.add.image(0, 0, paintWall(scene, aw, L)).setOrigin(0).setScale(S).setDepth(D + (-90));
    scene.add.image(0, WALL_BOTTOM * S, paintFloor(scene, aw)).setOrigin(0).setScale(S).setDepth(D + (-89));
    // Daylight from the windows + dust in the air
    const shaft = paintLightShaft(scene);
    for (const win of L.windows) {
      const s = scene.add.image((win.x + 4) * S, (win.y + win.h) * S, shaft).setOrigin(0, 0).setScale(S).setDepth(D + (-80)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.8);
      scene.tweens.add({ targets: s, alpha: 0.5, duration: 3200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const dust = scene.add.particles(0, 0, 'dot2', {
        x: { min: (win.x + 4) * S, max: (win.x + win.w + 30) * S },
        y: { min: win.y * S + 120, max: CLASS_H * S - 40 },
        lifespan: 4000, speedX: { min: -6, max: 6 }, speedY: { min: -8, max: 2 },
        scale: { start: 1, end: 0 }, alpha: { start: 0.7, end: 0 }, frequency: 600, tint: 0xffffff,
      });
      dust.setDepth(D + (-79));
    }
    // Fluorescent flicker on one tube (life!)
    const flick = scene.add.rectangle(14 * S + 64 * S, 13 * S, 32 * S, 2 * S, 0xffffff).setOrigin(0).setDepth(D + (-60)).setAlpha(0);
    scene.time.addEvent({ delay: 2600, loop: true, callback: () => { if (Math.random() < 0.5) scene.tweens.add({ targets: flick, alpha: { from: 0.9, to: 0 }, duration: 90, repeat: 2 }); } });
    paintDesk(scene);
    // Oscillating ceiling fans + projector
    for (const fx of [0.18, 0.46, 0.74]) {
      const f = scene.add.sprite(worldW * fx, 18, 'cls-fan').setOrigin(0.5, 0).setScale(S).setDepth(D + (-70));
      f.play('cls-fan-spin');
      scene.tweens.add({ targets: f, scaleX: { from: S, to: S * 0.55 }, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
    scene.add.image(worldW * 0.6, 18, 'cls-projector').setOrigin(0.5, 0).setScale(S).setDepth(D + (-69));
    // Props from the photos
    const floorY = WALL_BOTTOM * S;
    scene.add.image(this.boardX - 16, floorY + 46, 'cls-teacher-desk').setOrigin(0.5, 1).setScale(S).setDepth(D + (floorY + 46));
    scene.add.image(this.boardX - 26, floorY - 14, 'cls-books').setOrigin(0.5, 1).setScale(S).setDepth(D + (floorY + 47));
    scene.add.image(this.boardX + 30, floorY + 40, 'cls-bluechair').setOrigin(0.5, 1).setScale(S).setDepth(D + (floorY + 40));
    scene.add.image(8, floorY + 14, 'cls-door').setOrigin(0, 1).setScale(S).setDepth(D + (floorY));
    scene.add.image(80, floorY + 8, 'cls-broom').setOrigin(0.5, 1).setScale(S).setDepth(D + (floorY + 8)).setAngle(-8);
    scene.add.image(98, floorY + 10, 'cls-dustpan').setOrigin(0.5, 1).setScale(S).setDepth(D + (floorY + 10));
    scene.add.image(worldW - 20, floorY + 10, 'cls-bin').setOrigin(0.5, 1).setScale(S).setDepth(D + (floorY + 10));

    if (opts.seated !== false) this.placeStudents(opts.rows ?? [318, 372, 426]);
  }

  /**
   * The hub shows up to 12 friends at desks. Friends assigned on the seating
   * chart come first, front rows first; everyone else follows.
   */
  private placeStudents(rows: number[]): void {
    loadSeating();
    const assigned = [...SEATING].sort((a, b) => a.row - b.row || a.column - b.column).map((s) => s.characterId);
    const ids = [...new Set([...assigned, ...CHARACTERS.map((c) => c.id)])];
    const left = 70, right = this.boardX - 150;
    const cols = 4;
    const colX = (c: number) => left + (cols - 1 - c) * ((right - left) / Math.max(1, cols - 1));
    ids.slice(0, rows.length * cols).forEach((id, i) => {
      const row = Math.floor(i / cols), column = i % cols;
      const y = rows[row];
      const x = colX(column) + (row % 2) * 6;
      const ch = characterById(id);
      const key = buildCharacter(this.scene, ch.id, ch.look);
      this.scene.add.image(x - 14, y, 'cls-chair').setOrigin(0.5, 1).setScale(S).setDepth(D + (y - 2));
      const sprite = this.scene.add.sprite(x, y - 4, key, 24).setOrigin(0.5, 1).setScale(S).setDepth(D + (y - 1));
      this.scene.add.image(x + 40, y + 2, 'cls-desk').setOrigin(0.5, 1).setScale(S).setDepth(D + (y));
      if ((row + column) % 3 === 0) this.scene.add.image(x + 22, y + 2, 'cls-bag').setOrigin(0.5, 1).setScale(S).setDepth(D + (y + 1));
      this.seats.push({ x, y: y - 4, sprite, key, busy: false });
    });
    this.scene.time.addEvent({ delay: 1400, loop: true, callback: () => this.randomEvent() });
  }

  /** Small random classroom moments so the room feels alive. */
  private randomEvent(): void {
    const free = this.seats.filter((s) => !s.busy);
    if (!free.length) return;
    const s = free[Math.floor(Math.random() * free.length)];
    s.busy = true;
    const sc = this.scene;
    const done = (ms: number) => sc.time.delayedCall(ms, () => {
      s.sprite.stop();
      s.sprite.setFrame(24).setFlipX(false).setY(s.y).setAngle(0);
      s.busy = false;
    });
    switch (Math.floor(Math.random() * 6)) {
      case 0: // cheer
        s.sprite.setY(s.y - 6);
        s.sprite.play(`${s.key}-cheer`);
        done(1600);
        break;
      case 1: { // doze off
        const z = sc.add.image(s.x + 8, s.y - 64, 'cls-zzz').setScale(S).setDepth(D + (3000));
        sc.tweens.add({ targets: z, y: z.y - 26, x: z.x + 10, alpha: 0, duration: 1800, onComplete: () => z.destroy() });
        sc.tweens.add({ targets: s.sprite, angle: 6, yoyo: true, duration: 900 });
        done(1900);
        break;
      }
      case 2: // turn to chat
        s.sprite.setFlipX(true);
        done(2000);
        break;
      case 3: { // paper plane to a random classmate
        const t = this.seats[Math.floor(Math.random() * this.seats.length)];
        const pl = sc.add.image(s.x, s.y - 40, 'cls-plane').setScale(S).setDepth(D + (3000));
        pl.setFlipX(t.x < s.x);
        sc.tweens.add({ targets: pl, x: t.x, duration: 1400, ease: 'Sine.easeInOut' });
        sc.tweens.add({ targets: pl, y: { from: s.y - 40, to: t.y - 90 }, yoyo: true, duration: 700, ease: 'Sine.easeOut', onComplete: () => { burst(sc, pl.x, pl.y, { tex: 'dot2', count: 5, tint: 0xffffff, life: 300 }); pl.destroy(); } });
        s.sprite.setFrame(29);
        done(700);
        break;
      }
      case 4: // hop
        sc.tweens.add({ targets: s.sprite, y: s.y - 10, yoyo: true, duration: 180, repeat: 1, ease: 'Quad.easeOut' });
        done(800);
        break;
      default: // stretch
        s.sprite.setFrame(16);
        done(900);
    }
  }
}

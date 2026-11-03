import Phaser from 'phaser';
import { PALETTE, PLAYER_COLORS, toCss } from '../core/palette';
import { PLAYER_INDICES, type PlayerIndex } from '../core/types';
import { Audio } from '../systems/audio/AudioManager';
import { MultiTouchManager, type SwipeInfo, type TrackedTouch } from '../systems/input/MultiTouchManager';
import { UI_FONT } from './BootScene';

const PITCH = [523, 659, 784, 988];

/**
 * Dev tool for real-iPad testing: 4 zones, every finger drawn in its owner's
 * colour, tap/swipe/cancel counters per player. Not final art.
 */
export class TouchTestScene extends Phaser.Scene {
  private touch!: MultiTouchManager;
  private gfx!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private header!: Phaser.GameObjects.Text;
  private stats = PLAYER_INDICES.map(() => ({ taps: 0, swipes: 0, cancels: 0, lastSwipe: '' }));
  private maxSimultaneous = 0;

  constructor() {
    super('TouchTest');
  }

  create(): void {
    this.stats = PLAYER_INDICES.map(() => ({ taps: 0, swipes: 0, cancels: 0, lastSwipe: '' }));
    this.maxSimultaneous = 0;
    this.gfx = this.add.graphics();
    this.touch = new MultiTouchManager(this, 'quadrants');

    this.labels = PLAYER_INDICES.map((p) =>
      this.add.text(0, 0, '', {
        fontFamily: UI_FONT,
        fontSize: '14px',
        color: toCss(PLAYER_COLORS[p].light),
        lineSpacing: 2,
      }),
    );
    this.header = this.add
      .text(0, 0, '', { fontFamily: UI_FONT, fontSize: '13px', color: toCss(PALETTE.cream), align: 'center' })
      .setOrigin(0.5)
      .setBackgroundColor(toCss(PALETTE.deepNavy))
      .setPadding(8, 4, 8, 4)
      .setDepth(10);

    this.touch.on('down', (t: TrackedTouch) => {
      this.maxSimultaneous = Math.max(this.maxSimultaneous, this.touch.activeCount);
      this.burst(t.x, t.y, t.player, 6, 22);
    });
    this.touch.on('tap', (t: TrackedTouch) => {
      this.stats[t.player].taps++;
      Audio.blip(PITCH[t.player], 0.07);
    });
    this.touch.on('swipe', (t: TrackedTouch, s: SwipeInfo) => {
      const st = this.stats[t.player];
      st.swipes++;
      st.lastSwipe = Math.abs(s.dx) > Math.abs(s.dy) ? (s.dx > 0 ? '→' : '←') : s.dy > 0 ? '↓' : '↑';
      this.burst(t.x, t.y, t.player, 4, 36);
      Audio.blip(PITCH[t.player], 0.12, 'triangle', PITCH[t.player] * 1.5);
    });
    this.touch.on('cancel', (t: TrackedTouch) => {
      this.stats[t.player].cancels++;
    });
  }

  private burst(x: number, y: number, player: PlayerIndex, from: number, to: number): void {
    const ring = this.add.circle(x, y, from).setStrokeStyle(2, PLAYER_COLORS[player].light).setDepth(5);
    this.tweens.add({
      targets: ring,
      radius: to,
      alpha: 0,
      duration: 320,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  update(): void {
    const g = this.gfx;
    const { width, height } = this.scale.gameSize;
    g.clear();

    for (const zone of this.touch.getZones()) {
      const r = this.touch.zoneRect(zone);
      const c = PLAYER_COLORS[zone.player];
      const held = this.touch.isHeld(zone.player);
      g.fillStyle(c.main, held ? 0.28 : 0.12).fillRect(r.x, r.y, r.width, r.height);
      g.lineStyle(2, c.dark, 1).strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2);

      const s = this.stats[zone.player];
      const fingers = this.touch.touchesFor(zone.player).length;
      const label = this.labels[zone.player];
      label.setText([
        `P${zone.player + 1}  ${c.name}`,
        `fingers ${fingers}   taps ${s.taps}`,
        `swipes ${s.swipes} ${s.lastSwipe}   cancel ${s.cancels}`,
      ]);
      const top = r.y < 1;
      label.setPosition(r.x + 12, top ? r.y + 12 : r.bottom - label.height - 12);
    }

    // Every finger: line from where it started (drag) + a dot in its owner's colour.
    for (const p of PLAYER_INDICES) {
      const c = PLAYER_COLORS[p];
      for (const t of this.touch.touchesFor(p)) {
        g.lineStyle(3, c.light, 0.7).lineBetween(t.startX, t.startY, t.x, t.y);
        g.fillStyle(c.dark, 1).fillCircle(t.x, t.y, 15);
        g.fillStyle(c.main, 1).fillCircle(t.x, t.y, 12);
        g.fillStyle(0xffffff, 0.8).fillCircle(t.x - 4, t.y - 4, 3);
      }
    }

    this.header.setPosition(width / 2, height / 2);
    this.header.setText(
      `MULTI-TOUCH TEST   fingers ${this.touch.activeCount}   max ${this.maxSimultaneous}   ${Math.round(this.game.loop.actualFps)} fps`,
    );
  }
}

import Phaser from 'phaser';
import { PALETTE, PLAYER_COLORS, mix, toCss } from '../core/palette';
import { PLAYER_INDICES, type PlayerIndex } from '../core/types';
import { Audio } from '../systems/audio/AudioManager';
import { MultiTouchManager, type SwipeInfo, type TouchZone, type TrackedTouch } from '../systems/input/MultiTouchManager';
import { UI_FONT } from './BootScene';

const PITCH = [523, 659, 784, 988];
const ARROWS = ['→', '↓', '←', '↑'];

/**
 * Dev tool for real-iPad testing with players sitting around the table:
 * each zone's text faces its owner, every finger is drawn in its owner's colour.
 * Not final art.
 */
export class TouchTestScene extends Phaser.Scene {
  private touch!: MultiTouchManager;
  private gfx!: Phaser.GameObjects.Graphics;
  private panels: { box: Phaser.GameObjects.Container; text: Phaser.GameObjects.Text }[] = [];
  private headers: Phaser.GameObjects.Text[] = [];
  private stats = PLAYER_INDICES.map(() => ({ taps: 0, swipes: 0, cancels: 0, lastSwipe: '' }));
  private maxSimultaneous = 0;

  constructor() {
    super('TouchTest');
  }

  create(): void {
    this.cameras.main.setBackgroundColor(PALETTE.table);
    this.stats = PLAYER_INDICES.map(() => ({ taps: 0, swipes: 0, cancels: 0, lastSwipe: '' }));
    this.maxSimultaneous = 0;
    this.gfx = this.add.graphics();
    this.touch = new MultiTouchManager(this, 'quadrants');

    this.panels = PLAYER_INDICES.map((p) => {
      const text = this.add
        .text(0, 0, '', { fontFamily: UI_FONT, fontSize: '14px', color: toCss(PLAYER_COLORS[p].light), lineSpacing: 2 })
        .setOrigin(0, 1);
      return { box: this.add.container(0, 0, [text]), text };
    });

    // One status line for each side of the table.
    const style = { fontFamily: UI_FONT, fontSize: '13px', color: toCss(PALETTE.cream), align: 'center' };
    this.headers = [0, 180].map((deg) =>
      this.add
        .text(0, 0, '', style)
        .setOrigin(0.5)
        .setBackgroundColor(toCss(PALETTE.table))
        .setPadding(8, 3, 8, 3)
        .setAngle(deg)
        .setDepth(10),
    );

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
      // Direction as the player sees it from their seat.
      const quarter = Math.round(s.angle / (Math.PI / 2));
      st.lastSwipe = ARROWS[((quarter % 4) + 4) % 4];
      this.burst(t.x, t.y, t.player, 4, 36);
      Audio.blip(PITCH[t.player], 0.12, 'triangle', PITCH[t.player] * 1.5);
    });
    this.touch.on('cancel', (t: TrackedTouch) => {
      this.stats[t.player].cancels++;
    });
  }

  private burst(x: number, y: number, player: PlayerIndex, from: number, to: number): void {
    const ring = this.add.circle(x, y, from).setStrokeStyle(2, PLAYER_COLORS[player].light).setDepth(5);
    this.tweens.add({ targets: ring, radius: to, alpha: 0, duration: 320, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
  }

  /** Put a player's panel in the corner nearest them, rotated to face their seat. */
  private placePanel(zone: TouchZone, r: Phaser.Geom.Rectangle): void {
    const { box } = this.panels[zone.player];
    const sideways = zone.facing === 90 || zone.facing === 270;
    const w = sideways ? r.height : r.width;
    const h = sideways ? r.width : r.height;
    box.setPosition(r.centerX, r.centerY).setAngle(zone.facing);
    this.panels[zone.player].text.setPosition(-w / 2 + 12, h / 2 - 12);
  }

  update(): void {
    const g = this.gfx;
    const { width, height } = this.scale.gameSize;
    g.clear();

    for (const zone of this.touch.getZones()) {
      const r = this.touch.zoneRect(zone);
      const c = PLAYER_COLORS[zone.player];
      const held = this.touch.isHeld(zone.player);
      // Solid blend over a neutral base keeps each hue true (no navy tint).
      g.fillStyle(mix(PALETTE.table, c.main, held ? 0.42 : 0.24), 1).fillRect(r.x, r.y, r.width, r.height);
      g.lineStyle(2, held ? c.light : c.main, 1).strokeRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2);

      const s = this.stats[zone.player];
      this.panels[zone.player].text.setText([
        `P${zone.player + 1}  ${c.name}`,
        `fingers ${this.touch.touchesFor(zone.player).length}   taps ${s.taps}`,
        `swipes ${s.swipes} ${s.lastSwipe}   cancel ${s.cancels}`,
      ]);
      this.placePanel(zone, r);
    }

    for (const p of PLAYER_INDICES) {
      const c = PLAYER_COLORS[p];
      for (const t of this.touch.touchesFor(p)) {
        g.lineStyle(3, c.light, 0.7).lineBetween(t.startX, t.startY, t.x, t.y);
        g.fillStyle(c.dark, 1).fillCircle(t.x, t.y, 15);
        g.fillStyle(c.main, 1).fillCircle(t.x, t.y, 12);
        g.fillStyle(0xffffff, 0.8).fillCircle(t.x - 4, t.y - 4, 3);
      }
    }

    const line = `MULTI-TOUCH TEST   fingers ${this.touch.activeCount}   max ${this.maxSimultaneous}   ${Math.round(this.game.loop.actualFps)} fps`;
    this.headers[0].setText(line).setPosition(width / 2, height / 2 + 13);
    this.headers[1].setText(line).setPosition(width / 2, height / 2 - 13);
  }
}

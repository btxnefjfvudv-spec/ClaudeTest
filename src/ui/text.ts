import Phaser from 'phaser';
import { View } from '../config';

export const UI_FONT = '"Sukhumvit Set", "Kanit", "Thonburi", "Noto Sans Thai", system-ui, -apple-system, sans-serif';

export interface TextOpts {
  size?: number;
  color?: string;
  bold?: boolean;
  stroke?: string;
  strokeWidth?: number;
  align?: 'left' | 'center' | 'right';
  origin?: [number, number];
  wrap?: number;
  shadow?: boolean;
}

/** Crisp game text: rendered at native resolution with a chunky outline. */
export function txt(scene: Phaser.Scene, x: number, y: number, str: string, o: TextOpts = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, str, {
    fontFamily: UI_FONT,
    fontSize: `${o.size ?? 16}px`,
    fontStyle: o.bold === false ? 'normal' : 'bold',
    color: o.color ?? '#fff8e7',
    stroke: o.stroke ?? '#1b1f3b',
    strokeThickness: o.strokeWidth ?? Math.max(2, Math.round((o.size ?? 16) / 5)),
    align: o.align ?? 'center',
    wordWrap: o.wrap ? { width: o.wrap, useAdvancedWrap: true } : undefined,
    padding: { x: 2, y: 4 },
  });
  t.setResolution(View.zoom);
  t.setOrigin(...(o.origin ?? [0.5, 0.5]));
  if (o.shadow !== false) t.setShadow(0, 2, '#14172e', 0, true, false);
  return t;
}

import { PLAYER_COLORS } from '../../core/palette';
import type { PlayerIndex } from '../../core/types';
import type { BaseMinigame } from '../BaseMinigame';

/**
 * Clear split-screen dividers: a dark cross between the four views plus a thin
 * frame in each player's colour, so everyone can see where their screen ends.
 * Used automatically by SplitKit and PanelKit.
 */
export function addScreenDividers(g: BaseMinigame, depth = 900): void {
  const W = g.vw, H = g.vh;
  const bar = 10;
  const dark = 0x14172e;
  // player-colour frames inside each quadrant
  for (const p of [0, 1, 2, 3] as PlayerIndex[]) {
    const r = g.touch.zoneRect(g.zoneOf(p));
    const c = PLAYER_COLORS[p];
    const f = g.add.rectangle(r.x + 3, r.y + 3, r.width - 6, r.height - 6).setOrigin(0).setStrokeStyle(3, c.main, g.players.includes(p) ? 0.95 : 0.35).setDepth(depth);
    f.isFilled = false;
  }
  // dark cross with a soft light core
  g.add.rectangle(W / 2, H / 2, bar, H, dark).setDepth(depth + 1);
  g.add.rectangle(W / 2, H / 2, W, bar, dark).setDepth(depth + 1);
  g.add.rectangle(W / 2, H / 2, 2, H, 0x3b4380).setDepth(depth + 2);
  g.add.rectangle(W / 2, H / 2, W, 2, 0x3b4380).setDepth(depth + 2);
  // outer edge
  const edge = g.add.rectangle(0, 0, W, H).setOrigin(0).setStrokeStyle(4, dark, 1).setDepth(depth + 1);
  edge.isFilled = false;
}

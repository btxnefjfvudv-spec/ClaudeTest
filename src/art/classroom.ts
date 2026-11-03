import Phaser from 'phaser';
import { ramp, shift } from './color';
import { makeSheet, makeTexture, rng, type Painter } from './Painter';

/**
 * Placeholder 5/8 classroom (until the real photos arrive): side-on view,
 * board on the right, windows on the back wall, rows of desks facing the board.
 * Painted at art resolution (world / 2).
 */

const WALL = 0xf3e9cf;
const WAINSCOT = 0x5fa89a;
const FLOOR_A = 0xe9d7b4;
const FLOOR_B = 0xdcc49b;
const WOOD = 0xc0834a;
const BOARD = 0x2f6b4f;

export const CLASS_H = 240;
export const WALL_BOTTOM = 132;

export interface ClassroomLayout {
  w: number;
  windows: { x: number; y: number; w: number; h: number }[];
  board: { x: number; y: number; w: number; h: number };
}

export function classroomLayout(w: number): ClassroomLayout {
  const bw = Math.round(w * 0.27);
  const board = { x: w - bw - 14, y: 34, w: bw, h: 62 };
  const windows = [] as ClassroomLayout['windows'];
  const avail = board.x - 30;
  const n = avail > 260 ? 3 : 2;
  const ww = 58;
  const gap = (avail - n * ww) / (n + 1);
  for (let i = 0; i < n; i++) windows.push({ x: Math.round(14 + gap + i * (ww + gap)), y: 30, w: ww, h: 66 });
  return { w, windows, board };
}

/** Outside view seen through the windows (sky, far school building, trees). */
export function paintOutside(scene: Phaser.Scene, w: number): string {
  return makeTexture(scene, `cls-outside-${w}`, w, WALL_BOTTOM, (p) => {
    p.gradient(0, 0, w, 110, [0x7fc8ff, 0xa8dcff, 0xd9f1ff]);
    // far school building
    const r = rng(7);
    for (let x = 0; x < w; x += 90) {
      p.box(x + 10, 60, 70, 50, 0xf0c9a0);
      p.rect(x + 10, 56, 70, 5, 0xc55a4a);
      for (let wx = 0; wx < 4; wx++) for (let wy = 0; wy < 2; wy++) p.rect(x + 16 + wx * 16, 68 + wy * 18, 9, 10, 0x6fa7c8);
    }
    // ground + hedge
    p.rect(0, 100, w, 32, 0x7cc46a);
    for (let x = 0; x < w; x++) p.px(x, 100 + Math.round(r()), 0x5aa858);
    return;
  });
}

/** Tree canopy blob that sways in front of the outside view. */
export function paintTree(scene: Phaser.Scene): string {
  return makeTexture(scene, 'cls-tree', 64, 60, (p) => {
    p.rect(29, 34, 6, 26, 0x7a4a2c);
    p.vline(29, 34, 26, 0x5a3420);
    const r = rng(3);
    for (let i = 0; i < 14; i++) p.ball(12 + r() * 40, 10 + r() * 28, 9 + r() * 4, 8 + r() * 3, 0x58b05a, false);
    for (let i = 0; i < 6; i++) p.ball(16 + r() * 32, 6 + r() * 14, 6, 5, 0x7ccf66, false);
    p.outline(-0.6);
  });
}

export function paintWall(scene: Phaser.Scene, w: number, L: ClassroomLayout): string {
  return makeTexture(scene, `cls-wall-${w}`, w, WALL_BOTTOM, (p) => {
    // wall with soft vertical lighting
    p.gradient(0, 0, w, WALL_BOTTOM - 22, [0xfaf3df, WALL, shift(WALL, -0.12)]);
    // ceiling strip + lights
    p.rect(0, 0, w, 10, 0xe1d7bf);
    p.hline(0, 10, w, shift(WALL, -0.35));
    for (let x = 30; x < w; x += 110) {
      p.rect(x, 3, 40, 4, 0xffffff);
      p.hline(x, 7, 40, 0xc9c3b4);
    }
    // wainscot
    const wy = WALL_BOTTOM - 22;
    p.rect(0, wy, w, 22, WAINSCOT);
    p.hline(0, wy, w, shift(WAINSCOT, 0.4));
    p.hline(0, wy + 1, w, shift(WAINSCOT, 0.2));
    for (let x = 0; x < w; x += 24) p.vline(x, wy + 3, 18, shift(WAINSCOT, -0.25));
    p.rect(0, WALL_BOTTOM - 3, w, 3, shift(WAINSCOT, -0.55));

    // windows (panes transparent → outside layer shows through)
    for (const win of L.windows) {
      p.rect(win.x - 3, win.y - 3, win.w + 6, win.h + 8, shift(WALL, -0.25));
      p.box(win.x - 2, win.y - 2, win.w + 4, win.h + 4, 0xf7f7f7);
      for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) p.clear(win.x + x, win.y + y);
      // mullions
      p.rect(win.x + win.w / 2 - 1, win.y, 2, win.h, 0xeaeaea);
      p.rect(win.x, win.y + Math.round(win.h * 0.42), win.w, 2, 0xeaeaea);
      // sill
      p.box(win.x - 5, win.y + win.h + 2, win.w + 10, 4, 0xe6e0d0);
      // curtains
      for (const side of [0, 1]) {
        const cx = side ? win.x + win.w - 5 : win.x - 4;
        for (let y = 0; y < win.h + 6; y++) {
          const wob = Math.round(Math.sin(y / 4) * 1);
          p.rect(cx + wob, win.y - 4 + y, 9, 1, y % 6 < 3 ? 0x8fc6e8 : 0x7ab4dc);
        }
      }
      p.rect(win.x - 8, win.y - 6, win.w + 16, 3, 0x9a7a5a);
    }

    // notice board between windows
    const nb = { x: L.windows[0].x + L.windows[0].w + 14, y: 44, w: 40, h: 34 };
    if (L.windows.length > 1 && L.windows[1].x - nb.x > nb.w + 8) {
      p.box(nb.x, nb.y, nb.w, nb.h, 0xc89a63, 2);
      p.rect(nb.x + 3, nb.y + 3, nb.w - 6, nb.h - 6, 0xd9b07a);
      const papers = [0xffffff, 0xffe066, 0xff9aa8, 0x9fe0ff, 0xb8f0b0];
      const r = rng(11);
      for (let i = 0; i < 6; i++) {
        const px = nb.x + 5 + Math.floor(r() * (nb.w - 16)), py = nb.y + 5 + Math.floor(r() * (nb.h - 16));
        p.rect(px, py, 10, 10, papers[i % papers.length]);
        p.hline(px + 2, py + 3, 6, 0x9a9aa8);
        p.hline(px + 2, py + 5, 5, 0x9a9aa8);
        p.px(px + 4, py, 0xff4d4d);
      }
    }

    // chalkboard
    const b = L.board;
    p.rect(b.x - 5, b.y - 5, b.w + 10, b.h + 10, shift(WOOD, -0.5));
    p.box(b.x - 4, b.y - 4, b.w + 8, b.h + 8, WOOD, 2);
    const br = ramp(BOARD);
    p.rect(b.x, b.y, b.w, b.h, BOARD);
    const r = rng(5);
    for (let i = 0; i < b.w * b.h * 0.05; i++) p.px(b.x + Math.floor(r() * b.w), b.y + Math.floor(r() * b.h), r() > 0.5 ? br[1] : br[3]);
    // eraser smudges
    p.dither(b.x + 6, b.y + 30, 30, 8, BOARD, br[3], 0.25);
    // chalk "5/8"
    const chalk = 0xf4f4ea;
    const big: Record<string, string[]> = {
      '5': ['aaaaa', 'a....', 'aaaa.', '....a', '....a', 'a...a', '.aaa.'],
      '/': ['....a', '...a.', '...a.', '..a..', '.a...', '.a...', 'a....'],
      '8': ['.aaa.', 'a...a', 'a...a', '.aaa.', 'a...a', 'a...a', '.aaa.'],
    };
    let cx = b.x + 10;
    for (const ch of '5/8') {
      for (const [j, row] of big[ch].entries()) for (let i = 0; i < row.length; i++) if (row[i] === 'a') p.rect(cx + i * 2, b.y + 8 + j * 2, 2, 2, chalk);
      cx += 14;
    }
    // doodles: star + smiley + underline
    p.hline(b.x + 10, b.y + 25, 38, chalk);
    p.ring(b.x + b.w - 18, b.y + 16, 7, chalk);
    p.px(b.x + b.w - 21, b.y + 14, chalk); p.px(b.x + b.w - 15, b.y + 14, chalk);
    p.hline(b.x + b.w - 21, b.y + 19, 7, chalk);
    for (let i = 0; i < 4; i++) p.hline(b.x + 10, b.y + 36 + i * 6, 20 + Math.floor(r() * 30), 0xcfe7d8);
    p.px(b.x + b.w - 30, b.y + 44, 0xffe066); p.px(b.x + b.w - 29, b.y + 44, 0xffe066);
    // chalk tray
    p.box(b.x - 2, b.y + b.h + 1, b.w + 4, 3, shift(WOOD, 0.1));
    p.rect(b.x + 10, b.y + b.h, 5, 1, 0xffffff);
    p.rect(b.x + 20, b.y + b.h, 4, 1, 0xff9aa8);

    // clock above the board
    const ck = { x: b.x + b.w / 2, y: 20 };
    p.circle(ck.x, ck.y, 8, 0x2b3263);
    p.circle(ck.x, ck.y, 7, 0xffffff);
    p.vline(ck.x, ck.y - 5, 5, 0x2b3263);
    p.hline(ck.x, ck.y, 4, 0xff5a6e);
    // class sign
    p.box(b.x - 40, 18, 28, 12, 0x3d6fd6);
    for (const [j, row] of ['aaa.a.aaa', 'a..a..a.a', 'aaa.a.aaa', '..a.a.a.a', 'aaa.a.aaa'].entries())
      for (let i = 0; i < row.length; i++) if (row[i] === 'a') p.px(b.x - 36 + i * 2, 21 + j, 0xffffff), p.px(b.x - 35 + i * 2, 21 + j, 0xffffff);
  });
}

export function paintFloor(scene: Phaser.Scene, w: number): string {
  const h = CLASS_H - WALL_BOTTOM;
  return makeTexture(scene, `cls-floor-${w}`, w, h, (p) => {
    // perspective tiles: rows get taller toward the viewer
    let y = 0, row = 0;
    while (y < h) {
      const th = 6 + row * 2;
      const shiftX = (row % 2) * 10;
      for (let x = -20; x < w + 20; x += 20) {
        const c = ((x + shiftX) / 20 + row) % 2 === 0 ? FLOOR_A : FLOOR_B;
        p.rect(x + shiftX, y, 20, th, c);
        p.vline(x + shiftX, y, th, shift(FLOOR_B, -0.15));
      }
      p.hline(0, y, w, shift(FLOOR_B, -0.2));
      y += th;
      row++;
    }
    // soft shadow along the wall
    p.dither(0, 0, w, 3, shift(FLOOR_B, -0.3), FLOOR_A, 0.3);
  });
}

/** Window light shafts falling on the floor (drawn additive). */
export function paintLightShaft(scene: Phaser.Scene): string {
  return makeTexture(scene, 'cls-shaft', 60, 110, (p) => {
    for (let y = 0; y < 110; y++) {
      const x0 = Math.round(y * 0.45), wdt = 40 + Math.round(y * 0.1);
      const a = Math.round(60 * (1 - y / 110));
      p.hline(x0, y, wdt, 0xfff3c4, a);
    }
  });
}

export function paintDesk(scene: Phaser.Scene): void {
  // student desk (front view-ish, facing right)
  makeTexture(scene, 'cls-desk', 30, 22, (p) => {
    p.box(0, 0, 30, 5, WOOD, 1);
    p.hline(0, 5, 30, shift(WOOD, -0.5));
    p.rect(2, 6, 3, 16, 0x8a8f9c);
    p.rect(25, 6, 3, 16, 0x8a8f9c);
    p.vline(2, 6, 16, 0xb0b5c0);
    p.rect(3, 6, 24, 7, shift(WOOD, -0.25));
    p.rect(5, 8, 8, 3, 0xffffff);
    p.rect(14, 8, 6, 3, 0x6ec6ff);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-chair', 16, 26, (p) => {
    p.box(0, 0, 4, 16, WOOD);
    p.box(0, 13, 14, 4, WOOD);
    p.rect(1, 17, 2, 9, 0x8a8f9c);
    p.rect(11, 17, 2, 9, 0x8a8f9c);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-teacher-desk', 52, 30, (p) => {
    p.box(0, 0, 52, 6, shift(WOOD, -0.1), 1);
    p.box(2, 6, 48, 24, shift(WOOD, -0.25), 1);
    p.rect(6, 10, 18, 8, shift(WOOD, -0.4));
    p.rect(13, 13, 4, 2, 0xd9c27a);
    // books + globe
    p.rect(30, -0 + 0, 0, 0, 0);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-books', 22, 14, (p) => {
    p.box(0, 8, 18, 6, 0xff7a85);
    p.box(2, 3, 16, 5, 0x6ec6ff);
    p.box(1, 0, 14, 3, 0xffe066);
    p.ball(19, 9, 3, 3, 0x7ee8b0);
    p.outline(-0.6);
  });
  // Ceiling fan (4 frames)
  makeSheet(scene, 'cls-fan', 44, 18, 4, (p, i) => {
    p.rect(21, 0, 2, 8, 0x8a8f9c);
    p.ball(22, 10, 4, 3, 0xd8dbe4, false);
    const blades = [[-20, 0], [-14, 1], [-6, 2], [0, 1]];
    const [l, dy] = blades[i];
    p.rect(22 + l, 10 + dy, 20 - Math.abs(l) / 2, 2, 0xb8bccb);
    p.rect(24, 10 - dy, 20 - Math.abs(l) / 2, 2, 0xa0a4b4);
    p.outline(-0.6);
  });
  if (!scene.anims.exists('cls-fan-spin')) scene.anims.create({ key: 'cls-fan-spin', frames: scene.anims.generateFrameNumbers('cls-fan', {}), frameRate: 14, repeat: -1 });
  makeTexture(scene, 'cls-door', 30, 70, (p) => {
    p.box(0, 0, 30, 70, 0x9a6a3e, 2);
    p.rect(5, 6, 20, 24, 0xb98552);
    p.rect(8, 9, 14, 18, 0xa9e0ff);
    p.rect(5, 36, 20, 28, 0xb98552);
    p.ball(24, 40, 2, 2, 0xffd34d);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-bin', 12, 14, (p) => {
    p.box(0, 0, 12, 3, 0x3fa0d6);
    p.box(1, 3, 10, 11, 0x2f86c0);
    p.vline(4, 4, 9, 0x5ab8ee);
    p.vline(8, 4, 9, 0x5ab8ee);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-cabinet', 34, 46, (p) => {
    p.box(0, 0, 34, 46, 0x8f98a8, 2);
    p.vline(17, 2, 42, 0x6a7282);
    p.rect(13, 20, 2, 6, 0xd8dbe4);
    p.rect(19, 20, 2, 6, 0xd8dbe4);
    p.box(3, -6, 12, 6, 0xffe066);
    p.box(18, -5, 10, 5, 0xff7a85);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-plant', 16, 24, (p) => {
    p.box(3, 15, 10, 9, 0xd9734e);
    const r = rng(9);
    for (let i = 0; i < 7; i++) p.ball(8 + (r() - 0.5) * 10, 6 + r() * 9, 4, 3, 0x58b05a, false);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-zzz', 9, 9, (p) => p.stamp(0, 0, ['aaaa.....', '..a......', '.a.......', 'aaaa.aaa.', '......a..', '.....aaa.', '.........', '.........', '.........'], { a: 0xffffff }));
  makeTexture(scene, 'cls-plane', 12, 6, (p) => {
    p.tri(0, 0, 12, 3, 0, 6, 0xffffff);
    p.hline(0, 3, 11, 0xc9d4e6);
    p.outline(-0.5);
  });
}

export function paintCloud(scene: Phaser.Scene): string {
  return makeTexture(scene, 'cloud', 40, 16, (p) => {
    p.ball(12, 10, 10, 6, 0xffffff, false);
    p.ball(24, 8, 11, 8, 0xffffff, false);
    p.ball(32, 11, 8, 5, 0xffffff, false);
    p.hline(4, 15, 34, 0xdbe9f7);
  });
}

export type { Painter };

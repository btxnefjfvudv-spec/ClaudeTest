import Phaser from 'phaser';
import { ramp, shift } from './color';
import { makeSheet, makeTexture, rng, type Painter } from './Painter';

/**
 * Classroom 5/8, painted from the class photos: sky-blue walls with a
 * periwinkle lower band, white grid ceiling with fluorescent tubes and
 * oscillating ceiling fans, two big dark-framed windows onto green trees and
 * the next school building (AC units above), a cream whiteboard with a wood
 * rail, round wall clock, posters, maroon-top desks on black metal frames,
 * white floor tiles. Side-on view: the board is on the right.
 */

const WALL = 0x8fd8ec;
const WALL_LOW = 0x86a2e6;
const CEIL = 0xe9edf0;
const FLOOR_A = 0xf1f4f7;
const FLOOR_B = 0xe2e8ed;
const WOOD = 0x8a5a36;
const BOARD = 0xf3eedc;
const FRAME = 0x3e2c22;
const DESK_TOP = 0x6e2c24;
const METAL = 0x1f1f26;

export const CLASS_H = 240;
export const WALL_BOTTOM = 132;
const CEIL_H = 20;

export interface ClassroomLayout {
  w: number;
  windows: { x: number; y: number; w: number; h: number }[];
  board: { x: number; y: number; w: number; h: number };
}

export function classroomLayout(w: number): ClassroomLayout {
  const bw = Math.round(w * 0.3);
  const board = { x: w - bw - 10, y: 44, w: bw, h: 50 };
  const windows = [] as ClassroomLayout['windows'];
  const avail = board.x - 40;
  const n = 2;
  const gap = 10;
  const ww = Math.floor((avail - gap * (n + 1)) / n);
  for (let i = 0; i < n; i++) windows.push({ x: 26 + gap + i * (ww + gap), y: 48, w: ww, h: 60 });
  return { w, windows, board };
}

/** Outside: lush trees in front of the cream next school building. */
export function paintOutside(scene: Phaser.Scene, w: number): string {
  return makeTexture(scene, `cls-outside-${w}`, w, WALL_BOTTOM, (p) => {
    p.gradient(0, 0, w, 60, [0xbfe6f5, 0xe6f6fb]);
    // next building: cream with dark window strips + AC compressors
    p.rect(0, 30, w, 80, 0xe9dcae);
    for (let y = 38; y < 110; y += 22) {
      p.rect(0, y, w, 9, 0x5b6470);
      for (let x = 4; x < w; x += 16) p.vline(x, y, 9, 0x3a4048);
      p.hline(0, y + 9, w, 0xd5c896);
    }
    for (let x = 30; x < w; x += 70) { p.box(x, 74, 12, 10, 0xe8eaee); p.ring(x + 6, 79, 3.5, 0x8a8f9c); }
    // trees (big leaves)
    const r = rng(17);
    for (let i = 0; i < w / 5; i++) {
      const x = r() * w, y = 50 + r() * 70;
      p.ball(x, y, 5 + r() * 6, 4 + r() * 4, r() > 0.5 ? 0x4f9e48 : 0x6ab85a, false);
      if (r() > 0.7) p.ball(x + 2, y - 2, 3, 2, 0x9fd66e, false);
    }
    for (let x = 10; x < w; x += 55) p.rect(x, 60, 3, 72, 0x6a4a32);
  });
}

/** Foreground leaves swaying in front of the window glass. */
export function paintTree(scene: Phaser.Scene): string {
  return makeTexture(scene, 'cls-tree', 64, 40, (p) => {
    const r = rng(3);
    for (let i = 0; i < 12; i++) p.ball(8 + r() * 48, 8 + r() * 26, 7 + r() * 4, 5 + r() * 3, r() > 0.4 ? 0x5aae52 : 0x7cc760, false);
    for (let i = 0; i < 5; i++) p.ball(10 + r() * 44, 6 + r() * 12, 4, 3, 0xa8dc78, false);
  });
}

export function paintWall(scene: Phaser.Scene, w: number, L: ClassroomLayout): string {
  return makeTexture(scene, `cls-wall-${w}`, w, WALL_BOTTOM, (p) => {
    const r = rng(23);
    // wall: sky blue, slightly darker near the floor, periwinkle lower band
    p.gradient(0, CEIL_H, w, WALL_BOTTOM - CEIL_H - 26, [0x9adfef, WALL, shift(WALL, -0.08)]);
    const lowY = WALL_BOTTOM - 26;
    p.rect(0, lowY, w, 26, WALL_LOW);
    p.hline(0, lowY, w, shift(WALL_LOW, 0.3));
    p.hline(0, lowY + 1, w, shift(WALL_LOW, 0.12));
    p.rect(0, WALL_BOTTOM - 2, w, 2, shift(WALL_LOW, -0.45));
    // ceiling: white grid panels + conduit
    p.rect(0, 0, w, CEIL_H, CEIL);
    for (let x = 0; x < w; x += 30) p.vline(x, 0, CEIL_H, 0xc9cfd6);
    p.hline(0, 9, w, 0xc9cfd6);
    p.hline(0, CEIL_H - 1, w, 0xb9c0c8);
    p.hline(0, CEIL_H, w, shift(WALL, -0.4));
    p.hline(0, 4, w, 0xffffff);
    // fluorescent tubes
    for (let x = 14; x < w - 30; x += 64) {
      p.rect(x, 12, 34, 3, 0xd8dde3);
      p.hline(x + 1, 12, 32, 0xffffff);
      p.hline(x + 2, 15, 30, 0xeef6ff);
    }
    // windows (panes transparent → outside layer shows through)
    for (const win of L.windows) {
      // AC unit above each window
      const ax = win.x + Math.round(win.w * 0.55), aw = Math.min(46, win.w * 0.55);
      p.box(ax, win.y - 16, aw, 10, 0xf4f6f8);
      p.hline(ax + 2, win.y - 9, aw - 4, 0xb8bec8);
      p.hline(ax + 2, win.y - 8, aw - 4, 0x9aa2ae);
      p.px(ax + aw - 4, win.y - 13, 0x3ed17a);
      // frame
      p.rect(win.x - 3, win.y - 3, win.w + 6, win.h + 6, FRAME);
      for (let y = 0; y < win.h; y++) for (let x = 0; x < win.w; x++) p.clear(win.x + x, win.y + y);
      // sliding panes: 3 mullions + transom bar
      for (let k = 1; k < 3; k++) p.rect(win.x + Math.round((win.w * k) / 3) - 1, win.y, 2, win.h, FRAME);
      p.rect(win.x, win.y + Math.round(win.h * 0.38), win.w, 2, 0xb8c2cc);
      p.hline(win.x, win.y + Math.round(win.h * 0.38) + 2, win.w, 0x8a96a2);
      // sill
      p.box(win.x - 4, win.y + win.h + 3, win.w + 8, 3, 0xdfe6ec);
    }
    // pillar between windows
    if (L.windows.length > 1) {
      const a = L.windows[0], b = L.windows[1];
      const px = a.x + a.w + 3;
      p.rect(px, CEIL_H + 1, b.x - 3 - px, WALL_BOTTOM - CEIL_H - 27, shift(WALL, 0.12));
      p.vline(px, CEIL_H + 1, WALL_BOTTOM - CEIL_H - 27, shift(WALL, -0.15));
    }
    // wall fan between the window and the back corner + light switch
    const fx = 12;
    p.rect(fx + 4, 56, 2, 8, 0xe8ecef);
    p.circle(fx + 5, 52, 7, 0xf4f6f8);
    p.ring(fx + 5, 52, 7, 0xb8bec8);
    p.circle(fx + 5, 52, 2, 0xb8bec8);
    p.box(fx + 2, 92, 6, 5, 0xf4f6f8);
    // whiteboard with wood frame + long wood rail along the front wall
    const bd = L.board;
    p.rect(bd.x - 3, bd.y - 3, bd.w + 6, bd.h + 6, shift(WOOD, -0.45));
    p.box(bd.x - 2, bd.y - 2, bd.w + 4, bd.h + 4, WOOD);
    p.rect(bd.x, bd.y, bd.w, bd.h, BOARD);
    p.dither(bd.x, bd.y + bd.h - 8, bd.w, 8, BOARD, 0xe6e0cc, 0.3);
    for (let i = 0; i < 16; i++) p.px(bd.x + Math.floor(r() * bd.w), bd.y + Math.floor(r() * bd.h), 0xdcd5c0);
    // marker writing: "5/8" + date line + smiley
    const ink = 0x2f4fd0;
    const big: Record<string, string[]> = {
      '5': ['aaaa', 'a...', 'aaa.', '...a', 'aaa.'],
      '/': ['...a', '..a.', '.a..', 'a...', 'a...'],
      '8': ['.aa.', 'a..a', '.aa.', 'a..a', '.aa.'],
    };
    let cx = bd.x + 6;
    for (const ch of '5/8') {
      for (const [j, row] of big[ch].entries()) for (let i = 0; i < row.length; i++) if (row[i] === 'a') p.rect(cx + i * 2, bd.y + 6 + j * 2, 2, 2, ink);
      cx += 11;
    }
    p.hline(bd.x + 6, bd.y + 20, 30, 0xd04040);
    for (let i = 0; i < 3; i++) p.hline(bd.x + 6, bd.y + 26 + i * 6, 14 + Math.floor(r() * 24), 0x6a78b8);
    p.ring(bd.x + bd.w - 14, bd.y + 14, 6, 0xd04040);
    p.px(bd.x + bd.w - 16, bd.y + 12, 0xd04040); p.px(bd.x + bd.w - 12, bd.y + 12, 0xd04040);
    p.hline(bd.x + bd.w - 16, bd.y + 16, 5, 0xd04040);
    p.box(bd.x + 4, bd.y + bd.h + 1, bd.w - 8, 2, shift(WOOD, 0.15));
    p.rect(bd.x + 12, bd.y + bd.h, 4, 1, 0x2f4fd0); p.rect(bd.x + 20, bd.y + bd.h, 4, 1, 0xd04040);
    p.rect(bd.x - 40, bd.y - 5, w - bd.x + 40, 2, WOOD);
    // round clock above the board
    const ck = { x: bd.x + 12, y: bd.y - 14 };
    p.circle(ck.x, ck.y, 7, 0x24242c);
    p.circle(ck.x, ck.y, 6, 0xffffff);
    p.vline(ck.x, ck.y - 4, 4, 0x24242c);
    p.hline(ck.x, ck.y, 3, 0x24242c);
    // school poster (blue/white) and rainbow poster
    const ps = { x: bd.x + bd.w - 34, y: bd.y - 24 + 0 };
    p.box(ps.x, ps.y - 2, 22, 18, 0xffffff);
    p.rect(ps.x + 2, ps.y, 18, 3, 0x2f4fa8);
    p.rect(ps.x + 4, ps.y + 5, 14, 2, 0x2f6fd0);
    p.rect(ps.x + 4, ps.y + 9, 14, 3, 0xff9f43);
    p.rect(ps.x + 4, ps.y + 13, 10, 1, 0x2f4fa8);
    const rb = { x: bd.x - 26, y: bd.y + 4 };
    p.rect(rb.x - 1, rb.y - 1, 18, 24, 0xd04040);
    const bands = [0xff5a5a, 0xff9f43, 0xffe066, 0x5ac85a, 0x3d9bff, 0x8455d6];
    bands.forEach((c, i) => p.rect(rb.x, rb.y + i * 4, 16, 4, c));
    p.rect(rb.x + 3, rb.y + 3, 10, 5, 0xffffff);
    p.hline(rb.x + 4, rb.y + 5, 8, 0x2f4fa8);
    // speaker box
    p.box(bd.x - 12, CEIL_H + 4, 7, 9, 0x2a2a32);
    p.circle(bd.x - 9, CEIL_H + 9, 1.5, 0x55555f);
  });
}

export function paintFloor(scene: Phaser.Scene, w: number): string {
  const h = CLASS_H - WALL_BOTTOM;
  return makeTexture(scene, `cls-floor-${w}`, w, h, (p) => {
    // white square tiles in light perspective
    let y = 0, row = 0;
    while (y < h) {
      const th = 7 + row * 2;
      for (let x = 0; x < w + 30; x += 22) {
        const c = (Math.floor(x / 22) + row) % 2 === 0 ? FLOOR_A : FLOOR_B;
        p.rect(x, y, 22, th, c);
        p.vline(x, y, th, 0xcdd5dc);
      }
      p.hline(0, y, w, 0xcdd5dc);
      y += th;
      row++;
    }
    p.dither(0, 0, w, 4, 0xc5ced6, FLOOR_A, 0.35);
    // fluorescent reflections
    for (let x = 30; x < w; x += 90) p.dither(x, 12, 30, 2, FLOOR_A, 0xffffff, 0.5);
  });
}

/** Soft daylight from the windows (drawn additive). */
export function paintLightShaft(scene: Phaser.Scene): string {
  return makeTexture(scene, 'cls-shaft', 70, 110, (p) => {
    for (let y = 0; y < 110; y++) {
      const x0 = Math.round(y * 0.35), wdt = 50 + Math.round(y * 0.1);
      p.hline(x0, y, wdt, 0xf4fbff, Math.round(34 * (1 - y / 110)));
    }
  });
}

export function paintDesk(scene: Phaser.Scene): void {
  // student desk: maroon wood top, drawer box, black metal frame, little sticker
  makeTexture(scene, 'cls-desk', 30, 24, (p) => {
    p.rect(2, 7, 2, 17, METAL); p.rect(26, 7, 2, 17, METAL);
    p.hline(2, 20, 26, METAL);
    p.box(0, 0, 30, 4, DESK_TOP, 1);
    p.hline(0, 4, 30, shift(DESK_TOP, -0.5));
    p.rect(3, 5, 24, 6, shift(DESK_TOP, -0.2));
    p.rect(5, 6, 6, 3, 0xf4f6f8); p.px(6, 7, 0x2f4fa8); p.px(9, 7, 0xffe066);
    p.outline(-0.6);
  });
  // chair: black metal frame, dark wood seat
  makeTexture(scene, 'cls-chair', 16, 26, (p) => {
    p.rect(0, 0, 2, 17, METAL);
    p.rect(0, 2, 4, 2, METAL); p.rect(0, 7, 4, 2, METAL);
    p.box(0, 13, 14, 3, shift(DESK_TOP, -0.15));
    p.rect(1, 16, 2, 10, METAL); p.rect(11, 16, 2, 10, METAL);
    p.hline(1, 22, 12, METAL);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-teacher-desk', 52, 30, (p) => {
    p.box(0, 0, 52, 5, shift(WOOD, 0.15), 1);
    p.box(2, 5, 48, 25, WOOD, 1);
    p.rect(6, 9, 18, 8, shift(WOOD, -0.25));
    p.rect(13, 12, 4, 2, 0xd9c27a);
    p.rect(28, 9, 18, 18, shift(WOOD, -0.15));
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-books', 22, 14, (p) => {
    p.box(0, 8, 18, 6, 0xff7a85);
    p.box(2, 3, 16, 5, 0x6ec6ff);
    p.box(1, 0, 14, 3, 0xffe066);
    p.outline(-0.6);
  });
  // blue plastic chair (teacher)
  makeTexture(scene, 'cls-bluechair', 16, 24, (p) => {
    p.box(10, 0, 5, 14, 0x3d6fd6);
    p.box(1, 11, 14, 4, 0x3d6fd6);
    p.rect(2, 15, 2, 9, 0x2f58b0); p.rect(12, 15, 2, 9, 0x2f58b0);
    p.outline(-0.6);
  });
  // Oscillating ceiling fan with wire cage (4 frames)
  makeSheet(scene, 'cls-fan', 30, 26, 4, (p, i) => {
    p.box(12, 0, 6, 5, 0xf4f6f8);
    p.rect(14, 5, 2, 4, 0xdfe3e8);
    const cx = 15, cy = 16, r = 9;
    p.circle(cx, cy, r, 0xdfe6ee, 120);
    for (let k = 0; k < 3; k++) {
      const a = (i * Math.PI) / 6 + (k * Math.PI * 2) / 3;
      p.stroke(cx, cy, cx + Math.cos(a) * 7, cy + Math.sin(a) * 3.5, 2, 0xc5ccd6);
    }
    p.ring(cx, cy, r, 0xffffff);
    p.ring(cx, cy, r - 3, 0xe8ecf0);
    p.circle(cx, cy, 2, 0xb8bec8);
    p.outline(-0.5);
  });
  if (!scene.anims.exists('cls-fan-spin')) scene.anims.create({ key: 'cls-fan-spin', frames: scene.anims.generateFrameNumbers('cls-fan', {}), frameRate: 16, repeat: -1 });
  // projector hanging from the ceiling
  makeTexture(scene, 'cls-projector', 20, 16, (p) => {
    p.rect(9, 0, 2, 7, 0xdfe3e8);
    p.box(2, 7, 16, 8, 0x2a2a32);
    p.circle(15, 11, 2, 0x5a6a8a);
    p.px(14, 10, 0xbfe9ff);
    p.outline(-0.5);
  });
  // aluminium door with dark glass
  makeTexture(scene, 'cls-door', 30, 70, (p) => {
    p.box(0, 0, 30, 70, 0xd8dde3, 2);
    p.rect(4, 4, 22, 40, 0x2e4a52);
    p.dither(4, 4, 22, 10, 0x2e4a52, 0x4f7480, 0.3);
    p.rect(4, 48, 22, 18, 0xc5ccd4);
    p.rect(22, 44, 4, 2, 0x8a8f9c);
    p.outline(-0.6);
  });
  // straw broom + purple dustpan (cleaning corner from the photos)
  makeTexture(scene, 'cls-broom', 20, 40, (p) => {
    p.stroke(10, 0, 10, 22, 1, 0xd9b06a);
    for (let i = 0; i < 9; i++) p.line(10, 20, 3 + i * 1.7, 38, i % 2 ? 0xc9963c : 0xe0b45a);
    p.hline(7, 21, 7, 0x8a6a3a);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-dustpan', 14, 12, (p) => {
    p.tri(1, 11, 13, 11, 9, 3, 0x9a5ad8);
    p.rect(9, 0, 2, 5, 0x7a3ab8);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-bin', 12, 14, (p) => {
    p.box(0, 0, 12, 3, 0x3fa0d6);
    p.box(1, 3, 10, 11, 0x2f86c0);
    p.vline(4, 4, 9, 0x5ab8ee);
    p.vline(8, 4, 9, 0x5ab8ee);
    p.outline(-0.6);
  });
  makeTexture(scene, 'cls-bag', 12, 12, (p) => {
    p.ball(6, 7, 5.5, 4.8, 0x24242c);
    p.rect(3, 1, 6, 3, 0x24242c);
    p.hline(3, 7, 6, 0xd9b04a);
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

export { ramp };
export type { Painter };

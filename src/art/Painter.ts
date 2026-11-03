import Phaser from 'phaser';
import { ramp, rgb, shift } from './color';

/**
 * Pixel-level drawing on an RGBA buffer. Every game asset is painted with this,
 * then uploaded as a Phaser texture. Coordinates are art pixels.
 * A Painter can be a clipped view (sub) into a larger sheet.
 */
export class Painter {
  readonly w: number;
  readonly h: number;
  private readonly buf: Uint8ClampedArray;
  private readonly stride: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(buf: Uint8ClampedArray, stride: number, ox: number, oy: number, w: number, h: number) {
    this.buf = buf;
    this.stride = stride;
    this.ox = ox;
    this.oy = oy;
    this.w = w;
    this.h = h;
  }

  sub(x: number, y: number, w: number, h: number): Painter {
    return new Painter(this.buf, this.stride, this.ox + x, this.oy + y, w, h);
  }

  px(x: number, y: number, c: number, a = 255): void {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = ((this.oy + y) * this.stride + this.ox + x) * 4;
    const [r, g, b] = rgb(c);
    if (a >= 255 || this.buf[i + 3] === 0) {
      this.buf[i] = r; this.buf[i + 1] = g; this.buf[i + 2] = b; this.buf[i + 3] = a;
    } else {
      const t = a / 255;
      this.buf[i] = this.buf[i] + (r - this.buf[i]) * t;
      this.buf[i + 1] = this.buf[i + 1] + (g - this.buf[i + 1]) * t;
      this.buf[i + 2] = this.buf[i + 2] + (b - this.buf[i + 2]) * t;
      this.buf[i + 3] = Math.max(this.buf[i + 3], a);
    }
  }

  /** Colour at a pixel, or -1 when transparent / outside. */
  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    const i = ((this.oy + y) * this.stride + this.ox + x) * 4;
    if (this.buf[i + 3] === 0) return -1;
    return (this.buf[i] << 16) | (this.buf[i + 1] << 8) | this.buf[i + 2];
  }

  clear(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = ((this.oy + y) * this.stride + this.ox + x) * 4;
    this.buf[i + 3] = 0;
  }

  rect(x: number, y: number, w: number, h: number, c: number, a = 255): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c, a);
  }

  hline(x: number, y: number, len: number, c: number, a = 255): void {
    for (let i = 0; i < len; i++) this.px(x + i, y, c, a);
  }

  vline(x: number, y: number, len: number, c: number, a = 255): void {
    for (let i = 0; i < len; i++) this.px(x, y + i, c, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number, a = 255): void {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x0, y0, c, a);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Thick line (square brush). */
  stroke(x0: number, y0: number, x1: number, y1: number, size: number, c: number): void {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    const o = Math.floor(size / 2);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(x0 + ((x1 - x0) * s) / steps);
      const y = Math.round(y0 + ((y1 - y0) * s) / steps);
      this.rect(x - o, y - o, size, size, c);
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number, a = 255): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.px(x, y, c, a);
      }
    }
  }

  circle(cx: number, cy: number, r: number, c: number, a = 255): void {
    this.ellipse(cx, cy, r, r, c, a);
  }

  ring(cx: number, cy: number, r: number, c: number, thickness = 1): void {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r && d > r - thickness) this.px(x, y, c);
      }
    }
  }

  /** Shaded sphere/blob lit from the top-left using a hue-shifted ramp. */
  ball(cx: number, cy: number, rx: number, ry: number, base: number, spec = true): void {
    const r = ramp(base);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        const d = nx * nx + ny * ny;
        if (d > 1) continue;
        const nz = Math.sqrt(1 - d);
        const light = -nx * 0.5 - ny * 0.6 + nz * 0.62;
        let c = r[2];
        if (light > 0.72) c = r[3];
        else if (light < 0.12) c = r[0];
        else if (light < 0.38) c = r[1];
        this.px(x, y, c);
      }
    }
    if (spec && rx >= 3) {
      this.px(Math.round(cx - rx * 0.45), Math.round(cy - ry * 0.5), r[4]);
      if (rx >= 6) this.px(Math.round(cx - rx * 0.45) + 1, Math.round(cy - ry * 0.5), r[4]);
    }
  }

  /** Rect with a light top/left edge and dark bottom/right edge. */
  box(x: number, y: number, w: number, h: number, base: number, bevel = 1): void {
    const r = ramp(base);
    this.rect(x, y, w, h, base);
    for (let b = 0; b < bevel; b++) {
      this.hline(x + b, y + b, w - b * 2, r[3]);
      this.vline(x + b, y + b, h - b * 2, r[3]);
      this.hline(x + b, y + h - 1 - b, w - b * 2, r[1]);
      this.vline(x + w - 1 - b, y + b, h - b * 2, r[1]);
    }
  }

  /** Ordered 2x2 dither between two colours: t = 0 → a, 1 → b. */
  dither(x: number, y: number, w: number, h: number, a: number, b: number, t: number): void {
    const m = [0, 2, 3, 1];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const th = (m[((y + j) & 1) * 2 + ((x + i) & 1)] + 0.5) / 4;
        this.px(x + i, y + j, t > th ? b : a);
      }
    }
  }

  /** Vertical gradient through colour stops with dithered transitions. */
  gradient(x: number, y: number, w: number, h: number, stops: number[]): void {
    const seg = (h - 1) / (stops.length - 1);
    for (let j = 0; j < h; j++) {
      const f = j / seg;
      const k = Math.min(stops.length - 2, Math.floor(f));
      const t = f - k;
      const band = Math.min(1, Math.max(0, (t - 0.35) / 0.3));
      this.dither(x, y + j, w, 1, stops[k], stops[k + 1], band);
    }
  }

  tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number): void {
    const minX = Math.floor(Math.min(x0, x1, x2)), maxX = Math.ceil(Math.max(x0, x1, x2));
    const minY = Math.floor(Math.min(y0, y1, y2)), maxY = Math.ceil(Math.max(y0, y1, y2));
    const e = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
      (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const a = e(x0, y0, x1, y1, px, py), b = e(x1, y1, x2, y2, px, py), d = e(x2, y2, x0, y0, px, py);
        if ((a >= 0 && b >= 0 && d >= 0) || (a <= 0 && b <= 0 && d <= 0)) this.px(x, y, c);
      }
    }
  }

  /**
   * Stamp a string-grid sprite. '.' or ' ' = transparent; other chars map to colours.
   */
  stamp(x: number, y: number, rows: string[], map: Record<string, number>, flip = false): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        const c = map[ch];
        if (c === undefined) continue;
        this.px(flip ? x + row.length - 1 - i : x + i, y + j, c);
      }
    });
  }

  /**
   * Selective outline: each empty pixel touching the sprite takes a deep,
   * hue-shifted shade of its neighbour, so outlines carry the object's colour.
   */
  outline(strength = -0.8, diagonal = false): void {
    const marks: [number, number, number][] = [];
    const dirs = diagonal
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== -1) continue;
        for (const [dx, dy] of dirs) {
          const n = this.get(x + dx, y + dy);
          if (n !== -1) {
            marks.push([x, y, shift(n, strength)]);
            break;
          }
        }
      }
    }
    for (const [x, y, c] of marks) this.px(x, y, c);
  }

  /** Mirror the painter's contents horizontally (for symmetric objects). */
  mirrorX(): void {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < Math.floor(this.w / 2); x++) {
        const c = this.get(x, y);
        if (c === -1) this.clear(this.w - 1 - x, y);
        else this.px(this.w - 1 - x, y, c);
      }
    }
  }
}

/** Seeded RNG so procedural art is identical every boot. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  return { canvas, ctx, img: ctx.createImageData(w, h) };
}

/** Paint a single texture. Skips work if the key already exists. */
export function makeTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (p: Painter) => void): string {
  if (scene.textures.exists(key)) return key;
  const { canvas, ctx, img } = newCanvas(w, h);
  draw(new Painter(img.data, w, 0, 0, w, h));
  ctx.putImageData(img, 0, 0);
  scene.textures.addCanvas(key, canvas);
  return key;
}

/** Paint a horizontal strip of frames; frames are named 0..n-1. */
export function makeSheet(
  scene: Phaser.Scene,
  key: string,
  fw: number,
  fh: number,
  count: number,
  draw: (p: Painter, i: number) => void,
): string {
  if (scene.textures.exists(key)) return key;
  const cols = Math.min(count, Math.max(1, Math.floor(2048 / fw)));
  const rows = Math.ceil(count / cols);
  const { canvas, ctx, img } = newCanvas(cols * fw, rows * fh);
  const root = new Painter(img.data, cols * fw, 0, 0, cols * fw, rows * fh);
  for (let i = 0; i < count; i++) draw(root.sub((i % cols) * fw, Math.floor(i / cols) * fh, fw, fh), i);
  ctx.putImageData(img, 0, 0);
  const tex = scene.textures.addCanvas(key, canvas)!;
  for (let i = 0; i < count; i++) tex.add(i, 0, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh);
  return key;
}

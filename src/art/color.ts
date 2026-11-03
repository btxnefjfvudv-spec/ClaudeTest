/** Colour utilities for pixel art: hue-shifted ramps, darken/lighten, css strings. */

export function rgb(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

export function fromRgb(r: number, g: number, b: number): number {
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (cl(r) << 16) | (cl(g) << 8) | cl(b);
}

export function css(c: number, a = 1): string {
  const [r, g, b] = rgb(c);
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

function toHsl(c: number): [number, number, number] {
  let [r, g, b] = rgb(c);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): number {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return fromRgb(f(0) * 255, f(8) * 255, f(4) * 255);
}

/**
 * Shift a colour darker/lighter like a pixel artist would: shadows drift toward
 * blue/purple, lights toward warm yellow. amount: -1 (dark) .. +1 (light).
 */
export function shift(c: number, amount: number): number {
  const [h, s, l] = toHsl(c);
  const target = amount < 0 ? 250 : 55;
  let dh = target - h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const hueMove = Math.abs(amount) * (s < 0.08 ? 0 : 18);
  const nh = h + Math.sign(dh) * Math.min(Math.abs(dh), hueMove);
  const nl = l + amount * (amount < 0 ? l * 0.55 : (1 - l) * 0.6);
  const ns = s * (amount < 0 ? 1 + Math.abs(amount) * 0.15 : 1 - amount * 0.25);
  return fromHsl(nh, ns, nl);
}

/** 5-step ramp: [deep shadow, shadow, base, light, highlight]. */
export function ramp(c: number): [number, number, number, number, number] {
  return [shift(c, -0.7), shift(c, -0.35), c, shift(c, 0.35), shift(c, 0.7)];
}

export function mixc(a: number, b: number, t: number): number {
  const A = rgb(a), B = rgb(b);
  return fromRgb(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

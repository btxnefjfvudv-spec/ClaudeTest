/** Master palette. All art must pull from here (see docs/ART_DIRECTION.md). */
export const PALETTE = {
  deepNavy: 0x1b1f3b,
  navy: 0x2b3263,
  cream: 0xfff8e7,
  skyBlue: 0x6ec6ff,
  cyan: 0x3fe0e0,
  mint: 0x7ee8b0,
  lemon: 0xffe066,
  coral: 0xff7a85,
  orange: 0xff9f43,
  lavender: 0xb8a6ff,
  purple: 0x8455d6,
  /** Neutral dark used under player colours so no hue gets shifted. */
  table: 0x1e1f26,
} as const;

/** Player colours: picked to stay distinct from each other and for colour-blind players. */
export const PLAYER_COLORS = [
  { main: 0xff5a6e, dark: 0xb3263a, light: 0xffb3bd, name: 'RED' },
  { main: 0x3d9bff, dark: 0x1d5bb3, light: 0xa8d3ff, name: 'BLUE' },
  { main: 0x3ed17a, dark: 0x1f8a4a, light: 0xa6f0c4, name: 'GREEN' },
  { main: 0xffc93d, dark: 0xb3861a, light: 0xffe9a8, name: 'YELLOW' },
] as const;

export const toCss = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Solid blend of two colours (t = 0 → a, 1 → b). Use instead of alpha over a tinted background. */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 0xff;
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s;
  return m(16) | m(8) | m(0);
}

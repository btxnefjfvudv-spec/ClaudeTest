/**
 * Pixel-art render resolution. The game renders at VIRTUAL_HEIGHT pixels tall;
 * width follows the device aspect ratio so every iPad fills the screen without
 * letterboxing. Final value is decided in the Visual Prototype (docs/ROADMAP.md).
 */
export const VIRTUAL_HEIGHT = 480;
export const MIN_ASPECT = 4 / 3; // iPad (10.2"), mini, Pro 12.9"
export const MAX_ASPECT = 1.6; // iPad Air / Pro 11" with browser chrome hidden

/** Fingers tracked at once: 4 players x 2 fingers + spare. */
export const MAX_POINTERS = 10;

export function virtualSize(viewW: number, viewH: number): { width: number; height: number } {
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, viewW / viewH));
  return { width: Math.round(VIRTUAL_HEIGHT * aspect), height: VIRTUAL_HEIGHT };
}

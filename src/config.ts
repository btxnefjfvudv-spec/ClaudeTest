/**
 * Render model
 * ------------
 * The world is always WORLD_H (480) units tall; its width follows the screen
 * aspect ratio (clamped). The canvas is sized to the real device pixels and
 * every camera is zoomed by View.zoom, so pixel art stays crisp-blocky and
 * text is rendered at native resolution (sharp Thai glyphs).
 */
export const WORLD_H = 480;
export const MIN_ASPECT = 4 / 3;
export const MAX_ASPECT = 1.6;
export const MAX_DPR = 2;

/** Fingers tracked at once: 4 players x 2 fingers + spare. */
export const MAX_POINTERS = 10;

export const View = {
  /** World units. */
  width: 640,
  height: WORLD_H,
  /** Canvas pixels per world unit. */
  zoom: 1,
  canvasW: 640,
  canvasH: WORLD_H,
};

export function computeView(cssW: number, cssH: number, dpr: number): void {
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, cssW / Math.max(1, cssH)));
  const boxH = Math.min(cssH, cssW / aspect);
  const d = Math.min(MAX_DPR, Math.max(1, dpr));
  View.canvasH = Math.max(WORLD_H, Math.round(boxH * d));
  View.canvasW = Math.round(View.canvasH * aspect);
  View.zoom = View.canvasH / WORLD_H;
  View.height = WORLD_H;
  View.width = Math.round(WORLD_H * aspect);
}

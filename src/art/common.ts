import Phaser from 'phaser';
import { ramp, shift } from './color';
import { makeSheet, makeTexture, type Painter } from './Painter';

/** All game art is displayed at this scale: 1 art pixel = 2 world units. */
export const S = 2;

/** Shared particle, UI and prop textures. Call once at boot. */
export function buildCommonTextures(scene: Phaser.Scene): void {
  makeTexture(scene, 'px', 1, 1, (p) => p.px(0, 0, 0xffffff));
  makeTexture(scene, 'dot2', 2, 2, (p) => p.rect(0, 0, 2, 2, 0xffffff));
  makeTexture(scene, 'dot3', 3, 3, (p) => { p.rect(0, 1, 3, 1, 0xffffff); p.rect(1, 0, 1, 3, 0xffffff); p.px(0, 0, 0xffffff, 0); });
  makeTexture(scene, 'spark', 5, 5, (p) => {
    p.vline(2, 0, 5, 0xffffff); p.hline(0, 2, 5, 0xffffff);
  });
  makeTexture(scene, 'star', 7, 7, (p) => {
    p.vline(3, 0, 7, 0xffffff); p.hline(0, 3, 7, 0xffffff);
    p.rect(2, 2, 3, 3, 0xffffff);
  });
  makeTexture(scene, 'confetti', 3, 2, (p) => p.rect(0, 0, 3, 2, 0xffffff));
  makeTexture(scene, 'dust', 6, 6, (p) => {
    p.circle(3, 3, 3, 0xffffff);
  });
  makeTexture(scene, 'puff', 10, 10, (p) => {
    p.circle(5, 5, 5, 0xe8e8f0);
    p.circle(4, 4, 3.5, 0xffffff);
  });
  makeTexture(scene, 'shadow', 18, 6, (p) => p.ellipse(9, 3, 9, 3, 0x000000));
  makeTexture(scene, 'ring', 24, 24, (p) => p.ring(12, 12, 11.5, 0xffffff, 2));
  makeTexture(scene, 'line', 16, 1, (p) => p.hline(0, 0, 16, 0xffffff));
  makeTexture(scene, 'heart', 7, 6, (p) =>
    p.stamp(0, 0, ['.aa.aa.', 'abbaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..', '...a...'], { a: 0xff4d6d, b: 0xffc2cc }),
  );

  // Coin spin (6 frames)
  makeSheet(scene, 'coin', 10, 10, 6, (p, i) => {
    const widths = [4, 3, 1.4, 0.6, 1.4, 3];
    const w = widths[i];
    if (w < 1) {
      p.rect(4, 1, 2, 8, 0xc98a1c);
    } else {
      p.ball(5, 5, w + 0.6, 4.4, 0xffc93d);
      if (w > 2) p.vline(5, 3, 4, 0xc98a1c);
    }
    p.outline(-0.7);
  });
  if (!scene.anims.exists('coin-spin')) {
    scene.anims.create({ key: 'coin-spin', frames: scene.anims.generateFrameNumbers('coin', {}), frameRate: 12, repeat: -1 });
  }

  buildUiTextures(scene);
}

/** 9-slice friendly panels/buttons (corner size 6). */
function buildUiTextures(scene: Phaser.Scene): void {
  const panel = (p: Painter, base: number, border: number, depth: number) => {
    const w = p.w, h = p.h - depth;
    const r = ramp(base);
    // drop / depth
    for (let y = depth; y < h + depth; y++) for (let x = 0; x < w; x++) if (inRound(x, y - depth, w, h)) p.px(x, y, shift(border, -0.5));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inRound(x, y, w, h)) p.px(x, y, border);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) if (inRound(x - 2, y - 2, w - 4, h - 4)) p.px(x, y, base);
    p.hline(4, 2, w - 8, r[3]);
    p.hline(3, 3, 2, r[3]);
    p.hline(w - 5, 3, 2, r[3]);
    p.hline(4, h - 3, w - 8, r[1]);
  };
  makeTexture(scene, 'ui-panel', 24, 26, (p) => panel(p, 0xfff8e7, 0x2b3263, 2));
  makeTexture(scene, 'ui-panel-dark', 24, 26, (p) => panel(p, 0x2b3263, 0x14172e, 2));
  const btn = (key: string, base: number) => {
    makeTexture(scene, key, 24, 28, (p) => panel(p, base, shift(base, -0.75), 4));
    makeTexture(scene, `${key}-down`, 24, 28, (p) => panel(p.sub(0, 2, 24, 26), shift(base, -0.12), shift(base, -0.75), 2));
  };
  btn('ui-btn', 0xffe066);
  btn('ui-btn-blue', 0x6ec6ff);
  btn('ui-btn-pink', 0xff7a85);
  btn('ui-btn-mint', 0x7ee8b0);
  btn('ui-btn-purple', 0xb8a6ff);
  btn('ui-btn-grey', 0xc7c9d6);
  btn('ui-btn-p0', 0xff5a6e);
  btn('ui-btn-p1', 0x3d9bff);
  btn('ui-btn-p2', 0x3ed17a);
  btn('ui-btn-p3', 0xffc93d);
}

function inRound(x: number, y: number, w: number, h: number): boolean {
  const r = 3;
  const cx = x < r ? r : x > w - 1 - r ? w - 1 - r : x;
  const cy = y < r ? r : y > h - 1 - r ? h - 1 - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r + 1;
}

/** Simple pixel icons used on touch buttons. 9x9, white so they can be tinted. */
export const ICONS: Record<string, string[]> = {
  jump: ['....a....', '...aaa...', '..aaaaa..', '.aaaaaaa.', '...aaa...', '...aaa...', '...aaa...', '...aaa...', '.........'],
  left: ['....a....', '...aa....', '..aaaaaaa', '.aaaaaaaa', '..aaaaaaa', '...aa....', '....a....', '.........', '.........'],
  right: ['....a....', '....aa...', 'aaaaaaa..', 'aaaaaaaa.', 'aaaaaaa..', '....aa...', '....a....', '.........', '.........'],
  punch: ['.aaaaa...', 'aaaaaaa..', 'aaaaaaaa.', 'aaaaaaaa.', 'aaaaaaaa.', '.aaaaaa..', '..aaaa...', '.........', '.........'],
  shield: ['aaaaaaaaa', 'aaaaaaaaa', 'aaaaaaaaa', 'aaaaaaaaa', '.aaaaaaa.', '.aaaaaaa.', '..aaaaa..', '...aaa...', '....a....'],
  dash: ['.........', 'aa..aaa..', '....aaaa.', 'aaa.aaaaa', '....aaaa.', 'aa..aaa..', '.........', '.........', '.........'],
  star: ['....a....', '....a....', '...aaa...', 'aaaaaaaaa', '.aaaaaaa.', '..aaaaa..', '.aa...aa.', 'aa.....aa', '.........'],
  bolt: ['.....aa..', '....aa...', '...aa....', '..aaaaaa.', '....aa...', '...aa....', '..aa.....', '.a.......', '.........'],
  pause: ['.........', '.aa...aa.', '.aa...aa.', '.aa...aa.', '.aa...aa.', '.aa...aa.', '.aa...aa.', '.........', '.........'],
  throw: ['......aaa', '.....aaaa', '....aaaa.', '...aaa...', '..aaa....', '.aaa.....', 'aaa......', 'aa.......', '.........'],
  turn: ['..aaaaa..', '.aa...aa.', 'aa.....aa', 'a.......a', 'a.....aaa', 'aa.....a.', '.aa......', '..aaa....', '.........'],
  fire: ['....a....', '...aa....', '...aaa...', '..aaaaa..', '.aaaaaaa.', '.aaa.aaa.', '.aa...aa.', '..aaaaa..', '.........'],
};

export function buildIconTextures(scene: Phaser.Scene): void {
  for (const [name, rows] of Object.entries(ICONS)) {
    makeTexture(scene, `icon-${name}`, 9, 9, (p) => p.stamp(0, 0, rows, { a: 0xffffff }));
  }
}

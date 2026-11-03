import Phaser from 'phaser';
import { mixc, ramp, shift } from './color';
import { makeSheet, type Painter } from './Painter';

export type HairStyle = 'short' | 'spiky' | 'buzz' | 'long' | 'ponytail' | 'bob' | 'bun' | 'twin' | 'curly' | 'side' | 'curtain' | 'bowl' | 'crew' | 'fade';
export type Build = 'slim' | 'normal' | 'big';
export type Outfit = 'uniform' | 'jersey' | 'jacket' | 'plain';
export type BottomStyle = 'pants' | 'shorts' | 'skirt';
export type Accessory = 'none' | 'glasses' | 'headband' | 'cap' | 'bandaid';

/** Everything needed to paint a friend. Fields map 1:1 to CharacterDefinition. */
export interface CharacterLook {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  shirt: number;
  bottom: number;
  bottomStyle: BottomStyle;
  shoes: number;
  /** Signature colour: ribbon / emblem / headband. */
  accent: number;
  accessory: Accessory;
  eye: number;
  /** Body shape (torso width / face roundness). */
  build?: Build;
  /** uniform = school shirt (collar stars, name, emblem); jersey = sleeveless; jacket = long sleeves over shirt. */
  outfit?: Outfit;
  /** Colour details for the outfit (stars on collar, jersey trim, inner shirt under a jacket). */
  detail?: number;
  earbuds?: boolean;
  braces?: boolean;
  /** Signature resting mouth (e.g. 'pout'). */
  mouth?: Mouth;
}

type Eyes = 'open' | 'blink' | 'happy' | 'x' | 'sad' | 'wide' | 'angry';
export type Mouth = 'smile' | 'open' | 'flat' | 'o' | 'sad' | 'grin' | 'teeth' | 'pout';

interface Pose {
  /** Body vertical offset (positive = down). */
  by: number;
  /** Extra head offset relative to body. */
  hx?: number;
  hy?: number;
  /** Foot offsets [backX, backY, frontX, frontY] (negative Y = lifted). */
  legs: [number, number, number, number];
  /** Arm angles in degrees: 0 = hanging down, 90 = forward, 180 = straight up, -60 = back. */
  arms: [number, number];
  eyes: Eyes;
  mouth: Mouth;
  sit?: boolean;
}

export const FRAME = 32;

/** Animation table: name → [first frame, count, fps, repeat]. */
export const CHAR_ANIMS: Record<string, [number, number, number, number]> = {
  idle: [0, 4, 5, -1],
  run: [4, 6, 14, -1],
  jump: [10, 1, 1, 0],
  fall: [11, 1, 1, 0],
  land: [12, 1, 1, 0],
  hit: [13, 1, 1, 0],
  stun: [14, 2, 6, -1],
  win: [16, 4, 8, -1],
  lose: [20, 2, 3, -1],
  attack: [22, 2, 12, 0],
  sit: [24, 1, 1, 0],
  walk: [25, 4, 8, -1],
  cheer: [29, 2, 6, -1],
};

const POSES: Pose[] = [
  // idle 0-3
  { by: 0, legs: [0, 0, 0, 0], arms: [8, -8], eyes: 'open', mouth: 'smile' },
  { by: 0, legs: [0, 0, 0, 0], arms: [6, -6], eyes: 'open', mouth: 'smile' },
  { by: 1, legs: [0, 0, 0, 0], arms: [4, -4], eyes: 'open', mouth: 'smile' },
  { by: 1, legs: [0, 0, 0, 0], arms: [6, -6], eyes: 'blink', mouth: 'smile' },
  // run 4-9
  { by: 0, hx: 1, legs: [-4, 0, 4, -1], arms: [60, -50], eyes: 'open', mouth: 'open' },
  { by: -1, hx: 1, legs: [-2, -2, 3, 0], arms: [30, -25], eyes: 'open', mouth: 'open' },
  { by: -1, hx: 1, legs: [1, -3, 0, 0], arms: [-10, 10], eyes: 'open', mouth: 'open' },
  { by: 0, hx: 1, legs: [4, -1, -4, 0], arms: [-50, 60], eyes: 'open', mouth: 'open' },
  { by: -1, hx: 1, legs: [3, 0, -2, -2], arms: [-25, 30], eyes: 'open', mouth: 'open' },
  { by: -1, hx: 1, legs: [0, 0, 1, -3], arms: [10, -10], eyes: 'open', mouth: 'open' },
  // jump 10, fall 11, land 12
  { by: -1, legs: [-1, -3, 2, -2], arms: [160, 150], eyes: 'wide', mouth: 'open' },
  { by: 0, legs: [-2, -1, 2, -2], arms: [120, 110], eyes: 'wide', mouth: 'o' },
  { by: 2, hy: 1, legs: [-2, 0, 2, 0], arms: [40, -40], eyes: 'blink', mouth: 'flat' },
  // hit 13
  { by: 0, hx: -2, hy: -1, legs: [-2, 0, 1, -1], arms: [140, -120], eyes: 'x', mouth: 'o' },
  // stun 14-15
  { by: 1, hx: -1, legs: [-1, 0, 1, 0], arms: [20, -15], eyes: 'x', mouth: 'flat' },
  { by: 1, hx: 1, legs: [-1, 0, 1, 0], arms: [15, -20], eyes: 'x', mouth: 'flat' },
  // win 16-19
  { by: 0, legs: [0, 0, 0, 0], arms: [170, 170], eyes: 'happy', mouth: 'grin' },
  { by: -2, legs: [-1, -2, 1, -2], arms: [175, 175], eyes: 'happy', mouth: 'grin' },
  { by: -3, legs: [-1, -3, 1, -3], arms: [150, 150], eyes: 'happy', mouth: 'teeth' },
  { by: -1, legs: [-1, -1, 1, -1], arms: [165, 165], eyes: 'happy', mouth: 'grin' },
  // lose 20-21
  { by: 2, hy: 2, legs: [0, 0, 0, 0], arms: [0, 0], eyes: 'sad', mouth: 'sad' },
  { by: 2, hy: 3, legs: [0, 0, 0, 0], arms: [-4, 4], eyes: 'blink', mouth: 'sad' },
  // attack 22-23
  { by: 0, hx: -1, legs: [-3, 0, 2, 0], arms: [-40, 40], eyes: 'angry', mouth: 'flat' },
  { by: 0, hx: 2, legs: [-4, 0, 4, 0], arms: [20, 95], eyes: 'angry', mouth: 'teeth' },
  // sit 24
  { by: 3, legs: [3, -2, 5, -2], arms: [60, 70], eyes: 'open', mouth: 'smile', sit: true },
  // walk 25-28
  { by: 0, legs: [-2, 0, 2, 0], arms: [25, -20], eyes: 'open', mouth: 'smile' },
  { by: -1, legs: [0, -1, 0, 0], arms: [5, -5], eyes: 'open', mouth: 'smile' },
  { by: 0, legs: [2, 0, -2, 0], arms: [-20, 25], eyes: 'open', mouth: 'smile' },
  { by: -1, legs: [0, 0, 0, -1], arms: [-5, 5], eyes: 'open', mouth: 'smile' },
  // cheer 29-30
  { by: 0, legs: [0, 0, 0, 0], arms: [150, 30], eyes: 'happy', mouth: 'open' },
  { by: -1, legs: [0, 0, 0, 0], arms: [30, 150], eyes: 'happy', mouth: 'grin' },
];

const OUTLINE_EYE = 0x1a1424;
const BLUSH = 0xff8a9a;

function armEnd(sx: number, sy: number, deg: number, len: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  return [sx + Math.sin(r) * len, sy + Math.cos(r) * len];
}

function drawArm(p: Painter, sx: number, sy: number, deg: number, look: CharacterLook, back: boolean): void {
  const base = look.outfit === 'jersey' ? look.skin : look.shirt;
  const sleeve = back ? shift(base, -0.25) : base;
  const skin = back ? shift(look.skin, -0.25) : look.skin;
  const sleeveLen = look.outfit === 'jacket' ? 5 : 3;
  const [ex, ey] = armEnd(sx, sy, deg, sleeveLen);
  const [hx, hy] = armEnd(sx, sy, deg, 6);
  p.stroke(sx, sy, ex, ey, 2, sleeve);
  p.stroke(ex, ey, hx, hy, 2, skin);
  if (look.outfit === 'jersey') p.px(Math.round(sx), Math.round(sy), back ? shift(look.shirt, -0.25) : look.shirt);
}

function drawLeg(p: Painter, hipX: number, hipY: number, fx: number, fy: number, look: CharacterLook, back: boolean): void {
  const legC = look.bottomStyle === 'pants' ? look.bottom : look.skin;
  const c = back ? shift(legC, -0.3) : legC;
  const shoe = back ? shift(look.shoes, -0.3) : look.shoes;
  const footX = hipX + fx;
  const footY = 30 + fy;
  p.stroke(hipX, hipY, footX, footY - 1, 2, c);
  if (look.bottomStyle !== 'pants') p.rect(footX - 1, footY - 2, 2, 1, back ? 0xc9ccd6 : 0xf4f4f8);
  // shoe points forward (right)
  p.rect(footX - 1, footY - 1, 4, 2, shoe);
  p.px(footX + 2, footY - 1, shift(shoe, 0.4));
  p.hline(footX - 1, footY, 4, shift(shoe, -0.4));
}

function shadeHead(p: Painter, cx: number, cy: number, look: CharacterLook): void {
  const s = ramp(look.skin);
  const rx = look.build === 'big' ? 8.1 : 7.5, ry = look.build === 'big' ? 7.3 : 7;
  for (let y = Math.floor(cy - 8); y <= cy + 8; y++) {
    for (let x = Math.floor(cx - 9); x <= cx + 9; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      let c = s[2];
      if (nx < -0.55 && ny > -0.2) c = s[1];
      if (ny > 0.75) c = s[1];
      if (nx < -0.75 && ny > 0.3) c = s[0];
      p.px(x, y, c);
    }
  }
}

/** Hair mask: returns true where hair covers the head/around it. */
function hairAt(style: HairStyle, x: number, y: number, cx: number, cy: number): boolean {
  const nx = (x + 0.5 - cx) / 8.3, ny = (y + 0.5 - cy) / 7.8;
  const inCap = nx * nx + ny * ny <= 1;
  const fringe = cy - 2 + (x % 3 === 0 ? 1 : 0); // zig-zag bangs
  const backSide = x < cx - 1;
  switch (style) {
    case 'buzz':
      return inCap && y <= cy - 3 + (backSide ? 2 : 0);
    case 'short':
    case 'spiky':
    case 'bun':
    case 'ponytail':
      return inCap && (y <= fringe || (backSide && y <= cy + 3 && x < cx - 3));
    case 'side': {
      const sweep = cy - 1 - Math.floor((x - cx) / 2);
      return inCap && (y <= Math.max(cy - 4, sweep) || (backSide && y <= cy + 3 && x < cx - 3));
    }
    case 'curly': {
      const nx2 = (x + 0.5 - cx) / 9, ny2 = (y + 0.5 - cy) / 8.6;
      return nx2 * nx2 + ny2 * ny2 <= 1 && (y <= cy - 2 || (backSide && y <= cy + 4 && x < cx - 2));
    }
    case 'bob': {
      const nx2 = (x + 0.5 - cx) / 8.6, ny2 = (y + 0.5 - cy) / 8.4;
      const inBob = nx2 * nx2 + ny2 * ny2 <= 1.15;
      return inBob && (y <= cy - 3 || (y <= cy + 6 && (x < cx - 3 || x > cx + 6)));
    }
    case 'long':
    case 'twin':
      return inCap && (y <= fringe || (backSide && x < cx - 2));
    case 'curtain': {
      // voluminous middle-part: taller crown, fringe swept up at the front
      const nx2 = (x + 0.5 - cx) / 8.6, ny2 = (y + 0.5 - (cy - 0.6)) / 8.4;
      const front = x > cx + 1;
      const sweep = cy - 3 + (x > cx + 5 ? 1 : 0) + (x === cx + 3 ? -1 : 0);
      return nx2 * nx2 + ny2 * ny2 <= 1 && (front ? y <= sweep : y <= cy - 1 || (backSide && y <= cy + 2 && x < cx - 3));
    }
    case 'bowl': {
      const nx2 = (x + 0.5 - cx) / 8.7, ny2 = (y + 0.5 - cy) / 8.2;
      return nx2 * nx2 + ny2 * ny2 <= 1 && (y <= cy - 1 || (backSide && y <= cy + 3 && x < cx - 2));
    }
    case 'crew':
      return inCap && (y <= cy - 3 + (x > cx + 4 ? 0 : 0) || (backSide && y <= cy + 1 && x < cx - 3));
    case 'fade':
      return inCap && y <= cy - 4 + (backSide ? 1 : 0);
  }
}

function drawHair(p: Painter, cx: number, cy: number, look: CharacterLook, behind: boolean): void {
  const h = ramp(look.hair);
  const style = look.hairStyle;
  if (behind) {
    // Pieces drawn behind the body.
    if (style === 'long') {
      for (let y = cy; y <= cy + 11; y++) p.hline(cx - 8 + Math.floor((y - cy) / 5), y, 7, y > cy + 8 ? h[1] : h[2]);
    }
    if (style === 'ponytail') {
      p.ellipse(cx - 9, cy + 1, 3, 4, h[2]);
      p.ellipse(cx - 10, cy + 5, 2, 3, h[1]);
    }
    if (style === 'twin') {
      p.ellipse(cx - 9, cy + 3, 2.5, 5, h[2]);
      p.ellipse(cx + 8, cy + 3, 2.5, 5, h[1]);
    }
    if (style === 'bun') p.ball(cx - 3, cy - 8, 3.5, 3.2, look.hair, false);
    return;
  }
  for (let y = Math.floor(cy - 10); y <= cy + 8; y++) {
    for (let x = Math.floor(cx - 10); x <= cx + 10; x++) {
      if (!hairAt(style, x, y, cx, cy)) continue;
      const nx = (x + 0.5 - cx) / 8, ny = (y + 0.5 - cy) / 8;
      let c = h[2];
      if (nx < -0.4 && ny > -0.3) c = h[1];
      if (ny > 0.15) c = h[1];
      if (nx < -0.7 && ny > 0.2) c = h[0];
      // anime shine arc
      const arc = Math.abs(Math.hypot(nx + 0.05, ny + 0.15) - 0.62);
      if (arc < 0.07 && ny < -0.25 && nx > -0.5 && nx < 0.45) c = h[4];
      else if (ny < -0.55 && nx < 0.1) c = h[3];
      p.px(x, y, c);
    }
  }
  if (style === 'fade') {
    // faded sides: a soft band between hair and skin
    const band = mixc(look.hair, look.skin, 0.55);
    for (let y = cy - 3; y <= cy; y++) for (let x = cx - 8; x <= cx - 2; x++) {
      const nx = (x + 0.5 - cx) / 7.5, ny = (y + 0.5 - cy) / 7;
      if (nx * nx + ny * ny <= 1) p.px(x, y, y === cy - 3 ? mixc(look.hair, look.skin, 0.3) : band);
    }
  }
  if (style === 'curtain') {
    p.px(cx + 1, cy - 8, h[3]); p.px(cx + 2, cy - 9, h[2]);
  }
  if (style === 'spiky') {
    for (const [sx, top] of [[cx - 5, cy - 10], [cx - 1, cy - 11], [cx + 3, cy - 10]] as const) {
      p.tri(sx - 2, cy - 6, sx + 2, cy - 6, sx, top, h[2]);
      p.px(sx, top + 1, h[3]);
    }
  }
  if (style === 'ponytail') p.rect(cx - 7, cy - 1, 2, 2, look.accent);
  if (style === 'twin') {
    p.rect(cx - 9, cy - 2, 2, 2, look.accent);
    p.rect(cx + 7, cy - 2, 2, 2, look.accent);
  }
  if (style === 'bun') p.hline(cx - 5, cy - 6, 4, look.accent);
  if (style === 'curly') {
    for (let i = -8; i <= 8; i += 3) p.px(cx + i, cy - Math.round(Math.sqrt(Math.max(0, 64 - i * i)) * 0.96) - 1, h[3]);
  }
}

function drawFace(p: Painter, cx: number, cy: number, pose: Pose, look: CharacterLook): void {
  const ex1 = cx + 1, ex2 = cx + 5, ey = cy;
  const eye = (x: number) => {
    switch (pose.eyes) {
      case 'open':
        p.vline(x, ey - 1, 3, OUTLINE_EYE);
        p.vline(x + 1, ey - 1, 3, look.eye);
        p.px(x + 1, ey - 1, 0xffffff);
        p.px(x, ey + 1, look.eye);
        break;
      case 'wide':
        p.rect(x, ey - 2, 2, 4, OUTLINE_EYE);
        p.px(x + 1, ey - 2, 0xffffff);
        p.px(x, ey - 1, 0xffffff);
        break;
      case 'blink':
        p.hline(x, ey + 1, 2, OUTLINE_EYE);
        break;
      case 'happy':
        p.px(x, ey, OUTLINE_EYE);
        p.px(x + 1, ey - 1, OUTLINE_EYE);
        p.px(x + 2, ey, OUTLINE_EYE);
        break;
      case 'sad':
        p.hline(x, ey, 2, OUTLINE_EYE);
        p.px(x + (x === ex1 ? 0 : 1), ey - 1, OUTLINE_EYE);
        p.px(x + 1, ey + 1, 0x7fc8ff);
        break;
      case 'x':
        p.px(x, ey - 1, OUTLINE_EYE); p.px(x + 2, ey - 1, OUTLINE_EYE);
        p.px(x + 1, ey, OUTLINE_EYE);
        p.px(x, ey + 1, OUTLINE_EYE); p.px(x + 2, ey + 1, OUTLINE_EYE);
        break;
      case 'angry':
        p.vline(x, ey, 2, OUTLINE_EYE);
        p.vline(x + 1, ey, 2, look.eye);
        p.px(x + (x === ex1 ? 0 : 1), ey - 1, OUTLINE_EYE);
        p.px(x + (x === ex1 ? -1 : 2), ey - 2, OUTLINE_EYE);
        break;
    }
  };
  eye(ex1);
  eye(ex2);
  // blush
  p.px(cx, cy + 3, BLUSH);
  p.px(cx + 5, cy + 3, BLUSH);
  const mx = cx + 3, my = cy + 4;
  const mouthC = 0x6b2433;
  // Signature resting mouth replaces the neutral smile.
  const mouth = pose.mouth === 'smile' && look.mouth ? look.mouth : pose.mouth;
  switch (mouth) {
    case 'pout':
      p.rect(mx + 1, my, 2, 2, 0xd9837f); p.px(mx + 3, my, 0xd9837f); p.px(mx + 1, my, 0xf0a8a0); p.px(mx + 2, my + 1, mouthC);
      break;
    case 'smile': p.px(mx - 1, my, mouthC); p.px(mx, my + 1, mouthC); p.px(mx + 1, my, mouthC); break;
    case 'grin': p.hline(mx - 1, my, 3, mouthC); p.hline(mx, my + 1, 2, 0xff6680); break;
    case 'teeth': p.rect(mx - 1, my, 4, 2, mouthC); p.hline(mx - 1, my, 4, 0xffffff); break;
    case 'open': p.rect(mx, my, 2, 2, mouthC); p.px(mx, my + 1, 0xff6680); break;
    case 'o': p.rect(mx, my, 2, 2, mouthC); break;
    case 'flat': p.hline(mx, my + 1, 2, mouthC); break;
    case 'sad': p.px(mx - 1, my + 1, mouthC); p.px(mx, my, mouthC); p.px(mx + 1, my + 1, mouthC); break;
  }
  if (look.braces && (mouth === 'teeth' || mouth === 'grin' || mouth === 'open')) p.hline(mx - 1, my, mouth === 'open' ? 2 : 3, 0x3d6fff);
}

function drawAccessory(p: Painter, cx: number, cy: number, look: CharacterLook): void {
  switch (look.accessory) {
    case 'glasses':
      p.rect(cx, cy - 1, 3, 3, 0x2a2238);
      p.rect(cx + 4, cy - 1, 3, 3, 0x2a2238);
      p.px(cx + 1, cy, 0xbfe9ff); p.px(cx + 5, cy, 0xbfe9ff);
      p.hline(cx + 3, cy - 1, 1, 0x2a2238);
      p.hline(cx - 6, cy - 1, 6, 0x2a2238);
      break;
    case 'headband':
      p.hline(cx - 7, cy - 4, 15, look.accent);
      p.hline(cx - 7, cy - 3, 15, shift(look.accent, -0.35));
      break;
    case 'cap':
      p.ellipse(cx, cy - 5, 8, 4, look.accent);
      p.rect(cx - 8, cy - 5, 17, 2, look.accent);
      p.rect(cx + 2, cy - 3, 9, 2, shift(look.accent, -0.3));
      p.px(cx - 2, cy - 8, shift(look.accent, 0.5));
      break;
    case 'bandaid':
      p.rect(cx + 5, cy + 2, 3, 2, 0xf3c9a0);
      p.px(cx + 6, cy + 2, 0xffffff);
      break;
    case 'none':
      break;
  }
}

function drawFrame(p: Painter, look: CharacterLook, pose: Pose): void {
  const by = pose.by;
  const hipY = 25 + by;
  const torsoTop = 18 + by;
  const cx = 16 + (pose.hx ?? 0);
  const cy = 11 + by + (pose.hy ?? 0);

  // contact shadow handled by the engine; here only the sprite.
  const shoulderBack = look.build === 'big' ? 12 : 13;
  const shoulderFront = look.build === 'big' ? 20 : look.build === 'slim' ? 18 : 19;
  drawArm(p, shoulderBack, torsoTop + 2, -pose.arms[0] + 0, look, true);
  if (!pose.sit) drawLeg(p, 14, hipY, pose.legs[0], pose.legs[1], look, true);
  drawHair(p, cx, cy, look, true);

  // torso (width depends on build)
  const tl = look.build === 'big' ? 10 : 11;
  const tr = look.build === 'big' ? 21 : look.build === 'slim' ? 19 : 20;
  const outfit = look.outfit ?? 'plain';
  const sh = ramp(look.shirt);
  for (let y = torsoTop; y < hipY; y++) {
    for (let x = tl; x <= tr; x++) {
      const corner = (y === torsoTop && (x === tl || x === tr));
      if (corner) continue;
      let c = sh[2];
      if (x <= tl + 1) c = sh[1];
      if (x >= tr - 1 && y > torsoTop) c = sh[3];
      if (y === hipY - 1) c = sh[1];
      p.px(x, y, c);
    }
  }
  const mid = Math.round((tl + tr) / 2);
  if (outfit === 'uniform') {
    // collar points, two stars, embroidered name, school emblem, placket
    const col = shift(look.shirt, 0.45);
    p.px(mid - 1, torsoTop, col); p.px(mid + 2, torsoTop, col);
    p.px(mid, torsoTop, look.skin); p.px(mid + 1, torsoTop, look.skin);
    p.px(mid + 1, torsoTop + 1, sh[1]);
    p.px(mid - 2, torsoTop + 1, look.detail ?? 0x2f4fd0);
    p.px(tr - 1, torsoTop + 1, look.detail ?? 0x2f4fd0);
    p.hline(tl + 2, torsoTop + 3, 2, 0x3a5ad8);
    p.px(tr - 2, torsoTop + 4, 0xf08a2a);
    p.px(tr - 3, torsoTop + 4, 0xd9692a);
    p.vline(mid + 1, torsoTop + 2, hipY - torsoTop - 3, sh[1]);
  } else if (outfit === 'jersey') {
    const trim = look.detail ?? 0xd9b04a;
    p.px(mid, torsoTop, look.skin); p.px(mid + 1, torsoTop, look.skin); p.px(mid, torsoTop + 1, look.skin);
    p.px(mid - 1, torsoTop, trim); p.px(mid + 2, torsoTop, trim); p.px(mid + 1, torsoTop + 1, trim); p.px(mid - 1, torsoTop + 1, trim);
    // gold chest print + number
    p.hline(tl + 2, torsoTop + 3, tr - tl - 3, trim);
    p.px(tl + 3, torsoTop + 5, shift(trim, -0.2)); p.px(tl + 5, torsoTop + 5, shift(trim, -0.2));
  } else if (outfit === 'jacket') {
    const inner = look.detail ?? 0x9be6c8;
    p.px(mid, torsoTop, inner); p.px(mid + 1, torsoTop, inner); p.px(mid - 1, torsoTop, inner); p.px(mid, torsoTop + 1, inner);
    p.vline(mid + 1, torsoTop + 1, hipY - torsoTop - 2, sh[0]);
    p.px(mid + 2, torsoTop + 3, sh[3]); p.px(mid + 2, torsoTop + 5, sh[3]);
  } else {
    // plain shirt: collar + signature colour tie/ribbon
    p.px(16, torsoTop, sh[0]); p.px(17, torsoTop, sh[0]);
    p.rect(16, torsoTop + 1, 2, 2, look.accent);
    p.px(16, torsoTop + 1, shift(look.accent, 0.4));
  }

  // bottom
  const bt = ramp(look.bottom);
  if (look.bottomStyle === 'skirt') {
    for (let j = 0; j < 4; j++) p.hline(tl - Math.floor(j / 2), hipY - 1 + j, tr - tl + 1 + Math.floor(j / 2) * 2, j % 2 ? bt[1] : bt[2]);
    for (let x = tl; x <= tr; x += 3) p.vline(x, hipY, 2, bt[0]);
  } else {
    p.hline(tl, hipY - 1, tr - tl + 1, bt[2]);
    p.hline(tl, hipY, tr - tl + 1, bt[1]);
    p.px(15, hipY, bt[0]);
    if (look.bottomStyle === 'shorts') p.hline(tl, hipY + 1, tr - tl + 1, bt[1]);
  }
  if (!pose.sit) drawLeg(p, 18, hipY, pose.legs[2], pose.legs[3], look, false);
  else {
    p.rect(16, hipY - 1, 8, 2, look.bottomStyle === 'pants' ? look.bottom : look.skin);
    p.rect(22, hipY + 1, 2, 4, look.bottomStyle === 'pants' ? look.bottom : look.skin);
    p.rect(22, hipY + 4, 4, 2, look.shoes);
  }

  // head
  shadeHead(p, cx, cy, look);
  // ear (+ white earbud)
  p.px(cx - 3, cy + 1, look.earbuds ? 0xffffff : shift(look.skin, -0.3));
  if (look.earbuds) p.px(cx - 3, cy + 2, 0xd8dbe4);
  drawFace(p, cx, cy, pose, look);
  drawHair(p, cx, cy, look, false);
  drawAccessory(p, cx, cy, look);

  drawArm(p, shoulderFront, torsoTop + 2, pose.arms[1], look, false);
  if (look.earbuds) p.px(cx - 3, cy + 1, 0xffffff);
  p.outline(-0.75);
}

/** Paint the full sheet for one character and register its animations. */
export function buildCharacter(scene: Phaser.Scene, id: string, look: CharacterLook): string {
  const key = `char-${id}`;
  makeSheet(scene, key, FRAME, FRAME, POSES.length, (p, i) => drawFrame(p, look, POSES[i]));
  for (const [name, [start, count, fps, repeat]] of Object.entries(CHAR_ANIMS)) {
    const animKey = `${key}-${name}`;
    if (scene.anims.exists(animKey)) continue;
    scene.anims.create({
      key: animKey,
      frames: Array.from({ length: count }, (_, k) => ({ key, frame: start + k })),
      frameRate: fps,
      repeat,
    });
  }
  return key;
}

/** Repaint a character after its look was edited (drops cached texture + anims). */
export function rebuildCharacter(scene: Phaser.Scene, id: string, look: CharacterLook): string {
  const key = `char-${id}`;
  for (const name of Object.keys(CHAR_ANIMS)) scene.anims.remove(`${key}-${name}`);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  return buildCharacter(scene, id, look);
}

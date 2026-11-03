import type { CharacterLook } from '../art/CharacterArt';

export interface CharacterEntry {
  id: string;
  /** Name shown in game. */
  name: string;
  look: CharacterLook;
  /** True until the user sends references and approves the design. */
  placeholder: boolean;
}

const SKIN = { light: 0xffd9b8, warm: 0xf5c29a, tan: 0xdca37a, deep: 0xb97f56 };
const NAVY = 0x283a72;
const BLACK_PANTS = 0x2c2c3a;
const WHITE_SHIRT = 0xf2f4fa;

/**
 * Placeholder classmates until the real 5/8 roster and photos arrive.
 * All wear the Thai school uniform; the accent is each one's signature colour.
 */
export const CHARACTERS: CharacterEntry[] = [
  { id: 'c01', name: 'นักเรียน 1', placeholder: true, look: { skin: SKIN.warm, hair: 0x2b2030, hairStyle: 'spiky', shirt: WHITE_SHIRT, bottom: BLACK_PANTS, bottomStyle: 'pants', shoes: 0x3a3340, accent: 0xff5a6e, accessory: 'none', eye: 0x4a2c20 } },
  { id: 'c02', name: 'นักเรียน 2', placeholder: true, look: { skin: SKIN.light, hair: 0x3a2622, hairStyle: 'long', shirt: WHITE_SHIRT, bottom: NAVY, bottomStyle: 'skirt', shoes: 0x2b2733, accent: 0x3d9bff, accessory: 'none', eye: 0x3a2418 } },
  { id: 'c03', name: 'นักเรียน 3', placeholder: true, look: { skin: SKIN.tan, hair: 0x1f1a26, hairStyle: 'buzz', shirt: WHITE_SHIRT, bottom: BLACK_PANTS, bottomStyle: 'pants', shoes: 0x3a3340, accent: 0x3ed17a, accessory: 'glasses', eye: 0x2a1a14 } },
  { id: 'c04', name: 'นักเรียน 4', placeholder: true, look: { skin: SKIN.warm, hair: 0x5a3426, hairStyle: 'ponytail', shirt: WHITE_SHIRT, bottom: NAVY, bottomStyle: 'skirt', shoes: 0x2b2733, accent: 0xffc93d, accessory: 'none', eye: 0x4a2c20 } },
  { id: 'c05', name: 'นักเรียน 5', placeholder: true, look: { skin: SKIN.light, hair: 0x2a2234, hairStyle: 'side', shirt: WHITE_SHIRT, bottom: BLACK_PANTS, bottomStyle: 'pants', shoes: 0x3a3340, accent: 0xb8a6ff, accessory: 'none', eye: 0x2a1a14 } },
  { id: 'c06', name: 'นักเรียน 6', placeholder: true, look: { skin: SKIN.deep, hair: 0x1c1620, hairStyle: 'bob', shirt: WHITE_SHIRT, bottom: NAVY, bottomStyle: 'skirt', shoes: 0x2b2733, accent: 0xff9f43, accessory: 'headband', eye: 0x2a1a14 } },
  { id: 'c07', name: 'นักเรียน 7', placeholder: true, look: { skin: SKIN.warm, hair: 0x40281e, hairStyle: 'curly', shirt: WHITE_SHIRT, bottom: BLACK_PANTS, bottomStyle: 'shorts', shoes: 0x3a3340, accent: 0x3fe0e0, accessory: 'bandaid', eye: 0x3a2418 } },
  { id: 'c08', name: 'นักเรียน 8', placeholder: true, look: { skin: SKIN.light, hair: 0x2b2030, hairStyle: 'twin', shirt: WHITE_SHIRT, bottom: NAVY, bottomStyle: 'skirt', shoes: 0x2b2733, accent: 0xff7a85, accessory: 'none', eye: 0x3a2418 } },
  { id: 'c09', name: 'นักเรียน 9', placeholder: true, look: { skin: SKIN.tan, hair: 0x2a2234, hairStyle: 'short', shirt: WHITE_SHIRT, bottom: BLACK_PANTS, bottomStyle: 'pants', shoes: 0x3a3340, accent: 0x7ee8b0, accessory: 'cap', eye: 0x2a1a14 } },
  { id: 'c10', name: 'นักเรียน 10', placeholder: true, look: { skin: SKIN.warm, hair: 0x6a3a22, hairStyle: 'bun', shirt: WHITE_SHIRT, bottom: NAVY, bottomStyle: 'skirt', shoes: 0x2b2733, accent: 0x8455d6, accessory: 'glasses', eye: 0x4a2c20 } },
];

export function characterById(id: string): CharacterEntry {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

const STORE = 'c58-chars';

/** Apply edits saved on this device (names / looks) over the defaults. */
export function loadCharacterEdits(): void {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const edits = JSON.parse(raw) as Record<string, { name?: string; look?: Partial<CharacterLook> }>;
    for (const c of CHARACTERS) {
      const e = edits[c.id];
      if (!e) continue;
      if (typeof e.name === 'string' && e.name.trim()) c.name = e.name.trim().slice(0, 16);
      if (e.look) Object.assign(c.look, e.look);
    }
  } catch {
    /* storage blocked: defaults */
  }
}

export function saveCharacterEdits(): void {
  try {
    const out: Record<string, { name: string; look: CharacterLook }> = {};
    for (const c of CHARACTERS) out[c.id] = { name: c.name, look: c.look };
    localStorage.setItem(STORE, JSON.stringify(out));
  } catch {
    /* ignore */
  }
}

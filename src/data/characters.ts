import type { CharacterLook } from '../art/CharacterArt';

export interface CharacterEntry {
  id: string;
  /** Name shown in game (nickname). */
  name: string;
  look: CharacterLook;
  /** True until the user has sent references and approved the design. */
  placeholder: boolean;
  /** What the design is based on (for review with the class). */
  notes?: string;
}

// School uniform seen in the photos: mint-green short-sleeve shirt, two blue
// collar stars, name embroidered in blue, orange wing emblem on the pocket.
const MINT = 0x9be6c8;
const SHORTS = 0x262c44; // dark navy shorts (boys, from the classroom photos)
const SKIRT = 0x283a72; // ASSUMPTION: girls' bottoms are not visible in the photos
const SHOES = 0x24222c;
const HAIR = 0x1d1917;

const uniform = (o: Partial<CharacterLook>): CharacterLook => ({
  skin: 0xe0a882, hair: HAIR, hairStyle: 'short', shirt: MINT, bottom: SHORTS, bottomStyle: 'shorts',
  shoes: SHOES, accent: 0x3d9bff, accessory: 'none', eye: 0x2a1a14, build: 'normal', outfit: 'uniform', ...o,
});

/** Friends of class 5/8, drawn from the photos the class sent. */
export const CHARACTERS: CharacterEntry[] = [
  { id: 'c01', name: 'เกล', placeholder: false, notes: 'ผมยาวสีดำรวบหลัง ผมปอยหน้า ยิ้มหวาน ถือพัดลมพกพาสีชมพู',
    look: uniform({ skin: 0xf0c4a2, hairStyle: 'ponytail', bottom: SKIRT, bottomStyle: 'skirt', accent: 0xff8fb8, eye: 0x2a1a14 }) },
  { id: 'c02', name: 'ต้นรัก', placeholder: false, notes: 'ผมสั้นแสกกลาง ยิ้มกว้างเห็นเหล็กดัดฟันสีน้ำเงิน สะพายเป้ดำ',
    look: uniform({ skin: 0xd49a72, hairStyle: 'curtain', braces: true, mouth: 'teeth', accent: 0x3d6fff }) },
  { id: 'c03', name: 'ดรีม', placeholder: false, notes: 'ตัวใหญ่ หน้ากลม ผมหน้าม้าหนา ยิ้มเบาๆ',
    look: uniform({ skin: 0xc98f68, hairStyle: 'bowl', build: 'big', accent: 0x3ed17a }) },
  { id: 'c04', name: 'มิว', placeholder: false, notes: 'ผมยาวตรงสีดำ แสกกลาง หน้ากลม ยิ้มมุมปาก',
    look: uniform({ skin: 0xf3d0b6, hairStyle: 'long', bottom: SKIRT, bottomStyle: 'skirt', accent: 0xd9a0ff, mouth: 'flat' }) },
  { id: 'c05', name: 'บิ๊กแบง', placeholder: false, notes: 'เสื้อบาสสีดำทองเบอร์ 22 ผมสั้นยุ่งๆ ยิ้มเห็นฟัน ผอมสูง',
    look: uniform({ skin: 0xd8a07c, hairStyle: 'spiky', build: 'slim', outfit: 'jersey', shirt: 0x1e1e26, detail: 0xd9b04a, bottom: 0xe8e8ee, accent: 0xd9b04a, mouth: 'teeth' }) },
  { id: 'c06', name: 'ฟางข้าว', placeholder: false, notes: 'ผมสั้นเกรียนหน้าม้าตรง ตัวใหญ่ ยิ้มกว้าง สะพายเป้',
    look: uniform({ skin: 0xb9784e, hairStyle: 'crew', build: 'big', accent: 0xffc93d, mouth: 'grin' }) },
  { id: 'c07', name: 'โชกุน', placeholder: false, notes: 'เสื้อแจ็กเก็ตดำทับเสื้อนักเรียน ผมแสกกลางมีวอลลุ่ม ใส่หูฟัง',
    look: uniform({ skin: 0xc98a60, hairStyle: 'curtain', build: 'slim', outfit: 'jacket', shirt: 0x24252d, detail: MINT, earbuds: true, accent: 0x7ee8b0, mouth: 'flat' }) },
  { id: 'c08', name: 'ชัน', placeholder: false, notes: 'ผมสั้นเฟดข้าง หน้านิ่ง หุ่นนักกีฬา',
    look: uniform({ skin: 0xc98c64, hairStyle: 'fade', accent: 0xff9f43, mouth: 'flat' }) },
  { id: 'c09', name: 'ตูน', placeholder: false, notes: 'ผมสั้นรองทรง ทำปากจู๋ ดาวที่ปกเสื้อสีเหลือง',
    look: uniform({ skin: 0xe0aa84, hairStyle: 'crew', build: 'slim', detail: 0xffd23d, accent: 0xffe066, mouth: 'pout' }) },
  { id: 'c10', name: 'นน', placeholder: false, notes: 'ผมสั้นมีหน้าม้า หน้านิ่งจริงจัง',
    look: uniform({ skin: 0xc48a62, hairStyle: 'short', accent: 0x6ec6ff, mouth: 'flat' }) },
  { id: 'c11', name: 'ตีโน่', placeholder: false, notes: 'ใส่แว่นกรอบโลหะ ผมสั้นมีวอลลุ่ม ใส่หูฟัง ยิ้มกว้าง',
    look: uniform({ skin: 0xa86e4a, hairStyle: 'side', build: 'slim', accessory: 'glasses', earbuds: true, accent: 0x8455d6, mouth: 'teeth' }) },
];

export function characterById(id: string): CharacterEntry {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

const STORE = 'c58-chars-v2';

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

# Art Direction — Premium Pixel Art

> ร่างแรก จะยืนยันหลัง Visual Prototype (Phase 2) ผ่านการตรวจของผู้ใช้

## หลัก

- High-detail pixel art สีสด มีมิติ — ไม่ใช่ 8-bit หยาบ, ไม่ใช้ CSS shape / emoji เป็นกราฟิกหลัก
- ทุก asset วาดเป็น pixel data ในโค้ด จาก palette กลาง (`src/core/palette.ts`) เท่านั้น
- ทุกฉากมี 5 ชั้น: Far BG → BG → Midground → Gameplay → Foreground + ของขยับในฉาก (เมฆ, ใบไม้, ฝุ่น, พัดลม)

## ขนาด

| สิ่งของ | ขนาด (px) |
|---|---|
| จอ render | สูง 480, กว้าง 640–768 |
| ตัวละคร (มินิเกม) | 32×32 ต่อเฟรม |
| ตัวละคร (ห้องเรียน/ฉลอง) | 48×48 |
| Tile | 16×16 |
| ปุ่มสัมผัสขั้นต่ำ | ≥ 44pt จริงบนจอ (~ 28px ใน render) |

## สี

Palette หลัก: Deep Navy `#1b1f3b`, Cream `#fff8e7`, Sky Blue `#6ec6ff`, Cyan `#3fe0e0`, Mint `#7ee8b0`, Lemon `#ffe066`, Coral `#ff7a85`, Orange `#ff9f43`, Lavender `#b8a6ff`, Purple `#8455d6`

สีผู้เล่น (ต้องแยกกันชัด, มีเฉด main/dark/light):

| ผู้เล่น | สี | main |
|---|---|---|
| P1 | RED | `#ff5a6e` |
| P2 | BLUE | `#3d9bff` |
| P3 | GREEN | `#3ed17a` |
| P4 | YELLOW | `#ffc93d` |

นอกจากสี ผู้เล่นต้องแยกได้ด้วยสัญลักษณ์ (เลข P1–P4 / รูปทรง) เผื่อคนตาบอดสี

## กฎ Asset

1. แสงมาจากซ้ายบนเสมอ — highlight ซ้ายบน, เงาขวาล่าง
2. Outline สีเข้มของสีวัตถุ (ไม่ใช้ดำล้วน)
3. ห้ามหมุน/ขยาย sprite แบบไม่เป็นจำนวนเต็มในเกม (pixel เพี้ยน)
4. Animation ใช้ anticipation, squash & stretch, follow-through ทุกท่าหลัก
5. ตัวละครเพื่อน: ใช้เฉพาะรายละเอียดที่มีในรูปอ้างอิง — ไม่แต่งเพิ่มเอง

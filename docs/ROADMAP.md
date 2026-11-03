# Roadmap

| Phase | งาน | สถานะ |
|---|---|---|
| 0 — Research & Audit | Audit repo, เลือก Engine, โครงสร้างโปรเจกต์, Multi-touch test, Deploy | ✅ เสร็จ (รอทดสอบบน iPad จริง) |
| 1 — Foundation | Scene flow, Player/Character/Score/VFX/Animation system, Minigame framework | ⏳ |
| 2 — Classroom World | วิเคราะห์รูปห้อง + ผังที่นั่ง → Visual Prototype ให้ผู้ใช้ตรวจ | ⏸ รอข้อมูลผู้ใช้ |
| 3 — Vertical Slice | 3 เกมคุณภาพเต็ม (Racing / Survival / Fighting) + ทดสอบ 4 คน | ⏳ |
| 4 — Minigame Production | เกมที่เหลือ 47 เกม ทีละกลุ่ม | ⏳ |
| 5 — Party Mode | รอบ, คะแนน, อันดับ, Winner Ceremony | ⏳ |
| 6 — Visual Polish | Lighting, Particles, Transitions, Sound | ⏳ |
| 7 — QA | ทดสอบทุกเกมบน iPad จริง | ⏳ |

## Phase 0 — ผล Audit

- Repo ว่าง: commit `80a8346` ลบไฟล์โปรเจกต์เก่า (enrollment assistant) ทั้งหมดแล้ว → ไม่มีอะไรต้องย้าย/ลบ
- งานใหม่อยู่ branch `classroom-58-party`
- Repo เป็น **public** → รูปเพื่อนจริงเก็บใน `reference/photos/` ซึ่งถูก `.gitignore` ไว้ ไม่ขึ้น GitHub

## ตัดสินใจแล้ว

- Engine: Phaser 3.90 + TypeScript + Vite
- Pixel Art: วาดด้วยโค้ด (pixel data ในซอร์ส) คุม palette และสไตล์ได้ 100%
- ทดสอบ iPad: GitHub Pages
- Render: สูง 480px, กว้างตามสัดส่วนจอ (640–768), ขยายแบบ nearest-neighbor
- ที่นั่ง: ล้อมรอบ iPad — P1, P2 ฝั่งตรงข้าม (ขอบบน), P3, P4 ฝั่งใกล้ (ขอบล่าง); UI ของแต่ละคนหมุนหันหาเจ้าของ, swipe คิดทิศจากมุมมองผู้เล่น

## ยังต้องตัดสินใจ (ใน Visual Prototype)

- ความละเอียดสุดท้าย (480 vs 360) — ตามความคมของ Pixel บน iPad จริง
- ฟอนต์ Pixel ที่รองรับภาษาไทย (ตอนนี้ใช้ฟอนต์ระบบชั่วคราว)

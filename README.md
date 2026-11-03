# CLASSROOM 5/8 PARTY

เกมปาร์ตี้ Pixel Art สำหรับ 4 คน บน iPad เครื่องเดียว — 50 มินิเกม, ห้องเรียน 5/8 เป็นศูนย์กลาง

**สถานะ:** Phase 0 (Audit & Setup) เสร็จ — รอข้อมูลห้องเรียนจากผู้ใช้ ดู [docs/ROADMAP.md](docs/ROADMAP.md)

## รันบนคอม

```bash
npm install
npm run dev      # เปิด http://localhost:5173 (และ IP ในวง Wi-Fi สำหรับ iPad)
npm run build    # ตรวจ type + build ไปที่ dist/
```

## ทดสอบบน iPad

1. เปิดลิงก์ GitHub Pages ใน Safari (หรือ IP จาก `npm run dev` ถ้าอยู่ Wi-Fi เดียวกัน)
2. หมุนเป็นแนวนอน → แตะหน้าจอ → เข้า **Multi-touch Test**
3. ให้ 4 คนแตะ/ลาก/ปัดในมุมของตัวเองพร้อมกัน แล้วตรวจ:
   - `fingers` ของแต่ละคนถูกต้อง, `max` ขึ้นถึง 4+
   - ลากนิ้วข้ามไปโซนคนอื่น จุดยังเป็นสีเดิม
   - หน้าเว็บไม่เลื่อน ไม่ซูม ไม่เลือกข้อความ
   - ปล่อยนิ้วแล้ว `fingers` กลับเป็น 0
4. แนะนำ: Share → **Add to Home Screen** เพื่อเล่นเต็มจอ
5. แนะนำ: เปิด **Guided Access** (Settings → Accessibility → Guided Access, กดปุ่มข้าง 3 ครั้ง) — กันนิ้วที่ขอบจอไปปัดออกจากแอป / เปิด Control Center ระหว่างเล่น (เว็บปิด gesture ของระบบเองไม่ได้)

ที่นั่ง: นั่งล้อมรอบ iPad — P1 🔴 / P2 🔵 ฝั่งตรงข้าม, P3 🟢 / P4 🟡 ฝั่งใกล้ ข้อความในโซนหมุนหาเจ้าของ

## เอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phase และสถานะงาน |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Engine, โครงสร้างโค้ด, Input |
| [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) | สไตล์ภาพ, Palette, กฎ Asset |
| [docs/MINIGAMES.md](docs/MINIGAMES.md) | ตารางสถานะ 50 มินิเกม |
| [reference/README.md](reference/README.md) | ข้อมูลที่ต้องส่งมา (รูปห้อง, ผังที่นั่ง, รายชื่อ) |

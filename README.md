# CLASSROOM 5/8 PARTY

เกมปาร์ตี้ Pixel Art สำหรับเพื่อน 4 คน นั่งล้อม iPad เครื่องเดียว · **50/50 มินิเกมเล่นได้** · ห้องเรียน 5/8 จากรูปจริง · ตัวละครเพื่อน 11 คน

- **Play:** Party (3/5/7/10/กำหนดเอง รอบ, 10/7/5/3 แต้ม) · Quick Play · Minigame Collection (Free play / Practice) · Characters (แก้ไขตัวละครได้) · Settings · Credits
- **Tech:** Phaser 3.90 · TypeScript · Vite · ภาพและเสียงสร้างด้วยโค้ดทั้งหมด · เล่น offline ได้ · Add to Home Screen ได้

สถานะงาน: [docs/ROADMAP.md](docs/ROADMAP.md) · ตารางเกม: [docs/MINIGAMES.md](docs/MINIGAMES.md) · QA: [docs/QA_REPORT.md](docs/QA_REPORT.md)

## เปิดบน iPad

1. เปิดลิงก์ GitHub Pages ใน Safari: `https://btxnefjfvudv-spec.github.io/ClaudeTest/`
   (ต้องเปิด Pages ครั้งแรก: GitHub → Settings → Pages → Source = **GitHub Actions**, และ Settings → Environments → github-pages → อนุญาต branch `classroom-58-party`)
2. หมุนเป็นแนวนอน · แตะเพื่อเริ่ม (เปิดเสียง)
3. Share → **Add to Home Screen** → เล่นเต็มจอ + ใช้ได้แม้ไม่มีเน็ต (หลังเปิดครั้งแรก)
4. แนะนำ **Guided Access** (Settings → Accessibility → Guided Access, กดปุ่มข้าง 3 ครั้ง) กันนิ้วปัดขอบจอออกจากเกม

## ที่นั่ง

นั่งล้อมรอบ iPad: **P1 แดง / P2 น้ำเงิน** ฝั่งตรงข้าม (ขอบบน), **P3 เขียว / P4 เหลือง** ฝั่งใกล้ (ขอบล่าง). ข้อความและปุ่มของแต่ละคนหันหาเจ้าของ. ที่นั่งว่างใช้ CPU (ปิดได้ใน Settings).

## ทดสอบบนคอม

```bash
npm install
npm run dev          # http://localhost:5173 และ IP ในวง Wi-Fi สำหรับ iPad
npm run build        # type check + build → dist/
```

| URL | ใช้ทำอะไร |
|---|---|
| `/?game=<id>` | เปิดมินิเกมตรงๆ (id ดูใน `src/minigames/catalog.ts`) |
| `/?auto&fast` | ข้ามหน้าแตะเริ่ม / intro (สำหรับทดสอบอัตโนมัติ) |
| เมนู → `touch test` | ทดสอบ multi-touch 4 คน |

ทดสอบอัตโนมัติ (ทุกเกม, iPad emulation, สุ่มแตะ 4 นิ้ว): `npx vite --port 5199 & node tools/smoke.cjs http://localhost:5199/`

> การทดสอบอัตโนมัติไม่แทนการเล่นบน iPad จริง — ดู checklist ใน [docs/QA_REPORT.md](docs/QA_REPORT.md)

## เอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| [docs/GDD.md](docs/GDD.md) | Game Design Document — กติกาทั้ง 50 เกม |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | โครงสร้างโค้ด, render, input |
| [docs/MINIGAME_DEV_GUIDE.md](docs/MINIGAME_DEV_GUIDE.md) | วิธีสร้างมินิเกมให้ได้มาตรฐานเดียวกัน |
| [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) · [docs/ASSETS.md](docs/ASSETS.md) | สไตล์ภาพ, pipeline, กฎ asset |
| [reference/README.md](reference/README.md) | ข้อมูลที่ต้องส่งมา (รูปห้อง, ผังที่นั่ง, รายชื่อ, รูปเพื่อน) |

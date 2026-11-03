# QA Report

## Real iPad

| Date | Build | Tester | Result |
|---|---|---|---|
| 2026-11-03 | 50b1541 (8 games) | ผู้ใช้ | เปิดได้ เล่นได้ดี — ยังไม่ได้ทดสอบละเอียด |

### Checklist to run on the iPad (per game)

- [ ] 4 คนแตะพร้อมกันได้ ไม่มี input หาย / แย่งกัน
- [ ] ลากนิ้วข้ามโซนแล้วไม่ค้าง
- [ ] หน้าเว็บไม่เลื่อน / ไม่ซูม
- [ ] เสียงดังหลังแตะครั้งแรก
- [ ] ลื่น ไม่กระตุก (60 fps)
- [ ] กติกาเข้าใจใน 10 วินาที
- [ ] คะแนน / อันดับถูก
- [ ] Pause → เล่นต่อ / เริ่มใหม่ / ออก ใช้ได้
- [ ] สลับแอปแล้วกลับมา เกมหยุดรอ

## Automated (headless iPad Pro 11 emulation, random 4-finger input)

See `node tools/smoke.cjs` — results are recorded per batch in `docs/CHECKPOINTS.md`.

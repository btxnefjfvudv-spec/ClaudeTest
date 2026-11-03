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

- **Smoke test, all 50 games: 50/50 PASS** — each game starts, plays with 1 random-touch human + 3 CPUs, ends with valid ranked results, no console errors. Per-game status: `docs/MINIGAMES.md`.
- **Party flow:** 5-round party (roulette → game → results ×5 → winner ceremony) completes with correct totals, no errors.
- **Restart** (pause → เริ่มใหม่) checked per game by the builders; no errors.
- **Visual review:** mid-play screenshots of all 50 games reviewed (contact sheets).
- **Not verifiable here:** real 60 fps, real multi-touch feel, audio on iPad Safari — needs the real-iPad checklist above.

Status meaning: all 50 games are **Implemented**; none is **Playtested/Verified** until played on a real iPad by real players.

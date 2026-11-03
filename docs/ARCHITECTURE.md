# Architecture

## Stack

- **Phaser 3.90** — WebGL renderer, scene system, tween, particle, Web Audio; รองรับ touch หลายนิ้วด้วย `input.activePointers`
- **TypeScript (strict)** + **Vite** — build เร็ว, deploy เป็น static ไฟล์ เล่น offline ได้
- เสียง: สังเคราะห์ด้วย Web Audio (ไม่ต้องมีไฟล์เสียง)

## โครงสร้าง

```
src/
  main.ts                 สร้างเกม, กัน gesture ของ Safari, ปรับขนาดตามจอ
  config.ts               ความละเอียด render, จำนวนนิ้วสูงสุด
  core/                   types กลาง (MinigameDefinition, PlayerResult, SeatEntry...), palette, EventBus
  systems/
    input/                MultiTouchManager — แบ่งนิ้วให้ผู้เล่น
    audio/                AudioManager — synth SFX, volume, Safari unlock
    (Phase 1)             players, characters, animation, vfx, score
  scenes/                 Boot, TouchTest (dev) — Phase 1: Menu, PlayerSelect, Intro, Results...
  minigames/  (Phase 3)   1 โฟลเดอร์ต่อ 1 เกม, implement MinigameDefinition
  data/       (Phase 2)   ผังที่นั่ง, ข้อมูลตัวละคร
```

## Multi-touch

- นิ้วแต่ละนิ้ว **เป็นของผู้เล่นที่โซนแรกที่แตะ** จนกว่าจะยกนิ้ว — ลากข้ามโซนไม่แย่ง input กัน
- โซนกำหนดเป็นสัดส่วนจอ (0..1) ใช้ได้ทุกขนาด iPad; มี preset `quadrants` (ค่าเริ่มต้น), `columns`, `halves` และกำหนดเองได้ต่อเกม
- Event: `down`, `move`, `up`, `tap`, `swipe`, `cancel`
- กันค้าง: touchcancel, ยกนิ้วนอกจอ, แอปไปพื้นหลัง (blur/hidden) และ failsafe ทุกเฟรม → ปล่อยนิ้วอัตโนมัติ
- หน้าเว็บ: `touch-action: none`, block pinch / double-tap zoom / scroll / text selection / callout

## Lifecycle (เป้าหมาย)

BOOT → MAIN MENU → PLAYER SELECT → MODE SELECT → MINIGAME INTRO → COUNTDOWN → GAMEPLAY → GAME END → RESULTS → NEXT GAME → FINAL RESULTS

## Minigame contract

ดู `MinigameDefinition` ใน `src/core/types.ts` — ทุกเกมต้องคืน `PlayerResult[]` (rank + score + team) ให้ Party system คิดคะแนน 10/7/5/3

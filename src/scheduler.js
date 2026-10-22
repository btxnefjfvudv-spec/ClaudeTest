// ตรวจความพร้อมล่วงหน้าก่อนเวลาเปิด (ไม่ได้ส่งคำขอถี่ ๆ แค่ 2 ครั้ง)
export const PRECHECKS = Object.freeze([
  { key: 'T-10m', beforeMs: 10 * 60 * 1000 },
  { key: 'T-2m', beforeMs: 2 * 60 * 1000 },
]);

/**
 * ตัดสินใจว่าตอนนี้ควรทำอะไร (ฟังก์ชันบริสุทธิ์ ทดสอบได้)
 * ก่อนเวลาเปิด: ไม่ส่งคำขอ ยกเว้นตรวจความพร้อม 2 ครั้ง
 * ถึงเวลาแล้ว: โหลดหน้าใหม่ทุก intervalMs จนกว่าจะเปิด หรือครบ maxPolls
 */
export function decideNext({ now, openAt, prechecksDone = [], polls = 0, lastPollAt = null, intervalMs, maxPolls }) {
  if (openAt == null) return { action: 'stop', reason: 'ยังไม่ได้ตั้งวันและเวลาเปิดลงทะเบียน' };
  if (now < openAt) {
    // ใช้รอบตรวจที่ใกล้เวลาเปิดที่สุดที่ถึงกำหนดแล้ว รอบก่อนหน้าที่เลยไปแล้วไม่ต้องทำซ้ำ
    const due = [...PRECHECKS].sort((a, b) => a.beforeMs - b.beforeMs).find((p) => now >= openAt - p.beforeMs);
    if (due && !prechecksDone.includes(due.key)) {
      const covers = PRECHECKS.filter((p) => p.beforeMs >= due.beforeMs).map((p) => p.key);
      return { action: 'precheck', key: due.key, covers };
    }
    return { action: 'wait', untilMs: openAt - now };
  }
  if (polls >= maxPolls) return { action: 'stop', reason: `ตรวจครบ ${maxPolls} ครั้งแล้วแต่ระบบยังไม่เปิด จึงหยุดเพื่อไม่ส่งคำขอมากเกินไป` };
  if (lastPollAt == null || now - lastPollAt >= intervalMs) return { action: 'poll' };
  return { action: 'wait', untilMs: intervalMs - (now - lastPollAt) };
}

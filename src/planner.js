import { CourseState, Status } from './status.js';
import { CONFIRMED_KINDS, MatchKind, matchCourse, normalizeCode } from './matcher.js';

// จัดประเภทช่อง "เลือก sec" ของแต่ละวิชาจากข้อความ/ปุ่มที่อ่านได้
export function classifyCourse(row, profile) {
  const text = row.actionText || '';
  if (profile.notOpenText && text.includes(profile.notOpenText)) return CourseState.NOT_OPEN;
  if ((profile.fullTextPatterns || []).some((p) => p && text.includes(p))) return CourseState.FULL;
  if ((row.controls || []).some((c) => !c.disabled)) return CourseState.OPEN;
  return CourseState.UNKNOWN;
}

/**
 * แปลงข้อมูลที่อ่านจากหน้าเว็บเป็นข้อมูลที่ใช้ตัดสินใจ
 * kind: register | profile | login | other
 */
export function analyzeSnapshot(snap, profile) {
  const loggedIn = !!snap.hasLogout;
  let kind = 'other';
  if (!loggedIn) kind = 'login';
  else if (snap.courseTable) kind = 'register';
  else if (snap.registeredTable) kind = 'profile';

  const courses = (snap.courseTable?.rows || []).map((r) => ({ ...r, state: classifyCourse(r, profile) }));
  const registered = snap.registeredTable
    ? { codes: snap.registeredTable.rows.map((r) => r.code), rows: snap.registeredTable.rows, empty: snap.registeredTable.empty }
    : null;
  const failureText = (profile.failureTextPatterns || []).find((p) => p && (snap.text || '').includes(p)) || null;

  return {
    kind,
    loggedIn,
    url: snap.url,
    courseTableFound: !!snap.courseTable,
    courses,
    registered,
    failureText,
  };
}

/**
 * สร้างแผนการลงทะเบียนจากรายการวิชาที่ผู้ใช้ต้องการ (เรียงตามความสำคัญ) กับรายการบนเว็บ
 * - เลือกเฉพาะวิชาที่จับคู่ได้แน่นอนและยังเปิดรับ
 * - วิชาสำรองจะถูกใช้เมื่อผู้ใช้อนุญาตไว้ล่วงหน้า (autoUseBackup) หรือกดอนุมัติ (backupsApproved)
 * - ไม่เลือกวิชาเดียวกันซ้ำ และไม่เลือกวิชาที่หน้าโปรไฟล์แสดงว่าลงไว้แล้ว (enrolledCodes)
 */
export function buildPlan({ settings, page, backupsApproved = false, enrolledCodes = new Set() }) {
  const required = settings.requiredCount;
  const items = [];

  if (!page.loggedIn) {
    return { status: Status.LOGIN_REQUIRED, message: 'ยังไม่ได้เข้าสู่ระบบ หรือเซสชันหมดอายุ', items, selected: [], suggestions: [] };
  }
  if (!page.courseTableFound) {
    return { status: Status.UNKNOWN, message: 'ไม่พบตาราง "ข้อมูลรายวิชาสำหรับลงทะเบียนเรียน" ในหน้านี้', items, selected: [], suggestions: [] };
  }
  if (!settings.courses.length) {
    return {
      status: Status.READY,
      message: `เข้าสู่ระบบแล้ว พบรายวิชาบนเว็บ ${page.courses.length} วิชา — ยังไม่ได้เลือกวิชาที่ต้องการ`,
      items,
      selected: [],
      suggestions: [],
    };
  }

  const taken = new Set();
  settings.courses.forEach((wanted, index) => {
    const m = matchCourse(wanted, page.courses);
    const item = {
      priority: index + 1,
      role: wanted.role,
      wanted,
      match: m.kind,
      course: m.course,
      candidates: m.candidates.map((c) => ({ seq: c.seq, code: c.code, name: c.name })),
      state: null,
      selected: false,
      note: '',
    };
    if (CONFIRMED_KINDS.has(m.kind)) {
      const key = `${normalizeCode(m.course.code)}#${m.course.seq}`;
      if (taken.has(key)) {
        item.state = 'DUPLICATE';
        item.note = 'ชี้ไปที่วิชาเดียวกับรายการก่อนหน้า จะไม่เลือกซ้ำ';
      } else {
        taken.add(key);
        item.state = enrolledCodes.has(normalizeCode(m.course.code)) ? 'ENROLLED' : m.course.state;
        if (item.state === 'ENROLLED') item.note = 'หน้าโปรไฟล์แสดงว่าลงทะเบียนวิชานี้แล้ว';
      }
    } else {
      item.state = m.kind === MatchKind.NOT_FOUND ? 'NOT_FOUND' : 'NEEDS_REVIEW';
      item.note = {
        [MatchKind.NOT_FOUND]: 'ไม่พบวิชานี้บนเว็บ',
        [MatchKind.SIMILAR_ONLY]: 'ไม่พบที่ตรงกันพอดี มีแต่วิชาที่คล้ายกัน — จะไม่เลือกให้เอง',
        [MatchKind.AMBIGUOUS]: 'พบหลายแถวที่ตรงกัน ให้ระบุ "ลำดับ" ของแถวที่ต้องการ',
        [MatchKind.CODE_NAME_MISMATCH]: 'รหัสตรงแต่ชื่อวิชาไม่ตรง — ตรวจสอบก่อน จะไม่เลือกให้เอง',
      }[m.kind];
    }
    items.push(item);
  });

  const open = (i) => i.state === CourseState.OPEN;
  const mains = items.filter((i) => i.role === 'main');
  const backups = items.filter((i) => i.role === 'backup');
  const enrolled = items.filter((i) => i.state === 'ENROLLED');
  const need = Math.max(0, required - enrolled.length);
  const selected = [];
  for (const i of mains) if (open(i) && selected.length < need) selected.push(i);

  const useBackups = settings.autoUseBackup || backupsApproved;
  const suggestions = [];
  for (const i of backups) {
    if (!open(i) || selected.length >= need) continue;
    if (useBackups) selected.push(i);
    else suggestions.push(i);
  }
  selected.forEach((i) => {
    i.selected = true;
  });

  const describe = (list) => list.map((i) => i.course?.code || i.wanted.code || i.wanted.name).join(', ');
  const base = { items, selected: selected.map((i) => i.course.code), suggestions: suggestions.map((i) => i.course.code) };

  if (enrolled.length >= required) {
    return { ...base, status: Status.SUCCESS, message: `หน้าโปรไฟล์ของเว็บแสดงว่าลงทะเบียนแล้ว: ${describe(enrolled)}` };
  }
  if (selected.length >= need) {
    const usedBackup = selected.some((i) => i.role === 'backup');
    return {
      ...base,
      status: Status.COURSE_AVAILABLE,
      message: `พบวิชาที่เปิดรับ: ${describe(selected)}${usedBackup ? ' (มีวิชาสำรองตามที่ตั้งไว้)' : ''}`,
    };
  }
  const relevant = useBackups ? items : mains;
  if (relevant.some((i) => i.state === CourseState.NOT_OPEN)) {
    return { ...base, status: Status.WAITING, message: 'ระบบยังไม่เปิดให้เลือก ("ไม่ถึงเวลาเลือก")' };
  }
  if (items.some((i) => i.state === CourseState.FULL)) {
    const full = items.filter((i) => i.state === CourseState.FULL);
    const extra = suggestions.length ? ` — วิชาสำรองที่ยังเปิดรับ: ${describe(suggestions)} (กด "ใช้วิชาสำรอง" เพื่ออนุมัติ)` : '';
    return { ...base, status: Status.COURSE_FULL, message: `วิชาเต็ม: ${describe(full)}${extra}` };
  }
  if (suggestions.length) {
    return {
      ...base,
      status: Status.COURSE_FULL,
      message: `วิชาหลักเลือกไม่ได้ — วิชาสำรองที่ยังเปิดรับ: ${describe(suggestions)} (กด "ใช้วิชาสำรอง" เพื่ออนุมัติ)`,
    };
  }
  const notFound = items.filter((i) => i.state === 'NOT_FOUND' || i.state === 'NEEDS_REVIEW');
  if (notFound.length) {
    return { ...base, status: Status.FAILED, message: `เลือกวิชาไม่ได้: ${notFound.map((i) => `${i.wanted.code || i.wanted.name} (${i.note})`).join('; ')}` };
  }
  return { ...base, status: Status.UNKNOWN, message: 'อ่านสถานะวิชาจากหน้าเว็บไม่ได้ชัดเจน — ตรวจสอบในเบราว์เซอร์' };
}

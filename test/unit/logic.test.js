import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact } from '../../src/logger.js';
import { MatchKind, matchCourse, normalizeCode } from '../../src/matcher.js';
import { analyzeSnapshot, buildPlan } from '../../src/planner.js';
import { decideNext } from '../../src/scheduler.js';
import { validateSettings } from '../../src/settings.js';
import { Status } from '../../src/status.js';
import { profile } from '../helpers.js';

const site = [
  { seq: '503', code: 'ง32210', name: 'เบเกอรี่' },
  { seq: '505', code: 'ง32224', name: 'การปลูกไม้ดอก' },
  { seq: '513', code: 'ศ32262', name: 'ทักษะดนตรีตะวันตก' },
  { seq: '515', code: 'ศ32273', name: 'ดนตรีไทย' },
];

describe('จับคู่รายวิชา', () => {
  it('จับคู่ด้วยรหัสวิชา แม้พิมพ์เว้นวรรคหรือใช้เลขไทย', () => {
    assert.equal(normalizeCode(' ง ๓๒๒๑๐ '), 'ง32210');
    const m = matchCourse({ code: 'ง ๓๒๒๑๐' }, site);
    assert.equal(m.kind, MatchKind.EXACT_CODE);
    assert.equal(m.course.seq, '503');
  });

  it('ไม่มีรหัส ใช้ชื่อที่ตรงกันพอดี', () => {
    const m = matchCourse({ name: '  ดนตรีไทย ' }, site);
    assert.equal(m.kind, MatchKind.EXACT_NAME);
    assert.equal(m.course.code, 'ศ32273');
  });

  it('ชื่อใกล้เคียงไม่ถูกเลือกอัตโนมัติ', () => {
    const m = matchCourse({ name: 'ดนตรีตะวันตก' }, site);
    assert.equal(m.kind, MatchKind.SIMILAR_ONLY);
    assert.equal(m.course, null);
    assert.ok(m.candidates.some((c) => c.code === 'ศ32262'));
  });

  it('รหัสตรงแต่ชื่อไม่ตรง ต้องให้ผู้ใช้ตรวจ', () => {
    const m = matchCourse({ code: 'ง32210', name: 'การปลูกไม้ดอก' }, site);
    assert.equal(m.kind, MatchKind.CODE_NAME_MISMATCH);
    assert.equal(m.course, null);
  });

  it('รหัสซ้ำหลายแถว ต้องระบุลำดับ', () => {
    const dup = [...site, { seq: '520', code: 'ง32210', name: 'เบเกอรี่' }];
    assert.equal(matchCourse({ code: 'ง32210' }, dup).kind, MatchKind.AMBIGUOUS);
    assert.equal(matchCourse({ code: 'ง32210', seq: '520' }, dup).course.seq, '520');
  });

  it('ไม่พบวิชา', () => {
    assert.equal(matchCourse({ code: 'ค99999' }, site).kind, MatchKind.NOT_FOUND);
  });
});

describe('ตรวจการตั้งค่า', () => {
  it('กันวิชาซ้ำ', () => {
    const { errors } = validateSettings({ courses: [{ code: 'ง32210' }, { code: 'ง 32210' }] });
    assert.ok(errors.some((e) => e.includes('ซ้ำ')));
  });

  it('ไม่ยอมให้ตรวจซ้ำถี่กว่า 5 วินาที', () => {
    const { errors, settings } = validateSettings({ pollIntervalSec: 1 });
    assert.ok(errors.some((e) => e.includes('5')));
    assert.equal(settings.pollIntervalSec, 5);
  });

  it('ปรับ URL ให้เป็นโฟลเดอร์ของเว็บ', () => {
    const { settings, errors } = validateSettings({ siteUrl: 'https://myzma68.com/rw_enrollment/_site/index.php?sop=profile_student' });
    assert.deepEqual(errors, []);
    assert.equal(settings.siteUrl, 'https://myzma68.com/rw_enrollment/_site/');
  });

  it('ต้องใส่รหัสหรือชื่อ และจำนวนวิชาต้องพอ', () => {
    const { errors } = validateSettings({ requiredCount: 3, courses: [{ role: 'main' }, { code: 'ง32210' }] });
    assert.ok(errors.some((e) => e.includes('อย่างน้อยหนึ่งอย่าง')));
    assert.ok(errors.some((e) => e.includes('ต้องลง 3 วิชา')));
  });
});

describe('ล็อกไม่เก็บข้อมูลลับ', () => {
  it('ลบเลขบัตรประชาชน คุกกี้ และรหัสผ่าน', () => {
    const out = redact('id 3999999999991 / 3-9999-99999-99-1 cookie=abc123 PHPSESSID=xyz password: hunter2');
    assert.ok(!out.includes('3999999999991'));
    assert.ok(!out.includes('99999-99'));
    assert.ok(!out.includes('abc123'));
    assert.ok(!out.includes('xyz'));
    assert.ok(!out.includes('hunter2'));
  });
});

describe('ตัวตั้งเวลา', () => {
  const openAt = 1_000_000_000;
  const base = { openAt, intervalMs: 10_000, maxPolls: 3 };

  it('ก่อนเวลาเปิดไม่ส่งคำขอ ยกเว้นตรวจความพร้อม', () => {
    assert.equal(decideNext({ ...base, now: openAt - 3_600_000 }).action, 'wait');
    const d = decideNext({ ...base, now: openAt - 9 * 60_000 });
    assert.deepEqual([d.action, d.key], ['precheck', 'T-10m']);
    assert.equal(decideNext({ ...base, now: openAt - 9 * 60_000, prechecksDone: ['T-10m'] }).action, 'wait');
  });

  it('เริ่มช้ากว่า 2 นาทีก่อนเปิด ตรวจความพร้อมครั้งเดียว', () => {
    const d = decideNext({ ...base, now: openAt - 60_000 });
    assert.equal(d.key, 'T-2m');
    assert.deepEqual(d.covers.sort(), ['T-10m', 'T-2m']);
  });

  it('ถึงเวลาแล้วตรวจตามช่วงเวลา และหยุดเมื่อครบจำนวน', () => {
    assert.equal(decideNext({ ...base, now: openAt }).action, 'poll');
    assert.equal(decideNext({ ...base, now: openAt + 5000, polls: 1, lastPollAt: openAt }).action, 'wait');
    assert.equal(decideNext({ ...base, now: openAt + 10_000, polls: 1, lastPollAt: openAt }).action, 'poll');
    assert.equal(decideNext({ ...base, now: openAt + 60_000, polls: 3, lastPollAt: openAt }).action, 'stop');
  });
});

describe('วางแผนการลงทะเบียน', () => {
  const page = (states) =>
    analyzeSnapshot(
      {
        url: 'https://x/index.php?sop=std_register_course',
        hasLogout: true,
        text: '',
        courseTable: {
          headers: [],
          rows: site.map((c) => {
            const st = states[c.code] || 'closed';
            return {
              ...c,
              credit: '1.0',
              actionText: st === 'closed' ? 'ไม่ถึงเวลาเลือก' : st === 'full' ? 'เต็ม' : 'sec 1',
              controls: st === 'open' ? [{ id: `${c.code}#0`, tag: 'a', type: 'a', text: 'sec 1', disabled: false }] : [],
            };
          }),
        },
      },
      profile,
    );
  const settings = (over = {}) =>
    validateSettings({
      requiredCount: 1,
      courses: [
        { code: 'ง32210', role: 'main' },
        { code: 'ศ32273', role: 'backup' },
      ],
      ...over,
    }).settings;

  it('ยังไม่เปิด = WAITING', () => {
    assert.equal(buildPlan({ settings: settings(), page: page({}) }).status, Status.WAITING);
  });

  it('เปิดแล้ว = COURSE_AVAILABLE เลือกวิชาหลัก', () => {
    const plan = buildPlan({ settings: settings(), page: page({ 'ง32210': 'open', 'ศ32273': 'open' }) });
    assert.equal(plan.status, Status.COURSE_AVAILABLE);
    assert.deepEqual(plan.selected, ['ง32210']);
  });

  it('วิชาหลักเต็ม เสนอวิชาสำรองแต่ไม่เลือกเอง', () => {
    const plan = buildPlan({ settings: settings(), page: page({ 'ง32210': 'full', 'ศ32273': 'open' }) });
    assert.equal(plan.status, Status.COURSE_FULL);
    assert.deepEqual(plan.selected, []);
    assert.deepEqual(plan.suggestions, ['ศ32273']);
  });

  it('ใช้วิชาสำรองเมื่ออนุญาตไว้ล่วงหน้าหรือกดอนุมัติ', () => {
    const p = page({ 'ง32210': 'full', 'ศ32273': 'open' });
    assert.deepEqual(buildPlan({ settings: settings({ autoUseBackup: true }), page: p }).selected, ['ศ32273']);
    assert.deepEqual(buildPlan({ settings: settings(), page: p, backupsApproved: true }).selected, ['ศ32273']);
  });

  it('ไม่พบวิชา = FAILED พร้อมเหตุผล', () => {
    const plan = buildPlan({ settings: settings({ courses: [{ code: 'ค99999' }] }), page: page({}) });
    assert.equal(plan.status, Status.FAILED);
    assert.match(plan.message, /ค99999/);
  });

  it('ไม่เลือกวิชาเดียวกันซ้ำ', () => {
    const plan = buildPlan({
      settings: settings({ requiredCount: 2, courses: [{ code: 'ง32210' }, { name: 'เบเกอรี่' }] }),
      page: page({ 'ง32210': 'open' }),
    });
    assert.deepEqual(plan.selected, ['ง32210']);
    assert.equal(plan.items[1].state, 'DUPLICATE');
  });

  it('วิชาที่หน้าโปรไฟล์บอกว่าลงแล้ว นับเป็นสำเร็จและไม่เลือกซ้ำ', () => {
    const plan = buildPlan({ settings: settings(), page: page({ 'ง32210': 'open' }), enrolledCodes: new Set(['ง32210']) });
    assert.equal(plan.status, Status.SUCCESS);
    assert.deepEqual(plan.selected, []);
  });

  it('ยังไม่เข้าสู่ระบบ = LOGIN_REQUIRED', () => {
    const p = analyzeSnapshot({ url: 'https://x/', hasLogout: false, text: '', courseTable: null }, profile);
    assert.equal(buildPlan({ settings: settings(), page: p }).status, Status.LOGIN_REQUIRED);
  });
});

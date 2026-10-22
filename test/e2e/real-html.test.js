import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { chromium } from 'playwright';
import { extractPage } from '../../src/extract.js';
import { analyzeSnapshot, buildPlan } from '../../src/planner.js';
import { validateSettings } from '../../src/settings.js';
import { CourseState, Status } from '../../src/status.js';
import { fixture, profile } from '../helpers.js';

// ทดสอบตัวอ่านหน้าเว็บกับโครงสร้าง HTML ของเว็บจริง (หน้า std_register_course ก่อนเปิดระบบ)
describe('อ่านหน้าลงทะเบียนจริง (ก่อนเปิดระบบ)', () => {
  let browser;
  let page;

  before(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.setContent(fixture('register-closed.html'));
  });
  after(() => browser?.close());

  it('พบตารางวิชา 9 วิชา และทุกวิชา "ไม่ถึงเวลาเลือก"', async () => {
    const snap = await page.evaluate(extractPage, profile);
    const res = analyzeSnapshot(snap, profile);
    assert.equal(res.kind, 'register');
    assert.equal(res.loggedIn, true);
    assert.equal(res.courses.length, 9);
    assert.deepEqual(res.courses[0], {
      seq: '503',
      code: 'ง32210',
      name: 'เบเกอรี่',
      credit: '1.0',
      actionText: 'ไม่ถึงเวลาเลือก',
      controls: [],
      state: CourseState.NOT_OPEN,
    });
    assert.ok(res.courses.every((c) => c.state === CourseState.NOT_OPEN));
    assert.equal(res.courses[5].name, 'ภาษาเวียดนามเพื่อการสื่อสาร 2');
  });

  it('วางแผนได้สถานะ WAITING', async () => {
    const snap = await page.evaluate(extractPage, profile);
    const settings = validateSettings({ courses: [{ code: 'ศ32273', name: 'ดนตรีไทย' }] }).settings;
    const plan = buildPlan({ settings, page: analyzeSnapshot(snap, profile) });
    assert.equal(plan.status, Status.WAITING);
  });
});

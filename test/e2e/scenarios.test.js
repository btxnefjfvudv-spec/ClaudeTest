import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { Status } from '../../src/status.js';
import { setup, waitFor } from '../helpers.js';

const COURSES = [
  { code: 'ง32210', name: 'เบเกอรี่', role: 'main' },
  { code: 'ศ32273', name: 'ดนตรีไทย', role: 'backup' },
];

describe('สถานการณ์ใช้งานกับเว็บจำลอง', () => {
  let t;
  afterEach(async () => {
    await t?.close();
    t = null;
  });

  async function ready(opts = {}) {
    t = await setup({ settings: { courses: COURSES, ...(opts.settings || {}) }, ...opts });
    await t.assistant.openBrowser();
    await t.login();
    return t;
  }

  it('1. เว็บไซต์ยังไม่เปิดลงทะเบียน → WAITING', async () => {
    await ready();
    assert.equal(await t.assistant.checkNow(), Status.WAITING);
    assert.equal(t.assistant.state.siteCourses.length, 9);
  });

  it('2. ผู้ใช้ยังไม่ได้เข้าสู่ระบบ → LOGIN_REQUIRED', async () => {
    t = await setup({ settings: { courses: COURSES } });
    assert.equal(await t.assistant.openBrowser(), Status.LOGIN_REQUIRED);
    assert.equal(await t.assistant.checkNow(), Status.LOGIN_REQUIRED);
  });

  it('3. พบวิชาที่ต้องการ → COURSE_AVAILABLE แล้วรอผู้ใช้ยืนยัน', async () => {
    await ready();
    t.site.state.open = true;
    assert.equal(await t.assistant.checkNow(), Status.CONFIRMATION_REQUIRED);
    assert.equal(t.assistant.state.plan.status, Status.COURSE_AVAILABLE);
    assert.deepEqual(t.assistant.state.plan.selected, ['ง32210']);
    assert.equal(t.site.state.submits, 0, 'ต้องยังไม่ส่งอะไรจนกว่าผู้ใช้ยืนยัน');
  });

  it('4. วิชาที่ต้องการเต็ม → COURSE_FULL เสนอวิชาสำรอง ไม่เปลี่ยนเอง', async () => {
    await ready();
    t.site.state.open = true;
    t.site.state.full.add('ง32210');
    assert.equal(await t.assistant.checkNow(), Status.COURSE_FULL);
    assert.deepEqual(t.assistant.state.plan.suggestions, ['ศ32273']);
    assert.deepEqual(t.assistant.state.plan.selected, []);
    t.assistant.approveBackups();
    assert.equal(t.assistant.state.status, Status.CONFIRMATION_REQUIRED);
    assert.deepEqual(t.assistant.state.plan.selected, ['ศ32273']);
  });

  it('5. ไม่พบวิชาที่ต้องการ → FAILED พร้อมเหตุผล', async () => {
    await ready({ settings: { courses: [{ code: 'ค99999', name: 'ไม่มีจริง' }] } });
    t.site.state.open = true;
    assert.equal(await t.assistant.checkNow(), Status.FAILED);
    assert.match(t.assistant.state.message, /ไม่พบวิชานี้บนเว็บ/);
  });

  it('6. เว็บไซต์โหลดช้า: รอได้ภายในเวลาที่กำหนด และแจ้งชัดเจนเมื่อช้าเกิน', async () => {
    await ready({ navTimeoutMs: 1500 });
    t.site.state.delayMs = 600;
    assert.equal(await t.assistant.checkNow(), Status.WAITING);
    t.site.state.delayMs = 3000;
    assert.equal(await t.assistant.checkNow(), Status.FAILED);
    assert.match(t.assistant.state.message, /โหลดช้า/);
  });

  it('7. เซสชันหมดอายุระหว่างลงทะเบียน → LOGIN_REQUIRED', async () => {
    await ready();
    t.site.state.open = true;
    await t.assistant.checkNow();
    t.site.state.sessions.clear();
    await t.clickAndAnswer('ง32210');
    assert.equal(t.assistant.state.status, Status.LOGIN_REQUIRED);
    assert.match(t.assistant.state.message, /เซสชันหมดอายุ/);
    assert.equal(t.site.state.enrolled.size, 0);
  });

  it('8. กดส่งแล้วไม่ได้รับคำยืนยัน → UNKNOWN ไม่ใช่ SUCCESS', async () => {
    await ready();
    t.site.state.open = true;
    t.site.state.noConfirm = true;
    await t.assistant.checkNow();
    await t.clickAndAnswer('ง32210');
    assert.equal(t.assistant.state.status, Status.UNKNOWN);
    await t.assistant.verify();
    assert.equal(t.assistant.state.status, Status.UNKNOWN);
    assert.match(t.assistant.state.message, /ยังไม่ถือว่าสำเร็จ/);
  });

  it('9. ผู้ใช้กดดำเนินการซ้ำ → ส่งไปที่เว็บแค่ครั้งเดียว', async () => {
    await ready();
    t.site.state.open = true;
    t.site.state.noConfirm = true;
    await t.assistant.checkNow();
    const control = t.assistant.lastRegisterPage.courses.find((c) => c.code === 'ง32210').controls[0];
    t.assistant.clickControl({ code: 'ง32210', controlId: control.id });
    assert.throws(() => t.assistant.clickControl({ code: 'ง32210', controlId: control.id }), /ไปแล้ว|กำลัง/);
    const dialog = await waitFor(() => t.assistant.state.pendingDialog, { label: 'dialog' });
    await t.assistant.respondDialog(dialog.id, true);
    await t.assistant.running;
    assert.throws(() => t.assistant.clickControl({ code: 'ง32210', controlId: control.id }), /ตรวจผล/);
    assert.equal(t.site.state.submits, 1);
  });

  it('10. ลงทะเบียนสำเร็จและมีหลักฐานยืนยันจากเว็บ → SUCCESS', async () => {
    await ready();
    t.site.state.open = true;
    await t.assistant.checkNow();
    await t.clickAndAnswer('ง32210');
    assert.equal(t.assistant.state.status, Status.SUCCESS);
    const v = await t.assistant.verify();
    assert.equal(t.assistant.state.status, Status.SUCCESS);
    assert.ok(v.registered.some((r) => r.code === 'ง32210'));
    assert.ok(fs.existsSync(path.join(t.dir, v.evidence)), 'ต้องมีภาพหน้าจอเป็นหลักฐาน');
    assert.equal(t.site.state.submits, 1);
  });

  it('ผู้ใช้กด "ยกเลิก" ในหน้าต่างยืนยันของเว็บ → ไม่มีการลงทะเบียน', async () => {
    await ready();
    t.site.state.open = true;
    await t.assistant.checkNow();
    await t.clickAndAnswer('ง32210', false);
    assert.equal(t.site.state.submits, 0);
    assert.notEqual(t.assistant.state.status, Status.SUCCESS);
  });

  it('เว็บแจ้งว่าวิชาเต็มหลังกด → FAILED', async () => {
    await ready();
    t.site.state.open = true;
    await t.assistant.checkNow();
    t.site.state.full.add('ง32210');
    await t.clickAndAnswer('ง32210');
    assert.equal(t.assistant.state.status, Status.FAILED);
    assert.ok(t.assistant.state.webMessages.some((m) => m.message.includes('วิชาเต็ม')));
  });

  it('ส่งคำขอถี่เกินไปจะถูกปฏิเสธ', async () => {
    await ready({ minNavGapMs: 3000 });
    await assert.rejects(t.assistant.checkNow(), /รออีก/);
  });

  it('เฝ้ารอ: ไม่ส่งคำขอก่อนเวลา แล้วตรวจซ้ำจนระบบเปิด', async () => {
    await ready({ pollIntervalMsOverride: 300 });
    const openAt = Date.now() + 1500;
    t.assistant.saveSettings({ ...t.assistant.settings, openTime: new Date(openAt).toISOString() });
    let requests = 0;
    t.assistant.browser.page.on('request', (r) => r.isNavigationRequest() && requests++);
    t.assistant.startWatch();
    // ช่วงก่อนเปิดมีแค่การตรวจความพร้อม 1 ครั้ง (T-2m)
    await waitFor(() => t.assistant.state.watch.prechecksDone.length > 0, { label: 'precheck' });
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(requests, 1);
    await waitFor(() => t.assistant.state.watch.polls >= 2, { label: 'polls' });
    assert.equal(t.assistant.state.status, Status.WAITING);
    t.site.state.open = true;
    await waitFor(() => !t.assistant.state.watch.running, { label: 'watch stop' });
    assert.equal(t.assistant.state.status, Status.CONFIRMATION_REQUIRED);
    assert.equal(t.site.state.submits, 0);
  });
});

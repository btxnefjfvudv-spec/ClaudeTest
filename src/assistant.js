import fs from 'node:fs';
import path from 'node:path';
import { BrowserSession, NavigationError } from './browser.js';
import { redact } from './logger.js';
import { normalizeCode, normalizeName } from './matcher.js';
import { analyzeSnapshot, buildPlan } from './planner.js';
import { decideNext } from './scheduler.js';
import { CourseState, STATUS_LABEL_TH, Status, UserError } from './status.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// แสดง URL แบบไม่มีพารามิเตอร์อื่นนอกจาก sop (กันข้อมูลลับหลุดลงล็อก/หน้าจอ)
export function displayUrl(raw) {
  try {
    const u = new URL(raw);
    const sop = u.searchParams.get('sop');
    return `${u.origin}${u.pathname}${sop ? `?sop=${sop}` : ''}`;
  } catch {
    return '';
  }
}

/**
 * ตัวควบคุมหลัก: เก็บสถานะ ตัดสินใจ และสั่งเบราว์เซอร์
 * กติกาสำคัญ
 * - ทำงานกับเบราว์เซอร์ทีละอย่าง (busy lock)
 * - โหลดหน้าเว็บห่างกันอย่างน้อย minNavGapMs
 * - กดลงทะเบียนแต่ละวิชาได้ครั้งเดียว ต้อง "ตรวจผล" ก่อนจึงกดใหม่ได้
 * - SUCCESS มาจากตาราง "ข้อมูลรายวิชาที่ลงทะเบียน" บนเว็บเท่านั้น
 */
export class Assistant {
  constructor({
    settingsStore,
    profile,
    logger,
    dataDir,
    browserOptions = {},
    browserFactory = (opts) => new BrowserSession(opts),
    minNavGapMs = 3000,
    tickMs = 500,
    pollIntervalMsOverride = null,
    now = () => Date.now(),
  }) {
    this.store = settingsStore;
    this.profile = profile;
    this.logger = logger;
    this.dataDir = dataDir;
    this.browserOptions = browserOptions;
    this.browserFactory = browserFactory;
    this.minNavGapMs = minNavGapMs;
    this.tickMs = tickMs;
    this.pollIntervalMsOverride = pollIntervalMsOverride;
    this.now = now;

    this.browser = null;
    this.lastNavAt = -Infinity;
    this.timer = null;
    this.ticking = false;
    this.dialogs = new Map();
    this.dialogSeq = 0;
    this.clickDialogs = null;
    this.lastRegisterPage = null;
    this.enrolledCodes = new Set();
    this.attempts = {};
    this.lastNavFailed = false;
    this.everLoggedIn = false;

    this.state = {
      status: Status.UNKNOWN,
      message: 'ยังไม่ได้เปิดเบราว์เซอร์',
      statusAt: new Date(this.now()).toISOString(),
      loggedIn: null,
      pageKind: null,
      pageUrl: null,
      serverOffsetMs: null,
      siteCourses: [],
      plan: null,
      backupsApproved: false,
      watch: { running: false, polls: 0, lastPollAt: null, prechecksDone: [], note: '' },
      pendingDialog: null,
      webMessages: [],
      verification: null,
      alertSeq: 0,
      alertText: '',
      busy: null,
    };
  }

  get settings() {
    return this.store.get();
  }

  serverNow() {
    return this.now() + (this.state.serverOffsetMs ?? 0);
  }

  #setStatus(status, message, level = 'info') {
    const changed = status !== this.state.status || message !== this.state.message;
    this.state.status = status;
    this.state.message = message;
    this.state.statusAt = new Date(this.now()).toISOString();
    if (changed) this.logger.log(level, message, status);
  }

  #alert(text) {
    this.state.alertSeq += 1;
    this.state.alertText = text;
  }

  #url(p) {
    return new URL(p, this.settings.siteUrl).toString();
  }

  #gate() {
    const wait = this.lastNavAt + this.minNavGapMs - this.now();
    if (wait > 0) {
      throw new UserError(`เพิ่งโหลดหน้าเว็บไป รออีก ${Math.ceil(wait / 1000)} วินาที (ป้องกันการส่งคำขอถี่เกินไป)`);
    }
    this.lastNavAt = this.now();
  }

  #canNavigate() {
    return this.lastNavAt + this.minNavGapMs <= this.now();
  }

  async #exclusive(label, fn) {
    if (this.state.busy) throw new UserError(`กำลัง${this.state.busy}อยู่ รอสักครู่`);
    this.state.busy = label;
    try {
      return await fn();
    } finally {
      this.state.busy = null;
    }
  }

  #requireBrowser() {
    if (!this.browser?.isOpen()) throw new UserError('ยังไม่ได้เปิดเบราว์เซอร์ — กด "เปิดเบราว์เซอร์" ก่อน');
  }

  // ---------- เบราว์เซอร์ ----------

  async openBrowser() {
    return this.#exclusive('เปิดเบราว์เซอร์', async () => {
      if (!this.browser) {
        this.browser = this.browserFactory({
          profileDir: path.join(this.dataDir, '.browser-profile'),
          channel: this.settings.browserChannel,
          onDialog: (d) => this.#onDialog(d),
          onServerDate: (server, local) => this.#onServerDate(server, local),
          onLoad: () => this.#observe(),
          onClosed: () => {
            this.logger.warn('เบราว์เซอร์ถูกปิด');
            this.#setStatus(Status.UNKNOWN, 'เบราว์เซอร์ถูกปิด — กด "เปิดเบราว์เซอร์" อีกครั้ง', 'warn');
          },
          ...this.browserOptions,
        });
      }
      if (!this.browser.isOpen() && !this.browserOptions.channel) this.browser.channel = this.settings.browserChannel;
      await this.browser.open();
      this.logger.info(`เปิดเบราว์เซอร์แล้ว (${this.browser.usedChannel})`);
      await this.#loadRegister('เปิดหน้าลงทะเบียน');
      if (this.state.status === Status.LOGIN_REQUIRED) {
        // พาไปหน้าแรกของเว็บ ให้ผู้ใช้เข้าสู่ระบบเอง
        this.lastNavAt = -Infinity;
        this.#gate();
        await this.browser.goto(this.settings.siteUrl).catch(() => {});
        this.#setStatus(
          Status.LOGIN_REQUIRED,
          'กรุณาเข้าสู่ระบบในหน้าต่างเบราว์เซอร์ที่เปิดขึ้นมา (พิมพ์เองในเว็บโรงเรียน) แล้วกด "ตรวจสถานะตอนนี้"',
        );
      }
      return this.state.status;
    });
  }

  async closeBrowser() {
    this.stopWatch('ปิดเบราว์เซอร์');
    if (this.browser) await this.browser.close();
  }

  #onServerDate(serverMs, localMs) {
    if (!Number.isFinite(serverMs)) return;
    // ส่วนหัว Date ละเอียดแค่ระดับวินาที จึงบวกครึ่งวินาทีเป็นค่ากลาง
    const offset = serverMs + 500 - localMs;
    const prev = this.state.serverOffsetMs;
    this.state.serverOffsetMs = offset;
    if (prev === null && Math.abs(offset) > 2000) {
      this.logger.warn(`นาฬิกาเครื่องนี้ต่างจากเว็บโรงเรียนประมาณ ${Math.round(offset / 1000)} วินาที — โปรแกรมจะยึดเวลาของเว็บ`);
    }
  }

  #onDialog(dialog) {
    const type = dialog.type();
    const message = redact(dialog.message());
    this.clickDialogs?.push(message);
    if (type === 'alert') {
      // alert มีแค่ปุ่มตกลง จึงกดตกลงให้และเก็บข้อความไว้แสดง
      this.#webMessage(message);
      dialog.accept().catch(() => {});
      return;
    }
    const id = ++this.dialogSeq;
    this.dialogs.set(id, dialog);
    const info = { id, type, message, at: new Date(this.now()).toISOString() };
    if (!this.state.pendingDialog) this.state.pendingDialog = info;
    this.logger.info(`เว็บไซต์ถามยืนยัน: "${message}" — รอผู้ใช้ตอบที่หน้าควบคุม`);
    this.#alert(`เว็บไซต์ถาม: ${message}`);
  }

  #webMessage(message) {
    this.state.webMessages.push({ at: new Date(this.now()).toISOString(), message });
    this.state.webMessages = this.state.webMessages.slice(-10);
    this.logger.info(`ข้อความจากเว็บไซต์: "${message}"`);
    this.#alert(`ข้อความจากเว็บ: ${message}`);
  }

  respondDialog(id, accept) {
    const dialog = this.dialogs.get(Number(id));
    if (!dialog) throw new UserError('ไม่พบหน้าต่างยืนยันนี้แล้ว');
    this.dialogs.delete(Number(id));
    const next = [...this.dialogs.entries()][0];
    this.state.pendingDialog = next
      ? { id: next[0], type: next[1].type(), message: redact(next[1].message()), at: new Date(this.now()).toISOString() }
      : null;
    this.logger.info(`ผู้ใช้ตอบหน้าต่างของเว็บ: ${accept ? 'ตกลง' : 'ยกเลิก'}`);
    return accept ? dialog.accept() : dialog.dismiss();
  }

  // ---------- อ่านหน้าเว็บ ----------

  async #snapshot() {
    const snap = await this.browser.snapshot(this.profile);
    const page = analyzeSnapshot(snap, this.profile);
    this.state.loggedIn = page.loggedIn;
    if (page.loggedIn) this.everLoggedIn = true;
    this.state.pageKind = page.kind;
    this.state.pageUrl = displayUrl(page.url);
    return page;
  }

  async #observe() {
    // ผู้ใช้เปลี่ยนหน้าเองในเบราว์เซอร์: อ่านหน้าใหม่โดยไม่ส่งคำขอเพิ่ม
    if (this.state.busy || this.state.pendingDialog || !this.browser?.isOpen()) return;
    try {
      const page = await this.#snapshot();
      this.#absorb(page, { passive: true });
    } catch {
      // หน้าเว็บอาจกำลังเปลี่ยน ไม่เป็นไร
    }
  }

  #absorb(page, { passive = false } = {}) {
    if (page.kind === 'login') {
      if (this.state.status !== Status.LOGIN_REQUIRED) {
        const expired = this.everLoggedIn;
        this.#setStatus(
          Status.LOGIN_REQUIRED,
          expired ? 'เซสชันหมดอายุหรือถูกออกจากระบบ — เข้าสู่ระบบใหม่ในเบราว์เซอร์' : 'ต้องเข้าสู่ระบบก่อน',
          'warn',
        );
        this.#alert('ต้องเข้าสู่ระบบ');
      }
      return;
    }
    if (page.kind === 'profile' && page.registered) {
      this.#recordEnrolled(page.registered.rows);
      if (this.lastRegisterPage) this.#applyPlan(this.lastRegisterPage, { passive });
      return;
    }
    if (page.kind === 'register') {
      this.lastRegisterPage = page;
      this.state.siteCourses = page.courses.map(({ seq, code, name, credit, actionText, state }) => ({
        seq,
        code,
        name,
        credit,
        actionText,
        state,
      }));
      this.#applyPlan(page, { passive });
    }
  }

  #recordEnrolled(rows) {
    this.enrolledCodes = new Set(rows.map((r) => normalizeCode(r.code)));
    // อัปเดตแผนให้รู้ว่าวิชาไหนลงแล้ว (ไม่เปลี่ยนสถานะหลัก)
    if (this.lastRegisterPage) {
      this.state.plan = buildPlan({
        settings: this.settings,
        page: this.lastRegisterPage,
        backupsApproved: this.state.backupsApproved,
        enrolledCodes: this.enrolledCodes,
      });
    }
  }

  #applyPlan(page, { passive = false } = {}) {
    const plan = buildPlan({
      settings: this.settings,
      page,
      backupsApproved: this.state.backupsApproved,
      enrolledCodes: this.enrolledCodes,
    });
    this.state.plan = plan;
    if (passive && this.state.status === Status.SUCCESS && plan.status !== Status.SUCCESS) return;

    if (plan.status === Status.COURSE_AVAILABLE) {
      const pending = plan.selected.filter((code) => !this.attempts[code]);
      if (pending.length) {
        const prev = this.state.status;
        this.#setStatus(
          Status.CONFIRMATION_REQUIRED,
          `${plan.message} — ตรวจรายการแล้วกดยืนยันที่หน้าควบคุม หรือกดในเบราว์เซอร์เอง`,
        );
        if (prev !== Status.CONFIRMATION_REQUIRED) this.#alert('ระบบเปิดแล้ว! พบวิชาที่ต้องการ');
        this.browser?.highlight(pending);
      } else {
        this.#setStatus(Status.UNKNOWN, 'กดลงทะเบียนครบแล้ว — กด "ตรวจผล" เพื่อดูหลักฐานจากหน้าเว็บ');
      }
      return;
    }
    const prev = this.state.status;
    this.#setStatus(plan.status, plan.message, plan.status === Status.FAILED ? 'warn' : 'info');
    if (prev !== plan.status && [Status.COURSE_FULL, Status.FAILED, Status.SUCCESS].includes(plan.status)) {
      this.#alert(plan.message);
    }
  }

  async #loadRegister(reason) {
    this.#requireBrowser();
    this.#gate();
    this.logger.info(`${reason}: โหลดหน้าลงทะเบียน`);
    try {
      await this.browser.goto(this.#url(this.profile.registerPath));
      const page = await this.#snapshot();
      this.lastNavFailed = false;
    this.everLoggedIn = false;
      this.#absorb(page);
    } catch (err) {
      if (err instanceof NavigationError) {
        this.lastNavFailed = err.kind !== 'CLOSED';
        this.#setStatus(err.kind === 'CLOSED' ? Status.UNKNOWN : Status.FAILED, err.message, 'warn');
      } else {
        throw err;
      }
    }
    return this.state.status;
  }

  async checkNow({ reason = 'ตรวจสถานะ' } = {}) {
    return this.#exclusive('ตรวจสถานะ', () => this.#loadRegister(reason));
  }

  approveBackups() {
    this.state.backupsApproved = true;
    this.logger.info('ผู้ใช้อนุมัติให้ใช้วิชาสำรอง');
    if (this.lastRegisterPage) this.#applyPlan(this.lastRegisterPage);
    return this.state.plan;
  }

  saveSettings(input) {
    const res = this.store.save(input);
    if (!res.ok) return res;
    this.logger.info('บันทึกการตั้งค่าแล้ว');
    this.state.backupsApproved = false;
    if (this.lastRegisterPage) this.#applyPlan(this.lastRegisterPage);
    return res;
  }

  // ---------- เฝ้ารอเวลาเปิด ----------

  #intervalMs() {
    return this.pollIntervalMsOverride ?? this.settings.pollIntervalSec * 1000;
  }

  startWatch() {
    this.#requireBrowser();
    const s = this.settings;
    if (!s.openTime) throw new UserError('ยังไม่ได้ตั้งวันและเวลาเปิดลงทะเบียน');
    if (!s.courses.length) throw new UserError('ยังไม่ได้เลือกวิชาที่ต้องการ');
    this.state.watch = { running: true, polls: 0, lastPollAt: null, prechecksDone: [], note: 'เริ่มเฝ้ารอ' };
    clearInterval(this.timer);
    this.timer = setInterval(() => this.#tick(), this.tickMs);
    this.logger.info(`เริ่มเฝ้ารอเวลาเปิด ${new Date(s.openTime).toLocaleString('th-TH')} (ตรวจซ้ำทุก ${Math.round(this.#intervalMs() / 1000)} วินาที สูงสุด ${s.maxPolls} ครั้ง)`);
  }

  stopWatch(reason = 'ผู้ใช้สั่งหยุด') {
    if (!this.state.watch.running) return;
    clearInterval(this.timer);
    this.timer = null;
    this.state.watch.running = false;
    this.state.watch.note = reason;
    this.logger.info(`หยุดเฝ้ารอ: ${reason}`);
  }

  async #tick() {
    if (this.ticking || this.state.busy || this.state.pendingDialog || !this.state.watch.running) return;
    this.ticking = true;
    try {
      const w = this.state.watch;
      const s = this.settings;
      const d = decideNext({
        now: this.serverNow(),
        openAt: s.openTime ? Date.parse(s.openTime) : null,
        prechecksDone: w.prechecksDone,
        polls: w.polls,
        lastPollAt: w.lastPollAt,
        intervalMs: this.#intervalMs(),
        maxPolls: s.maxPolls,
      });
      if (d.action === 'wait') {
        w.note = this.serverNow() < Date.parse(s.openTime) ? 'รอถึงเวลาเปิด (ยังไม่ส่งคำขอ)' : 'รอรอบตรวจถัดไป';
        return;
      }
      if (d.action === 'stop') {
        this.stopWatch(d.reason);
        this.#alert(d.reason);
        return;
      }
      if (!this.browser?.isOpen()) {
        this.stopWatch('เบราว์เซอร์ถูกปิด');
        return;
      }
      if (!this.#canNavigate()) return;
      if (d.action === 'precheck') {
        w.prechecksDone.push(...d.covers);
        const status = await this.checkNow({ reason: `ตรวจความพร้อมก่อนเวลาเปิด (${d.key})` });
        if (status === Status.LOGIN_REQUIRED) this.#alert('ใกล้ถึงเวลาเปิดแล้ว แต่ยังไม่ได้เข้าสู่ระบบ!');
        return;
      }
      // poll
      w.polls += 1;
      w.lastPollAt = this.serverNow();
      const status = await this.checkNow({ reason: `ถึงเวลาเปิดแล้ว ตรวจครั้งที่ ${w.polls}` });
      const keepPolling =
        status === Status.WAITING || status === Status.LOGIN_REQUIRED || (status === Status.FAILED && this.lastNavFailed);
      if (!keepPolling) this.stopWatch(`ได้ผลแล้ว: ${STATUS_LABEL_TH[status]}`);
    } catch (err) {
      if (!(err instanceof UserError)) this.logger.error(`เฝ้ารอผิดพลาด: ${err.message}`);
    } finally {
      this.ticking = false;
    }
  }

  // ---------- ลงทะเบียน ----------

  clickControl({ code, controlId, selectValue }) {
    this.#requireBrowser();
    if (!this.settings.assistedClick) throw new UserError('ปิดการให้โปรแกรมกดแทนไว้ในการตั้งค่า — กดในเบราว์เซอร์เอง');
    const plan = this.state.plan;
    if (!plan || plan.status !== Status.COURSE_AVAILABLE) {
      throw new UserError('ยังไม่มีรายการที่พร้อมลงทะเบียน — กด "ตรวจสถานะตอนนี้" ก่อน');
    }
    if (!plan.selected.includes(code)) throw new UserError(`วิชา ${code} ไม่ได้อยู่ในรายการที่เลือกไว้`);
    if (this.attempts[code]) {
      throw new UserError(`กดลงทะเบียนวิชา ${code} ไปแล้ว — กด "ตรวจผล" ก่อน ถ้ายังไม่สำเร็จจึงจะกดใหม่ได้`);
    }
    if (this.state.busy) throw new UserError(`กำลัง${this.state.busy}อยู่ รอสักครู่`);
    this.state.busy = 'ลงทะเบียน';
    this.attempts[code] = { at: new Date(this.now()).toISOString(), controlId, outcome: 'PENDING', failure: null };
    this.#setStatus(Status.UNKNOWN, `กำลังกดลงทะเบียนวิชา ${code} บนเว็บ (1 ครั้ง)...`);
    this.running = this.#doClick(code, controlId, selectValue).finally(() => {
      this.state.busy = null;
      this.clickDialogs = null;
    });
    return { started: true };
  }

  async #doClick(code, controlId, selectValue) {
    const attempt = this.attempts[code];
    try {
      const before = await this.#snapshot();
      const row = before.courses.find((c) => c.code === code);
      const control = row?.controls.find((c) => c.id === controlId);
      if (before.kind !== 'register' || !row || !control || control.disabled) {
        delete this.attempts[code];
        this.#setStatus(Status.FAILED, `ไม่พบปุ่มของวิชา ${code} บนหน้าเว็บแล้ว — กด "ตรวจสถานะตอนนี้" ใหม่`, 'warn');
        return;
      }
      if (row.state !== CourseState.OPEN) {
        delete this.attempts[code];
        this.#setStatus(row.state === CourseState.FULL ? Status.COURSE_FULL : Status.FAILED, `วิชา ${code} ไม่ได้เปิดรับแล้ว (${row.actionText})`, 'warn');
        return;
      }
      this.clickDialogs = [];
      this.logger.info(`กด "${control.text}" ของวิชา ${code}`);
      await this.browser.click(controlId, { selectValue });
      await sleep(500);
      await this.browser.waitSettled();
      const after = await this.#snapshot();
      const messages = this.clickDialogs || [];
      const failure =
        (this.profile.failureTextPatterns || []).find((p) => messages.some((m) => m.includes(p))) ||
        (after.kind !== 'register' ? after.failureText : null) ||
        (after.courses.find((c) => c.code === code)?.state === CourseState.FULL ? 'เต็ม' : null);

      if (after.kind === 'login') {
        attempt.outcome = 'SESSION_EXPIRED';
        this.#setStatus(Status.LOGIN_REQUIRED, 'เซสชันหมดอายุระหว่างลงทะเบียน — เข้าสู่ระบบใหม่ แล้วกด "ตรวจผล"', 'warn');
        this.#alert('เซสชันหมดอายุ');
        return;
      }
      if (after.kind === 'profile' && after.registered) {
        this.#recordEnrolled(after.registered.rows);
        if (this.enrolledCodes.has(normalizeCode(code))) {
          attempt.outcome = 'ENROLLED';
          await this.#saveEvidence('after-click');
          this.#setStatus(Status.SUCCESS, `เว็บไซต์แสดงวิชา ${code} ในรายการที่ลงทะเบียนแล้ว`);
          this.#alert(`ลงทะเบียน ${code} สำเร็จ (มีหลักฐานจากเว็บ)`);
          return;
        }
      }
      if (failure) {
        attempt.outcome = 'FAILED';
        attempt.failure = failure;
        this.#setStatus(Status.FAILED, `เว็บไซต์แจ้งว่าไม่สำเร็จ (พบคำว่า "${failure}") — กด "ตรวจผล" เพื่อยืนยัน`, 'warn');
        this.#alert('ลงทะเบียนไม่สำเร็จ');
        return;
      }
      attempt.outcome = 'CLICKED';
      this.#setStatus(
        Status.UNKNOWN,
        `กดวิชา ${code} แล้ว แต่ยังไม่มีหลักฐานว่าสำเร็จ — ถ้าเว็บมีขั้นตอนต่อ ให้ทำในเบราว์เซอร์ จากนั้นกด "ตรวจผล"`,
      );
    } catch (err) {
      attempt.outcome = 'ERROR';
      const msg = err instanceof NavigationError ? err.message : `กดไม่สำเร็จ: ${String(err.message).split('\n')[0]}`;
      this.#setStatus(Status.FAILED, `${msg} — ยังไม่รู้ว่าเว็บรับคำขอหรือไม่ ให้กด "ตรวจผล"`, 'warn');
    }
  }

  async verify() {
    return this.#exclusive('ตรวจผล', async () => {
      this.#requireBrowser();
      this.#gate();
      try {
        await this.browser.goto(this.#url(this.profile.profilePath));
        const page = await this.#snapshot();
        if (!page.loggedIn) {
          this.#setStatus(Status.LOGIN_REQUIRED, 'ตรวจผลไม่ได้เพราะยังไม่ได้เข้าสู่ระบบ — เข้าสู่ระบบแล้วกด "ตรวจผล" อีกครั้ง', 'warn');
          return this.state.verification;
        }
        if (!page.registered) {
          this.#setStatus(Status.UNKNOWN, 'ไม่พบตาราง "ข้อมูลรายวิชาที่ลงทะเบียน" — ตรวจด้วยตาในเบราว์เซอร์', 'warn');
          return this.state.verification;
        }
        this.#recordEnrolled(page.registered.rows);
        const evidence = await this.#saveEvidence('verify');

        const regNames = new Set(page.registered.rows.map((r) => normalizeName(r.name)));
        const isEnrolled = (w) =>
          w.code ? this.enrolledCodes.has(normalizeCode(w.code)) : regNames.has(normalizeName(w.name));
        const wanted = this.settings.courses.map((w) => ({
          code: w.code,
          name: w.name,
          role: w.role,
          enrolled: isEnrolled(w),
        }));
        for (const [code, a] of Object.entries(this.attempts)) {
          a.outcome = this.enrolledCodes.has(normalizeCode(code)) ? 'ENROLLED' : 'NOT_ENROLLED';
        }
        const okCount = wanted.filter((w) => w.enrolled).length;
        this.state.verification = {
          at: new Date(this.now()).toISOString(),
          registered: page.registered.rows,
          wanted,
          evidence,
        };
        const required = this.settings.requiredCount;
        if (okCount >= required) {
          const list = wanted.filter((w) => w.enrolled).map((w) => w.code || w.name).join(', ');
          this.#setStatus(Status.SUCCESS, `เว็บไซต์แสดงว่าลงทะเบียนแล้ว: ${list} (หลักฐาน: ${evidence || 'ตารางในหน้าโปรไฟล์'})`);
          this.#alert('ลงทะเบียนสำเร็จ (มีหลักฐานจากเว็บ)');
        } else {
          const failed = Object.values(this.attempts).some((a) => a.failure);
          const msg = `หน้าเว็บยังไม่แสดงวิชาที่ต้องการครบ (${okCount}/${required}) — ยังไม่ถือว่าสำเร็จ`;
          this.#setStatus(failed ? Status.FAILED : Status.UNKNOWN, msg, 'warn');
          this.#alert(msg);
        }
        // วิชาที่ตรวจแล้วยังไม่ติด ปลดล็อกให้กดใหม่ได้
        for (const [code, a] of Object.entries(this.attempts)) if (a.outcome === 'NOT_ENROLLED') delete this.attempts[code];
        return this.state.verification;
      } catch (err) {
        if (err instanceof NavigationError) {
          this.#setStatus(Status.FAILED, `ตรวจผลไม่ได้: ${err.message}`, 'warn');
          return this.state.verification;
        }
        throw err;
      }
    });
  }

  async #saveEvidence(kind) {
    try {
      const dir = path.join(this.dataDir, 'evidence');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${kind}-${stamp()}.png`);
      await this.browser.screenshot(file);
      this.logger.info(`บันทึกภาพหน้าจอเป็นหลักฐาน: evidence/${path.basename(file)}`);
      return `evidence/${path.basename(file)}`;
    } catch (err) {
      this.logger.warn(`บันทึกภาพหลักฐานไม่ได้: ${err.message}`);
      return null;
    }
  }

  async captureStructure() {
    return this.#exclusive('บันทึกโครงสร้างหน้าเว็บ', async () => {
      this.#requireBrowser();
      const html = await this.browser.html();
      const dir = path.join(this.dataDir, 'captures');
      fs.mkdirSync(dir, { recursive: true });
      const sop = (() => {
        try {
          return new URL(this.browser.currentUrl()).searchParams.get('sop') || 'page';
        } catch {
          return 'page';
        }
      })().replace(/[^\w-]/g, '');
      const file = path.join(dir, `${sop}-${stamp()}.html`);
      fs.writeFileSync(file, html);
      this.logger.info(`บันทึกโครงสร้างหน้าเว็บ (ลบค่าในช่องกรอกแล้ว): captures/${path.basename(file)}`);
      return `captures/${path.basename(file)}`;
    });
  }

  // ---------- ข้อมูลสำหรับหน้าควบคุม ----------

  publicState() {
    const s = this.state;
    const controlsByCode = new Map((this.lastRegisterPage?.courses || []).map((c) => [c.code, c.controls]));
    return {
      status: s.status,
      statusLabel: STATUS_LABEL_TH[s.status],
      message: s.message,
      statusAt: s.statusAt,
      busy: s.busy,
      settings: this.settings,
      unverified: this.profile._unverified || [],
      browser: { open: !!this.browser?.isOpen(), channel: this.browser?.usedChannel || null },
      loggedIn: s.loggedIn,
      pageKind: s.pageKind,
      pageUrl: s.pageUrl,
      localNow: this.now(),
      serverOffsetMs: s.serverOffsetMs,
      watch: s.watch,
      siteCourses: s.siteCourses,
      plan: s.plan && {
        status: s.plan.status,
        message: s.plan.message,
        selected: s.plan.selected,
        suggestions: s.plan.suggestions,
        items: s.plan.items.map((i) => ({
          priority: i.priority,
          role: i.role,
          wanted: i.wanted,
          match: i.match,
          state: i.state,
          selected: i.selected,
          note: i.note,
          candidates: i.candidates,
          course: i.course && {
            seq: i.course.seq,
            code: i.course.code,
            name: i.course.name,
            actionText: i.course.actionText,
            controls: controlsByCode.get(i.course.code) || [],
          },
          attempt: i.course ? this.attempts[i.course.code] || null : null,
        })),
      },
      backupsApproved: s.backupsApproved,
      pendingDialog: s.pendingDialog,
      webMessages: s.webMessages,
      verification: s.verification,
      alertSeq: s.alertSeq,
      alertText: s.alertText,
      log: this.logger.recent(80),
    };
  }
}

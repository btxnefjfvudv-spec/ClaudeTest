'use strict';

const $ = (id) => document.getElementById(id);

// สร้าง element โดยไม่ใช้ innerHTML (ข้อความจากเว็บโรงเรียนจะไม่ถูกตีความเป็น HTML)
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const STATE_TH = {
  OPEN: ['เปิดรับ', 'ok'],
  NOT_OPEN: ['ไม่ถึงเวลาเลือก', ''],
  FULL: ['เต็ม', 'bad'],
  UNKNOWN: ['อ่านไม่ออก', 'warn'],
  NOT_FOUND: ['ไม่พบบนเว็บ', 'bad'],
  NEEDS_REVIEW: ['ต้องตรวจสอบ', 'warn'],
  DUPLICATE: ['ซ้ำ', 'warn'],
  ENROLLED: ['ลงแล้ว', 'ok'],
};
const ATTEMPT_TH = {
  PENDING: 'กำลังกด...',
  CLICKED: 'กดแล้ว รอตรวจผล',
  ENROLLED: 'สำเร็จ (มีหลักฐาน)',
  FAILED: 'เว็บแจ้งไม่สำเร็จ',
  SESSION_EXPIRED: 'เซสชันหมดอายุ',
  ERROR: 'ผิดพลาด รอตรวจผล',
  NOT_ENROLLED: 'ยังไม่ติด',
};

let state = null;
let lastAlertSeq = null;
let formLoaded = false;
let formDirty = false;
let courses = [];
let pendingConfirm = null;

async function api(path, body) {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ผิดพลาด (${res.status})`);
  return data;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = !text;
}

async function action(fn) {
  try {
    toast('');
    await fn();
  } catch (err) {
    toast(err.message);
  } finally {
    refresh();
  }
}

// ---------- เวลา ----------

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtTime(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDateTime(iso) {
  if (!iso) return 'ยังไม่ตั้ง';
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' });
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function serverNow() {
  return Date.now() + (state?.serverOffsetMs ?? 0);
}

function tickClock() {
  $('clock').textContent = fmtTime(serverNow());
  if (!state) return;
  const off = state.serverOffsetMs;
  $('offset').textContent =
    off === null ? 'ยังไม่ได้เทียบเวลากับเว็บ' : Math.abs(off) < 1500 ? 'ตรงกับนาฬิกาเครื่องนี้' : `ต่างจากเครื่องนี้ ${Math.round(off / 1000)} วินาที`;
  const open = state.settings.openTime ? Date.parse(state.settings.openTime) : null;
  if (!open) {
    $('countdown').textContent = '-';
    return;
  }
  let diff = Math.round((open - serverNow()) / 1000);
  if (diff <= 0) {
    $('countdown').textContent = 'ถึงเวลาแล้ว';
    return;
  }
  const d = Math.floor(diff / 86400);
  diff %= 86400;
  $('countdown').textContent = `${d ? `${d} วัน ` : ''}${pad(Math.floor(diff / 3600))}:${pad(Math.floor((diff % 3600) / 60))}:${pad(diff % 60)}`;
}

// ---------- แจ้งเตือน ----------

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.2;
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.15);
    });
  } catch {
    // เบราว์เซอร์บางตัวต้องคลิกหน้านี้ก่อนจึงจะเล่นเสียงได้
  }
}

function notify(text) {
  beep();
  toast(text);
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('ผู้ช่วยลงทะเบียน', { body: text });
    } catch {
      // ไม่เป็นไร
    }
  }
}

// ---------- แสดงผล ----------

function render() {
  const s = state;
  $('statusBadge').textContent = s.status;
  $('statusBadge').className = `badge ${s.status}`;
  $('statusLabel').textContent = s.statusLabel;
  $('statusMessage').textContent = s.message;
  $('busy').hidden = !s.busy;
  $('busy').textContent = s.busy ? `กำลัง${s.busy}...` : '';
  $('factBrowser').textContent = s.browser.open ? `เปิดอยู่ (${s.browser.channel})` : 'ปิดอยู่';
  $('factLogin').textContent = s.loggedIn === null ? '-' : s.loggedIn ? 'เข้าสู่ระบบแล้ว' : 'ยังไม่ได้เข้าสู่ระบบ';
  $('factPage').textContent = s.pageUrl ? s.pageUrl.replace(/^.*\?/, '') : '-';
  $('factOpen').textContent = fmtDateTime(s.settings.openTime);
  const w = s.watch;
  $('factWatch').textContent = w.running ? `กำลังเฝ้ารอ — ${w.note || ''}${w.polls ? ` (ตรวจแล้ว ${w.polls} ครั้ง)` : ''}` : w.note || 'ไม่ได้เฝ้ารอ';
  $('btnWatch').textContent = w.running ? '3. หยุดเฝ้ารอ' : '3. เริ่มเฝ้ารอเวลาเปิด';
  $('btnOpen').disabled = s.browser.open;

  renderPlan(s);
  renderVerification(s);
  renderSiteCourses(s);
  renderLog(s);
  renderDialog(s);
  if (!formLoaded) loadForm(s.settings);

  if (lastAlertSeq !== null && s.alertSeq > lastAlertSeq) notify(s.alertText);
  lastAlertSeq = s.alertSeq;
}

function renderPlan(s) {
  const body = $('planBody');
  body.replaceChildren();
  const plan = s.plan;
  $('planMessage').textContent = plan ? plan.message : 'ยังไม่ได้อ่านหน้าลงทะเบียน';
  $('btnBackups').hidden = !(plan && plan.suggestions.length && !s.backupsApproved && !s.settings.autoUseBackup);
  if (!plan) return;
  for (const item of plan.items) {
    const [label, cls] = STATE_TH[item.state] || [item.state, ''];
    const wanted = [item.wanted.code, item.wanted.name].filter(Boolean).join(' ');
    const site = item.course ? `${item.course.code} ${item.course.name}` : item.candidates.length ? `คล้าย: ${item.candidates.map((c) => `${c.code} ${c.name}`).join(', ')}` : '-';
    const actions = h('div', { class: 'row' });
    if (item.attempt) actions.append(h('span', { class: 'tag warn' }, ATTEMPT_TH[item.attempt.outcome] || item.attempt.outcome));
    if (item.selected && item.state === 'OPEN' && !item.attempt && s.settings.assistedClick) {
      for (const c of item.course.controls) {
        if (c.disabled) continue;
        actions.append(
          h('button', { class: 'btn go small', onclick: () => askConfirm(item, c) }, c.tag === 'select' ? 'เลือก sec...' : `ลงทะเบียน: "${c.text}"`),
        );
      }
    } else if (item.selected && item.state === 'OPEN' && !item.attempt) {
      actions.append(h('span', { class: 'muted small' }, 'กดในเบราว์เซอร์ (แถวที่ไฮไลต์สีส้ม)'));
    }
    body.append(
      h(
        'tr',
        { class: item.selected ? 'selected' : '' },
        h('td', {}, item.priority),
        h('td', {}, wanted),
        h('td', {}, item.role === 'backup' ? 'สำรอง' : 'หลัก'),
        h('td', {}, site, item.course?.actionText ? h('div', { class: 'muted small' }, `เลือก sec: ${item.course.actionText}`) : null),
        h('td', {}, h('span', { class: `tag ${cls}` }, label), item.selected ? h('span', { class: 'tag warn' }, 'จะลงทะเบียน') : null, item.note ? h('div', { class: 'muted small' }, item.note) : null),
        h('td', {}, actions),
      ),
    );
  }
}

function renderVerification(s) {
  const v = s.verification;
  $('verifyCard').hidden = !v;
  if (!v) return;
  $('verifyMeta').textContent = `ตรวจเมื่อ ${fmtDateTime(v.at)}${v.evidence ? ` — ภาพหลักฐาน: ${v.evidence}` : ''}`;
  const body = $('verifyBody');
  body.replaceChildren();
  if (!v.registered.length) body.append(h('tr', {}, h('td', { colspan: 3 }, 'เว็บไซต์แสดง "ไม่พบข้อมูลการลงทะเบียน"')));
  for (const r of v.registered) body.append(h('tr', {}, h('td', {}, r.code), h('td', {}, r.name), h('td', {}, r.section)));
}

function renderSiteCourses(s) {
  $('siteCount').textContent = s.siteCourses.length;
  const body = $('siteBody');
  body.replaceChildren();
  for (const c of s.siteCourses) {
    const add = (role) => () => {
      courses.push({ code: c.code, name: c.name, seq: '', role });
      formDirty = true;
      renderCourses();
    };
    body.append(
      h(
        'tr',
        {},
        h('td', {}, c.seq),
        h('td', {}, c.code),
        h('td', {}, c.name),
        h('td', {}, c.actionText),
        h('td', {}, h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: add('main') }, '+ หลัก'), h('button', { class: 'btn small', type: 'button', onclick: add('backup') }, '+ สำรอง'))),
      ),
    );
  }
}

function renderLog(s) {
  const log = $('log');
  log.replaceChildren(...s.log.slice().reverse().map((e) => h('li', { class: e.level }, `${fmtTime(Date.parse(e.at))} ${e.status ? `[${e.status}] ` : ''}${e.message}`)));
  $('webMessages').replaceChildren(...s.webMessages.slice().reverse().map((m) => h('li', {}, `${fmtTime(Date.parse(m.at))} — ${m.message}`)));
  $('unverified').replaceChildren(...s.unverified.map((u) => h('li', {}, u)));
}

function renderDialog(s) {
  const d = s.pendingDialog;
  $('dialogModal').hidden = !d;
  if (d) {
    $('dialogText').textContent = d.message;
    $('dialogModal').dataset.id = d.id;
  }
}

// ---------- ยืนยันก่อนให้โปรแกรมกด ----------

function askConfirm(item, control) {
  pendingConfirm = { code: item.course.code, controlId: control.id, isSelect: control.tag === 'select' };
  $('confirmText').textContent = `ลงทะเบียนวิชา ${item.course.code} ${item.course.name} — โปรแกรมจะ${control.tag === 'select' ? 'เลือกตัวเลือกที่คุณระบุ' : `กด "${control.text}"`} บนเว็บให้`;
  $('confirmSelectWrap').hidden = control.tag !== 'select';
  $('confirmSelect').replaceChildren(...(control.options || []).map((o) => h('option', { value: o.value }, o.text)));
  $('confirmModal').hidden = false;
}

$('confirmNo').addEventListener('click', () => {
  pendingConfirm = null;
  $('confirmModal').hidden = true;
});

$('confirmYes').addEventListener('click', () => {
  const p = pendingConfirm;
  pendingConfirm = null;
  $('confirmModal').hidden = true;
  if (!p) return;
  const body = { code: p.code, controlId: p.controlId };
  if (p.isSelect) body.selectValue = $('confirmSelect').value;
  action(() => api('/api/click', body));
});

$('dialogOk').addEventListener('click', () => action(() => api('/api/dialog', { id: Number($('dialogModal').dataset.id), accept: true })));
$('dialogCancel').addEventListener('click', () => action(() => api('/api/dialog', { id: Number($('dialogModal').dataset.id), accept: false })));

// ---------- ตั้งค่า ----------

function loadForm(s) {
  $('siteUrl').value = s.siteUrl;
  $('openTime').value = toLocalInput(s.openTime);
  $('requiredCount').value = s.requiredCount;
  $('pollIntervalSec').value = s.pollIntervalSec;
  $('maxPolls').value = s.maxPolls;
  $('browserChannel').value = s.browserChannel;
  $('autoUseBackup').checked = s.autoUseBackup;
  $('assistedClick').checked = s.assistedClick;
  courses = s.courses.map((c) => ({ ...c }));
  renderCourses();
  formLoaded = true;
  formDirty = false;
}

function renderCourses() {
  const body = $('coursesBody');
  body.replaceChildren();
  courses.forEach((c, i) => {
    const input = (key, placeholder) =>
      h('input', {
        value: c[key] || '',
        placeholder,
        oninput: (e) => {
          c[key] = e.target.value;
          formDirty = true;
        },
      });
    const role = h(
      'select',
      {
        onchange: (e) => {
          c.role = e.target.value;
          formDirty = true;
        },
      },
      h('option', { value: 'main', selected: c.role !== 'backup' }, 'หลัก'),
      h('option', { value: 'backup', selected: c.role === 'backup' }, 'สำรอง'),
    );
    const move = (d) => () => {
      const j = i + d;
      if (j < 0 || j >= courses.length) return;
      [courses[i], courses[j]] = [courses[j], courses[i]];
      formDirty = true;
      renderCourses();
    };
    body.append(
      h(
        'tr',
        {},
        h('td', {}, i + 1),
        h('td', {}, input('code', 'เช่น ง32210')),
        h('td', {}, input('name', 'เช่น เบเกอรี่')),
        h('td', {}, input('seq', '')),
        h('td', {}, role),
        h(
          'td',
          {},
          h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn small', type: 'button', title: 'เลื่อนขึ้น', onclick: move(-1) }, '↑'),
            h('button', { class: 'btn small', type: 'button', title: 'เลื่อนลง', onclick: move(1) }, '↓'),
            h(
              'button',
              {
                class: 'btn small danger',
                type: 'button',
                onclick: () => {
                  courses.splice(i, 1);
                  formDirty = true;
                  renderCourses();
                },
              },
              'ลบ',
            ),
          ),
        ),
      ),
    );
  });
  if (!courses.length) body.append(h('tr', {}, h('td', { colspan: 6, class: 'muted' }, 'ยังไม่มีวิชา — กด "+ เพิ่มวิชา" หรือเลือกจากรายวิชาที่อ่านได้จากเว็บ')));
}

$('btnAddCourse').addEventListener('click', () => {
  courses.push({ code: '', name: '', seq: '', role: 'main' });
  formDirty = true;
  renderCourses();
});

$('settingsForm').addEventListener('input', () => {
  formDirty = true;
});

$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const open = $('openTime').value;
  const settings = {
    siteUrl: $('siteUrl').value,
    openTime: open ? new Date(open).toISOString() : null,
    requiredCount: Number($('requiredCount').value),
    pollIntervalSec: Number($('pollIntervalSec').value),
    maxPolls: Number($('maxPolls').value),
    browserChannel: $('browserChannel').value,
    autoUseBackup: $('autoUseBackup').checked,
    assistedClick: $('assistedClick').checked,
    courses,
  };
  action(async () => {
    const res = await api('/api/settings', { settings });
    const errs = $('settingsErrors');
    errs.replaceChildren(...(res.errors || []).map((x) => h('li', {}, x)));
    if (res.ok) {
      formLoaded = false;
      toast('บันทึกการตั้งค่าแล้ว');
    }
  });
});

// ---------- ปุ่มหลัก ----------

$('btnOpen').addEventListener('click', () => action(() => api('/api/browser/open', {})));
$('btnCheck').addEventListener('click', () => action(() => api('/api/check', {})));
$('btnWatch').addEventListener('click', () => action(() => api(state?.watch.running ? '/api/watch/stop' : '/api/watch/start', {})));
$('btnVerify').addEventListener('click', () => action(() => api('/api/verify', {})));
$('btnBackups').addEventListener('click', () => action(() => api('/api/backups/approve', {})));
$('btnCapture').addEventListener('click', () => action(async () => toast(`บันทึกแล้ว: ${(await api('/api/capture', {})).file} (อาจมีชื่อนักเรียนอยู่ในไฟล์)`)));
$('btnNotify').addEventListener('click', async () => {
  beep();
  if ('Notification' in window) await Notification.requestPermission();
  toast('เปิดเสียงและการแจ้งเตือนแล้ว');
});

window.addEventListener('beforeunload', (e) => {
  if (formDirty) e.preventDefault();
});

async function refresh() {
  try {
    const next = await api('/api/state');
    state = next;
    render();
  } catch {
    $('statusMessage').textContent = 'ติดต่อโปรแกรมไม่ได้ — โปรแกรมอาจถูกปิดไปแล้ว';
  }
}

refresh();
setInterval(refresh, 1000);
setInterval(tickClock, 250);

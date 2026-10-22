import fs from 'node:fs';
import path from 'node:path';
import { normalizeCode, normalizeName } from './matcher.js';

export const MIN_POLL_SEC = 5;

export const DEFAULT_SETTINGS = Object.freeze({
  siteUrl: 'https://myzma68.com/rw_enrollment/_site/',
  openTime: null,
  requiredCount: 1,
  courses: [],
  autoUseBackup: false,
  assistedClick: true,
  pollIntervalSec: 10,
  maxPolls: 60,
  browserChannel: 'auto',
});

const CHANNELS = ['auto', 'chrome', 'msedge', 'chromium'];

/**
 * ตรวจและปรับรูปแบบค่าตั้งค่า คืน { settings, errors }
 * ลำดับใน courses = ลำดับความสำคัญ (บนสุดสำคัญที่สุด)
 */
export function validateSettings(input) {
  const src = { ...DEFAULT_SETTINGS, ...(input || {}) };
  const errors = [];
  const out = {};

  let url = String(src.siteUrl || '').trim();
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    u.search = '';
    u.hash = '';
    if (!u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/[^/]*$/, '');
    url = u.toString();
  } catch {
    errors.push('URL เว็บไซต์ไม่ถูกต้อง');
  }
  out.siteUrl = url;

  if (src.openTime === null || src.openTime === '' || src.openTime === undefined) {
    out.openTime = null;
  } else {
    const t = Date.parse(src.openTime);
    if (Number.isNaN(t)) errors.push('วันและเวลาเปิดลงทะเบียนไม่ถูกต้อง');
    out.openTime = Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  const req = Number(src.requiredCount);
  if (!Number.isInteger(req) || req < 1 || req > 20) errors.push('จำนวนวิชาที่ต้องลงต้องเป็นจำนวนเต็ม 1–20');
  out.requiredCount = Number.isInteger(req) ? req : 1;

  const poll = Number(src.pollIntervalSec);
  if (!Number.isFinite(poll) || poll < MIN_POLL_SEC || poll > 120) {
    errors.push(`ช่วงเวลาตรวจซ้ำต้องอยู่ระหว่าง ${MIN_POLL_SEC}–120 วินาที (ป้องกันการส่งคำขอถี่เกินไป)`);
  }
  out.pollIntervalSec = Number.isFinite(poll) ? Math.max(MIN_POLL_SEC, Math.min(120, poll)) : 10;

  const maxPolls = Number(src.maxPolls);
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 360) errors.push('จำนวนครั้งตรวจซ้ำสูงสุดต้องเป็น 1–360');
  out.maxPolls = Number.isInteger(maxPolls) ? maxPolls : 60;

  out.autoUseBackup = Boolean(src.autoUseBackup);
  out.assistedClick = src.assistedClick !== false;
  out.browserChannel = CHANNELS.includes(src.browserChannel) ? src.browserChannel : 'auto';

  const courses = Array.isArray(src.courses) ? src.courses : [];
  if (courses.length > 30) errors.push('ใส่วิชาได้ไม่เกิน 30 วิชา');
  const seenCodes = new Map();
  const seenNames = new Map();
  out.courses = [];
  courses.slice(0, 30).forEach((c, i) => {
    const code = String(c?.code ?? '').trim();
    const name = String(c?.name ?? '').replace(/\s+/g, ' ').trim();
    const seq = c?.seq == null ? '' : String(c.seq).trim();
    const role = c?.role === 'backup' ? 'backup' : 'main';
    const label = `วิชาลำดับที่ ${i + 1}`;
    if (!code && !name) {
      errors.push(`${label}: ต้องใส่รหัสวิชาหรือชื่อวิชาอย่างน้อยหนึ่งอย่าง`);
      return;
    }
    const keyCode = normalizeCode(code);
    const keyName = normalizeName(name);
    if (keyCode) {
      const key = `${keyCode}#${seq}`;
      if (seenCodes.has(key)) errors.push(`${label}: รหัส ${code} ซ้ำกับวิชาลำดับที่ ${seenCodes.get(key)}`);
      else seenCodes.set(key, i + 1);
    } else {
      if (seenNames.has(keyName)) errors.push(`${label}: ชื่อ "${name}" ซ้ำกับวิชาลำดับที่ ${seenNames.get(keyName)}`);
      else seenNames.set(keyName, i + 1);
    }
    out.courses.push({ code, name, seq, role });
  });

  if (out.courses.length && out.requiredCount > out.courses.length) {
    errors.push(`ต้องลง ${out.requiredCount} วิชา แต่ใส่วิชาไว้แค่ ${out.courses.length} วิชา`);
  }

  return { settings: out, errors };
}

export class SettingsStore {
  constructor(file) {
    this.file = file;
    this.current = this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return validateSettings(raw).settings;
    } catch {
      return validateSettings({}).settings;
    }
  }

  get() {
    return structuredClone(this.current);
  }

  save(input) {
    const { settings, errors } = validateSettings(input);
    if (errors.length) return { ok: false, errors };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
    fs.renameSync(tmp, this.file);
    this.current = settings;
    return { ok: true, settings: this.get() };
  }
}

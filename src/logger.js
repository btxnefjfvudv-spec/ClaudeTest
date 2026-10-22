import fs from 'node:fs';
import path from 'node:path';

// ลบข้อมูลที่ห้ามลงล็อก: เลขบัตรประชาชน 13 หลัก, คุกกี้, เซสชัน, รหัสผ่าน, โทเคน
export function redact(input) {
  let text = String(input ?? '');
  text = text.replace(/\b\d{13}\b/g, '[ลบเลขบัตร]');
  text = text.replace(/\b\d-?\d{4}-?\d{5}-?\d{2}-?\d\b/g, '[ลบเลขบัตร]');
  text = text.replace(
    /\b(cookie|set-cookie|phpsessid|session(?:id)?|token|password|passwd|pwd|pass|auth(?:orization)?)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s;&,]+)/gi,
    '$1$2[ลบแล้ว]',
  );
  return text;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function localStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export class Logger {
  constructor({ dir = null, max = 300, echo = true } = {}) {
    this.dir = dir;
    this.max = max;
    this.echo = echo;
    this.items = [];
    this.seq = 0;
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  log(level, message, status = null) {
    const now = new Date();
    const entry = {
      id: ++this.seq,
      at: now.toISOString(),
      level,
      status,
      message: redact(message),
    };
    this.items.push(entry);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
    const line = `${localStamp(now)} [${level.toUpperCase()}]${status ? ` [${status}]` : ''} ${entry.message}`;
    if (this.echo) console.log(line);
    if (this.dir) {
      const file = path.join(this.dir, `enrollment-${localStamp(now).slice(0, 10)}.log`);
      try {
        fs.appendFileSync(file, line + '\n');
      } catch {
        // เขียนไฟล์ล็อกไม่ได้ก็ไม่ควรทำให้โปรแกรมหยุด
      }
    }
    return entry;
  }

  info(message, status) {
    return this.log('info', message, status);
  }

  warn(message, status) {
    return this.log('warn', message, status);
  }

  error(message, status) {
    return this.log('error', message, status);
  }

  recent(n = 100) {
    return this.items.slice(-n);
  }
}

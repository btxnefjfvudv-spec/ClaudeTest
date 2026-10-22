import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { UserError } from './status.js';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200_000) throw new UserError('ข้อมูลใหญ่เกินไป');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new UserError('ข้อมูลไม่ใช่ JSON');
  }
}

/**
 * เซิร์ฟเวอร์หน้าควบคุม เปิดเฉพาะในเครื่อง (127.0.0.1)
 * ป้องกันเว็บอื่นสั่งงานผ่านเบราว์เซอร์: ตรวจ Host, Origin และบังคับ Content-Type เป็น JSON
 */
export function createServer({ assistant, publicDir, port }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

  const routes = {
    'GET /api/state': () => assistant.publicState(),
    'POST /api/settings': (body) => assistant.saveSettings(body.settings),
    'POST /api/browser/open': async () => ({ status: await assistant.openBrowser() }),
    'POST /api/check': async () => ({ status: await assistant.checkNow({ reason: 'ผู้ใช้กดตรวจสถานะ' }) }),
    'POST /api/watch/start': () => (assistant.startWatch(), { ok: true }),
    'POST /api/watch/stop': () => (assistant.stopWatch(), { ok: true }),
    'POST /api/backups/approve': () => (assistant.approveBackups(), { ok: true }),
    'POST /api/click': (body) => assistant.clickControl(body),
    'POST /api/verify': async () => ({ verification: await assistant.verify() }),
    'POST /api/dialog': async (body) => (await assistant.respondDialog(body.id, !!body.accept), { ok: true }),
    'POST /api/capture': async () => ({ file: await assistant.captureStructure() }),
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host || '')) return send(res, 403, { error: 'ไม่อนุญาต' });
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        return send(res, 200, fs.readFileSync(path.join(publicDir, file)), type);
      }

      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(res, 404, { error: 'ไม่พบ' });

      let body = {};
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && !allowedOrigins.has(origin)) return send(res, 403, { error: 'ไม่อนุญาต' });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
          return send(res, 415, { error: 'ต้องส่งเป็น JSON' });
        }
        body = await readJson(req);
      }
      const result = await handler(body);
      return send(res, 200, result ?? { ok: true });
    } catch (err) {
      if (err instanceof UserError) return send(res, 400, { error: err.message });
      assistant.logger.error(`ข้อผิดพลาดภายใน: ${String(err?.message || err).split('\n')[0]}`);
      return send(res, 500, { error: `เกิดข้อผิดพลาด: ${String(err?.message || err).split('\n')[0]}` });
    }
  });
  return server;
}

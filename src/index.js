import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assistant } from './assistant.js';
import { Logger } from './logger.js';
import { createServer } from './server.js';
import { SettingsStore } from './settings.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 3939;

const logger = new Logger({ dir: path.join(root, 'logs') });
const store = new SettingsStore(path.join(root, 'data', 'settings.json'));
const profile = JSON.parse(fs.readFileSync(path.join(root, 'config', 'site-profile.json'), 'utf8'));
const assistant = new Assistant({ settingsStore: store, profile, logger, dataDir: root });
const server = createServer({ assistant, publicDir: path.join(root, 'public'), port });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`พอร์ต ${port} ถูกใช้อยู่ — โปรแกรมอาจเปิดอยู่แล้ว ลองเปิด http://127.0.0.1:${port}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`;
  logger.info(`หน้าควบคุมพร้อมแล้ว: ${url} (ปิดโปรแกรมด้วย Ctrl+C)`);
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});

async function shutdown() {
  logger.info('กำลังปิดโปรแกรม...');
  await assistant.closeBrowser().catch(() => {});
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Assistant } from '../src/assistant.js';
import { Logger } from '../src/logger.js';
import { SettingsStore } from '../src/settings.js';
import { startMockSite } from './mock-site/site.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const profile = JSON.parse(fs.readFileSync(path.join(root, 'config', 'site-profile.json'), 'utf8'));
export const fixture = (name) => fs.readFileSync(path.join(root, 'test', 'fixtures', name), 'utf8');

export async function waitFor(fn, { timeout = 10000, interval = 50, label = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** สร้างเว็บจำลอง + ผู้ช่วย (เบราว์เซอร์แบบไม่มีหน้าจอ) สำหรับทดสอบ */
export async function setup({ settings = {}, navTimeoutMs = 5000, minNavGapMs = 0, pollIntervalMsOverride = null } = {}) {
  const site = await startMockSite();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enroll-test-'));
  const store = new SettingsStore(path.join(dir, 'settings.json'));
  const saved = store.save({ siteUrl: site.baseUrl, ...settings });
  if (!saved.ok) throw new Error(saved.errors.join('; '));
  const logger = new Logger({ echo: false });
  const assistant = new Assistant({
    settingsStore: store,
    profile,
    logger,
    dataDir: dir,
    browserOptions: { headless: true, channel: 'chromium', navTimeoutMs },
    minNavGapMs,
    tickMs: 50,
    pollIntervalMsOverride,
  });

  return {
    site,
    assistant,
    dir,
    async login() {
      await assistant.browser.page.goto(`${site.origin}/__test/login`);
    },
    async clickAndAnswer(code, accept = true) {
      const item = assistant.state.plan.items.find((i) => i.course?.code === code);
      const control = assistant.lastRegisterPage.courses.find((c) => c.code === code).controls[0];
      assistant.clickControl({ code: item.course.code, controlId: control.id });
      const dialog = await waitFor(() => assistant.state.pendingDialog || (!assistant.state.busy && 'none'), { label: 'dialog' });
      if (dialog !== 'none') await assistant.respondDialog(dialog.id, accept);
      await assistant.running;
    },
    async close() {
      assistant.stopWatch('จบการทดสอบ');
      await assistant.closeBrowser();
      await site.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

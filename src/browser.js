import { chromium } from 'playwright';
import { extractPage, highlightRows, sanitizedHtml } from './extract.js';

export class NavigationError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // TIMEOUT | NETWORK | HTTP | CLOSED
  }
}

/**
 * ห่อ Playwright ไว้ที่เดียว
 * - เปิดเบราว์เซอร์แบบมีหน้าจอ ให้ผู้ใช้เข้าสู่ระบบเอง (โปรแกรมไม่รับรหัสผ่าน)
 * - เก็บโปรไฟล์เบราว์เซอร์ไว้ในเครื่อง ทำให้ไม่ต้องล็อกอินใหม่ทุกครั้ง
 * - หน้าต่างแจ้งเตือนของเว็บ (alert/confirm) จะถูกส่งไปให้ผู้ใช้ตัดสินใจที่หน้าควบคุม
 */
export class BrowserSession {
  constructor({ profileDir, channel = 'auto', headless = false, navTimeoutMs = 30000, onDialog, onServerDate, onLoad, onClosed, logger }) {
    this.profileDir = profileDir;
    this.channel = channel;
    this.headless = headless;
    this.navTimeoutMs = navTimeoutMs;
    this.onDialog = onDialog;
    this.onServerDate = onServerDate;
    this.onLoad = onLoad;
    this.onClosed = onClosed;
    this.logger = logger;
    this.context = null;
    this.page = null;
    this.usedChannel = null;
  }

  isOpen() {
    return !!this.context && !!this.page && !this.page.isClosed();
  }

  async open() {
    if (this.isOpen()) return;
    const order = this.channel === 'auto' ? ['chrome', 'msedge', 'chromium'] : [this.channel];
    let lastErr = null;
    for (const ch of order) {
      try {
        this.context = await chromium.launchPersistentContext(this.profileDir, {
          channel: ch === 'chromium' ? undefined : ch,
          headless: this.headless,
          viewport: this.headless ? { width: 1280, height: 900 } : null,
          locale: 'th-TH',
        });
        this.usedChannel = ch;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (!this.context) {
      throw new Error(`เปิดเบราว์เซอร์ไม่ได้ (ลอง ${order.join(', ')}): ${String(lastErr?.message || lastErr).split('\n')[0]}`);
    }
    this.context.on('page', (p) => {
      // เว็บเปิดหน้าต่างใหม่ (popup/แท็บใหม่) ให้ติดตามหน้าต่างล่าสุด
      this.#attach(p);
      this.page = p;
    });
    this.context.on('close', () => {
      this.context = null;
      this.page = null;
      this.onClosed?.();
    });
    for (const p of this.context.pages()) this.#attach(p);
    this.page = this.context.pages()[0] || (await this.context.newPage());
  }

  #attach(page) {
    page.on('dialog', (dialog) => this.onDialog?.(dialog));
    page.on('response', (res) => {
      try {
        if (res.request().isNavigationRequest() && res.frame() === page.mainFrame()) {
          const date = res.headers()['date'];
          if (date) this.onServerDate?.(Date.parse(date), Date.now());
        }
      } catch {
        // ไม่สำคัญต่อการทำงานหลัก
      }
    });
    page.on('load', () => {
      if (page === this.page) this.onLoad?.();
    });
    page.on('close', () => {
      if (page === this.page && this.context) {
        const rest = this.context.pages().filter((p) => !p.isClosed());
        this.page = rest[rest.length - 1] || null;
      }
    });
  }

  #requirePage() {
    if (!this.isOpen()) throw new NavigationError('CLOSED', 'เบราว์เซอร์ถูกปิดอยู่ — กด "เปิดเบราว์เซอร์" ก่อน');
    return this.page;
  }

  async goto(url) {
    const page = this.#requirePage();
    let res;
    try {
      res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.navTimeoutMs });
    } catch (err) {
      const msg = String(err?.message || err);
      if (/Timeout/i.test(msg)) {
        throw new NavigationError('TIMEOUT', `เว็บไซต์โหลดช้าเกิน ${Math.round(this.navTimeoutMs / 1000)} วินาที`);
      }
      throw new NavigationError('NETWORK', `เชื่อมต่อเว็บไซต์ไม่ได้: ${msg.split('\n')[0]}`);
    }
    if (res && res.status() >= 500) {
      throw new NavigationError('HTTP', `เว็บไซต์ขัดข้อง (HTTP ${res.status()})`);
    }
    return res;
  }

  async waitSettled(timeoutMs = this.navTimeoutMs) {
    const page = this.#requirePage();
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
    } catch {
      throw new NavigationError('TIMEOUT', `เว็บไซต์โหลดช้าเกิน ${Math.round(timeoutMs / 1000)} วินาที`);
    }
  }

  async snapshot(profile) {
    const page = this.#requirePage();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await page.evaluate(extractPage, profile);
      } catch (err) {
        // หน้าเว็บกำลังเปลี่ยนหน้า รอแล้วลองอีกครั้ง
        if (!/context was destroyed|navigation/i.test(String(err?.message))) throw err;
        await page.waitForLoadState('domcontentloaded', { timeout: this.navTimeoutMs }).catch(() => {});
      }
    }
    return page.evaluate(extractPage, profile);
  }

  async highlight(codes) {
    const page = this.#requirePage();
    try {
      await page.bringToFront();
      return await page.evaluate(highlightRows, codes);
    } catch {
      return false;
    }
  }

  async click(controlId, { selectValue } = {}) {
    const page = this.#requirePage();
    const loc = page.locator(`[data-ea-id="${controlId.replace(/["\\]/g, '\\$&')}"]`);
    if ((await loc.count()) !== 1) throw new Error('ไม่พบปุ่มนี้บนหน้าเว็บแล้ว (หน้าเว็บอาจเปลี่ยนไป)');
    await page.bringToFront();
    if (selectValue !== undefined) {
      await loc.selectOption(selectValue, { timeout: this.navTimeoutMs });
    } else {
      await loc.click({ timeout: this.navTimeoutMs });
    }
  }

  async screenshot(file) {
    const page = this.#requirePage();
    await page.screenshot({ path: file, fullPage: true });
  }

  async html() {
    const page = this.#requirePage();
    return page.evaluate(sanitizedHtml);
  }

  currentUrl() {
    return this.isOpen() ? this.page.url() : null;
  }

  async close() {
    const ctx = this.context;
    this.context = null;
    this.page = null;
    if (ctx) await ctx.close().catch(() => {});
  }
}

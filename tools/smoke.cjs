/**
 * Smoke test: runs every playable minigame start-to-finish in headless Chromium
 * (iPad landscape emulation) with random multi-touch input for the human seat,
 * and checks it reaches the Results scene without errors.
 *
 *   node tools/smoke.cjs [baseUrl] [gameId,...]
 */
const { chromium, devices } = require('playwright');

const base = process.argv[2] || 'http://localhost:5199/';
const only = process.argv[3] ? process.argv[3].split(',') : null;

async function runGame(browser, id) {
  const ctx = await browser.newContext({ ...devices['iPad Pro 11 landscape'], deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?auto&fast&speed=4&game=${id}`);
  const cdp = await ctx.newCDPSession(page);
  const vp = page.viewportSize();
  const t0 = Date.now();
  let reached = '';
  let results = null;
  let touches = 0;
  while (Date.now() - t0 < (+process.env.SMOKE_MS || 180000)) {
    // random input from all four seats (CPU seats ignore it)
    const pts = [0, 1, 2, 3].map((q, i) => ({
      x: vp.width * ((q % 2) * 0.5 + 0.08 + Math.random() * 0.34),
      y: vp.height * ((q < 2 ? 0 : 0.5) + 0.08 + Math.random() * 0.34),
      id: i + 1,
    }));
    try {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts.map((p) => ({ ...p, x: p.x + 30, y: p.y + 10 })) });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      touches++;
    } catch { /* page navigating */ }
    const s = await page.evaluate(() => {
      const g = window.__game;
      const act = g.scene.getScenes(true).map((x) => x.scene.key);
      const r = g.scene.getScene('Results');
      return { act, hist: window.__lastResults };
    }).catch(() => ({ act: [] }));
    if (s.act.includes('Results') || s.act.includes('Menu')) { reached = s.act.join(','); break; }
    await page.waitForTimeout(120);
  }
  results = await page.evaluate(() => {
    const P = window.__party;
    const h = P && P.history[P.history.length - 1];
    return h ? h.results.map((r) => `P${r.player + 1}#${r.rank}(${r.score})`).join(' ') : null;
  }).catch(() => null);
  await ctx.close();
  return { id, ok: !!reached && errors.length === 0 && !!results, secs: Math.round((Date.now() - t0) / 1000), touches, errors: errors.slice(0, 3), results, reached };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base + '?auto');
  await page.waitForTimeout(1500);
  const ids = only || (await page.evaluate(() => window.__playable));
  await page.close();
  const out = [];
  const queue = [...ids];
  const workers = Array.from({ length: +process.env.SMOKE_WORKERS || 4 }, async () => {
    while (queue.length) {
      const id = queue.shift();
      const r = await runGame(browser, id);
      out.push(r);
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${id.padEnd(20)} ${String(r.secs).padStart(3)}s  touches=${r.touches}  ${r.results || '-'}  ${r.errors.join(' | ')}`);
    }
  });
  await Promise.all(workers);
  await browser.close();
  const fails = out.filter((r) => !r.ok);
  console.log(`\n${out.length - fails.length}/${out.length} passed`);
  process.exit(fails.length ? 1 : 0);
})();

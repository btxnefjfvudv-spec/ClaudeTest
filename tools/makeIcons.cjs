// Renders tools/icon.html and writes public/icon-180.png + icon-512.png (nearest-neighbour upscale).
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const base = process.argv[2] || 'http://localhost:5199/';
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(base + 'tools/icon.html');
  await p.waitForFunction(() => window.__icon, null, { timeout: 15000 });
  for (const size of [180, 512]) {
    const data = await p.evaluate(async (size) => {
      const img = new Image();
      img.src = window.__icon;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, size, size);
      return c.toDataURL('image/png');
    }, size);
    fs.writeFileSync(`public/icon-${size}.png`, Buffer.from(data.split(',')[1], 'base64'));
  }
  await b.close();
  console.log('icons written');
})();

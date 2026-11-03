// Inline the offline build into ONE html file that works from file:// (double-click).
const fs = require('fs');
const path = require('path');
const dir = 'dist-offline';
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g, (_, src) => {
  const js = fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/g, '<\\/script');
  return '';
}).replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g, (_, href) => `<style>${fs.readFileSync(path.join(dir, href), 'utf8')}</style>`);
// classic script at the end of <body> so #game exists
const jsFile = fs.readdirSync(path.join(dir, 'assets')).find((f) => f.endsWith('.js'));
const js = fs.readFileSync(path.join(dir, 'assets', jsFile), 'utf8').replace(/<\/script/g, '<\\/script');
html = html.replace('</body>', `<script>${js}</script></body>`);
// icons as data URIs, drop manifest + service worker (not usable from file://)
for (const ic of ['icon-180.png']) {
  const data = fs.readFileSync(path.join(dir, ic)).toString('base64');
  html = html.split(`./${ic}`).join(`data:image/png;base64,${data}`);
}
html = html.replace(/<link rel="manifest"[^>]*>/, '');
fs.mkdirSync('release', { recursive: true });
fs.mkdirSync("release/CLASSROOM-5-8-PARTY", { recursive: true });
fs.writeFileSync("release/CLASSROOM-5-8-PARTY/CLASSROOM-5-8-PARTY.html", html);
console.log('release/CLASSROOM-5-8-PARTY/CLASSROOM-5-8-PARTY.html', (html.length / 1e6).toFixed(2), 'MB');

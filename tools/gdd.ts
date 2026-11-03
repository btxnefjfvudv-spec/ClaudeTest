// Generates docs/GDD.md and docs/MINIGAMES.md from the catalogue + implemented games.
// Run: node tools/gdd.cjs   (bundles this file with esbuild, no browser needed)
import { CATALOG_LIST } from '../src/minigames/catalog';
import { CATEGORY_LABEL } from '../src/minigames/types';
import * as fs from 'fs';

const implemented = new Set(fs.readdirSync('src/minigames/games').map((f) => f.replace('.ts', '')));
const statusOf = (name: string) => {
  const cls = name.split(/[^A-Za-z0-9]+/).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return implemented.has(cls) ? 'Implemented' : 'Planned';
};
const STATUS = JSON.parse(fs.existsSync('docs/qa-status.json') ? fs.readFileSync('docs/qa-status.json', 'utf8') : '{}');

let gdd = '# CLASSROOM 5/8 PARTY — Game Design Document\n\n';
gdd += '4 players · 1 iPad · players sit around the table (P1/P2 at the top edge, P3/P4 at the bottom edge).\n';
gdd += 'Every game: rules readable in 5–10 s, 15–90 s rounds, CPU fills empty seats, per-player rotated UI.\n\n';
gdd += 'Party scoring: 1st 10 · 2nd 7 · 3rd 5 · 4th 3 (ties share). Team games: winners rank 1, losers rank 3, draw = rank 2.\n\n';
let cat = '';
for (const m of CATALOG_LIST) {
  if (m.category !== cat) {
    cat = m.category;
    gdd += `\n## ${CATEGORY_LABEL[m.category]} (${m.category})\n`;
  }
  gdd += `\n### #${m.num} ${m.name} — ${m.nameTh}\n\n${m.blurb}\n\n`;
  gdd += m.howTo.map((h) => `- ${h}`).join('\n') + '\n';
  gdd += `- **Controls:** ${m.controls}\n- **Length:** ${m.duration ? m.duration + ' s' : 'until a winner (with hard cap)'}${m.team ? ' · **Team game** (P1+P3 vs P2+P4)' : ''}\n`;
}
fs.writeFileSync('docs/GDD.md', gdd);

let t = '# 50 Minigames — Status Tracker\n\n';
t += 'Status: Planned → Prototype → In Development → Implemented → Playtested → Verified\n\n';
t += '- **Implemented** = real gameplay, CPU AI, art, VFX, sound, passes the automated smoke test (headless iPad emulation, random multi-touch).\n';
t += '- **Playtested** = played by real people on a real iPad. **Verified** = passed the full QA checklist on a real iPad.\n';
t += '- A preview page alone never counts as done.\n\n';
t += '| # | Game | Category | Status | Smoke test |\n|---|---|---|---|---|\n';
for (const m of CATALOG_LIST) {
  const s = STATUS[m.id];
  t += `| ${m.num} | ${m.name} | ${CATEGORY_LABEL[m.category]} | ${s?.status ?? statusOf(m.id)} | ${s?.smoke ?? '–'} |\n`;
}
t += '\n## QA checklist (per game)\n\nเปิดได้ · เริ่มได้ · เล่นได้ 1/2/3/4 คน · Multi-touch ทำงาน · Input ไม่ชนกัน · Score ถูก · Win/Lose ถูก · Animation · Sound · Restart ได้ · Cleanup ถูก · ไม่มี Error\n';
fs.writeFileSync('docs/MINIGAMES.md', t);
console.log('docs written');

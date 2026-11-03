const { buildSync } = require('esbuild');
const out = buildSync({ entryPoints: ['tools/gdd.ts'], bundle: true, platform: 'node', write: false, format: 'cjs', external: ['phaser'] });
eval(out.outputFiles[0].text);

// Render assets/icon.svg to PNG icons (512 + 192).
import { chromium } from 'playwright';
import fs from 'fs';
const svg = fs.readFileSync('assets/icon.svg', 'utf8');
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
for (const n of [512, 192]) {
  const p = await b.newPage({ viewport: { width: n, height: n } });
  await p.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${n}" height="${n}" `)}</body></html>`);
  await p.screenshot({ path: `assets/icon-${n}.png`, omitBackground: true });
}
await b.close(); console.log('icons ok');

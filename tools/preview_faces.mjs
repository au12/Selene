// Quick visual check: render each face with a sample lit state. node tools/preview_faces.mjs outdir
import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const F = require('../shared/faces.js');
const out = process.argv[2] || '/tmp/preview';
fs.mkdirSync(out, { recursive: true });
const SEG7 = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '' };
const FONT = { M: [0x11,0x1B,0x15,0x15,0x11,0x11,0x11], O: [0x0E,0x11,0x11,0x11,0x11,0x11,0x0E], N: [0x11,0x11,0x19,0x15,0x13,0x11,0x11],
  '2': [0x0E,0x11,0x01,0x02,0x04,0x08,0x1F], '4': [0x02,0x06,0x0A,0x12,0x1F,0x02,0x02], ' ': [0,0,0,0,0,0,0] };
function state(kind) {
  const on = [];
  const dm = (str) => [...str].forEach((ch, c) => (FONT[ch] || FONT[' ']).forEach((row, r) => { for (let k = 0; k < 5; k++) if (row & (16 >> k)) on.push(`x${c}${r}${k}`); }));
  const d7 = (pre, ch) => [...(SEG7[ch] || '')].forEach((s) => on.push(pre + s));
  if (kind === 'time') {
    dm('MON'); d7('t0', ' '); d7('t1', '6'); on.push('tdash'); d7('t2', '2'); d7('t3', '6');
    d7('b0', '1'); d7('b1', '0'); on.push('bcol'); d7('b2', '5'); d7('b3', '8'); d7('b4', '5'); d7('b5', '0');
    on.push('pm', 'alm', 'chm', 'p3', 'h8', 'r3');
    for (let i = 0; i <= 50; i++) on.push('q' + i);
  } else {
    dm(' 24'); on.push('xdp'); d7('t0', ' '); d7('t1', '5'); on.push('tcol'); d7('t2', '2'); d7('t3', '5');
    d7('b0', ' '); d7('b1', '8'); on.push('bcol'); d7('b2', '3'); d7('b3', '5');
    on.push('lage', 'lrise', 'lset', 'pm', 'sune', 'sunw', 'p6');
  }
  return on;
}
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 760, height: 760 }, deviceScaleFactor: 1 });
for (const id of F.ids) for (const kind of ['time', 'sun']) {
  const svg = F.standalone(id);
  await page.setContent(`<html><body style="margin:0;background:#222">${svg.replace('width="1000" height="1000"', 'width="760" height="760"')}</body></html>`);
  await page.evaluate((on) => { on.forEach((s) => document.querySelectorAll(`[data-s="${s}"]`).forEach((e) => e.classList.add('on'))); }, state(kind));
  await page.screenshot({ path: `${out}/${id}_${kind}.png` });
}
await browser.close();
console.log('done');

// Renders firmware face assets from shared/faces.js with headless Chrome.
//   node tools/render_faces.mjs [size=720] [outdir=build/faces]
// Per face: <id>_bg.png (all segments off/ghost, outside the dial circle black) and
// <id>_segs.json (per logical segment: bbox + 8-bit body coverage + 8-bit aura (shadow/glow)).
import { chromium } from 'playwright';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const F = require('../shared/faces.js');
const SIZE = +(process.argv[2] || 720);
const OUT = process.argv[3] || 'build/faces';
fs.mkdirSync(OUT, { recursive: true });

// Aura (soft layer under a lit segment) per face & class, in face units (1000 = dial diameter).
const AURA = {
  arc: { lcd: { dx: 2.2, dy: 2.8, sigma: 1.3, alpha: 0.32, color: '#1c221e' }, mg: { dx: 0, dy: 0, sigma: 4.5, alpha: 0.5, color: '#f1b44a' }, st: { dx: 0, dy: 0, sigma: 3, alpha: 0.6, color: '#9fc0f2' } },
  desk: { lcd: { dx: 2.2, dy: 2.8, sigma: 1.3, alpha: 0.30, color: '#1e221e' }, mg: { dx: 0, dy: 0, sigma: 4.5, alpha: 0.5, color: '#f4bb50' }, st: { dx: 0, dy: 0, sigma: 3, alpha: 0.6, color: '#a9c6f4' } },
  noir: { lcd: { dx: 0, dy: 0, sigma: 3.2, alpha: 0.42, color: '#ff9a30' }, mg: { dx: 0, dy: 0, sigma: 5, alpha: 0.55, color: '#ffa840' }, st: { dx: 0, dy: 0, sigma: 3.2, alpha: 0.55, color: '#ffa840' } },
};

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
for (const id of F.ids) {
  const face = F.build(id);
  const svg = F.standalone(id, '.el{display:none}').replace('width="1000" height="1000"', `width="${SIZE}" height="${SIZE}"`);
  await page.setContent(`<html><body style="margin:0;background:#000">${svg}</body></html>`);
  // background: clip to the dial circle (panel is round; corners are invisible anyway)
  await page.evaluate(() => {
    const s = document.querySelector('svg');
    s.style.clipPath = 'circle(50% at 50% 50%)';
  });
  await page.screenshot({ path: `${OUT}/${id}_bg.png` });
  const segs = await page.evaluate(({ size, aura }) => {
    const k = size / 1000;
    const out = [];
    const cnv = document.createElement('canvas');
    const ctx = cnv.getContext('2d', { willReadFrequently: true });
    for (const el of document.querySelectorAll('[data-s]')) {
      const cls = el.classList.contains('st') ? 'st' : el.classList.contains('mg') ? 'mg' : 'lcd';
      const A = aura[cls];
      const bb = el.getBBox();
      const m = Math.ceil((Math.abs(A.dx) + Math.abs(A.dy) + 3 * A.sigma) * k) + 2;
      const x0 = Math.max(0, Math.floor(bb.x * k) - m), y0 = Math.max(0, Math.floor(bb.y * k) - m);
      const x1 = Math.min(size, Math.ceil((bb.x + bb.width) * k) + m), y1 = Math.min(size, Math.ceil((bb.y + bb.height) * k) + m);
      const w = x1 - x0, h = y1 - y0;
      cnv.width = w; cnv.height = h;
      const path = new Path2D(el.getAttribute('d'));
      const draw = (blur, dx, dy) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
        ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
        ctx.setTransform(k, 0, 0, k, -x0 + dx * k, -y0 + dy * k);
        ctx.fillStyle = '#fff'; ctx.fill(path);
        const d = ctx.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3];
        return a;
      };
      const body = draw(0, 0, 0);
      const au = draw(A.sigma * k, A.dx, A.dy);
      for (let i = 0; i < au.length; i++) au[i] = Math.round(au[i] * A.alpha);
      const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
      out.push({ id: el.dataset.s, cls, x: x0, y: y0, w, h, body: b64(body), aura: b64(au) });
    }
    return out;
  }, { size: SIZE, aura: AURA[id] });
  const pal = face.palette;
  fs.writeFileSync(`${OUT}/${id}_segs.json`, JSON.stringify({ id, name: face.name, size: SIZE, colors: { lcd: pal.lcdOn, mg: pal.mgOn, st: pal.stOn }, aura: AURA[id], segs }));
  console.log(id, segs.length, 'segments');
}
await browser.close();

// Screenshot + smoke test the bundled simulator. node tools/shoot_web.mjs outdir
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
const out = process.argv[2] || '/tmp/shots'; fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.resolve('dist/index.html');
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const errors = [];
async function open(viewport, scale = 1, extra = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, ...extra });
  await ctx.addInitScript(() => { localStorage.clear(); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(url); await page.waitForTimeout(600);
  return page;
}
const p = await open({ width: 1440, height: 900 });
await p.screenshot({ path: `${out}/desktop_arc.png` });
// press MODE (C) -> moon time, wait for calc
await p.keyboard.down('c'); await p.keyboard.up('c'); await p.waitForTimeout(2200);
await p.screenshot({ path: `${out}/desktop_arc_moon.png` });
await p.keyboard.down('c'); await p.keyboard.up('c'); await p.waitForTimeout(2200);
await p.screenshot({ path: `${out}/desktop_arc_sun.png` });
await p.keyboard.press('2'); await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/desktop_desk.png` });
await p.keyboard.press('3'); await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/desktop_noir.png` });
const m = await open({ width: 390, height: 844 }, 2, { isMobile: true, hasTouch: true });
await m.screenshot({ path: `${out}/mobile_arc.png` });
await m.screenshot({ path: `${out}/mobile_arc_full.png`, fullPage: true });
console.log(errors.length ? errors.join('\n') : 'no errors');
await browser.close();

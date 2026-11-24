// Rough rendering-cost benchmark: a phone-sized page, the phone wobbling in the hand (orientation events with sensor
// noise at 60 Hz) for a few seconds; reports main-thread time spent painting and in script, from a Chrome trace.
//   node tools/bench_web.mjs [dist/index.html] [seconds] [idle]   (idle: no wobble, just the clock ticking)
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
const file = path.resolve(process.argv[2] || 'dist/index.html'), secs = +(process.argv[3] || 5), idle = process.argv[4] === 'idle';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.8, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('file://' + file); await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const tracePath = '/tmp/bench-trace.json';
await browser.startTracing(page, { path: tracePath, categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'cc', 'viz'] });
const frames = await page.evaluate(([secs, idle]) => new Promise((res) => {
  let t0 = performance.now(), n = 0, last = t0, worst = 0, k = 0;
  const wob = setInterval(() => { k++; if (idle) return;
    const s = (performance.now() - t0) / 1000;
    window.dispatchEvent(Object.assign(new Event('deviceorientation'), { alpha: 0, beta: 60 + 6 * Math.sin(s * 1.3) + (Math.random() - 0.5) * 0.8, gamma: 5 * Math.sin(s * 0.9) + (Math.random() - 0.5) * 0.8 }));
  }, 16);
  const f = (t) => { n++; if (idle && t - t0 > 300) { /* measure CPU, not frames */ } worst = Math.max(worst, t - last); last = t; if (t - t0 < secs * 1000) requestAnimationFrame(f); else { clearInterval(wob); res({ fps: n / ((t - t0) / 1000), worst }); } };
  requestAnimationFrame(f);
}), [secs, idle]);
await browser.stopTracing();
const ev = JSON.parse(fs.readFileSync(tracePath, 'utf8')).traceEvents || [];
const sum = (names) => ev.filter((e) => names.includes(e.name) && e.dur).reduce((a, e) => a + e.dur, 0) / 1000;
console.log(JSON.stringify({ fps: +frames.fps.toFixed(1), worstFrameMs: +frames.worst.toFixed(1), paintMs: +sum(['Paint', 'PaintImage']).toFixed(0), rasterMs: +sum(['RasterTask']).toFixed(0), scriptMs: +sum(['FunctionCall', 'EvaluateScript', 'EventDispatch']).toFixed(0), styleLayoutMs: +sum(['UpdateLayoutTree', 'Layout']).toFixed(0), layerizeMs: +sum(['UpdateLayer', 'UpdateLayerTree', 'Layerize', 'Commit']).toFixed(0) }));
await browser.close();

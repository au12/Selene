// Differential test: JS module vs C++ watch (firmware/tests/watch_host) on random scripts, in both astronomy
// engines. The first 12 runs are the original modern-engine runs (New York, 2026); then GMW-15 logic runs across
// time zones, both hemispheres and the watch's 1986–2029 calendar.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const M = require('../shared/module.js');
const ids = M.SEGMENT_IDS;
let seed = +(process.argv[2] || 1);
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const LOCS = [[-300, 34.85, -82.39], [540, 35.68, 139.69], [0, 51.5, -0.13], [600, -33.87, 151.21],
  [330, 19.08, 72.88], [-600, 21.31, -157.86], [-180, -34.6, -58.38]];
const runs = [];
for (let i = 0; i < 12; i++) runs.push({ engine: 'modern', loc: [-300, 40.7, -74.0], year: () => 2026 });
for (let i = 0; i < 14; i++) runs.push({ engine: 'gmw15', loc: LOCS[i % LOCS.length], year: () => 1986 + Math.floor(rnd() * 44) });
const stats = {};
for (const [run, cfg] of runs.entries()) {
  const [tz, lat0, lon0] = cfg.loc;
  let rt = 1000, now = Date.UTC(cfg.year(), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27), Math.floor(rnd() * 24), Math.floor(rnd() * 60), 0) + Math.floor(rnd() * 60000);
  // the C++ side keeps lat/lon in float: give the JS the same values
  const js = new M.Module({ tzMin: tz, lat: Math.fround(lat0), lon: Math.fround(lon0), h24: false, alarmOn: false, engine: cfg.engine }, { real: () => rt });
  const ops = [], snaps = [];
  const step = (dt) => { rt += dt; now += dt; };
  const snap = () => { js.tick(now); ops.push(`T x ${now} ${rt}`); ops.push(`S x ${now} ${rt}`); snaps.push(js.segments(now).filter((s) => ids.includes(s)).map((s) => ids.indexOf(s)).sort((a, b) => a - b).join(' ')); };
  ops.push(`T x ${now} ${rt}`); js.tick(now);
  for (let i = 0; i < 260; i++) {
    const r = rnd();
    const b = 'ABCDL'[Math.floor(rnd() * 5)];
    if (r < 0.75) {
      js.press(b, now); ops.push(`P ${b} ${now} ${rt}`); snap();
      const hold = rnd() < 0.15 ? 800 + Math.floor(rnd() * 2600) : 40 + Math.floor(rnd() * 200);
      for (let t = 0; t < hold; t += 50) { step(50); js.tick(now); ops.push(`T x ${now} ${rt}`); }
      js.release(b, now); ops.push(`R ${b} ${now} ${rt}`); snap();
    } else if (r < 0.92) { step(100 + Math.floor(rnd() * 2500)); snap(); }
    else { step(Math.floor(rnd() * 90) * 60000); snap(); }
  }
  // demonstration: hold MODE past 3 s, then sample the 1/8 s animation (phase lap, marker lap, nadir mark, stars)
  js.press('C', now); ops.push(`P C ${now} ${rt}`);
  for (let t = 0; t < 3200; t += 50) { step(50); js.tick(now); ops.push(`T x ${now} ${rt}`); }
  js.release('C', now); ops.push(`R C ${now} ${rt}`); snap();
  for (let i = 0; i < 90; i++) { step(41 + Math.floor(rnd() * 90)); snap(); }
  const out = execFileSync('firmware/tests/watch_host', [cfg.engine, String(tz), String(lat0), String(lon0)],
    { input: ops.join('\n') + '\n', env: {} }).toString().trim().split('\n');
  const st = stats[cfg.engine] || (stats[cfg.engine] = { total: 0, bad: 0 });
  out.forEach((line, i) => {
    st.total++;
    if (line.trim() !== snaps[i]) {
      st.bad++;
      if (st.bad <= 3) {
        const a = new Set(line.split(' ')), bb = new Set(snaps[i].split(' '));
        const onlyC = [...a].filter((x) => !bb.has(x)).map((x) => ids[+x]), onlyJ = [...bb].filter((x) => !a.has(x)).map((x) => ids[+x]);
        console.log(`${cfg.engine} run ${run} step ${i}: only C++ [${onlyC.join(' ')}] only JS [${onlyJ.join(' ')}]`);
      }
    }
  });
}
let bad = 0;
for (const [engine, st] of Object.entries(stats)) { console.log(`${engine}: compared ${st.total} snapshots, mismatches ${st.bad}`); bad += st.bad; }
if (bad) process.exit(1);

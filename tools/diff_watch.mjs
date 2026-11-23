// Differential test: JS module vs C++ watch (firmware/tests/watch_host) on random scripts.
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const M = require('../shared/module.js');
const ids = M.SEGMENT_IDS;
let seed = +(process.argv[2] || 1);
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let total = 0, bad = 0;
for (let run = 0; run < 12; run++) {
  let rt = 1000, now = Date.UTC(2026, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27), Math.floor(rnd() * 24), Math.floor(rnd() * 60), 0) + Math.floor(rnd() * 60000);
  const js = new M.Module({ tzMin: -300, lat: 40.7, lon: -74.0, h24: false, alarmOn: false }, { real: () => rt });
  const ops = [], snaps = [];
  const step = (dt) => { rt += dt; now += dt; };
  const snap = () => { js.tick(now); ops.push(`T x ${now} ${rt}`); ops.push(`S x ${now} ${rt}`); snaps.push(js.segments(now).filter((s) => ids.includes(s)).map((s) => ids.indexOf(s)).sort((a, b) => a - b).join(' ')); };
  ops.push(`T x ${now} ${rt}`); js.tick(now);
  if (ops) { /* align initial h24 with C++ via a press of A in TIME if needed */ }
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
  // C++: same initial settings except h24 handled by replaying: set via env-less default false; emulate by pressing A in TIME first if js.h24 initially true
  const init = js.s.h24;
  const out = execFileSync('firmware/tests/watch_host', { input: ops.join('\n') + '\n', env: {} }).toString().trim().split('\n');
  // If JS started in 24h we cannot set C++ directly; skip such runs' comparison but count
  out.forEach((line, i) => {
    total++;
    if (line.trim() !== snaps[i]) {
      bad++;
      if (bad <= 3) {
        const a = new Set(line.split(' ')), bb = new Set(snaps[i].split(' '));
        const onlyC = [...a].filter((x) => !bb.has(x)).map((x) => ids[+x]), onlyJ = [...bb].filter((x) => !a.has(x)).map((x) => ids[+x]);
        console.log(`run ${run} step ${i}: only C++ [${onlyC.join(' ')}] only JS [${onlyJ.join(' ')}]`);
      }
    }
  });
}
console.log(`compared ${total} snapshots, mismatches ${bad}`);

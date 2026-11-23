// GMW-15 logic engine: shared/gmw15.js vs the C++ port (firmware/tests/gmw15_host) on random days of the
// watch's 1986–2029 calendar, then emits JSON for tools/check_gmw15.py (independent Python transcription of the
// patent + accuracy against PyEphem).  Usage: node tools/gmw15_cases.mjs | python3 tools/check_gmw15.py
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const G = require('../shared/gmw15.js');
const DAY = 86400000, HOUR = 3600000, MIN = 60000;
// whole-degree locations, as the watch stores them: [name, GMT offset (min), lat, lon]
const LOCS = [['Greenville', -300, 35, -82], ['New York', -300, 41, -74], ['London', 0, 52, 0], ['Tokyo', 540, 36, 140],
  ['Sydney', 600, -34, 151], ['Reykjavik', 0, 64, -22], ['Quito', -300, 0, -78], ['Mumbai', 330, 19, 73],
  ['Honolulu', -600, 21, -158], ['Santiago', -240, -33, -71]];
let seed = 4242;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const d0 = Date.UTC(1986, 0, 1), days = Math.round((Date.UTC(2029, 11, 31) - d0) / DAY);
const cases = [];
for (let n = 0; n < 2000; n++) {
  const [name, tz, lat, lon] = LOCS[n % LOCS.length];
  const dayLocal = d0 + Math.floor(rnd() * days) * DAY;
  const haMs = dayLocal - tz * MIN + Math.floor(rnd() * 24) * HOUR;
  const s = G.sunRiseSet(dayLocal, tz, lat, lon);
  cases.push({ name, tz, lat, lon, dayLocal, haMs, age: G.moonAge(dayLocal, tz), rise: s.rise, set: s.set,
    ev: [18, 0, 6, 12].map((h) => G.hourAngleTime(dayLocal, tz, lon, h)), ha: G.hourAngle(haMs, lon) });
}
const NO = '-9223372036854775808';
const out = execFileSync('firmware/tests/gmw15_host',
  { input: cases.map((c) => `${c.dayLocal} ${c.tz} ${c.lat} ${c.lon} ${c.haMs}`).join('\n') + '\n' }).toString().trim().split('\n');
const sameEv = (x, js) => (x === NO ? js === null : js !== null && Math.abs(+x - js) <= 1);
const sameHa = (a, b) => { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d) < 1e-7; };
let bad = 0;
out.forEach((line, i) => {
  const c = cases[i], v = line.trim().split(' ');
  const ok = Math.abs(+v[0] - c.age) < 1e-7 && sameEv(v[1], c.rise) && sameEv(v[2], c.set)
    && [0, 1, 2, 3].every((k) => sameEv(v[3 + k], c.ev[k])) && sameHa(+v[7], c.ha);
  if (!ok && ++bad <= 3) console.error('C++ vs JS mismatch:', JSON.stringify(c), '| C++:', line);
});
console.error(`GMW-15 engine C++ vs JS: ${out.length} days, mismatches ${bad}`);
if (bad || out.length !== cases.length) process.exit(1);
console.log(JSON.stringify(cases));

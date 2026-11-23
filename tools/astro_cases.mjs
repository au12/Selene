// Emits JSON of astro results for cross-checking against PyEphem (tools/check_astro.py)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const A = require('../shared/astro.js');
const locs = [['NYC',40.71,-74.01,-5],['London',51.5,-0.13,0],['Tokyo',35.68,139.69,9],['Sydney',-33.87,151.21,10],
              ['Reykjavik',64.15,-21.94,0],['Quito',-0.18,-78.47,-5],['Greenville',34.85,-82.39,-5]];
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const cases = [];
for (let n = 0; n < 40; n++) {
  const L = locs[n % locs.length];
  const ms = Date.UTC(2024, 0, 1) + Math.floor(rnd() * 6 * 365) * A.DAY + Math.floor(rnd() * 86400) * 1000;
  // local midnight in fixed offset tz
  const local = ms + L[3] * 3600000;
  const dayStart = Math.floor(local / A.DAY) * A.DAY - L[3] * 3600000;
  const m = A.moonEq(ms);
  cases.push({ loc: L[0], lat: L[1], lon: L[2], tz: L[3], ms, dayStart,
    moonRa: m.ra, moonDec: m.dec, sun: A.sunEq(ms), newMoon: A.lastNewMoon(ms), age: A.moonAge(ms),
    rs: A.sunRiseSet(dayStart, L[1], L[2]), mrs: A.moonRiseSet(dayStart, L[1], L[2]),
    ha: [0, 6, 12, 18].map(h => A.moonHourAngleTime(dayStart, L[2], h)) });
}
console.log(JSON.stringify(cases));

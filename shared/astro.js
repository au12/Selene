/*
 * Selene astronomy engine
 * Low-precision Sun & Moon positions (Paul Schlyter's method, ~1-2 arcmin for the Moon),
 * moon age from the last true new moon, sunrise/sunset, moonrise/moonset and the
 * moon hour-angle event times used by the "moon time" mode.
 *
 * Shared by the web simulator and ported 1:1 to C++ for the ESPHome firmware
 * (firmware/components/selene/astro.cpp). Keep the two in sync.
 *
 * Conventions: times are Unix milliseconds (UTC). Longitude is east-positive degrees,
 * latitude north-positive degrees. Angles in degrees unless noted.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeleneAstro = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const DAY = 86400000;
  const SYNODIC = 29.530588853;
  const DT_DAYS = 69.2 / 86400; // ΔT (TT-UT) ~2020-2030; effect on output is negligible here

  const rev = (x) => x - Math.floor(x / 360) * 360;
  const wrap180 = (x) => { x = rev(x); return x >= 180 ? x - 360 : x; };
  const sind = (x) => Math.sin(x * RAD);
  const cosd = (x) => Math.cos(x * RAD);

  /** Schlyter day number (TT): days since 2000 Jan 0.0 */
  function dayNumber(ms) { return ms / DAY + 2440587.5 - 2451543.5 + DT_DAYS; }

  /** Sun: true ecliptic longitude of date (deg), distance (AU), mean anomaly & perihelion arg */
  function sunEcl(d) {
    const w = 282.9404 + 4.70935e-5 * d;
    const e = 0.016709 - 1.151e-9 * d;
    const M = rev(356.0470 + 0.9856002585 * d);
    const E = M + DEG * e * sind(M) * (1 + e * cosd(M));
    const xv = cosd(E) - e, yv = Math.sqrt(1 - e * e) * sind(E);
    return { lon: rev(Math.atan2(yv, xv) * DEG + w), r: Math.hypot(xv, yv), M, w };
  }

  /** Moon: geocentric ecliptic lon/lat of date (deg), distance (Earth radii) */
  function moonEcl(d, sun) {
    const N = rev(125.1228 - 0.0529538083 * d);
    const i = 5.1454;
    const w = rev(318.0634 + 0.1643573223 * d);
    const a = 60.2666, e = 0.054900;
    const M = rev(115.3654 + 13.0649929509 * d);
    let E = M + DEG * e * sind(M) * (1 + e * cosd(M));
    for (let k = 0; k < 6; k++) {
      const dE = (E - DEG * e * sind(E) - M) / (1 - e * cosd(E));
      E -= dE;
      if (Math.abs(dE) < 1e-7) break;
    }
    const xv = a * (cosd(E) - e), yv = a * Math.sqrt(1 - e * e) * sind(E);
    const v = Math.atan2(yv, xv) * DEG;
    let r = Math.hypot(xv, yv);
    const vw = v + w;
    const xh = r * (cosd(N) * cosd(vw) - sind(N) * sind(vw) * cosd(i));
    const yh = r * (sind(N) * cosd(vw) + cosd(N) * sind(vw) * cosd(i));
    const zh = r * sind(vw) * sind(i);
    let lon = Math.atan2(yh, xh) * DEG;
    let lat = Math.atan2(zh, Math.hypot(xh, yh)) * DEG;
    const Ms = sun.M, Ls = sun.M + sun.w, Lm = M + w + N, D = Lm - Ls, F = Lm - N;
    lon += -1.274 * sind(M - 2 * D) + 0.658 * sind(2 * D) - 0.186 * sind(Ms)
      - 0.059 * sind(2 * M - 2 * D) - 0.057 * sind(M - 2 * D + Ms) + 0.053 * sind(M + 2 * D)
      + 0.046 * sind(2 * D - Ms) + 0.041 * sind(M - Ms) - 0.035 * sind(D)
      - 0.031 * sind(M + Ms) - 0.015 * sind(2 * F - 2 * D) + 0.011 * sind(M - 4 * D);
    lat += -0.173 * sind(F - 2 * D) - 0.055 * sind(M - F - 2 * D) - 0.046 * sind(M + F - 2 * D)
      + 0.033 * sind(F + 2 * D) + 0.017 * sind(2 * M + F);
    r += -0.58 * cosd(M - 2 * D) - 0.46 * cosd(2 * D);
    return { lon: rev(lon), lat, r };
  }

  function eclToEq(lon, lat, d) {
    const ecl = 23.4393 - 3.563e-7 * d;
    const x = cosd(lon) * cosd(lat), y = sind(lon) * cosd(lat), z = sind(lat);
    const ye = y * cosd(ecl) - z * sind(ecl);
    const ze = y * sind(ecl) + z * cosd(ecl);
    return { ra: rev(Math.atan2(ye, x) * DEG), dec: Math.atan2(ze, Math.hypot(x, ye)) * DEG };
  }

  /** Greenwich mean sidereal time, degrees */
  function gmst(ms) {
    const jd = ms / DAY + 2440587.5, t = (jd - 2451545.0) / 36525;
    return rev(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - t * t * t / 38710000);
  }

  function sunEq(ms) { const d = dayNumber(ms); const s = sunEcl(d); return eclToEq(s.lon, 0, d); }
  function moonEq(ms) {
    const d = dayNumber(ms); const s = sunEcl(d); const m = moonEcl(d, s);
    const q = eclToEq(m.lon, m.lat, d); q.r = m.r; return q;
  }

  function altitude(eq, ms, lat, lon) {
    const H = gmst(ms) + lon - eq.ra;
    return Math.asin(sind(lat) * sind(eq.dec) + cosd(lat) * cosd(eq.dec) * cosd(H)) * DEG;
  }

  /** Moon's local hour angle in hours [0,24) (geocentric) */
  function moonHourAngle(ms, lon) { return rev(gmst(ms) + lon - moonEq(ms).ra) / 15; }

  /** Moon - Sun ecliptic longitude difference [0,360) */
  function elongation(ms) {
    const d = dayNumber(ms); const s = sunEcl(d); const m = moonEcl(d, s);
    return rev(m.lon - s.lon);
  }

  /** Time of the most recent new moon at or before ms */
  function lastNewMoon(ms) {
    let t = ms - (elongation(ms) / 360) * SYNODIC * DAY;
    for (let k = 0; k < 10; k++) {
      const e = wrap180(elongation(t));
      t -= (e / 12.190749) * DAY;
      if (Math.abs(e) < 1e-6) break;
    }
    if (t > ms + 1000) return lastNewMoon(ms - 2 * DAY);
    return t;
  }

  /** Moon age in days (fractional) */
  function moonAge(ms) { return (ms - lastNewMoon(ms)) / DAY; }

  /** Illuminated fraction 0..1 and waxing flag */
  function illumination(ms) {
    const el = elongation(ms);
    return { k: (1 - cosd(el)) / 2, waxing: el < 180, elongation: el };
  }

  /** Scan [t0,t1] for sign changes of f; refine by bisection. Returns [{t, up}] */
  function roots(f, t0, t1, step, tol, guard) {
    const out = [];
    let a = t0, fa = f(a);
    while (a < t1) {
      const b = Math.min(a + step, t1), fb = f(b);
      if ((fa < 0) !== (fb < 0) && (!guard || (Math.abs(fa) < guard && Math.abs(fb) < guard))) {
        let lo = a, hi = b, flo = fa;
        while (hi - lo > tol) {
          const mid = (lo + hi) / 2, fm = f(mid);
          if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
        }
        out.push({ t: (lo + hi) / 2, up: fa < 0 });
      }
      a = b; fa = fb;
    }
    return out;
  }

  /** Sunrise/sunset during [dayStart, dayStart+24h). h0 = -0.833° (sea level, refraction, semi-diameter) */
  function sunRiseSet(dayStart, lat, lon) {
    const f = (t) => altitude(sunEq(t), t, lat, lon) + 0.833;
    const r = roots(f, dayStart, dayStart + DAY, 20 * 60000, 5000);
    const rise = r.find((x) => x.up), set = r.find((x) => !x.up);
    return { rise: rise ? rise.t : null, set: set ? set.t : null };
  }

  /** Moonrise/moonset during the local day (geocentric altitude with parallax-corrected h0) */
  function moonRiseSet(dayStart, lat, lon) {
    const f = (t) => {
      const q = moonEq(t);
      const h0 = 0.7275 * (Math.asin(1 / q.r) * DEG) - 0.5667;
      return altitude(q, t, lat, lon) - h0;
    };
    const r = roots(f, dayStart, dayStart + DAY, 20 * 60000, 5000);
    const rise = r.find((x) => x.up), set = r.find((x) => !x.up);
    return { rise: rise ? rise.t : null, set: set ? set.t : null };
  }

  /** Time the moon's hour angle equals `hours` (0,6,12,18) during the local day, or null */
  function moonHourAngleTime(dayStart, lon, hours) {
    const target = hours * 15;
    const f = (t) => wrap180(gmst(t) + lon - moonEq(t).ra - target);
    const r = roots(f, dayStart, dayStart + DAY, 30 * 60000, 5000, 90);
    const up = r.find((x) => x.up);
    return up ? up.t : null;
  }

  /** Index 0..8 of the 9-position moon arc from a displayed (0.1-day) age */
  function phaseIndex(age) {
    const a = Math.floor(age * 10 + 1e-6) / 10;
    const lim = [1.8, 5.5, 9.2, 12.9, 16.6, 20.2, 23.9, 27.6];
    for (let i = 0; i < lim.length; i++) if (a <= lim[i] + 1e-9) return i;
    return 8;
  }

  /** Index 0..12 of the hour-angle track (0 = east horizon/18h, 6 = meridian/0h, 12 = west/6h), or -1 */
  function hourAngleIndex(haHours) {
    const h = ((haHours + 6) % 24 + 24) % 24;
    if (h >= 23.5) return 0;
    if (h < 12.5) return Math.floor(h + 0.5);
    return -1;
  }

  function round5(ms) { return Math.round(ms / 300000) * 300000; }

  return {
    DAY, SYNODIC, rev, wrap180, dayNumber, gmst, sunEq, moonEq, altitude, moonHourAngle,
    elongation, lastNewMoon, moonAge, illumination, sunRiseSet, moonRiseSet, moonHourAngleTime,
    phaseIndex, hourAngleIndex, round5, roots,
  };
});

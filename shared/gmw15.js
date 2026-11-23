/*
 * Selene "GMW-15 logic" astronomy engine
 *
 * Casio's own low-precision method for a moon-data watch, transcribed from its patent family
 * EP 0 400 542 B1 / US 5,208,790 "Astronomical data indicating device" (Hiroshi Sato, Casio Hamura R&D
 * Center, priority JP 29 May 1989). The patent's watch shows the GMW-15's data set: the moon's hour angle on
 * a segment strip marked 0/6/12/18, a nine-step phase graph, moon age, and sunrise/sunset, all from a GMT
 * offset and a latitude/longitude. It was filed three years after the GMW-15 (module 832, 1986), so this is
 * Casio's documented method from the same lineage, not a ROM dump.
 *
 * What a 4-bit watch chip can afford, and how the engineers got there:
 *  - one day count from 1900 with INT/FRAC tricks → Julian centuries from J2000.0
 *  - the Moon's right ascension from a seven-term cosine series written directly in hours (no ecliptic →
 *    equator rotation: that conversion is folded into the series as a term at twice the mean longitude)
 *  - the Greenwich hour angle of the Moon at 0h UT today and tomorrow gives the length of the lunar day;
 *    every other moon time is linear interpolation, and the hour angle is recalculated once an hour
 *  - moon "times" are hour-angle crossings (0h/6h/12h/18h), so the Moon needs no declination and no latitude
 *  - moon age from the Moon–Sun elongation (two-term Moon, one-term Sun) scaled by a flat 29.53 days
 *  - the Sun: a day-of-year equation of time, a six-term declination series (the terms match Y. Kubo's 1980
 *    Japan Hydrographic Department series for calculator users, valid 1970–2030) and the arccos half-day arc
 *
 * RECON marks places where the patent's OCR text is garbled and a value had to be reconstructed.
 * CHOICE marks interpretation choices (which instant a daily value belongs to). Comparing against a real
 * watch settles them; see the watch log in the web app.
 *
 * Conventions follow astro.js: times are Unix ms (UTC); `dayLocal` is local midnight expressed as local ms
 * (the module's convention); longitude east-positive degrees; hours as decimals.
 * Ported 1:1 to C++ in firmware/components/selene/gmw15.cpp — keep the two in sync.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeleneGMW15 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000, HOUR = 3600000, MIN = 60000;
  const RAD = Math.PI / 180;
  /** Mean synodic month the watch assumes (the real one varies from ~29.2 to ~29.8 days). */
  const SYNODIC = 29.53;
  /** Horizon term of the half-day arc, as printed: B = −0.017 / (cos φ · cos δ), i.e. the Sun's centre about
   *  0.97° below the horizon. The conventional −0.833° would be 0.0145; this makes each day ~1.5 min longer. */
  const HORIZON = 0.017;

  const frac = (x) => x - Math.floor(x);
  const INT = Math.floor;
  const rev = (x) => x - Math.floor(x / 360) * 360;
  const mod24 = (x) => x - Math.floor(x / 24) * 24;
  const cosd = (x) => Math.cos(rev(x) * RAD);
  const sind = (x) => Math.sin(rev(x) * RAD);
  /** The watch keeps its location in whole degrees. Round half up (identical in JS and C++). */
  const wholeDeg = (x) => Math.floor(x + 0.5);

  /** Patent day count Z: day number counted from 1900 (it is JD − 2414988.5), plus hours as a fraction.
   *  W=(YE−1900)/4, F=FRAC(W), A=INT(1461·W), B=INT[(MN+7)/10], C=INT(1−F), D=INT[0.44·(MN+4.4)],
   *  Z = A + 31·MN + DA + (B−1)·C − B·D + HO/24.  Valid 1901–2099. */
  function dayCount(ye, mn, da, ho) {
    const W = (ye - 1900) / 4, F = frac(W), A = INT(1461 * W);
    const B = INT((mn + 7) / 10), C = INT(1 - F), D = INT(0.44 * (mn + 4.4));
    return A + 31 * mn + da + (B - 1) * C - B * D + (ho || 0) / 24;
  }
  /** Z of the calendar date of a (local or UTC) ms value at 0h. */
  function zDay(ms) {
    const d = new Date(Math.floor(ms / DAY) * DAY);
    return dayCount(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0);
  }
  /** Julian centuries from 2000 Jan 1, 12h (t = (Z − 36556.5) / 36525). */
  const centuries = (Z) => (Z - 36556.5) / 36525;

  /** Greenwich sidereal time at 0h UT, hours. Patent: K = 24·FRAC(0.0027379·Y), Y = Z − 25012 (JD − 2440000.5).
   *  At 0h UT, Y is a whole number, so the integer part of 1.0027379·Y can be dropped.
   *  RECON: the printed line has lost its epoch term; 0.671262 rev is the standard value for that epoch. */
  function gst0(Z0) { return 24 * frac(0.671262 + 0.0027379 * (Z0 - 25012)); }

  /** The Moon's right ascension in hours, seven-term series (patent, verbatim). Decoded: mean longitude,
   *  equation of centre (6.29°), reduction to the equator (2.45° at twice the mean longitude), evection
   *  (1.27°), two node terms, variation (0.66°). */
  function moonRA(T) {
    const a = 32084.52539 * T + 14.55441
      + 0.41925 * cosd(477198.868 * T + 44.963)
      + 0.16358 * cosd(962535.762 * T + 166.633)
      + 0.08494 * cosd(413335.350 * T + 10.740)
      + 0.07104 * cosd(1934.140 * T + 324.960)
      + 0.07048 * cosd(964469.900 * T + 41.590)
      + 0.04389 * cosd(890534.220 * T + 145.700);
    return 24 * frac(a / 24);
  }

  /** Greenwich hour angle of the Moon at 0h UT of day Z0 (JK = K − α, in hours). */
  function gha0(Z0) { return mod24(gst0(Z0) - moonRA(centuries(Z0))); }

  /** Lunar day in hours from two consecutive 0h UT hour angles: LNR = 576 / DJK (or DJK + 24). */
  function lunarDay(Z0) {
    const djk = gha0(Z0 + 1) - gha0(Z0);
    return djk > 0 ? 576 / djk : 576 / (djk + 24);
  }

  /** The Moon's local hour angle (hours, [0,24)) at UTC `ms`, by linear interpolation from 0h UT. */
  function hourAngle(ms, lon) {
    const dayUT = Math.floor(ms / DAY) * DAY, Z0 = zDay(dayUT);
    return mod24(gha0(Z0) + lon / 15 + ((ms - dayUT) / HOUR) * 24 / lunarDay(Z0));
  }

  /** UTC ms at which the Moon's local hour angle reaches `h` (0, 6, 12, 18) during the local day `dayLocal`,
   *  or null when the lunar day steps over it. Anchored at 0h UT of the same calendar date, as in the patent's
   *  worked example (Tokyo); the event recurs every lunar day (> 24 h), so at most one falls in a day. */
  function hourAngleTime(dayLocal, tzMin, lon, h) {
    const Z0 = zDay(dayLocal), H0 = gha0(Z0), L = lunarDay(Z0);
    let x = mod24(h - lon / 15 - H0) * L / 24 + tzMin / 60;   // local clock hours after midnight, mod L
    x -= Math.floor(x / L) * L;
    if (x >= 24) return null;
    return Math.trunc(dayLocal - tzMin * MIN + x * HOUR);
  }

  /** Moon age in days for the local date `dayLocal`. Patent: age = 29.53·E/360 − (time difference)/24 − 0.5,
   *  E = λ(Moon) − λ(Sun). CHOICE: E taken at 0h UT of the following date (the last value the patent's flow
   *  computes), which makes this the age at local noon — the Japanese almanac convention (正午月齢). */
  function moonAge(dayLocal, tzMin) {
    const T = centuries(zDay(dayLocal) + 1);
    // RECON: the OCR reads 4572000 and 360000 for the two anomaly rates; 477200 and 36000 fit the other terms.
    const lm = 481267.9 * T + 218.3 + 6.3 * cosd(45 + 477200 * T) + 1.3 * cosd(11 + 413300 * T);
    const ls = 36000.8 * T + 280.5 + 1.9 * cosd(268 + 36000 * T);
    let age = SYNODIC * rev(lm - ls) / 360 - tzMin / 1440 - 0.5;
    if (age < 0) age += SYNODIC;
    else if (age >= SYNODIC) age -= SYNODIC;
    return age;
  }

  /** Equation of time in seconds for day-of-year t3 (patent: C + D). RECON: OCR reads 360/360.25. */
  function equationOfTime(t3) {
    const A = (t3 - 80.5) * 360 / 365.25, B = (t3 - 4.5) * 360 / 365.25;
    return -460.64 * sind(B) - 4.82 * sind(2 * B) + 592.32 * sind(2 * A) - 12.76 * sind(4 * A);
  }

  /** The Sun's declination in degrees, six-term series (patent; Kubo 1980). */
  function sunDec(T) {
    return 23.26 * cosd(36001 * T + 190) + 0.39 * cosd(2 * T + 13) + 0.39 * cosd(72000 * T + 188)
      + 0.16 * cosd(108002 * T + 211) + 0.01 * cosd(72003 * T + 34) + 0.01 * cosd(144001 * T + 209);
  }

  /** Sunrise and sunset (UTC ms, or null in polar day/night) for the local date `dayLocal`.
   *  Median (solar noon) = 12 − longitude/15 + GMT difference − EoT/3600; SSTN = arccos(B − A)/15 with
   *  A = tan φ·tan δ and B = −0.017/(cos φ·cos δ). CHOICE: δ evaluated at the median time. */
  function sunRiseSet(dayLocal, tzMin, lat, lon) {
    const d = new Date(Math.floor(dayLocal / DAY) * DAY);
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
    const t3 = dayCount(y, mo, da, 0) - dayCount(y, 1, 0, 0);
    const tzH = tzMin / 60;
    const median = 12 - lon / 15 + tzH - equationOfTime(t3) / 3600;
    const dec = sunDec(centuries(dayCount(y, mo, da, median - tzH)));
    const A = Math.tan(lat * RAD) * Math.tan(dec * RAD), B = -HORIZON / (Math.cos(lat * RAD) * Math.cos(dec * RAD));
    const x = B - A;
    if (x < -1 || x > 1) return { rise: null, set: null };
    const sstn = Math.acos(x) / RAD / 15;
    const base = dayLocal - tzMin * MIN;
    return { rise: Math.trunc(base + (median - sstn) * HOUR), set: Math.trunc(base + (median + sstn) * HOUR) };
  }

  return {
    SYNODIC, HORIZON, wholeDeg, dayCount, zDay, centuries, gst0, moonRA, gha0, lunarDay, hourAngle,
    hourAngleTime, moonAge, equationOfTime, sunDec, sunRiseSet,
  };
});

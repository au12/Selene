/*
 * Selene watch module — the behaviour of a 1989-era moon-data LCD watch module, re-implemented.
 * Drives the logical segment set shared by every face (see faces.js).
 *
 * Buttons: A = FWD (lower right), B = SET (upper left), C = MODE (lower left), D = REV (upper right),
 *          L = LIGHT/SNOOZE (desk clock only).
 * Modes:   TIME → MOON (moon time) → SUN (sunrise/sunset) → ALM (alarm) → ST (stopwatch) → TIME
 *
 * Time model: the module is given `now` (UTC ms, possibly simulated). Watch UTC = now + userOffset.
 * Local watch time = watch UTC + tzMin. Location = lat/lon (degrees, east positive).
 *
 * Ported 1:1 to C++ in firmware/components/selene/watch_logic.cpp — keep in sync.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./astro.js'));
  else root.SeleneModule = factory(root.SeleneAstro);
})(typeof self !== 'undefined' ? self : this, function (A) {
  'use strict';
  const DAY = 86400000, HOUR = 3600000, MIN = 60000;

  // 5x7 dot-matrix font (rows top→bottom, bit4 = leftmost column)
  const FONT = {
    ' ': [0, 0, 0, 0, 0, 0, 0], '\'': [0x0C, 0x04, 0x08, 0, 0, 0, 0], '-': [0, 0, 0, 0x1F, 0, 0, 0],
    '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E], '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
    '2': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F], '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
    '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02], '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
    '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E], '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
    '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E], '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
    A: [0x0E, 0x11, 0x11, 0x11, 0x1F, 0x11, 0x11], B: [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
    C: [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E], D: [0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C],
    E: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F], F: [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
    G: [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F], H: [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
    I: [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
    K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
    M: [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
    O: [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E], P: [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
    Q: [0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D], R: [0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11],
    S: [0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E], T: [0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
    U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04],
    W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A], X: [0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11],
    Y: [0x11, 0x11, 0x11, 0x0A, 0x04, 0x04, 0x04], Z: [0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F],
  };
  // 7-segment encodings
  const SEG7 = {
    ' ': '', '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg',
    '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', n: 'ceg', S: 'acdfg', E: 'adefg', W: 'bcdefw', o: 'cdeg',
  };
  const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  // Canonical logical segment order (firmware indices; see tools/gen_segments.mjs → segments.h)
  const SEGMENT_IDS = (() => {
    const o = [];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) o.push(`x${c}${r}${k}`);
    o.push('xdp');
    for (let n = 0; n < 4; n++) for (const s of 'abcdefg') o.push(`t${n}${s}`);
    o.push('tdash', 'tcol');
    for (let n = 0; n < 6; n++) for (const s of 'abcdefg') o.push(`b${n}${s}`);
    o.push('b5w', 'bcol', 'pm', 'h24', 'alm', 'chm', 'lage', 'lmoon', 'lrise', 'lset');
    for (let k = 0; k < 9; k++) o.push('p' + k);
    for (let k = 0; k < 13; k++) o.push('h' + k);
    o.push('sune', 'sunw');
    for (let k = 0; k < 9; k++) o.push('r' + k);
    for (let k = 0; k < 60; k++) o.push('q' + k);
    for (let k = 0; k < 18; k++) o.push('s' + k);
    o.push('hn');
    return o;
  })();
  const MODES = ['TIME', 'MOON', 'SUN', 'ALM', 'ST'];
  /**
   * Star field: 18 star segments (s0 = leftmost … s17 = rightmost) are re-drawn on every second tick, in every
   * mode, from the ones digit of the running seconds. Bit k of STARS[d] = star k lit while seconds % 10 === d.
   * The table was read off the real module frame by frame; it repeats every ten seconds.
   */
  const STARS = [0x37f8f, 0x3367e, 0x2ee4d, 0x2a2bc, 0x27a8b, 0x2317a, 0x1e949, 0x185b8, 0x15d87, 0x11476];
  /** Demonstration: one tick is 1/8 s. The hour-angle marker runs a 24-step lap (13 sky positions, then the
   *  nadir mark alone at step 18); the phase advances every second tick. */
  const DEMO_TICK = 125;

  function defaults() {
    let tz = 0;
    try { tz = -new Date().getTimezoneOffset(); } catch (e) { /* ignore */ }
    return { tzMin: tz, lat: 40.7, lon: -74.0, h24: false, alarmH: 7, alarmM: 0, alarmOn: false, chimeOn: false,
      userOffset: 0, dowOffset: 0, authentic: false, snoozeMin: 5 };
  }

  class Module {
    constructor(settings, hooks) {
      this.s = Object.assign(defaults(), settings || {});
      this.hooks = hooks || {};          // emit(evt, data), save(settings)
      this.mode = 'TIME';
      this.set = null;                   // {kind:'time'|'loc'|'alm', field}
      this.sel = null;                   // MOON/SUN selected date: {day (local midnight as local-ms), changed, readyAt}
      this.cycleAt = 0;
      this.sw = { running: false, start: 0, acc: 0, split: null };
      this.demo = null;                  // {start}
      this.ring = null;                  // {until}
      this.snoozeAt = null;
      this.held = {};                    // btn -> {t, last, rep}
      this.lastUse = 0;
      this.afterOp = false;              // "C after operation returns to TIME"
      this.lastSec = null;
      this._cur = { key: null };
      this._dayCache = new Map();
      this.light = 0;
      this.rt = this.hooks.real || (() => Date.now()); // real (UI) clock: holds, blinks, delays, stopwatch
    }

    // ------------------------------------------------------------ time helpers
    utc(now) { return now + this.s.userOffset; }
    local(now) { return this.utc(now) + this.s.tzMin * MIN; }
    parts(localMs) {
      const d = new Date(localMs);
      return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(),
        mi: d.getUTCMinutes(), s: d.getUTCSeconds(), ms: d.getUTCMilliseconds(), dow: d.getUTCDay() };
    }
    emit(evt, data) { if (this.hooks.emit) this.hooks.emit(evt, data); }
    save() { if (this.hooks.save) this.hooks.save(this.s); }

    // ------------------------------------------------------------ astronomy (cached)
    current(now) {
      const t = this.utc(now), key = Math.floor(t / 1000) + '|' + this.s.lat + '|' + this.s.lon;
      if (this._cur.key !== key) {
        const age = A.moonAge(t);
        this._cur = { key, age, phase: A.phaseIndex(age), ha: A.moonHourAngle(t, this.s.lon) };
        this._cur.haIdx = A.hourAngleIndex(this._cur.ha);
      }
      return this._cur;
    }
    dayData(dayLocal) {
      const key = dayLocal + '|' + this.s.lat + '|' + this.s.lon + '|' + this.s.tzMin;
      let v = this._dayCache.get(key);
      if (!v) {
        const start = dayLocal - this.s.tzMin * MIN; // UTC ms of local midnight
        const noon = start + 12 * HOUR;
        const age = A.moonAge(noon);
        const sun = A.sunRiseSet(start, this.s.lat, this.s.lon);
        const ev = [18, 0, 6, 12].map((h) => A.moonHourAngleTime(start, this.s.lon, h));
        v = { age, phase: A.phaseIndex(age), sun, ev };
        if (this._dayCache.size > 64) this._dayCache.clear();
        this._dayCache.set(key, v);
      }
      return v;
    }
    todayLocal(now) { return Math.floor(this.local(now) / DAY) * DAY; }

    // ------------------------------------------------------------ buttons
    press(btn, now) {
      const rt = this.rt();
      this.lastUse = rt;
      this.held[btn] = { t: rt, last: rt, rep: false };
      if (this.ring) { this.stopAlarm(); this.held[btn].consumed = true; if (btn === 'L') this.snooze(now); return; }
      if (this.demo) { this.demo = null; this.held[btn].consumed = true; return; }
      if (btn === 'L') { this.light = rt; this.emit('light'); return; }
      this.handle(btn, now, false);
    }
    release(btn, now) {
      const h = this.held[btn];
      delete this.held[btn];
      if (!h) return;
      if (this.mode === 'ALM' && !this.set && btn === 'A' && !h.consumed) this.emit('test-stop');
      if ((this.mode === 'MOON' || this.mode === 'SUN') && (btn === 'A' || btn === 'D') && this.sel) {
        this.sel.readyAt = this.rt() + (this.s.authentic ? 20000 : 1800);
      }
    }
    /** auto-repeat & long-press handling; call every frame/tick */
    tick(now) {
      const rt = this.rt();
      for (const [btn, h] of Object.entries(this.held)) {
        if (h.consumed) continue;
        const dt = rt - h.t;
        if (btn === 'C' && dt > 3000 && !h.demo) { // hold MODE: demonstration
          h.demo = true; this.set = null; this.mode = 'TIME'; this.sel = null; this.demo = { start: rt };
          continue;
        }
        const repeatable = (btn === 'A' || btn === 'D') && (this.set || this.mode === 'MOON' || this.mode === 'SUN');
        if (repeatable && dt > 800) {
          const every = (this.mode === 'MOON' || this.mode === 'SUN') && !this.set ? 140 : 110;
          if (h.last < h.t + 800) h.last = h.t + 800 - every;
          while (rt - h.last >= every) { h.last += every; h.rep = true; this.handle(btn, now, true); }
        }
      }
      // auto-exit idle settings
      if (this.set && rt - this.lastUse > 180000) { this.set = null; if (this.mode !== 'ALM') this.mode = 'TIME'; }
      // alarm, chime, snooze
      const p = this.parts(this.local(now));
      const secKey = Math.floor(this.local(now) / 1000);
      if (this.lastSec !== null && secKey !== this.lastSec && secKey - this.lastSec < 5) {
        if (p.s === 0) {
          if (this.s.alarmOn && p.h === this.s.alarmH && p.mi === this.s.alarmM && !this.set) this.startAlarm(now);
          else if (this.snoozeAt !== null && this.local(now) >= this.snoozeAt) { this.snoozeAt = null; this.startAlarm(now); }
          if (this.s.chimeOn && p.mi === 0 && !this.ring) this.emit('chime');
        }
      }
      this.lastSec = secKey;
      if (this.ring && rt > this.ring.until) this.stopAlarm();
      // stopwatch wraps at 24h
      if (this.sw.running && this.swElapsed() >= DAY) { this.sw.acc = 0; this.sw.start = rt; }
    }
    startAlarm(now) { this.ring = { until: this.rt() + 20000 }; this.emit('alarm-start'); }
    stopAlarm() { if (this.ring) { this.ring = null; this.emit('alarm-stop'); } }
    snooze(now) { this.snoozeAt = Math.floor(this.local(now) / MIN) * MIN + this.s.snoozeMin * MIN; this.emit('snooze'); }

    nextMode(now) {
      this.set = null;
      if (this.afterOp && this.mode !== 'TIME') { this.afterOp = false; return this.enter('TIME', now); }
      this.afterOp = false;
      this.enter(MODES[(MODES.indexOf(this.mode) + 1) % MODES.length], now);
    }
    enter(mode, now) {
      this.mode = mode;
      this.sel = null;
      if (mode === 'MOON' || mode === 'SUN') {
        this.sel = { day: this.todayLocal(now), changed: false, readyAt: this.rt() + (this.s.authentic ? 3500 : 1600) };
        this.cycleAt = this.sel.readyAt;
      }
    }

    handle(btn, now, repeat) {
      const S = this.s, set = this.set;
      // ---------------- setting states
      if (set && set.kind === 'time') {
        if (btn === 'C') set.field = (set.field + 1) % 7;
        else if (btn === 'B') { this.set = { kind: 'loc', field: 0 }; }
        else if (btn === 'A') this.adjustTime(set.field, now);
        return;
      }
      if (set && set.kind === 'loc') {
        if (btn === 'C') set.field = (set.field + 1) % 3;
        else if (btn === 'B') { this.set = null; this.save(); }
        else if (btn === 'A' || btn === 'D') {
          const dir = btn === 'D' ? 1 : -1;
          if (set.field === 0) {
            if (btn === 'A') S.tzMin = S.tzMin >= 14 * 60 ? -12 * 60 : Math.round(S.tzMin / 60) * 60 + 60;
            else S.tzMin = S.tzMin <= -12 * 60 ? 14 * 60 : Math.round(S.tzMin / 60) * 60 - 60;
          } else if (set.field === 1) { // longitude: D → east, A → west; range 179W..180E
            let lo = Math.round(S.lon) + dir;
            if (lo > 180) lo = -179; if (lo < -179) lo = 180;
            S.lon = lo;
          } else { // latitude: D → north, A → south; 65N..65S
            S.lat = Math.max(-65, Math.min(65, Math.round(S.lat) + dir));
          }
          this._cur.key = null;
        }
        return;
      }
      if (set && set.kind === 'alm') {
        if (btn === 'C') set.field ^= 1;
        else if (btn === 'B') { this.set = null; this.afterOp = true; this.save(); }
        else if (btn === 'A') {
          if (set.field === 0) S.alarmH = (S.alarmH + 1) % 24; else S.alarmM = (S.alarmM + 1) % 60;
        }
        return;
      }
      if (repeat && !(this.mode === 'MOON' || this.mode === 'SUN')) return;
      // ---------------- normal modes
      if (btn === 'C') return this.nextMode(now);
      switch (this.mode) {
        case 'TIME':
          if (btn === 'A') { S.h24 = !S.h24; this.save(); }
          else if (btn === 'B') this.set = { kind: 'time', field: 0 };
          else if (btn === 'D') this.enter('SUN', now);
          break;
        case 'MOON': case 'SUN':
          if (btn === 'A' || btn === 'D') {
            this.sel.day += btn === 'A' ? DAY : -DAY;
            this.sel.changed = true; this.afterOp = true;
            this.sel.readyAt = Infinity; // recalculated on release
          }
          break;
        case 'ALM':
          if (btn === 'B') this.set = { kind: 'alm', field: 0 };
          else if (btn === 'D') {
            const st = (S.alarmOn ? 1 : 0) + (S.chimeOn ? 2 : 0), nx = (st + 1) % 4;
            S.alarmOn = !!(nx & 1); S.chimeOn = !!(nx & 2); this.save();
          } else if (btn === 'A') this.emit('test-start');
          break;
        case 'ST':
          if (btn === 'A') {
            const rt = this.rt();
            if (this.sw.running) { this.sw.acc += rt - this.sw.start; this.sw.running = false; }
            else { this.sw.start = rt; this.sw.running = true; }
            this.emit('key');
          } else if (btn === 'D') {
            if (this.sw.split !== null) this.sw.split = null;
            else if (this.sw.running) this.sw.split = this.swElapsed();
            else { this.sw.acc = 0; this.sw.split = null; }
            this.emit('key');
          }
          break;
      }
    }

    adjustTime(field, now) {
      const S = this.s;
      if (field === 6) { S.dowOffset = (S.dowOffset + 1) % 7; this.save(); return; }
      const loc = this.local(now), p = this.parts(loc);
      let { y, mo, d, h, mi, s } = p;
      if (field === 0) { if (s >= 30) mi += 1; s = 0; }
      else if (field === 1) h = (h + 1) % 24;
      else if (field === 2) mi = (mi + 1) % 60;
      else if (field === 3) y = y >= 2099 ? 2000 : y + 1;
      else if (field === 4) mo = mo % 12 + 1;
      else if (field === 5) d = d % new Date(Date.UTC(y, mo, 0)).getUTCDate() + 1;
      const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      if (d > dim) d = dim;
      const target = Date.UTC(y, mo - 1, d, h, mi, s, field === 0 ? 0 : p.ms);
      // keep the day-of-week label consistent with the calendar when the date itself changes
      S.userOffset += target - loc;
      this._cur.key = null;
      this.save();
    }

    swElapsed() { return this.sw.acc + (this.sw.running ? this.rt() - this.sw.start : 0); }

    // ------------------------------------------------------------ display
    /** Returns an array of lit logical segment ids for time `now`. */
    segments(now) {
      const on = [];
      const S = this.s;
      const rt = this.rt();
      const blink = (rt % 1000) < 560 || Object.keys(this.held).some((b) => b === 'A' || b === 'D');
      const loc = this.local(now), p = this.parts(loc);
      const dm = (str) => {
        for (let c = 0; c < 3; c++) {
          const rows = FONT[str[c] || ' '] || FONT[' '];
          for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (rows[r] & (16 >> k)) on.push('x' + c + r + k);
        }
      };
      const d7 = (pre, ch) => { const m = SEG7[ch]; if (m) for (const s of m) on.push(pre + s); };
      const two = (n, pad) => (n < 10 ? (pad === undefined ? ' ' : pad) + n : '' + n);
      const smallMD = (mo, d) => { const a = two(mo), b = two(d); d7('t0', a[0]); d7('t1', a[1]); on.push('tdash'); d7('t2', b[0]); d7('t3', b[1]); };
      const bigHM = (h, mi, show = [true, true]) => {
        let hh = h, pm = false;
        if (!S.h24) { pm = h >= 12; hh = h % 12 || 12; }
        const hs = two(hh);
        if (show[0]) { d7('b0', hs[0]); d7('b1', hs[1]); }
        if (show[1]) { const ms = two(mi, '0'); d7('b2', ms[0]); d7('b3', ms[1]); }
        if (pm) on.push('pm');
        if (S.h24) on.push('h24');
        on.push('bcol');
      };
      const icons = () => { if (S.alarmOn) on.push('alm'); if (S.chimeOn) on.push('chm'); };
      const dow = (p.dow + S.dowOffset) % 7;

      // ---------------- moon graph
      const cur = this.current(now);
      // hai: 0..12 = marker position, 13 = nadir mark (moon at lower transit), -1 = nothing
      let ph = -1, hai = -1, suns = false, refl = true;
      if (this.demo) {
        const k = Math.floor((rt - this.demo.start) / DEMO_TICK), lap = k % 24;
        ph = (k >> 1) % 9; hai = lap < 13 ? lap : lap === 18 ? 13 : -1;
      } else if (this.set && this.set.kind !== 'alm') {
        ph = -1;
      } else if ((this.mode === 'MOON' || this.mode === 'SUN') && this.sel) {
        const ready = rt >= this.sel.readyAt;
        if (this.mode === 'SUN') suns = true;
        if (ready) {
          const dd = this.dayData(this.sel.day);
          ph = dd.phase;
          if (this.mode === 'MOON') hai = [0, 6, 12, 13][this.moonCycle()];
        }
      } else { ph = cur.phase; hai = cur.haIdx; }
      if (ph >= 0) on.push('p' + ph);
      if (hai === 13) on.push('hn');
      else if (hai >= 0) { on.push('h' + hai); if (ph >= 0 && refl) on.push('r' + ph); }
      if (suns) on.push('sune', 'sunw');
      for (let k = 0, m = STARS[p.s % 10]; k < 18; k++) if (m >> k & 1) on.push('s' + k);

      // ---------------- LCD
      if (this.set && this.set.kind === 'time') {
        const f = this.set.field;
        if (f === 6) { if (blink) dm(DOW[dow]); } else if (f !== 3 || blink) dm('\'' + String(p.y % 100).padStart(2, '0'));
        const a = two(p.mo), b = two(p.d);
        if (f !== 4 || blink) { d7('t0', a[0]); d7('t1', a[1]); }
        on.push('tdash');
        if (f !== 5 || blink) { d7('t2', b[0]); d7('t3', b[1]); }
        bigHM(p.h, p.mi, [f !== 1 || blink, f !== 2 || blink]);
        if (f !== 0 || blink) { const ss = two(p.s, '0'); d7('b4', ss[0]); d7('b5', ss[1]); }
        return on;
      }
      if (this.set && this.set.kind === 'loc') {
        const f = this.set.field;
        if (f === 0) {
          dm('GMT');
          if (blink) this.gmtSmall(on, d7);
          bigHM(p.h, p.mi);
          const ss = two(p.s, '0'); d7('b4', ss[0]); d7('b5', ss[1]);
        } else {
          dm(f === 1 ? 'LO' : 'LA');
          if (f !== 2 || blink) {
            const la = Math.round(Math.abs(S.lat)), las = two(la);
            d7('t0', las[0]); d7('t1', las[1]); d7('t3', S.lat >= 0 ? 'n' : 'S');
          }
          if (f !== 1 || blink) {
            const lo = Math.round(Math.abs(S.lon)), los = String(lo).padStart(3, ' ');
            d7('b1', los[0]); d7('b2', los[1]); d7('b3', los[2]);
            d7('b5', S.lon >= 0 || lo === 180 ? 'E' : 'W');
          }
        }
        return on;
      }

      switch (this.mode) {
        case 'TIME': {
          dm(DOW[dow]); smallMD(p.mo, p.d); bigHM(p.h, p.mi);
          const ss = two(p.s, '0'); d7('b4', ss[0]); d7('b5', ss[1]); icons();
          for (let i = 0; i <= p.s; i++) on.push('q' + i);
          break;
        }
        case 'MOON': case 'SUN': {
          const sel = this.sel, dp = this.parts(sel.day);
          const ready = rt >= sel.readyAt;
          if (!ready) {
            dm(DOW[(dp.dow + S.dowOffset) % 7]); smallMD(dp.mo, dp.d);
            const yy = String(dp.y % 100).padStart(2, '0'); d7('b4', yy[0]); d7('b5', yy[1]);
            break;
          }
          const dd = this.dayData(sel.day);
          this.ageDM(on, dm, dd.age);
          on.push('lage');
          if (this.mode === 'MOON') {
            smallMD(dp.mo, dp.d);
            const k = this.moonCycle(), t = dd.ev[k];
            on.push('lmoon');
            if (t === null) { on.push('b1g', 'bcol', 'b2g', 'b3g'); }
            else { const q = this.parts(A.round5(t) + S.tzMin * MIN); bigHM(q.h, q.mi); }
            d7('b4', '-'); d7('b5', String(k + 1));
          } else {
            on.push('lrise', 'lset');
            const r = dd.sun.rise, st = dd.sun.set;
            if (r === null) { on.push('t1g', 'tcol', 't2g', 't3g'); }
            else {
              const q = this.parts(A.round5(r) + S.tzMin * MIN);
              let hh = q.h; if (!S.h24) hh = hh % 12 || 12;
              const hs = two(hh), ms = two(q.mi, '0');
              d7('t0', hs[0]); d7('t1', hs[1]); on.push('tcol'); d7('t2', ms[0]); d7('t3', ms[1]);
            }
            if (st === null) { on.push('b1g', 'bcol', 'b2g', 'b3g'); }
            else { const q = this.parts(A.round5(st) + S.tzMin * MIN); bigHM(q.h, q.mi); }
          }
          break;
        }
        case 'ALM': {
          dm('ALM'); icons();
          const f = this.set ? this.set.field : -1;
          bigHM(S.alarmH, S.alarmM, [f !== 0 || blink, f !== 1 || blink]);
          break;
        }
        case 'ST': {
          const el = this.sw.split !== null ? this.sw.split : this.swElapsed();
          dm(this.sw.split !== null ? 'SPL' : 'ST');
          const cs = Math.floor(el / 10) % 100, sec = Math.floor(el / 1000) % 60, mi = Math.floor(el / MIN) % 60, h = Math.floor(el / HOUR) % 24;
          const cst = two(cs, '0'); d7('t2', cst[0]); d7('t3', cst[1]);
          const hs = two(h); d7('b0', hs[0]); d7('b1', hs[1]); on.push('bcol');
          const ms = two(mi, '0'); d7('b2', ms[0]); d7('b3', ms[1]);
          const ss = two(sec, '0'); d7('b4', ss[0]); d7('b5', ss[1]);
          icons();
          break;
        }
      }
      return on;
    }
    moonCycle() { return Math.max(0, Math.floor((this.rt() - Math.max(this.cycleAt, this.sel ? this.sel.readyAt : 0)) / 2000)) % 4; }
    ageDM(on, dm, age) {
      const a = Math.floor(age * 10 + 1e-6) / 10, whole = Math.floor(a), tenth = Math.round((a - whole) * 10) % 10;
      dm((whole < 10 ? ' ' : '') + whole + tenth);
      on.push('xdp');
    }
    gmtSmall(on, d7) {
      const tz = this.s.tzMin, neg = tz < 0, a = Math.abs(tz), h = Math.floor(a / 60), m = a % 60;
      if (m === 0) {
        if (neg) on.push('tdash');
        const hs = h < 10 ? ' ' + h : '' + h; d7('t2', hs[0]); d7('t3', hs[1]);
      } else {
        if (neg) d7('t0', '-');
        d7('t1', String(h % 10)); on.push('tcol');
        const ms = String(m).padStart(2, '0'); d7('t2', ms[0]); d7('t3', ms[1]);
      }
    }

    /** Human readable description of what each button does right now (for UI hints). */
    hints() {
      if (this.ring) return { A: 'Stop alarm', B: 'Stop alarm', C: 'Stop alarm', D: 'Stop alarm', L: 'Snooze' };
      if (this.demo) return { A: 'Stop demo', B: 'Stop demo', C: 'Stop demo', D: 'Stop demo' };
      const s = this.set;
      if (s && s.kind === 'time') return { A: ['Reset seconds', '+1 hour', '+1 minute', '+1 year', '+1 month', '+1 date', 'Next weekday'][s.field], B: 'Location setup', C: 'Next digit', D: '—' };
      if (s && s.kind === 'loc') return [{ A: 'GMT +1 h', D: 'GMT −1 h', C: 'Longitude', B: 'Done' }, { A: '1° west', D: '1° east', C: 'Latitude', B: 'Done' }, { A: '1° south', D: '1° north', C: 'GMT offset', B: 'Done' }][s.field];
      if (s && s.kind === 'alm') return { A: s.field ? '+1 minute' : '+1 hour', C: s.field ? 'Hour' : 'Minute', B: 'Done', D: '—' };
      switch (this.mode) {
        case 'TIME': return { A: '12/24 h', B: 'Set time', C: 'Moon time (hold: demo)', D: 'Sunrise/sunset' };
        case 'MOON': return { A: '+1 day', D: '−1 day', C: this.afterOp ? 'Back to time' : 'Sunrise/sunset', B: '—' };
        case 'SUN': return { A: '+1 day', D: '−1 day', C: this.afterOp ? 'Back to time' : 'Alarm', B: '—' };
        case 'ALM': return { A: 'Hold: test beep', B: 'Set alarm', C: this.afterOp ? 'Back to time' : 'Stopwatch', D: 'Alarm / chime on-off' };
        case 'ST': return { A: this.sw.running ? 'Stop' : 'Start', D: this.sw.split !== null ? 'Release split' : this.sw.running ? 'Split' : 'Reset', C: 'Time', B: '—' };
      }
      return {};
    }
    status() { return { mode: this.set ? this.set.kind.toUpperCase() + '-SET' : this.mode, demo: !!this.demo, ring: !!this.ring, sw: this.sw.running }; }
  }

  return { Module, FONT, SEG7, DOW, MODES, SEGMENT_IDS, STARS, defaults };
});

/*
 * Selene faces — original dial designs rendered as SVG with tagged LCD segments.
 *
 * Every face draws the same *logical* segment set (see SEGMENTS below) so a single
 * watch module (module.js / watch_logic.cpp) can drive any face. Faces may add
 * optional segments (sea reflections r0..r8, seconds ring q0..q59); faces without
 * them simply ignore those ids.
 *
 * Coordinate system: 1000 x 1000, dial centre (500,500). Each segment is emitted as
 *   <path class="s {lcd|mg}" data-s="{id}" d="..."/>
 * Static artwork has no data-s. The web app toggles `.on`; the firmware pipeline
 * (tools/render_faces.mjs) rasterizes background / segment-id / coverage layers.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./glyphs.js'));
  else root.SeleneFaces = factory(root.SeleneGlyphs);
})(typeof self !== 'undefined' ? self : this, function (GLYPHS) {
  'use strict';
  const f1 = (v) => Math.round(v * 10) / 10;
  const P = (pts) => 'M' + pts.map((p) => f1(p[0]) + ' ' + f1(p[1])).join('L') + 'Z';
  const RAD = Math.PI / 180;

  // ---------------------------------------------------------------- text → paths
  function textWidth(font, str, size, track) {
    const F = GLYPHS[font], s = size / 1000;
    let w = 0;
    for (const ch of str) w += ((F.g[ch] || F.g[' '])[0]) * s + track * size;
    return w - track * size;
  }
  /** Text as one <path>. capH = cap height in units; align: start|middle|end */
  function text(font, str, x, y, capH, opt = {}) {
    const F = GLYPHS[font];
    const size = capH / F.capH * 1000, s = size / 1000, track = opt.track || 0;
    const w = textWidth(font, str, size, track);
    let cx = opt.align === 'middle' ? x - w / 2 : opt.align === 'end' ? x - w : x;
    let d = '';
    for (const ch of str) {
      const g = F.g[ch] || F.g[' '];
      if (g[1]) d += `<path transform="translate(${f1(cx)} ${f1(y)}) scale(${+s.toFixed(5)})" d="${g[1]}"/>`;
      cx += g[0] * s + track * size;
    }
    const attrs = opt.attrs || '';
    return `<g ${attrs}>${d}</g>`;
  }
  /** Text along a circle. upper=true: clockwise, tops outward. upper=false: counter-clockwise, tops inward. */
  function arcText(font, str, cx, cy, r, angDeg, capH, upper, opt = {}) {
    const F = GLYPHS[font];
    const size = capH / F.capH * 1000, s = size / 1000, track = opt.track || 0;
    const w = textWidth(font, str, size, track);
    const rb = upper ? r - capH / 2 : r + capH / 2;
    let a = angDeg * RAD + (upper ? -1 : 1) * (w / 2) / rb;
    let d = '';
    for (const ch of str) {
      const g = F.g[ch] || F.g[' '];
      const adv = g[0] * s;
      const x = cx + rb * Math.cos(a), y = cy + rb * Math.sin(a);
      const rot = (upper ? a / RAD + 90 : a / RAD - 90);
      if (g[1]) d += `<path transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)}) scale(${+s.toFixed(5)})" d="${g[1]}"/>`;
      a += (upper ? 1 : -1) * (adv + track * size) / rb;
    }
    return `<g ${opt.attrs || ''}>${d}</g>`;
  }

  // ---------------------------------------------------------------- LCD primitives
  /** 7-segment digit. Returns [{id, d}] for segments a..g (+ optional extra 'w'). */
  function seg7(id, x, y, w, h, t, g, slant, extraW) {
    const k = Math.tan(slant * RAD);
    const sk = (p) => [x + p[0] + (h - p[1]) * k, y + p[1]];
    const m = h / 2, ht = t / 2;
    const segs = {
      a: [[g, 0], [w - g, 0], [w - t - g, t], [t + g, t]],
      b: [[w, g], [w, m - ht - g], [w - ht, m - g * 0.5], [w - t, m - ht - g], [w - t, t + g]],
      c: [[w, m + g], [w, h - g], [w - t, h - t - g], [w - t, m + ht + g], [w - ht, m + g * 0.5]],
      d: [[t + g, h - t], [w - t - g, h - t], [w - g, h], [g, h]],
      e: [[0, m + g], [ht, m + g * 0.5], [t, m + ht + g], [t, h - t - g], [0, h - g]],
      f: [[0, g], [t, t + g], [t, m - ht - g], [ht, m - g * 0.5], [0, m - ht - g]],
      g: [[ht + g, m], [t + g, m - ht], [w - t - g, m - ht], [w - ht - g, m], [w - t - g, m + ht], [t + g, m + ht]],
    };
    const out = Object.entries(segs).map(([s, pts]) => ({ id: id + s, d: P(pts.map(sk)) }));
    if (extraW) {
      const cxw = w / 2, wt = t * 0.9;
      out.push({ id: id + 'w', d: P([[cxw - wt / 2, m + ht + g * 2], [cxw + wt / 2, m + ht + g * 2], [cxw + wt / 2, h - t - g], [cxw - wt / 2, h - t - g]].map(sk)) });
    }
    return out;
  }
  function rrect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    return `M${f1(x + r)} ${f1(y)}H${f1(x + w - r)}Q${f1(x + w)} ${f1(y)} ${f1(x + w)} ${f1(y + r)}V${f1(y + h - r)}Q${f1(x + w)} ${f1(y + h)} ${f1(x + w - r)} ${f1(y + h)}H${f1(x + r)}Q${f1(x)} ${f1(y + h)} ${f1(x)} ${f1(y + h - r)}V${f1(y + r)}Q${f1(x)} ${f1(y)} ${f1(x + r)} ${f1(y)}Z`;
  }
  /** Rounded rectangle with one radius for the top corners and another for the bottom corners. */
  function rrect2(x, y, w, h, rt, rb) {
    const k = 0.45; // control-point pull: a touch rounder than a plain quadratic corner
    return `M${f1(x + rt)} ${f1(y)}H${f1(x + w - rt)}C${f1(x + w - rt * k)} ${f1(y)} ${f1(x + w)} ${f1(y + rt * k)} ${f1(x + w)} ${f1(y + rt)}V${f1(y + h - rb)}` +
      `C${f1(x + w)} ${f1(y + h - rb * k)} ${f1(x + w - rb * k)} ${f1(y + h)} ${f1(x + w - rb)} ${f1(y + h)}H${f1(x + rb)}C${f1(x + rb * k)} ${f1(y + h)} ${f1(x)} ${f1(y + h - rb * k)} ${f1(x)} ${f1(y + h - rb)}` +
      `V${f1(y + rt)}C${f1(x)} ${f1(y + rt * k)} ${f1(x + rt * k)} ${f1(y)} ${f1(x + rt)} ${f1(y)}Z`;
  }
  /** 3 x (5x7) dot-matrix characters. ids: x{char}{row}{col} */
  function dotMatrix(x, y, pitch, dot, charGap) {
    const out = [];
    for (let c = 0; c < 3; c++) {
      const ox = x + c * (5 * pitch + charGap);
      for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++)
        out.push({ id: `x${c}${r}${k}`, d: rrect(ox + k * pitch, y + r * pitch, dot, dot, dot * 0.18) });
    }
    return out;
  }
  function circleD(cx, cy, r) {
    return `M${f1(cx - r)} ${f1(cy)}A${f1(r)} ${f1(r)} 0 1 0 ${f1(cx + r)} ${f1(cy)}A${f1(r)} ${f1(r)} 0 1 0 ${f1(cx - r)} ${f1(cy)}Z`;
  }
  /** Glyph text as path data (for text-shaped segments). */
  function textD(font, str, x, y, capH, align, track) {
    const F = GLYPHS[font];
    const size = capH / F.capH * 1000, s = size / 1000; track = track || 0;
    const w = textWidth(font, str, size, track);
    let cx = align === 'middle' ? x - w / 2 : align === 'end' ? x - w : x;
    let d = '';
    for (const ch of str) {
      const g = F.g[ch] || F.g[' '];
      if (g[1]) d += transformPath(g[1], s, cx, y);
      cx += g[0] * s + track * size;
    }
    return d;
  }
  // transform a glyph path (absolute M/L/Q/C/Z with integer coords) by scale+translate
  function transformPath(d, s, tx, ty) {
    return d.replace(/([MLQCZ])([^MLQCZ]*)/g, (m, cmd, args) => {
      if (cmd === 'Z') return 'Z';
      const n = args.trim().split(/[ ,]+/).map(Number);
      const o = [];
      for (let i = 0; i < n.length; i += 2) o.push(f1(n[i] * s + tx) + ' ' + f1(n[i + 1] * s + ty));
      return cmd + o.join(' ');
    });
  }

  // ---------------------------------------------------------------- moon artwork
  /** Upright phase silhouette for arc slot k (0..8). Waxing (k<4) lit on the right. */
  function moonPhaseD(cx, cy, r, k) {
    const lit = [0.0, 0.16, 0.5, 0.84, 1, 0.84, 0.5, 0.16, 0.0][k];
    const right = k < 4;
    if (k === 4) return circleD(cx, cy, r);
    if (k === 0 || k === 8) {
      // new moon: thin outline ring + crescent inside the ring on the lit side (no overlap → robust fill)
      const ri = r * 0.84, tx = ri * 0.46, sw = right ? 1 : 0;
      return ringPath(cx, cy, r, ri) +
        `M${f1(cx)} ${f1(cy - ri)}A${f1(ri)} ${f1(ri)} 0 0 ${sw} ${f1(cx)} ${f1(cy + ri)}A${f1(tx)} ${f1(ri)} 0 0 ${1 - sw} ${f1(cx)} ${f1(cy - ri)}Z`;
    }
    // terminator ellipse x-radius
    const tx = Math.abs(1 - 2 * lit) * r;
    const gibbous = lit > 0.5;
    const s1 = right ? 1 : 0; // limb sweep
    // limb: half circle on lit side; terminator: half-ellipse
    const termSweep = right ? (gibbous ? 1 : 0) : (gibbous ? 0 : 1);
    if (Math.abs(lit - 0.5) < 1e-3) return `M${f1(cx)} ${f1(cy - r)}A${f1(r)} ${f1(r)} 0 0 ${s1} ${f1(cx)} ${f1(cy + r)}Z`;
    return `M${f1(cx)} ${f1(cy - r)}A${f1(r)} ${f1(r)} 0 0 ${s1} ${f1(cx)} ${f1(cy + r)}A${f1(tx)} ${f1(r)} 0 0 ${termSweep} ${f1(cx)} ${f1(cy - r)}Z`;
  }
  function ringPath(cx, cy, ro, ri) {
    // even-odd ring: outer CW + inner CCW
    return `M${f1(cx - ro)} ${f1(cy)}A${f1(ro)} ${f1(ro)} 0 1 1 ${f1(cx + ro)} ${f1(cy)}A${f1(ro)} ${f1(ro)} 0 1 1 ${f1(cx - ro)} ${f1(cy)}Z` +
      `M${f1(cx - ri)} ${f1(cy)}A${f1(ri)} ${f1(ri)} 0 1 0 ${f1(cx + ri)} ${f1(cy)}A${f1(ri)} ${f1(ri)} 0 1 0 ${f1(cx - ri)} ${f1(cy)}Z`;
  }
  function sunD(cx, cy, r) {
    // half sun above horizon with 5 rays
    let d = `M${f1(cx - r)} ${f1(cy)}A${f1(r)} ${f1(r)} 0 0 1 ${f1(cx + r)} ${f1(cy)}Z`;
    for (let i = 0; i < 5; i++) {
      const a = (180 + 22.5 + i * 33.75) * RAD, ca = Math.cos(a), sa = Math.sin(a);
      const r0 = r * 1.28, r1 = r * 1.85, hw = r * 0.13;
      const nx = -sa, ny = ca;
      d += P([[cx + ca * r0 + nx * hw, cy + sa * r0 + ny * hw], [cx + ca * r1 + nx * hw * 0.6, cy + sa * r1 + ny * hw * 0.6],
        [cx + ca * r1 - nx * hw * 0.6, cy + sa * r1 - ny * hw * 0.6], [cx + ca * r0 - nx * hw, cy + sa * r0 - ny * hw]]);
    }
    return d;
  }
  function bellD(x, y, s) { // alarm bell icon, box s x s at (x,y)
    const c = x + s / 2;
    return `M${f1(c)} ${f1(y)}C${f1(x + s * 0.82)} ${f1(y)} ${f1(x + s * 0.8)} ${f1(y + s * 0.45)} ${f1(x + s * 0.86)} ${f1(y + s * 0.62)}L${f1(x + s * 0.98)} ${f1(y + s * 0.8)}L${f1(x + s * 0.02)} ${f1(y + s * 0.8)}L${f1(x + s * 0.14)} ${f1(y + s * 0.62)}C${f1(x + s * 0.2)} ${f1(y + s * 0.45)} ${f1(x + s * 0.18)} ${f1(y)} ${f1(c)} ${f1(y)}Z` +
      circleD(c, y + s * 0.9, s * 0.11);
  }
  function noteD(x, y, s) { // hourly chime icon: two beamed notes
    const t = s * 0.12;
    return P([[x + s * 0.32, y + s * 0.18], [x + s * 0.95, y], [x + s * 0.95, y + s * 0.72], [x + s * 0.95 - t, y + s * 0.72], [x + s * 0.95 - t, y + s * 0.2], [x + s * 0.32 + t, y + s * 0.36], [x + s * 0.32 + t, y + s * 0.88], [x + s * 0.32, y + s * 0.88]]) +
      ellipseD(x + s * 0.2, y + s * 0.88, s * 0.2, s * 0.14) + ellipseD(x + s * 0.83, y + s * 0.72, s * 0.2, s * 0.14);
  }
  function ellipseD(cx, cy, rx, ry) {
    return `M${f1(cx - rx)} ${f1(cy)}A${f1(rx)} ${f1(ry)} 0 1 0 ${f1(cx + rx)} ${f1(cy)}A${f1(rx)} ${f1(ry)} 0 1 0 ${f1(cx - rx)} ${f1(cy)}Z`;
  }

  // deterministic star field
  function stars(seed, n, inside, avoid, minD = 26) {
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < n * 600) {
      const x = rnd() * 1000, y = rnd() * 1000;
      if (!inside(x, y) || avoid(x, y)) continue;
      if (out.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 < minD ** 2)) continue;
      const m = rnd();
      out.push({ x, y, r: 0.9 + m * m * 2.2, o: 0.35 + rnd() * 0.6, spark: m > 0.9 });
    }
    return out;
  }
  // evenly spread points (best-candidate sampling) for the LCD star field
  function spread(seed, n, ok) {
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const out = [];
    while (out.length < n) {
      let best = null, bd = -1;
      for (let c = 0; c < 500; c++) {
        const x = rnd() * 1000, y = rnd() * 1000;
        if (!ok(x, y)) continue;
        let d = 1e9;
        for (const p of out) d = Math.min(d, (p.x - x) ** 2 + (p.y - y) ** 2);
        d *= 0.55 + 0.45 * rnd(); // a little irregularity so it does not look like a grid
        if (d > bd) { bd = d; best = { x, y }; }
      }
      if (!best) throw new Error('star field: no room');
      out.push(best);
    }
    return out;
  }
  function sparkD(x, y, r) {
    const a = r * 0.22;
    return `M${f1(x)} ${f1(y - r)}Q${f1(x + a)} ${f1(y - a)} ${f1(x + r)} ${f1(y)}Q${f1(x + a)} ${f1(y + a)} ${f1(x)} ${f1(y + r)}Q${f1(x - a)} ${f1(y + a)} ${f1(x - r)} ${f1(y)}Q${f1(x - a)} ${f1(y - a)} ${f1(x)} ${f1(y - r)}Z`;
  }

  /** Small five-point star with slightly rounded points. */
  function star5D(x, y, r) {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.44 : r;
      d += (i ? 'L' : 'M') + f1(x + rr * Math.cos(a)) + ' ' + f1(y + rr * Math.sin(a));
    }
    return d + 'Z';
  }

  // ---------------------------------------------------------------- shared LCD block
  /**
   * Standard LCD content (row 1: 3-char matrix + 4 small digits; row 2: big time).
   * L = layout numbers. Returns segment list.
   */
  function lcdBlock(L) {
    const segs = [];
    const push = (arr, cls = 'lcd') => arr.forEach((s) => segs.push({ ...s, cls }));
    // row 1
    push(dotMatrix(L.mx, L.my, L.mp, L.md, L.mg));
    const dd = L.md * 0.84;
    const dpx = L.mx + (19 * L.mp + 3 * L.mg + L.md) / 2 - dd / 2, dpy = L.my + 6 * L.mp + L.md - dd;
    push([{ id: 'xdp', d: rrect(dpx, dpy, dd, dd, dd * 0.3) }]);
    const sw = L.sw, sh = L.sh;
    const t1x = L.sx + sw + L.sgap, dzx = t1x + sw + L.sgap * 0.5, t2x = dzx + L.sdz + L.sgap * 0.5;
    const tx = [L.sx, t1x, t2x, t2x + sw + L.sgap];
    tx.forEach((x, i) => push(seg7('t' + i, x, L.sy, sw, sh, L.st, L.g, L.slant)));
    const k = Math.tan(L.slant * RAD);
    push([{ id: 'tdash', d: P([[dzx + L.sdz * 0.18 + sh * 0.5 * k, L.sy + sh / 2 - L.st / 2], [dzx + L.sdz * 0.82 + sh * 0.5 * k, L.sy + sh / 2 - L.st / 2], [dzx + L.sdz * 0.82 + sh * 0.5 * k, L.sy + sh / 2 + L.st / 2], [dzx + L.sdz * 0.18 + sh * 0.5 * k, L.sy + sh / 2 + L.st / 2]]) }]);
    const cd = L.st * 0.9;
    push([{ id: 'tcol', d: rrect(dzx + L.sdz / 2 - cd / 2 + sh * 0.7 * k, L.sy + sh * 0.3 - cd / 2, cd, cd, cd * 0.3) + rrect(dzx + L.sdz / 2 - cd / 2 + sh * 0.3 * k, L.sy + sh * 0.7 - cd / 2, cd, cd, cd * 0.3) }]);
    // labels / icons (row 1.5)
    push([{ id: 'lage', d: textD('label', 'MOON AGE', L.mx, L.ly, L.lcap, 'start', 0.06) }]);
    push([{ id: 'lrise', d: textD('label', 'SUNRISE', tx[0], L.ly, L.lcap, 'start', 0.06) }]);
    push([{ id: 'alm', d: bellD(L.ix, L.ly - L.isz * 0.92, L.isz) }]);
    push([{ id: 'chm', d: noteD(L.ix + L.isz * 1.5, L.ly - L.isz * 0.92, L.isz) }]);
    // row 2: big time
    const bw = L.bw, bh = L.bh;
    const b1x = L.bx + bw + L.bgap, czx = b1x + bw + L.bgap * 0.5, b2x = czx + L.bcz + L.bgap * 0.5;
    const bx = [L.bx, b1x, b2x, b2x + bw + L.bgap];
    bx.forEach((x, i) => push(seg7('b' + i, x, L.by, bw, bh, L.bt, L.g * 1.2, L.slant)));
    const sx0 = bx[3] + bw + L.bsgap, ssw = L.ssw, ssh = L.ssh;
    push(seg7('b4', sx0, L.by + bh - ssh, ssw, ssh, L.sst, L.g, L.slant));
    push(seg7('b5', sx0 + ssw + L.sgap, L.by + bh - ssh, ssw, ssh, L.sst, L.g, L.slant, true));
    const cdb = L.bt * 0.95;
    push([{ id: 'bcol', d: rrect(czx + L.bcz / 2 - cdb / 2 + bh * 0.68 * k, L.by + bh * 0.3 - cdb / 2, cdb, cdb, cdb * 0.25) + rrect(czx + L.bcz / 2 - cdb / 2 + bh * 0.3 * k, L.by + bh * 0.7 - cdb / 2, cdb, cdb, cdb * 0.25) }]);
    // indicators column
    push([{ id: 'pm', d: textD('labelB', 'PM', L.ix0, L.by + L.icap * 1.1, L.icap, 'start', 0.04) }]);
    push([{ id: 'h24', d: textD('labelB', '24', L.ix0, L.by + L.icap * 2.65, L.icap, 'start', 0.04) }]);
    push([{ id: 'lmoon', d: textD('label', 'MOON', L.ix0, L.by + bh - L.icap * 1.65 - (L.lblUp || 0), L.icap * 0.82, 'start', 0.03) }]);
    push([{ id: 'lset', d: textD('label', 'SUNSET', L.ix0, L.by + bh - (L.lblUp || 0), L.icap * 0.82, 'start', 0.0) }]);
    return segs;
  }

  // ---------------------------------------------------------------- moon graph block
  function moonGraph(G) {
    const segs = [];
    for (let k = 0; k < 9; k++) {
      const a = (G.a0 - k * G.astep) * RAD;
      const cx = G.cx + G.rx * Math.cos(a), cy = G.cy - G.ry * Math.sin(a);
      segs.push({ id: 'p' + k, d: moonPhaseD(cx, cy, G.mr, k), cls: 'mg', cx, cy });
    }
    for (let k = 0; k < 13; k++) {
      const a = (180 - k * 15) * RAD, ca = Math.cos(a), sa = Math.sin(a);
      const r0 = G.hr0, r1 = G.hr1, hw = G.hw;
      const hcy = G.hcy || G.cy;
      const tip = [G.cx + G.hrx(r1) * ca, hcy - G.hry(r1) * sa];
      const nx = -sa, ny = -ca; // perpendicular in screen space
      const b1 = [G.cx + G.hrx(r0) * ca + nx * hw, hcy - G.hry(r0) * sa + ny * hw];
      const b2 = [G.cx + G.hrx(r0) * ca - nx * hw, hcy - G.hry(r0) * sa - ny * hw];
      segs.push({ id: 'h' + k, d: G.hdot ? circleD((tip[0] + (b1[0] + b2[0]) / 2) / 2, (tip[1] + (b1[1] + b2[1]) / 2) / 2, G.hdot) : P([tip, b1, b2]), cls: 'mg' });
    }
    segs.push({ id: 'sune', d: sunD(G.sex, G.sy, G.sr), cls: 'mg' });
    segs.push({ id: 'sunw', d: sunD(G.swx, G.sy, G.sr), cls: 'mg' });
    // nadir mark: moon at lower transit (hour angle 12 h)
    const N = G.nadir;
    segs.push({ id: 'hn', d: P([[N.x - N.s, N.y - N.s * 0.8], [N.x + N.s, N.y - N.s * 0.8], [N.x, N.y + N.s * 0.9]]), cls: 'mg' });
    // star field: 18 LCD stars, s0 = leftmost … s17 = rightmost (module.js STARS drives them)
    const avoidStar = (x, y) => G.starAvoid(x, y) || segs.slice(0, 9).some((m) => (m.cx - x) ** 2 + (m.cy - y) ** 2 < (G.mr + 13) ** 2) ||
      (x - N.x) ** 2 + (y - N.y) ** 2 < 30 ** 2;
    const st = spread(G.starSeed, 18, (x, y) => G.starIn(x, y) && !avoidStar(x, y)).sort((a, b) => a.x - b.x);
    st.forEach((p, k) => segs.push({ id: 's' + k, d: (G.starShape || sparkD)(p.x, p.y, G.starR * (0.78 + 0.5 * ((k * 7 + 3) % 5) / 4)), cls: 'st', cx: p.x, cy: p.y }));
    return segs;
  }

  /** A few faint printed specks behind the LCD stars, for depth. */
  function specks(seed, n, inside, segs) {
    const lit = segs.filter((q) => q.cx !== undefined);
    return stars(seed, n, inside, (x, y) => lit.some((m) => (m.cx - x) ** 2 + (m.cy - y) ** 2 < 20 ** 2), 22)
      .map((p) => `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="${f1(0.7 + p.r * 0.28)}" opacity="${(0.12 + p.o * 0.22).toFixed(2)}"/>`).join('');
  }

  const segPaths = (segs) => segs.map((s) => `<path class="s ${s.cls}" data-s="${s.id}" d="${s.d}"/>`).join('');

  // ================================================================ FACE: ARC (wristwatch dial)
  function buildArc(opt = {}) {
    const C = { // palette
      dial0: '#26272a', dial1: '#121315', ink: '#e9edf2', silver: '#a7afba', gold: '#d9b86c', yellow: '#e9c23a', blue: '#6aa6f0', line: '#c9a54a',
      lcd0: '#cfd4c3', lcd1: '#c1c6b4',
    };
    // moon panel: as wide as the time display below it, with a low arched top
    const W = { cx: 500, cy: 474, R: 350, top: 190 };
    // soft, pebble-like outline: the top is half a superellipse (rounder shoulders than an arch), the base has wide corners
    const SE = 2.7, BR = 50, baseY = W.cy + 13, sideY = baseY - BR; // BR = the time display's top-corner radius; baseY puts the gap to the display on the centreline (y 500)
    const topY = (x) => { const u = Math.min(1, Math.abs(x - W.cx) / W.R); return sideY - (sideY - W.top) * Math.pow(1 - Math.pow(u, SE), 1 / SE); };
    const T = { rx: 94, ry: 80, cy: W.cy - 8 }; // hour-angle track: an arc inside the mountain
    // one Matterhorn-style peak in the middle, jagged and rocky, on a wide base. RANGE = [x from centre, height above
    // the horizon]: a smooth envelope (steep horn, hooked summit, shoulder on the west ridge) broken into rocky steps.
    // The envelope stays under the moon slots: the moons sweep over it, the moon-position marker sits inside it.
    const RANGE = (() => {
      let sd = 97;
      const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
      const env = (u) => u < 0 ? 176 * Math.pow(Math.max(0, 1 + u / 318), 1.55)
        : 176 * Math.pow(Math.max(0, 1 - u / 322), 1.75) + 13 * Math.exp(-(((u - 46) / 15) ** 2));
      const pts = [[-350, 0]];
      for (const side of [-1, 1]) {
        const run = [];
        for (let u = 12; u < 322; u += 6 + rnd() * 11) {
          const e = env(side * u), jag = (2.5 + 9 * Math.min(1, e / 90)) * (rnd() < 0.5 ? -1 : 0.6) * (0.5 + rnd());
          run.push([side * Math.round(u), Math.max(0, Math.min(e + 5, e + jag))]);
        }
        if (side < 0) pts.push(...run.reverse(), [-6, 171], [-3, 177], [3, 172]); // summit, leaning west
        else pts.push([7, 167], [10, 171], ...run); // the hook
      }
      pts.push([350, 0]);
      return pts.map(([u, h]) => [u, Math.round(h * 10) / 10]);
    })();
    const ridge = (x) => { // horizon y under the ridge line at x
      const u = x - W.cx;
      for (let i = 1; i < RANGE.length; i++) if (u <= RANGE[i][0]) {
        const [x0, h0] = RANGE[i - 1], [x1, h1] = RANGE[i];
        return W.cy - (h0 + (h1 - h0) * (u - x0) / (x1 - x0));
      }
      return W.cy;
    };
    const G = { cx: 500, cy: W.cy, rx: 286, ry: 222, mr: 35, a0: 162, astep: 18,
      hr0: 1, hr1: 1, hw: 0, hdot: 8.4, hrx: () => T.rx, hry: () => T.ry, hcy: T.cy,
      sex: 186, swx: 814, sy: W.cy, sr: 12.5,
      nadir: { x: 500, y: W.cy - 16, s: 5.6 }, starSeed: 12, starR: 6.4, starShape: star5D,
      starIn: (x, y) => Math.abs(x - W.cx) < W.R - 22 && y < ridge(x) - 18 && y > topY(x) + 16,
      starAvoid: () => false };
    const mg = moonGraph(G);
    // r0..r8: a small gold pointer under the horizon below each moon slot
    for (let k = 0; k < 9; k++) {
      const x = mg[k].cx, y = W.cy + 3;
      mg.push({ id: 'r' + k, cls: 'mg', d: `M${f1(x)} ${y}L${f1(x + 5)} ${y + 7}H${f1(x - 5)}Z` });
    }
    const L = { mx: 186, my: 548, mp: 9.6, md: 8.2, mg: 12,
      sx: 566, sy: 548, sw: 42, sh: 66, st: 8.6, sgap: 11, sdz: 26, g: 1.6, slant: 4,
      ly: 640, lcap: 10.5, ix: 734, isz: 19,
      bx: 262, by: 656, bw: 70, bh: 102, bt: 13.5, bgap: 15, bcz: 26, bsgap: 20, ssw: 48, ssh: 72, sst: 10,
      ix0: 180, icap: 12.5, lblUp: 14 };
    const lcd = lcdBlock(L);
    const inDome = (x, y) => Math.abs(x - W.cx) < W.R - 12 && y < ridge(x) - 12 && y > topY(x) + 10;
    const avoid = (x, y) => G.starAvoid(x, y) || mg.slice(0, 9).some((m) => (m.cx - x) ** 2 + (m.cy - y) ** 2 < 42 ** 2);
    const starSvg = specks(7, 16, (x, y) => inDome(x, y) && !avoid(x, y), mg);
    // dial sunburst
    let burst = '';
    for (let i = 0; i < 180; i++) {
      const a = i * 2 * RAD;
      burst += `M${f1(500 + 70 * Math.cos(a))} ${f1(500 + 70 * Math.sin(a))}L${f1(500 + 492 * Math.cos(a))} ${f1(500 + 492 * Math.sin(a))}`;
    }
    let ticks = '', ticks5 = '';
    for (let i = 0; i < 60; i++) {
      const a = (i * 6 - 90) * RAD, c = Math.cos(a), s = Math.sin(a);
      if (i % 5 === 0) ticks5 += `M${f1(500 + 455 * c)} ${f1(500 + 455 * s)}L${f1(500 + 474 * c)} ${f1(500 + 474 * s)}`;
      else ticks += `M${f1(500 + 464 * c)} ${f1(500 + 464 * s)}L${f1(500 + 474 * c)} ${f1(500 + 474 * s)}`;
    }
    // hour-angle printed track: a pip under each marker position
    let haScale = '';
    for (let k = 0; k < 13; k++) { const a = (180 - k * 15) * RAD; haScale += circleD(W.cx + T.rx * Math.cos(a), T.cy - T.ry * Math.sin(a), 2); }
    const base = `C${W.cx + W.R} ${baseY - BR * 0.42} ${W.cx + W.R - BR * 0.42} ${baseY} ${W.cx + W.R - BR} ${baseY}H${W.cx - W.R + BR}C${W.cx - W.R + BR * 0.42} ${baseY} ${W.cx - W.R} ${baseY - BR * 0.42} ${W.cx - W.R} ${baseY - BR}Z`;
    let topD = '';
    for (let i = 1; i <= 120; i++) { const x = W.cx - W.R + (2 * W.R) * (0.5 - 0.5 * Math.cos(Math.PI * i / 120)); topD += `L${f1(x)} ${(i === 120 ? sideY : topY(x)).toFixed(2)}`; }
    const domeD = `M${W.cx - W.R} ${sideY}${topD}${base}`;
    const ridgeD = RANGE.map(([u, h], i) => `${i ? 'L' : 'M'}${W.cx + u} ${W.cy - h}`).join('');
    // a few slope lines inside the range, for depth
    // rock detail, low-poly: points along the ridge and the base plus an even scatter inside the mountain are
    // Delaunay-triangulated into rock planes. Each facet is shaded by how it faces the light (from the east, the E side):
    // brighter where it rises to the right, darker where it falls; facets above the snowline are brighter again.
    // Fills are clipped to the mountain; edges break around the marker arc and the E / W labels.
    const EW = 188; // E / W sit inside the mountain's base corners, this far from the centre
    const SNOW = 112;
    const rock = (() => {
      let sd = 11;
      const rnd = () => ((sd = (sd * 1664525 + 1013904223) >>> 0) / 4294967296);
      const pip = (x, y) => Math.abs(Math.hypot((x - W.cx) / T.rx, (y - T.cy) / T.ry) - 1) < 0.15 && y < W.cy;
      const lbl = (x, y) => y > W.cy - 26 && Math.abs(Math.abs(x - W.cx) - EW) < 20;
      const P = [];
      RANGE.forEach(([u, h], i) => { if (i % 2 === 0 && u > -300 && u < 300) P.push([W.cx + u, W.cy - h]); });
      for (let u = -300; u <= 300; u += 38) P.push([W.cx + u + (rnd() - 0.5) * 10, W.cy]);
      for (let tries = 0; tries < 3000 && P.length < 120; tries++) { // even scatter (best of a few candidates)
        const x = W.cx + (rnd() * 2 - 1) * 290, y = W.cy - rnd() * 180;
        if (y > ridge(x) + 12 && y < W.cy - 10 && P.every(([px, py]) => (px - x) ** 2 + (py - y) ** 2 > 30 ** 2)) P.push([x, y]);
      }
      // Bowyer-Watson
      const circ = (a, b, c) => {
        const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
        const ux = ((a[0] ** 2 + a[1] ** 2) * (b[1] - c[1]) + (b[0] ** 2 + b[1] ** 2) * (c[1] - a[1]) + (c[0] ** 2 + c[1] ** 2) * (a[1] - b[1])) / d;
        const uy = ((a[0] ** 2 + a[1] ** 2) * (c[0] - b[0]) + (b[0] ** 2 + b[1] ** 2) * (a[0] - c[0]) + (c[0] ** 2 + c[1] ** 2) * (b[0] - a[0])) / d;
        return [ux, uy, (a[0] - ux) ** 2 + (a[1] - uy) ** 2];
      };
      const sup = [[-5000, -5000], [6000, -5000], [500, 8000]];
      let tris = [[sup[0], sup[1], sup[2]]].map((t) => ({ t, c: circ(...t) }));
      for (const p of P) {
        const bad = tris.filter(({ c }) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 < c[2]);
        const edges = [];
        for (const { t } of bad) for (let k = 0; k < 3; k++) {
          const e = [t[k], t[(k + 1) % 3]], i = edges.findIndex((f) => (f[0] === e[1] && f[1] === e[0]) || (f[0] === e[0] && f[1] === e[1]));
          if (i >= 0) edges.splice(i, 1); else edges.push(e);
        }
        tris = tris.filter((x) => !bad.includes(x));
        for (const [a, b] of edges) tris.push({ t: [a, b, p], c: circ(a, b, p) });
      }
      tris = tris.map(({ t }) => t).filter((t) => !t.some((v) => sup.includes(v)));
      // facet shading from a per-vertex elevation: the ridge profile at that x, less depth below it, plus some noise
      const z = new Map(P.map((p) => [p, (W.cy - ridge(p[0])) - (p[1] - ridge(p[0])) * 0.35 + (rnd() - 0.5) * 34]));
      let fills = '', edges = '';
      const seen = new Set();
      for (const t of tris) {
        const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
        if (cy < ridge(cx) - 2) continue; // outside the mountain
        // plane z = a x + b y + c through the three vertices; a > 0 means it rises toward the west, i.e. it faces east
        const [p0, p1, p2] = t, [z0, z1, z2] = t.map((v) => z.get(v));
        const det = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
        const ax = ((z1 - z0) * (p2[1] - p0[1]) - (z2 - z0) * (p1[1] - p0[1])) / det;
        const light = Math.max(0, Math.min(1, 0.5 - ax * 0.9)), snow = W.cy - cy > SNOW - 22;
        const op = (snow ? 0.07 + 0.15 * light : 0.012 + 0.075 * light).toFixed(3);
        fills += `<path d="M${f1(p0[0])} ${f1(p0[1])}L${f1(p1[0])} ${f1(p1[1])}L${f1(p2[0])} ${f1(p2[1])}Z" fill-opacity="${op}"/>`;
        for (let k = 0; k < 3; k++) {
          const a = t[k], b = t[(k + 1) % 3], key = [a, b].map((p) => P.indexOf(p)).sort((m, n) => m - n).join('|');
          if (seen.has(key) || (a[1] === W.cy && b[1] === W.cy)) continue;
          seen.add(key);
          let seg = '', n = 0;
          for (let j = 0; j <= 16; j++) {
            const x = a[0] + (b[0] - a[0]) * j / 16, y = a[1] + (b[1] - a[1]) * j / 16;
            if (pip(x, y) || lbl(x, y) || y > W.cy - 2) { if (n > 1) edges += seg; seg = ''; n = 0; continue; }
            seg += `${n ? 'L' : 'M'}${f1(x)} ${f1(y)}`; n++;
          }
          if (n > 1) edges += seg;
        }
      }
      return { fills, edges };
    })();
    // time display: tight top corners (the same radius as the moon panel's bottom corners), deep round bottom corners
    const lcdBox = { x: 150, y: 522, w: 700, h: 276, r: BR, rb: 104 };
    const lcdD = (g) => rrect2(lcdBox.x - g, lcdBox.y - g, lcdBox.w + 2 * g, lcdBox.h + 2 * g, lcdBox.r + g * 0.9, lcdBox.rb + g);
    const btn = (label, ang, upper) => arcText('label', label, 500, 500, 436, ang, 14, upper, { track: 0.16, attrs: `fill="${C.silver}"` }) +
      `<circle cx="${f1(500 + 468 * Math.cos(ang * RAD))}" cy="${f1(500 + 468 * Math.sin(ang * RAD))}" r="5.5" fill="${opt.classic ? C.blue : C.gold}"/>`;
    const svg = `
<defs>
  <radialGradient id="arcDial" cx="50%" cy="42%" r="62%"><stop offset="0" stop-color="${C.dial0}"/><stop offset="1" stop-color="${C.dial1}"/></radialGradient>
  <linearGradient id="arcSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#010203"/><stop offset=".7" stop-color="#04070c"/><stop offset="1" stop-color="#0b1524"/></linearGradient>
  <linearGradient id="arcLcd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.lcd0}"/><stop offset="1" stop-color="${C.lcd1}"/></linearGradient>
  <clipPath id="arcPanel"><path d="${domeD}"/></clipPath>
  <linearGradient id="arcGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<circle cx="500" cy="500" r="500" fill="url(#arcDial)"/>
<path d="${burst}" stroke="#fff" stroke-opacity=".028" stroke-width="1.4"/>
<path d="${ticks}" stroke="${C.silver}" stroke-opacity=".55" stroke-width="1.8"/>
<path d="${ticks5}" stroke="${C.ink}" stroke-opacity=".85" stroke-width="3.6"/>
<circle cx="500" cy="500" r="480" fill="none" stroke="${C.silver}" stroke-opacity=".35" stroke-width="1.5"/>
${opt.classic
    // classic print: heavy sans name over a gold serif line, in the manner of an early-'90s digital dial
    ? text('labelB', 'SELENE', 500, 120, 27, { align: 'middle', track: 0.03, attrs: `fill="${C.ink}"` }) +
      `<g transform="translate(500 0) skewX(-9) translate(-500 0)">${text('serif', 'LUNAR ARC', 500 + 158 * 0.158, 158, 17, { align: 'middle', track: 0.07, attrs: `fill="${C.yellow}"` })}</g>`
    : text('brand', 'SELENE', 500, 118, 29, { align: 'middle', track: 0.2, attrs: `fill="${C.ink}"` }) +
      text('label', 'LUNAR ARC', 500, 150, 11.5, { align: 'middle', track: 0.42, attrs: `fill="${C.gold}"` })}
<path d="${domeD}" fill="#030304"/>
<g fill="${C.line}" opacity=".7">${starSvg}</g>
<g clip-path="url(#arcPanel)">
<path d="${ridgeD}V${W.cy + 40}H${W.cx - W.R}Z" fill="#030304"/>
<clipPath id="arcMount"><path d="${ridgeD}V${W.cy}H${W.cx - W.R}Z"/></clipPath>
<g clip-path="url(#arcMount)"><g fill="${C.line}">${rock.fills}</g>
<path d="${rock.edges}" fill="none" stroke="${C.line}" stroke-opacity=".2" stroke-width=".9" stroke-linecap="round"/></g>
<path d="${ridgeD}" fill="none" stroke="${C.line}" stroke-width="1.6" stroke-linejoin="round"/>
<path d="M${W.cx - W.R} ${W.cy}H${W.cx + W.R}" stroke="${C.line}" stroke-width="1.6"/></g>
<path d="${haScale}" fill="${C.line}" opacity=".75"/>
${text('labelB', 'E', W.cx - EW, W.cy - 7, 15, { align: 'middle', attrs: `fill="${C.line}"` })}
${text('labelB', 'W', W.cx + EW, W.cy - 7, 15, { align: 'middle', attrs: `fill="${C.line}"` })}
<path d="${domeD}" fill="none" stroke="#000" stroke-opacity=".75" stroke-width="2.2"/>
<path d="M56 500H${W.cx - W.R - 14}M${W.cx + W.R + 14} 500H944" stroke="${C.yellow}" stroke-width="2.2"/>
<g class="mgl">${segPaths(mg)}</g>
<path d="${lcdD(9)}" fill="#05080e"/>
<path d="${lcdD(9)}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="1.6"/>
<path class="lcdbg" d="${lcdD(0)}" fill="url(#arcLcd)"/>
<path class="el" d="${lcdD(0)}" fill="#6fe3cf" opacity="0"/>
<g class="lcdl">${segPaths(lcd)}</g>
<path class="glass" d="${lcdD(0)}" fill="url(#arcGlass)" pointer-events="none"/>
${(() => { // dial print under the display, the same in both modes: yellow spec line, blue function line, small origin mark
    const cap = 20, big = 25, tr = 0.04, wW = textWidth('labelB', 'WATER ', cap / GLYPHS.labelB.capH * 1000, tr),
      w5 = textWidth('labelB', '50M ', big / GLYPHS.labelB.capH * 1000, tr), wR = textWidth('labelB', 'RESIST', cap / GLYPHS.labelB.capH * 1000, tr),
      x0 = 500 - (wW + w5 + wR) / 2, y = 853, yA = `fill="${C.yellow}"`;
    return text('labelB', 'WATER', x0, y, cap, { track: tr, attrs: yA }) + text('labelB', '50M', x0 + wW, y, big, { track: tr, attrs: yA }) +
      text('labelB', 'RESIST', x0 + wW + w5, y, cap, { track: tr, attrs: yA }) +
      text('label', 'ALARM CHRONO', 500, 891, 16, { align: 'middle', track: 0.06, attrs: `fill="${C.blue}"` }) +
      text('label', 'JAPAN U', 500, 925, 9.5, { align: 'middle', track: 0.14, attrs: `fill="${C.silver}" opacity=".9"` });
  })()}
${btn('SET', 212, true)}${btn('MODE', 148, false)}${btn('REV', -32, true)}${btn('FWD', 32, false)}
`;
    return { id: 'arc', name: 'Arc', svg, segs: mg.concat(lcd), palette: {
      lcdOn: '#161b18', lcdGhost: opt.classic ? 'rgba(22,27,24,.062)' : 'rgba(22,27,24,.036)', mgOn: '#f1c862', mgGhost: 'rgba(241,200,98,.014)',
      stOn: '#ecc75e', stGhost: 'rgba(236,199,94,.02)',
      shadow: 'rgba(28,34,30,.32)', glow: 'rgba(255,214,120,.55)', negative: false,
      el: '#7fe7d2' }, lcdBox, kind: 'watch' };
  }

  // ================================================================ FACE: DESK (alarm clock dial)
  function buildDesk(opt = {}) {
    const C = { dial0: '#f6f1e6', dial1: '#e3dac6', ink: '#1f2329', brass: '#9c7a43', silver: '#6c737d',
      lcd0: '#d3d8c7', lcd1: '#c5cab8' };
    const Wn = { cx: 500, cy: 452, rx: 268, ry: 214, bottom: 470 };
    const G = { cx: 500, cy: 440, rx: 192, ry: 150, mr: 26, a0: 162, astep: 18,
      hr0: 0, hr1: 0, hw: 0, hdot: 5.4, hrx: () => 236, hry: () => 186, hcy: 452,
      sex: 270, swx: 730, sy: 452, sr: 11,
      nadir: { x: 500, y: 459, s: 6 }, starSeed: 5, starGap: 33, starR: 5.2,
      starIn: (x, y) => ((x - 500) / 224) ** 2 + ((y - 452) / 175) ** 2 < 1 && y < 420,
      starAvoid: (x, y) => x > 622 && x < 686 && y > 380 };
    // hour-angle pips: use elliptical ring
    G.hr0 = 1; G.hr1 = 1;
    const mg = moonGraph(G);
    const L = { mx: 205, my: 538, mp: 9.2, md: 7.8, mg: 12,
      sx: 556, sy: 538, sw: 40, sh: 63, st: 8.2, sgap: 10, sdz: 24, g: 1.5, slant: 3,
      ly: 624, lcap: 10, ix: 726, isz: 18,
      bx: 262, by: 638, bw: 72, bh: 106, bt: 14, bgap: 14, bcz: 25, bsgap: 18, ssw: 46, ssh: 70, sst: 9.6,
      ix0: 200, icap: 12 };
    const lcd = lcdBlock(L);
    // seconds ring q0..q59 on an annular LCD strip
    const ring = [];
    for (let i = 0; i < 60; i++) {
      const a = (i * 6 - 90) * RAD, c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c;
      const r0 = 423, r1 = 441, hw = i % 5 === 0 ? 3.6 : 2.6;
      ring.push({ id: 'q' + i, cls: 'lcd', d: P([[500 + r0 * c + nx * hw, 500 + r0 * s + ny * hw], [500 + r1 * c + nx * hw, 500 + r1 * s + ny * hw], [500 + r1 * c - nx * hw, 500 + r1 * s - ny * hw], [500 + r0 * c - nx * hw, 500 + r0 * s - ny * hw]]) });
    }
    let ticks = '', ticks5 = '';
    for (let i = 0; i < 60; i++) {
      const a = (i * 6 - 90) * RAD, c = Math.cos(a), s = Math.sin(a);
      if (i % 5 === 0) ticks5 += `M${f1(500 + 452 * c)} ${f1(500 + 452 * s)}L${f1(500 + 478 * c)} ${f1(500 + 478 * s)}`;
      else ticks += `M${f1(500 + 462 * c)} ${f1(500 + 462 * s)}L${f1(500 + 478 * c)} ${f1(500 + 478 * s)}`;
    }
    const winD = `M${Wn.cx - Wn.rx} ${Wn.bottom}V${Wn.cy}A${Wn.rx} ${Wn.ry} 0 0 1 ${Wn.cx + Wn.rx} ${Wn.cy}V${Wn.bottom}Z`;
    const inWin = (x, y) => ((x - Wn.cx) / (Wn.rx - 10)) ** 2 + ((y - Wn.cy) / (Wn.ry - 10)) ** 2 < 1 && y < Wn.cy - 20;
    const avoid = (x, y) => {
      const e = Math.hypot((x - Wn.cx) / 236, (y - Wn.cy) / 186);
      if (e > 0.92 && e < 1.08) return true;
      return mg.slice(0, 9).some((m) => (m.cx - x) ** 2 + (m.cy - y) ** 2 < 38 ** 2);
    };
    const starSvg = specks(42, 24, (x, y) => inWin(x, y) && !avoid(x, y), mg);
    // hills + observatory silhouette
    const hills = `M${Wn.cx - Wn.rx} ${Wn.bottom}V442C300 428 352 424 400 434S470 450 520 440S612 418 660 422S740 436 ${Wn.cx + Wn.rx} 438V${Wn.bottom}Z`;
    const hills2 = `M${Wn.cx - Wn.rx} ${Wn.bottom}V456C320 448 380 452 440 458S560 452 620 454S720 458 ${Wn.cx + Wn.rx} 452V${Wn.bottom}Z`;
    const obs = `M640 423h28v-10a14 14 0 0 0 -28 0z`;
    const slit = `M652 399h4v14h-4z`;
    let haTicks = '';
    for (let k = 0; k < 13; k++) {
      const a = (180 - k * 15) * RAD;
      const x = Wn.cx + 236 * Math.cos(a), y = Wn.cy - 186 * Math.sin(a);
      haTicks += circleD(x, y, 1.8);
    }
    const lcdBox = { x: 178, y: 512, w: 644, h: 250, r: 24 };
    const svg = `
<defs>
  <radialGradient id="deskDial" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="${C.dial0}"/><stop offset="1" stop-color="${C.dial1}"/></radialGradient>
  <linearGradient id="deskSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#091226"/><stop offset=".8" stop-color="#18294d"/><stop offset="1" stop-color="#2a3d63"/></linearGradient>
  <linearGradient id="deskLcd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.lcd0}"/><stop offset="1" stop-color="${C.lcd1}"/></linearGradient>
  <linearGradient id="deskGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
</defs>
<circle cx="500" cy="500" r="500" fill="url(#deskDial)"/>
<circle cx="500" cy="500" r="488" fill="none" stroke="${C.ink}" stroke-opacity=".75" stroke-width="2.2"/>
<path d="${ticks}" stroke="${C.ink}" stroke-opacity=".7" stroke-width="2"/>
<path d="${ticks5}" stroke="${C.ink}" stroke-width="4.6"/>
<path d="${ringPath(500, 500, 446, 418)}" fill="#cfd3c3" fill-rule="evenodd"/>
<path d="${ringPath(500, 500, 446, 418)}" fill="none" stroke="#8c8f86" stroke-width="1.4"/>
<path class="glass" d="${ringPath(500, 500, 446, 418)}" fill="url(#deskGlass)" fill-rule="evenodd"/>
${text('brand', 'SELENE', 500, 168, 30, { align: 'middle', track: 0.2, attrs: `fill="${C.ink}"` })}
${text('label', 'LUNAR ALARM', 500, 198, 11, { align: 'middle', track: 0.46, attrs: `fill="${C.brass}"` })}
<path d="${winD}" fill="url(#deskSky)"/>
<g fill="#dfe7f3">${starSvg}</g>
<path d="${haTicks}" fill="#9fb0cc" opacity=".8"/>
<path d="${hills}" fill="#101b24"/>
<path d="${hills2}" fill="#0a1218"/>
<path d="${obs}" fill="#1b2732"/><path d="${slit}" fill="#060a0e"/>
<path d="${winD}" fill="none" stroke="${C.brass}" stroke-width="3.4"/>
${text('label', 'E', Wn.cx - Wn.rx, Wn.bottom + 20, 10, { attrs: `fill="${C.brass}"` })}
${text('label', 'W', Wn.cx + Wn.rx, Wn.bottom + 20, 10, { align: 'end', attrs: `fill="${C.brass}"` })}
<g class="mgl">${segPaths(mg)}</g>
<path d="${rrect(lcdBox.x - 8, lcdBox.y - 8, lcdBox.w + 16, lcdBox.h + 16, lcdBox.r + 7)}" fill="#2a2a28"/>
<path d="${rrect(lcdBox.x - 8, lcdBox.y - 8, lcdBox.w + 16, lcdBox.h + 16, lcdBox.r + 7)}" fill="none" stroke="${C.brass}" stroke-width="2.4"/>
<path class="lcdbg" d="${rrect(lcdBox.x, lcdBox.y, lcdBox.w, lcdBox.h, lcdBox.r)}" fill="url(#deskLcd)"/>
<path class="el" d="${rrect(lcdBox.x, lcdBox.y, lcdBox.w, lcdBox.h, lcdBox.r)}" fill="#74e6cf" opacity="0"/>
<g class="lcdl">${segPaths(lcd)}${segPaths(ring)}</g>
<path class="glass" d="${rrect(lcdBox.x, lcdBox.y, lcdBox.w, lcdBox.h, lcdBox.r)}" fill="url(#deskGlass)" pointer-events="none"/>
${text('label', 'MOON · SUN · ALARM · CHRONO', 500, 812, 13, { align: 'middle', track: 0.22, attrs: `fill="${C.silver}"` })}
${text('cond', 'QUARTZ', 500, 846, 10.5, { align: 'middle', track: 0.55, attrs: `fill="${C.brass}"` })}
`;
    return { id: 'desk', name: 'Desk', svg, segs: mg.concat(lcd, ring), palette: {
      lcdOn: '#1a1e1b', lcdGhost: 'rgba(26,30,27,.038)', mgOn: '#f4cf6c', mgGhost: 'rgba(244,207,108,.016)',
      stOn: '#eef3fc', stGhost: 'rgba(238,243,252,.024)',
      shadow: 'rgba(30,34,30,.30)', glow: 'rgba(255,220,130,.5)', negative: false, el: '#8ef0d5' }, lcdBox, kind: 'clock' };
  }

  // ================================================================ FACE: NOIR (night, negative LCD)
  function buildNoir(opt = {}) {
    const W = { cx: 500, cy: 468, R: 300 };
    const G = { cx: 500, cy: W.cy, rx: 206, ry: 206, mr: 33, a0: 162, astep: 18,
      hr0: 248, hr1: 266, hw: 8, hrx: (r) => r, hry: (r) => r, sex: 236, swx: 764, sy: W.cy, sr: 13,
      nadir: { x: 500, y: W.cy + 22, s: 6.5 }, starSeed: 31, starGap: 38, starR: 5.8,
      starIn: (x, y) => (x - W.cx) ** 2 + (y - W.cy) ** 2 < 232 ** 2 && y < W.cy - 14,
      starAvoid: () => false };
    const mg = moonGraph(G);
    const L = { mx: 182, my: 546, mp: 9.8, md: 8.4, mg: 12,
      sx: 562, sy: 546, sw: 43, sh: 67, st: 8.8, sgap: 11, sdz: 26, g: 1.7, slant: 0,
      ly: 640, lcap: 10.5, ix: 734, isz: 19,
      bx: 254, by: 656, bw: 74, bh: 110, bt: 14.5, bgap: 15, bcz: 26, bsgap: 20, ssw: 50, ssh: 76, sst: 10.5,
      ix0: 176, icap: 12.5 };
    const lcd = lcdBlock(L);
    const inDome = (x, y) => (x - W.cx) ** 2 + (y - W.cy) ** 2 < (W.R - 10) ** 2 && y < W.cy - 12;
    const avoid = (x, y) => {
      const r = Math.hypot(x - W.cx, y - W.cy);
      if (r > 236 && r < 274) return true;
      return mg.slice(0, 9).some((m) => (m.cx - x) ** 2 + (m.cy - y) ** 2 < 46 ** 2);
    };
    const starSvg = specks(99, 20, (x, y) => inDome(x, y) && !avoid(x, y), mg);
    const domeD = `M${W.cx - W.R} ${W.cy}A${W.R} ${W.R} 0 0 1 ${W.cx + W.R} ${W.cy}Z`;
    let haScale = '';
    for (let k = 0; k <= 12; k++) {
      const a = (180 - k * 15) * RAD, c = Math.cos(a), s = Math.sin(a);
      haScale += `M${f1(W.cx + 274 * c)} ${f1(W.cy - 274 * s)}L${f1(W.cx + 284 * c)} ${f1(W.cy - 284 * s)}`;
    }
    const lcdBox = { x: 146, y: 522, w: 708, h: 262, r: 30 };
    const svg = `
<defs>
  <radialGradient id="noirDial" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#101216"/><stop offset="1" stop-color="#050607"/></radialGradient>
  <linearGradient id="noirLcd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07080a"/><stop offset="1" stop-color="#030304"/></linearGradient>
</defs>
<circle cx="500" cy="500" r="500" fill="url(#noirDial)"/>
<circle cx="500" cy="500" r="484" fill="none" stroke="#262b33" stroke-width="2"/>
${text('brand', 'SELENE', 500, 142, 24, { align: 'middle', track: 0.24, attrs: 'fill="#4d5562"' })}
<path d="${domeD}" fill="#020305"/>
<g fill="#6d7b8f">${starSvg}</g>
<path d="${haScale}" stroke="#3a4250" stroke-width="2"/>
<path d="M${W.cx - W.R} ${W.cy}H${W.cx + W.R}" stroke="#39414d" stroke-width="2"/>
<path d="${domeD}" fill="none" stroke="#232831" stroke-width="3"/>
<g class="mgl">${segPaths(mg)}</g>
<path d="${rrect(lcdBox.x - 6, lcdBox.y - 6, lcdBox.w + 12, lcdBox.h + 12, lcdBox.r + 5)}" fill="#101215" stroke="#262b33" stroke-width="2"/>
<path class="lcdbg" d="${rrect(lcdBox.x, lcdBox.y, lcdBox.w, lcdBox.h, lcdBox.r)}" fill="url(#noirLcd)"/>
<path class="el" d="${rrect(lcdBox.x, lcdBox.y, lcdBox.w, lcdBox.h, lcdBox.r)}" fill="#ff9a3c" opacity="0"/>
<g class="lcdl">${segPaths(lcd)}</g>
${text('label', 'MOON · SUN · ALARM', 500, 846, 12, { align: 'middle', track: 0.3, attrs: 'fill="#3b424d"' })}
`;
    return { id: 'noir', name: 'Noir', svg, segs: mg.concat(lcd), palette: {
      lcdOn: '#ffb04a', lcdGhost: 'rgba(255,176,74,.028)', mgOn: '#ffbf5c', mgGhost: 'rgba(255,191,92,.012)',
      stOn: '#ffd9a6', stGhost: 'rgba(255,217,166,.016)',
      shadow: 'rgba(0,0,0,0)', glow: 'rgba(255,160,60,.55)', negative: true, el: '#ffb04a' }, lcdBox, kind: 'clock' };
  }

  const BUILDERS = { arc: buildArc, desk: buildDesk, noir: buildNoir };
  const cache = {};
  function build(id, opt = {}) {
    const key = id + (opt.classic ? ':classic' : '');
    return cache[key] || (cache[key] = BUILDERS[id](opt));
  }

  /** Full standalone SVG document for a face (used by the firmware pipeline & previews). */
  function standalone(id, extraCss = '') {
    const F = build(id), p = F.palette;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">
<style>
.s{fill:${'var(--ghost)'}}
.lcd{--ghost:${p.lcdGhost}} .mg{--ghost:${p.mgGhost}} .st{--ghost:${p.stGhost}}
.lcd.on{fill:${p.lcdOn}} .mg.on{fill:${p.mgOn}} .st.on{fill:${p.stOn}}
${extraCss}
</style>${F.svg}</svg>`;
  }

  return { build, standalone, ids: Object.keys(BUILDERS), text, arcText, seg7, rrect };
});

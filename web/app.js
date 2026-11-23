/* Selene web simulator — UI shell. Uses SeleneAstro, SeleneGMW15, SeleneFaces, SeleneModule, SeleneGlyphs. */
(function () {
  'use strict';
  const A = window.SeleneAstro, G = window.SeleneGMW15, F = window.SeleneFaces, MOD = window.SeleneModule;
  const $ = (s, r = document) => r.querySelector(s);
  const DAY = 86400000, HOUR = 3600000, MIN = 60000;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('selene.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('selene.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ------------------------------------------------------------------ simulated clock
  const sim = { real0: performance.now(), sim0: Date.now(), speed: 1 };
  const nowSim = () => sim.sim0 + (performance.now() - sim.real0) * sim.speed;
  function rebase(simMs, speed) { sim.sim0 = simMs; sim.real0 = performance.now(); if (speed !== undefined) sim.speed = speed; }

  // ------------------------------------------------------------------ sound (WebAudio, piezo-like)
  const snd = {
    ctx: null, out: null, on: store.get('sound', true), vol: store.get('vol', 0.35), loops: {},
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = new AC();
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      this.out = this.ctx.createGain(); this.out.gain.value = this.vol * 0.22;
      this.out.connect(lp); lp.connect(this.ctx.destination);
    },
    setVol(v) { this.vol = v; if (this.out) this.out.gain.value = v * 0.22; },
    tone(at, dur, f = 4096) {
      if (!this.on || !this.ctx) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + 0.003); g.gain.setValueAtTime(1, at + dur - 0.004); g.gain.linearRampToValueAtTime(0, at + dur);
      o.connect(g); g.connect(this.out); o.start(at); o.stop(at + dur + 0.01);
    },
    t() { return this.ctx ? this.ctx.currentTime + 0.01 : 0; },
    key() { this.tone(this.t(), 0.045); },
    chime() { const t = this.t(); this.tone(t, 0.09); this.tone(t + 0.16, 0.09); },
    burst() { const t = this.t(); for (let i = 0; i < 4; i++) this.tone(t + i * 0.125, 0.065); },
    loop(name, fn, every) { this.stop(name); fn(); this.loops[name] = setInterval(fn, every); },
    stop(name) { clearInterval(this.loops[name]); delete this.loops[name]; },
  };

  // ------------------------------------------------------------------ module
  const mod = new MOD.Module(store.get('settings', null), {
    real: () => performance.now(),
    save: (s) => store.set('settings', s),
    emit: (e) => {
      if (e === 'key') snd.key();
      else if (e === 'chime') snd.chime();
      else if (e === 'alarm-start') snd.loop('alarm', () => snd.burst(), 1000);
      else if (e === 'alarm-stop') snd.stop('alarm');
      else if (e === 'test-start') snd.loop('test', () => snd.burst(), 1000);
      else if (e === 'test-stop') snd.stop('test');
      else if (e === 'light') lightOn();
      else if (e === 'snooze') snd.key();
    },
  });

  // ------------------------------------------------------------------ device bodies
  const FACES = [
    { id: 'arc', label: 'Arc', sub: 'wristwatch' },
    { id: 'desk', label: 'Desk', sub: 'alarm clock' },
    { id: 'noir', label: 'Noir', sub: 'night clock' },
  ];
  const BTN = { B: 'SET', C: 'MODE', D: 'REV', A: 'FWD', L: 'LIGHT' };
  const KEYS = { B: 'B', C: 'C', D: 'D', A: 'A', L: 'L' };

  // ------------------------------------------------------------------ device rendering
  // A device is five stacked SVG layers that share one viewBox and sit at different depths, so tilting it
  // gives real parallax: body (case, strap, pushers) · dial (printed face, seen through the dome) ·
  // segments (the live LCD) · glass (bezel lip and crystal rim) · reflections.
  const n1 = (n) => (+n).toFixed(1);
  const pol = (cx, cy, r, deg) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];
  const arcD = (cx, cy, r, a0, a1) => { const p = pol(cx, cy, r, a0), q = pol(cx, cy, r, a1); return `M${n1(p[0])} ${n1(p[1])}A${n1(r)} ${n1(r)} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${n1(q[0])} ${n1(q[1])}`; };
  /** Ring sector between two radii (closed path). */
  const sectorD = (cx, cy, r0, r1, a0, a1) => { const p = pol(cx, cy, r0, a1); return `${arcD(cx, cy, r1, a0, a1)}L${n1(p[0])} ${n1(p[1])}${arcD(cx, cy, r0, a1, a0).replace('M', 'L')}Z`; };
  /** Clip that cuts the crystal aperture out of a body layer: the dial is a separate, deeper layer seen through it. */
  const holeClip = (cx, cy, r) => `<clipPath id="bodyHole"><path clip-rule="evenodd" d="M-600 -600H1600V2400H-600ZM${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z"/></clipPath>`;
  const svgOpen = (cls, vb, extra = '') => `<svg class="L ${cls}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" ${extra}>`;

  // Displacement map for the domed crystal: flat in the middle (the LCD stays put) and bending the print
  // outward more and more toward the rim, the way a dome stretches whatever sits under its edge.
  const lensCache = {};
  function lensMap(r0) {
    if (lensCache[r0]) return lensCache[r0];
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), im = g.createImageData(N, N), d = im.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N * 1000 - 500, y = (j + 0.5) / N * 1000 - 500, r = Math.hypot(x, y) || 1;
      const t = Math.min(1, Math.max(0, (r - r0) / (500 - r0))), m = -t * t, o = (j * N + i) * 4;
      d[o] = Math.round(128 + 127 * m * x / r); d[o + 1] = Math.round(128 + 127 * m * y / r); d[o + 2] = 128; d[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
    return (lensCache[r0] = c.toDataURL());
  }
  const LENS = { arc: { r0: 404, k: 21 }, desk: { r0: 450, k: 16 }, noir: { r0: 420, k: 18 } };
  // The map reaches the filter as a data: image. Only switch the lens on once such an image is known to load here,
  // because a map that fails to load would shift the whole dial instead of bending its rim.
  let lensOk = false;
  { const im = new Image(); im.onload = () => { lensOk = im.naturalWidth === 256; if (lensOk) $('#device').classList.add('lens'); }; im.src = lensMap(LENS.arc.r0); }

  function dialLayers(vb, face, cx, cy, Rf) {
    const pal = face.palette, s = Rf / 500, L = LENS[face.id];
    const tf = `transform="translate(${cx - Rf} ${cy - Rf}) scale(${s})"`;
    const clip = (id) => `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${Rf}"/></clipPath>`;
    const print = face.svg.replace(/data-s="/g, 'data-g="');
    const by = { lcd: '', mg: '', st: '' };
    for (const q of face.segs) by[q.cls] += `<path class="s" data-s="${q.id}" d="${q.d}"/>`;
    return `${svgOpen('dial', vb, 'aria-hidden="true"')}<defs>${clip('dialClip')}
<filter id="dome" filterUnits="userSpaceOnUse" x="0" y="0" width="1000" height="1000" color-interpolation-filters="sRGB"><feImage href="${lensMap(L.r0)}" x="0" y="0" width="1000" height="1000" preserveAspectRatio="none" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="${2 * L.k}" xChannelSelector="R" yChannelSelector="G"/></filter></defs>
<circle cx="${cx}" cy="${cy}" r="${Rf + 30}" fill="#020203"/>
<g clip-path="url(#dialClip)"><g ${tf}><g class="print">${print}</g></g></g></svg>
${svgOpen('segs', vb, 'aria-hidden="true"')}<defs>${clip('segClip')}
<filter id="lcdShadow" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="2.2" dy="2.8" stdDeviation="1.3" flood-color="${pal.shadow}" flood-opacity="1"/></filter>
<filter id="mgGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 .9 0 0 0  0 0 .6 0 0  0 0 0 .55 0" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="stGlow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceGraphic" stdDeviation="3" result="b"/><feColorMatrix in="b" type="matrix" values="${pal.negative ? '1 0 0 0 0  0 .8 0 0 0  0 0 .5 0 0' : '.7 0 0 0 0  0 .85 0 0 0  0 0 1 0 0'}  0 0 0 .75 0" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<g clip-path="url(#segClip)"><g ${tf} class="dyn"><g class="lcdl">${by.lcd}</g><g class="mgl">${by.mg}</g><g class="stl">${by.st}</g></g></g></svg>`;
  }

  /** Bezel lip, the shadow it throws on the dial, and the edge of the domed crystal. Ra = aperture radius. */
  function glassLayer(vb, cx, cy, Ra, o) {
    return `${svgOpen('glass', vb, 'aria-hidden="true"')}<defs>
<filter id="gb3" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="gb7" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>
<linearGradient id="lipG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${o.lip[0]}"/><stop offset=".42" stop-color="${o.lip[1]}"/><stop offset=".6" stop-color="${o.lip[1]}"/><stop offset="1" stop-color="${o.lip[2]}"/></linearGradient>
<linearGradient id="rimG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${o.rim}"/><stop offset=".36" stop-color="#fff" stop-opacity="0"/><stop offset=".64" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="${o.rim * 0.45}"/></linearGradient>
<radialGradient id="wallG" gradientUnits="userSpaceOnUse" cx="${cx + 9}" cy="${cy + 13}" r="${Ra + 16}"><stop offset=".86" stop-color="#000" stop-opacity="0"/><stop offset=".95" stop-color="#000" stop-opacity="${o.wall * 0.45}"/><stop offset="1" stop-color="#000" stop-opacity="${o.wall}"/></radialGradient>
<radialGradient id="tintG" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${Ra}"><stop offset=".55" stop-color="#9fc0ee" stop-opacity="0"/><stop offset=".84" stop-color="#9fc0ee" stop-opacity="${o.tint}"/><stop offset=".94" stop-color="#05070a" stop-opacity="${o.edge * 0.5}"/><stop offset="1" stop-color="#000" stop-opacity="${o.edge}"/></radialGradient>
</defs>
<circle cx="${cx}" cy="${cy}" r="${Ra + 1}" fill="url(#wallG)"/>
<g class="domeonly"><circle cx="${cx}" cy="${cy}" r="${Ra}" fill="url(#tintG)"/>
<path d="${arcD(cx, cy, Ra - 19, 204, 264)}" fill="none" stroke="#fff" stroke-opacity="${o.rim * 0.5}" stroke-width="8" stroke-linecap="round" filter="url(#gb3)"/>
<path d="${arcD(cx, cy, Ra - 17, 20, 70)}" fill="none" stroke="#fff" stroke-opacity="${o.rim * 0.2}" stroke-width="11" stroke-linecap="round" filter="url(#gb7)"/>
<circle cx="${cx}" cy="${cy}" r="${Ra - 11}" fill="none" stroke="url(#rimG)" stroke-width="1.2" opacity=".5"/></g>
<circle cx="${cx}" cy="${cy}" r="${Ra + 8}" fill="none" stroke="url(#lipG)" stroke-width="16"/>
<circle cx="${cx}" cy="${cy}" r="${Ra + 16}" fill="none" stroke="#000" stroke-opacity=".85" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="${Ra}" fill="none" stroke="#000" stroke-opacity=".9" stroke-width="3"/>
<circle cx="${cx}" cy="${cy}" r="${Ra - 4}" fill="none" stroke="url(#rimG)" stroke-width="2.4"/>
</svg>`;
  }
  /** Reflections of the room in the dome; this layer floats above the glass and slides as the device tilts. */
  function specLayer(vb, cx, cy, Ra, k) {
    const h = pol(cx, cy, Ra * 0.6, 232);
    return `${svgOpen('spec', vb, 'aria-hidden="true"')}<defs>
<filter id="sb8" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="sb14" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="14"/></filter>
<linearGradient id="paneG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="${0.2 * k}"/><stop offset="1" stop-color="#fff" stop-opacity="${0.02 * k}"/></linearGradient>
</defs>
<path d="${sectorD(cx, cy, Ra * 0.5, Ra * 0.84, 202, 250)}" fill="url(#paneG)" filter="url(#sb14)"/>
<path d="${sectorD(cx, cy, Ra * 0.6, Ra * 0.82, 258, 276)}" fill="#fff" fill-opacity="${0.06 * k}" filter="url(#sb14)"/>
<ellipse cx="${n1(h[0])}" cy="${n1(h[1])}" rx="52" ry="12" transform="rotate(-38 ${n1(h[0])} ${n1(h[1])})" fill="#fff" fill-opacity="${0.26 * k}" filter="url(#sb8)"/>
<path d="${sectorD(cx, cy, Ra * 0.62, Ra * 0.8, 28, 64)}" fill="#fff" fill-opacity="${0.045 * k}" filter="url(#sb14)"/>
</svg>`;
  }

  function pusher(btn, ang, cx, cy, R) {
    const x = cx + R;
    let knurl = '';
    for (let i = 0; i < 5; i++) knurl += `M${x + 15 + i * 5} ${cy - 16}v32`;
    return `<g data-btn="${btn}" transform="rotate(${ang} ${cx} ${cy})" style="--px:-6px;--py:0px" role="button" aria-label="${BTN[btn]}">
<rect x="${x - 34}" y="${cy - 47}" width="54" height="94" rx="21" fill="url(#guardG)"/>
<rect x="${x - 34}" y="${cy - 47}" width="54" height="94" rx="21" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="2"/>
<rect x="${x + 6}" y="${cy - 20}" width="18" height="40" rx="5" fill="#010102"/>
<g class="cap"><rect x="${x + 10}" y="${cy - 17}" width="32" height="34" rx="7" fill="url(#steelV)"/>
<path d="${knurl}" stroke="#000" stroke-opacity=".28" stroke-width="1.6"/>
<rect x="${x + 36}" y="${cy - 17}" width="6" height="34" rx="3" fill="#fff" opacity=".32"/></g>
<rect x="${x - 34}" y="${cy - 52}" width="100" height="104" fill="transparent"/></g>`;
  }
  function watchLayers(face) {
    const vb = '0 240 1000 1080', cx = 500, cy = 780, Rc = 440, Ra = 356, Rf = 368, Rs = Rc - 30;
    let ribs = '';
    for (let y = 8; y < 318; y += 27) ribs += `M310 ${y}H440M560 ${y}H690`;
    const strap = `<path d="M302 -30H698L705 360H295Z" fill="url(#strapG)"/>
<path d="M452 -30H548V306Q548 322 532 322H468Q452 322 452 306Z" fill="#040506" opacity=".8"/>
<path d="M452 -30V306Q452 322 468 322H532Q548 322 548 306V-30" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="2"/>
<path d="${ribs}" stroke="#000" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>
<path d="${ribs}" stroke="#fff" stroke-opacity=".055" stroke-width="1.6" stroke-linecap="round" transform="translate(0 4.5)"/>
<path d="M244 610C244 462 274 374 312 344Q323 335 338 335H662Q677 335 688 344C726 374 756 462 756 610Z" fill="url(#lugG)"/>
<path d="M330 338.5H670" stroke="#fff" stroke-opacity=".13" stroke-width="2.5" stroke-linecap="round"/>
<path d="M262 520C270 440 292 380 318 352" fill="none" stroke="#fff" stroke-opacity=".07" stroke-width="3" stroke-linecap="round"/>
<circle cx="322" cy="366" r="6.5" fill="#020203"/><circle cx="322" cy="367.5" r="6.5" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/>
<circle cx="678" cy="366" r="6.5" fill="#020203"/><circle cx="678" cy="367.5" r="6.5" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.4"/>`;
    const Rm = (Rs - 2 + Ra + 16) / 2, Wm = Rs - 2 - (Ra + 16);
    return `${svgOpen('body', vb, 'aria-label="Selene Arc watch"')}<defs>
${holeClip(cx, cy, Ra + 9)}
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="24"/></filter>
<filter id="bb2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>
<filter id="bb9" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
<linearGradient id="slopeG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3d43"/><stop offset=".3" stop-color="#17181b"/><stop offset=".62" stop-color="#0b0c0d"/><stop offset="1" stop-color="#1c1e21"/></linearGradient>
<linearGradient id="strapG" x1="0" x2="1"><stop offset="0" stop-color="#040405"/><stop offset=".07" stop-color="#17191d"/><stop offset=".3" stop-color="#101114"/><stop offset=".7" stop-color="#0f1013"/><stop offset=".93" stop-color="#191b1f"/><stop offset="1" stop-color="#040405"/></linearGradient>
<linearGradient id="lugG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#24262b"/><stop offset=".12" stop-color="#131417"/><stop offset="1" stop-color="#0a0b0d"/></linearGradient>
<linearGradient id="guardG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d1f23"/><stop offset=".5" stop-color="#0e0f11"/><stop offset="1" stop-color="#060607"/></linearGradient>
<radialGradient id="caseG" cx="38%" cy="28%" r="80%"><stop offset="0" stop-color="#26282d"/><stop offset=".55" stop-color="#111215"/><stop offset="1" stop-color="#060607"/></radialGradient>
<linearGradient id="chamG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".3" stop-color="#fff" stop-opacity=".03"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
<linearGradient id="glossG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".17"/><stop offset=".28" stop-color="#fff" stop-opacity=".015"/><stop offset=".72" stop-color="#fff" stop-opacity=".01"/><stop offset="1" stop-color="#fff" stop-opacity=".09"/></linearGradient>
<linearGradient id="steelV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".45" stop-color="#aab1bb"/><stop offset="1" stop-color="#565c66"/></linearGradient>
</defs><g clip-path="url(#bodyHole)">
<ellipse cx="${cx + 14}" cy="${cy + 46}" rx="452" ry="480" fill="#000" opacity=".6" filter="url(#soft)"/>
<g>${strap}</g><g transform="translate(0 ${2 * cy}) scale(1 -1)">${strap}</g>
${pusher('B', 212, cx, cy, Rc)}${pusher('C', 148, cx, cy, Rc)}${pusher('D', -32, cx, cy, Rc)}${pusher('A', 32, cx, cy, Rc)}
<circle cx="${cx}" cy="${cy}" r="${Rc}" fill="url(#caseG)"/>
<circle cx="${cx}" cy="${cy}" r="${Rc - 1.5}" fill="none" stroke="url(#chamG)" stroke-width="3"/>
<circle cx="${cx}" cy="${cy}" r="${(Rc + Rs) / 2}" fill="none" stroke="url(#slopeG)" stroke-width="${Rc - Rs}"/>
<circle cx="${cx}" cy="${cy}" r="${Rs + 1}" fill="#000" opacity=".7"/>
<circle cx="${cx}" cy="${cy}" r="${Rs - 2}" fill="#0b0c0e"/>
<circle cx="${cx}" cy="${cy}" r="${Rm}" fill="none" stroke="url(#glossG)" stroke-width="${Wm}"/>
<circle cx="${cx}" cy="${cy}" r="${Rs - 4}" fill="none" stroke="url(#chamG)" stroke-width="2.4"/>
<path d="${arcD(cx, cy, Rm + 3, 198, 256)}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="20" stroke-linecap="round" filter="url(#bb9)"/>
<path d="${arcD(cx, cy, Rm + 6, 208, 247)}" fill="none" stroke="#fff" stroke-opacity=".42" stroke-width="5" stroke-linecap="round" filter="url(#bb2)"/>
<path d="${arcD(cx, cy, Rm + 6, 262, 274)}" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="4" stroke-linecap="round" filter="url(#bb2)"/>
<path d="${arcD(cx, cy, Rm, 18, 68)}" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="22" stroke-linecap="round" filter="url(#bb9)"/>
<path d="${arcD(cx, cy, Rm - 5, 30, 58)}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="3.5" stroke-linecap="round" filter="url(#bb2)"/>
</g></svg>
${dialLayers(vb, face, cx, cy, Rf)}
${glassLayer(vb, cx, cy, Ra, { lip: ['#34373d', '#060607', '#1b1d21'], rim: 0.75, wall: 0.62, tint: 0.035, edge: 0.42 })}
${specLayer(vb, cx, cy, Ra, 1)}`;
  }
  function clockLayers(face) {
    const vb = '0 0 1000 1240', cx = 500, cy = 560, Ra = 398, Rf = 410, noir = face.id === 'noir';
    const ring0 = noir ? ['#2b2f36', '#0b0c0f', '#3a3f48', '#08090b'] : ['#f1e3c0', '#a7864f', '#f6ead0', '#8b6b3a'];
    const ped = noir ? ['#1b1d22', '#0a0b0d'] : ['#7a4e2f', '#3e2616'];
    return `${svgOpen('body', vb, `aria-label="Selene ${face.name} clock"`)}<defs>
${holeClip(cx, cy, Ra + 9)}
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ring0[0]}"/><stop offset=".35" stop-color="${ring0[1]}"/><stop offset=".6" stop-color="${ring0[2]}"/><stop offset="1" stop-color="${ring0[3]}"/></linearGradient>
<linearGradient id="ped" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ped[1]}"/><stop offset=".45" stop-color="${ped[0]}"/><stop offset="1" stop-color="${ped[1]}"/></linearGradient>
<linearGradient id="btnTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${noir ? '#3a3f48' : '#f4e9d2'}"/><stop offset="1" stop-color="${noir ? '#121418' : '#9a7a46'}"/></linearGradient>
</defs><g clip-path="url(#bodyHole)">
<ellipse cx="${cx}" cy="1190" rx="330" ry="34" fill="#000" opacity=".6" filter="url(#soft)"/>
<path d="M392 990H608L700 1168Q704 1182 690 1182H310Q296 1182 300 1168Z" fill="url(#ped)"/>
<path d="M300 1168H700" stroke="#fff" stroke-opacity=".08" stroke-width="3"/>
<g data-btn="L" style="--px:0px;--py:7px" role="button" aria-label="LIGHT / SNOOZE">
<rect x="420" y="86" width="160" height="26" rx="6" fill="#0b0c0f"/>
<g class="cap"><rect x="400" y="58" width="200" height="40" rx="14" fill="url(#btnTop)"/><rect x="412" y="62" width="176" height="8" rx="4" fill="#fff" opacity=".25"/></g>
<rect x="380" y="40" width="240" height="80" fill="transparent"/></g>
<circle cx="${cx}" cy="${cy}" r="474" fill="url(#ring)"/>
<circle cx="${cx}" cy="${cy}" r="474" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="440" fill="${noir ? '#060708' : '#2a2219'}"/>
<circle cx="${cx}" cy="${cy}" r="426" fill="url(#ring)" opacity=".55"/>
</g></svg>
${dialLayers(vb, face, cx, cy, Rf)}
${glassLayer(vb, cx, cy, Ra, noir ? { lip: ['#23262b', '#050506', '#131518'], rim: 0.45, wall: 0.6, tint: 0.02, edge: 0.4 } : { lip: ['#4a3f2d', '#15110b', '#2c2418'], rim: 0.85, wall: 0.42, tint: 0.03, edge: 0.22 })}
${specLayer(vb, cx, cy, Ra, noir ? 0.55 : 1.15)}`;
  }

  // ------------------------------------------------------------------ mount
  let faceId = store.get('face', 'arc');
  let segEls = new Map(), lit = new Set(), deviceSvg = null;
  const device = $('#device');
  function mount(id) {
    if (!F.ids.includes(id)) id = 'arc';
    faceId = id; store.set('face', id);
    const face = F.build(id, { classic: store.get('dialText', 'modern') === 'classic' }), pal = face.palette;
    device.className = 'device ' + face.kind + (pal.negative ? ' neg' : '') + (lensOk ? ' lens' : '');
    device.innerHTML = face.kind === 'watch' ? watchLayers(face) : clockLayers(face);
    deviceSvg = device.querySelector('.segs');
    const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    st.textContent = `.lcd{--g:${pal.lcdGhost}} .mg{--g:${pal.mgGhost}} .st{--g:${pal.stGhost}} .dyn .lcdl .s{fill:${pal.lcdOn}} .dyn .mgl .s{fill:${pal.mgOn}} .dyn .stl .s{fill:${pal.stOn}}`;
    device.querySelector('.dial').prepend(st.cloneNode(true)); deviceSvg.prepend(st);
    segEls = new Map();
    deviceSvg.querySelectorAll('[data-s]').forEach((el) => segEls.set(el.dataset.s, el));
    lit = new Set();
    applyOpts();
    buildButtons(face);
    $('#modelTag').textContent = face.kind === 'watch' ? 'Lunar Arc · wristwatch' : (id === 'noir' ? 'Noir · night clock' : 'Lunar Alarm · desk clock');
    document.querySelectorAll('#faceSeg button').forEach((b) => b.classList.toggle('on', b.dataset.face === id));
    bindDeviceButtons();
    lastPanel = -1e9; lastHints = '';
    frame();
  }
  function applyOpts() {
    if (!deviceSvg) return;
    device.classList.toggle('no-ghost', !opts.ghost);
    device.classList.toggle('seg-shadow', opts.shadow);
    device.classList.toggle('dome', opts.dome);
  }
  let lightTimer = 0;
  function lightOn() {
    if (!deviceSvg || F.build(faceId).kind !== 'clock') return;
    device.classList.add('lit'); clearTimeout(lightTimer);
    lightTimer = setTimeout(() => device.classList.remove('lit'), 3000);
  }

  // ------------------------------------------------------------------ input
  const pressed = new Set();
  function down(btn) {
    snd.init();
    if (pressed.has(btn)) return;
    if (btn === 'L' && F.build(faceId).kind !== 'clock') return;
    pressed.add(btn);
    mod.press(btn, nowSim());
    document.querySelectorAll(`[data-btn="${btn}"]`).forEach((e) => e.classList.add('down'));
    frame();
  }
  function up(btn) {
    if (!pressed.has(btn)) return;
    pressed.delete(btn);
    mod.release(btn, nowSim());
    document.querySelectorAll(`[data-btn="${btn}"]`).forEach((e) => e.classList.remove('down'));
    frame();
  }
  function bindPointer(el) {
    const btn = el.dataset.btn;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (x) { /* */ } down(btn); });
    const end = () => up(btn);
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function bindDeviceButtons() { device.querySelectorAll('[data-btn]').forEach(bindPointer); }
  function buildButtons(face) {
    const order = face.kind === 'clock' ? ['B', 'C', 'D', 'A', 'L'] : ['B', 'C', 'D', 'A'];
    const bar = $('#btnbar');
    bar.innerHTML = order.map((b) => `<button class="pbtn${b === 'L' ? ' light' : ''}" data-btn="${b}"><kbd>${KEYS[b]}</kbd><b>${BTN[b]}</b><span data-hint="${b}">&nbsp;</span></button>`).join('');
    bar.querySelectorAll('[data-btn]').forEach(bindPointer);
  }
  const keymap = { b: 'B', arrowup: 'B', c: 'C', arrowdown: 'C', ' ': 'C', d: 'D', arrowleft: 'D', a: 'A', arrowright: 'A', l: 'L' };
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (keymap[k]) { e.preventDefault(); if (!e.repeat) down(keymap[k]); }
    else if (k === '1' || k === '2' || k === '3') mount(FACES[+k - 1].id);
  });
  window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (keymap[k]) up(keymap[k]); });
  window.addEventListener('blur', () => [...pressed].forEach(up));

  // tilt: the layers sit at different depths, so turning the device slides the reflections over the dial
  const wrap = $('.device-wrap');
  const still = window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  function tilt(x, y) { // x, y in -1..1
    x = Math.max(-1, Math.min(1, x)); y = Math.max(-1, Math.min(1, y));
    device.style.transform = `rotateY(${(x * 8).toFixed(2)}deg) rotateX(${(-y * 6.5).toFixed(2)}deg)`;
    device.style.setProperty('--tx', x.toFixed(3)); device.style.setProperty('--ty', y.toFixed(3));
  }
  if (!still && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
    $('#stage').addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      tilt((e.clientX - (r.left + r.width / 2)) / r.width * 1.6, (e.clientY - (r.top + r.height / 2)) / r.height * 1.6);
    });
    $('#stage').addEventListener('pointerleave', () => tilt(0, 0));
  } else if (!still && 'DeviceOrientationEvent' in window) {
    // phones that report orientation without a permission prompt: tilt the phone, the crystal answers
    let base = null;
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma === null || e.beta === null) return;
      if (!base) base = { g: e.gamma, b: e.beta };
      base.g += (e.gamma - base.g) * 0.01; base.b += (e.beta - base.b) * 0.01; // slowly re-centre on how it is held
      tilt((e.gamma - base.g) / 22, (e.beta - base.b) / 22);
    });
  }

  // ------------------------------------------------------------------ render loop
  let rafId = 0, toId = 0, lcdTestUntil = 0, lastPanel = 0;
  function frame() {
    cancelAnimationFrame(rafId); clearTimeout(toId);
    const now = nowSim(), rt = performance.now();
    mod.tick(now);
    const segs = rt < lcdTestUntil ? [...segEls.keys()] : mod.segments(now);
    const next = new Set(segs);
    for (const id of lit) if (!next.has(id)) { const el = segEls.get(id); if (el) el.classList.remove('on'); }
    for (const id of next) if (!lit.has(id)) { const el = segEls.get(id); if (el) el.classList.add('on'); }
    lit = next;
    if (rt - lastPanel > 240) { lastPanel = rt; updatePanel(now); }
    $('#ringBanner').classList.toggle('hidden', !mod.ring);
    // cadence
    const animating = sim.speed !== 1 || mod.sw.running || mod.demo || rt < lcdTestUntil;
    const busy = mod.set || mod.ring || pressed.size || mod.mode === 'MOON' || mod.mode === 'SUN';
    if (document.hidden) toId = setTimeout(frame, 1000);
    else if (animating) rafId = requestAnimationFrame(frame);
    else if (busy) toId = setTimeout(frame, 100);
    else toId = setTimeout(frame, 1000 - (now % 1000) + 8);
  }
  document.addEventListener('visibilitychange', frame);

  // ------------------------------------------------------------------ panel
  const PHASES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  function phaseName(el) {
    if (el < 6 || el >= 354) return PHASES[0]; if (el < 84) return PHASES[1]; if (el < 96) return PHASES[2];
    if (el < 174) return PHASES[3]; if (el < 186) return PHASES[4]; if (el < 264) return PHASES[5]; if (el < 276) return PHASES[6]; return PHASES[7];
  }
  function nextPhase(t, target) {
    let x = t + ((A.rev(target - A.elongation(t)) || 360) / 12.19) * DAY;
    for (let i = 0; i < 8; i++) x -= (A.wrap180(A.elongation(x) - target) / 12.19) * DAY;
    return x;
  }
  function moonIconD(k, waxing) {
    const r = 40, tx = Math.abs(1 - 2 * k) * r, gib = k > 0.5, s1 = waxing ? 1 : 0;
    const ts = waxing ? (gib ? 1 : 0) : (gib ? 0 : 1);
    return `M0 ${-r}A${r} ${r} 0 0 ${s1} 0 ${r}A${tx.toFixed(2)} ${r} 0 0 ${ts} 0 ${-r}Z`;
  }
  function fmtT(utcMs) {
    if (utcMs === null || utcMs === undefined) return '—';
    const d = new Date(utcMs + mod.s.tzMin * MIN), h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, '0');
    return mod.s.h24 ? `${h}:${m}` : `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  }
  function fmtDate(utcMs) {
    const d = new Date(utcMs + mod.s.tzMin * MIN);
    return d.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  }
  let lastHints = '';
  function updatePanel(now) {
    const S = mod.s, t = mod.utc(now);
    const h = mod.hints(), st = mod.status();
    const hk = JSON.stringify(h) + st.mode;
    if (hk !== lastHints) {
      lastHints = hk;
      const order = F.build(faceId).kind === 'clock' ? ['B', 'C', 'D', 'A', 'L'] : ['B', 'C', 'D', 'A'];
      $('#hints').innerHTML = order.map((b) => `<b>${BTN[b]}</b><span>${h[b] || (b === 'L' ? 'Backlight' : '—')}</span>`).join('');
      document.querySelectorAll('[data-hint]').forEach((e) => { e.textContent = h[e.dataset.hint] || (e.dataset.hint === 'L' ? 'Backlight' : '—'); });
      $('#modePill').textContent = { TIME: 'TIME', MOON: 'MOON TIME', SUN: 'SUNRISE·SET', ALM: 'ALARM', ST: 'STOPWATCH', 'TIME-SET': 'SET TIME', 'LOC-SET': 'SET PLACE', 'ALM-SET': 'SET ALARM' }[st.mode] || st.mode;
    }
    const il = A.illumination(t), age = A.moonAge(t);
    $('#moonIcon').innerHTML = `<defs><radialGradient id="mi" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff7dc"/><stop offset="1" stop-color="#d7c48f"/></radialGradient></defs><circle r="40" fill="#1a2233"/><path d="${moonIconD(il.k, il.waxing)}" fill="url(#mi)"/><circle r="40" fill="none" stroke="#2c3a55" stroke-width="1.5"/>`;
    $('#phaseName').textContent = phaseName(il.elongation);
    $('#phaseSub').textContent = `${Math.round(il.k * 100)}% lit · age ${age.toFixed(2)} d`;
    const dayStart = Math.floor((t + S.tzMin * MIN) / DAY) * DAY - S.tzMin * MIN;
    const sun = A.sunRiseSet(dayStart, S.lat, S.lon), moon = A.moonRiseSet(dayStart, S.lat, S.lon);
    const transit = A.moonHourAngleTime(dayStart, S.lon, 0);
    const ha = A.moonHourAngle(t, S.lon), alt = A.altitude(A.moonEq(t), t, S.lat, S.lon);
    const haH = Math.floor(ha), haM = Math.floor((ha - haH) * 60);
    const nf = nextPhase(t, 180), nn = nextPhase(t, 0);
    $('#sky').innerHTML = [
      ['Moonrise', fmtT(moon.rise)], ['Moon transit', fmtT(transit)], ['Moonset', fmtT(moon.set)],
      ['Moon altitude', `${alt.toFixed(1)}°`], ['Hour angle', `${haH}h ${String(haM).padStart(2, '0')}m`],
      ['Sunrise', fmtT(sun.rise)], ['Sunset', fmtT(sun.set)],
      ['Next full moon', fmtDate(nf)], ['Next new moon', fmtDate(nn)],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const simulated = sim.speed !== 1 || Math.abs(now - Date.now()) > 3000 || S.userOffset !== 0;
    $('#simBadge').classList.toggle('hidden', !simulated);
    const latS = `${Math.abs(S.lat).toFixed(1)}°${S.lat >= 0 ? 'N' : 'S'}`, lonS = `${Math.abs(S.lon).toFixed(1)}°${S.lon >= 0 ? 'E' : 'W'}`;
    $('#locInfo').textContent = `${latS} ${lonS} · ${gmtStr(S.tzMin)} · watch shows ${fmtDate(t)}`;
    updateCompare(now);
  }
  const gmtStr = (tz) => `GMT${tz < 0 ? '−' : '+'}${Math.floor(Math.abs(tz) / 60)}${Math.abs(tz) % 60 ? ':' + String(Math.abs(tz) % 60).padStart(2, '0') : ''}`;
  const placeStr = (lat, lon) => `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon)}°${lon >= 0 ? 'E' : 'W'}`;
  const fmtDay = (dayLocal) => new Date(dayLocal).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

  // ------------------------------------------------------------------ GMW-15 logic vs modern, for the day on the watch
  /** The date the watch is showing: the one dialled in moon time / sunrise-sunset mode, else today. */
  const dayShown = (now) => ((mod.mode === 'MOON' || mod.mode === 'SUN') && mod.sel ? mod.sel.day : mod.todayLocal(now));
  const CMP_ROWS = [['Moon age', 'age'], ['Sunrise', 'rise'], ['Sunset', 'set'], ['Moon 18h · −1', 0], ['Moon 0h · −2', 1], ['Moon 6h · −3', 2], ['Moon 12h · −4', 3]];
  const pick = (dd, f) => (f === 'age' ? dd.age : f === 'rise' ? dd.sun.rise : f === 'set' ? dd.sun.set : dd.ev[f]);
  const signed = (x, unit, digits = 0) => (Math.abs(x) < 0.5 * 10 ** -digits ? '0' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)} ${unit}`);
  function updateCompare(now) {
    const S = mod.s, day = dayShown(now), on = S.engine;
    const g = mod.dayData(day, 'gmw15'), m = mod.dayData(day, 'modern');
    const cls = (e) => (on === e ? ' on' : '');
    let html = `<span class="h"></span><span class="h v${cls('gmw15')}">GMW-15</span><span class="h v${cls('modern')}">Modern</span><span class="h d">Δ</span>`;
    for (const [label, f] of CMP_ROWS) {
      const a = pick(g, f), b = pick(m, f);
      let va, vb, d = '—', big = false;
      if (f === 'age') {
        va = a.toFixed(2); vb = b.toFixed(2);
        let x = a - b; if (x > G.SYNODIC / 2) x -= G.SYNODIC; else if (x < -G.SYNODIC / 2) x += G.SYNODIC;
        d = signed(x, 'd', 1); big = Math.abs(x) >= 0.5;
      } else {
        va = fmtT(a); vb = fmtT(b);
        // difference of the minutes shown (times are truncated to the minute here)
        if (a !== null && b !== null && Math.abs(a - b) < 12 * HOUR) { const x = Math.floor(a / MIN) - Math.floor(b / MIN); d = signed(x, 'm'); big = Math.abs(x) >= 5; }
      }
      html += `<span class="k">${label}</span><span class="v${cls('gmw15')}">${va}</span><span class="v${cls('modern')}">${vb}</span><span class="d${big ? ' big' : ''}">${d}</span>`;
    }
    $('#cmp').innerHTML = html;
    $('#cmpDay').textContent = fmtDay(day);
    $('#cmpFoot').textContent = `The date on the watch. GMW-15 logic uses ${placeStr(G.wholeDeg(S.lat), G.wholeDeg(S.lon))}, `
      + 'whole degrees as the watch stores them. Exact times here; the watch rounds to 5 minutes.';
    updateStandIn(day);
  }

  // ------------------------------------------------------------------ the real watch outside its 1985–2029 calendar
  // Run it a fixed number of days off the real date. These offsets line the Moon's phase and the season back up best
  // (Greenville, GMW-15 logic vs the real sky); the first one that lands inside the calendar is used:
  // 6,940 d = 19 y (Metonic cycle) to 2048, 9,863 d = 27 y + 1–2 d to 2056, 31,775 d = 87 y from 2072,
  // 16,803 d = 46 y + 2 d in between.
  const WATCH_FIRST = Date.UTC(1985, 0, 1), WATCH_LAST = Date.UTC(2029, 11, 31);
  const STAND_INS = [[6940, '19 years'], [9863, '27 years and a day or two'], [31775, '87 years'], [16803, '46 years and 2 days']];
  /** Date to set on the real watch for local date `day`: null inside its calendar, undefined if nothing fits. */
  function standIn(day) {
    if (day >= WATCH_FIRST && day <= WATCH_LAST) return null;
    const dir = day > WATCH_LAST ? -1 : 1;
    for (const [n, label] of STAND_INS) {
      const d = day + dir * n * DAY;
      if (d >= WATCH_FIRST && d <= WATCH_LAST) return { day: d, n, label, dir, until: WATCH_LAST + n * DAY };
    }
    return undefined;
  }
  const fmtLong = (day) => new Date(day).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  let lastStandIn = '';
  function updateStandIn(day) {
    const si = standIn(day), key = day + '|' + (si ? si.day : si);
    if (key === lastStandIn) return;
    lastStandIn = key;
    let html;
    if (si === null) {
      html = '<div class="si"><span>Your GMW-15</span><b>set this date as is</b></div>'
        + '<div class="foot">This date is inside the real watch\'s 1985–2029 calendar. From 2030 on, this shows the stand-in date and weekday to set instead.</div>';
    } else if (si === undefined) {
      html = '<div class="si"><span>Your GMW-15</span><b>no good stand-in</b></div><div class="foot">No date in its 1985–2029 calendar lines up with this one.</div>';
    } else {
      const n = si.n.toLocaleString('en-US');
      html = `<div class="si"><span>Your GMW-15: set the date to</span><b>${fmtLong(si.day)}</b></div>`
        + `<div class="si"><span>then the weekday to</span><b class="wd">${MOD.DOW[new Date(day).getUTCDay()]}</b></div>`
        + `<div class="foot">Its calendar stops at 2029, so run it ${n} days ${si.dir < 0 ? 'behind' : 'ahead'} (${si.label}): the best `
        + 'match of the moon\'s phase and the season. The weekday sets on its own without changing the date. Keep the real time, '
        + 'then leave the date running, even when it reads a day off around leap years.'
        + (si.dir < 0 ? ` Good until ${fmtLong(si.until)}.` : '') + '</div>';
    }
    $('#standin').innerHTML = html;
  }

  // ------------------------------------------------------------------ panel controls
  $('#faceSeg').innerHTML = FACES.map((f) => `<button data-face="${f.id}">${f.label}<small>${f.sub}</small></button>`).join('');
  $('#faceSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) mount(b.dataset.face); });
  const SPEEDS = [[1, 'Real time'], [60, '1 min/s'], [3600, '1 h/s'], [86400, '1 day/s']];
  $('#speedRow').innerHTML = SPEEDS.map(([v, l]) => `<button class="chip" data-speed="${v}">${l}</button>`).join('');
  const markSpeed = () => document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === sim.speed));
  $('#speedRow').addEventListener('click', (e) => { const b = e.target.closest('[data-speed]'); if (!b) return; rebase(nowSim(), +b.dataset.speed); markSpeed(); frame(); });
  markSpeed();
  document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => {
    const j = +b.dataset.jump;
    if (j === 0) { rebase(Date.now(), 1); markSpeed(); } else rebase(nowSim() + j);
    lastPanel = -1e9; frame();
  }));
  $('#dateJump').addEventListener('change', (e) => {
    const v = e.target.value; if (!v) return;
    const [y, m, d] = v.split('-').map(Number);
    const loc = mod.local(nowSim()), tod = ((loc % DAY) + DAY) % DAY;
    rebase(Date.UTC(y, m - 1, d) + tod - mod.s.tzMin * MIN - mod.s.userOffset);
    lastPanel = -1e9; frame();
  });

  // cities: [name, lat, lon, IANA zone]
  const CITIES = [
    ['New York', 40.71, -74.01, 'America/New_York'], ['Greenville SC', 34.85, -82.39, 'America/New_York'], ['Asheville NC', 35.6, -82.55, 'America/New_York'],
    ['Chicago', 41.88, -87.63, 'America/Chicago'], ['Denver', 39.74, -104.99, 'America/Denver'], ['Los Angeles', 34.05, -118.24, 'America/Los_Angeles'],
    ['Anchorage', 61.22, -149.9, 'America/Anchorage'], ['Honolulu', 21.31, -157.86, 'Pacific/Honolulu'], ['Mexico City', 19.43, -99.13, 'America/Mexico_City'],
    ['Toronto', 43.65, -79.38, 'America/Toronto'], ['Bogotá', 4.71, -74.07, 'America/Bogota'], ['Lima', -12.05, -77.04, 'America/Lima'],
    ['Santiago', -33.45, -70.67, 'America/Santiago'], ['Buenos Aires', -34.6, -58.38, 'America/Argentina/Buenos_Aires'], ['São Paulo', -23.55, -46.63, 'America/Sao_Paulo'],
    ['Reykjavík', 64.15, -21.94, 'Atlantic/Reykjavik'], ['London', 51.51, -0.13, 'Europe/London'], ['Paris', 48.86, 2.35, 'Europe/Paris'],
    ['Madrid', 40.42, -3.7, 'Europe/Madrid'], ['Rome', 41.9, 12.5, 'Europe/Rome'], ['Berlin', 52.52, 13.4, 'Europe/Berlin'], ['Stockholm', 59.33, 18.07, 'Europe/Stockholm'],
    ['Athens', 37.98, 23.73, 'Europe/Athens'], ['Istanbul', 41.01, 28.98, 'Europe/Istanbul'], ['Cairo', 30.04, 31.24, 'Africa/Cairo'], ['Nairobi', -1.29, 36.82, 'Africa/Nairobi'],
    ['Lagos', 6.52, 3.38, 'Africa/Lagos'], ['Cape Town', -33.92, 18.42, 'Africa/Johannesburg'], ['Dubai', 25.2, 55.27, 'Asia/Dubai'], ['Mumbai', 19.08, 72.88, 'Asia/Kolkata'],
    ['Kathmandu', 27.72, 85.32, 'Asia/Kathmandu'], ['Bangkok', 13.76, 100.5, 'Asia/Bangkok'], ['Singapore', 1.35, 103.82, 'Asia/Singapore'], ['Hong Kong', 22.32, 114.17, 'Asia/Hong_Kong'],
    ['Shanghai', 31.23, 121.47, 'Asia/Shanghai'], ['Seoul', 37.57, 126.98, 'Asia/Seoul'], ['Tokyo', 35.68, 139.69, 'Asia/Tokyo'], ['Perth', -31.95, 115.86, 'Australia/Perth'],
    ['Sydney', -33.87, 151.21, 'Australia/Sydney'], ['Auckland', -36.85, 174.76, 'Pacific/Auckland'],
  ];
  function tzOffset(zone, ms) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(ms));
      const g = (t) => +p.find((x) => x.type === t).value;
      return Math.round((Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - ms) / 60000);
    } catch (e) { return -new Date(ms).getTimezoneOffset(); }
  }
  const citySel = $('#city');
  citySel.innerHTML = `<option value="">Choose a city…</option>` + CITIES.map((c, i) => `<option value="${i}">${c[0]}</option>`).join('');
  citySel.value = store.get('city', '');
  citySel.addEventListener('change', () => {
    const c = CITIES[+citySel.value]; if (!c) return;
    Object.assign(mod.s, { lat: c[1], lon: c[2], tzMin: tzOffset(c[3], nowSim()) });
    mod._cur.key = null; mod.save(); store.set('city', citySel.value); frame();
  });
  const embedded = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();
  if (embedded || !navigator.geolocation) $('#geo').classList.add('hidden');
  $('#geo').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    $('#geo').textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition((p) => {
      Object.assign(mod.s, { lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), tzMin: -new Date().getTimezoneOffset() });
      mod._cur.key = null; mod.save(); citySel.value = ''; store.set('city', ''); $('#geo').textContent = 'Use my location'; frame();
    }, () => { $('#geo').textContent = 'Location unavailable'; setTimeout(() => { $('#geo').textContent = 'Use my location'; }, 2500); }, { timeout: 10000, maximumAge: 600000 });
  });

  const opts = { ghost: store.get('ghost', true), shadow: store.get('shadow', true), dome: store.get('dome', true) };
  const bindToggle = (id, get, set) => { const el = $(id); el.checked = get(); el.addEventListener('change', () => { set(el.checked); applyOpts(); frame(); }); };
  bindToggle('#optSound', () => snd.on, (v) => { snd.on = v; store.set('sound', v); if (v) { snd.init(); snd.key(); } });
  bindToggle('#optGhost', () => opts.ghost, (v) => { opts.ghost = v; store.set('ghost', v); });
  bindToggle('#optShadow', () => opts.shadow, (v) => { opts.shadow = v; store.set('shadow', v); });
  bindToggle('#optDome', () => opts.dome, (v) => { opts.dome = v; store.set('dome', v); });
  bindToggle('#optAuth', () => !!mod.s.authentic, (v) => { mod.s.authentic = v; mod.save(); });
  const vol = $('#optVol'); vol.value = snd.vol; vol.addEventListener('input', () => { snd.setVol(+vol.value); store.set('vol', +vol.value); });
  vol.addEventListener('change', () => { snd.init(); snd.key(); });
  $('#sync').addEventListener('click', () => {
    Object.assign(mod.s, { userOffset: 0, dowOffset: 0, tzMin: -new Date().getTimezoneOffset() });
    mod._cur.key = null; mod.save(); rebase(Date.now(), 1); markSpeed(); frame();
  });
  $('#lcdTest').addEventListener('click', () => { lcdTestUntil = performance.now() + 2500; frame(); });
  $('#demo').addEventListener('click', () => { mod.set = null; mod.mode = 'TIME'; mod.sel = null; mod.demo = { start: performance.now() }; frame(); });

  // astronomy engine
  const ENGINE_SUB = { gmw15: 'Casio’s own method', modern: 'accurate' };
  const ENGINE_NOTE = {
    gmw15: 'Casio’s low-precision method from its 1989 patent: whole-degree location, moon age at local noon, the hour angle recalculated on the hour, moon times interpolated over the lunar day.',
    modern: 'Arc-minute Sun and Moon positions; every event time solved to the second.',
  };
  // dial print: modern Selene type, or a classic heavy-sans / gold-serif print with stronger LCD ghosting (Arc watch)
  const syncDialSeg = () => document.querySelectorAll('#dialSeg button').forEach((b) => b.classList.toggle('on', b.dataset.dial === store.get('dialText', 'modern')));
  $('#dialSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    store.set('dialText', b.dataset.dial); syncDialSeg(); mount(faceId); applyOpts(); frame();
  });
  syncDialSeg();
  $('#engineSeg').innerHTML = MOD.ENGINES.map(([id, label]) => `<button data-engine="${id}">${label}<small>${ENGINE_SUB[id]}</small></button>`).join('');
  function markEngine() {
    document.querySelectorAll('#engineSeg button').forEach((b) => b.classList.toggle('on', b.dataset.engine === mod.s.engine));
    $('#engineNote').textContent = ENGINE_NOTE[mod.s.engine] || '';
  }
  $('#engineSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.engine === mod.s.engine) return;
    mod.s.engine = b.dataset.engine; mod._cur.key = null; mod.save(); markEngine(); lastPanel = -1e9; frame();
  });
  markEngine();

  // ------------------------------------------------------------------ watch log: readings from a real watch vs GMW-15 logic
  const LOG_FIELDS = ['age', 'rise', 'set', 0, 1, 2, 3];
  const LOG_NAME = { age: 'Age', rise: 'Sunrise', set: 'Sunset', 0: 'Moon −1', 1: 'Moon −2', 2: 'Moon −3', 3: 'Moon −4' };
  const LOG_CSV = { age: 'moon_age', rise: 'sunrise', set: 'sunset', 0: 'moon_ha18', 1: 'moon_ha0', 2: 'moon_ha6', 3: 'moon_ha12' };
  const inputOf = (f) => $('#lg_' + (typeof f === 'number' ? 'm' + f : f));
  let wlog = store.get('watchlog', []);
  if (!Array.isArray(wlog)) wlog = [];
  const saveLog = () => store.set('watchlog', wlog);
  const dayOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const isoOf = (dayLocal) => new Date(dayLocal).toISOString().slice(0, 10);
  const p2 = (n) => String(n).padStart(2, '0');
  const hm = (min) => (min === 'none' ? '-:--' : `${Math.floor(min / 60)}:${p2(min % 60)}`);
  /** As the watch shows it: 12 h with a/p unless the watch is set to 24 h. */
  const hmw = (min) => { if (min === 'none' || mod.s.h24) return hm(min); const h = Math.floor(min / 60); return `${h % 12 || 12}:${p2(min % 60)}${h < 12 ? 'a' : 'p'}`; };
  const hms = (min) => { if (min === null) return ''; const s = Math.round((((min % 1440) + 1440) % 1440) * 60); return `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`; };
  const wrapMin = (x) => ((x + 720) % 1440 + 1440) % 1440 - 720;
  /** What GMW-15 logic would put on the LCD for a log entry (times as minutes after local midnight, 'none' = -:--),
   *  plus the exact GMW-15 and modern values. */
  function modelFor(e) {
    const day = dayOf(e.date), loc = { lat: e.lat, lon: e.lon, tzMin: e.tzMin };
    const g = mod.dayData(day, 'gmw15', loc), m = mod.dayData(day, 'modern', loc);
    const disp = (t) => (t === null ? 'none' : ((Math.round((A.round5(t) + e.tzMin * MIN - day) / MIN) % 1440) + 1440) % 1440);
    const exact = (t) => (t === null ? null : (t + e.tzMin * MIN - day) / MIN);
    const out = { age: { disp: Math.floor(g.age * 10 + 1e-6) / 10, exact: g.age, modern: m.age } };
    for (const f of LOG_FIELDS.slice(1)) { const a = pick(g, f), b = pick(m, f); out[f] = { disp: disp(a), exact: exact(a), modern: exact(b) }; }
    return out;
  }
  /** Parse "7:10", "7:10a", "5:20 pm", "17:20", "1720"; "-" / "-:--" = no event; blank = not read (null).
   *  Without a/p, a 1–12 hour is put in whichever half of the day is nearer the model's value. */
  function parseTime(str, model) {
    const s = str.trim().toLowerCase();
    if (!s) return null;
    if (/^-+(:-+)?$/.test(s)) return 'none';
    const m = s.match(/^(\d{1,2})[:.]?(\d{2})\s*([ap])?\.?(m\.?)?$/);
    if (!m) return undefined;
    let h = +m[1]; const mi = +m[2];
    if (h > 23 || mi > 59) return undefined;
    if (m[3]) { if (h < 1 || h > 12) return undefined; return (h % 12 + (m[3] === 'p' ? 12 : 0)) * 60 + mi; }
    let v = h * 60 + mi;
    if (h >= 1 && h <= 12 && typeof model === 'number' && Math.abs(wrapMin(v + 720 - model)) < Math.abs(wrapMin(v - model))) v = (v + 720) % 1440;
    return v;
  }
  let msgTimer = 0;
  const say = (t) => { $('#lgMsg').textContent = t; clearTimeout(msgTimer); msgTimer = setTimeout(() => { $('#lgMsg').textContent = ''; }, 3500); };
  function renderLog() {
    $('#logCount').textContent = wlog.length;
    let total = 0, hit = 0;
    const items = wlog.map((e, i) => {
      const md = modelFor(e), miss = [];
      let n = 0, ok = 0;
      for (const f of LOG_FIELDS) {
        const v = e.v[f];
        if (v === null || v === undefined) continue;
        n++;
        const d = md[f].disp;
        if (f === 'age') { if (Math.abs(v - d) < 0.05) ok++; else miss.push(`${LOG_NAME[f]} ${v.toFixed(1)} vs ${d.toFixed(1)}`); continue; }
        if (v === d) { ok++; continue; }
        const delta = v !== 'none' && d !== 'none' ? ` (${signed(wrapMin(v - d), 'm')})` : '';
        miss.push(`${LOG_NAME[f]} ${hmw(v)} vs ${hmw(d)}${delta}`);
      }
      total += n; hit += ok;
      return `<div class="logitem"><div class="t"><b>${e.date}</b><span>${placeStr(e.lat, e.lon)} · ${gmtStr(e.tzMin)}</span>`
        + `<span class="${ok === n ? 'ok' : 'miss'}">${ok}/${n}</span><button data-del="${i}" aria-label="Delete reading">×</button></div>`
        + (miss.length ? `<div class="miss">${miss.join(' · ')}</div>` : '') + '</div>';
    }).reverse();
    $('#lgList').innerHTML = (wlog.length ? `<div class="foot">${hit} of ${total} readings match GMW-15 logic exactly (watch vs model shown for the rest).</div>` : '') + items.join('');
  }
  const logBox = $('#logBox');
  logBox.addEventListener('toggle', () => { if (logBox.open && !$('#lg_date').value) $('#lg_date').value = isoOf(dayShown(nowSim())); });
  $('#lgFill').addEventListener('click', () => {
    const date = $('#lg_date').value || isoOf(dayShown(nowSim()));
    $('#lg_date').value = date;
    const md = modelFor({ date, lat: G.wholeDeg(mod.s.lat), lon: G.wholeDeg(mod.s.lon), tzMin: mod.s.tzMin });
    inputOf('age').value = md.age.disp.toFixed(1);
    for (const f of LOG_FIELDS.slice(1)) inputOf(f).value = md[f].disp === 'none' ? '-' : hmw(md[f].disp);
    say('Filled with what GMW-15 logic shows — change what your watch shows differently.');
  });
  $('#lgAdd').addEventListener('click', () => {
    const date = $('#lg_date').value;
    if (!date) return say('Pick a date first.');
    const e = { date, tzMin: mod.s.tzMin, lat: G.wholeDeg(mod.s.lat), lon: G.wholeDeg(mod.s.lon), v: {}, at: Date.now() };
    const md = modelFor(e);
    let any = false;
    for (const f of LOG_FIELDS) {
      const raw = inputOf(f).value;
      let v;
      if (f === 'age') { v = raw.trim() === '' ? null : Number(raw.trim().replace(',', '.')); if (v !== null && !(v >= 0 && v < 30)) v = undefined; }
      else v = parseTime(raw, md[f].disp);
      if (v === undefined) { inputOf(f).focus(); return say(`Couldn't read ${LOG_NAME[f]}.`); }
      e.v[f] = v;
      if (v !== null) any = true;
    }
    if (!any) return say('Enter at least one reading.');
    wlog.push(e); saveLog(); renderLog();
    for (const f of LOG_FIELDS) inputOf(f).value = '';
    say('Saved.');
  });
  $('#lgList').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-del]'); if (!b) return;
    wlog.splice(+b.dataset.del, 1); saveLog(); renderLog();
  });
  let clearArmed = 0;
  $('#lgClear').addEventListener('click', () => {
    if (!wlog.length) return;
    if (performance.now() - clearArmed > 3000) { clearArmed = performance.now(); return say('Tap “Clear log” again to delete every reading.'); }
    wlog = []; saveLog(); renderLog(); clearArmed = 0; say('Log cleared.');
  });
  $('#lgCsv').addEventListener('click', () => {
    if (!wlog.length) return say('Nothing logged yet.');
    const rows = [['date', 'gmt_offset_min', 'lat', 'lon', 'field', 'watch', 'gmw15_display', 'gmw15_exact', 'modern_exact', 'match']];
    for (const e of wlog) {
      const md = modelFor(e);
      for (const f of LOG_FIELDS) {
        const v = e.v[f], r = md[f];
        if (v === null || v === undefined) continue;
        if (f === 'age') rows.push([e.date, e.tzMin, e.lat, e.lon, LOG_CSV[f], v.toFixed(1), r.disp.toFixed(1), r.exact.toFixed(3), r.modern.toFixed(3), Math.abs(v - r.disp) < 0.05 ? 1 : 0]);
        else rows.push([e.date, e.tzMin, e.lat, e.lon, LOG_CSV[f], hm(v), hm(r.disp), hms(r.exact), hms(r.modern), v === r.disp ? 1 : 0]);
      }
    }
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(',')).join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'selene-watch-log.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  renderLog();

  // logo
  $('#logo').innerHTML = `<svg viewBox="0 0 272 40">${F.text('brand', 'SELENE', 0, 34, 30, { track: 0.18, attrs: 'fill="#e8edf5"' })}</svg>`;

  // first-run: if no saved settings, default to the device's time zone & a sensible city
  if (!store.get('settings', null)) {
    const zone = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    const idx = CITIES.findIndex((c) => c[3] === zone);
    if (idx >= 0) { Object.assign(mod.s, { lat: CITIES[idx][1], lon: CITIES[idx][2] }); citySel.value = String(idx); }
    mod.save();
  }
  mount(faceId);
})();

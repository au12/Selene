/* Selene web simulator — UI shell. Uses SeleneAstro, SeleneFaces, SeleneModule, SeleneGlyphs. */
(function () {
  'use strict';
  const A = window.SeleneAstro, F = window.SeleneFaces, MOD = window.SeleneModule;
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

  function filters(pal) {
    return `<filter id="lcdShadow" x="-5%" y="-5%" width="110%" height="115%"><feDropShadow dx="2.2" dy="2.8" stdDeviation="1.3" flood-color="${pal.shadow}" flood-opacity="1"/></filter>
<filter id="mgGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="b"/><feColorMatrix in="b" type="matrix" values="1 0 0 0 0  0 .9 0 0 0  0 0 .6 0 0  0 0 0 .55 0" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>`;
  }
  function pusher(btn, ang, cx, cy, r0) {
    return `<g data-btn="${btn}" transform="rotate(${ang} ${cx} ${cy})" style="--px:-7px;--py:0px" role="button" aria-label="${BTN[btn]}">
<rect x="${cx + r0 - 14}" y="${cy - 26}" width="26" height="52" rx="6" fill="#0c0e12"/>
<g class="cap"><rect x="${cx + r0 + 4}" y="${cy - 20}" width="44" height="40" rx="9" fill="url(#steelV)"/>
<rect x="${cx + r0 + 38}" y="${cy - 20}" width="10" height="40" rx="5" fill="#fff" opacity=".18"/>
<path d="M${cx + r0 + 14} ${cy - 20}v40M${cx + r0 + 22} ${cy - 20}v40M${cx + r0 + 30} ${cy - 20}v40" stroke="#000" stroke-opacity=".18" stroke-width="2"/></g>
<rect x="${cx + r0 - 20}" y="${cy - 40}" width="${84}" height="80" fill="transparent"/></g>`;
  }
  function watchSVG(face) {
    const cx = 500, cy = 780, Rd = 352, s = Rd / 500;
    let strapLines = '';
    for (let y = 30; y < 330; y += 34) strapLines += `M352 ${y}H648`;
    let strapLines2 = '';
    for (let y = 1236; y < 1560; y += 34) strapLines2 += `M352 ${y}H648`;
    let bezelDots = '';
    for (let i = 0; i < 12; i++) { const a = (i * 30 - 90) * Math.PI / 180; bezelDots += `<circle cx="${(cx + 381 * Math.cos(a)).toFixed(1)}" cy="${(cy + 381 * Math.sin(a)).toFixed(1)}" r="${i % 3 ? 3.2 : 5}" fill="#3b424d"/>`; }
    return `<svg viewBox="0 175 1000 1210" xmlns="http://www.w3.org/2000/svg" aria-label="Selene Arc watch">
<defs>${filters(face.palette)}
<linearGradient id="strap" x1="0" x2="1"><stop offset="0" stop-color="#0f1116"/><stop offset=".18" stop-color="#20242c"/><stop offset=".5" stop-color="#191c22"/><stop offset=".82" stop-color="#22262e"/><stop offset="1" stop-color="#0d0f13"/></linearGradient>
<radialGradient id="caseG" cx="45%" cy="38%" r="70%"><stop offset="0" stop-color="#3a404a"/><stop offset=".6" stop-color="#1d2128"/><stop offset="1" stop-color="#0d0f13"/></radialGradient>
<linearGradient id="bezel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3f5f8"/><stop offset=".22" stop-color="#9aa2ae"/><stop offset=".45" stop-color="#e6e9ee"/><stop offset=".7" stop-color="#7b8390"/><stop offset="1" stop-color="#cfd4db"/></linearGradient>
<linearGradient id="steelV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6f7f9"/><stop offset=".5" stop-color="#a7afba"/><stop offset="1" stop-color="#5f6672"/></linearGradient>
<radialGradient id="crys" cx="30%" cy="22%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".35" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="${cx}" cy="${cy + 40}" rx="440" ry="470" fill="#000" opacity=".55" filter="url(#soft)"/>
<path d="M346 -10H654L664 340H336Z" fill="url(#strap)"/><path d="${strapLines}" stroke="#000" stroke-opacity=".35" stroke-width="3"/><path d="${strapLines}" stroke="#fff" stroke-opacity=".05" stroke-width="1.5" transform="translate(0 3)"/>
<path d="M336 1220H664L654 1570H346Z" fill="url(#strap)"/><path d="${strapLines2}" stroke="#000" stroke-opacity=".35" stroke-width="3"/><path d="${strapLines2}" stroke="#fff" stroke-opacity=".05" stroke-width="1.5" transform="translate(0 3)"/>
<path d="M318 520C318 400 330 330 360 318H640C670 330 682 400 682 520Z" fill="url(#caseG)"/>
<path d="M318 1040C318 1160 330 1230 360 1242H640C670 1230 682 1160 682 1040Z" fill="url(#caseG)"/>
${pusher('B', 212, cx, cy, 420)}${pusher('C', 148, cx, cy, 420)}${pusher('D', -32, cx, cy, 420)}${pusher('A', 32, cx, cy, 420)}
<circle cx="${cx}" cy="${cy}" r="436" fill="url(#caseG)"/>
<circle cx="${cx}" cy="${cy}" r="434" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/>
<circle cx="${cx}" cy="${cy}" r="402" fill="url(#bezel)"/>
<circle cx="${cx}" cy="${cy}" r="402" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
${bezelDots}
<circle cx="${cx}" cy="${cy}" r="364" fill="#07090d"/>
<g transform="translate(${cx - Rd} ${cy - Rd}) scale(${s})" class="face">${face.svg}</g>
<circle cx="${cx}" cy="${cy}" r="${Rd + 3}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="10"/>
<circle cx="${cx}" cy="${cy}" r="${Rd + 6}" fill="url(#crys)" pointer-events="none"/>
<path d="M${cx - 300} ${cy - 170}A${Rd - 8} ${Rd - 8} 0 0 1 ${cx + 120} ${cy - 330}" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="16" stroke-linecap="round" pointer-events="none"/>
</svg>`;
  }
  function clockSVG(face) {
    const cx = 500, cy = 560, Rd = 404, s = Rd / 500, noir = face.id === 'noir';
    const ring0 = noir ? ['#2b2f36', '#0b0c0f', '#3a3f48', '#08090b'] : ['#f1e3c0', '#a7864f', '#f6ead0', '#8b6b3a'];
    const ped = noir ? ['#1b1d22', '#0a0b0d'] : ['#7a4e2f', '#3e2616'];
    return `<svg viewBox="0 0 1000 1240" xmlns="http://www.w3.org/2000/svg" aria-label="Selene ${face.name} clock">
<defs>${filters(face.palette)}
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ring0[0]}"/><stop offset=".35" stop-color="${ring0[1]}"/><stop offset=".6" stop-color="${ring0[2]}"/><stop offset="1" stop-color="${ring0[3]}"/></linearGradient>
<linearGradient id="ped" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ped[1]}"/><stop offset=".45" stop-color="${ped[0]}"/><stop offset="1" stop-color="${ped[1]}"/></linearGradient>
<linearGradient id="btnTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${noir ? '#3a3f48' : '#f4e9d2'}"/><stop offset="1" stop-color="${noir ? '#121418' : '#9a7a46'}"/></linearGradient>
<radialGradient id="crys" cx="30%" cy="22%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity="${noir ? .1 : .24}"/><stop offset=".4" stop-color="#fff" stop-opacity=".03"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
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
<circle cx="${cx}" cy="${cy}" r="424" fill="url(#ring)" opacity=".55"/>
<circle cx="${cx}" cy="${cy}" r="${Rd + 8}" fill="#050607"/>
<g transform="translate(${cx - Rd} ${cy - Rd}) scale(${s})" class="face">${face.svg}</g>
<circle cx="${cx}" cy="${cy}" r="${Rd + 2}" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="8"/>
<circle cx="${cx}" cy="${cy}" r="${Rd + 6}" fill="url(#crys)" pointer-events="none"/>
<path d="M${cx - 330} ${cy - 210}A${Rd - 10} ${Rd - 10} 0 0 1 ${cx + 150} ${cy - 380}" fill="none" stroke="#fff" stroke-opacity="${noir ? .05 : .12}" stroke-width="18" stroke-linecap="round" pointer-events="none"/>
</svg>`;
  }

  // ------------------------------------------------------------------ mount
  let faceId = store.get('face', 'arc');
  let segEls = new Map(), lit = new Set(), deviceSvg = null;
  const device = $('#device');
  function mount(id) {
    if (!F.ids.includes(id)) id = 'arc';
    faceId = id; store.set('face', id);
    const face = F.build(id), pal = face.palette;
    device.className = 'device ' + face.kind;
    device.innerHTML = face.kind === 'watch' ? watchSVG(face) : clockSVG(face);
    deviceSvg = device.firstElementChild;
    const st = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    st.textContent = `.s{fill:var(--g)} .lcd{--g:${pal.lcdGhost}} .mg{--g:${pal.mgGhost}} .lcd.on{fill:${pal.lcdOn}} .mg.on{fill:${pal.mgOn}}`;
    deviceSvg.prepend(st);
    if (pal.negative) deviceSvg.classList.add('neg');
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
    deviceSvg.classList.toggle('no-ghost', !opts.ghost);
    deviceSvg.classList.toggle('seg-shadow', opts.shadow);
    deviceSvg.querySelectorAll('.mgl').forEach((g) => { g.style.filter = opts.shadow ? '' : 'none'; });
  }
  let lightTimer = 0;
  function lightOn() {
    if (!deviceSvg || F.build(faceId).kind !== 'clock') return;
    deviceSvg.classList.add('lit'); clearTimeout(lightTimer);
    lightTimer = setTimeout(() => deviceSvg && deviceSvg.classList.remove('lit'), 3000);
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
  function bindDeviceButtons() { deviceSvg.querySelectorAll('[data-btn]').forEach(bindPointer); }
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

  // subtle tilt on desktop
  const wrap = $('.device-wrap');
  if (window.matchMedia('(hover:hover) and (pointer:fine)').matches && !window.matchMedia('(prefers-reduced-motion:reduce)').matches) {
    $('#stage').addEventListener('pointermove', (e) => {
      const r = wrap.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) / r.width, y = (e.clientY - (r.top + r.height / 2)) / r.height;
      device.style.transform = `rotateY(${(x * 5).toFixed(2)}deg) rotateX(${(-y * 4).toFixed(2)}deg)`;
    });
    $('#stage').addEventListener('pointerleave', () => { device.style.transform = ''; });
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
    const tz = S.tzMin, tzS = `GMT${tz < 0 ? '−' : '+'}${Math.floor(Math.abs(tz) / 60)}${Math.abs(tz) % 60 ? ':' + String(Math.abs(tz) % 60).padStart(2, '0') : ''}`;
    $('#locInfo').textContent = `${latS} ${lonS} · ${tzS} · watch shows ${fmtDate(t)}`;
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
    frame();
  }));
  $('#dateJump').addEventListener('change', (e) => {
    const v = e.target.value; if (!v) return;
    const [y, m, d] = v.split('-').map(Number);
    const loc = mod.local(nowSim()), tod = ((loc % DAY) + DAY) % DAY;
    rebase(Date.UTC(y, m - 1, d) + tod - mod.s.tzMin * MIN - mod.s.userOffset);
    frame();
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

  const opts = { ghost: store.get('ghost', true), shadow: store.get('shadow', true) };
  const bindToggle = (id, get, set) => { const el = $(id); el.checked = get(); el.addEventListener('change', () => { set(el.checked); applyOpts(); frame(); }); };
  bindToggle('#optSound', () => snd.on, (v) => { snd.on = v; store.set('sound', v); if (v) { snd.init(); snd.key(); } });
  bindToggle('#optGhost', () => opts.ghost, (v) => { opts.ghost = v; store.set('ghost', v); });
  bindToggle('#optShadow', () => opts.shadow, (v) => { opts.shadow = v; store.set('shadow', v); });
  bindToggle('#optAuth', () => !!mod.s.authentic, (v) => { mod.s.authentic = v; mod.save(); });
  const vol = $('#optVol'); vol.value = snd.vol; vol.addEventListener('input', () => { snd.setVol(+vol.value); store.set('vol', +vol.value); });
  vol.addEventListener('change', () => { snd.init(); snd.key(); });
  $('#sync').addEventListener('click', () => {
    Object.assign(mod.s, { userOffset: 0, dowOffset: 0, tzMin: -new Date().getTimezoneOffset() });
    mod._cur.key = null; mod.save(); rebase(Date.now(), 1); markSpeed(); frame();
  });
  $('#lcdTest').addEventListener('click', () => { lcdTestUntil = performance.now() + 2500; frame(); });
  $('#demo').addEventListener('click', () => { mod.set = null; mod.mode = 'TIME'; mod.sel = null; mod.demo = { start: performance.now() }; frame(); });

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

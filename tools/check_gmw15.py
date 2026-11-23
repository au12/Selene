"""Check shared/gmw15.js ("GMW-15 logic") against an independent Python transcription of Casio's patent
(EP 0 400 542 B1 / US 5,208,790) and report how far that 1989 method is from the real sky (PyEphem).

Usage: node tools/gmw15_cases.mjs | python3 tools/check_gmw15.py
"""
import sys, json, math, datetime as dt
import ephem

DAY, HOUR, MIN = 86400000, 3600000, 60000
EPOCH = dt.datetime(1970, 1, 1)


# ---------------------------------------------------------------- the patent, transcribed again
def INT(x): return math.floor(x)
def FRAC(x): return x - math.floor(x)
def cosd(x): return math.cos(math.radians(x % 360))
def sind(x): return math.sin(math.radians(x % 360))


def Z(YE, MN, DA, HO=0.0):
    """Day count: W=(YE-1900)/4, F=FRAC(W), A=INT(1461W), B=INT((MN+7)/10), C=INT(1-F), D=INT(0.44(MN+4.4))."""
    W = (YE - 1900) / 4
    F, A = FRAC(W), INT(1461 * W)
    B, C, D = INT((MN + 7) / 10), INT(1 - F), INT(0.44 * (MN + 4.4))
    return A + 31 * MN + DA + (B - 1) * C - B * D + HO / 24


def ymd(ms):
    d = EPOCH + dt.timedelta(milliseconds=ms)
    return d.year, d.month, d.day


def T(z): return (z - 36556.5) / 36525
def K(z0): return 24 * FRAC(0.671262 + 0.0027379 * (z0 - 25012))   # epoch term restored


def alpha(t):
    a = (32084.52539 * t + 14.55441 + 0.41925 * cosd(477198.868 * t + 44.963)
         + 0.16358 * cosd(962535.762 * t + 166.633) + 0.08494 * cosd(413335.350 * t + 10.740)
         + 0.07104 * cosd(1934.140 * t + 324.960) + 0.07048 * cosd(964469.900 * t + 41.590)
         + 0.04389 * cosd(890534.220 * t + 145.700))
    return a % 24


def JK(z0): return (K(z0) - alpha(T(z0))) % 24


def LNR(z0):
    djk = JK(z0 + 1) - JK(z0)
    return 576 / djk if djk > 0 else 576 / (djk + 24)


def ha_event(day_local, tz, lon, h):
    """Solve JK + lon/15 + u*24/LNR = h (mod 24) for u, keep the solution inside the local day."""
    z0 = Z(*ymd(day_local))
    j, L = JK(z0), LNR(z0)
    for n in range(-3, 4):
        u = (h - j - lon / 15 + 24 * n) * L / 24
        x = u + tz / 60
        if 0 <= x < 24:
            return day_local - tz * MIN + x * HOUR
    return None


def hour_angle(ms, lon):
    day_ut = math.floor(ms / DAY) * DAY
    z0 = Z(*ymd(day_ut))
    return (JK(z0) + lon / 15 + (ms - day_ut) / HOUR * 24 / LNR(z0)) % 24


def moon_age(day_local, tz):
    t = T(Z(*ymd(day_local)) + 1)
    lm = 481267.9 * t + 218.3 + 6.3 * cosd(45 + 477200 * t) + 1.3 * cosd(11 + 413300 * t)
    ls = 36000.8 * t + 280.5 + 1.9 * cosd(268 + 36000 * t)
    return (29.53 * ((lm - ls) % 360) / 360 - tz / 1440 - 0.5) % 29.53


def sun(day_local, tz, lat, lon):
    y, m, d = ymd(day_local)
    t3 = Z(y, m, d) - Z(y, 1, 0)
    A, B = (t3 - 80.5) * 360 / 365.25, (t3 - 4.5) * 360 / 365.25
    eot = -460.64 * sind(B) - 4.82 * sind(2 * B) + 592.32 * sind(2 * A) - 12.76 * sind(4 * A)
    median = 12 - lon / 15 + tz / 60 - eot / 3600
    t = T(Z(y, m, d, median - tz / 60))
    dec = (23.26 * cosd(36001 * t + 190) + 0.39 * cosd(2 * t + 13) + 0.39 * cosd(72000 * t + 188)
           + 0.16 * cosd(108002 * t + 211) + 0.01 * cosd(72003 * t + 34) + 0.01 * cosd(144001 * t + 209))
    x = -0.017 / (math.cos(math.radians(lat)) * math.cos(math.radians(dec))) - math.tan(math.radians(lat)) * math.tan(math.radians(dec))
    if not -1 <= x <= 1:
        return None, None
    sstn = math.degrees(math.acos(x)) / 15
    base = day_local - tz * MIN
    return base + (median - sstn) * HOUR, base + (median + sstn) * HOUR


# ---------------------------------------------------------------- checks
cases = json.load(sys.stdin)
fail = []

# the day count is a plain day number for 1901-2099
for days in range(-25202, 47482):           # 1901-01-01 .. 2099-12-31
    if Z(*ymd(days * DAY)) != days + 25599:
        fail.append('day count')
        break


def close(a, b, tol):
    return (a is None and b is None) or (a is not None and b is not None and abs(a - b) <= tol)


worst = {}
def track(k, v): worst.setdefault(k, []).append(v)


def ed(ms): return ephem.Date(EPOCH + dt.timedelta(milliseconds=ms))
def ms_of(d): return (ephem.Date(d).datetime() - EPOCH).total_seconds() * 1000
def wrap12(h): return (h + 12) % 24 - 12


bad = 0
for c in cases:
    tz, lat, lon, day = c['tz'], c['lat'], c['lon'], c['dayLocal']
    rise, sset = sun(day, tz, lat, lon)
    ev = [ha_event(day, tz, lon, h) for h in (18, 0, 6, 12)]
    agep = moon_age(day, tz)
    ok = (abs(agep - c['age']) < 1e-6 or abs(abs(agep - c['age']) - 29.53) < 1e-6) and close(rise, c['rise'], 2) \
        and close(sset, c['set'], 2) and all(close(a, b, 2) for a, b in zip(ev, c['ev'])) \
        and abs(wrap12(hour_angle(c['haMs'], lon) - c['ha'])) < 1e-6
    if not ok:
        bad += 1
        if bad <= 3:
            print('JS vs Python mismatch:', c['name'], c['dayLocal'], c['age'], agep, c['rise'], rise, c['ev'], ev)

    # accuracy against the sky (PyEphem): sunrise/sunset (USNO definition), hour-angle times, age at local noon
    start = day - tz * MIN
    o = ephem.Observer(); o.lat, o.lon = str(lat), str(lon); o.pressure = 0; o.elevation = 0; o.horizon = '-0:50'
    band = 'sun |lat|<=52 min' if abs(lat) <= 52 else 'sun |lat|>52 min'
    for key, fn, mine in (('rise', o.next_rising, c['rise']), ('set', o.next_setting, c['set'])):
        if mine is None:
            continue
        try:   # nearest true event (a high-latitude summer sunset can fall just past local midnight)
            t = ms_of(fn(ephem.Sun(), start=ed(mine - 12 * HOUR), use_center=True))
            track(band, (mine - t) / MIN)
        except (ephem.CircumpolarError, ephem.NeverUpError, ephem.AlwaysUpError):
            pass
    for h, t in zip((18, 0, 6, 12), c['ev']):
        if t is None:
            continue
        m = ephem.Moon(); m.compute(ed(t), epoch=ed(t))
        g = ephem.Observer(); g.lon = str(lon); g.lat = '0'; g.date = ed(t)
        true_ha = math.degrees(g.sidereal_time() - m.g_ra) / 15
        track('moon hour-angle times min', wrap12(true_ha - h) * 60 * 24.84 / 24)
    noon = start + 12 * HOUR
    true_age = (noon - ms_of(ephem.previous_new_moon(ed(noon)))) / DAY
    track('moon age days', (c['age'] - true_age + 14.765) % 29.53 - 14.765)

print('GMW-15 logic, JS vs independent Python transcription: %d days, mismatches %d' % (len(cases), bad))
if bad:
    fail.append('JS vs Python')
print('GMW-15 logic vs PyEphem, 1986-2029 (whole-degree locations):')
LIMITS = {'sun |lat|<=52 min': 3.0, 'sun |lat|>52 min': 6.0, 'moon hour-angle times min': 8.0, 'moon age days': 1.3}
for k in sorted(worst):
    v = sorted(abs(x) for x in worst[k])
    p95, mx = v[int(0.95 * len(v)) - 1], v[-1]
    print('  %-26s n=%5d  mean %+6.2f  p95 |err| %5.2f  worst %5.2f' % (k, len(v), sum(worst[k]) / len(v), p95, mx))
    if mx > LIMITS[k]:
        fail.append(k)
if fail:
    print('FAILED:', ', '.join(fail))
    sys.exit(1)

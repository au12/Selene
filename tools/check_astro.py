"""Cross-check shared/astro.js against PyEphem. Usage: node tools/astro_cases.mjs | python tools/check_astro.py"""
import sys, json, math, datetime as dt
import ephem
cases = json.load(sys.stdin)
def ed(ms): return ephem.Date(dt.datetime.utcfromtimestamp(ms/1000))
def ms_of(d): return (ephem.Date(d).datetime() - dt.datetime(1970,1,1)).total_seconds()*1000
def wrapdeg(x): return (x + 180) % 360 - 180
worst = {}
def track(k, v):
    worst[k] = max(worst.get(k, 0), abs(v))
for c in cases:
    m = ephem.Moon(); m.compute(ed(c['ms']), epoch=ed(c['ms']))
    track('moon RA arcmin', wrapdeg(math.degrees(m.g_ra) - c['moonRa'])*60*math.cos(m.g_dec))
    track('moon Dec arcmin', (math.degrees(m.g_dec) - c['moonDec'])*60)
    s = ephem.Sun(); s.compute(ed(c['ms']), epoch=ed(c['ms']))
    track('sun RA arcmin', wrapdeg(math.degrees(s.g_ra) - c['sun']['ra'])*60)
    nm = ms_of(ephem.previous_new_moon(ed(c['ms'])))
    track('new moon minutes', (nm - c['newMoon'])/60000)
    o = ephem.Observer(); o.lat = str(c['lat']); o.lon = str(c['lon']); o.pressure = 0; o.elevation = 0
    o.date = ed(c['dayStart']); o.horizon = '-0:50'
    end = c['dayStart'] + 86400000
    for key, fn in (('rise', o.next_rising), ('set', o.next_setting)):
        try:
            t = ms_of(fn(ephem.Sun(), start=ed(c['dayStart']), use_center=True))
            mine = c['rs'][key]
            if t < end and mine is not None: track('sun %s minutes' % key, (t - mine)/60000)
            elif (t < end) != (mine is not None): track('sun %s MISMATCH' % key, 1)
        except ephem.CircumpolarError:
            pass
    # moon rise/set: pyephem default (upper limb, refraction with pressure 0 -> use horizon -0:34)
    o2 = ephem.Observer(); o2.lat = str(c['lat']); o2.lon = str(c['lon']); o2.pressure = 0; o2.horizon = '-0:34'
    for key, fn in (('rise', o2.next_rising), ('set', o2.next_setting)):
        try:
            t = ms_of(fn(ephem.Moon(), start=ed(c['dayStart'])))
            mine = c['mrs'][key]
            if t < end and mine is not None: track('moon %s minutes' % key, (t - mine)/60000)
            elif (t < end) != (mine is not None) and abs(t - end) > 600000: track('moon %s MISMATCH' % key, 1)
        except ephem.CircumpolarError:
            pass
    # geocentric moon hour angle times
    for i, h in enumerate([0, 6, 12, 18]):
        mine = c['ha'][i]
        if mine is None: continue
        def f(ms):
            mm = ephem.Moon(); mm.compute(ed(ms), epoch=ed(ms))
            oo = ephem.Observer(); oo.lon = str(c['lon']); oo.lat='0'; oo.date = ed(ms)
            return wrapdeg(math.degrees(oo.sidereal_time()) - math.degrees(mm.g_ra) - h*15)
        lo, hi = mine - 1800000, mine + 1800000
        if (f(lo) < 0) == (f(hi) < 0): track('HA no bracket', 1); continue
        for _ in range(40):
            mid = (lo+hi)/2
            if (f(mid) < 0) == (f(lo) < 0): lo = mid
            else: hi = mid
        track('moon HA%d minutes' % h, ((lo+hi)/2 - mine)/60000)
for k, v in sorted(worst.items()): print('%-22s worst |err| = %.2f' % (k, v))

// Selene astronomy engine — C++ port of shared/astro.js. See astro.h.
#include "astro.h"
#include <cmath>

namespace esphome {
namespace selene {
namespace astro {

namespace {
constexpr double SYNODIC = 29.530588853;
constexpr double DT_DAYS = 69.2 / 86400.0;
constexpr float RADF = 0.017453292519943295f;
constexpr float DEGF = 57.29577951308232f;

// trig on degree arguments: reduce in double, evaluate in float
inline float sind(double x) { return sinf((float) rev(x) * RADF); }
inline float cosd(double x) { return cosf((float) rev(x) * RADF); }
inline double atan2d(double y, double x) { return (double) (atan2f((float) y, (float) x) * DEGF); }

double day_number(double ms) { return ms / DAY_MS + 2440587.5 - 2451543.5 + DT_DAYS; }

struct Sun {
  double lon, r, M, w;
};
Sun sun_ecl(double d) {
  Sun s;
  s.w = 282.9404 + 4.70935e-5 * d;
  const double e = 0.016709 - 1.151e-9 * d;
  s.M = rev(356.0470 + 0.9856002585 * d);
  const double E = s.M + (double) DEGF * e * sind(s.M) * (1 + e * cosd(s.M));
  const double xv = cosd(E) - e, yv = std::sqrt(1 - e * e) * sind(E);
  s.lon = rev(atan2d(yv, xv) + s.w);
  s.r = std::sqrt(xv * xv + yv * yv);
  return s;
}

struct Moon {
  double lon, lat, r;
};
Moon moon_ecl(double d, const Sun &sun) {
  const double N = rev(125.1228 - 0.0529538083 * d);
  const double i = 5.1454;
  const double w = rev(318.0634 + 0.1643573223 * d);
  const double a = 60.2666, e = 0.054900;
  const double M = rev(115.3654 + 13.0649929509 * d);
  double E = M + (double) DEGF * e * sind(M) * (1 + e * cosd(M));
  for (int k = 0; k < 6; k++) {
    const double dE = (E - (double) DEGF * e * sind(E) - M) / (1 - e * cosd(E));
    E -= dE;
    if (std::fabs(dE) < 1e-6)
      break;
  }
  const double xv = a * (cosd(E) - e), yv = a * std::sqrt(1 - e * e) * sind(E);
  const double v = atan2d(yv, xv);
  double r = std::sqrt(xv * xv + yv * yv);
  const double vw = v + w;
  const double xh = r * (cosd(N) * cosd(vw) - sind(N) * sind(vw) * cosd(i));
  const double yh = r * (sind(N) * cosd(vw) + cosd(N) * sind(vw) * cosd(i));
  const double zh = r * sind(vw) * sind(i);
  double lon = atan2d(yh, xh);
  double lat = atan2d(zh, std::sqrt(xh * xh + yh * yh));
  const double Ms = sun.M, Ls = sun.M + sun.w, Lm = M + w + N, D = Lm - Ls, F = Lm - N;
  lon += -1.274 * sind(M - 2 * D) + 0.658 * sind(2 * D) - 0.186 * sind(Ms) - 0.059 * sind(2 * M - 2 * D) -
         0.057 * sind(M - 2 * D + Ms) + 0.053 * sind(M + 2 * D) + 0.046 * sind(2 * D - Ms) + 0.041 * sind(M - Ms) -
         0.035 * sind(D) - 0.031 * sind(M + Ms) - 0.015 * sind(2 * F - 2 * D) + 0.011 * sind(M - 4 * D);
  lat += -0.173 * sind(F - 2 * D) - 0.055 * sind(M - F - 2 * D) - 0.046 * sind(M + F - 2 * D) + 0.033 * sind(F + 2 * D) +
         0.017 * sind(2 * M + F);
  r += -0.58 * cosd(M - 2 * D) - 0.46 * cosd(2 * D);
  return {rev(lon), lat, r};
}

Eq ecl_to_eq(double lon, double lat, double d) {
  const double ecl = 23.4393 - 3.563e-7 * d;
  const double x = cosd(lon) * cosd(lat), y = sind(lon) * cosd(lat), z = sind(lat);
  const double ye = y * cosd(ecl) - z * sind(ecl);
  const double ze = y * sind(ecl) + z * cosd(ecl);
  return {rev(atan2d(ye, x)), atan2d(ze, std::sqrt(x * x + ye * ye)), 0};
}

struct Root {
  double t;
  bool up;
};
// Scan [t0,t1] for sign changes; returns count written to out (max n)
template<typename Fn> int roots(Fn f, double t0, double t1, double step, double tol, double guard, Root *out, int n) {
  int cnt = 0;
  double a = t0, fa = f(a);
  while (a < t1 && cnt < n) {
    const double b = std::fmin(a + step, t1), fb = f(b);
    if (((fa < 0) != (fb < 0)) && (guard <= 0 || (std::fabs(fa) < guard && std::fabs(fb) < guard))) {
      double lo = a, hi = b, flo = fa;
      while (hi - lo > tol) {
        const double mid = (lo + hi) / 2, fm = f(mid);
        if ((fm < 0) == (flo < 0)) {
          lo = mid;
          flo = fm;
        } else {
          hi = mid;
        }
      }
      out[cnt++] = {(lo + hi) / 2, fa < 0};
    }
    a = b;
    fa = fb;
  }
  return cnt;
}
}  // namespace

double rev(double x) { return x - std::floor(x / 360.0) * 360.0; }
double wrap180(double x) {
  x = rev(x);
  return x >= 180 ? x - 360 : x;
}

double gmst(double ms) {
  const double jd = ms / DAY_MS + 2440587.5, t = (jd - 2451545.0) / 36525.0;
  return rev(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * t * t - t * t * t / 38710000.0);
}

Eq sun_eq(double ms) {
  const double d = day_number(ms);
  const Sun s = sun_ecl(d);
  return ecl_to_eq(s.lon, 0, d);
}

Eq moon_eq(double ms) {
  const double d = day_number(ms);
  const Sun s = sun_ecl(d);
  const Moon m = moon_ecl(d, s);
  Eq q = ecl_to_eq(m.lon, m.lat, d);
  q.r = m.r;
  return q;
}

double altitude(const Eq &eq, double ms, double lat, double lon) {
  const double H = gmst(ms) + lon - eq.ra;
  return (double) (asinf(sind(lat) * sind(eq.dec) + cosd(lat) * cosd(eq.dec) * cosd(H)) * DEGF);
}

double moon_hour_angle(double ms, double lon) { return rev(gmst(ms) + lon - moon_eq(ms).ra) / 15.0; }

double elongation(double ms) {
  const double d = day_number(ms);
  const Sun s = sun_ecl(d);
  const Moon m = moon_ecl(d, s);
  return rev(m.lon - s.lon);
}

double last_new_moon(double ms) {
  for (int attempt = 0; attempt < 3; attempt++) {
    double t = ms - (elongation(ms) / 360.0) * SYNODIC * DAY_MS;
    for (int k = 0; k < 10; k++) {
      const double e = wrap180(elongation(t));
      t -= (e / 12.190749) * DAY_MS;
      if (std::fabs(e) < 1e-5)
        break;
    }
    if (t <= ms + 1000)
      return t;
    ms -= 2 * DAY_MS;
  }
  return ms;
}

double moon_age(double ms) { return (ms - last_new_moon(ms)) / DAY_MS; }

double illumination(double ms, bool *waxing) {
  const double el = elongation(ms);
  if (waxing)
    *waxing = el < 180;
  return (1 - cosd(el)) / 2;
}

void sun_rise_set(double day_start, double lat, double lon, int64_t *rise, int64_t *set) {
  auto f = [&](double t) { return altitude(sun_eq(t), t, lat, lon) + 0.833; };
  Root r[4];
  const int n = roots(f, day_start, day_start + DAY_MS, 20 * 60000.0, 5000.0, 0, r, 4);
  *rise = NO_EVENT;
  *set = NO_EVENT;
  for (int i = 0; i < n; i++) {
    if (r[i].up && *rise == NO_EVENT)
      *rise = (int64_t) r[i].t;
    if (!r[i].up && *set == NO_EVENT)
      *set = (int64_t) r[i].t;
  }
}

void moon_rise_set(double day_start, double lat, double lon, int64_t *rise, int64_t *set) {
  auto f = [&](double t) {
    const Eq q = moon_eq(t);
    const double h0 = 0.7275 * (double) (asinf((float) (1.0 / q.r)) * DEGF) - 0.5667;
    return altitude(q, t, lat, lon) - h0;
  };
  Root r[4];
  const int n = roots(f, day_start, day_start + DAY_MS, 20 * 60000.0, 5000.0, 0, r, 4);
  *rise = NO_EVENT;
  *set = NO_EVENT;
  for (int i = 0; i < n; i++) {
    if (r[i].up && *rise == NO_EVENT)
      *rise = (int64_t) r[i].t;
    if (!r[i].up && *set == NO_EVENT)
      *set = (int64_t) r[i].t;
  }
}

int64_t moon_hour_angle_time(double day_start, double lon, int hours) {
  const double target = hours * 15.0;
  auto f = [&](double t) { return wrap180(gmst(t) + lon - moon_eq(t).ra - target); };
  Root r[3];
  const int n = roots(f, day_start, day_start + DAY_MS, 30 * 60000.0, 5000.0, 90.0, r, 3);
  for (int i = 0; i < n; i++)
    if (r[i].up)
      return (int64_t) r[i].t;
  return NO_EVENT;
}

int phase_index(double age) {
  const double a = std::floor(age * 10 + 1e-6) / 10.0;
  static const double LIM[8] = {1.8, 5.5, 9.2, 12.9, 16.6, 20.2, 23.9, 27.6};
  for (int i = 0; i < 8; i++)
    if (a <= LIM[i] + 1e-9)
      return i;
  return 8;
}

int hour_angle_index(double ha) {
  double h = std::fmod(ha + 6.0, 24.0);
  if (h < 0)
    h += 24.0;
  if (h >= 23.5)
    return 0;
  if (h < 12.5)
    return (int) std::floor(h + 0.5);
  if (h >= 17.5 && h < 18.5)
    return 13;  // lower transit: the nadir mark
  return -1;
}

int64_t round5(int64_t ms) {
  const double q = std::floor((double) ms / 300000.0 + 0.5);
  return (int64_t) (q * 300000.0);
}

}  // namespace astro
}  // namespace selene
}  // namespace esphome

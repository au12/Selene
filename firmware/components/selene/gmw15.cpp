// Selene "GMW-15 logic" astronomy engine — C++ port of shared/gmw15.js. See gmw15.h and the notes in the JS.
// Expressions keep the JS evaluation order so that both produce the same doubles.
#include "gmw15.h"
#include "astro.h"
#include <cmath>

namespace esphome {
namespace selene {
namespace gmw15 {

namespace {
constexpr int64_t DAY = 86400000LL;
constexpr double DAY_D = 86400000.0, HOUR_D = 3600000.0, MIN_D = 60000.0;
constexpr double RAD = 0.017453292519943295;

inline double frac(double x) { return x - std::floor(x); }
inline double rev(double x) { return x - std::floor(x / 360.0) * 360.0; }
inline double mod24(double x) { return x - std::floor(x / 24.0) * 24.0; }
inline double cosd(double x) { return std::cos(rev(x) * RAD); }
inline double sind(double x) { return std::sin(rev(x) * RAD); }
inline int64_t floor_div(int64_t a, int64_t b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }

// Civil date of a day number (days since 1970-01-01), H. Hinnant's algorithm
void civil(int64_t days, int &y, int &m, int &d) {
  const int64_t z = days + 719468;
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned) (z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  d = (int) (doy - (153 * mp + 2) / 5 + 1);
  m = (int) (mp < 10 ? mp + 3 : mp - 9);
  y = (int) ((int64_t) yoe + era * 400 + (m <= 2));
}
}  // namespace

double whole_deg(double x) { return std::floor(x + 0.5); }

double day_count(int ye, int mn, int da, double ho) {
  const double w = (ye - 1900) / 4.0, f = frac(w), a = std::floor(1461 * w);
  const double b = std::floor((mn + 7) / 10.0), c = std::floor(1 - f), d = std::floor(0.44 * (mn + 4.4));
  return a + 31 * mn + da + (b - 1) * c - b * d + ho / 24;
}

double z_day(int64_t ms) {
  int y, m, d;
  civil(floor_div(ms, DAY), y, m, d);
  return day_count(y, m, d, 0);
}

double centuries(double z) { return (z - 36556.5) / 36525; }

// RECON: the printed K = 24·FRAC(0.0027379·Y) has lost its epoch term (0.671262 rev at Y = 0)
double gst0(double z0) { return 24 * frac(0.671262 + 0.0027379 * (z0 - 25012)); }

double moon_ra(double t) {
  const double a = 32084.52539 * t + 14.55441 + 0.41925 * cosd(477198.868 * t + 44.963) +
                   0.16358 * cosd(962535.762 * t + 166.633) + 0.08494 * cosd(413335.350 * t + 10.740) +
                   0.07104 * cosd(1934.140 * t + 324.960) + 0.07048 * cosd(964469.900 * t + 41.590) +
                   0.04389 * cosd(890534.220 * t + 145.700);
  return 24 * frac(a / 24);
}

double gha0(double z0) { return mod24(gst0(z0) - moon_ra(centuries(z0))); }

double lunar_day(double z0) {
  const double djk = gha0(z0 + 1) - gha0(z0);
  return djk > 0 ? 576 / djk : 576 / (djk + 24);
}

double hour_angle(double ms, double lon) {
  const double day_ut = std::floor(ms / DAY_D) * DAY_D;
  const double z0 = z_day((int64_t) day_ut);
  return mod24(gha0(z0) + lon / 15 + ((ms - day_ut) / HOUR_D) * 24 / lunar_day(z0));
}

int64_t hour_angle_time(int64_t day_local, int32_t tz_min, double lon, int hours) {
  const double z0 = z_day(day_local), h0 = gha0(z0), l = lunar_day(z0);
  double x = mod24(hours - lon / 15 - h0) * l / 24 + tz_min / 60.0;
  x -= std::floor(x / l) * l;
  if (x >= 24)
    return astro::NO_EVENT;
  return (int64_t) ((double) day_local - tz_min * MIN_D + x * HOUR_D);
}

double moon_age(int64_t day_local, int32_t tz_min) {
  const double t = centuries(z_day(day_local) + 1);
  // RECON: the OCR reads 4572000 and 360000 for the two anomaly rates
  const double lm = 481267.9 * t + 218.3 + 6.3 * cosd(45 + 477200 * t) + 1.3 * cosd(11 + 413300 * t);
  const double ls = 36000.8 * t + 280.5 + 1.9 * cosd(268 + 36000 * t);
  double age = SYNODIC * rev(lm - ls) / 360 - tz_min / 1440.0 - 0.5;
  if (age < 0)
    age += SYNODIC;
  else if (age >= SYNODIC)
    age -= SYNODIC;
  return age;
}

double equation_of_time(double t3) {
  const double a = (t3 - 80.5) * 360 / 365.25, b = (t3 - 4.5) * 360 / 365.25;
  return -460.64 * sind(b) - 4.82 * sind(2 * b) + 592.32 * sind(2 * a) - 12.76 * sind(4 * a);
}

double sun_dec(double t) {
  return 23.26 * cosd(36001 * t + 190) + 0.39 * cosd(2 * t + 13) + 0.39 * cosd(72000 * t + 188) +
         0.16 * cosd(108002 * t + 211) + 0.01 * cosd(72003 * t + 34) + 0.01 * cosd(144001 * t + 209);
}

void sun_rise_set(int64_t day_local, int32_t tz_min, double lat, double lon, int64_t *rise, int64_t *set) {
  int y, mo, da;
  civil(floor_div(day_local, DAY), y, mo, da);
  const double t3 = day_count(y, mo, da, 0) - day_count(y, 1, 0, 0);
  const double tzh = tz_min / 60.0;
  const double median = 12 - lon / 15 + tzh - equation_of_time(t3) / 3600;
  const double dec = sun_dec(centuries(day_count(y, mo, da, median - tzh)));
  const double a = std::tan(lat * RAD) * std::tan(dec * RAD);
  const double b = -HORIZON / (std::cos(lat * RAD) * std::cos(dec * RAD));
  const double x = b - a;
  if (x < -1 || x > 1) {
    *rise = astro::NO_EVENT;
    *set = astro::NO_EVENT;
    return;
  }
  const double sstn = std::acos(x) / RAD / 15;
  const double base = (double) day_local - tz_min * MIN_D;
  *rise = (int64_t) (base + (median - sstn) * HOUR_D);
  *set = (int64_t) (base + (median + sstn) * HOUR_D);
}

}  // namespace gmw15
}  // namespace selene
}  // namespace esphome

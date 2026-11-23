#pragma once
// Selene "GMW-15 logic" astronomy engine — C++ port of shared/gmw15.js (keep in sync).
// Casio's own low-precision method from EP 0 400 542 / US 5,208,790 (H. Sato, Casio, priority 1989): a 7-term
// moon right-ascension series, hour angles interpolated over the lunar day, moon age from elongation over a
// flat 29.53 days, and a day-of-year Sun. Double precision throughout: daily values are computed once a day and
// the hour angle once an hour, so software doubles cost nothing here, and results match the JS bit for bit.
// Times: Unix ms (UTC); `day_local` = local midnight as local ms; longitude east-positive degrees.
#include <cstdint>

namespace esphome {
namespace selene {
namespace gmw15 {

constexpr double SYNODIC = 29.53;   // mean synodic month the watch assumes
constexpr double HORIZON = 0.017;   // half-day arc horizon term, as printed (≈ Sun's centre 0.97° below)

double whole_deg(double x);  // the watch stores its location in whole degrees (round half up)
double day_count(int ye, int mn, int da, double ho);  // patent day count Z (JD − 2414988.5)
double z_day(int64_t ms);                             // Z of the calendar date of ms at 0h
double centuries(double z);                           // Julian centuries from J2000.0
double gst0(double z0);                               // Greenwich sidereal time at 0h UT, hours
double moon_ra(double t);                             // hours [0,24)
double gha0(double z0);                               // Moon's Greenwich hour angle at 0h UT, hours
double lunar_day(double z0);                          // hours
double hour_angle(double ms, double lon);             // local hour angle, hours [0,24)
// Time the local hour angle reaches `hours` during the local day, or astro::NO_EVENT.
int64_t hour_angle_time(int64_t day_local, int32_t tz_min, double lon, int hours);
double moon_age(int64_t day_local, int32_t tz_min);   // days, at local noon
double equation_of_time(double t3);                   // seconds, t3 = day of year
double sun_dec(double t);                             // degrees
void sun_rise_set(int64_t day_local, int32_t tz_min, double lat, double lon, int64_t *rise, int64_t *set);

}  // namespace gmw15
}  // namespace selene
}  // namespace esphome

#pragma once
// Selene astronomy engine — C++ port of shared/astro.js (keep in sync).
// Low-precision Sun & Moon (Schlyter), ~1-2 arcmin. Time arguments in double (ms since epoch),
// trigonometry in single precision (ESP32-P4 has a hardware FPU for float only).
#include <cstdint>

namespace esphome {
namespace selene {
namespace astro {

constexpr double DAY_MS = 86400000.0;
constexpr int64_t NO_EVENT = INT64_MIN;

struct Eq {
  double ra;   // degrees [0,360)
  double dec;  // degrees
  double r;    // Earth radii (moon only)
};

double rev(double x);
double wrap180(double x);
double gmst(double ms);
Eq sun_eq(double ms);
Eq moon_eq(double ms);
double altitude(const Eq &eq, double ms, double lat, double lon);
double moon_hour_angle(double ms, double lon);  // hours [0,24)
double elongation(double ms);
double last_new_moon(double ms);
double moon_age(double ms);
double illumination(double ms, bool *waxing);
// Events within [day_start, day_start + 24h); NO_EVENT if none.
void sun_rise_set(double day_start, double lat, double lon, int64_t *rise, int64_t *set);
void moon_rise_set(double day_start, double lat, double lon, int64_t *rise, int64_t *set);
int64_t moon_hour_angle_time(double day_start, double lon, int hours);
int phase_index(double age);           // 0..8
int hour_angle_index(double ha_hours);  // 0..12 or -1
int64_t round5(int64_t ms);

}  // namespace astro
}  // namespace selene
}  // namespace esphome

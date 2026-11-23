// Host test: reads "day_local tz_min lat lon ha_ms" lines and prints the GMW-15 logic engine's outputs
// (moon age, sunrise, sunset, 18h/0h/6h/12h hour-angle times, hour angle at ha_ms) for comparison with gmw15.js.
#include "../components/selene/astro.h"
#include "../components/selene/gmw15.h"
#include <cstdio>
#include <initializer_list>
using namespace esphome::selene;
int main() {
  long long day;
  int tz;
  double lat, lon, ha_ms;
  while (scanf("%lld %d %lf %lf %lf", &day, &tz, &lat, &lon, &ha_ms) == 5) {
    int64_t rise, set;
    gmw15::sun_rise_set(day, tz, lat, lon, &rise, &set);
    printf("%.9f %lld %lld", gmw15::moon_age(day, tz), (long long) rise, (long long) set);
    for (int h : {18, 0, 6, 12})
      printf(" %lld", (long long) gmw15::hour_angle_time(day, tz, lon, h));
    printf(" %.9f\n", gmw15::hour_angle(ha_ms, lon));
  }
}

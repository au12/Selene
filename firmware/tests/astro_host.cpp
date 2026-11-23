// Host test: reads "ms lat lon dayStart" lines, prints results for comparison with astro.js
#include "../components/selene/astro.h"
#include <cstdio>
#include <initializer_list>
using namespace esphome::selene::astro;
int main() {
  double ms, lat, lon, ds;
  while (scanf("%lf %lf %lf %lf", &ms, &lat, &lon, &ds) == 4) {
    Eq m = moon_eq(ms);
    int64_t sr, ss, mr, mset;
    sun_rise_set(ds, lat, lon, &sr, &ss);
    moon_rise_set(ds, lat, lon, &mr, &mset);
    printf("%.4f %.4f %.0f %.5f %lld %lld %lld %lld", m.ra, m.dec, last_new_moon(ms), moon_age(ms), (long long) sr, (long long) ss, (long long) mr, (long long) mset);
    for (int h : {0, 6, 12, 18}) printf(" %lld", (long long) moon_hour_angle_time(ds, lon, h));
    printf(" %d %d\n", phase_index(moon_age(ms)), hour_angle_index(moon_hour_angle(ms, lon)));
  }
}

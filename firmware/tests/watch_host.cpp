// Host test: replays a scripted button sequence and prints lit segment indices per step.
// Input lines: "<op> <arg> <now_ms> <rt_ms>" where op in P(press) R(release) T(tick) S(segments)
#include "../components/selene/watch.h"
#include <cstdio>
#include <cstring>
using namespace esphome::selene;
int main(int argc, char **argv) {
  Watch w;
  w.synced_time = false;
  w.s.tz_min = -300; w.s.lat = 40.7f; w.s.lon = -74.0f;
  char op[4]; long long now; unsigned rt; char arg[4];
  while (scanf("%3s %3s %lld %u", op, arg, &now, &rt) == 4) {
    Btn b = BTN_A;
    switch (arg[0]) { case 'A': b = BTN_A; break; case 'B': b = BTN_B; break; case 'C': b = BTN_C; break; case 'D': b = BTN_D; break; case 'L': b = BTN_L; break; }
    if (op[0] == 'P') w.press(b, now, rt);
    else if (op[0] == 'R') w.release(b, now, rt);
    else if (op[0] == 'T') w.tick(now, rt);
    else if (op[0] == 'S') {
      SegSet s; w.segments(now, rt, s);
      bool first = true;
      for (int i = 0; i < SEG_COUNT; i++) if (s.get(i)) { printf(first ? "%d" : " %d", i); first = false; }
      printf("\n");
    }
  }
}

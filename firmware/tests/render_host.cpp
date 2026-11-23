// Host test for renderer.cpp: full vs incremental equivalence, rotation, timing; writes PPM frames.
#include "../components/selene/renderer.h"
#include "../components/selene/watch.h"
#include "../components/selene/faces_all.h"
#include <cstdio>
#include <vector>
#include <chrono>
using namespace esphome::selene;
struct FB { int S; std::vector<uint16_t> px; long pushes = 0, pixels = 0; };
static void push(void *ctx, int x, int y, int w, int h, const uint16_t *p) {
  FB *fb = (FB *) ctx; fb->pushes++; fb->pixels += w * h;
  for (int j = 0; j < h; j++) for (int i = 0; i < w; i++) fb->px[(y + j) * fb->S + x + i] = p[j * w + i];
}
static void save(const FB &fb, const char *path) {
  FILE *f = fopen(path, "wb"); fprintf(f, "P6 %d %d 255\n", fb.S, fb.S);
  for (uint16_t c : fb.px) { unsigned char rgb[3] = {(unsigned char) (((c >> 11) & 31) * 255 / 31), (unsigned char) (((c >> 5) & 63) * 255 / 63), (unsigned char) ((c & 31) * 255 / 31)}; fwrite(rgb, 1, 3, f); }
  fclose(f);
}
int main() {
  int failures = 0;
  for (int fi = 0; fi < FACE_COUNT; fi++) {
    const FaceDef *face = FACES[fi];
    Watch w; w.s.tz_min = -300; w.s.lat = 34.85f; w.s.lon = -82.39f; w.s.alarm_on = true; w.s.chime_on = true;
    int64_t now = 1795412557000LL; uint32_t rt = 10000;
    FB inc{720, std::vector<uint16_t>(720 * 720, 0x1234)}, ref{720, std::vector<uint16_t>(720 * 720, 0)};
    Renderer r; r.begin(push, &inc, 0);
    if (!r.set_face(face)) { printf("%s: set_face failed\n", face->id); return 1; }
    SegSet s; w.segments(now, rt, s); r.render(s);
    char name[64]; snprintf(name, sizeof name, "/tmp/%s_full.ppm", face->id); save(inc, name);
    // run 90 seconds of incremental updates + a mode change, compare to a fresh full render
    long inc_pixels = 0; double worst_ms = 0;
    for (int k = 0; k < 90; k++) {
      now += 1000; rt += 1000; w.tick(now, rt);
      if (k == 40) { w.press(BTN_C, now, rt); w.release(BTN_C, now, rt + 50); }
      if (k == 60) { w.press(BTN_C, now, rt); w.release(BTN_C, now, rt + 50); }
      w.segments(now, rt, s);
      inc.pixels = 0; auto t0 = std::chrono::steady_clock::now(); r.render(s);
      double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      if (ms > worst_ms) worst_ms = ms; inc_pixels += inc.pixels;
    }
    Renderer r2; r2.begin(push, &ref, 0); r2.set_face(face); r2.render(s);
    long diff = 0; for (size_t i = 0; i < ref.px.size(); i++) diff += ref.px[i] != inc.px[i];
    // rotation 90: compare against rotated reference
    FB rot{720, std::vector<uint16_t>(720 * 720, 0)}; Renderer r3; r3.begin(push, &rot, 90); r3.set_face(face); r3.render(s);
    long rdiff = 0; for (int y = 0; y < 720; y++) for (int x = 0; x < 720; x++) rdiff += rot.px[x * 720 + (719 - y)] != ref.px[y * 720 + x];
    snprintf(name, sizeof name, "/tmp/%s_after.ppm", face->id); save(inc, name);
    printf("%-5s full-vs-incremental diff px: %ld | rot90 diff px: %ld | avg incremental push %ld px/update | worst host render %.2f ms\n",
           face->id, diff, rdiff, inc_pixels / 90, worst_ms);
    failures += diff != 0 || rdiff != 0;
  }
  return failures;
}

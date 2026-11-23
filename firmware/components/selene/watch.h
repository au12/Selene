#pragma once
// Selene watch module — C++ port of shared/module.js (keep in sync).
// Pure logic: no ESPHome dependencies, so it can be unit-tested on a host.
#include <cstdint>
#include <cstring>
#include <functional>
#include "segments.h"

namespace esphome {
namespace selene {

struct SegSet {
  uint32_t w[SEG_WORDS]{};
  void clear() { memset(w, 0, sizeof(w)); }
  void set(int i) {
    if (i >= 0 && i < SEG_COUNT)
      w[i >> 5] |= 1u << (i & 31);
  }
  bool get(int i) const { return (w[i >> 5] >> (i & 31)) & 1u; }
  bool operator==(const SegSet &o) const { return memcmp(w, o.w, sizeof(w)) == 0; }
  bool operator!=(const SegSet &o) const { return !(*this == o); }
};

enum Btn : uint8_t { BTN_A = 0, BTN_B, BTN_C, BTN_D, BTN_L, BTN_COUNT };
// Astronomy engine: modern (astro.cpp) or Casio's own GMW-15-era method (gmw15.cpp)
enum Engine : uint8_t { ENGINE_MODERN = 0, ENGINE_GMW15 = 1 };
enum Mode : uint8_t { M_TIME = 0, M_MOON, M_SUN, M_ALM, M_ST };
enum SetKind : uint8_t { SET_NONE = 0, SET_TIME, SET_LOC, SET_ALM };
enum WatchEvent : uint8_t {
  EV_KEY = 0,
  EV_CHIME,
  EV_ALARM_START,
  EV_ALARM_STOP,
  EV_TEST_START,
  EV_TEST_STOP,
  EV_LIGHT,
  EV_SNOOZE,
  EV_SAVE,
};

struct WatchSettings {
  int32_t tz_min{0};
  float lat{40.7f};
  float lon{-74.0f};
  bool h24{false};
  uint8_t alarm_h{7};
  uint8_t alarm_m{0};
  bool alarm_on{false};
  bool chime_on{false};
  uint8_t dow_offset{0};
  bool authentic{false};
  uint8_t snooze_min{5};
  int64_t user_offset{0};
  uint8_t engine{ENGINE_MODERN};
};

struct LocalTime {
  int y, mo, d, h, mi, s, ms, dow;
};

class Watch {
 public:
  WatchSettings s;
  std::function<void(WatchEvent)> on_event;
  // Firmware: the clock is network-synced, so SET in TIME goes straight to location setup
  // and the GMT offset is shown read-only (it follows the configured time zone).
  bool synced_time{true};

  void press(Btn b, int64_t now, uint32_t rt);
  void release(Btn b, int64_t now, uint32_t rt);
  void tick(int64_t now, uint32_t rt);
  void segments(int64_t now, uint32_t rt, SegSet &out);
  void start_demo(uint32_t rt);
  bool ringing() const { return ring_; }
  Mode mode() const { return mode_; }
  SetKind setting() const { return set_; }
  bool demo_active() const { return demo_; }

  // helpers (public for tests)
  int64_t utc(int64_t now) const { return now + s.user_offset; }
  int64_t local(int64_t now) const { return utc(now) + (int64_t) s.tz_min * 60000; }
  static LocalTime parts(int64_t local_ms);
  static int64_t days_from_civil(int y, int m, int d);

 protected:
  struct Held {
    bool down{false};
    bool consumed{false};
    bool demo{false};
    uint32_t t{0};
    uint32_t last{0};
  };
  struct DayData {
    int64_t day{INT64_MIN};
    float lat{0}, lon{0};
    int32_t tz{0};
    uint8_t engine{0};
    double age{0};
    int phase{0};
    int64_t rise{0}, set{0};
    int64_t ev[4]{};
  };

  void emit_(WatchEvent e) {
    if (on_event)
      on_event(e);
  }
  void handle_(Btn b, int64_t now, uint32_t rt, bool repeat);
  void next_mode_(int64_t now, uint32_t rt);
  void enter_(Mode m, int64_t now, uint32_t rt);
  void adjust_time_(int field, int64_t now);
  void start_alarm_(uint32_t rt);
  void stop_alarm_();
  void snooze_(int64_t now);
  uint32_t sw_elapsed_(uint32_t rt) const;
  int moon_cycle_(uint32_t rt) const;
  const DayData &day_data_(int64_t day_local);
  void update_current_(int64_t now);
  int64_t today_local_(int64_t now) const;

  Mode mode_{M_TIME};
  SetKind set_{SET_NONE};
  int set_field_{0};
  // MOON/SUN selected date
  bool sel_valid_{false};
  int64_t sel_day_{0};
  bool sel_changed_{false};
  uint32_t ready_at_{0};
  bool ready_wait_{false};  // date being changed: wait for release
  uint32_t cycle_at_{0};
  // stopwatch
  bool sw_running_{false};
  uint32_t sw_start_{0};
  uint32_t sw_acc_{0};
  bool sw_split_{false};
  uint32_t sw_split_val_{0};
  // demo, alarm, snooze
  bool demo_{false};
  uint32_t demo_start_{0};
  bool ring_{false};
  uint32_t ring_until_{0};
  bool snooze_pending_{false};
  int64_t snooze_at_{0};
  Held held_[BTN_COUNT];
  uint32_t last_use_{0};
  bool after_op_{false};
  int64_t last_sec_{INT64_MIN};
  // current astro (per second; per hour with GMW-15 logic)
  int64_t cur_key_{INT64_MIN};
  float cur_lat_{0}, cur_lon_{0};
  int32_t cur_tz_{0};
  uint8_t cur_engine_{0xFF};
  int cur_phase_{0}, cur_hai_{-1};
  DayData cache_[2];
  int cache_next_{0};
};

}  // namespace selene
}  // namespace esphome

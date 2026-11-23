#include "selene.h"
#include <cmath>
#include <sys/time.h>
#include "astro.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "faces_all.h"

namespace esphome {
namespace selene {

static const char *const TAG = "selene";
static constexpr uint8_t PERSIST_VERSION = 2;

static void push_to_display(void *ctx, int x, int y, int w, int h, const uint16_t *px) {
  auto *d = static_cast<display::Display *>(ctx);
  d->draw_pixels_at(x, y, w, h, reinterpret_cast<const uint8_t *>(px), display::COLOR_BITNESS_565, false, 0, 0, 0);
}

void SeleneClock::setup() {
  watch_.synced_time = true;
  watch_.s.lat = def_lat_;
  watch_.s.lon = def_lon_;
  watch_.on_event = [this](WatchEvent e) { this->on_event_(e); };
  for (int i = 0; i < FACE_COUNT; i++)
    if (def_face_ == FACES[i]->id)
      face_ = i;

  pref_ = global_preferences->make_preference<Persist>(fnv1_hash("selene_clock_v2"), true);
  Persist p{};
  if (pref_.load(&p) && p.version == PERSIST_VERSION) {
    watch_.s.h24 = p.h24;
    watch_.s.alarm_h = p.alarm_h % 24;
    watch_.s.alarm_m = p.alarm_m % 60;
    watch_.s.alarm_on = p.alarm_on;
    watch_.s.chime_on = p.chime_on;
    if (std::isfinite(p.lat) && std::isfinite(p.lon)) {
      watch_.s.lat = p.lat;
      watch_.s.lon = p.lon;
    }
    if (p.face < FACE_COUNT)
      face_ = p.face;
  }
  renderer_.begin(push_to_display, display_, rotation_);
  if (!renderer_.set_face(FACES[face_])) {
    ESP_LOGE(TAG, "Not enough PSRAM to unpack face assets");
    this->mark_failed();
    return;
  }
  this->render_();
}

void SeleneClock::dump_config() {
  ESP_LOGCONFIG(TAG,
                "Selene clock:\n"
                "  Faces: %d (active: %s)\n"
                "  Location: %.2f, %.2f\n"
                "  Rotation: %d",
                FACE_COUNT, FACES[face_]->name, watch_.s.lat, watch_.s.lon, rotation_);
}

int64_t SeleneClock::now_ms_() {
  const time_t ts = time_->timestamp_now();
  struct timeval tv;
  gettimeofday(&tv, nullptr);
  if (std::llabs((long long) ts - (long long) tv.tv_sec) <= 1)
    return (int64_t) tv.tv_sec * 1000 + tv.tv_usec / 1000;  // system clock (SNTP / Home Assistant)
  // external RTC platform: seconds from the RTC, sub-second from millis()
  const uint32_t ms = millis();
  if (ts != last_ts_) {
    last_ts_ = ts;
    ts_millis_ = ms;
  }
  uint32_t sub = ms - ts_millis_;
  if (sub > 999)
    sub = 999;
  return (int64_t) ts * 1000 + sub;
}

void SeleneClock::loop() {
  const uint32_t ms = millis();
  if (save_pending_ && (int32_t) (ms - save_at_) >= 0) {
    save_pending_ = false;
    this->save_();
  }
  const ESPTime utc = time_->utcnow();
  const bool valid = utc.is_valid();
  if (valid != time_valid_) {
    time_valid_ = valid;
    last_frame_ = ms - 1000;
  }
  if (valid) {
    watch_.s.tz_min = ESPTime::timezone_offset() / 60;
    watch_.tick(this->now_ms_(), ms);
  }
  // repeating alarm / test beeps
  if (watch_.ringing() && (int32_t) (ms - next_beep_) >= 0) {
    next_beep_ = ms + 1000;
    this->sound_("alarm");
  } else if (test_beeping_ && (int32_t) (ms - next_beep_) >= 0) {
    next_beep_ = ms + 1000;
    this->sound_("alarm");
  }
  // ~30 fps; segments only change on second boundaries except stopwatch/demo/blink
  if (ms - last_frame_ >= 33) {
    last_frame_ = ms;
    this->render_();
  }
}

void SeleneClock::render_() {
  SegSet lit;
  if (!time_valid_) {
    // waiting for network time: dashes on the LCD
    for (int c = 0; c < 3; c++)
      for (int k = 0; k < 5; k++)
        lit.set(SEG_X + c * 35 + 3 * 5 + k);
    for (int n = 0; n < 4; n++)
      lit.set(SEG_B + n * 7 + 6);
    if ((millis() / 600) % 2)
      lit.set(SEG_BCOL);
  } else {
    watch_.segments(this->now_ms_(), millis(), lit);
  }
  renderer_.render(lit);
}

void SeleneClock::on_event_(WatchEvent e) {
  switch (e) {
    case EV_KEY:
    case EV_SNOOZE:
      this->sound_("key");
      break;
    case EV_CHIME:
      this->sound_("chime");
      break;
    case EV_ALARM_START:
      next_beep_ = millis();
      break;
    case EV_ALARM_STOP:
      this->sound_("stop");
      break;
    case EV_TEST_START:
      test_beeping_ = true;
      next_beep_ = millis();
      break;
    case EV_TEST_STOP:
      test_beeping_ = false;
      this->sound_("stop");
      break;
    case EV_LIGHT:
      light_cb_.call();
      break;
    case EV_SAVE:
      save_pending_ = true;
      save_at_ = millis() + 1500;
      break;
  }
}

void SeleneClock::save_() {
  Persist p{};
  p.version = PERSIST_VERSION;
  p.face = (uint8_t) face_;
  p.h24 = watch_.s.h24;
  p.alarm_h = watch_.s.alarm_h;
  p.alarm_m = watch_.s.alarm_m;
  p.alarm_on = watch_.s.alarm_on;
  p.chime_on = watch_.s.chime_on;
  p.lat = watch_.s.lat;
  p.lon = watch_.s.lon;
  pref_.save(&p);
}

static Btn btn_of(char b) {
  switch (b) {
    case 'A': case 'a': return BTN_A;
    case 'B': case 'b': return BTN_B;
    case 'C': case 'c': return BTN_C;
    case 'D': case 'd': return BTN_D;
    default: return BTN_L;
  }
}

void SeleneClock::press(char b) {
  if (!time_valid_) {
    if (b == 'L' || b == 'l')
      light_cb_.call();
    return;
  }
  watch_.press(btn_of(b), this->now_ms_(), millis());
  last_frame_ = millis() - 1000;  // redraw promptly
}

void SeleneClock::release(char b) {
  if (!time_valid_)
    return;
  watch_.release(btn_of(b), this->now_ms_(), millis());
  last_frame_ = millis() - 1000;
}

void SeleneClock::touch(bool down, int x, int y) {
  // map panel coordinates back to face orientation
  const int S = renderer_.face() ? renderer_.face()->size : 720;
  int lx = x, ly = y;
  if (rotation_ == 90) {
    lx = y;
    ly = S - 1 - x;
  } else if (rotation_ == 180) {
    lx = S - 1 - x;
    ly = S - 1 - y;
  } else if (rotation_ == 270) {
    lx = S - 1 - y;
    ly = x;
  }
  const uint32_t ms = millis();
  if (down) {
    if (!touch_down_) {
      touch_down_ = true;
      touch_x0_ = lx;
      touch_y0_ = ly;
      touch_t0_ = ms;
    }
    touch_x_ = lx;
    touch_y_ = ly;
    return;
  }
  if (!touch_down_)
    return;
  touch_down_ = false;
  const int dx = touch_x_ - touch_x0_, dy = touch_y_ - touch_y0_;
  if (std::abs(dx) > 110 && std::abs(dx) > 2 * std::abs(dy)) {
    this->next_face(dx < 0 ? 1 : -1);
  } else if (std::abs(dx) < 30 && std::abs(dy) < 30 && ms - touch_t0_ < 700) {
    this->tap('L');
  }
}

int SeleneClock::face_count() const { return FACE_COUNT; }
const char *SeleneClock::face_name(int i) const { return (i >= 0 && i < FACE_COUNT) ? FACES[i]->name : ""; }

void SeleneClock::set_face(int i) {
  if (i < 0 || i >= FACE_COUNT || i == face_)
    return;
  const uint32_t t0 = millis();
  if (!renderer_.set_face(FACES[i])) {
    ESP_LOGE(TAG, "Failed to unpack face %s", FACES[i]->name);
    return;
  }
  face_ = i;
  this->render_();
  ESP_LOGI(TAG, "Face -> %s (%u ms)", FACES[i]->name, (unsigned) (millis() - t0));
  face_cb_.call(std::string(FACES[i]->name));
  save_pending_ = true;
  save_at_ = millis() + 1500;
}

void SeleneClock::set_face_by_name(const std::string &name) {
  for (int i = 0; i < FACE_COUNT; i++)
    if (str_equals_case_insensitive(name, FACES[i]->name) || str_equals_case_insensitive(name, FACES[i]->id))
      this->set_face(i);
}

void SeleneClock::set_alarm_time(int h, int m) {
  watch_.s.alarm_h = (uint8_t) (((h % 24) + 24) % 24);
  watch_.s.alarm_m = (uint8_t) (((m % 60) + 60) % 60);
  this->on_event_(EV_SAVE);
}
void SeleneClock::set_alarm_enabled(bool on) {
  watch_.s.alarm_on = on;
  this->on_event_(EV_SAVE);
}
void SeleneClock::set_chime_enabled(bool on) {
  watch_.s.chime_on = on;
  this->on_event_(EV_SAVE);
}
void SeleneClock::set_24h(bool on) {
  watch_.s.h24 = on;
  this->on_event_(EV_SAVE);
}
void SeleneClock::set_latitude(float v) {
  watch_.s.lat = std::fmax(-89.0f, std::fmin(89.0f, v));
  this->on_event_(EV_SAVE);
}
void SeleneClock::set_longitude(float v) {
  watch_.s.lon = std::fmax(-180.0f, std::fmin(180.0f, v));
  this->on_event_(EV_SAVE);
}
void SeleneClock::stop_alarm() {
  if (watch_.ringing())
    this->tap('A');
}

// ------------------------------------------------------------------ sky data
float SeleneClock::moon_age() {
  if (!time_valid_)
    return NAN;
  return (float) astro::moon_age((double) this->now_ms_());
}
float SeleneClock::moon_illumination() {
  if (!time_valid_)
    return NAN;
  return (float) (astro::illumination((double) this->now_ms_(), nullptr) * 100.0);
}
std::string SeleneClock::moon_phase_name() {
  if (!time_valid_)
    return "";
  const double el = astro::elongation((double) this->now_ms_());
  if (el < 6 || el >= 354)
    return "New moon";
  if (el < 84)
    return "Waxing crescent";
  if (el < 96)
    return "First quarter";
  if (el < 174)
    return "Waxing gibbous";
  if (el < 186)
    return "Full moon";
  if (el < 264)
    return "Waning gibbous";
  if (el < 276)
    return "Last quarter";
  return "Waning crescent";
}
float SeleneClock::sun_elevation() {
  if (!time_valid_)
    return 0;
  const double t = (double) this->now_ms_();
  return (float) astro::altitude(astro::sun_eq(t), t, watch_.s.lat, watch_.s.lon);
}
float SeleneClock::moon_elevation() {
  if (!time_valid_)
    return NAN;
  const double t = (double) this->now_ms_();
  return (float) astro::altitude(astro::moon_eq(t), t, watch_.s.lat, watch_.s.lon);
}
const SeleneClock::DayInfo &SeleneClock::today_() {
  const int64_t loc = this->now_ms_() + (int64_t) watch_.s.tz_min * 60000;
  const int64_t day = (loc / 86400000LL) * 86400000LL;
  if (day != day_info_.day || day_info_.lat != watch_.s.lat || day_info_.lon != watch_.s.lon) {
    day_info_.day = day;
    day_info_.lat = watch_.s.lat;
    day_info_.lon = watch_.s.lon;
    const double start = (double) (day - (int64_t) watch_.s.tz_min * 60000);
    astro::sun_rise_set(start, watch_.s.lat, watch_.s.lon, &day_info_.sun_rise, &day_info_.sun_set);
    astro::moon_rise_set(start, watch_.s.lat, watch_.s.lon, &day_info_.moon_rise, &day_info_.moon_set);
    day_info_.transit = astro::moon_hour_angle_time(start, watch_.s.lon, 0);
  }
  return day_info_;
}
std::string SeleneClock::event_time(const std::string &which) {
  if (!time_valid_)
    return "";
  const DayInfo &d = this->today_();
  int64_t t = astro::NO_EVENT;
  if (which == "sunrise")
    t = d.sun_rise;
  else if (which == "sunset")
    t = d.sun_set;
  else if (which == "moonrise")
    t = d.moon_rise;
  else if (which == "moonset")
    t = d.moon_set;
  else if (which == "moon_transit")
    t = d.transit;
  if (t == astro::NO_EVENT)
    return "—";
  const LocalTime p = Watch::parts(t + (int64_t) watch_.s.tz_min * 60000);
  char buf[8];
  snprintf(buf, sizeof buf, "%02d:%02d", p.h, p.mi);
  return buf;
}

std::string SeleneClock::rtttl_for(const std::string &sound) {
  // ~4 kHz piezo-style beeps (B7 = 3951 Hz)
  if (sound == "key")
    return "key:d=32,o=7,b=300:b";
  if (sound == "chime")
    return "chime:d=16,o=7,b=200:b,p,b";
  if (sound == "alarm")
    return "alarm:d=32,o=7,b=230:b,p,b,p,b,p,b";
  return "";
}

}  // namespace selene
}  // namespace esphome

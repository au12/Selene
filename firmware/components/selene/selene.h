#pragma once
#include <string>
#include "esphome/core/automation.h"
#include "esphome/core/component.h"
#include "esphome/core/helpers.h"
#include "esphome/core/preferences.h"
#include "esphome/components/display/display.h"
#include "esphome/components/time/real_time_clock.h"
#include "renderer.h"
#include "watch.h"

namespace esphome {
namespace selene {

/// Selene lunar alarm clock: drives the watch module, renders faces and exposes data to Home Assistant.
class SeleneClock : public Component {
 public:
  void set_display(display::Display *d) { display_ = d; }
  void set_time(time::RealTimeClock *t) { time_ = t; }
  void set_location(float lat, float lon) {
    def_lat_ = lat;
    def_lon_ = lon;
  }
  void set_rotation(int r) { rotation_ = r; }
  void set_default_face(const std::string &id) { def_face_ = id; }

  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::LATE; }

  // Buttons: 'A' FWD, 'B' SET/ADJUST, 'C' MODE, 'D' REV, 'L' LIGHT/SNOOZE
  void press(char b);
  void release(char b);
  void tap(char b) {
    this->press(b);
    this->release(b);
  }
  // Touch panel: tap = light/snooze, horizontal swipe = change face.
  void touch(bool down, int x, int y);

  // Faces
  int face_count() const;
  const char *face_name(int i) const;
  int face_index() const { return face_; }
  std::string face_name() const { return this->face_name(face_); }
  void set_face(int i);
  void set_face_by_name(const std::string &name);
  void next_face(int dir = 1) { this->set_face((face_ + dir + this->face_count()) % this->face_count()); }

  // Settings (also changed from the watch buttons; persisted to flash)
  void set_alarm_time(int h, int m);
  void set_alarm_hour(int h) { this->set_alarm_time(h, watch_.s.alarm_m); }
  void set_alarm_minute(int m) { this->set_alarm_time(watch_.s.alarm_h, m); }
  void set_alarm_enabled(bool on);
  void set_chime_enabled(bool on);
  void set_24h(bool on);
  void set_latitude(float v);
  void set_longitude(float v);
  // Astronomy engine for the face: "Modern" (accurate) or "GMW-15 logic" (Casio's 1989 method)
  void set_engine(uint8_t e);
  void set_engine_by_name(const std::string &name);
  uint8_t engine() const { return watch_.s.engine; }
  std::string engine_name() const { return watch_.s.engine == ENGINE_GMW15 ? "GMW-15 logic" : "Modern"; }
  int alarm_hour() const { return watch_.s.alarm_h; }
  int alarm_minute() const { return watch_.s.alarm_m; }
  bool alarm_enabled() const { return watch_.s.alarm_on; }
  bool chime_enabled() const { return watch_.s.chime_on; }
  bool is_24h() const { return watch_.s.h24; }
  float latitude() const { return watch_.s.lat; }
  float longitude() const { return watch_.s.lon; }
  void start_demo() { watch_.start_demo(millis()); }
  void stop_alarm();
  bool ringing() const { return watch_.ringing(); }
  bool time_valid() const { return time_valid_; }

  // Sky data (current location & time)
  float moon_age();
  float moon_illumination();  // percent
  std::string moon_phase_name();
  float sun_elevation();
  float moon_elevation();
  /// "sunrise", "sunset", "moonrise", "moonset" or "moon_transit" for today, "HH:MM" local or "—"
  std::string event_time(const std::string &which);
  /// Brightness helper: true while the sun is below -6° (civil twilight)
  bool is_dark() { return this->sun_elevation() < -6.0f; }
  uint32_t last_render_us() const { return renderer_.last_render_us(); }

  static std::string rtttl_for(const std::string &sound);

  void add_on_sound_callback(std::function<void(std::string)> &&cb) { sound_cb_.add(std::move(cb)); }
  void add_on_light_callback(std::function<void()> &&cb) { light_cb_.add(std::move(cb)); }
  void add_on_face_callback(std::function<void(std::string)> &&cb) { face_cb_.add(std::move(cb)); }

 protected:
  struct Persist {
    uint8_t version;
    uint8_t face;
    uint8_t h24, alarm_h, alarm_m, alarm_on, chime_on, engine;  // `engine` was padding (0 = modern) before
    float lat, lon;
  };
  int64_t now_ms_();
  void on_event_(WatchEvent e);
  void save_();
  void render_();
  void sound_(const char *s) { sound_cb_.call(std::string(s)); }
  struct DayInfo {
    int64_t day{INT64_MIN};
    float lat{0}, lon{0};
    int64_t sun_rise{0}, sun_set{0}, moon_rise{0}, moon_set{0}, transit{0};
  };
  const DayInfo &today_();

  display::Display *display_{nullptr};
  time::RealTimeClock *time_{nullptr};
  float def_lat_{40.7f}, def_lon_{-74.0f};
  int rotation_{0};
  std::string def_face_{"arc"};
  Watch watch_;
  Renderer renderer_;
  ESPPreferenceObject pref_;
  int face_{0};
  bool time_valid_{false};
  bool save_pending_{false};
  uint32_t save_at_{0};
  uint32_t last_frame_{0};
  time_t last_ts_{0};
  uint32_t ts_millis_{0};
  bool test_beeping_{false};
  uint32_t next_beep_{0};
  bool touch_down_{false};
  int touch_x0_{0}, touch_y0_{0}, touch_x_{0}, touch_y_{0};
  uint32_t touch_t0_{0};
  DayInfo day_info_;
  CallbackManager<void(std::string)> sound_cb_;
  CallbackManager<void()> light_cb_;
  CallbackManager<void(std::string)> face_cb_;
};

class SoundTrigger : public Trigger<std::string> {
 public:
  explicit SoundTrigger(SeleneClock *parent) {
    parent->add_on_sound_callback([this](std::string s) { this->trigger(s); });
  }
};
class LightTrigger : public Trigger<> {
 public:
  explicit LightTrigger(SeleneClock *parent) {
    parent->add_on_light_callback([this]() { this->trigger(); });
  }
};
class FaceTrigger : public Trigger<std::string> {
 public:
  explicit FaceTrigger(SeleneClock *parent) {
    parent->add_on_face_callback([this](std::string s) { this->trigger(s); });
  }
};

}  // namespace selene
}  // namespace esphome

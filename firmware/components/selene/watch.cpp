// Selene watch module — C++ port of shared/module.js. See watch.h.
#include "watch.h"
#include "astro.h"
#include <cmath>
#include <cstdlib>

namespace esphome {
namespace selene {

namespace {
constexpr int64_t DAY = 86400000LL, HOUR = 3600000LL, MIN = 60000LL;

// 5x7 font for ' 0-9 A-Z \' -'
struct Glyph {
  char c;
  uint8_t rows[7];
};
const Glyph FONT[] = {
    {' ', {0, 0, 0, 0, 0, 0, 0}},
    {'\'', {0x0C, 0x04, 0x08, 0, 0, 0, 0}},
    {'-', {0, 0, 0, 0x1F, 0, 0, 0}},
    {'0', {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E}},
    {'1', {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E}},
    {'2', {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F}},
    {'3', {0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E}},
    {'4', {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02}},
    {'5', {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E}},
    {'6', {0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E}},
    {'7', {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08}},
    {'8', {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E}},
    {'9', {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C}},
    {'A', {0x0E, 0x11, 0x11, 0x11, 0x1F, 0x11, 0x11}},
    {'D', {0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C}},
    {'E', {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F}},
    {'F', {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10}},
    {'G', {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0F}},
    {'H', {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11}},
    {'I', {0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E}},
    {'L', {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F}},
    {'M', {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11}},
    {'N', {0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11}},
    {'O', {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E}},
    {'P', {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10}},
    {'R', {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11}},
    {'S', {0x0F, 0x10, 0x10, 0x0E, 0x01, 0x01, 0x1E}},
    {'T', {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04}},
    {'U', {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E}},
    {'W', {0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0A}},
};
const uint8_t *glyph(char c) {
  for (const auto &g : FONT)
    if (g.c == c)
      return g.rows;
  return FONT[0].rows;
}
// 7-segment masks, bit0=a .. bit6=g, bit7 = extra 'w' (only b5)
uint8_t seg7(char c) {
  switch (c) {
    case '0': return 0x3F;
    case '1': return 0x06;
    case '2': return 0x5B;
    case '3': return 0x4F;
    case '4': return 0x66;
    case '5': case 'S': return 0x6D;
    case '6': return 0x7D;
    case '7': return 0x07;
    case '8': return 0x7F;
    case '9': return 0x6F;
    case '-': return 0x40;
    case 'n': return 0x54;
    case 'E': return 0x79;
    case 'W': return 0x3E | 0x80;
    case 'o': return 0x5C;
    default: return 0;
  }
}
const char *const DOW[7] = {"SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"};

struct Out {
  SegSet &o;
  void dm(const char *str) {
    const size_t len = strlen(str);
    for (int c = 0; c < 3; c++) {
      const char ch = (size_t) c < len ? str[c] : ' ';
      const uint8_t *rows = glyph(ch);
      for (int r = 0; r < 7; r++)
        for (int k = 0; k < 5; k++)
          if (rows[r] & (16 >> k))
            o.set(SEG_X + c * 35 + r * 5 + k);
    }
  }
  void d7(int base, int n, char ch) {
    const uint8_t m = seg7(ch);
    for (int s = 0; s < 7; s++)
      if (m & (1 << s))
        o.set(base + n * 7 + s);
    if ((m & 0x80) && base == SEG_B && n == 5)
      o.set(SEG_B5W);
  }
  void t(int n, char ch) { d7(SEG_T, n, ch); }
  void b(int n, char ch) { d7(SEG_B, n, ch); }
};
// two-character number with optional pad (' ' or '0')
void two(int n, char pad, char out[3]) {
  if (n < 10) {
    out[0] = pad;
    out[1] = (char) ('0' + n);
  } else {
    out[0] = (char) ('0' + (n / 10) % 10);
    out[1] = (char) ('0' + n % 10);
  }
  out[2] = 0;
}
}  // namespace

// ------------------------------------------------------------------ calendar helpers (Hinnant)
int64_t Watch::days_from_civil(int y, int m, int d) {
  y -= m <= 2;
  const int64_t era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned) (y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + (int64_t) doe - 719468;
}
LocalTime Watch::parts(int64_t ms) {
  int64_t days = ms >= 0 ? ms / DAY : -((-ms + DAY - 1) / DAY);
  int64_t rem = ms - days * DAY;
  LocalTime t{};
  t.h = (int) (rem / HOUR);
  t.mi = (int) (rem % HOUR / MIN);
  t.s = (int) (rem % MIN / 1000);
  t.ms = (int) (rem % 1000);
  t.dow = (int) (((days % 7) + 11) % 7);  // 1970-01-01 was a Thursday (4)
  const int64_t z = days + 719468;
  const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned) (z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const int64_t y = (int64_t) yoe + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  t.d = (int) (doy - (153 * mp + 2) / 5 + 1);
  t.mo = (int) (mp < 10 ? mp + 3 : mp - 9);
  t.y = (int) (y + (t.mo <= 2));
  return t;
}
static int days_in_month(int y, int m) {
  return (int) (Watch::days_from_civil(m == 12 ? y + 1 : y, m == 12 ? 1 : m + 1, 1) - Watch::days_from_civil(y, m, 1));
}

int64_t Watch::today_local_(int64_t now) const {
  const int64_t l = local(now);
  return (l >= 0 ? l / DAY : -((-l + DAY - 1) / DAY)) * DAY;
}

// ------------------------------------------------------------------ astronomy caches
void Watch::update_current_(int64_t now) {
  const int64_t t = utc(now);
  const int64_t key = t / 1000;
  if (key == cur_key_ && cur_lat_ == s.lat && cur_lon_ == s.lon)
    return;
  cur_key_ = key;
  cur_lat_ = s.lat;
  cur_lon_ = s.lon;
  cur_phase_ = astro::phase_index(astro::moon_age((double) t));
  cur_hai_ = astro::hour_angle_index(astro::moon_hour_angle((double) t, s.lon));
}
const Watch::DayData &Watch::day_data_(int64_t day_local) {
  for (auto &c : cache_)
    if (c.day == day_local && c.lat == s.lat && c.lon == s.lon && c.tz == s.tz_min)
      return c;
  DayData &v = cache_[cache_next_];
  cache_next_ ^= 1;
  v.day = day_local;
  v.lat = s.lat;
  v.lon = s.lon;
  v.tz = s.tz_min;
  const double start = (double) (day_local - (int64_t) s.tz_min * MIN);
  v.age = astro::moon_age(start + 12 * HOUR);
  v.phase = astro::phase_index(v.age);
  astro::sun_rise_set(start, s.lat, s.lon, &v.rise, &v.set);
  const int hrs[4] = {18, 0, 6, 12};
  for (int i = 0; i < 4; i++)
    v.ev[i] = astro::moon_hour_angle_time(start, s.lon, hrs[i]);
  return v;
}

// ------------------------------------------------------------------ buttons
void Watch::press(Btn b, int64_t now, uint32_t rt) {
  last_use_ = rt;
  Held &h = held_[b];
  h = Held{};
  h.down = true;
  h.t = rt;
  h.last = rt;
  if (ring_) {
    stop_alarm_();
    h.consumed = true;
    if (b == BTN_L)
      snooze_(now);
    return;
  }
  if (demo_) {
    demo_ = false;
    h.consumed = true;
    return;
  }
  if (b == BTN_L) {
    emit_(EV_LIGHT);
    return;
  }
  handle_(b, now, rt, false);
}

void Watch::release(Btn b, int64_t now, uint32_t rt) {
  Held &h = held_[b];
  if (!h.down)
    return;
  const bool consumed = h.consumed;
  h.down = false;
  if (mode_ == M_ALM && set_ == SET_NONE && b == BTN_A && !consumed)
    emit_(EV_TEST_STOP);
  if ((mode_ == M_MOON || mode_ == M_SUN) && (b == BTN_A || b == BTN_D) && sel_valid_) {
    ready_wait_ = false;
    ready_at_ = rt + (s.authentic ? 20000 : 1800);
  }
}

void Watch::start_demo(uint32_t rt) {
  set_ = SET_NONE;
  mode_ = M_TIME;
  sel_valid_ = false;
  demo_ = true;
  demo_start_ = rt;
}

void Watch::tick(int64_t now, uint32_t rt) {
  for (int i = 0; i < BTN_COUNT; i++) {
    Held &h = held_[i];
    if (!h.down || h.consumed)
      continue;
    const uint32_t dt = rt - h.t;
    if (i == BTN_C && dt > 3000 && !h.demo) {
      h.demo = true;
      start_demo(rt);
      continue;
    }
    const bool repeatable = (i == BTN_A || i == BTN_D) && (set_ != SET_NONE || mode_ == M_MOON || mode_ == M_SUN);
    if (repeatable && dt > 800) {
      const uint32_t every = ((mode_ == M_MOON || mode_ == M_SUN) && set_ == SET_NONE) ? 140 : 110;
      if ((int32_t) (h.last - (h.t + 800)) < 0)
        h.last = h.t + 800 - every;
      int guard = 0;
      while ((int32_t) (rt - h.last) >= (int32_t) every && guard++ < 50) {
        h.last += every;
        handle_((Btn) i, now, rt, true);
      }
    }
  }
  if (set_ != SET_NONE && rt - last_use_ > 180000) {
    set_ = SET_NONE;
    if (mode_ != M_ALM)
      mode_ = M_TIME;
  }
  const int64_t loc = local(now);
  const LocalTime p = parts(loc);
  const int64_t sec_key = loc >= 0 ? loc / 1000 : -((-loc + 999) / 1000);
  if (last_sec_ != INT64_MIN && sec_key != last_sec_ && sec_key - last_sec_ < 5 && p.s == 0) {
    if (s.alarm_on && p.h == s.alarm_h && p.mi == s.alarm_m && set_ == SET_NONE)
      start_alarm_(rt);
    else if (snooze_pending_ && loc >= snooze_at_) {
      snooze_pending_ = false;
      start_alarm_(rt);
    }
    if (s.chime_on && p.mi == 0 && !ring_)
      emit_(EV_CHIME);
  }
  last_sec_ = sec_key;
  if (ring_ && (int32_t) (rt - ring_until_) > 0)
    stop_alarm_();
  if (sw_running_ && sw_elapsed_(rt) >= (uint32_t) DAY) {
    sw_acc_ = 0;
    sw_start_ = rt;
  }
}

void Watch::start_alarm_(uint32_t rt) {
  ring_ = true;
  ring_until_ = rt + 20000;
  emit_(EV_ALARM_START);
}
void Watch::stop_alarm_() {
  if (ring_) {
    ring_ = false;
    emit_(EV_ALARM_STOP);
  }
}
void Watch::snooze_(int64_t now) {
  const int64_t l = local(now);
  snooze_at_ = (l / MIN) * MIN + (int64_t) s.snooze_min * MIN;
  snooze_pending_ = true;
  emit_(EV_SNOOZE);
}

void Watch::next_mode_(int64_t now, uint32_t rt) {
  set_ = SET_NONE;
  if (after_op_ && mode_ != M_TIME) {
    after_op_ = false;
    enter_(M_TIME, now, rt);
    return;
  }
  after_op_ = false;
  enter_((Mode) ((mode_ + 1) % 5), now, rt);
}

void Watch::enter_(Mode m, int64_t now, uint32_t rt) {
  mode_ = m;
  sel_valid_ = false;
  if (m == M_MOON || m == M_SUN) {
    sel_valid_ = true;
    sel_day_ = today_local_(now);
    sel_changed_ = false;
    ready_wait_ = false;
    ready_at_ = rt + (s.authentic ? 3500 : 1600);
    cycle_at_ = ready_at_;
  }
}

void Watch::handle_(Btn b, int64_t now, uint32_t rt, bool repeat) {
  if (set_ == SET_TIME) {
    if (b == BTN_C)
      set_field_ = (set_field_ + 1) % 7;
    else if (b == BTN_B) {
      set_ = SET_LOC;
      set_field_ = 0;
    } else if (b == BTN_A)
      adjust_time_(set_field_, now);
    return;
  }
  if (set_ == SET_LOC) {
    if (b == BTN_C)
      set_field_ = (set_field_ + 1) % 3;
    else if (b == BTN_B) {
      set_ = SET_NONE;
      emit_(EV_SAVE);
    } else if (b == BTN_A || b == BTN_D) {
      const int dir = b == BTN_D ? 1 : -1;
      if (set_field_ == 0) {
        if (!synced_time) {
          int h = (int) std::lround(s.tz_min / 60.0) + (b == BTN_A ? 1 : -1);
          if (h > 14)
            h = -12;
          if (h < -12)
            h = 14;
          s.tz_min = h * 60;
        }
      } else if (set_field_ == 1) {
        int lo = (int) std::lround(s.lon) + dir;
        if (lo > 180)
          lo = -179;
        if (lo < -179)
          lo = 180;
        s.lon = (float) lo;
      } else {
        int la = (int) std::lround(s.lat) + dir;
        s.lat = (float) (la > 65 ? 65 : la < -65 ? -65 : la);
      }
      cur_key_ = INT64_MIN;
    }
    return;
  }
  if (set_ == SET_ALM) {
    if (b == BTN_C)
      set_field_ ^= 1;
    else if (b == BTN_B) {
      set_ = SET_NONE;
      after_op_ = true;
      emit_(EV_SAVE);
    } else if (b == BTN_A) {
      if (set_field_ == 0)
        s.alarm_h = (s.alarm_h + 1) % 24;
      else
        s.alarm_m = (s.alarm_m + 1) % 60;
    }
    return;
  }
  if (repeat && !(mode_ == M_MOON || mode_ == M_SUN))
    return;
  if (b == BTN_C) {
    next_mode_(now, rt);
    return;
  }
  switch (mode_) {
    case M_TIME:
      if (b == BTN_A) {
        s.h24 = !s.h24;
        emit_(EV_SAVE);
      } else if (b == BTN_B) {
        set_ = synced_time ? SET_LOC : SET_TIME;
        set_field_ = 0;
      } else if (b == BTN_D) {
        enter_(M_SUN, now, rt);
      }
      break;
    case M_MOON:
    case M_SUN:
      if (b == BTN_A || b == BTN_D) {
        sel_day_ += b == BTN_A ? DAY : -DAY;
        sel_changed_ = true;
        after_op_ = true;
        ready_wait_ = true;
      }
      break;
    case M_ALM:
      if (b == BTN_B) {
        set_ = SET_ALM;
        set_field_ = 0;
      } else if (b == BTN_D) {
        const int st = (s.alarm_on ? 1 : 0) + (s.chime_on ? 2 : 0), nx = (st + 1) % 4;
        s.alarm_on = nx & 1;
        s.chime_on = nx & 2;
        emit_(EV_SAVE);
      } else if (b == BTN_A) {
        emit_(EV_TEST_START);
      }
      break;
    case M_ST:
      if (b == BTN_A) {
        if (sw_running_) {
          sw_acc_ += rt - sw_start_;
          sw_running_ = false;
        } else {
          sw_start_ = rt;
          sw_running_ = true;
        }
        emit_(EV_KEY);
      } else if (b == BTN_D) {
        if (sw_split_)
          sw_split_ = false;
        else if (sw_running_) {
          sw_split_ = true;
          sw_split_val_ = sw_elapsed_(rt);
        } else {
          sw_acc_ = 0;
          sw_split_ = false;
        }
        emit_(EV_KEY);
      }
      break;
  }
}

void Watch::adjust_time_(int field, int64_t now) {
  if (field == 6) {
    s.dow_offset = (s.dow_offset + 1) % 7;
    emit_(EV_SAVE);
    return;
  }
  const int64_t loc = local(now);
  LocalTime p = parts(loc);
  int y = p.y, mo = p.mo, d = p.d, h = p.h, mi = p.mi, sec = p.s;
  if (field == 0) {
    if (sec >= 30)
      mi += 1;
    sec = 0;
  } else if (field == 1)
    h = (h + 1) % 24;
  else if (field == 2)
    mi = (mi + 1) % 60;
  else if (field == 3)
    y = y >= 2099 ? 2000 : y + 1;
  else if (field == 4)
    mo = mo % 12 + 1;
  else if (field == 5)
    d = d % days_in_month(y, mo) + 1;
  const int dim = days_in_month(y, mo);
  if (d > dim)
    d = dim;
  const int64_t target = days_from_civil(y, mo, d) * DAY + h * HOUR + mi * MIN + sec * 1000LL + (field == 0 ? 0 : p.ms);
  s.user_offset += target - loc;
  cur_key_ = INT64_MIN;
  emit_(EV_SAVE);
}

uint32_t Watch::sw_elapsed_(uint32_t rt) const { return sw_acc_ + (sw_running_ ? rt - sw_start_ : 0); }

int Watch::moon_cycle_(uint32_t rt) const {
  const uint32_t base = (int32_t) (cycle_at_ - ready_at_) > 0 ? cycle_at_ : ready_at_;
  const int32_t d = (int32_t) (rt - base);
  return d < 0 ? 0 : (d / 2000) % 4;
}

// ------------------------------------------------------------------ display
void Watch::segments(int64_t now, uint32_t rt, SegSet &o) {
  o.clear();
  Out out{o};
  bool any_ad = held_[BTN_A].down || held_[BTN_D].down;
  const bool blink = (rt % 1000) < 560 || any_ad;
  const int64_t loc = local(now);
  const LocalTime p = parts(loc);
  const int dow = (p.dow + s.dow_offset) % 7;
  char buf[3], buf2[3];

  auto big_hm = [&](int h, int mi, bool sh, bool sm) {
    int hh = h;
    bool pm = false;
    if (!s.h24) {
      pm = h >= 12;
      hh = h % 12 == 0 ? 12 : h % 12;
    }
    two(hh, ' ', buf);
    if (sh) {
      out.b(0, buf[0]);
      out.b(1, buf[1]);
    }
    if (sm) {
      two(mi, '0', buf2);
      out.b(2, buf2[0]);
      out.b(3, buf2[1]);
    }
    if (pm)
      o.set(SEG_PM);
    if (s.h24)
      o.set(SEG_H24);
    o.set(SEG_BCOL);
  };
  auto small_md = [&](int mo, int d) {
    two(mo, ' ', buf);
    two(d, ' ', buf2);
    out.t(0, buf[0]);
    out.t(1, buf[1]);
    o.set(SEG_TDASH);
    out.t(2, buf2[0]);
    out.t(3, buf2[1]);
  };
  auto secs = [&](int sec) {
    two(sec, '0', buf);
    out.b(4, buf[0]);
    out.b(5, buf[1]);
  };
  auto icons = [&]() {
    if (s.alarm_on)
      o.set(SEG_ALM);
    if (s.chime_on)
      o.set(SEG_CHM);
  };
  auto age_dm = [&](double age) {
    const double a = std::floor(age * 10 + 1e-6) / 10;
    const int whole = (int) a, tenth = (int) std::lround((a - whole) * 10) % 10;
    char str[4];
    if (whole < 10) {
      str[0] = ' ';
      str[1] = (char) ('0' + whole);
    } else {
      str[0] = (char) ('0' + (whole / 10) % 10);
      str[1] = (char) ('0' + whole % 10);
    }
    str[2] = (char) ('0' + tenth);
    str[3] = 0;
    out.dm(str);
    o.set(SEG_XDP);
  };

  // ---------------- moon graph
  update_current_(now);
  int ph = -1, hai = -1;
  bool suns = false;
  if (demo_) {
    // one tick = 1/8 s: the marker laps 24 steps (13 sky positions, nadir mark alone at step 18),
    // the phase advances every second tick
    const int k = (int) ((rt - demo_start_) / 125), lap = k % 24;
    ph = (k >> 1) % 9;
    hai = lap < 13 ? lap : lap == 18 ? 13 : -1;
  } else if (set_ == SET_TIME || set_ == SET_LOC) {
    ph = -1;
  } else if ((mode_ == M_MOON || mode_ == M_SUN) && sel_valid_) {
    const bool ready = !ready_wait_ && (int32_t) (rt - ready_at_) >= 0;
    if (mode_ == M_SUN)
      suns = true;
    if (ready) {
      ph = day_data_(sel_day_).phase;
      if (mode_ == M_MOON) {
        static const int HA[4] = {0, 6, 12, 13};
        hai = HA[moon_cycle_(rt)];
      }
    }
  } else {
    ph = cur_phase_;
    hai = cur_hai_;
  }
  if (ph >= 0)
    o.set(SEG_P + ph);
  if (hai == 13) {
    o.set(SEG_HN);
  } else if (hai >= 0) {
    o.set(SEG_H + hai);
    if (ph >= 0)
      o.set(SEG_R + ph);
  }
  if (suns) {
    o.set(SEG_SUNE);
    o.set(SEG_SUNW);
  }
  // star field: redrawn every second, in every mode, from the ones digit of the running seconds
  // (bit k = star k; table read off the real module)
  static const uint32_t STARS[10] = {0x37f8f, 0x3367e, 0x2ee4d, 0x2a2bc, 0x27a8b,
                                     0x2317a, 0x1e949, 0x185b8, 0x15d87, 0x11476};
  for (uint32_t k = 0, m = STARS[p.s % 10]; k < 18; k++)
    if ((m >> k) & 1u)
      o.set(SEG_S + k);

  // ---------------- LCD
  if (set_ == SET_TIME) {
    const int f = set_field_;
    if (f == 6) {
      if (blink)
        out.dm(DOW[dow]);
    } else if (f != 3 || blink) {
      char y[4] = {'\'', (char) ('0' + (p.y % 100) / 10), (char) ('0' + p.y % 10), 0};
      out.dm(y);
    }
    two(p.mo, ' ', buf);
    two(p.d, ' ', buf2);
    if (f != 4 || blink) {
      out.t(0, buf[0]);
      out.t(1, buf[1]);
    }
    o.set(SEG_TDASH);
    if (f != 5 || blink) {
      out.t(2, buf2[0]);
      out.t(3, buf2[1]);
    }
    big_hm(p.h, p.mi, f != 1 || blink, f != 2 || blink);
    if (f != 0 || blink)
      secs(p.s);
    return;
  }
  if (set_ == SET_LOC) {
    const int f = set_field_;
    if (f == 0) {
      out.dm("GMT");
      if (blink || synced_time) {
        const int tz = s.tz_min, a = std::abs(tz), h = a / 60, m = a % 60;
        if (m == 0) {
          if (tz < 0)
            o.set(SEG_TDASH);
          two(h, ' ', buf);
          out.t(2, buf[0]);
          out.t(3, buf[1]);
        } else {
          if (tz < 0)
            out.t(0, '-');
          out.t(1, (char) ('0' + h % 10));
          o.set(SEG_TCOL);
          two(m, '0', buf);
          out.t(2, buf[0]);
          out.t(3, buf[1]);
        }
      }
      big_hm(p.h, p.mi, true, true);
      secs(p.s);
    } else {
      out.dm(f == 1 ? "LO " : "LA ");
      if (f != 2 || blink) {
        two((int) std::lround(std::fabs(s.lat)), ' ', buf);
        out.t(0, buf[0]);
        out.t(1, buf[1]);
        out.t(3, s.lat >= 0 ? 'n' : 'S');
      }
      if (f != 1 || blink) {
        const int lo = (int) std::lround(std::fabs(s.lon));
        const char c0 = lo >= 100 ? (char) ('0' + lo / 100) : ' ';
        const char c1 = lo >= 10 ? (char) ('0' + (lo / 10) % 10) : ' ';
        out.b(1, c0);
        out.b(2, c1);
        out.b(3, (char) ('0' + lo % 10));
        out.b(5, (s.lon >= 0 || lo == 180) ? 'E' : 'W');
      }
    }
    return;
  }

  switch (mode_) {
    case M_TIME: {
      out.dm(DOW[dow]);
      small_md(p.mo, p.d);
      big_hm(p.h, p.mi, true, true);
      secs(p.s);
      icons();
      for (int i = 0; i <= p.s && i < 60; i++)
        o.set(SEG_Q + i);
      break;
    }
    case M_MOON:
    case M_SUN: {
      const LocalTime dp = parts(sel_day_);
      const bool ready = !ready_wait_ && (int32_t) (rt - ready_at_) >= 0;
      if (!ready) {
        out.dm(DOW[(dp.dow + s.dow_offset) % 7]);
        small_md(dp.mo, dp.d);
        two(dp.y % 100, '0', buf);
        out.b(4, buf[0]);
        out.b(5, buf[1]);
        break;
      }
      const DayData &dd = day_data_(sel_day_);
      age_dm(dd.age);
      o.set(SEG_LAGE);
      if (mode_ == M_MOON) {
        small_md(dp.mo, dp.d);
        const int k = moon_cycle_(rt);
        const int64_t t = dd.ev[k];
        o.set(SEG_LMOON);
        if (t == astro::NO_EVENT) {
          out.b(1, '-');
          o.set(SEG_BCOL);
          out.b(2, '-');
          out.b(3, '-');
        } else {
          const LocalTime q = parts(astro::round5(t) + (int64_t) s.tz_min * MIN);
          big_hm(q.h, q.mi, true, true);
        }
        out.b(4, '-');
        out.b(5, (char) ('1' + k));
      } else {
        o.set(SEG_LRISE);
        o.set(SEG_LSET);
        if (dd.rise == astro::NO_EVENT) {
          out.t(1, '-');
          o.set(SEG_TCOL);
          out.t(2, '-');
          out.t(3, '-');
        } else {
          const LocalTime q = parts(astro::round5(dd.rise) + (int64_t) s.tz_min * MIN);
          int hh = q.h;
          if (!s.h24)
            hh = hh % 12 == 0 ? 12 : hh % 12;
          two(hh, ' ', buf);
          two(q.mi, '0', buf2);
          out.t(0, buf[0]);
          out.t(1, buf[1]);
          o.set(SEG_TCOL);
          out.t(2, buf2[0]);
          out.t(3, buf2[1]);
        }
        if (dd.set == astro::NO_EVENT) {
          out.b(1, '-');
          o.set(SEG_BCOL);
          out.b(2, '-');
          out.b(3, '-');
        } else {
          const LocalTime q = parts(astro::round5(dd.set) + (int64_t) s.tz_min * MIN);
          big_hm(q.h, q.mi, true, true);
        }
      }
      break;
    }
    case M_ALM: {
      out.dm("ALM");
      icons();
      const int f = set_ == SET_ALM ? set_field_ : -1;
      big_hm(s.alarm_h, s.alarm_m, f != 0 || blink, f != 1 || blink);
      break;
    }
    case M_ST: {
      const uint32_t el = sw_split_ ? sw_split_val_ : sw_elapsed_(rt);
      out.dm(sw_split_ ? "SPL" : "ST ");
      two((int) ((el / 10) % 100), '0', buf);
      out.t(2, buf[0]);
      out.t(3, buf[1]);
      two((int) ((el / 3600000UL) % 24), ' ', buf);
      out.b(0, buf[0]);
      out.b(1, buf[1]);
      o.set(SEG_BCOL);
      two((int) ((el / 60000UL) % 60), '0', buf);
      out.b(2, buf[0]);
      out.b(3, buf[1]);
      secs((int) ((el / 1000) % 60));
      icons();
      break;
    }
  }
}

}  // namespace selene
}  // namespace esphome

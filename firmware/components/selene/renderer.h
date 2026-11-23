#pragma once
// Selene renderer: composites pre-rendered face assets (background + per-segment sprites)
// and pushes only the regions whose segments changed. Logical space is the face's
// native square (e.g. 720x720); optional 90/180/270° rotation is applied on push.
#include <cstdint>
#include <vector>
#include "face_types.h"
#include "watch.h"

namespace esphome {
namespace display {
class Display;
}
namespace selene {

class Renderer {
 public:
  using Push = void (*)(void *ctx, int x, int y, int w, int h, const uint16_t *px);

  // push(ctx, x, y, w, h, pixels) receives RGB565 little-endian blocks in panel coordinates.
  void begin(Push push, void *ctx, int rotation);
  bool set_face(const FaceDef *face);  // decodes assets into PSRAM; next render is a full redraw
  const FaceDef *face() const { return face_; }
  // Draw `lit`. Returns number of pixels pushed (0 if nothing changed).
  uint32_t render(const SegSet &lit);
  void invalidate() { full_ = true; }
  uint32_t last_render_us() const { return last_us_; }

 protected:
  struct Rect {
    int x0, y0, x1, y1;  // half-open
  };
  void compose_(const Rect &r, const SegSet &lit, const std::vector<int> &cand);
  void push_(int x, int y, int w, int h, const uint16_t *px);

  const FaceDef *face_{nullptr};
  uint16_t *bg_{nullptr};
  uint8_t *masks_{nullptr};
  size_t bg_cap_{0}, masks_cap_{0};
  uint16_t *band_{nullptr};
  uint16_t *rot_{nullptr};
  int band_rows_{0};
  int size_{720};
  int rotation_{0};
  bool full_{true};
  SegSet shown_;
  Push push_fn_{nullptr};
  void *push_ctx_{nullptr};
  uint32_t last_us_{0};
};

// Minimal LZ4 block decoder (raw block, no frame). Returns true if exactly out_len bytes were produced.
bool lz4_decode(const uint8_t *src, size_t src_len, uint8_t *dst, size_t out_len);

}  // namespace selene
}  // namespace esphome

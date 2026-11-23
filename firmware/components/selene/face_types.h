#pragma once
// Face asset layout produced by tools/pack_faces.py.
#include <cstdint>

namespace esphome {
namespace selene {

struct RowSpan {
  uint32_t off;  // pixel offset of this row's span in bg[]
  uint16_t x0;   // first visible x (dial circle)
  uint16_t n;    // visible pixels
};

struct SpriteDef {
  uint16_t x, y, w, h;  // bbox incl. aura margin, in panel pixels
  uint32_t off;         // byte offset into masks[] (2 bytes per pixel: body, aura)
  uint8_t cls;          // 0 = LCD segment, 1 = moon-graph segment, 2 = star
};

struct FaceDef {
  const char *id;
  const char *name;
  uint16_t size;
  const uint8_t *bg_lz4;  // LZ4 block: RGB565 little-endian row spans (see rows)
  uint32_t bg_lz4_len;
  uint32_t bg_len;
  const RowSpan *rows;
  const SpriteDef *sprites;  // indexed by logical segment; w == 0 → not on this face
  const uint8_t *masks_lz4;  // LZ4 block: interleaved [body, aura] coverage per sprite pixel
  uint32_t masks_lz4_len;
  uint32_t masks_len;
  uint16_t on[3];    // RGB565 lit colour per class
  uint16_t aura[3];  // RGB565 shadow/glow colour per class
};

}  // namespace selene
}  // namespace esphome

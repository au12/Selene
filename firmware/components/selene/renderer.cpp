#include "renderer.h"
#include <algorithm>
#include <cstdlib>
#include <cstring>

#ifdef USE_ESP32
#include "esphome/core/hal.h"
#include "esphome/core/helpers.h"
#else
#include <chrono>
#endif

namespace esphome {
namespace selene {

namespace {
constexpr int BAND_ROWS = 48;

#ifdef USE_ESP32
template<typename T> T *alloc_ext(size_t n) {
  RAMAllocator<T> a(RAMAllocator<T>::ALLOC_EXTERNAL);
  return a.allocate(n);
}
template<typename T> T *alloc_int(size_t n) {
  RAMAllocator<T> a(RAMAllocator<T>::ALLOC_INTERNAL);
  T *p = a.allocate(n);
  if (p == nullptr) {
    RAMAllocator<T> b;
    p = b.allocate(n);
  }
  return p;
}
inline uint32_t now_us() { return micros(); }
#else
template<typename T> T *alloc_ext(size_t n) { return static_cast<T *>(malloc(n * sizeof(T))); }
template<typename T> T *alloc_int(size_t n) { return static_cast<T *>(malloc(n * sizeof(T))); }
inline uint32_t now_us() {
  return (uint32_t) std::chrono::duration_cast<std::chrono::microseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
#endif

// RGB565 alpha blend (a: 0..255)
inline uint16_t blend565(uint16_t dst, uint16_t src, uint32_t a) {
  if (a == 0)
    return dst;
  if (a >= 250)
    return src;
  const uint32_t a5 = (a + 4) >> 3;  // 0..32
  const uint32_t d = (dst | ((uint32_t) dst << 16)) & 0x07E0F81Fu;
  const uint32_t s = (src | ((uint32_t) src << 16)) & 0x07E0F81Fu;
  const uint32_t r = ((s * a5 + d * (32 - a5)) >> 5) & 0x07E0F81Fu;
  return (uint16_t) (r | (r >> 16));
}
}  // namespace

bool lz4_decode(const uint8_t *src, size_t src_len, uint8_t *dst, size_t out_len) {
  const uint8_t *ip = src, *const iend = src + src_len;
  uint8_t *op = dst, *const oend = dst + out_len;
  while (ip < iend) {
    const uint8_t token = *ip++;
    size_t lit = token >> 4;
    if (lit == 15) {
      uint8_t b;
      do {
        if (ip >= iend)
          return false;
        b = *ip++;
        lit += b;
      } while (b == 255);
    }
    if ((size_t) (iend - ip) < lit || (size_t) (oend - op) < lit)
      return false;
    memcpy(op, ip, lit);
    ip += lit;
    op += lit;
    if (ip >= iend)
      break;  // last sequence carries literals only
    if (iend - ip < 2)
      return false;
    const size_t off = ip[0] | ((size_t) ip[1] << 8);
    ip += 2;
    if (off == 0 || (size_t) (op - dst) < off)
      return false;
    size_t mlen = token & 15;
    if (mlen == 15) {
      uint8_t b;
      do {
        if (ip >= iend)
          return false;
        b = *ip++;
        mlen += b;
      } while (b == 255);
    }
    mlen += 4;
    if ((size_t) (oend - op) < mlen)
      return false;
    const uint8_t *m = op - off;
    if (off >= mlen) {
      memcpy(op, m, mlen);
      op += mlen;
    } else {
      while (mlen--)
        *op++ = *m++;
    }
  }
  return op == oend;
}

void Renderer::begin(Push push, void *ctx, int rotation) {
  push_fn_ = push;
  push_ctx_ = ctx;
  rotation_ = ((rotation % 360) + 360) % 360;
}

bool Renderer::set_face(const FaceDef *face) {
  if (face == nullptr)
    return false;
  if (face->bg_len > bg_cap_) {
    free(bg_);  // NOLINT
    bg_ = alloc_ext<uint16_t>(face->bg_len / 2 + 1);
    bg_cap_ = bg_ ? face->bg_len : 0;
  }
  if (face->masks_len > masks_cap_) {
    free(masks_);  // NOLINT
    masks_ = alloc_ext<uint8_t>(face->masks_len + 1);
    masks_cap_ = masks_ ? face->masks_len : 0;
  }
  if (bg_ == nullptr || masks_ == nullptr)
    return false;
  if (!lz4_decode(face->bg_lz4, face->bg_lz4_len, reinterpret_cast<uint8_t *>(bg_), face->bg_len))
    return false;
  if (!lz4_decode(face->masks_lz4, face->masks_lz4_len, masks_, face->masks_len))
    return false;
  if (size_ != face->size || band_ == nullptr) {
    size_ = face->size;
    free(band_);  // NOLINT
    free(rot_);   // NOLINT
    band_rows_ = BAND_ROWS;
    band_ = alloc_int<uint16_t>((size_t) size_ * band_rows_);
    rot_ = rotation_ ? alloc_int<uint16_t>((size_t) size_ * band_rows_) : nullptr;
    if (band_ == nullptr || (rotation_ && rot_ == nullptr))
      return false;
  }
  face_ = face;
  full_ = true;
  return true;
}

void Renderer::push_(int x, int y, int w, int h, const uint16_t *px) {
  if (push_fn_ == nullptr)
    return;
  if (rotation_ == 0) {
    push_fn_(push_ctx_, x, y, w, h, px);
    return;
  }
  const int S = size_;
  // rotate the w x h block (row-major) into rot_ and map the rectangle
  int px0, py0, pw, ph;
  if (rotation_ == 180) {
    px0 = S - (x + w);
    py0 = S - (y + h);
    pw = w;
    ph = h;
    for (int j = 0; j < h; j++)
      for (int i = 0; i < w; i++)
        rot_[(h - 1 - j) * w + (w - 1 - i)] = px[j * w + i];
  } else if (rotation_ == 90) {  // clockwise: (lx,ly) -> (S-1-ly, lx)
    px0 = S - (y + h);
    py0 = x;
    pw = h;
    ph = w;
    for (int j = 0; j < h; j++)
      for (int i = 0; i < w; i++)
        rot_[i * pw + (h - 1 - j)] = px[j * w + i];
  } else {  // 270: (lx,ly) -> (ly, S-1-lx)
    px0 = y;
    py0 = S - (x + w);
    pw = h;
    ph = w;
    for (int j = 0; j < h; j++)
      for (int i = 0; i < w; i++)
        rot_[(w - 1 - i) * pw + j] = px[j * w + i];
  }
  push_fn_(push_ctx_, px0, py0, pw, ph, rot_);
}

void Renderer::compose_(const Rect &r, const SegSet &lit, const std::vector<int> &cand) {
  const FaceDef &F = *face_;
  const int w = r.x1 - r.x0;
  for (int y0 = r.y0; y0 < r.y1; y0 += band_rows_) {
    const int y1 = std::min(r.y1, y0 + band_rows_);
    // background
    for (int y = y0; y < y1; y++) {
      uint16_t *row = band_ + (y - y0) * w;
      const RowSpan &rs = F.rows[y];
      const int sx0 = rs.x0, sx1 = rs.x0 + rs.n;
      const int a = std::max(r.x0, sx0), b = std::min(r.x1, sx1);
      if (a >= b) {
        memset(row, 0, w * 2);
        continue;
      }
      if (a > r.x0)
        memset(row, 0, (a - r.x0) * 2);
      memcpy(row + (a - r.x0), bg_ + rs.off + (a - sx0), (b - a) * 2);
      if (b < r.x1)
        memset(row + (b - r.x0), 0, (r.x1 - b) * 2);
    }
    // two passes: auras (shadow / glow) first, then segment bodies
    for (int pass = 1; pass >= 0; pass--) {
      for (int si : cand) {
        if (!lit.get(si))
          continue;
        const SpriteDef &sp = F.sprites[si];
        const int ax = std::max(r.x0, (int) sp.x), bx = std::min(r.x1, (int) (sp.x + sp.w));
        const int ay = std::max(y0, (int) sp.y), by = std::min(y1, (int) (sp.y + sp.h));
        if (ax >= bx || ay >= by)
          continue;
        const uint16_t col = pass ? F.aura[sp.cls] : F.on[sp.cls];
        for (int y = ay; y < by; y++) {
          const uint8_t *m = masks_ + sp.off + (((size_t) (y - sp.y) * sp.w + (ax - sp.x)) << 1) + pass;
          uint16_t *dst = band_ + (y - y0) * w + (ax - r.x0);
          for (int x = ax; x < bx; x++, m += 2, dst++)
            if (*m)
              *dst = blend565(*dst, col, *m);
        }
      }
    }
    push_(r.x0, y0, w, y1 - y0, band_);
  }
}

uint32_t Renderer::render(const SegSet &lit) {
  if (face_ == nullptr || band_ == nullptr)
    return 0;
  const uint32_t t0 = now_us();
  const FaceDef &F = *face_;
  std::vector<Rect> rects;
  if (full_) {
    rects.push_back({0, 0, size_, size_});
  } else {
    for (int i = 0; i < SEG_COUNT; i++) {
      if (lit.get(i) == shown_.get(i))
        continue;
      const SpriteDef &sp = F.sprites[i];
      if (sp.w == 0)
        continue;
      rects.push_back({sp.x, sp.y, sp.x + sp.w, sp.y + sp.h});
    }
    if (rects.empty()) {
      shown_ = lit;
      return 0;
    }
    // merge overlapping / near rectangles (keeps the number of pushes small)
    bool merged = true;
    while (merged) {
      merged = false;
      for (size_t i = 0; i < rects.size() && !merged; i++)
        for (size_t j = i + 1; j < rects.size(); j++) {
          Rect &a = rects[i], &b = rects[j];
          if (a.x0 <= b.x1 + 6 && b.x0 <= a.x1 + 6 && a.y0 <= b.y1 + 6 && b.y0 <= a.y1 + 6) {
            a = {std::min(a.x0, b.x0), std::min(a.y0, b.y0), std::max(a.x1, b.x1), std::max(a.y1, b.y1)};
            rects.erase(rects.begin() + j);
            merged = true;
            break;
          }
        }
    }
  }
  uint32_t pixels = 0;
  std::vector<int> cand;
  for (Rect r : rects) {
    // even alignment (DSI driver draw rounding) and clamp
    r.x0 = std::max(0, r.x0 & ~1);
    r.y0 = std::max(0, r.y0 & ~1);
    r.x1 = std::min(size_, (r.x1 + 1) & ~1);
    r.y1 = std::min(size_, (r.y1 + 1) & ~1);
    if (r.x0 >= r.x1 || r.y0 >= r.y1)
      continue;
    cand.clear();
    for (int i = 0; i < SEG_COUNT; i++) {
      if (!lit.get(i))
        continue;
      const SpriteDef &sp = F.sprites[i];
      if (sp.w && sp.x < r.x1 && sp.x + sp.w > r.x0 && sp.y < r.y1 && sp.y + sp.h > r.y0)
        cand.push_back(i);
    }
    compose_(r, lit, cand);
    pixels += (uint32_t) (r.x1 - r.x0) * (r.y1 - r.y0);
  }
  shown_ = lit;
  full_ = false;
  last_us_ = now_us() - t0;
  return pixels;
}

}  // namespace selene
}  // namespace esphome

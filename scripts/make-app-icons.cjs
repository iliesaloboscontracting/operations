// Makes the phone home-screen icons from the Lobos wolf (public/brand/
// lobos-wolf.png - the wolf on black, cleaned up 22 Oct 2026 from the
// artwork Ilies supplied), with no image library needed: the wolf on black,
// rising from the bottom edge so phones can round or circle-crop the corners.
//   Lobos Ops  (office)      -> public/icons/ops-*.png
//   Lobos Site (supervisors) -> public/site/icons/site-*.png  (photos address)
// Re-run after changing the artwork:  node scripts/make-app-icons.cjs
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---- minimal PNG decode (8-bit RGBA, non-interlaced) ----
function decode(file) {
  const b = fs.readFileSync(file);
  let w = 0, h = 0, idat = [];
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o), type = b.toString("ascii", o + 4, o + 8), data = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error("logo must be 8-bit RGBA, non-interlaced");
    } else if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4), stride = w * 4;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0, up = y ? px[(y - 1) * stride + x] : 0, ul = y && x >= 4 ? px[(y - 1) * stride + x - 4] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, px };
}

// ---- PNG encode (RGBA) ----
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function encode(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const FRAME_BLUE = [0x66, 0xae, 0xe2]; // the outline colour in Ilies's artwork

// The wolf's own outline in the artwork (anything brighter than near-black).
function bounds(art) {
  let x0 = art.w, y0 = art.h, x1 = 0, y1 = 0;
  for (let y = 0; y < art.h; y++)
    for (let x = 0; x < art.w; x++) {
      const i = (y * art.w + x) * 4;
      if (Math.max(art.px[i], art.px[i + 1], art.px[i + 2]) > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
  return { x0, y0, x1, y1 };
}

// style "frame": a rounded blue frame like the artwork, the wolf standing on
//   its inner bottom edge (iPhone, browser tab, notifications, Android "any").
// style "ring": the blue as a circle inside Android's safe zone, wolf cut off
//   by the circle the same way - whatever shape the phone crops to (maskable).
function icon(art, size, style) {
  const px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) px[i * 4 + 3] = 255; // black
  const c = size / 2, stroke = size * 0.03;
  // Inside-the-frame test (inner edge) and "on the blue line" coverage.
  let inner, onLine, wolfH, wolfBottom;
  if (style === "frame") {
    const inset = size * 0.035, rad = size * 0.2;
    const sdf = (x, y, grow) => {
      const hw = c - inset + grow, r = rad + grow;
      const qx = Math.abs(x - c) - (hw - r), qy = Math.abs(y - c) - (hw - r);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    };
    inner = (x, y) => sdf(x, y, -stroke) < 0;
    onLine = (x, y) => sdf(x, y, 0) < 0 && sdf(x, y, -stroke) >= 0;
    wolfH = size * 0.8;
    wolfBottom = size - inset - stroke;
  } else {
    const rOut = size * 0.39, rIn = rOut - stroke;
    inner = (x, y) => Math.hypot(x - c, y - c) < rIn;
    onLine = (x, y) => { const d = Math.hypot(x - c, y - c); return d < rOut && d >= rIn; };
    wolfH = size * 0.6;
    wolfBottom = c + rIn;
  }
  const { x0, y0, x1, y1 } = bounds(art);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, scale = wolfH / ch;
  const dw = cw * scale, ox = (size - dw) / 2, oy = wolfBottom - wolfH;
  const sample = (x, y) => {
    // artwork colour at icon point (x, y), nearest pixel; black outside the wolf box
    const ax = Math.floor(x0 + (x - ox) / scale), ay = Math.floor(y0 + (y - oy) / scale);
    if (ax < x0 || ax > x1 || ay < y0 || ay > y1) return [0, 0, 0];
    const i = (ay * art.w + ax) * 4;
    return [art.px[i], art.px[i + 1], art.px[i + 2]];
  };
  const N = 4; // 4x4 samples per pixel - smooth edges
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < N; sy++)
        for (let sx = 0; sx < N; sx++) {
          const px_ = x + (sx + 0.5) / N, py_ = y + (sy + 0.5) / N;
          const col = onLine(px_, py_) ? FRAME_BLUE : inner(px_, py_) ? sample(px_, py_) : [0, 0, 0];
          r += col[0]; g += col[1]; b += col[2];
        }
      const o = (y * size + x) * 4, n = N * N;
      px[o] = Math.round(r / n); px[o + 1] = Math.round(g / n); px[o + 2] = Math.round(b / n);
    }
  return encode(size, size, px);
}

const root = path.join(__dirname, "..", "public");
const art = decode(path.join(root, "brand", "lobos-wolf.png"));
for (const [dir, name] of [["icons", "ops"], [path.join("site", "icons"), "site"]]) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const size of [180, 192, 512]) fs.writeFileSync(path.join(root, dir, `${name}-${size}.png`), icon(art, size, "frame"));
  fs.writeFileSync(path.join(root, dir, `${name}-maskable-512.png`), icon(art, 512, "ring"));
}
console.log("icons written");

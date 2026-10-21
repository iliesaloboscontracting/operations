// Makes the phone home-screen icons from public/logo.png (no image library
// needed): the Lobos logo centred on the app's dark background, with a
// coloured stripe so the two apps are easy to tell apart -
//   Lobos Ops  (office, Ilies)  - blue stripe   -> public/icons/ops-*.png
//   Lobos Site (supervisors)    - amber stripe  -> public/site/icons/site-*.png
// Re-run after changing the logo:  node scripts/make-app-icons.cjs
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

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
function icon(logo, size, stripe) {
  const bg = hex("#0E1115"), st = hex(stripe), px = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) px.set([...bg, 255], i * 4);
  // Stripe across the lower part - inside the "maskable" safe zone.
  const sy0 = Math.round(size * 0.66), sy1 = Math.round(size * 0.7);
  for (let y = sy0; y < sy1; y++) for (let x = Math.round(size * 0.2); x < Math.round(size * 0.8); x++) px.set([...st, 255], (y * size + x) * 4);
  // Logo at 64% of the width, centred a little above the middle; area-averaged scaling.
  const lw = Math.round(size * 0.64), lh = Math.round((lw * logo.h) / logo.w);
  const ox = Math.round((size - lw) / 2), oy = Math.round(size * 0.47 - lh / 2), sx = logo.w / lw, sy = logo.h / lh;
  for (let y = 0; y < lh; y++)
    for (let x = 0; x < lw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.min(logo.h, Math.ceil((y + 1) * sy)); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.min(logo.w, Math.ceil((x + 1) * sx)); xx++) {
          const i = (yy * logo.w + xx) * 4, al = logo.px[i + 3];
          r += logo.px[i] * al; g += logo.px[i + 1] * al; b += logo.px[i + 2] * al; a += al; n++;
        }
      if (!a) continue;
      const alpha = a / n / 255, o = ((oy + y) * size + ox + x) * 4;
      px[o] = Math.round(px[o] * (1 - alpha) + (r / a) * alpha);
      px[o + 1] = Math.round(px[o + 1] * (1 - alpha) + (g / a) * alpha);
      px[o + 2] = Math.round(px[o + 2] * (1 - alpha) + (b / a) * alpha);
    }
  return encode(size, size, px);
}

const root = path.join(__dirname, "..", "public");
const logo = decode(path.join(root, "logo.png"));
for (const [dir, name, stripe] of [["icons", "ops", "#4F8FD1"], [path.join("site", "icons"), "site", "#F59E0B"]]) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const size of [180, 192, 512]) fs.writeFileSync(path.join(root, dir, `${name}-${size}.png`), icon(logo, size, stripe));
}
console.log("icons written");

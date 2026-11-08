/* 纯 Node PNG 解码 + 数"水色"像素。用于在无法看图时用数字确认水面是否真的渲染出来。
   用法：node _pngstat.js a.png b.png ... */
const fs = require('fs'), zlib = require('zlib');

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let p = 8; // skip signature
  let w = 0, h = 0, bd = 0, ct = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('bitdepth ' + bd + ' unsupported');
  const ch = ct === 0 ? 1 : ct === 2 ? 3 : ct === 4 ? 2 : ct === 6 ? 4 : 0;
  if (!ch) throw new Error('colortype ' + ct + ' unsupported');
  if (interlace) throw new Error('interlaced unsupported');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * ch);
  const paeth = (a, b, c) => { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const rowStart = y * stride, prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const rawv = raw[pos++];
      const a = x >= ch ? out[rowStart + x - ch] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = (x >= ch && y > 0) ? out[prevStart + x - ch] : 0;
      let v;
      if (ft === 0) v = rawv;
      else if (ft === 1) v = rawv + a;
      else if (ft === 2) v = rawv + b;
      else if (ft === 3) v = rawv + ((a + b) >> 1);
      else v = rawv + paeth(a, b, c);
      out[rowStart + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}

for (const f of process.argv.slice(2)) {
  try {
    const { w, h, ch, data } = decodePNG(f);
    let water = 0, sky = 0, green = 0, total = w * h;
    for (let i = 0, n = w * h; i < n; i++) {
      const r = data[i * ch], g = data[i * ch + 1], b = data[i * ch + 2];
      const avg = (r + g + b) / 3;
      // 水色：蓝>红、偏冷、中低亮度（排除雾天高亮天空）
      if (b > r + 12 && b >= g - 4 && avg < 165 && b > 45) water++;
      // 天空/雾：很亮、各通道接近
      if (avg > 190 && Math.abs(r - b) < 25) sky++;
      // 草色：绿通道明显占优（草墩/草洲/岸边草）
      if (g > r + 6 && g > b + 8) green++;
    }
    // 交错度：把画面切成 32px 小块，数"既有水又有草"的块 —— 用来判断草是不是长在水中间，
    // 而不是草在岸上、水在另一头各占半边。
    const BS = 32, cols = Math.ceil(w / BS), rows = Math.ceil(h / BS);
    const bw = new Int32Array(cols * rows), bg = new Int32Array(cols * rows);
    let blocksWet = 0, blocksMix = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = ((y * w) + x) * ch;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const avg = (r + g + b) / 3;
      const isW = b > r + 12 && b >= g - 4 && avg < 165 && b > 45;
      const isG = g > r + 6 && g > b + 8;
      const bi = Math.floor(y / BS) * cols + Math.floor(x / BS);
      if (isW) bw[bi]++; if (isG) bg[bi]++;
    }
    const per = BS * BS / 4;   // 每块采样点数（步长 2）
    for (let k = 0; k < bw.length; k++) {
      const wr = bw[k] / per, gr = bg[k] / per;
      if (wr > 0.12) { blocksWet++; if (gr > 0.05) blocksMix++; }
    }
    console.log(f.split(/[\\/]/).pop(), `${w}x${h}`,
      'water%=' + (water / total * 100).toFixed(2),
      'green%=' + (green / total * 100).toFixed(2),
      'mixBlocks%=' + (blocksWet ? (blocksMix / blocksWet * 100).toFixed(1) : '0'),
      'sky%=' + (sky / total * 100).toFixed(1));
  } catch (e) { console.log(f, 'ERR', e.message); }
}

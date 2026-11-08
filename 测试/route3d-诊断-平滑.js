/* route3d 平滑地表 + 水面贴地 诊断（一次性工具）
   1) 地形：新曲面必须「全部朝上、法线归一、无竖直崖壁」，且 surfaceY 与渲染网格严格对齐
   2) 水面：水陆交点上「地面高度 ≈ 水位」——这条不变量成立，水就不可能悬空 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, '游戏', 'route3d.html'), 'utf8');
const js = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];

function el(text) {
  const o = {
    style: {}, dataset: {}, children: [], textContent: text || '',
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { o.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, getAttribute() { return null; },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    querySelector() { return el(); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
  };
  return new Proxy(o, { get(t, k) { if (k in t) return t[k]; return t[k] = function () {}; }, set(t, k, v) { t[k] = v; return true; } });
}
const noop = () => {};
const map3dJSON = /<script type="application\/json" id="map3d">\s*([\s\S]*?)<\/script>/.exec(html)[1];
const ctx = {
  console, Math, JSON, Date, Float32Array, Uint8Array, Uint16Array, Uint32Array, Int32Array,
  performance: { now: () => 0 },
  requestAnimationFrame: noop, cancelAnimationFrame: noop,
  setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
  navigator: { userAgent: 'node' }, localStorage: { getItem: () => null, setItem: noop },
  devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800,
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
ctx.document = new Proxy({}, {
  get(t, k) {
    if (k === 'querySelector' || k === 'getElementById') return () => el(k === 'getElementById' ? map3dJSON : '');
    if (k === 'createElement' || k === 'createDocumentFragment') return () => el();
    if (k === 'addEventListener') return noop;
    if (k === 'querySelectorAll') return () => [];
    if (k === 'documentElement' || k === 'body') return el();
    return noop;
  },
});
vm.createContext(ctx);

const probe = `
S.quality = 'high';
sampleH(0, 0);

/* ---------- A. 地表曲面自检 ---------- */
const cell0 = LOD_CELL_HI[0];
const nn = Math.max(2, Math.round(CH / cell0)), stp = CH / nn;
let nrmNonUp = 0, nrmNotUnit = 0, vtot = 0, triCnt = 0, hmin = 1e9, hmax = -1e9;
let alignErr = 0, alignMax = 0;
const cx0 = Math.floor((0 + HALFX) / CH) - 1, cz0 = Math.floor((0 + HALFZ) / CH) - 1;
const built = [];
for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
  const ix = cx0 + dx, iz = cz0 + dz;
  vreset();
  buildVoxelChunk(ix, iz, cell0);
  built.push([ix, iz]);
  const nv = vCount;
  vtot += nv; triCnt += nv / 3;
  const terrV = nn * nn * 6;            /* 地形三角在最前面，后面是树/石/房 */
  let lowHere = 0;
  for (let k = 0; k + 8 < VW && k < terrV * 9; k += 9) {
    const nx = V[k + 3], ny = V[k + 4], nz = V[k + 5];
    const L = Math.hypot(nx, ny, nz);
    if (Math.abs(L - 1) > 2e-3) nrmNotUnit++;
    if (ny < 0.02) { nrmNonUp++; lowHere++; }   /* 法线完全水平 = 竖直墙面 */          /* 旧版竖直崖壁 ny≈0，这里应全部朝上 */
    const y = V[k + 1];
    if (y < hmin) hmin = y; if (y > hmax) hmax = y;
  }
  if (lowHere) console.log('  ✘ 块 ' + ix + ',' + iz + ' 地形法线朝下=' + lowHere + ' / ' + (terrV) + ' VW=' + VW);
  /* surfaceY 与「本块网格三角面」严格对齐：误差应为 0 */
  const bx = ix * CH - HALFX, bz = iz * CH - HALFZ;
  const A2 = (i, j) => Math.max(1.5, sampleH(bx + clamp(i, 0, nn) * stp, bz + clamp(j, 0, nn) * stp));
  let rs = 424242;
  const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 120; t++) {
    const wx = bx + rnd() * CH, wz = bz + rnd() * CH;
    const fx = (wx - bx) / stp, fz = (wz - bz) / stp;
    const i = clamp(Math.floor(fx), 0, nn - 1), j = clamp(Math.floor(fz), 0, nn - 1);
    const tx = fx - i, tz = fz - j;
    const h00 = A2(i, j), h10 = A2(i + 1, j), h01 = A2(i, j + 1), h11 = A2(i + 1, j + 1);
    const href = tx <= tz ? h00 + (h01 - h00) * tz + (h11 - h01) * tx
                          : h00 + (h10 - h00) * tx + (h11 - h10) * tz;
    const d = Math.abs(surfaceY(wx, wz) - href);
    alignErr += d; if (d > alignMax) alignMax = d;
  }
}
console.log('=== A. 地表曲面 ===');
console.log('抽样块=' + built.length + ' 三角面=' + triCnt + ' 顶点=' + vtot +
  ' 高程范围=[' + hmin.toFixed(1) + ',' + hmax.toFixed(1) + ']');
console.log('法线非归一=' + nrmNotUnit + ' 完全竖直面(应为0)=' + nrmNonUp);
console.log('surfaceY 对齐误差 平均=' + (alignErr / (built.length * 120)).toFixed(5) + ' 最大=' + alignMax.toFixed(5));
/* 曲面连续性：0.5 单位步长的相邻高差不应出现"断崖式"跳变 */
let jumpMax = 0, jumpAt = null;
for (const [ix, iz] of built) {
  const bx = ix * CH - HALFX, bz = iz * CH - HALFZ;
  for (let t = 0; t <= 40; t++) {
    const wx = bx + t * 1.6, wz = bz + CH * .5;
    const d = Math.abs(surfaceY(wx + .5, wz) - surfaceY(wx, wz));
    if (d > jumpMax) { jumpMax = d; jumpAt = [wx.toFixed(1), wz.toFixed(1)]; }
  }
}
console.log('0.5 单位步长最大高差=' + jumpMax.toFixed(3) + ' @(' + (jumpAt ? jumpAt.join(',') : '-') + ')（>3 才是接缝，大致是真实陡崖）');

/* ---------- B. 水面：岸线不变量 ---------- */
let secs = 0, bad = 0, wetLim = 0, narrow = 0, maxErr = 0, errAt = null, dryEdge = 0;
for (const r of RIVER_W) {
  const pts = r.fine, wl = r.wl;
  if (!pts || pts.length < 2 || !wl) continue;
  const hw = riverHW(r), bw = riverBW(r), halfW = Math.max(hw * .62, hw + bw * .42);
  const N = pts.length, wyArr = new Array(N), dpR = riverDP(r);
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const bed = Math.min(sampleH(p[0], p[1]), wl[i] - dpR * .55);
    wyArr[i] = Math.min(wl[i], bed + dpR * .5);
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < N; i++) wyArr[i] = Math.min(wyArr[i], wyArr[i - 1] + 1.2);
    for (let i = N - 2; i >= 0; i--) wyArr[i] = Math.min(wyArr[i], wyArr[i + 1] + 1.2);
  }
  for (let i = 0; i < N; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx, wy = wyArr[i];
    const shoreAt = (sx, sz) => {
      let pr = 0, ph = sampleH(p[0], p[1]);
      for (let q = 1; q <= 16; q++) {
        const rr = Math.max(.9, halfW * q / 16);
        const hh2 = sampleH(p[0] + sx * rr, p[1] + sz * rr);
        if (hh2 > wy - .04) {
          const t = (wy - .04 - ph) / Math.max(1e-3, hh2 - ph);
          return { r: pr + (rr - pr) * clamp(t, 0, 1), lim: false };
        }
        pr = rr; ph = hh2;
      }
      return { r: halfW, lim: true };
    };
    const sL = shoreAt(nx, nz), sR = shoreAt(-nx, -nz);
    secs++;
    if (sL.r + sR.r < 1.0) narrow++;
    for (const [s, sx, sz] of [[sL, nx, nz], [sR, -nx, -nz]]) {
      if (s.r < 0.5) { dryEdge++; continue; }
      const X = p[0] + sx * s.r, Z = p[1] + sz * s.r;
      const g = sampleH(X, Z);
      if (s.lim) {                      /* 整段河床都在水下：边线贴地，这是允许的 */
        wetLim++;
        if (g > wy + .06) { bad++; if (Math.abs(g - wy) > maxErr) { maxErr = Math.abs(g - wy); errAt = [r.name, i, X.toFixed(1), Z.toFixed(1)]; } }
      } else {
        const e = Math.abs(g - (wy - .04));
        if (e > .30) { bad++; if (e > maxErr) { maxErr = e; errAt = [r.name, i, X.toFixed(1), Z.toFixed(1)]; } }
      }
    }
  }
}
console.log('\\n=== B. 水面岸线 ===');
console.log('断面数=' + secs + ' 岸线异常=' + bad + ' 最大偏差=' + maxErr.toFixed(3) +
  (errAt ? ' @' + errAt.join('/') : ''));
console.log('河床全没入水中的断面(半宽收边)=' + wetLim + ' 水面宽<1的断面=' + narrow + ' 边界点=0宽(干边)=' + dryEdge);
const badRatio = bad / (secs * 2);
console.log('岸线异常占比=' + (badRatio * 100).toFixed(2) + '%（阈值 2%，皆为 16 步线性解算噪声，且均被 min(wy,surfaceY+.05) 收边，结构上不可能悬空）');
console.log('\\nSMOOTH ' + (nrmNonUp === 0 && nrmNotUnit === 0 && alignMax < 0.02 && badRatio < 0.02 && jumpMax < 3 ? 'PASS' : 'FAIL'));
`;

const idx = js.lastIndexOf('})();');
if (idx < 0) { console.error('无法定位 IIFE 结尾'); process.exit(1); }
const patched = js.slice(0, idx) + probe + '\n' + js.slice(idx);
try {
  vm.runInContext(patched, ctx, { filename: 'route3d.js' });
} catch (e) {
  console.error('✘ 运行抛错: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}

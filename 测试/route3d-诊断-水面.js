/* route3d 水面诊断（一次性工具）：Node 带桩跑主脚本，量 wl 与 sampleH 的差 */
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

/* —— 探针：初始化河流后量差值（与主脚本同作用域，故直接拼接后一次 runInContext）—— */
const probe = `
sampleH(0, 0);   /* 惰性初始化 buildRiverLevels + buildNodeFlats */
console.log('=== RIVER_W 水位概览 ===');
for (const r of RIVER_W) {
  const wl = r.wl || [];
  const mn = Math.min.apply(null, wl), mx = Math.max.apply(null, wl);
  console.log(r.name, 'w=' + r.w, 'fine=' + (r.fine || []).length,
    'wl[0]=' + (wl[0] || 0).toFixed(1), 'wl[mid]=' + (wl[wl.length >> 1] || 0).toFixed(1),
    'wl[last]=' + (wl[wl.length - 1] || 0).toFixed(1), 'min=' + mn.toFixed(1), 'max=' + mx.toFixed(1));
}
console.log('\\n=== 节点 g1(于都河夜渡) 附近：各河最近点 wl vs sampleH ===');
const n = (NODES3D || []).find(x => x.id === 'g1') || { x: 0, z: 0 };
console.log('node world:', n.x.toFixed(1), n.z.toFixed(1));
const nf = (NODE_FLAT || []).find(f => Math.abs(f.x - n.x) < 20 && Math.abs(f.z - n.z) < 20);
if (nf) console.log('nodeFlat y=', nf.y.toFixed(2), 'r=', nf.r);
for (const r of RIVER_W) {
  if (!r.fine || !r.wl) continue;
  let bi = -1, bd = 1e9;
  for (let i = 0; i < r.fine.length; i++) {
    const d = Math.hypot(r.fine[i][0] - n.x, r.fine[i][1] - n.z);
    if (d < bd) { bd = d; bi = i; }
  }
  const p = r.fine[bi], wl = r.wl[bi];
  const hw = riverHW(r), bw = riverBW(r), dp = riverDP(r);
  // 与 buildWater 一致：用折线法线（垂直河岸）方向采样
  const a = r.fine[Math.max(0, bi - 1)], b = r.fine[Math.min(r.fine.length - 1, bi + 1)];
  let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  const nx = -dz, nz = dx;
  const hw2 = hw + bw * 0.42;
  let rimTop = wl;
  for (let q = 0; q <= 6; q++) {
    const rr = hw * 0.85 + (hw2 - hw * 0.85) * (q / 6);
    const ta = sampleH(p[0] + nx * rr, p[1] + nz * rr), tb = sampleH(p[0] - nx * rr, p[1] - nz * rr);
    if (ta < rimTop) rimTop = ta; if (tb < rimTop) rimTop = tb;
  }
  const newWy = Math.max(Math.min(wl, rimTop - 0.3), sampleH(p[0], p[1]) + 0.3);
  const floorH = sampleH(p[0], p[1]);
  const bankH = sampleH(p[0] + nx * hw, p[1] + nz * hw);
  console.log('--', r.name, '最近点距=' + bd.toFixed(1),
    '旧wl=' + wl.toFixed(2), '新wy=' + newWy.toFixed(2),
    'floor=' + floorH.toFixed(2), '垂直近岸=' + bankH.toFixed(2),
    '| 旧浮空=' + (wl - floorH).toFixed(2), '新浮空=' + (newWy - bankH).toFixed(2),
    newWy <= bankH + 0.001 ? '✔不浮' : '✘仍浮');
}
console.log('\\n=== 于都河 fine 全程：wl 与 sampleH 河心差 ===');
const r0 = RIVER_W.find(r => r.name === '于都河');
if (r0) for (let i = 0; i < r0.fine.length; i += 6) {
  const p = r0.fine[i];
  console.log('i=' + i, '(' + p[0].toFixed(0) + ',' + p[1].toFixed(0) + ')',
    'wl=' + r0.wl[i].toFixed(2), 'ground=' + sampleH(p[0], p[1]).toFixed(2),
    'diff(wl-ground)=' + (r0.wl[i] - sampleH(p[0], p[1])).toFixed(2));
}
console.log('\\nDIAG DONE');
`;
/* 主脚本整体被 IIFE 包裹（line94 开、末尾 })(); 收），所以探针必须注入到 IIFE 内部 */
const closeIdx = js.lastIndexOf('})();');
if (closeIdx < 0) { console.error('未找到 IIFE 收尾，无法注入探针'); process.exit(1); }
const jsWithProbe = js.slice(0, closeIdx) + '\n' + probe + '\n' + js.slice(closeIdx);
vm.runInContext(jsWithProbe, ctx, { filename: 'route3d+probe.js' });

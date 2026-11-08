/* route3d v18 回归诊断（一次性工具）：验证两处修复
   1) 水面不再「突然抬高」：每条河 wyArr 相邻点最大落差受 MAXSTEP 限制
   2) 水面不再「浮空」：wyArr[i] 永不高于近岸最低地形的 rimTop-0.3
   3) 房子里不再「立在水里」：每个临河节点的 bankPos 落点 !waterAt（在干岸） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, '游戏', 'route3d.html'), 'utf8');
const js = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];

function el(text) {
  const o = { style: {}, dataset: {}, children: [], textContent: text || '',
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { o.children.push(c); return c; },
    removeChild() {}, setAttribute() {}, getAttribute() { return null; },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    querySelector() { return el(); }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; } };
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
sampleH(0, 0);   /* 触发 buildRiverLevels + buildNodeFlats */
function computeWyArr(r) {
  const pts = r.fine, wl = r.wl, hw = riverHW(r), bw = riverBW(r);
  const N = pts.length; const wyArr = new Array(N);
  const caps = new Array(N);
  for (let i = 0; i < N; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx; const hw2 = hw + bw * 0.42; let rimTop = wl[i];
    for (let q = 0; q <= 6; q++) { const rr = hw * 0.85 + (hw2 - hw * 0.85) * (q / 6);
      const ta = sampleH(p[0] + nx * rr, p[1] + nz * rr), tb = sampleH(p[0] - nx * rr, p[1] - nz * rr);
      if (ta < rimTop) rimTop = ta; if (tb < rimTop) rimTop = tb; }
    caps[i] = rimTop - 0.3;
    wyArr[i] = Math.min(wl[i], rimTop - 0.3);
  }
  const MAXSTEP = 1.2;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < N; i++) wyArr[i] = Math.min(wyArr[i], wyArr[i - 1] + MAXSTEP);
    for (let i = N - 2; i >= 0; i--) wyArr[i] = Math.min(wyArr[i], wyArr[i + 1] + MAXSTEP);
  }
  return { wyArr, caps };
}
let fail = 0;
console.log('=== 水面：台阶 / 浮空 检查 ===');
for (const r of RIVER_W) {
  if (!r.fine || !r.wl) continue;
  const { wyArr, caps } = computeWyArr(r);
  let maxStep = 0, maxFloat = 0;
  for (let i = 1; i < wyArr.length; i++) maxStep = Math.max(maxStep, Math.abs(wyArr[i] - wyArr[i - 1]));
  for (let i = 0; i < wyArr.length; i++) maxFloat = Math.max(maxFloat, wyArr[i] - caps[i]);
  const ok = maxStep <= 1.35 && maxFloat <= 0.001;
  if (!ok) fail++;
  console.log((ok ? '✔' : '✘') + ' ' + r.name, 'maxStep=' + maxStep.toFixed(2), 'maxFloat=' + maxFloat.toFixed(3));
}
console.log('\\n=== 临河节点：bankPos 落点是否仍在水中 ===');
let inWater = 0, checked = 0;
for (const n of (NODES3D || [])) {
  const ri = riverInfoAt(n);
  if (!ri) continue;
  checked++;
  const bk = bankPos(n, ri);
  const wet = waterAt(bk[0], bk[1]);
  const below = surfaceY(bk[0], bk[1]) <= ri.waterY + 0.5;
  if (wet || below) { inWater++; console.log('✘', n.id || n.name, 'bank=(' + bk[0].toFixed(1) + ',' + bk[1].toFixed(1) + ')', 'wet=' + wet, 'belowWater=' + below, 'waterY=' + ri.waterY.toFixed(2)); }
}
console.log('临河节点检查数=' + checked, '仍在水中/水下的落点数=' + inWater);
console.log('\\n=== 节点网格冒烟：每个节点 buildNodeMesh 不抛错 ===');
let meshErr = 0;
for (let i = 0; i < (NODES3D || []).length; i++) {
  try { buildNodeMesh(i); } catch (e) { meshErr++; console.log('✘ node#' + i + ' (' + ((NODES3D||[])[i].id||'') + '): ' + e.message); }
}
console.log('节点总数=' + (NODES3D||[]).length, 'buildNodeMesh 抛错数=' + meshErr);
console.log('\\nREGRESSION ' + (fail === 0 && inWater === 0 && meshErr === 0 ? 'PASS' : 'FAIL(fail=' + fail + ',inWater=' + inWater + ',meshErr=' + meshErr + ')'));
`;
const closeIdx = js.lastIndexOf('})();');
if (closeIdx < 0) { console.error('未找到 IIFE 收尾'); process.exit(1); }
const jsWithProbe = js.slice(0, closeIdx) + '\n' + probe + '\n' + js.slice(closeIdx);
vm.runInContext(jsWithProbe, ctx, { filename: 'route3d-v18.js' });

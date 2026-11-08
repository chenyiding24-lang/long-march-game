/* route3d 聚落落水专项诊断：
   把 vhhouse / vhtent / vhdiao 包一层，记录每个落点的「脚印四角 + 中心」，
   逐一断言 waterAt 为 false —— 彻底确认「没有房子/帐篷/碉楼泡在水里」。
   覆盖：节点网格所有分支（含 fork 偏移房 2261、swamp 帐篷、vhcluster、buildRegionSettlement）
        以及 buildVoxelChunk 沿路人家（1054 直排 vhhouse，未走 dryOrNull）。 */
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
sampleH(0, 0);
S.quality = 'high';
let CUR_CTX = null, CUR_NODE = null;

let placeCount = 0, wetCount = 0, stiltWet = 0; const wetList = [];
function fpCheck(kind, o) {
  if (o.stilt) return;                 /* 干栏吊脚楼本就该立在水上，不计入失败 */
  const rot = o.rot || 0;
  let hw, hd;
  if (kind === 'diao') { const s = o.s || 1; hw = 3.4 * s / 2; hd = 3.4 * s / 2; }
  else if (kind === 'tent') { hw = (o.w || 3) / 2; hd = (o.d || 2.4) / 2; }
  else { hw = (o.w || 5) / 2; hd = (o.d || 4) / 2; }
  const M = 0.6;                       /* 脚印外再加一点余量，覆盖屋檐/台基 */
  const pts = [[hw+M,hd+M],[hw+M,-(hd+M)],[-(hw+M),hd+M],[-(hw+M),-(hd+M)],[0,0]];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const p of pts) {
    const wx = o.x + p[0]*c - p[1]*s, wz = o.z + p[0]*s + p[1]*c;
    if (waterAt(wx, wz)) {
      wetCount++;
      if (wetList.length < 30) wetList.push(kind + ' (' + wx.toFixed(1) + ',' + wz.toFixed(1) + ') rot=' + rot.toFixed(2));
      return;
    }
  }
}
let omitCount = 0, movedCount = 0;
function fpCheckAfter(kind, o) {
  if (o.stilt) return;                 /* 干栏吊脚楼本就该立在水上，不计入失败 */
  const rot = o.rot || 0;
  let hw, hd;
  if (kind === 'diao') { const s = o.s || 1; hw = 3.4 * s / 2; hd = 3.4 * s / 2; }
  else if (kind === 'tent') { hw = (o.w || 3) / 2; hd = (o.d || 2.4) / 2; }
  else { hw = (o.w || 5) / 2; hd = (o.d || 4) / 2; }
  const M = 0.6;
  const pts = [[hw+M,hd+M],[hw+M,-(hd+M)],[-(hw+M),hd+M],[-(hw+M),-(hd+M)],[0,0]];
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const p of pts) {
    const wx = o.x + p[0]*c - p[1]*s, wz = o.z + p[0]*s + p[1]*c;
    if (waterAt(wx, wz)) { omitCount++; if (wetList.length < 30) wetList.push(kind + ' 落水且就近无干地→未绘制 (' + wx.toFixed(1) + ',' + wz.toFixed(1) + ')'); return; }
  }
}
const _vhhouse = vhhouse;
vhhouse = function (o) {
  placeCount++;
  if (o.stilt && waterAt(o.x, o.z)) stiltWet++;
  const px0 = o.x, pz0 = o.z;
  _vhhouse(o);
  if (Math.hypot(o.x - px0, o.z - pz0) > 0.5) movedCount++;
  if (CUR_CTX && o.x === px0 && o.z === pz0 && waterAt(o.x, o.z)) { /* 未迁移且仍在水中 = 被省略 */
    omitCount++;
    const n = CUR_NODE;
    if (wetList.length < 40) wetList.push('house 省略 @(' + o.x.toFixed(1) + ',' + o.z.toFixed(1) + ') ctx=' + CUR_CTX + (n ? ' node=' + (n.id || n.name || '?') + ' icon=' + (n.icon || '') + ' region=' + (n.region || '') : ''));
  }
};
const _vhtent = vhtent;
vhtent = function (o) {
  placeCount++;
  if (o.stilt && waterAt(o.x, o.z)) stiltWet++;
  const px0 = o.x, pz0 = o.z;
  _vhtent(o);
  if (Math.hypot(o.x - px0, o.z - pz0) > 0.5) movedCount++;
  if (CUR_CTX && o.x === px0 && o.z === pz0 && waterAt(o.x, o.z)) {
    omitCount++;
    const n = CUR_NODE;
    if (wetList.length < 40) wetList.push('tent 省略 @(' + o.x.toFixed(1) + ',' + o.z.toFixed(1) + ') ctx=' + CUR_CTX + (n ? ' node=' + (n.id || n.name || '?') + ' icon=' + (n.icon || '') : ''));
  }
};
const _vhdiao = vhdiao;
vhdiao = function (o) {
  placeCount++;
  if (o.stilt && waterAt(o.x, o.z)) stiltWet++;
  const px0 = o.x, pz0 = o.z;
  _vhdiao(o);
  if (Math.hypot(o.x - px0, o.z - pz0) > 0.5) movedCount++;
};

/* 草地区域尺寸（确认 Request D 的放大已生效） */
let grass = null;
for (const r of (MAP3D.regions || [])) if (r.key === 'grass') grass = r;
if (grass) {
  const b = grass.box;
  console.log('草地区域 SVG 盒: x[' + b.x0 + ',' + b.x1 + '] y[' + b.y0 + ',' + b.y1 + '] 宽=' + (b.x1-b.x0) + ' 高=' + (b.y1-b.y0));
}

/* 节点网格：所有分支，含 fork 偏移房 / swamp 帐篷 / vhcluster / buildRegionSettlement */
let meshErr = 0;
for (let i = 0; i < (NODES3D || []).length; i++) {
  CUR_CTX = 'node'; CUR_NODE = (NODES3D || [])[i];
  try { buildNodeMesh(i); } catch (e) { meshErr++; console.log('✘ node#' + i + ' (' + ((NODES3D||[])[i].id||'') + '): ' + e.message); }
}
CUR_CTX = null; CUR_NODE = null;
/* 体素块：覆盖沿路人家直排 vhhouse（1054，未走 dryOrNull） */
let chunkErr = 0, built = 0;
const NCH = Math.ceil((2 * HALFX) / CH);
for (let ix = 0; ix < NCH; ix += 2) for (let iz = 0; iz < NCH; iz += 2) {
  if (built > 220) break;
  CUR_CTX = 'chunk';
  try { buildVoxelChunk(ix, iz, 4.0); built++; } catch (e) { chunkErr++; console.log('✘ chunk', ix, iz, e.message); }
}
console.log('=== 聚落落水检查 ===');
console.log('建筑落点总数=' + placeCount + ' 就近上岸(迁移)数=' + movedCount + ' 落水且无干地→未绘制=' + omitCount + ' 吊脚楼中心在水中(设计如此)=' + stiltWet + ' meshErr=' + meshErr + ' chunkErr=' + chunkErr + ' 抽样块=' + built);
if (wetList.length) wetList.forEach(s => console.log('  ✘ ' + s));
console.log('\\nSETTLE ' + (omitCount === 0 && meshErr === 0 && chunkErr === 0 ? 'PASS' : 'FAIL(omit=' + omitCount + ',meshErr=' + meshErr + ',chunkErr=' + chunkErr + ')'));
`;
const closeIdx = js.lastIndexOf('})();');
if (closeIdx < 0) { console.error('未找到 IIFE 收尾'); process.exit(1); }
const jsWithProbe = js.slice(0, closeIdx) + '\n' + probe + '\n' + js.slice(closeIdx);
vm.runInContext(jsWithProbe, ctx, { filename: 'route3d-聚落.js' });

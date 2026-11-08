/* ============================================================
   引擎冒烟测试 —— 不开浏览器、不启 DOM，只跑数据层与纯逻辑
   用法： node 测试/引擎冒烟.js

   验证 T3 的四件新事：
     ① Store.s.log 存在且旧档兼容；logStep 超过 120 条会压缩
     ② 独立地域池：区域专属事件只在自己的 region 出现，主池权重不被稀释
     ③ 地域皮：带 region 的变体只在对应区域入候选
     ④ 运行时锚点：pickVariant 返回的「这一次屏幕上的正文」里，
        每个选项的 anch 都必须出现（比 data校验.js 的静态检查更贴近真实）
   以及三节点升格补丁、人物过场数据是否装好。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const kv = {};
const localStorage = {
  getItem: k => (k in kv ? kv[k] : null),
  setItem: (k, v) => { kv[k] = String(v); },
  removeItem: k => { delete kv[k]; }
};
const win = {
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} })
};
const fakeEl = () => ({
  innerHTML: '', textContent: '', style: { setProperty() {} },
  classList: { add() {}, remove() {}, toggle() {} },
  appendChild() {}, addEventListener() {}, setAttribute() {},
  getBoundingClientRect: () => ({ width: 800, height: 600 }),
  querySelector: () => null, querySelectorAll: () => [],
  dataset: {}, remove() {}, closest: () => null
});
const doc = {
  querySelector: () => fakeEl(), querySelectorAll: () => [], addEventListener() {},
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  documentElement: { style: { setProperty() {} } }
};
const ctx = {
  window: win, document: doc, localStorage, console,
  Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Set, Map,
  Uint8Array, TextEncoder, TextDecoder, btoa, atob,
  performance: { now: () => 0 }, requestAnimationFrame: () => 0,
  setTimeout, clearTimeout, navigator: {}
};
ctx.globalThis = ctx;
vm.createContext(ctx);

/* 两个文件必须拼成一个 script 求值：vm 里不同 runInContext 的顶层 const 不共享词法环境 */
const combined = fs.readFileSync(path.join(ROOT, '游戏', 'data.js'), 'utf8') + '\n;\n' +
                 fs.readFileSync(path.join(ROOT, '游戏', 'game.js'), 'utf8');
vm.runInContext(combined, ctx, { filename: 'combined.js' });

const G = win.Game, D = G.debug;
if (!G || !D) { console.error('引擎没挂到 window.Game'); process.exit(1); }

let bad = 0;
const check = (name, cond, extra) => {
  console.log((cond ? '  [OK]   ' : '  [FAIL] ') + name + (extra ? ' — ' + extra : ''));
  if (!cond) bad++;
};

/* ---------- ① 日志 ---------- */
D.Store.load();
const s = D.Store.s;
check('Store.s.log 存在且为空数组', Array.isArray(s.log) && s.log.length === 0);
s.at = 'g1';
for (let i = 0; i < 130; i++) D.Game.logStep({ kind: 'march', label: '行军', delta: { food: -1 } });
check('logStep 超 120 条自动压缩', s.log.length > 60 && s.log.length < 130 && s.log[0].kind === 'digest',
  '写 130 条后剩 ' + s.log.length + ' 条，首条 ' + s.log[0].kind);
check('日志条目带地名与 region', !!s.log[1].place && s.log[1].region === 'gan');

/* ---------- ② 独立地域池 ---------- */
const regionOf = id => (D.NODE_BY_ID[id] || {}).region;
/* 地域皮跨区不能看 e.region —— 那是原事件的 region 数组，不是变体的。
   正确做法：拿「这一次屏幕上的正文」去比对所有带 region 的变体正文。 */
const skinTexts = [];
D.MOVE_EVENTS.forEach(m => (m.variants || []).forEach(v => {
  if (v.region) skinTexts.push({ text: v.text, region: v.region });
}));
const samples = {};
['g1', 'g2', 'g3', 'g6', 'g7b', 'g9', 'g10', 'g12'].forEach(id => {
  s.at = id;
  /* 每个区域按「一局」重置计数：主池每种事件一局最多 2 次，专属池同样受 CAP 2 约束 */
  s.flags.moveSeen = {}; s.flags.lastMoveId = null; s.flags.mvVar = {};
  const tally = { local: 0, main: 0, localWrongRegion: 0, anchorMiss: 0, skinHit: 0, localPerEvent: {} };
  for (let k = 0; k < 400; k++) {
    const e = D.Game.rollMoveEvent();
    if (!e) continue;
    if (e.localRegion) {
      tally.local++;
      tally.localPerEvent[e.id] = (tally.localPerEvent[e.id] || 0) + 1;
      if (e.localRegion !== regionOf(id)) tally.localWrongRegion++;
    } else tally.main++;
    /* ④ 运行时锚点：这一次的正文必须交代选项里提到的每个实体 */
    (e.options || []).forEach(o => {
      (o.anch || []).forEach(a => { if (e.text.indexOf(a) < 0) tally.anchorMiss++; });
    });
    skinTexts.forEach(sk => {
      if (e.text === sk.text && sk.region !== regionOf(id)) tally.skinHit++;
    });
  }
  samples[id] = tally;
});
const totalLocal = Object.values(samples).reduce((a, t) => a + t.local, 0);
const totalMain = Object.values(samples).reduce((a, t) => a + t.main, 0);
const wrong = Object.values(samples).reduce((a, t) => a + t.localWrongRegion, 0);
const miss = Object.values(samples).reduce((a, t) => a + t.anchorMiss, 0);
const skin = Object.values(samples).reduce((a, t) => a + t.skinHit, 0);
const withLocal = ['g1', 'g2', 'g3', 'g6', 'g9', 'g10', 'g12'];
check('有专属事件的区域都能抽到', withLocal.every(k => samples[k].local > 0),
  '专属共 ' + totalLocal + ' 次 / 主池 ' + totalMain + ' 次');
check('每种专属事件一局不超过 2 次（CAP 生效）', Object.values(samples).every(t => Math.max(0, ...Object.values(t.localPerEvent)) <= 2));
check('区域专属事件绝不串区', wrong === 0, '串区 ' + wrong + ' 次');
check('运行时锚点 0 缺失', miss === 0, '缺失 ' + miss + ' 处');
check('地域皮变体不跨区', skin === 0, '跨区 ' + skin + ' 次');
console.log('       分区抽样：' + Object.keys(samples).map(k =>
  k + '(' + regionOf(k) + ') 专属' + samples[k].local).join(' / '));

/* ---------- ③ 地域皮：同一事件在不同 region 拿到不同正文 ---------- */
const seenText = {};
['g1', 'g3', 'g12'].forEach(id => {
  s.at = id;
  for (let k = 0; k < 300; k++) {
    const m = D.MOVE_EVENTS.find(x => x.id === 'mv_ford');
    const v = D.Game.pickVariant(m);
    (seenText[id] = seenText[id] || new Set()).add(v.text);
  }
});
check('mv_ford 在三个区域各有地域皮', Object.keys(seenText).every(k => seenText[k].size >= 2),
  Object.keys(seenText).map(k => k + ':' + seenText[k].size).join(' '));

/* ---------- ④ 三节点升格与过场数据 ---------- */
const patched = ['e_u1', 'e_p1', 'e_p2'].every(id => {
  const n = D.NODE_BY_ID[id];
  return n && n.scene && n.epilogue && n.art && n.motion;
});
check('三个已有节点已升格（scene/epilogue/art/motion）', patched);
check('节点总数仍是 49、边仍是 53', D.NODES.length === 49 && D.EDGES.length === 53);
check('移动事件 20 条', D.MOVE_EVENTS.length === 20);
const hasCuts = vm.runInContext('typeof CUTSCENES !== "undefined" && Object.keys(CUTSCENES).length', ctx);
check('人物过场数据已装入', hasCuts === 3, '段数 ' + hasCuts);
s.flags.lastResolvedNode = 'g2';
const cut = D.Game.pendingCutscene(D.NODE_BY_ID['e_x1']);
check('g2 结算后到 e_x1 会触发陈树湘过场', !!cut && cut.key === 'chenshuxiang');
check('BALANCE 定稿数值未改', D.BALANCE.init.food === 11 && D.BALANCE.init.window === 6 &&
  D.BALANCE.eventP === 0.24 && D.BALANCE.fallLimit === 3,
  'regionP=' + D.BALANCE.regionP);

/* ---------- ⑤ 放映机 DOM：art 编号 → stage / motion / weather / 缺图降级 ---------- */
let lastWrap = null;
doc.createElement = () => {
  const el = fakeEl();
  let html = '';
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: v => { html = v; } });
  el.querySelector = sel => {
    if (sel === '.cg-img') return { addEventListener() {} };
    if (sel === '.cg-weather') return { getContext: () => null, style: {} };
    if (sel === '.cg-stage') return { classList: { add() {} } };
    return null;
  };
  lastWrap = el;
  return el;
};
D.Router.open({ title: '泸定桥', html: '<p class="cg">铁索</p>', cinematic: true, art: 'cg-09', actions: [] });
const stageHtml = lastWrap ? lastWrap.innerHTML : '';
check('art 生成 cg-stage 与正确运镜/天气', stageHtml.includes('cg-stage motion-zoom-in weather-ember'),
  (stageHtml.match(/class="cg-stage[^"]*"/) || ['无'])[0]);
check('art 指向相对路径的本地图', stageHtml.includes('src="art/cg-09.webp"'));
check('stage 带 scrim 与天气 canvas', stageHtml.includes('cg-scrim') && stageHtml.includes('cg-weather'));
D.Router.open({ title: '无图', html: '<p class="cg">纯文字</p>', cinematic: true, actions: [] });
check('没给 art 时不生成 stage（文字 CG 原样可用）', !(lastWrap.innerHTML.includes('cg-stage')));
D.Router.closeAll();

/* ---------- ⑥ 存档码：导出 → 破坏状态 → 载入还原，坏码必须被拒 ---------- */
s.at = 'g7b'; s.board.names = ['小谢', '老范']; D.Store.meta.wins = 2;
const code = D.Store.exportCode();
check('exportCode 生成非空存档码', typeof code === 'string' && code.length > 40,
  code ? code.length + ' 字符' : '空');
check('存档码是 URL-safe（无 + / =）', !!code && !/[+/=]/.test(code));
D.Store.s = D.Store.defaultState(); D.Store.meta = D.Store.defaultMeta();
check('importCode 载入成功', D.Store.importCode(code) === true);
check('载入后 at / 木牌 / 战绩还原', D.Store.s.at === 'g7b' &&
  D.Store.s.board.names.length === 2 && D.Store.meta.wins === 2);
check('载入后 log 仍是可写数组', Array.isArray(D.Store.s.log));
check('坏码被拒绝', D.Store.importCode('这不是存档码') === false);
check('指向不存在节点的码被拒绝',
  D.Store.importCode(btoa('{"v":1,"s":{"at":"nope"},"m":{}}')) === false);
check('音效默认关', !!D.Sound && D.Sound.on === false);
check('民心回响只用日志里的事实', (() => {
  D.Store.s.log = [{ kind: 'choice', place: '毛儿盖', label: '抢割青稞（违纪）', sin: 'mass' }];
  const t = D.Game.echoLine({ name: '寨子' });
  return t.includes('毛儿盖') && t.includes('抢割青稞') && !t.includes('青稞没登记');
})());

/* ---------- ⑦ 战史官 / 战友记忆 / 分享卡 / 默认关的开关 ---------- */
D.Store.s = D.Store.defaultState();
Object.assign(D.Store.s, {
  at: 'g12', run: 2, men: 48, food: 3, window: 2, trust: 55,
  board: { places: ['于都', '吴起镇'], names: ['小谢', '老范'], blanks: 10 },
  log: [
    { kind: 'march', place: '于都', delta: {}, hunger: false, menAfter: 100 },
    { kind: 'choice', place: '泸定桥', label: '正面攀索', delta: {}, sin: null },
    { kind: 'march', place: '夹金山', delta: {}, hunger: true, menAfter: 60 },
    { kind: 'march', place: '吴起镇', delta: {}, hunger: false, menAfter: 48 }
  ]
});
const f = D.Chronicle.facts();
check('facts.steps 只数行军格', f.steps === 3, 'steps=' + f.steps);
check('facts 地名全部来自日志', f.firstPlace === '于都' && f.lastPlace === '吴起镇');
const tpl = D.Chronicle.template('白话');
check('模板战史含引擎给的数字', tpl.includes('3 格') && tpl.includes('48'));
check('守卫拒绝领袖姓名', !D.Chronicle.guard('毛泽东带领这一程走了 3 格，木牌刻下 2 个名字，兵 48。', f));
check('守卫拒绝日志外的数字', !D.Chronicle.guard('这一程走了 9999 格，木牌刻下 2 个名字，兵 48，粮 3。', f));
check('守卫接受合规文本', D.Chronicle.guard('这一程走了 3 格，木牌刻下 2 个名字，兵 48，粮 3，民 55。', f));
check('excerpt 不超过 28 字', D.Chronicle.excerpt().length <= 28);
check('战绩码是 6 位', /^[0-9A-Z]{6}$/.test(D.Share.code()));

D.Memory.add('saved', '把云贵川编进了队伍');
D.Memory.add('sin_witness', '没有拦下「抢割青稞（违纪）」');
check('mem 写入两类事实', D.Store.s.mem.length === 2);
const line = D.Memory.template(D.Store.s.mem[0]);
check('兜底台词替换了占位符', !line.includes('{{') && line.length > 8, line.slice(0, 26));
check('记忆守卫拒绝越界、接受合规',
  !D.Memory.guard('毛泽东说这一程很伟大') && D.Memory.guard('泸定桥那天你让我上，我记着。'));
check('receipt 把一条标成已回执', (() => { D.Memory.receipt(); return D.Memory.pending().length === 1; })());
/* S4/S6 按 23 §2-9 / 27 §五-7 / 28 §七-7 / 29 A7 的口径保持默认关。
   更要紧的是两套引擎必须一致：2D 与 3D 共用同一把存档键，开关不同 = 同一局换视图就换规则。 */
const g3dSrc = fs.readFileSync(path.join(ROOT, '游戏', 'game3d.js'), 'utf8');
const flag = (src, key) => new RegExp(key + ':\\s*\\{\\s*enabled:\\s*(true|false)').exec(src)[1] === 'true';
check('S4 军帐议事 / S6 追兵学你默认关',
  !D.BALANCE.council.enabled && !D.BALANCE.enemyLearn.enabled);
check('S4/S6 开关 2D 与 3D 一致（存档互通，不允许一边开）',
  flag(fs.readFileSync(path.join(ROOT, '游戏', 'game.js'), 'utf8'), 'council') === flag(g3dSrc, 'council') &&
  flag(fs.readFileSync(path.join(ROOT, '游戏', 'game.js'), 'utf8'), 'enemyLearn') === flag(g3dSrc, 'enemyLearn'));
check('没有注入 AI 通道时纯模板兜底', !win.__CWQS_AI);
check('存档码带上 mem', (() => {
  const c = D.Store.exportCode();
  D.Store.s = D.Store.defaultState();
  return D.Store.importCode(c) && D.Store.s.mem.length === 2;
})());

console.log('\n' + (bad ? '冒烟测试失败 ' + bad + ' 项' : '冒烟测试全部通过'));
process.exit(bad ? 1 : 0);

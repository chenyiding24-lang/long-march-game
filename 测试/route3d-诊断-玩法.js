/* =====================================================================
 * route3d 玩法诊断（Node vm 模拟，无需浏览器 / GPU / WebGL）
 * 目标：把平面地图的「事件 / 关卡」引擎（game3d.js 移植版）在纯逻辑层跑通：
 *   - 加载零异常；全部数据元素齐全（不缺项）
 *   - 从 g1 可达全部节点（图连通）
 *   - 逐节点结算：无异常、资源不越界（兵/粮/时/民 全程合法）
 *   - 行军结算、慈善补给、违纪清算、终章念名字、下一程重开、存档码回读
 *   - 数据引用无悬空（手法卡/道具/战友/史料 id 都存在）
 * 通过即说明「立体地图的玩法」引擎可运行；3D 投影由 route3d 在浏览器内接管。
 * =================================================================== */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.resolve(__dirname, '..', '游戏');
const dataSrc = fs.readFileSync(path.join(DIR, 'data.js'), 'utf8');
const gameSrc = fs.readFileSync(path.join(DIR, 'game3d.js'), 'utf8');

/* ---------- vm 桩（极简，不引外部依赖） ---------- */
const store = (() => { const m = new Map();
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })();

const sandbox = {
  console,
  performance: { now: () => Date.now() },
  setTimeout: () => 0,            /* 不自动回调，避免 3D/UI 时序干扰逻辑测试 */
  clearTimeout: () => {},
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  TextEncoder, TextDecoder,
};
sandbox.window = sandbox;         /* 让 game3d 的 window 指向自身，localStorage 可定位 */
sandbox.window.localStorage = store;
sandbox.globalThis = sandbox;
/* 不定义 document → game3d 的 doc 为 null，所有 UI 渲染安全 no-op，仅跑逻辑 */

let loadErr = null;
try {
  const ctx = vm.createContext(sandbox);
  vm.runInContext(dataSrc + '\n;\n' + gameSrc, ctx, { filename: 'cwqs-combined.js' });
} catch (e) { loadErr = e; }

/* ---------- 断言工具 ---------- */
const A = []; let fails = 0;
function ok(name, cond, info) {
  A.push((cond ? '✅' : '❌') + ' ' + name + (info ? ('  — ' + info) : ''));
  if (!cond) fails++;
}

const Engine = sandbox.window && sandbox.window.Game3D_Engine;
ok('脚本加载无异常', !loadErr, loadErr ? (loadErr.message + '\n' + (loadErr.stack || '')) : '');
ok('Game3D_Engine 已暴露', !!Engine);

if (!Engine) { report(); process.exit(1); }

const { NODES, EDGES, CARDS, COMRADES, ITEMS, HISTORY, MOVE_EVENTS, DISCIPLINE, SIN_TEXT,
        NODE_MAP, ADJ, Store, Game, Sin, Flow, Ending, History, Wall, Pages, BALANCE } = Engine;

/* ---------- 1. 数据齐全（元素都不能少） ---------- */
ok('节点数 ≥ 45', NODES.length >= 45, NODES.length + ' 个');
ok('关卡连线 ≥ 40', EDGES.length >= 40, EDGES.length + ' 条');
ok('手法卡 = 20', Object.keys(CARDS).length === 20, Object.keys(CARDS).length + ' 张');
ok('战友卡 ≥ 6', Object.keys(COMRADES).length >= 6, Object.keys(COMRADES).length + ' 张');
ok('道具 ≥ 5', Object.keys(ITEMS).length >= 5, Object.keys(ITEMS).length + ' 件');
ok('史料 ≥ 40', HISTORY.length >= 40, HISTORY.length + ' 条');
ok('行进突发事件 ≥ 10', (MOVE_EVENTS || []).length >= 10, (MOVE_EVENTS || []).length + ' 类');
ok('违纪文案存在（按标记数 1/2/3）', !!(SIN_TEXT && SIN_TEXT[1] && SIN_TEXT[3]), '');
ok('违纪类型表存在（群众/战场/俘虏/党的/阶级）', !!(DISCIPLINE && Object.keys(DISCIPLINE).length >= 3), Object.keys(DISCIPLINE || {}).join(','));

/* ---------- 2. 图连通：从 g1 可达全部节点 ---------- */
const reach = new Set(['g1']); const stack = ['g1'];
while (stack.length) { const id = stack.pop(); (ADJ[id] || []).forEach(n => { if (!reach.has(n)) { reach.add(n); stack.push(n); } }); }
ok('从 g1 可达全部节点', reach.size === NODES.length, reach.size + '/' + NODES.length + ' 可达');

/* ---------- 3. 初始状态合法 ---------- */
Store.load(); const s0 = Store.s;
ok('初始 at = g1', s0.at === 'g1');
const inRange = v => v >= 0 && v <= 100;
ok('初始资源合法', s0.men >= 0 && s0.men <= s0.menCap && s0.food >= 0 && s0.food <= 20 &&
   s0.window >= 0 && s0.window <= 8 && s0.trust >= 0 && s0.trust <= 100,
   `兵${s0.men} 粮${s0.food} 时${s0.window} 民${s0.trust}`);

/* ---------- 4. 下一站推荐 ---------- */
const ns = Game.nextNodes();
ok('g1 有可达邻格', ns.length > 0, ns.map(n => n.id).join(','));

/* ---------- 5. 逐节点结算：无异常 + 资源不越界 ---------- */
const fresh = () => { Store.s = JSON.parse(JSON.stringify(Store.defaultState()));
  Store.meta = JSON.parse(JSON.stringify(Store.defaultMeta())); Game.chosenCard = null; };
let settleCount = 0, settleFails = 0;
for (const node of NODES) {
  fresh();
  try {
    if (node.kind === 'hub') { Game.enter(node); settleCount++; continue; }
    const opts = node.options || [];
    if (!opts.length) continue;
    const opt = opts.find(o => !o.sin) || opts[0];
    Game.applyChoice(node, opt);
    settleCount++;
    const s2 = Store.s;
    const legal = s2.men >= 0 && s2.men <= s2.menCap && s2.food >= 0 && s2.food <= 20 &&
                  s2.window >= 0 && s2.window <= 8 && s2.trust >= 0 && s2.trust <= 100;
    if (!legal) { settleFails++; A.push('   ❌ ' + node.id + ' 资源越界 ' + JSON.stringify({ men: s2.men, food: s2.food, window: s2.window, trust: s2.trust })); }
  } catch (e) { settleFails++; A.push('   ❌ ' + node.id + ' 抛错: ' + e.message); }
}
ok('逐节点结算无越界/无异常 (' + settleCount + ' 个节点)', settleFails === 0, settleFails + ' 失败');

/* ---------- 6. compute 纯函数产出有限数值 ---------- */
let compFails = 0;
NODES.forEach(n => (n.options || []).forEach(o => {
  try { fresh(); const r = Game.compute(n, o);
    if (!r || typeof r.d.men !== 'number' || !isFinite(r.d.men) || !isFinite(r.d.food) || !isFinite(r.d.trust)) compFails++; }
  catch (e) { compFails++; }
}));
ok('compute 产出有限数值', compFails === 0, compFails + ' 异常');

/* ---------- 7. 行军结算 + 慈善补给 ---------- */
fresh(); const bF = Store.s.food, bW = Store.s.window;
Game.apply(BALANCE.march);
ok('行军：粮-1 时-1', Store.s.food === bF - 1 && Store.s.window === bW - 1, '粮' + Store.s.food + ' 时' + Store.s.window);
fresh(); Store.s.food = 0; Store.s.trust = 70; Store.s.flags.charityCount = 0;
const ch = Game.charityTop();
ok('慈善补给触发（民≥70 且断粮）', ch === true && Store.s.food === BALANCE.charity.food, '粮' + Store.s.food);

/* ---------- 8. 违纪清算路径 ---------- */
try { fresh(); Sin.register({ type: '纪律', n: 3 }); Sin.tick(); Sin.shouldTrigger(); Sin.collect(NODES[0]); ok('违纪清算路径可触发', true); }
catch (e) { ok('违纪清算路径可触发', false, e.message); }

/* ---------- 9. 终章念名字 + 名单墙 ---------- */
try { fresh(); Store.s.flags.sawEnding = false; Ending.run(); Wall.hang(); ok('终章念名字 + 名单墙可运行', true); }
catch (e) { ok('终章念名字 + 名单墙可运行', false, e.message); }

/* ---------- 10. 下一程（部队打散）重开降编 ---------- */
fresh(); const mc0 = Store.s.menCap;
try { Flow.restart(); ok('下一程重开降编 5（下限30）', Store.s.menCap === Math.max(30, mc0 - 5), 'menCap ' + Store.s.menCap); }
catch (e) { ok('下一程重开降编 5（下限30）', false, e.message); }

/* ---------- 11. 存档码往返 ---------- */
fresh(); Store.s.at = 'g5'; Store.save();
const code = Store.exportCode();
const imp = Store.importCode(code);
ok('存档码非空且可回读', !!code && code.length > 10 && imp && Store.s.at === 'g5', code ? code.slice(0, 18) + '…' : '空');

/* ---------- 12. 数据引用无悬空 ---------- */
const refFails = [];
NODES.forEach(n => {
  (n.options || []).forEach(o => {
    if (o.outcomeCard && !CARDS[o.outcomeCard]) refFails.push(n.id + '.opt.outcomeCard=' + o.outcomeCard);
    if (o.recruit && !COMRADES[o.recruit]) refFails.push(n.id + '.opt.recruit=' + o.recruit);
    (o.gain || []).forEach(it => { if (!ITEMS[it]) refFails.push(n.id + '.opt.gain=' + it); });
  });
  (n.gainCards || []).forEach(c => { if (!CARDS[c]) refFails.push(n.id + '.gainCards=' + c); });
  (n.gain || []).forEach(it => { if (!ITEMS[it]) refFails.push(n.id + '.gain=' + it); });
  (n.lore || []).forEach(h => { if (!HISTORY.find(x => x.id === h)) refFails.push(n.id + '.lore=' + h); });
  if (n.recruit && !COMRADES[n.recruit]) refFails.push(n.id + '.recruit=' + n.recruit);
});
ok('数据引用无悬空（卡/道具/战友/史料）', refFails.length === 0, refFails.slice(0, 8).join(' | '));

/* ---------- 13. Game3D 启动 + 帧tick 不崩（桩 DOM） ---------- */
try {
  const Game3D = sandbox.window.Game3D;
  const fakeVmap = { focus() { return true; }, project() { return { x: 0, y: 0, visible: false }; } };
  Game3D.setNodes(NODES.map(n => ({ id: n.id, name: n.name, x: 0, z: 0, h: 6 })));
  Game3D.init(fakeVmap);
  fakeVmap.project = () => ({ x: 10, y: 10, visible: true });
  Game3D._tick();
  ok('Game3D.init + _tick 启动无异常', true);
} catch (e) { ok('Game3D.init + _tick 启动无异常', false, e.message + '\n' + (e.stack || '')); }

report();
process.exit(fails ? 1 : 0);

function report() {
  console.log('\n===== 长征 3D 玩法诊断 ' + (fails ? '❌ 未通过' : '✅ 全部通过') + ' =====');
  console.log(A.join('\n'));
  console.log('———————————————————————————');
  console.log('通过 ' + (A.length - fails) + ' / ' + A.length + (fails ? ('，失败 ' + fails) : '，零失败'));
}

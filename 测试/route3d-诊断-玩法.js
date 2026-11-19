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

/* ---------- 4b. 跳过一条分支后，指引不能把玩家送回上一格 ---------- */
const flatEdges = EDGES.filter(([a, b]) => NODE_MAP[a].y === NODE_MAP[b].y);
ok('路线前后关系可由 y 判定', flatEdges.length === 0,
   flatEdges.map(([a, b]) => a + '-' + b).join(','));
fresh();
Store.s.done = { g1: true, e_y2: true };
Store.s.at = 'h_w1';
const nsSkip = Game.nextNodes().map(n => n.id);
ok('跳过 e_y1 后，从合流点不推荐回头', !nsSkip.includes('e_y1') &&
   (nsSkip.includes('e_s1') || nsSkip.includes('e_s2')), nsSkip.join(','));
Store.s.at = 'e_y1'; Store.s.done.h_w1 = true;
const nsBack = Game.nextNodes().map(n => n.id);
ok('回到漏掉的分支后，下一站仍指向前方', nsBack[0] === 'h_w1', nsBack.join(','));

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
fresh();
Sin.register({ type: 'mass', n: 1 }); Sin.tick();
ok('未到三笔账不触发', !Sin.shouldTrigger());
Sin.register({ type: 'battle', n: 2 });
const countdown = Store.s.reckonIn;
Sin.tick();
ok('新账当格不倒计时', !Sin.shouldTrigger() && Store.s.reckonIn === countdown && !Store.s.reckonFresh);
for (let i = 0; i < countdown; i++) Sin.tick();
ok('自然 register/tick 后必触发，类型和教训保留', Sin.shouldTrigger() && Store.s.reckonPending === 'battle' && Store.meta.lessons.mass && Store.meta.lessons.battle);
const realOpen = Engine.Modal.open;
let modal;
Engine.Modal.open = opts => { modal = opts; return { close() {} }; };
Sin.collect(NODES[0]);
ok('清算展示纪律规则与第三次提示', modal.html.includes(DISCIPLINE.battle.rule) && modal.actions.length === 1);

/* ---------- 9. 终章念名字 + 名单墙 ---------- */
try { fresh(); Store.s.flags.sawEnding = false; Ending.run(); Wall.hang(); ok('终章念名字 + 名单墙可运行', true); }
catch (e) { ok('终章念名字 + 名单墙可运行', false, e.message); }

/* ---------- 10. 下一程（部队打散）重开降编 ---------- */
fresh(); Store.checkpoint = null;
Store.s.at = 'g5'; Store.s.items = ['it_letter']; Store.s.board.names = ['小谢'];
Store.snapshot();
Flow.nextCheng(NODE_MAP.g5); modal.actions[0].onClick();
ok('打散原地接续、降编8、少一张卡、不清道具', Store.s.at === 'g5' && Store.s.run === 2 && Store.s.runsFailed === 1 && Store.s.menCap === 92 && Store.s.hand.length === 5 && Store.s.items[0] === 'it_letter');
Store.s.at = 'g6'; Store.s.done.g6 = true;
Flow.warnEnd('mass', NODE_MAP.g6);
ok('违纪回滚路线但不倒退失败计数与兵力上限', Store.s.at === 'g5' && !Store.s.done.g6 && Store.s.run === 3 && Store.s.runsFailed === 1 && Store.s.runsWarn === 1 && Store.s.menCap === 76 && Store.s.sin === 0);
Flow.nextCheng(NODE_MAP.g5);
ok('打散与违纪混合第三次结束', modal.title === '没有走到吴起镇' && Store.meta.plays === 3 && Store.meta.wall.length === 2 && Store.meta.warnWall.length === 1);
ok('失败终章有分享入口', modal.actions[0].text === '导出这一程');
modal.actions[1].onClick();
ok('终章确认后开启新局，名单保留', Store.s.run === 1 && Store.meta.wall[0].names[0] === '小谢');
fresh(); Store.checkpoint = null;
Store.s.runsWarn = 1; Store.s.runsFailed = 1;
Flow.warnEnd('battle', NODE_MAP.g1);
ok('第三次违纪也结束并进入警示墙', modal.title === '没有走到吴起镇' && Store.meta.warnWall.length === 1);
fresh(); Store.s.log = [{ kind: 'march', place: '于都' }];
Ending.run();
ok('胜利终章含战史、刻名与导出', modal.html.includes('chronicle-line') && modal.html.includes('carve-stage') && modal.actions[0].text === '导出这一程');
ok('战史模板与分享码使用真实状态', Engine.Chronicle.template('白话').includes('1 格') && /^[0-9A-Z]{6}$/.test(Engine.Share.code()));
modal.actions[1].onClick();
ok('胜利挂墙计数并重开', Store.meta.wins === 1 && Store.meta.plays === 1 && Store.s.at === 'g1');
fresh();
Store.s.mem = [{ tag: 'saved', text: '旧3D内容' }, { kind: 'saved', what: '旧2D内容', place: '于都' }];
Engine.Memory.add('saved', '新记忆'); Pages.memory();
ok('3D兼容两种旧记忆且新写入统一格式', modal.html.includes('旧3D内容') && modal.html.includes('旧2D内容') && Store.s.mem[2].what === '新记忆' && !!Store.s.mem[2].place);
Engine.Modal.open = realOpen;

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

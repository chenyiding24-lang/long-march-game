/* ============================================================
   QM-1 应用脚本 —— 把 qm/qm1-待接入数据包.js 幂等并入 游戏/data.js
   用法： node qm/qm1-应用脚本.js [--dry-run]

   ★ 幂等：已接入过就只打印状态并退出 0，不会重复 push。
   ★ 采用「末尾数据装配」：保留 data.js 里全部原有注释与分组，
     也避免括号匹配改坏 391 行 NODES / 19 包装配段。
   ★ 装配段只做数组并入与对象合并，不含任何玩法逻辑。
   ★ 本脚本会改写 游戏/data.js，须主理人审批后运行；
     接完必跑：node 测试/data校验.js 游戏/data.js --对账
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, '游戏', 'data.js');
const pack = require(path.join(ROOT, 'qm', 'qm1-待接入数据包.js'));
const MARK = '/* QM-1 内容深度线装配';
const DRY = process.argv.indexOf('--dry-run') >= 0;

let src = fs.readFileSync(DATA, 'utf8');
if (src.indexOf(MARK) >= 0) {
  console.log('data.js 已含 QM-1 装配段，跳过（幂等）。如需重装，先还原 备份-20261106-改动前/data.js');
  process.exit(0);
}

const j = (v) => JSON.stringify(v, null, 2);

/* ① 新事件 push 进 MOVE_EVENTS；② 草地皮 push 进 mv_ford / mv_local 的 variants；
   ③ 过场 Object.assign 进已存在的 CUTSCENES（19 包已声明，勿重复 const）。 */
const block = [

  MARK + '（由 qm/qm1-应用脚本.js 生成 · QM-1 内容深度线） ============================\n' +
  '   source: qm/qm1-待接入数据包.js\n' +
  '   只做数据并入，不含玩法逻辑；data校验.js --对账 会逐载体验收锚点。\n' +
  '   ============================================================ */',

  '(function () {',
  '  /* ① 新增区域专属行进事件：草地主线 3 条 + 甘南开仓 1 条 */',
  '  Array.prototype.push.apply(MOVE_EVENTS, ' + j(pack.QM1_MOVE_EVENTS) + ');',
  '',
  '  /* ② 地域皮：草地的涨水(mv_ford) / 问路(mv_local) 变体（带 region，pickVariant 按当前格 region 过滤） */',
  '  var f1 = MOVE_EVENTS.find(function (m) { return m.id === "mv_ford"; });',
  '  if (f1) { if (!f1.variants) f1.variants = []; f1.variants.push(' + j(pack.QM1_REGION_VARIANTS.mv_ford).replace(/^\[|\]$/g, '').trim() + '); }',
  '  var f2 = MOVE_EVENTS.find(function (m) { return m.id === "mv_local"; });',
  '  if (f2) { if (!f2.variants) f2.variants = []; f2.variants.push(' + j(pack.QM1_REGION_VARIANTS.mv_local).replace(/^\[|\]$/g, '').trim() + '); }',
  '',
  '  /* ③ 过场（Q3 贺捷生替代方案：白沙场·托付纸条；可选，须拍板）。',
  '     CUTSCENES 已由 19 包声明，此处只合并、不重复 const。 */',
  '  if (typeof CUTSCENES !== "undefined") Object.assign(CUTSCENES, ' + j(pack.QM1_CUTSCENES) + ');',
  '})();',
  ''
].join('\n');

const out = src.replace(/\s*$/, '\n\n') + block + '\n';

if (DRY) {
  console.log('[dry-run] 将追加 ' + block.length + ' 字符；新事件 ' + pack.QM1_MOVE_EVENTS.length +
    ' 条，草地皮 ' + (pack.QM1_REGION_VARIANTS.mv_ford.length + pack.QM1_REGION_VARIANTS.mv_local.length) +
    ' 段，过场 ' + Object.keys(pack.QM1_CUTSCENES).length + ' 段');
  process.exit(0);
}

fs.writeFileSync(DATA, out, 'utf8');
console.log('已写入：' + DATA);
console.log('  新事件 ' + pack.QM1_MOVE_EVENTS.length + ' 条 / 草地皮 ' +
  (pack.QM1_REGION_VARIANTS.mv_ford.length + pack.QM1_REGION_VARIANTS.mv_local.length) +
  ' 段 / 过场 ' + Object.keys(pack.QM1_CUTSCENES).length + ' 段');
console.log('下一步：node 测试/data校验.js 游戏/data.js --对账');

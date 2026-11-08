/* ============================================================
   应用 19 号数据包 —— 把 19 的新增内容并入 游戏/data.js
   用法： node 测试/应用-19数据包.js [--dry-run]

   ★ 幂等：已接入过就只打印状态并退出 0，不会重复 push。
   ★ 采用「末尾数据装配」而不是重写数组字面量：保留 data.js 里全部
     原有注释与分组（尤其 MOVE_EVENTS 上方的 anch 口径说明），
     也避免括号匹配改坏 391 行 NODES。
   ★ 装配段只做数组并入与字段合并，不含任何玩法逻辑。
   ★ 接入后必跑：node 测试/data校验.js 游戏/data.js --对账
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, '游戏', 'data.js');
const pack = require(path.join(ROOT, '19-新增内容-待接入数据包.js'));
const MARK = '/* 比赛版新增内容装配';
const DRY = process.argv.indexOf('--dry-run') >= 0;

let src = fs.readFileSync(DATA, 'utf8');
if (src.indexOf(MARK) >= 0) {
  console.log('data.js 已含装配段，跳过（幂等）。如需重装，先还原 备份-20261106-改动前/data.js');
  process.exit(0);
}

const j = (v) => JSON.stringify(v, null, 2);

/* CG 分镜表（18 §九）：motion 是运镜，weather 是天气粒子层，二者都由 Router.open 读取 */
const CG_ART = {
  'cg-01': { motion: 'pan-left',  weather: 'ember' },
  'cg-02': { motion: 'zoom-in',   weather: 'mist'  },
  'cg-03': { motion: 'pan-right', weather: 'snow'  },
  'cg-04': { motion: 'zoom-in',   weather: 'none'  },
  'cg-05': { motion: 'pan-left',  weather: 'mist'  },
  'cg-06': { motion: 'pan-right', weather: 'dust'  },
  'cg-07': { motion: 'zoom-in',   weather: 'none'  },
  'cg-08': { motion: 'pan-left',  weather: 'spray' },
  'cg-09': { motion: 'zoom-in',   weather: 'ember' },
  'cg-10': { motion: 'pan-right', weather: 'snow'  },
  'cg-11': { motion: 'pan-left',  weather: 'mist'  },
  'cg-12': { motion: 'zoom-in',   weather: 'dust'  },
  'cg-13': { motion: 'pan-up',    weather: 'mist'  },
  'cg-14': { motion: 'zoom-in',   weather: 'dust'  },
  'cg-15': { motion: 'pan-right', weather: 'dust'  },
  'cg-16': { motion: 'zoom-in',   weather: 'none'  },
  'cg-17': { motion: 'pan-left',  weather: 'rain'  },
  'cg-18': { motion: 'pan-right', weather: 'snow'  },
  'cg-19': { motion: 'pan-right', weather: 'dust'  },
  'cg-20': { motion: 'zoom-in',   weather: 'mist'  },
  'cg-21': { motion: 'zoom-in',   weather: 'none'  }
};

/* 16 个大关卡 → 分镜编号；node.art 优先，GATE_ART 兜底 */
const GATE_ART = {
  g1: 'cg-01', g2: 'cg-02', g3: 'cg-04',
  g4: 'cg-05', g4b: 'cg-05', g4c: 'cg-05',
  g5: 'cg-06', g6: 'cg-07', g7: 'cg-08', g7b: 'cg-09',
  g8: 'cg-10', g8b: 'cg-11', g9: 'cg-11',
  g10: 'cg-12', g11: 'cg-13', g12: 'cg-15'
};

const block = [

MARK + '（由 测试/应用-19数据包.js 生成 · 第十三轮） ============================================================\n' +
'   source: 19-新增内容-待接入数据包.js\n' +
'   只做数据并入，不含玩法逻辑；data校验.js --对账 会逐载体验收锚点。\n' +
'   可重复运行本脚本，但本段本身只应出现一次。\n' +
'   ============================================================ */',

'(function () {',
'  /* ① 6 条区域专属行进事件：带 localRegion，走独立地域池，不进主池 */',
'  Array.prototype.push.apply(MOVE_EVENTS, ' + j(pack.NEW_MOVE_EVENTS) + ');',
'',
'  /* ② 5 段地域皮：写成带 region 且自带 options 的变体，',
'     pickVariant() 里按当前格 region 过滤；不换 cost、不换事件级 options。 */',
'  var vf = MOVE_EVENTS.find(function (m) { return m.id === "mv_ford"; });',
'  if (!vf.variants) vf.variants = [];',
'  vf.variants.push(' + j(pack.REGION_VARIANTS.mv_ford).replace(/^\[|\]$/g, '').trim() + ');',
'',
'  var vl = MOVE_EVENTS.find(function (m) { return m.id === "mv_local"; });',
'  if (!vl.variants) vl.variants = [];',
'  vl.variants.push(' + j(pack.REGION_VARIANTS.mv_local).replace(/^\[|\]$/g, '').trim() + ');',
'',
'  /* ③ 三个已有节点升格：只加文本与 CG 挂点，不动 NODES 数量 / EDGES / BALANCE。',
'     sourceNote 里的「待核」是史料纪律，核到权威出处前不得升级为 A。 */',
'  var P = ' + j(pack.NODE_PATCHES) + ';',
'  Object.keys(P).forEach(function (id) {',
'    var n = NODES.find(function (x) { return x.id === id; });',
'    if (n) Object.assign(n, P[id]);',
'  });',
'})();',
'',
'/* ④ 人物篇目过场：无交互 cinematic，由 game.js 在指定节点之后播放一次 */',
'const CUTSCENES = ' + j(pack.CUTSCENES) + ';',
'',
'/* ⑤ CG 分镜表（18 §九）：Router.open 按 art 查出运镜与天气粒子 */',
'const CG_ART = ' + j(CG_ART) + ';',
'',
'/* ⑥ 大关卡分镜兜底：showLore 在 node.art 缺失时按节点 id 查 */',
'const GATE_ART = ' + j(GATE_ART) + ';',
'',
'/* ⑦ 战史官 prompt 与战友兜底台词（19 §5 / §6）。',
'     守卫正则写在 game.js 里 —— 正则经 JSON.stringify 会变成空对象，不能放数据层。 */',
'const CHRONICLE_PROMPT = ' + j(pack.CHRONICLE_PROMPT) + ';',
'const NPC_LINES = ' + j(pack.NPC_LINES) + ';',
''
].join('\n');

const out = src.replace(/\s*$/, '\n\n') + block + '\n';

if (DRY) {
  console.log('[dry-run] 将追加 ' + block.length + ' 字符；新事件 ' + pack.NEW_MOVE_EVENTS.length +
    ' 条，地域变体 ' + (pack.REGION_VARIANTS.mv_ford.length + pack.REGION_VARIANTS.mv_local.length) + ' 段，节点补丁 ' +
    Object.keys(pack.NODE_PATCHES).length + ' 处，过场 ' + Object.keys(pack.CUTSCENES).length + ' 段');
  process.exit(0);
}

fs.writeFileSync(DATA, out, 'utf8');
console.log('已写入：' + DATA);
console.log('  新事件 ' + pack.NEW_MOVE_EVENTS.length + ' 条 / 地域变体 ' +
  (pack.REGION_VARIANTS.mv_ford.length + pack.REGION_VARIANTS.mv_local.length) +
  ' 段 / 节点补丁 ' + Object.keys(pack.NODE_PATCHES).length +
  ' 处 / 过场 ' + Object.keys(pack.CUTSCENES).length + ' 段');
console.log('下一步：node 测试/data校验.js 游戏/data.js --对账');

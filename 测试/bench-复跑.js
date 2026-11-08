/* ============================================================
   数值复跑（无头 Edge + 真引擎）—— 可复现，替代手工复制结果
   用法： node 测试/bench-复跑.js [每策略局数，默认 125] [--out 文件名]

   每种策略一次独立页面加载（15 号文档：单页跑 500 局会把无头堆拖爆）。
   输出与 15 §三 的 C11 基线逐条对照，验收线：
     perfect 125/125 且一命率 <10%；novice 全部通关但几乎局局死人；
     chaos 通关率约 50%、期望约 2 条命。
   ★ 不改任何代码，只是读取 bench-harness.html 的 #bench-out。
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const HARNESS = 'file:///' + path.join(ROOT, '测试', 'bench-harness.html').replace(/\\/g, '/');
const GAMES = Math.max(1, +(process.argv[2] || 125));
const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? path.join(ROOT, '测试', process.argv[i + 1]) : null;
})();
const onlyIdx = process.argv.indexOf('--only');
const STRATEGIES = onlyIdx >= 0 ? [process.argv[onlyIdx + 1]] : ['perfect', 'veteran', 'novice', 'chaos'];
const setIdx = process.argv.indexOf('--set');
const SET = setIdx >= 0 ? process.argv[setIdx + 1] : null;   /* 例如 --set regionP=0 做对照 */

if (!fs.existsSync(EDGE)) { console.error('找不到 Edge：' + EDGE); process.exit(1); }

const results = {};
for (const st of STRATEGIES) {
  const udd = path.join(os.tmpdir(), 'cwqs-bench-' + st);
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--user-data-dir=' + udd.replace(/\\/g, '/'),
    '--virtual-time-budget=180000',
    '--dump-dom',
    HARNESS + '?only=' + st + '&games=' + GAMES + (SET ? '&set=' + SET : '')
  ];
  let dom = '';
  try {
    dom = execFileSync(EDGE, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300000,
      stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    console.error(st + ' 无头执行失败：' + e.message);
    results[st] = { error: e.message };
    continue;
  }
  const m = dom.match(/<pre id="bench-out">([\s\S]*?)<\/pre>/);
  if (!m) { console.error(st + ' 没抓到 #bench-out'); results[st] = { error: 'no output' }; continue; }
  const text = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  let o;
  try { o = JSON.parse(text); }
  catch (e) { console.error(st + ' 输出不是 JSON，前 200 字：' + text.slice(0, 200)); results[st] = { error: 'bad json' }; continue; }
  if (text.startsWith('ERR')) { results[st] = { error: text.slice(0, 400) }; continue; }
  const s = o.summary || {};
  results[st] = {
    games: s['局数'], wins: s['通关'], rate: s['通关率'],
    expectedLives: s['期望命数'], medianLives: s['中位命数'],
    failReasons: s['失败原因'], endMen: s['通关局终局兵'], sinPeak: s['通关局违纪峰值'],
    regionP: o.balance && o.balance.regionP,
    init: o.balance && o.balance.init
  };
  console.log(st.padEnd(9) + ' 通关 ' + String(s['通关']).padStart(3) + '/' + String(s['局数']).padStart(3) +
    '　率 ' + String(s['通关率']).padStart(5) + '　期望命数 ' + String(s['期望命数']).padStart(4) +
    '　终局兵 ' + String(s['通关局终局兵']).padStart(5));
}

console.log('\n=== 对照 15 §三 的 C11 基线 ===');
console.log('基线：perfect 125/125（一命 6.4%）/ veteran 125/125（5.6%）/ novice 125/125（0 局不死人）/ chaos 62/125（49.6%，期望 2.02 命）');
console.log('本次 regionP=' + (results.chaos && results.chaos.regionP) + '（新增的地域分流，总触发率不变）');
const c = results.chaos || {};
if (c.rate != null) {
  const ok = c.rate >= 0.45 && c.rate <= 0.55;   /* 17 §5.4 的验收带，别放太宽 */
  console.log('chaos 通关率 ' + c.rate + '：' + (ok ? '✅ 落在 45～55% 验收带' :
    '⚠ 偏离 45～55% 验收带，先别上线；回看新事件 cost 或把 regionP 设 0'));
}

if (OUT) {
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), games: GAMES, results }, null, 2) + '\n', 'utf8');
  console.log('\n结果已存：' + OUT);
}

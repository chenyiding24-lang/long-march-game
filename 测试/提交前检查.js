#!/usr/bin/env node
/**
 * 提交前检查（T7 用）
 * 复跑发布自检 + 引擎冒烟 + data 校验；可选 --bench 跑 500 局。
 * 检查 map.html 全部 ?v= 版本号一致。
 * 注意：本脚本只「检查」与「回归」，不自动 bump 版本号（bump 留给提交当天手动确认，避免提前破坏边缘缓存）。
 *
 * 用法：
 *   node 测试/提交前检查.js           # 跑三件套
 *   node 测试/提交前检查.js --bench   # 三件套 + 500 局 bench
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const rel = p => path.join(ROOT, p);

const doBench = process.argv.includes('--bench');
const log = [];
let ok = true;

function step(name, fn) {
  try {
    fn();
    log.push('  PASS  ' + name);
  } catch (e) {
    ok = false;
    const msg = (e && e.message) ? e.message.toString().split('\n')[0] : String(e);
    log.push('  FAIL  ' + name + ' :: ' + msg);
  }
}

function run(cmd) {
  // execSync 在非零退出码时抛错；用 ignore/stdout 收输出，只看退出码
  execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// 1. 全部 ?v= 版本号一致
step('全部 ?v= 引用版本号一致', () => {
  const html = fs.readFileSync(rel('游戏/map.html'), 'utf8');
  const vs = [...html.matchAll(/[?&]v=(\d+)/g)].map(x => x[1]);
  if (!vs.length) throw new Error('map.html 未找到 ?v= 引用');
  const set = [...new Set(vs)];
  if (set.length !== 1) throw new Error('版本号不一致: ' + set.join(','));
});

// 2. 发布自检（18 项）
step('发布自检 node 测试/发布自检.js', () => run('node 测试/发布自检.js'));

// 3. 引擎冒烟
step('引擎冒烟 node 测试/引擎冒烟.js', () => run('node 测试/引擎冒烟.js'));

// 4. data 校验（带对账）
step('data 校验 node 测试/data校验.js 游戏/data.js --对账', () => run('node 测试/data校验.js 游戏/data.js --对账'));

// 5. 可选 bench
if (doBench) {
  step('bench 500 局 node 测试/bench-复跑.js 125 --out bench-结果-提交.json', () =>
    run('node 测试/bench-复跑.js 125 --out bench-结果-提交.json'));
}

console.log('\n=== 提交前检查 ===');
console.log(log.join('\n'));
console.log('\n汇总: ' + (ok ? 'ALL PASS ✅' : '存在 FAIL ❌，先修再提交'));

if (!ok) process.exit(1);

console.log('\n=== 提交当天手动 bump 步骤（改完再跑本脚本确认） ===');
console.log('1. 游戏/map.html 的 ?v= 必须保持一致（当前值见上面自检「版本号一致」那条；每次部署前若有改动就整体 +1，避免边缘缓存串味）');
console.log('2. 若已出 CG 图，游戏/art/ 引用也换号');
console.log('3. 重新跑本脚本确认「全部 ?v= 引用版本号一致」项通过');
console.log('4. 手机+电脑各点开走一格，确认无 Console 报错、存档码可复制');
console.log('5. 提交作品链接 + 25 手记 + 26 视频，18:00 前（官网死线 10:00）\n');

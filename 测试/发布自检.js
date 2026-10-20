/* ============================================================
   发布自检 —— 交给托管方（千问办公等）在设置网址前/后各跑一次
   用法：node 测试/发布自检.js
   全部通过退出码 0；有任何一项不通过退出码 1 并打印原因。
   这份检查的目的是：证明《长征：万水千山》是零依赖纯静态站，
   不需要构建、不需要后端、不需要任何外链资源。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, '游戏');            /* ← 站点根目录 */
const ok = [], bad = [];
const pass = m => ok.push(m);
const fail = m => bad.push(m);

/* ---------- 1. 站点清单 ---------- */
const MUST = ['index.html', 'style.css', 'data.js', 'game.js', 'favicon.svg'];
const EXTRA_OK = new Set([...MUST]);
if (!fs.existsSync(SITE)) fail('找不到站点根目录：' + SITE);
else {
  const files = fs.readdirSync(SITE).filter(f => fs.statSync(path.join(SITE, f)).isFile());
  MUST.forEach(f => fs.existsSync(path.join(SITE, f)) ? pass(f + ' 存在') : fail('缺少必发文件 游戏/' + f));
  const extra = files.filter(f => !EXTRA_OK.has(f));
  if (extra.length) fail('游戏/ 里出现清单外的文件（发布前请确认是否该发）：' + extra.join('、'));
  else pass('游戏/ 下正好 5 个文件，无多余产物');
}

const read = f => path.join(SITE, f);
const src = name => { try { return fs.readFileSync(read(name), 'utf8'); } catch (e) { return ''; } };
const html = src('index.html'), css = src('style.css'), data = src('data.js'), js = src('game.js');
const ALL = { 'index.html': html, 'style.css': css, 'data.js': data, 'game.js': js };

/* ---------- 2. 零外链：不许有 CDN / 远程字体 / 网络请求 ---------- */
/* www.w3.org/2000/svg 是 SVG 命名空间声明，不是请求，白名单 */
const NS = 'http://www.w3.org/2000/svg';
Object.keys(ALL).forEach(name => {
  const t = ALL[name].split(NS).join('');
  const net = t.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+|@import[^;]*|url\(\s*["']?https?:\/\//gi);
  if (net) fail(name + ' 含外链资源（本站必须零外链，否则离线/内网打不开）：' + net.join(' | '));
});
Object.keys(ALL).forEach(name => {
  const t = ALL[name];
  const api = t.match(/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|new WebSocket|EventSource|import\s*\(|from\s+['"][^'"]+['"]/g);
  if (api) fail(name + ' 含网络请求或 ES module 语法（破坏 file:// 双击可玩）：' + api.join(' | '));
});
if (!bad.some(b => /外链|module/.test(b))) pass('零外链、零网络请求、零构建：classic script + 相对路径');

/* ---------- 3. 本地绝对路径：换机器就废，禁止 ---------- */
['C:\\', 'D:\\', 'file:///', '/Users/', 'Desktop'].forEach(p => {
  Object.keys(ALL).forEach(name => {
    if (ALL[name].includes(p)) fail(name + ' 出现本机绝对路径「' + p + '」，发布前必须改成相对路径');
  });
});
if (!bad.some(b => /绝对路径/.test(b))) pass('无本机绝对路径（拷到任何机器/任何域名都可用）');

/* ---------- 4. 入口与资源引用对得上 ---------- */
const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"'#]+)["']/g)].map(m => m[1])
  .filter(u => !/^data:/.test(u));
refs.forEach(u => fs.existsSync(path.join(SITE, u)) ? null : fail('index.html 引用了不存在的文件：' + u));
if (refs.length && !bad.some(b => /引用了不存在/.test(b))) pass('index.html 的 ' + refs.length + ' 个本地引用全部命中：' + refs.join('、'));
if (/charset="utf-8"/i.test(html)) pass('charset=utf-8 已声明（中文剧情不乱码）'); else fail('index.html 缺 charset=utf-8');
if (/name="viewport"/.test(html)) pass('有 viewport（手机端能自适应）'); else fail('index.html 缺 viewport，窄屏会挤坏');

/* ---------- 5. 只有一个全局入口，不需要后端 ---------- */
if (/localStorage/.test(js) && !/sessionStorage|document\.cookie|Authorization|Bearer /.test(js))
  pass('存档只用 localStorage：无需登录、无需后端、无需数据库');
else fail('存档方式异常：请确认是否引入了需要后端的状态');

/* ---------- 6. 游戏数据自校验（复用同一套规则） ---------- */
try {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'data校验.js'), read('data.js')], { encoding: 'utf8' });
  const errBlock = out.split('=== 提示 ===')[0];
  const errs = (errBlock.split('=== 错误 ===')[1] || '').trim();
  if (errs && errs !== '（无）') fail('data.js 数据校验未通过：\n' + errs);
  else pass('data.js 校验 0 错误（' + (out.match(/节点 \d+ \/ 边 \d+ \/ 移动事件 \d+ \/ 史料 \d+ \/ 卡 \d+ \/ 道具 \d+/) || [''])[0] + '）');
} catch (e) { fail('无法运行 data校验.js：' + e.message); }

/* ---------- 7. 语法 ---------- */
[['game.js', js], ['data.js', data]].forEach(([name, t]) => {
  try { new Function(t); pass(name + ' 语法通过'); } catch (e) { fail(name + ' 语法错误：' + e.message); }
});

/* ---------- 报告 ---------- */
const size = f => (fs.existsSync(read(f)) ? (fs.statSync(read(f)).size / 1024).toFixed(1) + ' KB' : '—');
console.log('\n《长征：万水千山》发布自检\n站点根目录：游戏/   发布清单：' + MUST.join(' / '));
console.log('单站总体积：' + MUST.map(size).join(' + ') + '\n');
ok.forEach(m => console.log('  [OK]   ' + m));
if (bad.length) { console.log('\n=== 必须处理 ===\n' + bad.map(b => '  [FAIL] ' + b).join('\n')); }
else console.log('\n结论：可直接作为静态站发布 —— 把 游戏/ 里的 ' + MUST.length + ' 个文件当网站根目录，' +
  'index.html 即首页；不需要 npm install、不需要构建、不需要后端。');
console.log('\n发布后请人工确认（脚本管不了的两件事）：');
console.log('  1) 手机上竖屏 / 横屏各打一格的观感（样式做了 760px / 430px / hover:none 三档）；');
console.log('  2) 网址换了 origin，localStorage 是新的 —— 本机 file:// 的旧进度不会出现在线上，这是预期。');
process.exit(bad.length ? 1 : 0);

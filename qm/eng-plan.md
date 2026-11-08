# 《长征：万水千山》QM 技术线实施计划
## 范围：QM-2(3D 部分) · QM-3(AI 原生) · QM-4(性能部分)
**负责人**：程基岩（engineering-lead）　**基线日期**：2026-11-07　**当前版本号**：`?v=12`
**铁律遵守**：不直改 `游戏/` 任何文件（仅本 `qm/eng-plan.md` 与 diff 提案）；零外链/零构建/file://；BALANCE 十项不动；改动一律「diff 提案 + 接入说明」待审批；统一 bump。

---

## 0. 关键架构事实（先讲清，再评估）

- **3D 是「独立标签页」不是「页内模块」**：`index.html:30` 用 `<a class="nav-3d" href="route3d.html?v=12" target="_blank">` 新开标签；`游戏/game.js` 全文 **零处** 引用 `VoxelMap`/`route3d`/`iframe`。
  - 推论：主游戏 `index.html` 首屏 **永远不创建 WebGL**（达标②）；`game.js` 的 430ms 2D 行军补间（`animateArmy`，`game.js:1215`）跑在**另一个标签**，不会与 3D 相机 tween 同窗打架。
  - **重要**：`22-体素大地图.md §4` 的「接入提示词」是按**页内可插拔模块**写的（pause on cinematic、跳过 2D 补间）。当前实现是**链接级独立页**，所以 go/no-go ⑥⑦ 在当前架构下是「靠分离+浏览器后台标签节流天然满足」，但 `22 §4.4/4.5` 设想的**显式桥接并未构建**。见 §2 提案。
- `route3d.html` 自包含：地图数据内联为 `<script type="application/json" id="map3d">`（`route3d.html:80`），封面纯 CSS（`route3d.html:14-23`），零 fetch/import/ESM/CDN（已扫✅，本人在 §1⑤ 复核）。
- AI 主仓零 fetch：`window.__CWQS_AI` 仅由 `部署/server.py` 在返回首页时注入（`部署/ai-channel.js`）；`file://` 双击 = 纯模板兜底（`27 §2.3`）。

---

## 1. 质量九条 · 逐条状态表（证据 + 结论）

| # | 验收项（22 §5） | 状态 | 代码侧证据 | 备注 / 剩余风险 |
|---|---|---|---|---|
| ① | 中低端安卓真机 low≥24fps（录屏为证） | **未实测**（代码侧 OK） | low：DPR≤1.25(`route3d:2433`)、LOD 更粗(`LOD_CELL_LO=[4.8,9.6,19.2]` `:2093`)、粒子仅 high(`if quality==='high'` `:2404`)、雾距×0.88(`:2320`)、流式 14ms 预算(`:2314`)；high DPR=**2.0**(`:2433/:2463`) | high 档 DPR 2.0 **超出 spec「≤1.6」**；真机帧率 `27 §五-5` 明确未验证。**须本人真机录屏** |
| ② | 默认关不建 WebGL 上下文 | **PASS** | 仅 `#enter` 点击(`:2579`)与 `?auto=1`(`:2614`)触发 `init`；无顶层 init 调用；`index.html` 仅链接 | 若日后改 iframe+`?auto=1` 内嵌，则主游戏首屏会建上下文——届时需守卫 |
| ③ | dispose 无残留 canvas/RAF/事件监听 | **PASS**（独立页） | `dispose()(2510-2537)`：cancelRAF→跑 `S.cleanups`(移除 5 个监听 `:2449-2453`)→删全部 GL buffer/VAO/program→`loseContext`→移除 canvas→`S.listeners={}` | `S.cleanups` 只含 canvas 级监听；页面级 `#enter/#btn-*` 监听(`:2556-2600`)不在 cleanups——独立页 OK，**页内复用须补**（见 G4） |
| ④ | 删体素层目录主游戏照常 | **PASS** | `game.js` 零引用 route3d；`index.html` 仅 `<a>` 链接 | 删文件后链接点击 404，但 `game.js` 不受影响、整局可玩 |
| ⑤ | 零外链 / 无 fetch / ESM / CDN | **PASS** | 内联 JSON 地图、纯 CSS 封面、无 fetch/import/cdn/http（全局扫✅） | 维持即可 |
| ⑥ | 弹窗开时停渲染，关闭恢复 | **结构 PASS**（靠标签分离+后台节流）；**显式桥接未建** | 独立页内无主游戏 cinematic 弹窗；`#btn-pause` 仅手动暂停(`:2592`) | 须本人确认「独立页」即最终形态；若要页内桥接，按 G1+G2+postMessage 补（见 §2）；另：暂停时未把 canvas「压暗 55%」(spec §4.4) |
| ⑦ | 3D 下 g7b→g8 连走 3 格无两套 tween 打架 | **结构 PASS**（分离） | `focus()` 设 `S.tween` 1.2s(`:2498-2504`，spec≈1.1s)；`setPath` 重置 tween(`:2505`)；`game.js animateArmy` 在另一标签 | 独立页天然无冲突；若要页内，须 `game.js` 在 3D 激活时**跳过 `animateArmy`** 仅调 `focus()`（见 §2 备注） |
| ⑧ | 体素配色与 CG-18 并排不跳色 | **代码侧 PASS**（待人工并排） | 四色严格命中 spec(`--red:#8C3B2E` 等 `:8` 及 map3d JSON `palette`)；`BIOME` lo/hi 全 <0.8(`:143-149`)；`WEATHER` `sat≤0.9,exp≤1.0`(`:171-202`) | 须本人把体素截图与 CG-18 并排肉眼核；当前无霓虹/HDR |
| ⑨ | 参考件无整段进入；`大地图-体素参考/` 仍 gitignore | **需人工 diff** | `route3d:90` 注释**坦承**「借鉴云山巨城 box/roof/body」（属 22 §六允许的「学做法」）；结构上未见整段复制 | 本人按 `22 §六` 做一次 diff；确认 `.gitignore` 仍排除参考件（提交前 `git status --short`） |

**小结**：②/③/④/⑤ 实打实 PASS；①需本人真机；⑥⑦ 因「独立页」架构天然满足但显式桥接缺失（推荐补轻量守卫）；⑧代码侧合格待并排；⑨需人工 diff。

---

## 2. 3D 代码侧守卫 / 计数器提案（diff 形式，未应用）

> 全部为**提案**。任何改动 `route3d.html` 须同步 bump `index.html:30,94` 的 `?v=12`。

**G1 · 引用计数 pause/resume（防多弹窗误恢复）**
```js
// VoxelMap state 增字段；pause/resume 改写
// S 内加：pauseRefs: 0
pause() {
  S.pauseRefs++; if (S.pauseRefs > 1) return;
  if (S.paused) return; S.paused = true;
  if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0;
  if (stage) stage.style.opacity = .45;   // 满足 spec「压暗 55%」意图
},
resume() {
  if (S.pauseRefs > 0) S.pauseRefs--;
  if (S.pauseRefs > 0) return;
  if (!S.paused || !S.inited) return;
  S.paused = false; S.last = performance.now();
  stage.style.opacity = 1; S.raf = requestAnimationFrame(frame);
}
```
ROI 高 · 风险 0 · 需本人拍板：**否**（纯加固，符合 spec）。

**G2 · `visibilitychange` 自动暂停（后台标签/未来页内模态都受益）**
```js
// init() 末尾或 bindEvents() 内追加：
const onVis = () => { if (document.hidden) VoxelMap.pause(); else VoxelMap.resume(); };
document.addEventListener('visibilitychange', onVis);
S.cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
```
ROI 中 · 风险 0 · 需本人拍板：**否**。

**G3 · 自适应降档看门狗（low-end 防卡死）**
```js
// frame() 内，S.fps 已每秒更新(:2422)；加：
if (S.fps && S.fps < 22) { S.lowStreak = (S.lowStreak||0)+1; } else { S.lowStreak = 0; }
if (S.lowStreak >= 3 && S.quality === 'high') {
  S.lowStreak = 0; VoxelMap.dispose(); VoxelMap.init({ mount: stage, quality: 'low' });
  err('已自动切到省电档（low）');   // 复用既有 err()
}
```
ROI 高 · 风险 低（dispose+init 已验证干净）· 需本人拍板：**否**（可选，建议加）。

**G4 · dispose 页内复用硬化（仅当改页内集成时需要）**
把 `#enter/#btn-view/#btn-legend/#btn-quality/#btn-pause/#btn-shot/#btn-exit/#sel-region` 与 `VoxelMap.on('nodePick')` 的监听器也推进 `S.cleanups`，使同页多次 init/dispose 不重复绑定。当前独立页无需，但**页内桥接前必做**。

**G5 · high DPR 2.0 → 1.6（对齐 spec）**
`route3d.html:2433` 与 `:2463` 的 `2.0` 改为 `1.6`。移动端 high 片元负载降约 1.56×。
ROI 中 · 风险 0 · 需本人拍板：**否**（纯对齐 spec；若主理人希望桌面 high 更锐利可保留 2.0）。

**页内桥接备注（若未来把 3D 从「独立页」改为「页内面板」）**：
- `game.js` 用 `postMessage` 向 iframe 发 `{type:'pause'|'resume'|'focus',nodeId}`；iframe 内 `window.addEventListener('message',...)` 调 `VoxelMap.pause/resume/focus`。
- `game.js openNode`/`animateArmy(1215)`：当 3D 激活时 `return` 跳过 430ms 2D 补间，只发 `focus(nodeId)`（满足 22 §4.5 / go-no-go ⑦）。
- 此改动**动 BALANCE 无关、零外链保持**，但属架构变更，需本人拍板。

---

## 3. AI 原生健壮性评估（Memory / Chronicle）

**既有强度（已扎实）**：
- `Chronicle.guard(:438-448)`：**长度 20–300 + 黑名单（胜利/伟大/领袖姓名/系统提示/AI 自曝）+ 数字白名单**（输出每个阿拉伯数字必须能在 `facts()` 找到）。这是最强一环，能挡住编年代、补结论。
- `Memory.guard(:500-503)`：12–40 字 + 黑名单（领袖/胜利/AI/模型/提示/忽略上文）。下限 12 对齐 `27 §2.2` 冒烟修正。
- `Chronicle.install(:461-468)`：先填模板、异步替换，**玩家永不空等**；`facts()` 只读 `Store.s.log` 且过滤 `digest`，数字全引擎给。
- 日志 schema 一致：`logStep(:1058-1070)` 给每条补 `place/region/run`；`march` 带 `hunger(:1209)`、`choice` 带 `sin/hunger(:1630)` → `facts()` 字段全部有源。**与日志事实一致性强。**
- `CHRONICLE_PROMPT`(data.js:1631) / `NPC_LINES`(data.js:1632) 均已接入；缺失时 `typeof` 守卫 + try/catch 优雅回模板。

**提升提案**：
- **A1 · `Chronicle.install` 异步竞态**：解析后只比对 `textContent`，未校验元素仍连在文档。改：
  ```js
  install(hostId, tone) {
    const el = document.getElementById(hostId); if (!el) return;
    el.textContent = this.template(tone);
    this.write(tone).then(t => {
      const now = document.getElementById(hostId);
      if (now && now.isConnected && t && t !== now.textContent) now.textContent = t;
    }).catch(() => {});
  }
  ```
  ROI 中 · 风险 0 · 拍板：**否**。
- **A2 · `Memory.refine` 缺事实一致性锁**：仅长度+黑名单，不像 Chronicle 有数字白名单。补：拒绝含「不在 `m.place/m.what` 中的数字」的输出（防模型编「救了3个人」）。ROI 低 · 拍板：**否**（可后补）。
- **A3 · `Memory.receipt` 随机取未读**：可能重复同句。建议按 `kind` 轮转或记录上次 index。ROI 低。
- **A4 · `NPC_LINES` 仅 8 条样本（27 §2.1）**：重玩易疲劳。建议按 `s.run` 取模换样。ROI 低。
- **A5 · 下限 20 字（Chronicle）**：极短合规方志可能被误拒回模板——可接受（模板亦合规），仅记录不修。

**结论**：Memory/Chronicle 健壮性已达标，红线（史实/结论全引擎给、越界回模板）守得牢。A1 建议顺手加；A2–A5 低优先级。

---

## 4. S4 军帐议事 / S6 追兵学你（安全「默认关」骨架 + bench 对比法）

**现状**：`game.js:49-50` `council:{enabled:false,every:6}`、`enemyLearn:{enabled:false,maxPerRun:1}` —— **仅配置，全仓无引用**（grep 确认），即「默认关」已结构性满足，但功能未实现。

**原则（铁律：不动 BALANCE C11；需先有真人数据再定）**：只做**默认关的空骨架 + 数据驱动渲染**，开关不开则完全不参与结算；任何 nudging 必须是**叠加层**，不编辑 `BALANCE`。

**S4 军帐议事（Council）骨架提案**：
```js
// 仅当 BALANCE.council.enabled 且存在本地基准集才渲染；事实全来自 Store.s 与本地 bench
const Council = {
  render() {
    if (!BALANCE.council.enabled) return;            // 默认关，直接返回
    const bench = window.__CWQS_BENCH;                // 由 测试/bench-结果-*.json 注入（可选）
    const s = Store.s;
    const lines = [
      '本局断粮 ' + (s.log.filter(e=>e.kind==='march'&&e.hunger).length) + ' 次',
      bench ? ('历史均值 ' + bench.avgHunger + ' 次') : ''
    ].filter(Boolean);
    Router.open({ title:'军帐议事', kicker:'只陈列本局与历史事实', html:'<p>'+lines.join(' · ')+'</p>',
      actions:[{text:'知道了',kind:'ghost'}] });
  }
};
```
- 不调用 AI 编结论；`__CWQS_BENCH` 缺省即只显本局事实。

**S6 追兵学你（enemyLearn）骨架提案**（叠加层，不碰 C11）：
```js
// rollMoveEvent / applyCombat 内，仅当 enabled 且本局未用满 maxPerRun：
function enemyMod() {
  if (!BALANCE.enemyLearn.enabled) return 0;
  if ((Store.s._enemyLearned||0) >= BALANCE.enemyLearn.maxPerRun) return 0;
  Store.s._enemyLearned = (Store.s._enemyLearned||0) + 1;
  return clamp(Store.s.run * 0.0, -0.05, 0.05);   // ±5% 极小幅，叠加在 BALANCE 之外
}
```
- `maxPerRun:1` 已锁死；幅度 ±5% 远小于 C11 校准带，理论上不破 45–55% 验收。

**bench 对比法（启用前必跑）**：
```bash
node 测试/bench-复跑.js 125 --out bench-结果-off.json        # 关 S6
# 临时把 enemyLearn.enabled=true，再跑：
node 测试/bench-复跑.js 125 --out bench-结果-on.json         # 开 S6
# 断言两者 chaos% 均在 45–55%、期望命 ≈1.87；否则回退
```
- **需本人拍板**：是（是否启用、幅度、是否接真人 bench 数据）。现在**只交骨架，默认关**。

---

## 5. Docker AI 通道实跑清单（依赖本人账号，给 step-by-step）

`部署/` 已就位：`ai-channel.js`(定义 `window.__CWQS_AI.ask`、3 次失败永久降级)、`server.py`(FastAPI、`/` 注入 channel、`/api/npc` 代理 ModelScope、限频 6/min/访客、401/429/超时/无 key 一律 `{"text":null}`)、`Dockerfile`(python:3.11-slim, uvicorn :7860)、`requirements.txt`(fastapi/uvicorn/httpx)。

1. **本人**：魔搭账号实名 → 建 **Static** 创空间（纯静态即可跑，无 AI；AI 可选 Docker 形态）。
2. 若要 AI：创空间选「自定义/Docker」形态，上传 `部署/` + `游戏/` + 根文档；`Dockerfile` 已正确 `COPY . /app` 且 `CMD uvicorn 部署.server:app`。
3. 空间「设置 → 环境变量」配 `MODELSCOPE_API_KEY`（可选 `MODELSCOPE_MODEL`，默认 `Qwen/Qwen2.5-7B-Instruct`）。**绝不硬编码、绝不进仓库/日志**。
4. 启动后访问 `/` → 首页 `</body>` 前被注入 `__CWQS_AI`；终章战史官在有 channel 时尝试替换模板。
5. 自测：开终章看战史官能否从模板→AI 句；**故意断网/错 key** → 自动回模板、控制台无红、玩家无感。
6. 限频 6 次/分/访客；连续 3 次失败前端 `dead=true` 永久降级。
7. **已知风险**：`server.py` 仅过 AST 语法检查（`27 §2.3`），**未实跑**；`/` 与 `/index.html` 注入不一致（后者走 StaticFiles 无 AI），二者均完整可玩，仅 AI 有无差异。

---

## 6. 性能静态剖析（QM-4）

**体素 high / low 量化**：世界 `WORLD_X≈1099, WORLD_Y≈1804`（`SPAN_*×SX/SY`），`CH=76.8` → 网格 `NXB×NZB = 15×24=360` 块上限；流式仅建相机周围(`updateChunks` `:2141`，14ms 预算)。
- low：`DPR≤1.25`、LOD 更粗、粒子关、雾距×0.88 → **已为移动端优化**。
- high：`DPR=2.0`（**超 spec 1.6**，G5 修）、粒子开、阴影感靠光照（无独立 shadow pass）。
- **draw call 数量**：流式分块 → 可见块 20–80 个 draw call，**超出 spec「≤8」**（`22 §一` 生成提示硬约束）。这是为「连续大世界流式加载」做的**有意取舍**，不在 9 条 go/no-go 内；若 low 真机 <24fps，可考虑把可见块合并进单动态 terrain VAO（大改、ROI 低，仅记录）。

**DOM 地图（主游戏 SVG）**：`#art-layer` viewBox 2000×4600，每次行军 `MapView` 重渲 + `#fog-ring/#sight-ring` 更新。移动端建议：`requestAnimationFrame` 合并「行军→重渲」调用（避免一次行军多次 layout）；`hand-tray/comrade-tray` 仅在变更时重建。**此属主游戏线，仅提示，不越界改。**

**移动端**：canvas 已 `touch-action:none`(`:13`)、`pointer*` 事件(`:2445`)✅；`#enter` 封面提示「手机用 low 档」✅。主要风险仍在 **high DPR 2.0** 与 **真机帧率未测**（①）。

**零外链/零构建保持**：以上优化均不引入依赖、不引 fetch、不改 file:// 可用性。

---

## 7. 按 ROI 排序的改动清单（总表）

| 序 | 改动 | 文件:行 | ROI | 风险 | 需本人拍板 | bump |
|---|---|---|---|---|---|---|
| 1 | G5 high DPR 2.0→1.6（对齐 spec，降移动端片元） | route3d:2433,2463 | 高 | 0 | 否 | 是 |
| 2 | G3 自适应降档看门狗（low-end 防卡死） | route3d frame()/init | 高 | 低 | 否 | 是 |
| 3 | G2 visibilitychange 自动暂停 | route3d bindEvents | 中 | 0 | 否 | 是 |
| 4 | G1 ref-counted pause/resume + 暂停压暗 | route3d VoxelMap | 中 | 0 | 否 | 是 |
| 5 | A1 Chronicle.install 竞态守卫 | game.js:461-468 | 中 | 0 | 否 | 是 |
| 6 | S4/S6 默认关骨架（仅骨架，默认关） | game.js BALANCE 区 + 新增 Council/enemyMod | 高(价值)/低(现优先级) | 低 | **是**（是否启用+幅度） | 是 |
| 7 | G4 dispose 页内硬化（仅页内桥接时需） | route3d | 低(现) | 0 | 否（但若页内则需拍板） | 是 |
| 8 | A2 Memory 数字白名单；A3/A4 轮换 | game.js Memory | 低 | 0 | 否 | 是 |
| 9 | draw-call 合并为单 terrain VAO | route3d | 低 | 高(大改) | 否 | 是 |

**待本人拍板/实跑清单**：① 真机 low≥24fps 录屏；② 确认「独立页」即最终形态（否则走页内桥接备注）；⑧ CG-18 并排核色；⑨ 参考件人工 diff + .gitignore 复核；S4/S6 是否启用与幅度；Docker 空间本人实名+建空间+实跑。

---
*本文为方案/规格，未修改 `游戏/` 任何文件。所有代码为 diff 提案，待主理人审批后由本人或主理人落地并实施 `?v=12→13` 统一 bump。*

# 部署 · 两种形态

## 一、Static（保底，随时可用）

把 `游戏/` 五个文件当站点根直接发布到魔搭创空间 Static 空间。
零依赖、零网络请求、`file://` 双击可玩。此时没有 AI 通道，
`Chronicle`（战史官）与 `Memory`（战友记忆）**自动走模板兜底**，作品完整可玩。

`测试/发布自检.js` 验的就是这一形态，18 项全绿才发。

## 二、Docker（线上增强，有 AI）

```
uvicorn 部署.server:app --host 0.0.0.0 --port 7860
```

- `server.py` 在返回首页时把 `ai-channel.js` 内联进 `</body>` 之前，
  于是线上版多出 `window.__CWQS_AI`，战史官与战友记忆会尝试让模型改写措辞。
- **主仓 `游戏/` 一个文件都不改**，所以本地静态版依旧零网络请求。
- 环境变量（在创空间「设置 → 环境变量」里配，**不要写进任何文件**）：
  - `MODELSCOPE_API_KEY` —— 必填才有 AI；没配时 `/api/npc` 返回 `{"text": null}`，静默降级。
  - `MODELSCOPE_MODEL` —— 可选，默认 `Qwen/Qwen2.5-7B-Instruct`。
- 账号须先绑阿里云并实名，否则 API-Inference 返回 401；每日额度约 2000 次，
  超额返回 429。公开试玩是全空间访客共用一个账号额度，所以后端做了单访客 6 次/分限频。

### 降级链（四道，玩家全程无感）

| 情况 | 结果 |
|---|---|
| 没配密钥 / 401 | `{"text": null}` → 模板 |
| 429 / 5xx / 超时(8s) | `{"text": null}` → 模板 |
| 前端连续 3 次失败 | `ai-channel.js` 永久关闭 AI → 模板 |
| 模型输出越界（领袖姓名、口号、日志外数字等） | `Chronicle.guard` / `Memory.guard` 整条丢弃 → 模板 |

**史实与结论永远由引擎给，模型只被允许改一句人话。** 这条边界同时是创作手记里
「AI 会不会把党史写歪」的答案。

## 三、部署前自检

```bash
cd "$(git rev-parse --show-toplevel)"   # 切到仓库根目录，别写死本机路径
node --check 游戏/game.js
node 测试/发布自检.js                 # 19/19
python -m py_compile 部署/server.py   # 语法
```

**如实说明**：本目录的 Python 服务只做过语法检查与静态审阅，
**尚未在魔搭创空间 Docker 空间里实跑过**（需要本人完成账号实名与空间创建）。
因此提交时按 `23` §六 的 go/no-go 口径：A 线 Static 保底先行，Docker 通不过就退回 Static。

## 四、不要做的事

- 不要把 `MODELSCOPE_API_KEY` 写进 `server.py`、`Dockerfile`、聊天记录或提交历史。
- 不要把 `ai-channel.js` 复制进 `游戏/`（会破坏零外链自检和 `file://` 可玩）。
- 不要 `git add -A` 把 `大地图-体素参考/` 或 `备份-*/` 带进公开仓。

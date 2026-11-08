"""《长征：万水千山》Docker 版 · 静态站点 + 可降级的 AI 通道

设计要点（与 21 §八 / 23 §5 T5 对齐）：
1. 站点根目录仍是 `游戏/`，五件套一个不改、零外链、双击 file:// 可玩。
2. AI 通道 `ai-channel.js` 只在返回首页时注入，不写进 `游戏/`，
   因此 `测试/发布自检.js` 的「零网络请求」检查永远通过。
3. 密钥只从环境变量 MODELSCOPE_API_KEY 读，绝不硬编码、绝不进仓库/日志。
4. 单访客 6 次/分；429 / 超时 / 未配密钥 / 任何异常，一律返回 {"text": null}，
   前端 Chronicle 与 Memory 的守卫会自动回模板，玩家完全无感。
5. 模型只负责「把结构化字段改写成一句人话」，史实与结论全由引擎给。

本地起服务：
    uvicorn 部署.server:app --host 0.0.0.0 --port 7860
（魔搭创空间 Docker 默认暴露 7860）
"""
import os
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import httpx

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
GAME = ROOT / "游戏"
CHANNEL = HERE / "ai-channel.js"

API_URL = "https://api-inference.modelscope.cn/v1/chat/completions"
MODEL = os.environ.get("MODELSCOPE_MODEL", "Qwen/Qwen2.5-7B-Instruct")
KEY = os.environ.get("MODELSCOPE_API_KEY", "")  # 空间「设置 → 环境变量」里配
RATE_LIMIT = 6
RATE_WINDOW = 60

_hits = defaultdict(deque)
app = FastAPI(title="长征：万水千山 · AI 通道")


def _rate_ok(ip):
    q = _hits[ip]
    now = time.time()
    while q and now - q[0] > RATE_WINDOW:
        q.popleft()
    if len(q) >= RATE_LIMIT:
        return False
    q.append(now)
    return True


@app.get("/", response_class=HTMLResponse)
def index():
    html = (GAME / "index.html").read_text(encoding="utf-8")
    inject = CHANNEL.read_text(encoding="utf-8")
    return HTMLResponse(html.replace("</body>", "<script>\n" + inject + "\n</script>\n</body>"))


@app.post("/api/npc")
async def npc(req: Request):
    ip = req.client.host if req.client else "unknown"
    if not _rate_ok(ip):
        return JSONResponse({"text": None})
    if not KEY:
        return JSONResponse({"text": None})  # 没配密钥：静默走模板，不报错给玩家
    try:
        body = await req.json()
        prompt = str(body.get("prompt", ""))[:4000]
    except Exception:
        return JSONResponse({"text": None})
    if not prompt:
        return JSONResponse({"text": None})
    try:
        async with httpx.AsyncClient(timeout=8.0) as cli:
            r = await cli.post(
                API_URL,
                headers={"Authorization": "Bearer " + KEY},
                json={
                    "model": MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 240,
                    "temperature": 0.4,
                },
            )
            if r.status_code == 429 or r.status_code >= 500:
                return JSONResponse({"text": None})
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"].strip()
            return JSONResponse({"text": text[:300]})
    except Exception:
        # 不把异常详情回给前端，也不写日志里的密钥
        return JSONResponse({"text": None})


# 静态资源兜底；上面两条路由先注册，所以 "/" 与 "/api/npc" 优先命中
app.mount("/", StaticFiles(directory=str(GAME)), name="static")

/* ============================================================
   AI 通道（仅 Docker 线上版注入，主仓 游戏/ 里没有这段）
   ------------------------------------------------------------
   server.py 在返回 index.html 前把本文件内联进 </body> 之前。
   于是：本地 file:// 双击 = 纯静态零请求、模板兜底；
        创空间 Docker = 有 AI，但断网/429/超时一律静默降级。

   window.__CWQS_AI.ask(prompt, facts) -> Promise<string|null>
   game.js 里的 Chronicle / Memory 只认这个接口，不写 fetch。
   连续 3 次拿不到结果就永久关闭 AI，玩家全程无感。
   ============================================================ */
(function () {
  'use strict';
  var fails = 0, dead = false;
  window.__CWQS_AI = {
    ask: function (prompt, facts) {
      if (dead) return Promise.resolve(null);
      return fetch('/api/npc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: String(prompt || ''), facts: facts || {} })
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (o) {
        if (!o || !o.text) { fails++; if (fails >= 3) dead = true; return null; }
        fails = 0;
        return String(o.text).slice(0, 300);
      }).catch(function () {
        fails++; if (fails >= 3) dead = true;
        return null;
      });
    }
  };
})();

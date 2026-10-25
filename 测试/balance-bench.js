/* 数值平衡跑测台 v2
   用法：整份粘进浏览器控制台 → window.Bench 装好 → Bench.run('smart', 8)
   做法：把 setTimeout / rAF 换成同步执行，让行军动画与「亮账停顿」在一帧走完，
   再用真实引擎（Router 弹窗 + Game.march + compute/commit）一局局走到底。
   注意：走到吴起镇后 Ending 会把 Store.s 重置回 defaultState，
   所以终局四项必须在「念名字」弹窗还开着的时候抓，别等点完按钮。 */
window.Bench = (function () {
  const D = window.Game.debug;
  const { Store, Router, MapView, Hud, Game, NODES, NODE_BY_ID, CARD_FX } = D;
  const ADJ = D.ADJ;
  const FIN = NODES.filter(n => n.finale)[0];

  const dist = {};
  (function () { const q = [FIN.id]; dist[FIN.id] = 0;
    for (let i = 0; i < q.length; i++) ADJ[q[i]].forEach(nb => { if (dist[nb] == null) { dist[nb] = dist[q[i]] + 1; q.push(nb); } }); })();

  let realT = null, realR = null, patched = false, depth = 0, hooked = false;
  /* 给 Flow.nextCheng / Flow.warnEnd 装计数器：这两个才是"部队打散"与"违纪收账"的权威口径，
     靠弹窗文字猜不稳（warnEnd 根本不弹窗） */
  function hook() {
    if (hooked) return;
    const F = D.Flow, w = F.warnEnd, n = F.nextCheng, r = F.revive;
    window.__B = { warn: 0, cheng: 0, revive: 0 };
    F.warnEnd = function () { window.__B.warn++; return w.apply(this, arguments); };
    F.nextCheng = function () { window.__B.cheng++; return n.apply(this, arguments); };
    F.revive = function () { window.__B.revive++; return r.apply(this, arguments); };
    hooked = true;
  }
  function patch(on) {
    if (on && !patched) {
      realT = window.setTimeout; realR = window.requestAnimationFrame;
      window.setTimeout = function (fn) { if (typeof fn === 'function' && depth < 400) { depth++; try { fn(); } finally { depth--; } } return 1; };
      window.requestAnimationFrame = function (cb) { try { cb(performance.now() + 9000); } catch (e) {} return 1; };
      patched = true;
    } else if (!on && patched) { window.setTimeout = realT; window.requestAnimationFrame = realR; patched = false; }
  }

  const txt = (el) => (el && el.textContent ? el.textContent.trim() : '');
  const snap = () => { const s = Store.s; return { men: s.men, food: s.food, window: s.window, trust: s.trust, names: s.board.names.length, sin: s.sin }; };

  const optScore = (o, pol) => {
    const c = o.cost || {};
    let v = (c.men || 0) + (c.food || 0) * 2.6 + (c.window || 0) * 2.6 + (c.trust || 0) * 1.3;
    if (o.sin) v += pol === 'sin' ? 45 : -65;
    if (o.gainCards || o.item || o.outcomeCard) v += 3;
    if (pol === 'mate' && o.recruit) v += 30;   /* 专门跑收编路线 */
    if (pol === 'random' || pol === 'chaos') v = Math.random();
    return v;
  };
  /* 只在「这一格要掉很多兵」时押手法卡 */
  function cardFor(o) {
    const loss = Math.max(0, -((o.cost || {}).men || 0));
    if (loss < 8) return null;
    const s = Store.s;
    return s.hand.filter(id => s.used.indexOf(id) < 0).find(id => {
      const f = CARD_FX[id] || {};
      return !f.needsComrade && (f.skipCombatLoss || f.halveLoss || f.fixedLoss != null || f.menBack);
    }) || null;
  }

  function newRun() {
    Router.closeAll();
    Store.s = Store.defaultState();
    Store.s.flags.seenIntro = true;
    Store.meta = Store.defaultMeta();
    Store.save(); MapView.render(); Hud.render();
  }

  function nextTarget() {
    const s = Store.s;
    const cands = [...(ADJ[s.at] || [])].map(id => NODE_BY_ID[id]).filter(n => {
      if (!n || (n.hiddenUntilWin && !(Store.meta.wins > 0))) return false;
      if (n.lockedUntil && !s.done[n.lockedUntil]) return false;
      return true;
    });
    if (!cands.length) return null;
    const open = cands.filter(n => !s.done[n.id] && n.kind !== 'hub');
    const pool = open.length ? open : cands.filter(n => !s.done[n.id]);
    const use = pool.length ? pool : cands;
    return use.sort((a, b) => (dist[a.id] - dist[b.id]) || (b.y - a.y))[0];
  }

  function step(modal, pol, st) {
    const kick0 = txt(modal.querySelector('.kicker'));
    if (kick0.indexOf('突发') >= 0) st.events++;
    const locked = modal.querySelector('.opts.locked');
    const opts = modal.querySelectorAll('.opts .opt');
    if (opts.length && !locked) {
      const list = Game.curOpts || [];
      let bi = 0, bv = -1e9;
      opts.forEach((b, i) => { const o = list[+b.dataset.opt]; if (!o) return; const v = optScore(o, pol); if (v > bv) { bv = v; bi = i; } });
      const chosen = list[+opts[bi].dataset.opt];
      /* chaos = 每个按钮都随机按：手法卡也只在一半的情况下想起来用 */
      const tryCard = pol === 'chaos' ? Math.random() < .5 : pol !== 'greedy';
      if (tryCard && chosen) { const cid = cardFor(chosen); const chip = cid && modal.querySelector('[data-pick="' + cid + '"]'); if (chip) { chip.click(); st.cardsUsed++; } }
      st.choiceNodes++;
      opts[bi].click();
      book(st, 'choice');
      return true;
    }
    const acts = modal.querySelectorAll('.modal-foot [data-act]');
    if (!acts.length) { const x = modal.querySelector('[data-x]'); if (x) { x.click(); return true; } return false; }
    const h2 = txt(modal.querySelector('h2'));
    const kick = txt(modal.querySelector('.kicker'));
    const byText = (frag) => [...acts].find(b => txt(b).indexOf(frag) >= 0);
    if (kick.indexOf('战友') >= 0) {
      const refuse = byText('谁也别顶');
      const accept = [...acts].find(b => b !== refuse && txt(b).indexOf('顶上去') >= 0);
      const use = accept && (pol === 'chaos' ? Math.random() < .5 : pol === 'smart' ? Store.s.comrades.length > 1 : pol === 'greedy');
      st.mateOffers++;
      if (use && accept) { accept.click(); st.matesLost++; } else if (refuse) refuse.click(); else acts[0].click();
      book(st, 'mate');
      return true;
    }
    if (kick.indexOf('坐下判定') >= 0) {
      const skip = byText('不坐下'), sit = byText('坐下歇一口气'), up = byText('不坐，继续走');
      const sitActs = [skip, sit, up].filter(Boolean);
      if (pol === 'chaos') { const pick = sitActs[Math.floor(Math.random() * sitActs.length)] || acts[0]; pick.click(); if (pick === sit) st.satDown++; else if (pick === skip) st.sitSkipped++; }
      else if (pol === 'reckless' && sit) { sit.click(); st.satDown++; }
      else if (skip) { skip.click(); st.sitSkipped++; }
      else (up || acts[0]).click();
      st.sits++;
      book(st, 'sit');
      return true;
    }
    if (kick.indexOf('缴获') >= 0 || h2.indexOf('缴获') >= 0) {
      /* 缴获三选一：按当前最短缺的那样拿 */
      const s = Store.s;
      const want = pol === 'random' || pol === 'chaos'
        ? ['口粮', '连夜赶路', '整编'][Math.floor(Math.random() * 3)]
        : (s.food <= 4 ? '口粮' : (s.window <= 2 ? '连夜赶路' : (s.men < s.menCap - 6 ? '整编' : '口粮')));
      const b = byText(want) || acts[0];
      st.spoils = st.spoils || {}; st.spoils[want] = (st.spoils[want] || 0) + 1;
      b.click(); book(st, 'spoils');
      return true;
    }
    if (h2.indexOf('没有走到吴起镇') >= 0) {
      st.end = st.end || snap(); st.failEnd = true; st.stopped = true;
      (byText('把木牌挂上名单墙') || acts[0]).click();
      return true;
    }
    if (h2.indexOf('下一程') >= 0) { (byText('接住下一支队伍') || acts[0]).click(); st.revives++; book(st, 'revive'); return true; }
    if (h2.indexOf('念名字') >= 0) {
      st.wins++; st.end = snap(); st.endAt = Store.s.at;
      (byText('把木牌挂上名单墙') || acts[0]).click(); return true;
    }
    if (h2.indexOf('名单墙') >= 0) { const x = modal.querySelector('[data-x]'); if (x) x.click(); else acts[0].click(); return true; }
    acts[0].click(); st.otherActions++; book(st, 'other');
    return true;
  }

  /* 每次落账后按引擎留下的 lastDelta 归到这一手的名目上 */
  function book(st, kind) {
    const s = Store.s, d = s.flags.lastDelta;
    if (kind === 'choice' && d) {
      const key = (NODE_BY_ID[s.at] || {}).name || s.at;
      st.nodeCost[key] = (st.nodeCost[key] || 0) + (d.men || 0);
    }
    if (s.men <= 0) st.zeroMen++;
    if (s.food <= 0) st.zeroFood++;
    if (s.window <= 0) st.zeroWindow++;
    if (s.trust < 20) st.lowTrust++;
    st.sinMax = Math.max(st.sinMax, s.sin);
    if (s.men < st.minMen) { st.minMen = s.men; st.minMenAt = (NODE_BY_ID[s.at] || {}).name || s.at; }
    st.minFood = Math.min(st.minFood, s.food); st.minWindow = Math.min(st.minWindow, s.window); st.minTrust = Math.min(st.minTrust, s.trust);
  }

  function runOne(pol, maxIt) {
    hook();
    const b0 = { warn: window.__B.warn, cheng: window.__B.cheng };
    const st = { pol, marches: 0, choiceNodes: 0, revives: 0, wins: 0, sits: 0, satDown: 0, sitSkipped: 0,
      matesLost: 0, mateOffers: 0, cardsUsed: 0, otherActions: 0, stuck: false, exhausted: false,
      zeroMen: 0, zeroFood: 0, zeroWindow: 0, lowTrust: 0, sinMax: 0, doubled: 0, charity: 0, events: 0, crisis: 0,
      minMen: 1e9, minMenAt: '', minFood: 1e9, minWindow: 1e9, minTrust: 1e9,
      nodeCost: {}, end: null, endAt: '', endName: '（没走到）', curve: [] };
    for (let it = 0; it < (maxIt || 600); it++) {
      const root = document.getElementById('modal-root');
      const wrap = root ? root.lastElementChild : null;
      if (wrap) { if (!step(wrap.querySelector('.modal'), pol, st)) { st.stuck = true; break; } if (st.stopped) break; continue; }
      if (Store.meta.wins > 0) { if (!st.end) st.end = snap(); break; }
      const t = nextTarget();
      if (!t) { st.exhausted = true; break; }
      Game.march(t);
      st.marches++;
      const cur = NODE_BY_ID[Store.s.at];
      st.endAt = Store.s.at; st.endName = cur ? cur.name : Store.s.at;
      const a = snap();
      st.curve.push([st.marches, a.men, a.food, a.window, a.trust]);
      if (a.men < st.minMen) { st.minMen = a.men; st.minMenAt = st.endName; }
      st.minFood = Math.min(st.minFood, a.food); st.minWindow = Math.min(st.minWindow, a.window); st.minTrust = Math.min(st.minTrust, a.trust);
      if (a.food <= 0) st.zeroFood++; if (a.window <= 0) st.zeroWindow++;
      if (Store.s.trust < 20) st.lowTrust++;
      const nt = Store.s.flags.lastNotes || [];
      if (nt.some(x => x.indexOf('翻倍') >= 0)) st.doubled++;
      if (Store.s.flags.pursuitHot) st.crisis++;
      st.maxComrades = Math.max(st.maxComrades || 0, Store.s.comrades.length);
      if ((Store.s.flags.lastNotes || []).some(x => x.indexOf('编进了队伍') >= 0)) st.recruitSeen = (st.recruitSeen || 0) + 1;
      st.charity = Store.s.flags.charityCount || 0;
    }
    if (!st.end) st.end = snap();
    st.reached = !!st.wins;
    st.warnEnds = window.__B.warn - b0.warn;
    st.打散 = window.__B.cheng - b0.cheng;
    st.left = dist[st.endAt] == null ? -1 : dist[st.endAt];
    st.stepsLeft = dist[Store.s.at] == null ? -1 : dist[Store.s.at];
    return st;
  }

  function run(pol, games, maxIt) {
    patch(true);
    const out = [];
    const t0 = performance.now();
    try { for (let i = 0; i < (games || 1); i++) { newRun(); out.push(runOne(pol, maxIt)); } } finally { patch(false); }
    const n = out.length || 1;
    const avg = (f) => +(out.reduce((a, x) => a + f(x), 0) / n).toFixed(2);
    window.__BENCH = (window.__BENCH || []).concat(out);
    return {
      pol, games: out.length, ms: Math.round(performance.now() - t0),
      reach: out.filter(x => x.reached).length + '/' + out.length,
      marches: avg(x => x.marches), choices: avg(x => x.choiceNodes),
      打散: avg(x => x.打散), 收账: avg(x => x.warnEnds), matesLost: avg(x => x.matesLost), cardsUsed: avg(x => x.cardsUsed),
      收编: { 次数: avg(x => x.recruitSeen || 0), 峰值在队: avg(x => x.maxComrades || 4) },
      end: { men: avg(x => x.end.men), food: avg(x => x.end.food), win: avg(x => x.end.window), trust: avg(x => x.end.trust), names: avg(x => x.end.names), sin: avg(x => x.end.sin) },
      mins: { men: avg(x => x.minMen), food: avg(x => x.minFood), win: avg(x => x.minWindow), trust: avg(x => x.minTrust) },
      pinch: { 断粮格: avg(x => x.zeroFood), 压顶格: avg(x => x.crisis), 折损翻倍格: avg(x => x.doubled),
        突发事件数: avg(x => x.events), 低民心格: avg(x => x.lowTrust), 违纪峰值: avg(x => x.sinMax), 借粮次数: avg(x => x.charity) },
      stuck: out.filter(x => x.stuck).length, exhausted: out.filter(x => x.exhausted).length,
      failEnd: out.filter(x => x.failEnd).length,
      spoils: out.reduce((a, x) => { Object.keys(x.spoils || {}).forEach(k => { a[k] = (a[k] || 0) + x.spoils[k]; }); return a; }, {}),
      each: out.map(x => ({ 停在: x.reached ? '吴起镇' : x.endName, 兵: x.end.men, 粮: x.end.food, 时: x.end.window, 民: x.end.trust,
        名字: x.end.names, 违纪: x.end.sin, 最低兵: x.minMen + '@' + x.minMenAt, 打散: x.打散, 收账: x.warnEnds, 行军: x.marches, 胜: x.reached }))
    };
  }

  /* 平均资源曲线：每 5 格取一次四项，跨局平均 */
  function curve(pol) {
    const all = (window.__BENCH || []).filter(x => !pol || x.pol === pol);
    if (!all.length) return { error: '先跑几局' };
    const buckets = {};
    all.forEach(x => x.curve.forEach(([m, men, food, win, trust]) => {
      const b = Math.min(45, Math.floor(m / 3) * 3);
      (buckets[b] = buckets[b] || { n: 0, men: 0, food: 0, win: 0, trust: 0 }).n++;
      buckets[b].men += men; buckets[b].food += food; buckets[b].win += win; buckets[b].trust += trust;
    }));
    return Object.keys(buckets).map(Number).sort((a, b) => a - b).map(k => {
      const b = buckets[k];
      return { 格: k, 样本: b.n, 兵: +(b.men / b.n).toFixed(1), 粮: +(b.food / b.n).toFixed(1), 时: +(b.win / b.n).toFixed(1), 民: +(b.trust / b.n).toFixed(1) };
    });
  }

  /* 最吃兵的格子排行 */
  function hotspots() {
    const all = (window.__BENCH || []);
    const m = {};
    all.forEach(x => Object.keys(x.nodeCost).forEach(k => {
      if (x.nodeCost[k] >= 0) return;
      (m[k] = m[k] || { 次数: 0, 合计: 0 }).次数++; m[k].合计 += x.nodeCost[k];
    }));
    return Object.keys(m).map(k => ({ 格子: k, 中招局数: m[k].次数, 平均折兵: +(m[k].合计 / m[k].次数).toFixed(1), 局数: all.length }))
      .sort((a, b) => a.平均折兵 - b.平均折兵).slice(0, 14);
  }

  return { run, hotspots, curve, patch, dist, FIN: FIN.id, get log() { return window.__BENCH; }, clear() { window.__BENCH = []; } };
})();

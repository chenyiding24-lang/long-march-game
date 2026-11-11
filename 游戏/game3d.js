/* =====================================================================
 * 游戏3D · 事件关卡引擎（game3d.js）
 * 把平面地图（game.js）的「事件 / 关卡」玩法系统整套移植到 3D 体素地图上。
 * 设计原则：
 *   1. 只读复用 data.js（NODES / EDGES / CARDS / COMRADES / ITEMS / HISTORY /
 *      MOVE_EVENTS / DISCIPLINE / SIN_TEXT …），不改动 data.js。
 *   2. 与 2D 共用同一份存档键 cwqs_save_v1 / cwqs_meta_v1 —— 在 2D 与 3D
 *      之间切换时，同一局进度互通（谁先开都行）。
 *   3. 全部结算 / 资源 / 违纪 / 终章逻辑忠实移植自 game.js，保证「元素都不能少」。
 *   4. 与 3D 渲染层（route3d.html 的 VoxelMap）仅通过 window.Game3D 的少量
 *      钩子耦合：boot / onNodeClick / march / tick(投影点击)。2D game.js 不动。
 * 本文件不依赖任何外部网络资源。
 * ===================================================================== */
(function () {
  'use strict';

  /* ---------------- 基础工具（与 game.js 同源） ---------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rnd(arr.length)];
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /* ---------------- 资源与数值曲线（移植自 game.js 常量） ---------------- */
  const RES = {
    men:    { key: 'men',    label: '兵', color: '#b5382b', max: 100, unit: '支', desc: '建制完整度：能拉出来的队' },
    food:   { key: 'food',   label: '粮', color: '#a5813a', max: 20,  unit: '天', desc: '全军口粮可撑的天数' },
    window: { key: 'window', label: '时', color: '#4a6f7c', max: 8,   unit: '日', desc: '追兵窗口：离被合围还剩几天' },
    trust:  { key: 'trust',  label: '民', color: '#4d7a52', max: 100, unit: '',   desc: '沿途人心：低于 20 时民族地区选项锁死' }
  };
  const BALANCE = {
    init:         { men: 100, food: 11, window: 6, trust: 40 },
    march:        { food: -1, window: -1 },
    gateSpoils:   { food: 2, window: 2, men: 2 },
    hungerLoss:   6,
    pursuitGrace: 2,
    eventP: 0.24, eventCooldownP: 0.10,
    regionP: 0.15,
    council:    { enabled: false, every: 6 },
    enemyLearn: { enabled: false, maxPerRun: 1 },
    charity:     { trust: 70, food: 1, max: 3 },
    comradeCap:  6,
    mateSave:    2,
    fallLimit:   3
  };
  /* 手法卡的真实效果（与 game.js CARD_FX 一致） */
  const CARD_FX = {
    c_no_left:   { halveLoss: true, window: -1 },
    c_walk_on:   { noHungerOnce: true },
    c_no_sit:    { skipSit: true },
    c_carve:     { trustNext: 5 },
    c_night:     { blockSurprise: true, window: -1 },
    c_disguise:  { fordFree: true, window: -1 },
    c_bypass:    { window: -1, trust: 3, skipCombatLoss: true },
    c_feint:     { window: 2 },
    c_assault:   { fixedLoss: 6, ignorePursuit: true },
    c_chains:    { fixedLoss: 5 },
    c_climb:     { halveLoss: true, food: -2 },
    c_cover:     { menBack: 3, window: -1 },
    c_rules:     { trust: 12, sight: 1 },
    c_iou:       { food: 3, trust: 5, window: -1 },
    c_eat_toast: { trust: 8, men: 2 },
    c_leave_note:{ food: 2, trust: 3 },
    c_lastbite:  { noHungerOnce: true, food: -1 },
    c_carry:     { men: 4, food: -4, needsComrade: true },
    c_light:     { food: 3, window: 1, trust: -10 },
    c_pot:       { noHungerOnce: true }
  };
  const ICON_HINT = {
    ford: '夜渡', battle: '战斗', hall: '会议', pass: '关隘', bridge: '夺桥',
    snow: '雪山', swamp: '草地', granary: '开仓', alliance: '结盟', fork: '岔路',
    village: '村落', shop: '集镇', mountain: '山路', river: '渡口', road: '急行',
    camp: '营地', checkpoint: '封锁', city: '城外', news: '报章', end: '终点', '?': ''
  };

  /* ---------------- 数据索引（直接复用 data.js 的全局常量，与 2D game.js 同源）
   * 关键：此处【不可】用 `const NODES = window.NODES || …` 重新声明同名绑定——
   * 那会在自身初始化表达式里读到一个处于 TDZ 的同名绑定，直接抛 ReferenceError
   * （浏览器与模拟器都会崩）。data.js 的顶层 const 与 game3d.js 同处一个全局词法环境
   * （浏览器多 <script> 共享，模拟器单脚本亦同），直接引用即可。 ---------------- */
  const NODE_MAP = {};
  NODES.forEach(n => { NODE_MAP[n.id] = n; });
  const ADJ = {};
  NODES.forEach(n => { ADJ[n.id] = ADJ[n.id] || new Set(); });
  EDGES.forEach(([a, b]) => { if (ADJ[a]) ADJ[a].add(b); if (ADJ[b]) ADJ[b].add(a); });

  /* ---------------- 存档（与 2D 共用键） ---------------- */
  const SAVE_KEY = 'cwqs_save_v1', META_KEY = 'cwqs_meta_v1';

  /* 轻量 DOM / 存储桩（浏览器真用，Node 模拟时用桩覆盖） */
  const G = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
  const doc = (typeof document !== 'undefined') ? document : null;
  function store_get(k) { try { return G.localStorage ? G.localStorage.getItem(k) : null; } catch (e) { return null; } }
  function store_set(k, v) { try { if (G.localStorage) G.localStorage.setItem(k, v); } catch (e) {} }
  function store_del(k) { try { if (G.localStorage) G.localStorage.removeItem(k); } catch (e) {} }
  function nowMs() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  const Store = {
    s: null, meta: null, checkpoint: null,
    defaultState() {
      return {
        men: BALANCE.init.men, menCap: BALANCE.init.men,
        food: BALANCE.init.food, window: BALANCE.init.window, trust: BALANCE.init.trust,
        at: 'g1', run: 1, runsFailed: 0, runsWarn: 0,
        sin: 0, sinTypes: [], reckonIn: 0, reckonPending: null, reckonFresh: false,
        board: { places: [], names: [], blanks: 0 },
        hand: ['c_no_left', 'c_night', 'c_assault', 'c_rules', 'c_lastbite', 'c_pot'],
        used: [], comrades: ['m_xiaoxie', 'm_laofan', 'm_sanya', 'm_qian'],
        items: [], done: {}, visited: {}, loreSeen: [],
        hungerImmune: false, sitSkips: 0, trustNext: 0, blockNextSurprise: false,
        historyRead: [], flags: {},
        log: [], mem: []
      };
    },
    defaultMeta() { return { wall: [], warnWall: [], unlocked: [], lessons: {}, best: 0, plays: 0, wins: 0 }; },
    load() {
      try {
        const raw = store_get(SAVE_KEY);
        this.s = raw ? Object.assign(this.defaultState(), JSON.parse(raw)) : this.defaultState();
      } catch (e) { this.s = this.defaultState(); }
      if (!this.s.at || !NODE_MAP[this.s.at]) this.s.at = 'g1';
      if (!this.s.flags) this.s.flags = {};
      try {
        const rawM = store_get(META_KEY);
        this.meta = rawM ? Object.assign(this.defaultMeta(), JSON.parse(rawM)) : this.defaultMeta();
      } catch (e) { this.meta = this.defaultMeta(); }
      if (!this.meta.wall) this.meta.wall = [];
      if (!this.meta.warnWall) this.meta.warnWall = [];
      if (!this.meta.lessons) this.meta.lessons = {};
    },
    save() { store_set(SAVE_KEY, JSON.stringify(this.s)); store_set(META_KEY, JSON.stringify(this.meta)); },
    snapshot() { this.checkpoint = JSON.stringify(this.s); },
    rollback() { if (this.checkpoint) this.s = JSON.parse(this.checkpoint); },
    exportCode() {
      try {
        const s = this.s, m = this.meta || this.defaultMeta();
        const payload = { v: 1, s: Object.assign({}, s, { log: (s.log || []).slice(-20) }),
          m: { unlocked: m.unlocked || [], best: m.best || 0, plays: m.plays || 0, wins: m.wins || 0,
               wall: (m.wall || []).slice(-6), warnWall: (m.warnWall || []).slice(-3), lessons: m.lessons || {} } };
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      } catch (e) { return null; }
    },
    importCode(code) {
      try {
        const b64 = String(code || '').trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
        if (!b64) return false;
        const bin = atob(b64); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const o = JSON.parse(new TextDecoder().decode(bytes));
        if (!o || o.v !== 1 || !o.s || !o.s.at || !NODE_MAP[o.s.at]) return false;
        this.s = Object.assign(this.defaultState(), o.s);
        this.meta = Object.assign(this.defaultMeta(), o.m || {});
        if (!Array.isArray(this.s.log)) this.s.log = [];
        if (!this.s.flags) this.s.flags = {};
        this.save(); return true;
      } catch (e) { return false; }
    }
  };

  /* ---------------- 轻量 Memory（战史/记忆，移植自 game.js Memory 的最小集） ---------------- */
  const Memory = {
    add(tag, text) {
      const s = Store.s; if (!s.mem) s.mem = [];
      if (s.mem.filter(m => m.tag === tag && m.text === text).length) return;
      s.mem.push({ tag, text }); if (s.mem.length > 60) s.mem.shift();
    },
    receipt() { this.add('arrived', '到了一处，先记下来'); }
  };

  /* ---------------- 友人议事 / 敌情学你（3D 版不挂顶栏，置空避免回归） ---------------- */
  function enemyMod() { /* 3D 版不在结算内引入 ±5% 叠加层，保持 C11 平衡 */ }

  /* ====================================================================
   *  UI：Modal（弹窗栈）/ Toast / Hud / 导航
   * ================================================================== */

  /* CG 天气粒子层（移植自 game.js CgWeather）：纯 canvas，零依赖，17 §6.1。
     图未生成或加载失败时由 Modal 标 no-art 并停止粒子，只留文字，试玩永远不卡。
     掉帧自动关画布；prefers-reduced-motion 时完全不启动。 */
  const CgWeather = {
    _raf: new WeakMap(),
    _reduce() { return !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches); },
    start(wrap, kind) {
      if (!kind || kind === 'none' || this._reduce()) return;
      const cv = wrap.querySelector && wrap.querySelector('.cg-weather');
      if (!cv || !cv.getContext) return;
      const ctx = cv.getContext('2d'); if (!ctx) return;
      const rect = (wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : null) || { width: 640, height: 480 };
      const dpr = Math.min(G.devicePixelRatio || 1, 1.5);
      cv.width = Math.max(1, Math.floor((rect.width || 640) * dpr));
      cv.height = Math.max(1, Math.floor((rect.height || 480) * dpr));
      const N = 60, ps = [];
      for (let i = 0; i < N; i++) ps.push({ x: Math.random(), y: Math.random(), r: Math.random(), v: .2 + Math.random() * .8 });
      const color = {
        snow: 'rgba(230,236,240,', rain: 'rgba(190,205,215,', mist: 'rgba(210,205,190,',
        ember: 'rgba(230,150,80,', dust: 'rgba(200,180,140,', spray: 'rgba(225,235,240,'
      }[kind] || 'rgba(220,215,200,';
      let last = (G.performance && G.performance.now ? G.performance.now() : Date.now()), lastCheck = last, frames = 0;
      const tick = (t) => {
        const w = cv.width, h = cv.height;
        ctx.clearRect(0, 0, w, h);
        const dt = Math.min(50, t - last) / 1000; last = t;
        ps.forEach(p => {
          if (kind === 'snow') { p.y += p.v * dt * .06; p.x += dt * .02; }
          else if (kind === 'rain' || kind === 'spray') { p.y += p.v * dt * .5; p.x -= dt * .08; }
          else if (kind === 'ember') { p.y -= p.v * dt * .10; p.x += (p.r - .5) * dt * .03; }
          else if (kind === 'dust') { p.x += p.v * dt * .05; p.y += dt * .005; }
          else { p.x += dt * .008; p.y -= dt * .004; }
          if (p.x > 1.05) p.x = -.05; if (p.x < -.05) p.x = 1.05;
          if (p.y > 1.05) p.y = -.05; if (p.y < -.05) p.y = 1.05;
          const a = kind === 'mist' ? .05 : .18 + p.r * .32;
          const size = (kind === 'mist' ? 18 + p.r * 40 : 1 + p.r * 2) * (w / 640 + .4);
          ctx.fillStyle = color + a.toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(p.x * w, p.y * h, size, 0, Math.PI * 2); ctx.fill();
        });
        frames++;
        if (t - lastCheck > 1000) { if (frames < 18) { cv.style.display = 'none'; this._raf.delete(wrap); return; } frames = 0; lastCheck = t; }
        this._raf.set(wrap, requestAnimationFrame(tick));
      };
      this._raf.set(wrap, requestAnimationFrame(tick));
    },
    stop(wrap) { const id = this._raf.get(wrap); if (id) cancelAnimationFrame(id); this._raf.delete(wrap); }
  };

  const Modal = {
    stack: [],
    root() { return doc ? doc.getElementById('modal-root') : null; },
    open(opts) {
      if (!doc) return { el: null, close() {} };
      const root = this.root();
      const wrap = doc.createElement('div');
      wrap.className = 'modal-wrap' + (opts.cinematic ? ' cinematic' : '') + (opts.blocking ? ' blocking' : '');
      const box = doc.createElement('div');
      box.className = 'modal ' + (opts.size === 'wide' ? 'wide' : opts.size === 'mid' ? 'mid' : 'sm');
      if (opts.cinematic) box.classList.add('cinematic');

      /* CG 分镜：art 只给编号（如 'cg-09'），运镜与天气从 CG_ART 表查（与 2D Router.open 一致）。
         图没生成或加载失败时，stage 标 no-art 只留文字，试玩永远不卡。 */
      const meta = (typeof CG_ART !== 'undefined' && opts.art && CG_ART[opts.art]) || {};
      const motion = opts.motion || meta.motion || 'zoom-in';
      const weather = opts.weather || meta.weather || 'none';
      if (opts.art) {
        const stage = doc.createElement('div');
        stage.className = 'cg-stage motion-' + esc(motion) + ' weather-' + esc(weather);
        stage.innerHTML =
          '<img class="cg-img" src="art/' + esc(opts.art) + '.webp" alt="" aria-hidden="true" loading="lazy">' +
          '<canvas class="cg-weather" aria-hidden="true"></canvas>' +
          '<div class="cg-scrim"></div>';
        box.appendChild(stage);
        const img = stage.querySelector('.cg-img');
        if (img) img.addEventListener('error', () => { stage.classList.add('no-art'); CgWeather.stop(wrap); }, { once: true });
      }

      const head = doc.createElement('div'); head.className = 'modal-head';
      head.innerHTML = (opts.kicker ? `<span class="kicker">${esc(opts.kicker)}</span>` : '') +
        (opts.title ? `<h3>${esc(opts.title)}</h3>` : '');
      const body = doc.createElement('div'); body.className = 'modal-body';
      body.innerHTML = opts.html || '';
      const foot = doc.createElement('div'); foot.className = 'modal-foot';
      const m = { el: wrap, box, body, foot, opts, closed: false,
        close() { if (this.closed) return; this.closed = true; CgWeather.stop(wrap); if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
                  const i = Modal.stack.indexOf(m); if (i >= 0) Modal.stack.splice(i, 1);
                  if (opts.onClose) try { opts.onClose(); } catch (e) {} } };
      (opts.actions || []).forEach(a => {
        const b = doc.createElement('button');
        b.className = 'mbtn ' + (a.kind || '');
        b.textContent = a.text;
        // 与 2D Router.open 语义一致：onClick 执行后默认关闭本弹窗；onClick 返回 true 才保持打开。
        // （旧写法只在「无 onClick」时关闭，导致所有带 onClick 的按钮点了不关、像“没反应”。）
        b.addEventListener('click', () => {
          if (a.onClick) { const keep = a.onClick(); if (keep !== true && !m.closed) m.close(); }
          else m.close();
        });
        foot.appendChild(b);
      });
      box.appendChild(head); box.appendChild(body); box.appendChild(foot);
      wrap.appendChild(box);
      if (!opts.closable && !opts.blocking) wrap.addEventListener('click', e => { if (e.target === wrap) m.close(); });
      root.appendChild(wrap);
      this.stack.push(m);
      if (opts.art) CgWeather.start(wrap, weather);   /* 弹窗上屏后再起粒子，确保 canvas 尺寸正确 */
      return m;
    },
    closeAll() { while (this.stack.length) this.stack[this.stack.length - 1].close(); },
    closeTop() { if (this.stack.length) this.stack[this.stack.length - 1].close(); },
    top() { return this.stack[this.stack.length - 1]; }
  };

  const Toast = {
    show(msg) {
      if (!doc) return;
      const t = doc.getElementById('toast'); if (!t) return;
      const span = doc.createElement('div'); span.className = 'toast-item'; span.textContent = msg;
      t.appendChild(span);
      setTimeout(() => { span.classList.add('fade'); setTimeout(() => { if (span.parentNode) span.parentNode.removeChild(span); }, 400); }, 2200);
    }
  };

  const Hud = {
    el() { return doc ? doc.getElementById('hud') : null; },
    build() { this.render(); },
    render() {
      const el = this.el(); if (!el) return;
      const s = Store.s;
      const order = ['men', 'food', 'window', 'trust'];
      el.innerHTML = order.map(k => {
        const r = RES[k], v = s[k], max = (k === 'men') ? s.menCap : r.max;
        const pct = clamp(max ? Math.round(v / max * 100) : 0, 0, 100);
        return `<div class="res res-${k}"><span class="res-k" style="color:${r.color}">${r.label}</span>` +
          `<span class="res-v">${v}</span>` +
          `<span class="res-bar"><i style="width:${pct}%;background:${r.color}"></i></span></div>`;
      }).join('');
    },
    flash(d) {
      const el = this.el(); if (!el || !d) return;
      this.render();
      ['men', 'food', 'window', 'trust'].forEach(k => {
        if (d[k]) { const v = el.querySelector('.res-' + k + ' .res-v'); if (v) { v.classList.add(d[k] > 0 ? 'up' : 'down'); setTimeout(() => v.classList.remove('up', 'down'), 700); } }
      });
    },
    fit() {}
  };

  /* ====================================================================
   *  游戏引擎主体（移植自 game.js 的 Game / Sin / Flow / Ending / History）
   * ================================================================== */
  const Game = {
    marching: false,
    chosenCard: null,
    activeCtx: null,
    curOpts: null,

    boot() {
      Store.load();
      Hud.build();
      this.bindChrome();
      Hud.render();
      if (!Store.s.flags.seenIntro) { Store.s.flags.seenIntro = true; Store.save(); Pages.intro(); }
      else if (!Store.s.flags.sawNotes) { setTimeout(() => Pages.notes(), 600); }
      else {
        const touch = !!(G.matchMedia && G.matchMedia('(pointer:coarse)').matches);
        Toast.show(touch
          ? '左下方向键移动 · 右下升降 · 双指缩放；点金色地名或「下一站」走一格'
          : '点击发亮的地名或「下一站」行军；点当前所在地名查看事件');
      }
    },

    bindChrome() {
      const on = (id, fn) => { const e = doc && doc.getElementById(id); if (e) e.addEventListener('click', fn); };
      on('nav-board', () => Pages.board());
      on('nav-wall', () => Pages.wall());
      on('nav-history', () => Pages.history());
      on('nav-cards', () => Pages.cards());
      on('nav-comrades', () => Pages.comrades());
      on('nav-help', () => Pages.help());
      on('nav-memory', () => Pages.memory());
      on('nav-code', () => Pages.codePage());
      on('reset-btn', () => Pages.confirmReset());
      on('next-pill', () => this.goNext());
      on('hand-tray', (e) => { const c = e.target.closest('[data-card]'); if (c) Pages.cardDetail(c.dataset.card); });
      on('comrade-tray', (e) => { const c = e.target.closest('[data-comrade]'); if (c) Pages.comradeDetail(c.dataset.comrade); });
      if (Game3D.refreshNav) Game3D.refreshNav();   /* 导航由 Game3D 渲染，不在 Game 上 */
      this.refreshTrays();
    },

    /* —— 可达性 —— */
    reachable(id) {
      const s = Store.s, n = NODE_MAP[id];
      if (!n) return false;
      if (n.lockedUntil && !s.done[n.lockedUntil]) return false;
      if (n.hiddenUntilWin && !(Store.meta.wins > 0)) return false;
      return true;
    },
    /* 脚下这一步真能踩下去的去向：相邻 + 已探明 + 没被锁。
       路线节点的 y 沿长征方向单调减小；只推前进方向，避免跳过分支后又把玩家指回上一格。
       只有走到尽头/支线末端才允许回退。与 2D frontNodes 同序：
         1) 先没走过的（绝不推荐已经打完的来路 —— 这是“下一站变回上一站”的根因）；
         2) 都没走过：大关卡优先（引导主线），再就近；
         3) 都已走过（走到死路/叶子）：纯就近回退，不跳回起点关卡。
       goNext / 右侧「下一站」都取 [0] 作为真正的前进方向。 */
    nextNodes() {
      const s = Store.s, cur = NODE_MAP[s.at];
      if (!cur) return [];
      const d2 = n => this.dist2(cur, n);
      const adj = ADJ[s.at] || new Set();   /* ADJ 的值是 Set（与 2D 一致），先展开成数组再排序 */
      const all = [...adj].map(id => NODE_MAP[id])
        .filter(n => n && n.id !== s.at && this.reachable(n.id));
      const forward = all.filter(n => n.y < cur.y);
      return (forward.length ? forward : all).sort((a, b) => {
          const da = s.done[a.id] ? 1 : 0, db = s.done[b.id] ? 1 : 0;   /* 先没走过的 */
          if (da !== db) return da - db;
          if (!da) {                                                        /* 都没走过：大关卡优先 */
            const ga = a.kind === 'gate' ? 0 : 1, gb = b.kind === 'gate' ? 0 : 1;
            if (ga !== gb) return ga - gb;
          }                                                                /* 都已走过：纯就近回退 */
          return d2(a) - d2(b);
        });
    },
    dist2(a, b) { const dx = (a.x || 0) - (b.x || 0), dy = (a.y || 0) - (b.y || 0); return dx * dx + dy * dy; },

    /* —— 下一站 —— */
    goNext() {
      const ns = this.nextNodes();
      if (!ns.length) { Toast.show('这一步没有能走的格 —— 用右侧导航或点地图上的地名'); return; }
      this.onNodeClick(ns[0].id);
    },

    /* —— 点击 3D 节点 —— */
    onNodeClick(id) {
      const s = Store.s, n = NODE_MAP[id];
      if (!n || this.marching) return;
      if (id === s.at) { this.enter(n); return; }
      if (!(ADJ[s.at] || new Set()).has(id)) { Toast.show('这条路不通 —— 只能走到与当前位置相连的格子'); return; }
      if (!this.reachable(id)) { Toast.show('这条路还没打开'); return; }
      this.march(n);
    },

    /* —— 行军：驱动 3D 镜头沿路线飞向目的地 —— */
    march(node) {
      const s = Store.s;
      if (this.marching) return;
      this.marching = true;
      if (Game3D.vmap && Game3D.vmap.focus) Game3D.vmap.focus(node.id);
      const dur = 1300;
      setTimeout(() => {
        this.marching = false;
        s.at = node.id; s.visited[node.id] = true;
        this.apply(BALANCE.march);
        this.charityTop();
        Store.save(); Hud.render(); if (Game3D.refreshNav) Game3D.refreshNav();
        let surprise = null;
        const crisis = s.window <= 0;
        s.flags.pursuitHot = crisis;
        if (crisis) {
          if (!s.flags.lastMarchSurprise && node.kind !== 'gate') surprise = this.rollMoveEvent();
          else Toast.show('追兵咬住这一格 — 这一格的折损翻倍，但队伍把尾巴甩开了');
          s.window = BALANCE.pursuitGrace; s.flags.lastMarchSurprise = !!surprise;
        } else {
          const p = s.flags.lastMarchSurprise ? BALANCE.eventCooldownP : BALANCE.eventP;
          if (s.blockNextSurprise) { s.blockNextSurprise = false; Toast.show('夜行：一支队伍摸过去了，没有惊动哨兵'); }
          else if (Math.random() < p && node.kind !== 'gate') surprise = this.rollMoveEvent();
          s.flags.lastMarchSurprise = !!surprise;
        }
        this.logStep({ kind: 'march', label: '行军', delta: { food: BALANCE.march.food, window: BALANCE.march.window },
          menAfter: s.men, foodAfter: s.food, windowAfter: s.window, trustAfter: s.trust,
          hunger: s.food <= 0, pursuit: !!crisis, surprise: surprise ? surprise.title : null });
        this.afterArrive(node, surprise);
      }, dur);
    },

    afterArrive(node, surprise) {
      Store.snapshot();
      if (surprise) {
        this.chosenCard = null;
        Modal.open({ title: '行进途中 · ' + surprise.title, kicker: '突发事件', size: 'mid', blocking: true, closable: false,
          html: `<p class="lead">${esc(surprise.text)}</p>` + this.optHtml(surprise, 'mv'),
          actions: [] });
        this.bindOptions(surprise, { source: 'move', opts: surprise.options, dest: node });
        return;
      }
      this.enter(node);
    },

    enter(node) {
      const s = Store.s;
      const cut = this.pendingCutscene(node);
      if (cut) { this.playCutscene(node, cut, () => this.enter(node)); return; }
      if (node.kind === 'hub') { this.enterHub(node); return; }
      if (s.done[node.id]) {
        Modal.open({ title: node.name, kicker: '故地', size: 'mid',
          html: `<p class="lead">此地已经了结。${node.kind === 'gate' ? '木牌上刻着 ' + esc((node.carve || {}).place || '') + '。' : ''}</p>` +
            (node.epilogue ? `<p class="quote">${esc(node.epilogue)}</p>` : '') + this.loreLinks(node),
          actions: [{ text: '回到地图', kind: 'primary' }] });
        return;
      }
      if (node.finale) { Ending.run(); return; }
      if (node.sits) { Memory.receipt(); this.sitLoop(node, () => this.openNode(node)); return; }
      this.openNode(node);
    },

    enterHub(node) {
      Store.s.done[node.id] = true;
      const m = Modal.open({ title: node.name, kicker: '路径点', size: 'sm',
        html: this.roadHtml() + `<p class="lead">${esc(node.note || '队伍在这里合流，继续往前走。')}</p>`,
        actions: [{ text: '继续', kind: 'primary', onClick: () => { Store.save(); Hud.render(); if (Game3D.refreshNav) Game3D.refreshNav(); m.close(); } }] });
      Store.save(); Hud.render(); if (Game3D.refreshNav) Game3D.refreshNav();
    },

    /* 雪山 / 草地“坐下”判定（移植） */
    sitLoop(node, done) {
      const s = Store.s;
      const canSkip = s.hand.indexOf('c_no_sit') >= 0 && s.used.indexOf('c_no_sit') < 0;
      let left = node.sits, sat = 0, closed = false;
      const dismiss = () => { closed = true; };
      const go = () => { if (sat > 0) this.showSitLore(node, done); else done(); };
      const sit = () => {
        s.men = Math.max(0, s.men - 2); sat += 1; left -= 1;
        Hud.flash({ men: -2 }); Store.save(); Hud.render();
        if (s.men <= 0) { Flow.nextCheng(node); return; }
        if (left <= 0) { this.showSitLore(node, done); return; }
        ask();
      };
      const skip = () => {
        if (s.used.indexOf('c_no_sit') < 0) s.used.push('c_no_sit');
        s.window = Math.max(0, s.window - 1); Hud.flash({ window: -1 }); Store.save(); Hud.render();
        Toast.show('你一路没有坐下'); done();
      };
      function ask() {
        const actions = [];
        if (canSkip && sat === 0) actions.push({ text: '用「不坐下」跳过整段', kind: 'ghost', onClick: () => { dismiss(); skip(); } });
        actions.push({ text: '不坐，继续走', kind: 'primary', onClick: () => { dismiss(); go(); } });
        actions.push({ text: '坐下歇一口气', kind: 'ghost', onClick: () => { dismiss(); sit(); } });
        Modal.open({ title: node.name + ' · 歇一会儿？', kicker: '坐下判定 · 还剩 ' + left + ' 次', size: 'mid', blocking: true, closable: false,
          html: `<p class="lead">风停了一瞬，路边有人示意可以坐。坐下去的人里，有几个再没起来。</p>
            <p class="note-hint">你已经坐过 ${sat} 次。坐下之后的账，等这一段走完再给你看。</p>`, actions });
      }
      ask();
    },
    showSitLore(node, after) {
      Store.s.done['sit_' + node.id] = true;
      Modal.open({ title: '那块“大石头”', kicker: 'R · 据老红军回忆', size: 'mid', cinematic: true,
        art: 'cg-10',
        onClose: () => { if (after) after(); },
        html: `<p class="cg">十九岁的郝毅走不动了，朦胧间见前面有块大石头，把包袱放上去想坐一会儿——一坐下去，“大石头”歪倒了：那是前面部队牺牲的战友，身子已经僵硬。</p>
               <p class="cg dim">刘洪才记得另一夜：头天挤在雪洞里取暖，第二天醒来只剩副班长还躺着，一推才知道已经冻死。</p>
               <p class="src">新华网《他们历经苦难 我们收获辉煌》 · 转述老红军回忆 · 分级 R</p>`,
        actions: [{ text: '把这段记进史料', kind: 'primary', onClick: () => History.unlock('h_jiajinshan') }] });
    },

    openNode(node) {
      const s = Store.s;
      Store.snapshot();
      const lock = node.requires && s.trust < node.requires.trustMin;
      let opts = (node.options || []).slice();
      if (node.sinOption) opts = opts.concat([Object.assign({ sinNote: true }, node.sinOption)]);
      if (lock) {
        Modal.open({ title: node.name, kicker: node.date || '', size: 'mid',
          html: `<p class="lead">${esc(node.scene || node.text || '')}</p>
                 <div class="lockbox"><b>选项已被锁死</b><p>${esc(node.requires.failText)}</p>${this.echoLine(node) ? `<p class="echo">${esc(this.echoLine(node))}</p>` : ''}</div>`,
          actions: [{ text: '接受代价继续', kind: 'ghost', onClick: () => this.resolve(node, {
            label: '被迫硬闯（无人带路）', cost: { men: -8, window: -2 }, outcome: '没有向导，没有借粮。你的队伍在自己找路上耗掉了两天。' }) }] });
        return;
      }
      this.chosenCard = null;
      Modal.open({ title: node.name, kicker: (node.kind === 'gate' ? '大关卡 · ' : '事件 · ') + (node.date || ICON_HINT[node.icon] || ''),
        size: node.kind === 'gate' ? 'wide' : 'mid', closable: false, blocking: true,
        html: this.roadHtml() + `<p class="lead">${esc(node.scene || node.text || '')}</p>` +
          (node.brief ? `<p class="brief">${esc(node.brief)}</p>` : '') +
          (node.note ? `<p class="rule-note">${esc(node.note)}</p>` : '') +
          this.optHtml(node, node.id, opts), actions: [] });
      this.bindOptions(node, { source: 'node', opts });
    },

    optHtml(node, key, list) {
      const s = Store.s; const opts = list || node.options || [];
      return `<div class="opts" data-optlist="${esc(key)}">` + opts.map((o, i) => {
        const lesson = o.sin ? (s.sin >= 3 ? SIN_TEXT[3] : (Store.meta.lessons[o.sin.type] ? SIN_TEXT[1] : (s.flags.warnRestart ? SIN_TEXT[1] : ''))) : '';
        return `<button class="opt" data-opt="${i}">
          <span class="opt-label">${esc(o.label)}</span>
          ${o.sin ? `<span class="sin-tag">违纪 · 得眼前之利</span>` : ''}
          ${lesson ? `<span class="lesson">${esc(lesson)}</span>` : ''}
        </button>`;
      }).join('') + `</div>
      <div class="cardbar"><span class="cardbar-tip">可附一张手法卡（本节点一次）：</span><span id="pick-card">${
        s.hand.filter(id => s.used.indexOf(id) < 0).map(id =>
          `<button class="chip tiny" data-pick="${id}" title="${esc((CARDS[id] || {}).desc || '')}">${esc((CARDS[id] || {}).name || id)}</button>`).join('') || '<i class="dim">（手上没有可用卡）</i>'
      }</span></div>`;
    },

    bindOptions(node, ctx) {
      const mask = Modal.top(); if (!mask) return;
      const root = mask.body; let settled = false;
      const timer = { id: 0 };
      const go = () => {
        if (settled) return; settled = true; clearTimeout(timer.id);
        if (Game.activeCtx === ctx) Game.activeCtx = null;
        Modal.closeAll();
        if (ctx.source === 'move') this.applyChoice(node, ctx.opt, () => this.afterMove(ctx.dest));
        else this.resolve(node, ctx.opt);
      };
      ctx.settle = go; this.activeCtx = ctx;
      this.curOpts = ctx.opts || node.options || [];
      root.addEventListener('click', (e) => {
        if (ctx.opt) {
          if (!e.target.closest('[data-link],[data-x]')) go();
          return;
        }
        const pickBtn = e.target.closest('[data-pick]');
        if (pickBtn) {
          const id = pickBtn.dataset.pick;
          this.chosenCard = this.chosenCard === id ? null : id;
          Array.prototype.forEach.call(root.querySelectorAll('[data-pick]'), b => b.classList.toggle('on', b.dataset.pick === this.chosenCard));
          return;
        }
        const ob = e.target.closest('[data-opt]'); const opts = ctx.opts || node.options || [];
        if (!ob) return;
        const opt = opts[+ob.dataset.opt]; if (!opt) return;
        ctx.opt = opt; this.revealOptions(root, opts, ob);
        timer.id = setTimeout(go, 3400);
      });
    },

    revealOptions(root, opts, picked) {
      const list = picked.closest('.opts');
      Array.prototype.forEach.call(list.querySelectorAll('[data-opt]'), b => {
        const o = opts[+b.dataset.opt]; if (!o) return;
        const isPick = b === picked;
        b.insertAdjacentHTML('beforeend', this.revealHtml(o, isPick));
        b.classList.add(isPick ? 'picked' : 'passed');
      });
      list.classList.add('locked');
      list.insertAdjacentHTML('beforeend', '<span class="reveal-tip">账亮出来了 —— 点任意处继续</span>');
      const bar = root.querySelector('.cardbar'); if (bar) bar.classList.add('locked');
    },
    revealHtml(o, picked) {
      const c = o.cost || {}; const parts = [];
      [['men', '兵'], ['food', '粮'], ['window', '时'], ['trust', '民']].forEach(([k, lb]) => {
        if (!c[k]) return; parts.push(lb + ' ' + (c[k] > 0 ? '+' : '') + c[k] + (k === 'trust' && o.sin ? '（当场不收）' : ''));
      });
      return `<span class="opt-reveal">${picked ? '你选的：' : '没选的那条：'}${esc(parts.join(' · ') || '没有资源增减')}</span>`;
    },

    /* —— 结算管线 —— */
    resolve(node, opt) { this.applyChoice(node, opt, () => this.afterResolve(node, opt)); },
    regionOf(node) { return node.region || (NODE_MAP[Store.s.at] || {}).region || 'gan'; },
    isCombatOf(node) { return /battle|pass|bridge|ford|snow|swamp/.test(node.icon || '') || !!(node.floor && node.floor.men); },

    compute(node, opt) {
      const s = Store.s; const cost = opt.cost || {};
      const d = { men: 0, food: cost.food || 0, window: cost.window || 0, trust: cost.trust || 0 };
      let loss = Math.max(0, -(cost.men || 0)); let gain = Math.max(0, cost.men || 0);
      const notes = []; const isCombat = this.isCombatOf(node);
      const cardId = this.chosenCard;
      if (cardId) {
        const fx = CARD_FX[cardId] || {};
        if (fx.skipCombatLoss && isCombat) loss = 0;
        if (fx.halveLoss) loss = Math.round(loss / 2);
        if (fx.fixedLoss != null) loss = fx.fixedLoss;
        if (fx.menBack && isCombat) gain += fx.menBack;
        if (fx.men > 0) gain += fx.men; else if (fx.men < 0) loss += -fx.men;
        if (fx.food) d.food += fx.food;
        if (fx.window) d.window += fx.window;
        if (fx.trust) d.trust += fx.trust;
        if (fx.ignorePursuit) s.flags.ignorePursuit = true;
        if (fx.blockSurprise) s.blockNextSurprise = true;
        if (fx.noHungerOnce) s.hungerImmune = true;
        if (fx.trustNext) s.trustNext = fx.trustNext;
        if (fx.needsComrade && s.comrades.length) {
          const id = s.comrades.shift(); this.carve((COMRADES[id] || {}).name + '（' + ((COMRADES[id] || {}).role || '') + '）');
          notes.push((COMRADES[id] || {}).name + ' 的名字刻上了木牌');
        }
        if (s.used.indexOf(cardId) < 0) s.used.push(cardId);
        notes.push('手法卡生效：' + ((CARDS[cardId] || {}).name || cardId));
        this.chosenCard = null;
      }
      if ((s.window <= 0 || s.flags.pursuitHot) && loss > 0) {
        if (s.flags.ignorePursuit) notes.push('这一格的追兵被手法卡顶掉了');
        else { loss *= 2; notes.push('追兵压上来了 — 这一格的代价翻倍'); }
      }
      s.flags.pursuitHot = false; s.flags.ignorePursuit = false;
      if (s.food + d.food <= 0) {
        if (s.hungerImmune) { s.hungerImmune = false; notes.push('「分最后一口」把这一次饿倒顶掉了'); }
        else { loss += BALANCE.hungerLoss; notes.push('断了粮：倒在地上的人比枪子多（多折 ' + BALANCE.hungerLoss + ' 支）'); }
      }
      if (s.trust < 20 && ['chuan', 'grass', 'min'].indexOf(this.regionOf(node)) >= 0) {
        loss += 3; notes.push('这一带没人肯带路，多绕出来的路要用人换');
      }
      if (opt.sin) d.trust = 0;
      if (s.trustNext) { d.trust += s.trustNext; s.trustNext = 0; }
      d.men = gain - loss;
      return { d, loss, gain, isCombat, notes };
    },

    applyChoice(node, opt, after) {
      const s = Store.s; s.flags.lastChoiceLabel = opt.label;
      const p = this.compute(node, opt);
      const canOffer = !opt.sin && p.isCombat && p.loss >= 5 && s.comrades.length > 0;
      if (canOffer) this.offerComrade(node, opt, p, after); else this.commit(node, opt, p, after);
    },

    commit(node, opt, p, after) {
      const s = Store.s;
      s.flags.lastNotes = p.notes.slice();
      s.flags.lastDelta = { men: p.d.men, food: p.d.food, window: p.d.window, trust: p.d.trust };
      p.notes.forEach(msg => Toast.show(msg));
      this.apply(p.d);
      if (this.charityTop()) {
        s.flags.lastNotes = s.flags.lastNotes.concat(['百姓把粮分出来：粮 +' + BALANCE.charity.food]);
        s.flags.lastDelta.food = (s.flags.lastDelta.food || 0) + BALANCE.charity.food;
        Hud.flash({ food: BALANCE.charity.food });
      }
      Hud.flash(p.d);
      this.finishChoice(node, opt, p.d);
      s.flags.lastResolvedNode = node.id;
      this.logStep({ kind: 'choice', label: opt.label, delta: { men: p.d.men, food: p.d.food, window: p.d.window, trust: p.d.trust },
        sin: opt.sin ? opt.sin.type : null, hunger: s.food <= 0, menAfter: s.men, foodAfter: s.food, windowAfter: s.window, trustAfter: s.trust,
        blank: s.board.blanks, note: (s.flags.lastNotes || []).slice(-1)[0] || '' });
      if (opt.recruit && COMRADES[opt.recruit]) Memory.add('saved', '把' + (COMRADES[opt.recruit] || {}).name + '编进了队伍');
      if (s.food <= 0) Memory.add('shared_hunger', '断粮的一格');
      if (opt.sin) Sin.register(opt.sin);
      Store.save();
      if (after) after(); else this.postChoice(node);
    },

    offerComrade(node, opt, p, after) {
      const s = Store.s; const lost = p.loss;
      Modal.open({ title: '有人往前站了一步', kicker: '战友卡', size: 'mid', closable: false, blocking: true,
        html: `<p class="lead">${esc(opt.outcome || node.text || node.scene || '')}</p>
          <p class="note-hint">这一格要折 ${lost} 支建制。战友可以替你挡一次（每人最多顶 ${BALANCE.mateSave} 支；只挡作战与冻饿，挡不住违纪的账）。</p>`,
        actions: s.comrades.map((id, i) => ({
          text: '让 ' + ((COMRADES[id] || {}).name || id) + ' 顶上去', kind: i === 0 ? 'primary' : 'ghost',
          onClick: () => {
            s.comrades.splice(i, 1);
            Memory.add('abandoned', '让' + ((COMRADES[id] || {}).name || id) + '顶上去');
            const saved = Math.min(BALANCE.mateSave, p.loss); p.loss -= saved; p.d.men = p.gain - p.loss;
            this.carve(((COMRADES[id] || {}).name || id) + '（' + ((COMRADES[id] || {}).role || '') + '）');
            p.notes.push(((COMRADES[id] || {}).name || id) + ' 替你挡住了这一格：折损 ' + lost + ' → ' + p.loss);
            this.commit(node, opt, p, after);
          }
        })).concat([{ text: '谁也别顶，我们自己扛', kind: 'ghost', onClick: () => this.commit(node, opt, p, after) }]) });
    },

    carve(nm) { const s = Store.s; if (nm && s.board.names.indexOf(nm) < 0) s.board.names.push(nm); },

    finishChoice(node, opt, d) {
      const s = Store.s;
      const addItem = (id) => { if (ITEMS[id] && s.items.indexOf(id) < 0) s.items.push(id); };
      (opt.gain || []).forEach(addItem); (node.gain || []).forEach(addItem);
      if (opt.reward === 'guide' || node.reward === 'guide') s.flags.guide = true;
      if (opt.outcomeCard && CARDS[opt.outcomeCard] && s.hand.indexOf(opt.outcomeCard) < 0) s.hand.push(opt.outcomeCard);
      if (opt.outcome) s.flags.lastText = opt.outcome; else s.flags.lastText = '';
      const rid = opt.recruit;
      if (rid && COMRADES[rid] && s.comrades.indexOf(rid) < 0) {
        if (s.comrades.length < BALANCE.comradeCap) {
          s.comrades.push(rid);
          s.flags.lastNotes = (s.flags.lastNotes || []).concat([((COMRADES[rid] || {}).name || rid) + '（' + ((COMRADES[rid] || {}).role || '') + '）编进了队伍 — 战友卡多一张']);
        } else {
          s.flags.lastNotes = (s.flags.lastNotes || []).concat([((COMRADES[rid] || {}).name || rid) + ' 留不下来：建制已经满编，他在原地养伤']);
        }
      }
      Store.save();
    },

    afterResolve(node, opt) {
      const s = Store.s; const first = !s.done[node.id];
      s.done[node.id] = true;
      if (node.carve) {
        if (node.carve.place && s.board.places.indexOf(node.carve.place) < 0) s.board.places.push(node.carve.place);
        (node.carve.names || []).forEach(nm => this.carve(nm));
        if (node.carve.blank) s.board.blanks += node.carve.blank;
      }
      (node.gainCards || []).forEach(id => { if (CARDS[id] && s.hand.indexOf(id) < 0) s.hand.push(id); });
      if (first && node.kind === 'gate') { Memory.receipt(); this.gateSpoils(node); return; }
      this.postChoice(node);
    },

    gateSpoils(node) {
      const g = BALANCE.gateSpoils, s = Store.s; let picked = false;
      const take = (want, label) => {
        if (picked) return true; picked = true;
        const before = { men: s.men, food: s.food, window: s.window, trust: s.trust };
        this.apply(want);
        const real = {}; Object.keys(want).forEach(k => { const v = s[k] - before[k]; if (v) real[k] = v; });
        const txt = ['men', 'food', 'window', 'trust'].filter(k => real[k]).map(k => RES[k].label + ' +' + real[k]).join(' · ');
        s.flags.lastNotes = (s.flags.lastNotes || []).concat([label + '：' + (txt || '这一样已经到了上限，什么也没多出来')]);
        const ld = s.flags.lastDelta || { men: 0, food: 0, window: 0, trust: 0 };
        Object.keys(real).forEach(k => { ld[k] = (ld[k] || 0) + real[k]; });
        s.flags.lastDelta = ld; Hud.flash(real); Store.save(); Modal.closeAll(); this.postChoice(node); return true;
      };
      Modal.open({ title: '缴获与休整', kicker: node.name + ' · 三样只能带一样', size: 'mid', blocking: true, closable: false,
        html: `<p class="lead">打下来这一处，院子里堆着缴获，队伍也争到半天空当。可带走的只够一样。</p>
          <p class="note-hint">现在：兵 ${s.men} · 粮 ${s.food} · 时 ${s.window}</p>`,
        actions: [
          { text: `先把口粮运走（粮 +${g.food}）`, kind: 'primary', onClick: () => take({ food: g.food }, '缴获先紧着口粮') },
          { text: `连夜赶路，抢回时间（时 +${g.window}）`, kind: 'ghost', onClick: () => take({ window: g.window }, '连夜赶路，把追兵甩远') },
          { text: `就地整编掉队的人（兵 +${g.men}）`, kind: 'ghost', onClick: () => take({ men: g.men }, '就地整编') }
        ] });
    },

    afterMove(dest) {
      const s = Store.s;
      s.flags.road = { text: this.resultText(), notes: (s.flags.lastNotes || []).slice(), delta: s.flags.lastDelta };
      Sin.tick(); Store.save(); Hud.render(); if (Game3D.refreshNav) Game3D.refreshNav();
      if (Sin.shouldTrigger()) { s.flags.road = null; Sin.collect(NODE_MAP[s.at] || dest); return; }
      if (s.men <= 0) { s.flags.road = null; Flow.nextCheng(NODE_MAP[s.at] || dest); return; }
      this.enter(dest);
    },

    postChoice(node) {
      const s = Store.s;
      Sin.tick(); Store.save(); Hud.render(); if (Game3D.refreshNav) Game3D.refreshNav();
      if (Sin.shouldTrigger()) { Sin.collect(node); return; }
      if (s.men <= 0) { Flow.nextCheng(node); return; }
      if (node.kind === 'gate') this.showLore(node);
      else Modal.open({ title: node.name, kicker: '了结', size: 'mid',
        html: `<p class="lead">${esc(this.resultText())}</p>` + this.notesHtml() + this.deltaHtml() + this.loreLinks(node),
        actions: [{ text: '回到地图', kind: 'primary' }] });
    },

    resultText() { const f = Store.s.flags; if (f.lastText) return f.lastText; return f.lastChoiceLabel ? `你按下去的是：「${f.lastChoiceLabel}」。队伍按命令继续走。` : '队伍继续往前走。'; },
    notesHtml(list) {
      const notes = (list || Store.s.flags.lastNotes || []).filter(Boolean);
      if (!notes.length) return '';
      return `<ul class="notelist">` + notes.map(n => `<li>${esc(n)}</li>`).join('') + `</ul>`;
    },

    showLore(node) {
      const s = Store.s; const ids = node.lore || [];
      const items = ids.map(id => HISTORY.find(h => h.id === id)).filter(Boolean);
      const html = `<p class="cg">${esc(this.resultText())}</p>` + this.notesHtml() + this.deltaHtml() +
        (items.length ? `<div class="lore-list">` + items.map(h => `
          <article class="lore" data-h="${esc(h.id)}">
            <div class="lore-top"><span class="grade g-${h.grade}">${h.grade}</span><h4>${esc(h.title)}</h4></div>
            <p class="lore-where">${esc(h.where || '')}</p><p class="lore-t">${esc(h.text)}</p><p class="lore-s">出处：${esc(h.src)}</p>
          </article>`).join('') + `</div>` : '') +
        (node.carve && (node.carve.names || []).length ? `<p class="carve">木牌上刻下了：${node.carve.names.map(esc).join('、')}</p>` : '') +
        (node.epilogue ? `<p class="quote">${esc(node.epilogue)}</p>` : '');
      Modal.open({ title: node.name, kicker: (node.date || '') + ' · 剧情翻面', size: 'wide', cinematic: true, blocking: true,
        art: node.art || (typeof GATE_ART !== 'undefined' ? GATE_ART[node.id] : null),
        html, actions: [{ text: '把这一段的史料记进名册', kind: 'primary',
          onClick: () => { items.forEach(h => History.unlock(h.id)); if (node.epilogue) Toast.show('这一段也记下了'); } }] });
      items.forEach(h => History.unlock(h.id));
    },

    loreLinks(node) {
      const ids = node.lore || []; if (!ids.length) return '';
      return `<p class="lore-links">史料：<a data-link="history" data-hid="${esc(ids[0])}" href="#">${esc((HISTORY.find(h => h.id === ids[0]) || {}).title || '')}</a> 等 ${ids.length} 条</p>`;
    },

    deltaHtml(d) {
      const s = Store.s; const x = d || s.flags.lastDelta || {};
      const txt = ['men', 'food', 'window', 'trust'].filter(k => x[k]).map(k => `${RES[k].label} ${x[k] > 0 ? '+' : ''}${x[k]}`).join(' · ');
      return `<p class="delta">这一格的账：${esc(txt || '没有资源的增减')}</p>
        <p class="costline">现在：兵 ${s.men} · 粮 ${s.food} · 时 ${s.window} · 民 ${s.trust}</p>`;
    },

    roadHtml() {
      const r = Store.s.flags.road; if (!r) return '';
      Store.s.flags.road = null;
      return `<div class="road-note"><span class="road-tag">路上</span><p class="lead">${esc(r.text)}</p>${this.notesHtml(r.notes)}${this.deltaHtml(r.delta)}</div>`;
    },

    charityTop() {
      const s = Store.s, c = BALANCE.charity;
      if (s.food > 0 || s.trust < c.trust) return false;
      const n = s.flags.charityCount || 0; if (n >= c.max) return false;
      s.food = clamp(s.food + c.food, 0, RES.food.max); s.flags.charityCount = n + 1;
      Toast.show('百姓把粮分出来 — 民心换回 ' + c.food + ' 天口粮（第 ' + (n + 1) + '/' + c.max + ' 次）');
      return true;
    },

    apply(d) {
      const s = Store.s; if (!d) return;
      if (d.men) s.men = clamp(s.men + d.men, 0, s.menCap);
      if (d.food) s.food = clamp(s.food + d.food, 0, RES.food.max);
      if (d.window) s.window = clamp(s.window + d.window, 0, RES.window.max);
      if (d.trust) s.trust = clamp(s.trust + d.trust, 0, RES.trust.max);
      Store.save();
    },

    /* —— 行进突发事件（移植） —— */
    rollMoveEvent() {
      const s = Store.s, f = s.flags; const cur = NODE_MAP[s.at] || {};
      const seen = f.moveSeen || (f.moveSeen = {});
      if (BALANCE.regionP > 0 && Math.random() < BALANCE.regionP) {
        const local = MOVE_EVENTS.filter(m => m.localRegion === cur.region && (seen[m.id] || 0) < 2 && m.id !== f.lastMoveId);
        if (local.length) { const m = local[rnd(local.length)]; seen[m.id] = (seen[m.id] || 0) + 1; f.lastMoveId = m.id; f.lastMoveLocal = true; return this.pickVariant(m); }
      }
      f.lastMoveLocal = false;
      const pool = MOVE_EVENTS.filter(m => {
        if (m.localRegion) return false;
        if (m.region && m.region.indexOf(cur.region) < 0) return false;
        const n = m.need || {};
        if (n.windowMax != null && s.window > n.windowMax) return false;
        if (n.trustMin != null && s.trust < n.trustMin) return false;
        if (n.trustMax != null && s.trust > n.trustMax) return false;
        if (n.menMax != null && s.men > n.menMax) return false;
        return true;
      });
      if (!pool.length) return null;
      const CAP = 2, w = m => m.weight * Math.pow(0.3, seen[m.id] || 0);
      let cands = pool.filter(m => (seen[m.id] || 0) < CAP && m.id !== f.lastMoveId);
      if (!cands.length) cands = pool.filter(m => (seen[m.id] || 0) < CAP);
      if (!cands.length) { const min = Math.min.apply(null, pool.map(m => seen[m.id] || 0)); cands = pool.filter(m => (seen[m.id] || 0) === min); }
      let total = cands.reduce((a, m) => a + w(m), 0), r = Math.random() * total;
      let picked = cands[cands.length - 1];
      for (const m of cands) { r -= w(m); if (r <= 0) { picked = m; break; } }
      seen[picked.id] = (seen[picked.id] || 0) + 1; f.lastMoveId = picked.id;
      return this.pickVariant(picked);
    },
    pickVariant(m) {
      const f = Store.s.flags; const region = (NODE_MAP[Store.s.at] || {}).region;
      const raw = (m.variants || []).filter(v => !v.region || v.region === region);
      const list = [{ title: m.title, text: m.text, options: m.options }].concat(raw);
      const used = f.mvVar || (f.mvVar = {});
      const fresh = list.map((v, i) => i).filter(i => !used[m.id + '#' + i]);
      const i = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : Math.floor(Math.random() * list.length);
      used[m.id + '#' + i] = 1; const v = list[i];
      enemyMod();
      return Object.assign({}, m, { title: v.title, text: v.text, options: v.options || m.options });
    },

    /* —— 逐格战史日志 —— */
    logStep(e) {
      const s = Store.s; if (!s.log) s.log = [];
      const at = NODE_MAP[s.at] || {};
      s.log.push(Object.assign({ i: s.log.length + 1, at: s.at, place: at.name || '', region: at.region || '', run: s.run }, e));
      if (s.log.length > 120) { const head = s.log.splice(0, 60); s.log.unshift({ i: 0, kind: 'digest', place: '前段路程', region: '', steps: head.length, note: '前 ' + head.length + ' 步已压缩，只保留摘要' }); }
    },
    echoLine(node) {
      const s = Store.s; const sin = (s.log || []).filter(e => e.kind === 'choice' && e.sin);
      if (!sin.length) return '';
      const first = sin[0]; const what = String(first.label || '那一次').replace(/[（(].*?[）)]/g, '').trim();
      return '那天在' + (first.place || '路上') + '，你按下了「' + what + '」。今天走到' + (node.name || '这里') + '，门口没有人出来。';
    },
    pendingCutscene(node) {
      const s = Store.s; if (typeof CUTSCENES === 'undefined' || !CUTSCENES) return null;
      const prev = s.flags.lastResolvedNode; if (!prev) return null;
      const keys = Object.keys(CUTSCENES);
      for (let i = 0; i < keys.length; i++) { const c = CUTSCENES[keys[i]]; if (c.afterNode === prev && (!c.beforeNode || c.beforeNode === node.id) && !s.done['cut_' + keys[i]]) return { key: keys[i], c }; }
      return null;
    },
    playCutscene(node, hit, done) {
      const s = Store.s, c = hit.c; s.done['cut_' + hit.key] = true; s.flags.lastResolvedNode = null;
      Modal.open({ title: c.title, kicker: c.kicker, size: 'wide', cinematic: true, closable: false, blocking: true,
        art: c.art, motion: c.motion,
        html: c.html || '',
        actions: [{ text: '继续走', kind: 'primary', onClick: () => { setTimeout(done, 200); } }] });
    },

    refreshTrays() {
      const s = Store.s;
      const ht = doc && doc.getElementById('hand-tray'); if (ht) ht.innerHTML = s.hand.filter(id => s.used.indexOf(id) < 0).map(id => `<button class="chip" data-card="${id}" title="${esc((CARDS[id] || {}).desc || '')}">${esc((CARDS[id] || {}).name || id)}</button>`).join('') || '<i class="dim">（暂无可用手法卡）</i>';
      const ct = doc && doc.getElementById('comrade-tray'); if (ct) ct.innerHTML = s.comrades.map(id => `<button class="chip comrade" data-comrade="${id}" title="${esc((COMRADES[id] || {}).role || '')}">${esc((COMRADES[id] || {}).name || id)}</button>`).join('') || '<i class="dim">（身边无人）</i>';
    }
  };

  /* ---------------- Sin：多行不义必自毙（移植） ---------------- */
  const Sin = {
    register(sin) {
      const s = Store.s; Memory.add('sin_witness', '没有拦下「' + (s.flags.lastChoiceLabel || '那件事') + '」');
      s.sin += (sin.n || 1);
      if (s.sinTypes.indexOf(sin.type) < 0) s.sinTypes.push(sin.type);
      s.flags.warnRestart = false;
      if (sin.n && sin.n >= 3) s.flags.reckonFresh = true;
    },
    tick() {
      const s = Store.s;
      if (s.flags.reckonPending) { s.reckonIn = (s.reckonIn || 0) + 1; }
      const th = DISCIPLINE && DISCIPLINE.threshold ? DISCIPLINE.threshold : 3;
      if (s.sin >= th && !s.flags.reckonPending) { s.reckonPending = true; s.reckonIn = 0; s.flags.reckonFresh = true; }
    },
    shouldTrigger() {
      const s = Store.s; const th = DISCIPLINE && DISCIPLINE.threshold ? DISCIPLINE.threshold : 3;
      return s.sin >= th && s.flags.reckonPending && s.reckonIn >= (DISCIPLINE && DISCIPLINE.grace != null ? DISCIPLINE.grace : 1);
    },
    collect(node) {
      const s = Store.s; const self = this;
      const kinds = s.sinTypes.slice();
      const dead = SIN_TEXT && SIN_TEXT.dead ? SIN_TEXT.dead : '队伍被打散';
      s.flags.reckonPending = false; s.reckonIn = 0; s.flags.warnRestart = true;
      const lessons = Store.meta.lessons || (Store.meta.lessons = {});
      kinds.forEach(t => { lessons[t] = true; });
      Modal.open({ title: '多行不义必自毙', kicker: '违纪 · 清算', size: 'wide', cinematic: true, blocking: true,
        art: 'cg-17',
        html: `<p class="cg">${esc(dead)}</p><p class="lead">这一程记下的几种违纪：${esc(kinds.join('、') || '—')}。</p>
          <p class="note-hint">与「下一程」不同：这里是教育。点「接下这一程」从走错那一步重来，木牌上已刻的名字不清。</p>`,
        actions: [{ text: '接下这一程', kind: 'primary', onClick: () => self.restart(node) }] });
    },
    restart(node) {
      const s = Store.s; s.runsWarn = (s.runsWarn || 0) + 1;
      s.menCap = Math.max(30, s.menCap - 10); s.men = s.menCap; s.food = BALANCE.init.food; s.window = BALANCE.init.window; s.trust = BALANCE.init.trust;
      s.sin = 0; s.sinTypes = []; s.flags.reckonPending = false; s.flags.warnRestart = true;
      Store.save(); Hud.render(); if (Game3D.refreshNav) Game3D.refreshNav();
      this.backToSafe(node);
    },
    backToSafe(node) {
      const s = Store.s; let target = node;
      if (node && (ADJ[s.at] || new Set()).has(node.id)) target = node;
      s.at = (target && target.id) || s.at;
      const m = Modal.open({ title: '从这一步继续', kicker: '违纪复盘', size: 'mid',
        html: `<p class="lead">纪律是这支队伍能走完的底线。${esc(target ? target.name : '')} 还在脚下，整理好再走。</p>`,
        actions: [{ text: '继续', kind: 'primary', onClick: () => { if (Game3D.refreshNav) Game3D.refreshNav(); m.close(); } }] });
    }
  };

  /* ---------------- Flow：下一程（部队打散，宽慰式重开） ---------------- */
  const Flow = {
    nextCheng(node) {
      const s = Store.s; const self = this;
      const falls = (s.flags.fallCount || 0) + 1; s.flags.fallCount = falls;
      if (falls > BALANCE.fallLimit) {
        Modal.open({ title: '收容队又一次架起了你', kicker: '下一程', size: 'mid',
          html: `<p class="lead">这一程倒下的太多。收容队把你接回，木牌上又多了几个名字。</p>`,
          actions: [{ text: '回到于都河，再走一次', kind: 'primary', onClick: () => self.restart() }] });
        return;
      }
      Modal.open({ title: '天亮时，收容队把你架了起来', kicker: '下一程', size: 'wide', cinematic: true,
        art: 'cg-18',
        html: `<p class="cg">没有人写你失败。队伍打散了，有人把你从泥里拉起来——这是真事里发生过许多次的事。</p>
          <p class="lead">木牌上已经刻下的名字不会丢。整队重新清点，你接着走。</p>
          <p class="note-hint">兵力上限 −5，开局少一张手法卡，从「下一个还走得动的人」所在的节点继续（不是序章）。</p>`,
        actions: [{ text: '接下这一程', kind: 'primary', onClick: () => self.restart() }] });
    },
    restart() {
      const s = Store.s; s.runsFailed = (s.runsFailed || 0) + 1;
      s.menCap = Math.max(30, s.menCap - 5); s.men = s.menCap; s.food = BALANCE.init.food; s.window = BALANCE.init.window; s.trust = BALANCE.init.trust;
      s.hand = ['c_no_left', 'c_night', 'c_assault', 'c_rules', 'c_lastbite', 'c_pot']; s.used = [];
      s.comrades = ['m_xiaoxie', 'm_laofan', 'm_sanya', 'm_qian']; s.items = [];
      /* 找「下一个还走得动的人」：沿主线第一个未完成的大关卡之后 */
      let at = 'g1';
      const main = ['g1','g2','g3','g4','g4b','g4c','g5','g6','g7','g7b','g8','g8b','g9','g10','g11','g12'];
      for (let i = 0; i < main.length; i++) { if (!s.done[main[i]]) { at = (i > 0 ? main[i - 1] : main[i]); break; } if (i === main.length - 1) at = main[main.length - 1]; }
      s.at = at; s.done = s.done || {};
      Store.save(); Hud.render(); if (Game3D.refreshNav) Game3D.refreshNav();
      Toast.show('下一程：从 ' + ((NODE_MAP[at] || {}).name || at) + ' 继续');
    }
  };

  /* ---------------- History：史料名册 ---------------- */
  const History = {
    unlock(id) {
      const m = Store.meta; if (!m.unlocked) m.unlocked = [];
      if (m.unlocked.indexOf(id) < 0) m.unlocked.push(id); Store.save();
    },
    isUnlocked(id) { return (Store.meta.unlocked || []).indexOf(id) >= 0; }
  };

  /* ---------------- Ending：吴起镇念名字 ---------------- */
  const Ending = {
    run() {
      const s = Store.s;
      if (!s.flags.sawEnding) { s.flags.sawEnding = true; Store.meta.wins = (Store.meta.wins || 0) + 1; }
      const names = s.board.names.slice();
      const hasLetter = s.items.indexOf('it_letter') >= 0;
      const blank = s.board.blanks || 0;
      const listHtml = names.length
        ? `<ul class="name-list">` + names.map(n => `<li>${esc(n)}</li>`).join('') + `</ul>`
        : `<p class="lead">木牌上没刻下名字——这一程，竟没有一个倒下的人。</p>`;
      const extra = [];
      if (hasLetter) extra.push('<p class="quote">你从怀里摸出那封没送出的信。于都河夜渡那晚写下的话，到底没能递出去。</p>');
      if (blank > 0) extra.push(`<p class="note-hint">木牌上还有 ${blank} 处留白——有些名字，你始终没敢刻。</p>`);
      Modal.open({ title: '吴起镇 · 念名字', kicker: '终章', size: 'wide', cinematic: true, blocking: true,
        art: 'cg-15',
        html: `<p class="cg">到了吴起镇。你蹲下来，把木牌平放在地上，一个一个念。</p>${listHtml}${extra.join('')}
          <p class="src">史料：中央红军到达陕北吴起镇，标志红一方面军长征结束（1935.10.19）。</p>`,
        actions: [{ text: '把这一程挂上名单墙', kind: 'primary', onClick: () => { Wall.hang(); Modal.closeAll(); Pages.wall(); } }] });
    }
  };

  /* ---------------- Wall：名单墙 ---------------- */
  const Wall = {
    hang() {
      const s = Store.s, m = Store.meta; if (!m.wall) m.wall = [];
      m.wall.push({ run: s.run, men: s.men, names: s.board.names.slice(), places: s.board.places.slice(), blanks: s.board.blanks || 0, date: new Date().toISOString().slice(0, 10) });
      if (m.wall.length > 30) m.wall.shift();
      Store.save();
    }
  };

  /* ---------------- Pages：各页面（移植压缩版） ---------------- */
  const Pages = {
    intro() {
      Modal.open({ title: '长征：万水千山', kicker: '3D 立体地图 · 玩法', size: 'wide', cinematic: true, art: 'cg-01',
        html: `<p class="lead">你是红一方面军的通信兵，带着一支队伍往北走。每到一个渡口、一座山、一道关隘，你要在两三个都"错得起的"答案里挑一个；挑完，兵、粮、时、民一起结算；有人倒下，你把名字刻上手里的木牌。</p>
          <p class="note-hint">立体地图上：点发亮的地名（或右侧「下一站」）行军；点当前所在地名查看事件。资源条在右上角。失败不写 Game Over，写"下一程"。</p>`,
        actions: [{ text: '出发', kind: 'primary', onClick: () => { Store.s.flags.sawNotes = true; Store.save(); if (Game3D.flyCurrent) Game3D.flyCurrent(); Modal.closeTop(); } }] });
    },
    notes() {
      Modal.open({ title: '玩家须知', kicker: '规则手册', size: 'mid',
        html: `<p class="lead">兵＝还能走的同伴（按建制计）；粮＝口粮天数；时＝追兵窗口；民＝沿途人心（低于 20 民族地区选项锁死）。</p>
          <p class="note-hint">选项上不标价——先按本心选，结算后再看账。违纪的账会延迟收，但逃不掉。</p>`,
        actions: [{ text: '知道了', kind: 'primary', onClick: () => { Store.s.flags.sawNotes = true; Store.save(); } }] });
    },
    board() {
      const s = Store.s;
      const places = (s.board.places || []).map(p => esc(p)).join('、') || '（暂无）';
      const names = (s.board.names || []).map(n => esc(n)).join('、') || '（暂无）';
      Modal.open({ title: '木牌', kicker: '本局刻下的', size: 'mid',
        html: `<p class="lead">地名：${places}</p><p class="lead">名字（${s.board.names.length}）：${names}</p>${s.board.blanks ? `<p class="note-hint">留白 ${s.board.blanks} 处</p>` : ''}`,
        actions: [{ text: '合上', kind: 'primary' }] });
    },
    wall() {
      const m = Store.meta; const w = m.wall || [];
      const html = w.length ? `<div class="wall-list">` + w.slice().reverse().map(b => `
        <div class="wall-card"><div class="wall-head">第 ${b.run} 程 · ${esc(b.date || '')} · 剩兵 ${b.men}</div>
        <div class="wall-names">${(b.names || []).map(n => esc(n)).join('、') || '无一倒下'}</div></div>`).join('') + `</div>` : '<p class="lead">名单墙还空着。走完一次长征，木牌会挂上来。</p>';
      Modal.open({ title: '名单墙', kicker: '局外 · 永久', size: 'wide', html });
    },
    history() {
      const list = HISTORY.slice().map(h => {
        const on = History.isUnlocked(h.id);
        return `<article class="lore ${on ? '' : 'locked'}" data-h="${esc(h.id)}">
          <div class="lore-top"><span class="grade g-${h.grade}">${h.grade}</span><h4>${esc(h.title)}</h4></div>
          <p class="lore-where">${esc(h.where || '')}</p>
          <p class="lore-t">${on ? esc(h.text) : '（未解锁 —— 在对应关卡结算后翻开）'}</p>
          <p class="lore-s">出处：${esc(h.src)}</p></article>`;
      }).join('');
      Modal.open({ title: '史料与出处', kicker: `A 权威 / R 回忆 / ? 待核 · 已解锁 ${History.isUnlocked ? (Store.meta.unlocked || []).length : 0}/${HISTORY.length}`, size: 'wide',
        html: `<div class="lore-list">${list}</div>` });
    },
    cards() {
      const s = Store.s;
      const html = s.hand.concat(s.used).filter((v, i, a) => a.indexOf(v) === i).map(id => {
        const c = CARDS[id]; if (!c) return '';
        const used = s.used.indexOf(id) >= 0;
        return `<article class="card-detail ${used ? 'used' : ''}"><h4>${esc(c.name)}<span class="tag">${esc(c.school || '')}</span></h4><p>${esc(c.desc)}</p></article>`;
      }).join('');
      Modal.open({ title: '手法卡与道具', kicker: '本局持有', size: 'wide', html: `<div class="card-list">${html}</div>` });
    },
    comrades() {
      const s = Store.s;
      const html = s.comrades.length ? s.comrades.map(id => {
        const c = COMRADES[id]; if (!c) return '';
        return `<article class="card-detail"><h4>${esc(c.name)}<span class="tag">${esc(c.role || '')}</span></h4><p>${esc(c.story || c.desc || '')}</p></article>`;
      }).join('') : '<p class="lead">身边暂时无人。</p>';
      Modal.open({ title: '身边战友', kicker: `在队 ${s.comrades.length} 人`, size: 'wide', html: `<div class="card-list">${html}</div>` });
    },
    cardDetail(id) { const c = CARDS[id]; if (!c) return; Modal.open({ title: c.name, kicker: c.school || '', size: 'sm', html: `<p class="lead">${esc(c.desc)}</p>` }); },
    comradeDetail(id) { const c = COMRADES[id]; if (!c) return; Modal.open({ title: c.name, kicker: c.role || '', size: 'sm', html: `<p class="lead">${esc(c.story || c.desc || '')}</p>` }); },
    memory() {
      const s = Store.s; const mem = s.mem || [];
      const html = mem.length ? mem.map(m => `<p class="mem">· ${esc(m.text)}</p>`).join('') : '<p class="lead">还没有值得记住的事。</p>';
      Modal.open({ title: '战友记忆', kicker: '局内 · 叙事', size: 'mid', html });
    },
    help() {
      Modal.open({ title: '规则手册', kicker: '怎么玩', size: 'mid',
        html: `<p class="lead">四资源互相牵制：兵（人）归零→"下一程"；粮≤0 每格多折人；时≤0 下一格折损翻倍；民<20 民族地区选项锁死。</p>
          <p class="note-hint">手法卡一次附一张；战友卡只在作战/冻饿时替你挡一次；道具进背包。大关卡第一次打下有"缴获与休整"（粮/时/兵三样带一样）。</p>`,
        actions: [{ text: '合上', kind: 'primary' }] });
    },
    codePage() {
      const code = Store.exportCode();
      Modal.open({ title: '存档码', kicker: '清档后凭此续局', size: 'mid',
        html: `<p class="note-hint">复制下面这段，清档后粘进「读档」即可续：</p><textarea class="code-box" readonly>${esc(code || '')}</textarea>`,
        actions: [{ text: '复制', kind: 'ghost', onClick: () => { try { if (doc) { const t = doc.querySelector('.code-box'); if (t) t.select(); if (G.getSelection) G.getSelection().removeAllRanges(); } } catch (e) {} return true; } },
                  { text: '读档', kind: 'primary', onClick: () => { const v = G.prompt ? G.prompt('粘贴存档码') : null; if (v && Store.importCode(v)) { Modal.closeAll(); Hud.render(); Toast.show('已读档'); if (Game3D.refreshNav) Game3D.refreshNav(); } return true; } }] });
    },
    confirmReset() {
      Modal.open({ title: '清空存档', kicker: '确认', size: 'sm',
        html: `<p class="lead">会清掉本局与名单墙，且不可恢复。</p>`,
        actions: [{ text: '取消', kind: 'ghost' }, { text: '确认清空', kind: 'primary', onClick: () => { store_del(SAVE_KEY); store_del(META_KEY); Store.load(); Hud.render(); if (Game3D.refreshNav) Game3D.refreshNav(); Toast.show('已清空'); } }] });
    }
  };

  /* ====================================================================
   *  3D 集成层：Game3D（route3d.html 通过本对象钩入）
   * ================================================================== */
  const Game3D = {
    vmap: null,
    init(vmap) { this.vmap = vmap; this.boot(); },
    boot() {
      try { Game.boot(); } catch (e) { console.error('[Game3D] boot error', e); }
      this.buildNav(); this.refreshNav(); if (Game.refreshTrays) Game.refreshTrays(); this.tickInit = true;
    },
    flyCurrent() { if (this.vmap && this.vmap.focus) this.vmap.focus(Store.s.at); },

    buildNav() {
      if (!doc) return;
      let nav = doc.getElementById('g3d-nav');
      if (!nav) {
        nav = doc.createElement('div'); nav.id = 'g3d-nav'; nav.className = 'g3d-nav';
        /* 优先放进 3D 页的底栏槽位，让它跟「下一站」按钮同一条流式带，不再靠 absolute 像素对齐 */
        const host = doc.getElementById('g3d-nav-slot') || doc.getElementById('viewport') || doc.body;
        host.appendChild(nav);
      }
      let hits = doc.getElementById('node-hits');
      if (!hits) {
        hits = doc.createElement('div'); hits.id = 'node-hits'; hits.className = 'node-hits';
        (doc.getElementById('stage') || doc.body).appendChild(hits);
      }
    },
    refreshNav() {
      if (!doc) return;
      const nav = doc.getElementById('g3d-nav'); if (!nav) return;
      const s = Store.s; const cur = NODE_MAP[s.at];
      const ns = Game.nextNodes();
      const rec = ns[0] ? ns[0].id : null;   /* 唯一真正的下一站（与地图金色高亮一致） */
      nav.innerHTML =
        `<div class="nav-cur"><b>${esc(cur ? cur.name : s.at)}</b><span class="nav-cur-tip">点此地查看</span>
          <button class="nav-enter" data-enter="1">查看此地</button></div>` +
        (ns.length ? `<div class="nav-next"><span class="nav-next-tip">下一站：</span>` +
          ns.map(n => `<button class="nav-go${n.id === rec ? ' rec' : ''}" data-go="${n.id}">${esc(n.name)}${n.id === rec ? ' <span class="recdot">★</span>' : ''}</button>`).join('') + `</div>` : '<div class="nav-next"><i class="dim">已到终点或暂无可走之路</i></div>');
      nav.querySelector('[data-enter]').addEventListener('click', () => Game.enter(cur));
      Array.prototype.forEach.call(nav.querySelectorAll('[data-go]'), b => b.addEventListener('click', () => Game.onNodeClick(b.dataset.go)));
      /* 底部大按钮直接写出目的地，手机端不用先读左下角再猜该走哪一格 */
      const np = doc.getElementById('next-pill');
      if (np) {
        const n = ns[0];
        np.innerHTML = n ? '<em>下一站</em><b>' + esc(n.name) + '</b>' : '已到终点';
        np.disabled = !n;
        np.title = n ? '前往 ' + n.name : '已到终点';
      }
      Game.refreshTrays();
    },

    /* 每帧由 route3d 的 frame() 调用：把"你在这里"与相邻可走格投影成可点击热区。
       增量更新，不重建 DOM —— 按钮与点击事件常驻，只改位置/可见性，避免 60fps 重建丢掉点击。 */
    _tick() {
      if (!doc || !this.vmap || !this.vmap.project) return;
      const hits = doc.getElementById('node-hits'); if (!hits) return;
      const s = Store.s; if (!s) return;
      if (!this._hitLayer) this._hitLayer = {};
      const cur = s.at, seen = {};
      const rec = Game.nextNodes()[0];   /* 唯一真正的下一站：金色高亮，从一众红点里一眼可辨 */
      NODES3D_SAFE.forEach(n => {
        const p = this.vmap.project(n.x, n.z, n.h || 6);
        if (!p || !p.visible) return;
        /* 远出视口的热区不要落到 DOM 上：绝对定位的离屏按钮会把手机布局视口撑宽，
           固定定位的移动键随即被挤到屏幕外。舞台另有一层 overflow 裁切兜底。 */
        const host = doc.getElementById('stage');
        const vw = (host && host.clientWidth) || window.innerWidth || 390;
        const vh = (host && host.clientHeight) || window.innerHeight || 844;
        if (p.x < -46 || p.x > vw + 46 || p.y < -46 || p.y > vh + 46) return;
        const isCur = n.id === cur;
        const reach = (ADJ[cur] || new Set()).has(n.id) && Game.reachable(n.id);
        if (!isCur && !reach) return;            /* 只亮当前 + 相邻可走格，避免热区糊屏 */
        seen[n.id] = true;
        let b = this._hitLayer[n.id];
        if (!b) {
          b = doc.createElement('button'); b.className = 'node-hit'; b.dataset.id = n.id;
          b.addEventListener('click', () => Game.onNodeClick(b.dataset.id));
          hits.appendChild(b); this._hitLayer[n.id] = b;
        }
        b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; b.style.display = 'block';
        const isNext = !isCur && reach && rec && rec.id === n.id;
        b.className = 'node-hit' + (isCur ? ' cur' : '') + (reach ? ' reach' : '') + (isNext ? ' next' : '');
        b.title = n.name; b.textContent = isCur ? '★' : '';
      });
      for (const id in this._hitLayer) if (!seen[id]) this._hitLayer[id].style.display = 'none';
    }
  };
  /* NODES3D 由 route3d 注入（地图坐标），这里留一个安全引用 */
  let NODES3D_SAFE = [];
  Game3D.setNodes = (arr) => { NODES3D_SAFE = arr || []; };

  /* 暴露到全局 */
  G.Game3D = Game3D;
  G.Game3D_Engine = { Game, Sin, Flow, Ending, History, Pages, Store, Wall, Modal, Hud, Toast, Memory, RES, BALANCE, CARD_FX, NODE_MAP, ADJ, NODES, EDGES, CARDS, COMRADES, ITEMS, HISTORY, MOVE_EVENTS, DISCIPLINE, SIN_TEXT, CUTSCENES };

})();

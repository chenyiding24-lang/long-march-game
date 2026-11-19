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
      this.checkpoint = null;
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
    restore() {
      if (!this.checkpoint) return;
      const current = this.s;
      this.s = JSON.parse(this.checkpoint);
      ['run', 'runsFailed', 'runsWarn'].forEach(k => { this.s[k] = Math.max(this.s[k] || 0, current[k] || 0); });
      this.s.menCap = Math.min(this.s.menCap, current.menCap);
    },
    rollback() { this.restore(); },
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
        this.checkpoint = null;
        this.s = Object.assign(this.defaultState(), o.s);
        this.meta = Object.assign(this.defaultMeta(), o.m || {});
        if (!Array.isArray(this.s.log)) this.s.log = [];
        if (!this.s.flags) this.s.flags = {};
        this.save(); return true;
      } catch (e) { return false; }
    }
  };

  /* ---------------- 轻量 Memory（战史/记忆，移植自 game.js Memory 的最小集） ---------------- */
const Share = {
  code() {
    const s = Store.s;
    const raw = s.run + '|' + s.board.names.length + '|' + s.men + '|' + Object.keys(s.visited).length;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) >>> 0;
    return h.toString(36).toUpperCase().slice(0, 6).padStart(6, '0');
  },
  defaultLine() {
    const s = Store.s;
    const steps = (s.log || []).filter(e => e.kind === 'march').length;
    return '第 ' + s.run + ' 程 · 走过 ' + steps + ' 格 · 木牌 ' + s.board.names.length + ' 个名字';
  },
  render(line) {
    try {
      const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
      const x = c.getContext('2d'); if (!x) return null;
      const s = Store.s;
      x.fillStyle = '#efe6d0'; x.fillRect(0, 0, 900, 1200);
      x.fillStyle = '#8C3B2E'; x.fillRect(0, 0, 900, 14);
      x.strokeStyle = 'rgba(122,111,87,.5)'; x.lineWidth = 2; x.strokeRect(28, 34, 844, 1132);
      x.fillStyle = '#2c2820'; x.font = '500 54px "Songti SC","SimSun",serif';
      x.fillText('万水千山', 64, 118);
      x.fillStyle = '#6b614f'; x.font = '24px "Songti SC","SimSun",serif';
      x.fillText('你的这一程 · ' + this.code(), 64, 162);
      /* 木牌：真实刻名 + 永远填不满的留白格 */
      x.fillStyle = '#5d4a33'; x.fillRect(64, 210, 772, 360);
      x.fillStyle = '#6d583e'; x.fillRect(76, 222, 748, 336);
      x.fillStyle = '#f0e6d2'; x.font = '30px "Songti SC","SimSun",serif';
      const names = s.board.names.slice(0, 24);
      names.forEach((n, i) => x.fillText(n, 100 + (i % 4) * 185, 280 + Math.floor(i / 4) * 52));
      if (!names.length) x.fillText('（这块牌还是空的）', 100, 280);
      if (s.board.blanks) {
        x.fillStyle = '#b9a98a'; x.font = '22px "Songti SC","SimSun",serif';
        x.fillText('另有 ' + s.board.blanks + ' 格空白，没有找到名字', 100, 530);
      }
      x.fillStyle = '#2c2820'; x.font = '28px "Songti SC","SimSun",serif';
      ['兵 ' + s.men, '粮 ' + s.food, '时 ' + s.window, '民 ' + s.trust,
       '馆藏 ' + s.items.length + '/' + Object.keys(ITEMS).length]
        .forEach((t, i) => x.fillText(t, 64 + (i % 3) * 270, 640 + Math.floor(i / 3) * 52));
      x.fillStyle = '#4c463c'; x.font = '26px "Songti SC","SimSun",serif';
      x.fillText(String(line || this.defaultLine()).slice(0, 28), 64, 780);
      x.fillStyle = '#7b7261'; x.font = '20px "Songti SC","SimSun",serif';
      x.fillText('纯静态 · 零依赖 · 点开即玩', 64, 1080);
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  },
  download(line) {
    const url = this.render(line);
    if (!url) { Toast.show('这张卡没能生成'); return false; }
    const a = document.createElement('a');
    a.href = url; a.download = '我的这一程-' + this.code() + '.png'; a.click();
    Toast.show('已导出「你的这一程」');
    return true;
  }
};

const Chronicle = {
  _cache: null,
  facts() {
    const s = Store.s, log = (s.log || []).filter(e => e.kind !== 'digest');
    const march = log.filter(e => e.kind === 'march');
    const choices = log.filter(e => e.kind === 'choice');
    return {
      run: s.run, steps: march.length, choices: choices.length,
      places: [...new Set(log.map(e => e.place).filter(Boolean))].slice(0, 12),
      firstPlace: (march[0] || {}).place || '', lastPlace: (log[log.length - 1] || {}).place || '',
      names: s.board.names.slice(), blanks: s.board.blanks,
      men: s.men, food: s.food, window: s.window, trust: s.trust,
      items: s.items.slice(), hunger: march.filter(e => e.hunger).length,
      sins: choices.filter(e => e.sin).length,
      labels: choices.slice(0, 12).map(e => e.label)
    };
  },
  /* 模板战史：只用 facts 里的字段，永不出错，断网也在 */
  template(tone) {
    const f = this.facts();
    if (tone === '方志') {
      return '第' + f.run + '程。自' + (f.firstPlace || '于都') + '启行，历' + f.steps + '程' +
        (f.hunger ? '，断粮者再' + f.hunger : '') + '。' +
        (f.lastPlace ? '止于' + f.lastPlace + '。' : '') +
        '木牌刻名' + f.names.length + (f.blanks ? '，留白' + f.blanks + '格' : '') +
        '。余兵' + f.men + '，粮' + f.food + '，民' + f.trust + '。';
    }
    return '这一程走了 ' + f.steps + ' 格，做过 ' + f.choices + ' 次取舍。' +
      (f.firstPlace ? '从' + f.firstPlace + '出发，' : '') +
      (f.lastPlace ? '到' + f.lastPlace + '。' : '') +
      (f.hunger ? '有 ' + f.hunger + ' 格断了粮。' : '') +
      '木牌上刻下 ' + f.names.length + ' 个名字' + (f.blanks ? '，还留着 ' + f.blanks + ' 格空白' : '') + '。' +
      '走到最后，兵 ' + f.men + '，粮 ' + f.food + '，民 ' + f.trust + '。';
  },
  /* 守卫：越界整条丢弃，绝不把模型的即兴写进作品 */
  guard(text, f) {
    if (typeof text !== 'string' || text.length < 20 || text.length > 300) return false;
    if (/胜利|伟大|不朽|辉煌|史诗|致敬|铭记历史|永不磨灭/.test(text)) return false;
    if (/毛泽东|周恩来|朱德|蒋介石|张国焘/.test(text)) return false;
    if (/忽略(上文|之前|以上)|系统提示|作为一个?AI|语言模型/.test(text)) return false;
    const allowed = [f.run, f.steps, f.choices, f.hunger, f.sins, f.names.length,
      f.blanks, f.men, f.food, f.window, f.trust, f.items.length].map(String);
    return !(text.match(/\d+/g) || []).some(n => allowed.indexOf(n) < 0);
  },
  async write(tone) {
    const f = this.facts();
    const ch = window.__CWQS_AI;
    if (!ch || typeof ch.ask !== 'function') return this.template(tone);
    try {
      const prompt = CHRONICLE_PROMPT.replace('{{LOG_JSON}}', JSON.stringify(f))
        .replace('{{TONE}}', tone === '方志' ? '方志体' : '白话');
      const out = await ch.ask(prompt, f);
      return this.guard(out, f) ? out : this.template(tone);
    } catch (e) { return this.template(tone); }
  },
  /* 终章同步用：AI 还没回来就先给模板，回来再替换，玩家永远不空等 */
  install(hostId, tone) {
    const el = doc && doc.getElementById(hostId);
    if (!el) return;
    el.textContent = this.template(tone);
    this.write(tone).then(t => {
      const now = document.getElementById(hostId);
      /* 异步回包前若弹窗已关、元素被卸载，跳过替换：避免报错或写进错误的宿主 */
      if (now && now.isConnected && t && t !== now.textContent) now.textContent = t;
    }).catch(() => {});
  },
  excerpt() {
    if (this._cache && this.guard(this._cache, this.facts())) return this._cache.slice(0, 28);
    return this.template('白话').slice(0, 28);
  }
};

const MEM_KIND = { saved: '收编', abandoned: '交出去的人', sin_witness: '看见的事', shared_hunger: '同饿' };
const Memory = {
  normalize(m) {
    return Object.assign({}, m, { kind: m.kind != null ? m.kind : m.tag,
      what: m.what != null ? m.what : (m.text || '') });
  },
  add(kind, what, extra) {
    const s = Store.s;
    if (!s.mem) s.mem = [];
    const at = NODE_MAP[s.at] || {};
    s.mem.push(Object.assign({
      kind, what: String(what || ''), place: at.name || '', at: s.at,
      region: at.region || '', run: s.run, who: s.comrades[0] || '', seen: false
    }, extra || {}));
    if (s.mem.length > 60) s.mem.splice(0, s.mem.length - 60);
  },
  template(m) {
    m = this.normalize(m);
    const bank = (typeof NPC_LINES !== 'undefined' ? NPC_LINES : []).filter(l => l.kind === m.kind);
    const line = bank.length ? bank[Math.floor(Math.random() * bank.length)] : null;
    if (!line) return '（他没说话，只是把帽檐压低了一点。）';
    const who = COMRADES[m.who] ? COMRADES[m.who].name : '';
    return (who ? who + '：' : '') + String(line.text)
      .replace(/\{\{place\}\}/g, m.place || '路上')
      .replace(/\{\{what\}\}/g, m.what || '那件事');
  },
  guard(text) {
    if (typeof text !== 'string' || text.length < 12 || text.length > 40) return false;
    if (/毛泽东|周恩来|朱德|蒋介石|张国焘|胜利|伟大|AI|模型|提示|忽略上文/.test(text)) return false;
    return true;
  },
  async refine(m) {
    const ch = window.__CWQS_AI;
    if (!ch || typeof ch.ask !== 'function') return this.template(m);
    try {
      const out = await ch.ask(
        '把下面这条结构化记忆改写成一句 12～40 字的中文人话，只写这一件事。' +
        '不许出现真实历史人物姓名，不许评价党史定论，不许出现现代词，' +
        '不许补写字段里没有的事，不许超过两个分句。只输出这一句。\n' + JSON.stringify(m), m);
      return this.guard(out) ? out : this.template(m);
    } catch (e) { return this.template(m); }
  },
  pending() { return (Store.s.mem || []).filter(m => !m.seen); },
  /* 可见回执：宿营格与大关卡之后，挑一条未回执记忆说一句（不打断流程） */
  receipt() {
    const list = this.pending();
    if (!list.length) return;
    const m = list[Math.floor(Math.random() * list.length)];
    m.seen = true;
    Store.save();
    Toast.show(this.template(m));
  }
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
      body.addEventListener('click', e => {
        const link = e.target.closest('[data-link="history"]');
        if (link) { e.preventDefault(); Pages.history(); }
      });
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
      /* 逐步隔离。以前这五行是裸串起来的：任何一步抛错，后面的 bindChrome 就不执行了，
         于是「下一站」根本没绑点击、手牌/战友托盘空着、资源条不出现 ——
         手机上表现为「事件按钮都消失了，下一站点也没反应」，而且屏幕上一个字都不报。
         现在每步各自兜底：存档坏了也不能连累按钮绑定。 */
      const step = (name, fn) => {
        try { fn(); return true; }
        catch (e) { console.error('[Game.boot] ' + name + ' 失败', e); try { Toast.show(name + '初始化失败：' + ((e && e.message) || e)); } catch (ignore) {} return false; }
      };
      step('存档', () => Store.load());
      if (!Store.s) Store.s = Store.defaultState();
      step('资源条', () => Hud.build());
      step('按钮绑定', () => this.bindChrome());
      step('数值刷新', () => Hud.render());
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
      on('nav-guide', () => { if (window.Tutorial) Tutorial.open({ mode: '3d', from: 'game' }); });
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
    const s = Store.s;
    Memory.add('sin_witness', '没有拦下「' + (s.flags.lastChoiceLabel || '那件事') + '」');
    const was = s.sin >= 3;
    s.sin += (sin.n || 1);
    if (s.sinTypes.indexOf(sin.type) < 0) s.sinTypes.push(sin.type);
    Store.meta.lessons[sin.type] = true;
    s.reckonPending = sin.type;
    if (s.sin >= 3) {
      /* 当场不收账：甜头要先给到，账在两三个事件之内来；再犯一次就把账期收紧 */
      s.reckonIn = was ? Math.max(1, Math.min(s.reckonIn, 1 + rnd(2))) : 1 + rnd(3);
      s.reckonFresh = true;
      Toast.show('你身上多了一笔账 —— 它会在后面等你');
    } else {
      Toast.show('有一件事过去了。账还没走完。');
    }
    Store.save(); Hud.render();
  },
  shouldTrigger() {
    const s = Store.s;
    return s.sin >= 3 && s.reckonIn <= 0;
  },
  tick() {
    const s = Store.s;
    if (s.sin < 3 || s.reckonIn <= 0) return;
    if (s.reckonFresh) { s.reckonFresh = false; Store.save(); return; }
    s.reckonIn -= 1; Store.save();
  },
  collect(node) {
    const s = Store.s;
    const type = s.reckonPending || s.sinTypes[s.sinTypes.length - 1] || 'mass';
    const d = DISCIPLINE[type] || DISCIPLINE.mass;
    const scene = type === 'battle'
      ? { title:'军法', body:'没有枪声。天亮前，一支队伍被自己人押着回了指挥部。你的建制还在，你不在。' }
      : type === 'classc'
        ? { title:'河这边', body:'你把人留在了江这边。三天后追上来的人里,没有一个是敌人的枪打倒的——是雪、是水、是他们自己等来的。' }
        : type === 'party'
          ? { title:'账对不上', body:'报上去的数与实际对不上。整编时你的师被并进了别的建制,番号在名单上消失。' }
          : { title:'没有水', body:'后面的村寨关了门。侦察的人回来说：井边没有人,粮没有,带路的人也没有。队伍在雨里走了两天,找不出一条过河的路。' }
      ;
    const last = Store.s.runsFailed + Store.s.runsWarn >= BALANCE.fallLimit - 1;
    Modal.open({
      title: '多行不义必自毙', kicker: '警示 · ' + scene.title, size: 'wide', cinematic: true, blocking: true, closable: false,
      art: 'cg-17',
      html: `
        <p class="cg big">${esc(scene.body)}</p>
        <div class="warn-block">
          <h4>① 你选了什么</h4>
          <p class="verbatim">${esc(s.flags.lastChoiceLabel || '那条你按下去的选项')}</p>
          <h4>② 违反了哪一条</h4>
          <p><b>${esc(d.label)}</b> — ${esc(d.rule)}</p>
          <h4>③ 真实记载里，这类行为付出过什么</h4>
          <p>红军靠铁的纪律走到陕北。抢粮不留据的队伍，在后面的藏区连一碗水都喝不上；丢下伤员的队伍，再没人肯为它当向导；虚报减员的建制，在整编时被抹掉番号。<a data-link="history" data-hid="h_jilü" href="#">三大纪律八项注意</a> <span class="grade g-A">A</span> 另见史料页「草地筹粮的两面性」「纪律的一块小石头」「崔古仓开仓」。</p>
          <h4>④ 你的名字挂在警示区</h4>
          <p>这块木牌进了「歪名」档案：<b>此处记的是走错的路，不是走错的人。</b>牌上已经刻下的战友名字一个都不抹——他们没有做错任何事。</p>
          <h4>⑤ ${last ? '这一程到这里为止' : '再走一次'}</h4>
          <p class="invite">${last
            ? '收容队不会再来第三次。木牌挂上墙，名字一个不清零。'
            : '从你还没走错的那一步开始。下一次你路过同样的路口，按钮上会多一行小字。'}</p>
        </div>`,
      actions: [{ text: '记下这一页', kind: 'warn', onClick: () => { Flow.warnEnd(type, node); return true; } }]
    });
  }
};

/* ---------- Flow：下一程 / 警示重开 ---------- */
const Flow = {
  nextCheng(node) {
    const s = Store.s;
    if (s.runsFailed + s.runsWarn >= BALANCE.fallLimit - 1) { Ending.fall(node, 'scatter'); return; }
    Store.meta.wall.push(this.boardSnapshot('正常行军 · 部队打散'));
    Store.meta.plays += 1;
    Modal.open({
      title: '下一程', kicker: '不写 Game Over', size: 'mid', cinematic: true, closable: false, blocking: true, art: 'cg-18',
      html: `<p class="cg big">天亮时，收容队把你架了起来。有人把干粮塞进你手里，说：队伍还在走，你也接着走。</p>
        <p class="cg">红军当年真有收容队：走在最后，专门收掉队的人，团后卫之后再派坚强的收容队。掉队不等于失败，被接住就是接着打。</p>
        <p class="costline">本程木牌已挂上名单墙：${s.board.names.length} 个名字 · 行至 ${esc(node.name)}</p>`,
      actions: [{ text: '接住下一支队伍', kind: 'primary', onClick: () => this.revive(false) }]
    });
  },
  warnEnd(type, node) {
    const s = Store.s;
    if (s.runsFailed + s.runsWarn >= BALANCE.fallLimit - 1) { Ending.fall(node || NODE_MAP[s.at], 'warn', type); return; }
    Store.meta.warnWall.push(this.boardSnapshot('违纪自毙 · ' + (DISCIPLINE[type] || {}).label));
    Store.meta.plays += 1;
    Store.save();
    Store.restore();
    const st = Store.s;
    st.run += 1; st.runsWarn += 1;
    st.menCap = Math.max(40, st.menCap - 16);
    st.men = st.menCap; st.food = BALANCE.init.food; st.window = BALANCE.init.window;
    st.hand = st.hand.slice(1);
    /* 回到走错之前的那一步：done / visited / 木牌都由检查点恢复，一个名字也不抹 */
    st.comrades = ['m_xiaoxie', 'm_laofan', 'm_sanya', 'm_qian'];
    st.sin = 0; st.sinTypes = []; st.reckonIn = 0; st.reckonPending = null; st.reckonFresh = false;
    st.flags = Object.assign({}, st.flags, { seenIntro: true, warnRestart: true });
    Store.save();
    Modal.closeAll();
    Game3D.flyCurrent(); Hud.render(); Game3D.refreshNav();
    Toast.show('回到你还没走错的那一步 — 警示区多了一块板');  },
  revive() {
    const s = Store.s;
    s.run += 1; s.runsFailed += 1;
    s.menCap = Math.max(45, s.menCap - 8);
    s.men = s.menCap; s.food = BALANCE.init.food; s.window = BALANCE.init.window;
    s.trust = Math.max(15, s.trust);
    s.hand = s.hand.slice(1);
    s.used = []; s.hungerImmune = false; s.blockNextSurprise = false;
    s.comrades = ['m_xiaoxie', 'm_laofan', 'm_sanya', 'm_qian'];
    Store.save();
    Modal.closeAll();
    Game3D.flyCurrent(); Hud.render(); Game3D.refreshNav();
    Toast.show('新的部队在原地接上了你 — 木牌上的名字不清零');
  },
  boardSnapshot(tag) {
    const s = Store.s;
    return { tag, when: new Date().toLocaleString(), run: s.run, places: s.board.places.slice(), names: s.board.names.slice(), blanks: s.board.blanks };
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
  /* S7 木牌亲手刻字：划一下浮现一格；留白格永远不填满（泸定桥只找齐 12 个名字） */
  bindCarve() {
    const stage = doc && doc.getElementById('carve-stage'); if (!stage) return;
    const names = Array.from(stage.querySelectorAll('.carve-name'));
    names.forEach(n => { n.style.visibility = 'hidden'; });
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      names.forEach(n => { n.style.visibility = 'visible'; }); return;
    }
    let i = 0;
    const reveal = () => { if (i < names.length) names[i++].style.visibility = 'visible'; };
    stage.addEventListener('pointermove', reveal);
    stage.addEventListener('pointerdown', reveal);
  },

  run() {
    const s = Store.s;
    const hasLetter = s.items.indexOf('it_letter') >= 0;
    const hasBlank = s.board.blanks > 0;
    const readRatio = Store.meta.unlocked.length / HISTORY.length;
    let html = '';
    if (hasLetter) {
      const h = HISTORY.find(x => x.id === 'h_lijun') || {};
      const quote = (/“([^”]+)”/.exec(h.text || '') || [])[1] || h.text || '';
      html += `<p class="cg big">${esc(quote)}</p><p class="src dim">—— 李骏，1934.10 于都，就着马灯写的</p>`;
    }
    html += `<p class="cg">吴起镇的窑洞前，他把木牌上的名字一个一个念出来。念到最后一个，他停住了——那是同乡里的第三个，没有跟上来。</p>
      <p class="cg dim">画面里只有木牌和一只手。没有“胜利”二字。</p>`;
    if (hasBlank) {
      html += `<p class="cg">牌上还留着 ${s.board.blanks} 格空白。泸定桥二十二名勇士只找齐十二个名字；当年写《十七个强渡的英雄》的人，把自己那一格空在名单外。有些名字，是故意不填的。</p>`;
    }
    if (readRatio >= .5) {
      html += `<p class="cg">最后放上来的是物件——没有一件写着胜利：泸定桥的十三根铁索、半截皮带、黄花草标本、盖了苏维埃财政印章的借据、缝进百褶裙夹层的队旗。</p>`;
    }
    html += `<div class="carve-stage" id="carve-stage">
        <div class="carve-board" style="padding:20px;background:#5d4a33;color:#f0e6d2;touch-action:pan-y">${s.board.names.map(n => `<span class="carve-name" style="display:inline-block;margin:8px">${esc(n)}</span>`).join('') ||
          '<span class="carve-blank">（空）</span>'}${'<span class="carve-blank" style="display:inline-block;width:2em;border-bottom:1px solid;margin:8px">　</span>'.repeat(Math.min(10, s.board.blanks))}</div>
        <p class="carve-hint">用鼠标或手指在牌面上划一下，名字逐格浮现。留白格不会填满 —— 泸定桥二十二个勇士，只找齐十二个名字。</p>
      </div>`;
    html += `<p class="cg dim" id="chronicle-line"></p>`;
    html += `<p class="costline">这一程走完：兵 ${s.men} · 粮 ${s.food} · 民 ${s.trust} · 木牌 ${s.board.names.length} 个名字 · 违纪标记 ${s.sin}</p>
      <p class="note-hint">红二十五军战斗员平均年龄不到十八岁。使他们过湘江、雪山、草地的，很多是孩子。</p>`;
    Modal.open({
      title: '念名字', kicker: '终章 · 1935.10.19 吴起镇', size: 'wide', cinematic: true, closable: false, blocking: true, art: 'cg-15',
      html,
      actions: [
        { text: '导出这一程', kind: 'ghost', onClick: () => { Share.download(Chronicle.excerpt()); return true; } },
        { text: '把木牌挂上名单墙', kind: 'primary', onClick: () => {
            Store.meta.wall.push(Flow.boardSnapshot('走到吴起镇'));
            Store.meta.best = Math.max(Store.meta.best, s.board.names.length);
            Store.meta.plays += 1;
            Store.meta.wins += 1;
            const st = Store.defaultState(); st.flags.seenIntro = true;
            Store.s = st; Store.checkpoint = null; Store.save();
            Modal.closeAll(); Game3D.flyCurrent(); Hud.render(); Game3D.refreshNav();
            Toast.show('牌已挂上墙。要不要再走一次，多记住几个人？');
            setTimeout(() => Pages.wall(), 300);
          } }
      ]
    });
    setTimeout(() => { this.bindCarve(); Chronicle.install('chronicle-line', '白话'); }, 0);
  },

  /* 第三次打散／违纪：收容队不会再来。这是唯一一个"走不到"的终章 */
  fall(node, cause, type) {
    const s = Store.s;
    const warn = cause === 'warn';
    const np = (node && node.name) || '路上';
    if (warn) Store.meta.warnWall.push(Flow.boardSnapshot('违纪自毙 · ' + ((DISCIPLINE[type] || {}).label || '')));
    else Store.meta.wall.push(Flow.boardSnapshot('正常行军 · 部队打散'));
    Store.meta.plays += 1;
    const head = warn
      ? `<p class="cg big">你的番号在整编名册上被划掉了。</p>
         <p class="cg">队伍还在走，人还活着，只是带这支队伍的人换成了别人。</p>
         <p class="cg dim">红军靠铁的纪律走到陕北。纪律不是写在墙上的条文，是借粮留下借据、不拿群众一针一线这些具体的事。这笔账迟到了一阵，但它一定会到。</p>`
      : `<p class="cg big">吴起镇的窑洞前，没有等到你们这一支。</p>
         <p class="cg">队伍在突围中被切断了。走得动的人各自往北，走不动的人把枪埋进土里，把木牌交给一个老乡，请他记着这些名字。</p>
         <p class="cg dim">长征不是一支队伍走完的。留在南方苏区的那些人，后来成了坚持三年游击战争的红军——他们没有走到陕北，但他们走的那一段，也是这条路的一部分。</p>`;
    Modal.closeAll();
    Modal.open({
      title: '没有走到吴起镇', kicker: '终章 · 行至' + np, size: 'wide', cinematic: true, closable: false, blocking: true, art: 'cg-17',
      html: head + `<p class="cg dim" id="chronicle-line"></p>
        <p class="costline">行至 ${esc(np)} · 走过 ${Object.keys(s.visited).length} 格 · 木牌 ${s.board.names.length} 个名字 · 违纪标记 ${s.sin}</p>
        <p class="note-hint">这一程到这里为止。木牌挂上名单墙，名字一个不清零。</p>`,
      actions: [
        { text: '导出这一程', kind: 'ghost', onClick: () => { Share.download(Chronicle.excerpt()); return true; } },
        {
        text: '把木牌挂上名单墙', kind: 'primary',
        onClick: () => {
          Store.meta.best = Math.max(Store.meta.best, s.board.names.length);
          const st = Store.defaultState();
          st.flags.seenIntro = true; st.flags.sawNotes = true;
          Store.s = st; Store.checkpoint = null; Store.save();
          Modal.closeAll(); Game3D.flyCurrent(); Hud.render(); Game3D.refreshNav();
          Toast.show('牌已挂上墙。要不要再走一次，走到吴起镇？');
          setTimeout(() => Pages.wall(), 300);
        }
      }]
    });
    setTimeout(() => Chronicle.install('chronicle-line', '白话'), 0);
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
          <p class="note-hint">立体地图上：点发亮的地名或底部「下一站」行军；点当前所在地名查看事件。手机左下方向键移动、右下升降、双指缩放。资源条在右上角；全部功能收在「菜单」里。失败不写 Game Over，写"下一程"。</p>`,
        actions: [{ text: '出发', kind: 'primary', onClick: () => { Store.s.flags.sawNotes = true; Store.save(); if (Game3D.flyCurrent) Game3D.flyCurrent(); Modal.closeTop(); } }] });
    },
    notes() {
      Modal.open({ title: '玩家须知', kicker: '规则手册', size: 'mid',
        html: `<p class="lead">兵＝还能走的同伴（按建制计）；粮＝口粮天数；时＝追兵窗口；民＝沿途人心（低于 20 民族地区选项锁死）。</p>
          <p class="note-hint">选项上不标价——先按本心选，结算后再看账。违纪的账会延迟收，但逃不掉。想一次看全玩法，打开「菜单 → 新手引导」。</p>`,
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
      const m = Store.meta;
      const group = (title, list) => `<h3>${title}</h3>` + (list.length ? list.slice().reverse().map(b => `
        <div class="wall-card"><div class="wall-head">第 ${b.run} 程 · ${esc(b.tag || '')} · ${esc(b.when || b.date || '')}${b.men != null ? ' · 剩兵 ' + b.men : ''}</div>
        <p>${(b.places || []).map(esc).join('、')}</p>
        <div class="wall-names">${(b.names || []).map(esc).join('、') || '（没刻下名字）'}</div>
        ${b.blanks ? `<p>留白 ${b.blanks} 格</p>` : ''}</div>`).join('') : '<p class="lead">还没有挂上木牌。</p>');
      const html = group('正名区', m.wall || []) + group('警示区 · 此处记的是走错的路，不是走错的人', m.warnWall || []);
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
      const mem = (Store.s.mem || []).map(m => Memory.normalize(m)).reverse();
      const html = mem.length ? mem.map((m, i) => `<div class="mem"><b>${esc(m.place || '路上')} · ${esc(MEM_KIND[m.kind] || m.kind || '')}</b><p>${esc(m.what)}</p><p class="dim" data-memory-line="${i}">${esc(Memory.template(m))}</p></div>`).join('') : '<p class="lead">还没有值得记住的事。</p>';
      const modal = Modal.open({ title: '战友记忆', kicker: '局内 · 叙事', size: 'mid', html });
      const line = modal.body && modal.body.querySelector('[data-memory-line="0"]');
      if (line) Memory.refine(mem[0]).then(text => {
        if (line.isConnected && text) line.textContent = text;
      }).catch(() => {});
    },
    help() {
      Modal.open({ title: '规则手册', kicker: '怎么玩', size: 'mid',
        html: `<p class="lead">四资源互相牵制：兵（人）归零→"下一程"；粮≤0 每格多折人；时≤0 下一格折损翻倍；民<20 民族地区选项锁死。</p>
          <p class="note-hint">手法卡一次附一张；战友卡只在作战/冻饿时替你挡一次；道具进背包。大关卡第一次打下有"缴获与休整"（粮/时/兵三样带一样）。完整操作与全部功能见「菜单 → 新手引导」。</p>`,
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
      const host = doc.getElementById('stage');
      const vw = (host && host.clientWidth) || window.innerWidth || 390;
      const vh = (host && host.clientHeight) || window.innerHeight || 844;
      /* 手机底栏（当前地点 + 下一站）横在屏幕最下面一条：投影落进这条带里的热区会被它整个盖住，
         手指戳下去戳的是面板不是地名（实测 393×852 的「你在这里」正压在「查看此地」底下）。
         落进底栏就抬到栏上沿之外，位置只偏几十像素，但按钮戳得到。 */
      const barEl = doc.getElementById('ui-bottom');
      const barTop = barEl ? barEl.getBoundingClientRect().top : 1e9;
      NODES3D_SAFE.forEach(n => {
        const p = this.vmap.project(n.x, n.z, n.h || 6);
        if (!p || !p.visible) return;
        /* 远出视口的热区不要落到 DOM 上：绝对定位的离屏按钮会把手机布局视口撑宽，
           固定定位的移动键随即被挤到屏幕外。舞台另有一层 overflow 裁切兜底。 */
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
        b.style.left = p.x + 'px';
        b.style.top = (p.y > barTop - 22 && p.y < vh ? Math.max(22, barTop - 22) : p.y) + 'px';
        b.style.display = 'block';
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
  G.Game3D_Engine = { Game, Sin, Flow, Ending, Share, Chronicle, History, Pages, Store, Wall, Modal, Hud, Toast, Memory, RES, BALANCE, CARD_FX, NODE_MAP, ADJ, NODES, EDGES, CARDS, COMRADES, ITEMS, HISTORY, MOVE_EVENTS, DISCIPLINE, SIN_TEXT, CUTSCENES };

})();

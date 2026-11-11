/* ============================================================
   《长征：万水千山》 v1 · 引擎层
   模块：Store(状态/存档) · MapView(地图/视野/拖拽) · Hud(资源条)
        Router(视图跳转/弹窗栈) · Resolve(结算) · Sin(自毙机制)
        Board(木牌/名单墙) · History(史料页) · Ending(结局)
   ============================================================ */
(function () {
'use strict';

/* ---------- 工具 ---------- */
const $  = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NODE_BY_ID = (() => { const m = {}; NODES.forEach(n => { m[n.id] = n; }); return m; })();

/* C6 · 节点补丁（NODE_PATCHES）：g9 班佑河补 epilogue。
   先读 g9 现有 carve（data.js:581 含 names）；Object.assign 只补 epilogue，
   原有 carve（含 names）原样保留，绝不覆盖。 */
const NODE_PATCHES = {
  g9: { epilogue: '出发那天，有人想刻下河滩上那些人的名字。可是多数无名，木牌上只留了一行：河滩上的七八百人（多数无名）。' }
};
Object.keys(NODE_PATCHES).forEach(id => {
  const n = NODE_BY_ID[id]; if (!n || !NODE_PATCHES[id]) return;
  Object.assign(n, NODE_PATCHES[id]);
});
const ADJ = (() => {
  const m = {};
  NODES.forEach(n => { m[n.id] = new Set(); });
  EDGES.forEach(([a, b]) => { if (m[a] && m[b]) { m[a].add(b); m[b].add(a); } });
  return m;
})();

const RES = {
  men:    { key:'men',    label:'兵', color:'#b5382b', max:100, unit:'支', desc:'建制完整度：能拉出来的队' },
  food:   { key:'food',   label:'粮', color:'#a5813a', max:20,  unit:'天', desc:'全军口粮可撑的天数' },
  window: { key:'window', label:'时', color:'#4a6f7c', max:8,   unit:'日', desc:'追兵窗口：离被合围还剩几天' },
  trust:  { key:'trust',  label:'民', color:'#4d7a52', max:100, unit:'',   desc:'沿途人心：低于 20 时民族地区选项锁死' }
};

/* 数值曲线：一处可调。跑测台（测试/balance-bench.js）按这几个常量反复校准，
   主走廊 42 格，每格固定支出 1 天粮 + 1 天时窗，所以要靠大关卡缴获与民心借粮回补。 */
const BALANCE = {
  init:        { men: 100, food: 11, window: 6, trust: 40 },
  march:       { food: -1, window: -1 },   /* 每走一格的固定支出 */
  gateSpoils:  { food: 2, window: 2, men: 2 }, /* 大关卡第一次打下来：粮／时／兵三样只能带一样 */
  hungerLoss:  6,                          /* 断粮那一格多折的建制 */
  pursuitGrace: 2,                         /* 时窗归零打完遭遇战，甩开尾巴挣回的天数 */
  eventP: 0.24, eventCooldownP: 0.10,      /* 行进突发事件：常态概率 / 上一格刚出过事的概率 */
  regionP: 0.15,                           /* 已触发的事件里分给区域专属的比例；总触发率不变、不进主池。
                                             2026-11-06 实测（各 125 局 chaos）：0→51.2%、0.15→49.6%
                                             （期望 2.02 命，与 15 号 C11 基线一致）、0.20→53.6%、
                                             0.25→51.2%、0.30→56.8%。取 0.15 保住验收线。
                                             地域感主要由 5 段地域皮提供，6 条专属事件只作点缀。 */
  /* S4 / S6 保持默认关：`23` §2-9、`27` §五-7、`28` §七-7、`29` A7 四处口径一致，等真人试玩数据 + bench 对比再定。
     另注：这两条目前只出 Toast 与议事弹窗，`enemyMod()` 的返回值在 `game.js:1622` 被丢弃，
     对 C11 结算零影响 —— 要启用前先让它真的影响数值，否则开关没意义。3D 版（game3d.js）同样关。 */
  council:    { enabled: false, every: 6 },
  enemyLearn: { enabled: false, maxPerRun: 1 },
  charity:     { trust: 70, food: 1, max: 3 }, /* 民心够高又真断了粮：沿途百姓接济，一局至多三次 */
  comradeCap:  6,                              /* 战友卡同时在队的上限：开局四人 + 中途收编 */
  mateSave:    2,                              /* 一个战友一次最多替你挡下的建制数 */
  fallLimit:   3                               /* 一程里第几次打散/违纪就不再有收容队 */
};

/* 手法卡的真实效果（未列出的项在卡面上标”本版仅叙事”） */
const CARD_FX = {
  c_no_left:   { halveLoss:true, window:-1 },
  c_walk_on:   { noHungerOnce:true },
  c_no_sit:    { skipSit:true },
  c_carve:     { trustNext:5 },
  c_night:     { blockSurprise:true, window:-1 },
  c_disguise:  { fordFree:true, window:-1 },
  c_bypass:    { window:-1, trust:3, skipCombatLoss:true },
  c_feint:     { window:2 },
  c_assault:   { fixedLoss:6, ignorePursuit:true },
  c_chains:    { fixedLoss:5 },
  c_climb:     { halveLoss:true, food:-2 },
  c_cover:     { menBack:3, window:-1 },
  c_rules:     { trust:12, sight:1 },
  c_iou:       { food:3, trust:5, window:-1 },
  c_eat_toast: { trust:8, men:2 },
  c_leave_note:{ food:2, trust:3 },
  c_lastbite:  { noHungerOnce:true, food:-1 },
  c_carry:     { men:4, food:-4, needsComrade:true },
  c_light:     { food:3, window:1, trust:-10 },
  c_pot:       { noHungerOnce:true }
};

/* ---------- Store：状态与存档 ---------- */
const SAVE_KEY = 'cwqs_save_v1', META_KEY = 'cwqs_meta_v1';

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
      /* 逐格战史日志（17 §3.1 S0）：只存引擎已经算出来的字段，一个字都不给模型编。
         旧档由 Store.load 的 Object.assign(defaultState(), ...) 自动补出空数组，无需迁移。 */
      log: [],
      mem: []                                /* 战友记忆（S1）：旧档同样自动补出空数组 */
    };
  },
  defaultMeta() {
    return { wall: [], warnWall: [], unlocked: [], lessons: {}, best: 0, plays: 0, wins: 0 };
  },

  /* ---------- 存档码（17 §3.10 / 23 §5 T4）----------
     浏览器清档后复制一段码即可续。
     只带必要状态：日志带最近 20 条、名单墙带最近 6 块，控制长度。
     不用 fetch、不写后端；纯本地 base64(UTF-8 JSON)。 */
  exportCode() {
    try {
      const s = this.s, m = this.meta || this.defaultMeta();
      const payload = {
        v: 1,
        s: Object.assign({}, s, { log: (s.log || []).slice(-20) }),
        m: {
          unlocked: m.unlocked || [], best: m.best || 0, plays: m.plays || 0, wins: m.wins || 0,
          wall: (m.wall || []).slice(-6), warnWall: (m.warnWall || []).slice(-3), lessons: m.lessons || {}
        }
      };
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) { return null; }
  },
  importCode(code) {
    try {
      const b64 = String(code || '').trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      if (!b64) return false;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const o = JSON.parse(new TextDecoder().decode(bytes));
      if (!o || o.v !== 1 || !o.s || !o.s.at || !NODE_BY_ID[o.s.at]) return false;
      this.s = Object.assign(this.defaultState(), o.s);
      this.meta = Object.assign(this.defaultMeta(), o.m || {});
      if (!Array.isArray(this.s.log)) this.s.log = [];
      if (!this.s.flags) this.s.flags = {};
      this.save();
      return true;
    } catch (e) { return false; }
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.s = raw ? Object.assign(this.defaultState(), JSON.parse(raw)) : this.defaultState();
      if (!this.s.at || !NODE_BY_ID[this.s.at]) this.s.at = 'g1';
      if (!this.s.flags) this.s.flags = {};
    } catch (e) { this.s = this.defaultState(); }
    try {
      const rawM = localStorage.getItem(META_KEY);
      this.meta = rawM ? Object.assign(this.defaultMeta(), JSON.parse(rawM)) : this.defaultMeta();
    } catch (e) { this.meta = this.defaultMeta(); }
    if (!this.meta.wall) this.meta.wall = [];
    if (!this.meta.warnWall) this.meta.warnWall = [];
    if (!this.meta.lessons) this.meta.lessons = {};
  },
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.s));
      localStorage.setItem(META_KEY, JSON.stringify(this.meta));
    } catch (e) { /* 隐私模式下忽略 */ }
  },
  snapshot() { this.checkpoint = JSON.parse(JSON.stringify(this.s)); },
  restore() { if (this.checkpoint) this.s = JSON.parse(JSON.stringify(this.checkpoint)); }
};

/* ---------- CgWeather：CG 天气粒子层（纯 canvas，零依赖，17 §6.1） ----------
   粒子上限 60；掉帧自动关掉画布；prefers-reduced-motion 时完全不启动。
   图还没生成（或加载失败）时 Router 会把 stage 标成 no-art，只留文字，试玩永远不卡。 */
const CgWeather = {
  _raf: new WeakMap(),
  _reduce() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  },
  start(wrap, kind) {
    if (!kind || kind === 'none' || this._reduce()) return;
    const cv = $('.cg-weather', wrap);
    if (!cv || !cv.getContext) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const rect = wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : { width: 640, height: 480 };
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    cv.width = Math.max(1, Math.floor((rect.width || 640) * dpr));
    cv.height = Math.max(1, Math.floor((rect.height || 480) * dpr));
    const N = 60, ps = [];
    for (let i = 0; i < N; i++) ps.push({ x: Math.random(), y: Math.random(), r: Math.random(), v: .2 + Math.random() * .8 });
    const color = {
      snow: 'rgba(230,236,240,', rain: 'rgba(190,205,215,', mist: 'rgba(210,205,190,',
      ember: 'rgba(230,150,80,', dust: 'rgba(200,180,140,', spray: 'rgba(225,235,240,'
    }[kind] || 'rgba(220,215,200,';
    let last = performance.now(), lastCheck = last, frames = 0;
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
      if (t - lastCheck > 1000) {
        if (frames < 18) { cv.style.display = 'none'; this._raf.delete(wrap); return; }
        frames = 0; lastCheck = t;
      }
      this._raf.set(wrap, requestAnimationFrame(tick));
    };
    this._raf.set(wrap, requestAnimationFrame(tick));
  },
  stop(wrap) {
    const id = this._raf.get(wrap);
    if (id) cancelAnimationFrame(id);
    this._raf.delete(wrap);
  }
};

/* ---------- Router：弹窗栈（不用下拉菜单，全部链接 + 弹窗） ---------- */
const Router = {
  stack: [],
  open(opts) {
    /* opts: {title, html, actions, size, cinematic, art, motion, weather, onClose}
       art 只给编号（如 'cg-09'）；运镜与天气从 CG_ART 表查，调用点不用重复写。 */
    const wrap = document.createElement('div');
    wrap.className = 'modal-mask' + (opts.cinematic ? ' cinematic' : '');
    const meta = (typeof CG_ART !== 'undefined' && opts.art && CG_ART[opts.art]) || {};
    const motion = opts.motion || meta.motion || 'zoom-in';
    const weather = opts.weather || meta.weather || 'none';
    const stage = opts.art ? `
        <div class="cg-stage motion-${esc(motion)} weather-${esc(weather)}">
          <img class="cg-img" src="art/${esc(opts.art)}.webp" alt="" aria-hidden="true" loading="lazy">
          <canvas class="cg-weather" aria-hidden="true"></canvas>
          <div class="cg-scrim"></div>
        </div>` : '';
    const seq = (Router.seq = (Router.seq || 0) + 1);
    wrap.innerHTML = `
      <div class="modal ${opts.size || ''}" role="dialog" aria-modal="true" tabindex="-1" aria-labelledby="modal-title-${seq}">
        ${stage}
        <header class="modal-head">
          ${opts.kicker ? `<span class="kicker">${esc(opts.kicker)}</span>` : ''}
          <h2 id="modal-title-${seq}">${esc(opts.title || '')}</h2>
          ${opts.closable === false ? '' : '<button class="modal-x" data-x aria-label="关闭">✕</button>'}
        </header>
        <div class="modal-body">${opts.html || ''}</div>
        <footer class="modal-foot">${(opts.actions || []).map((a, i) =>
          `<button class="btn ${a.kind || 'ghost'}" data-act="${i}">${esc(a.text)}</button>`).join('')}</footer>
      </div>`;
    $('#modal-root').appendChild(wrap);
    if (opts.art) {
      /* 图还没出、或加载失败：stage 直接隐藏，只留原来的文字 CG，试玩永远不卡 */
      const img = $('.cg-img', wrap);
      if (img) img.addEventListener('error', () => {
        const st = $('.cg-stage', wrap);
        if (st) st.classList.add('no-art');
        CgWeather.stop(wrap);
      }, { once: true });
      CgWeather.start(wrap, weather);
    }
    document.body.classList.toggle('hud-hidden', !!opts.cinematic);
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => wrap.classList.add('show'));

    const entry = { el: wrap, opts };
    this.stack.push(entry);

    /* 焦点管理：打开时把焦点收进弹窗（先存好打开前的焦点，关闭时还原），并在弹窗内捕获 Tab 循环 */
    let onKey;
    const prevFocus = document.activeElement;
    const modalEl = $('.modal', wrap);
    const close = () => {
      CgWeather.stop(wrap);
      if (onKey) document.removeEventListener('keydown', onKey);
      wrap.classList.remove('show');
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
      setTimeout(() => {
        wrap.remove();
        this.stack = this.stack.filter(x => x !== entry);
        const top = this.stack[this.stack.length - 1];
        document.body.classList.toggle('hud-hidden', !!(top && top.opts.cinematic));
        document.body.classList.toggle('modal-open', this.stack.length > 0);
      }, 220);
      if (opts.onClose) opts.onClose();
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap && opts.closable !== false && opts.blocking !== true) { close(); return; }
      const x = e.target.closest('[data-x]');
      if (x && opts.closable !== false) { close(); return; }
      const b = e.target.closest('[data-act]');
      if (b) {
        const act = (opts.actions || [])[+b.dataset.act];
        if (act && act.onClick) { const keep = act.onClick(); if (keep !== true) close(); }
        else close();
      }
      const link = e.target.closest('[data-link]');
      if (link) {
        e.preventDefault();
        const to = link.dataset.link;
        if (to === 'history') Pages.history(link.dataset.hid);
        if (to === 'board') Pages.board();
        if (to === 'wall') Pages.wall();
        if (to === 'map') close();
        if (to === 'help') Pages.help();
        if (to === 'cards') Pages.cards();
      }
    });
    onKey = (ev) => {
      if (ev.key === 'Escape' && opts.closable !== false) { close(); return; }
      /* 只在本弹窗处于栈顶时捕获 Tab，使焦点在弹窗内循环，不漏到背后页面 */
      if (ev.key === 'Tab' && this.stack[this.stack.length - 1] === entry) {
        const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', wrap);
        if (!f.length) { ev.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1];
        if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
        else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      const focusTarget = $('.btn', wrap) || $('.modal-x', wrap) || modalEl;
      if (focusTarget && focusTarget.focus) focusTarget.focus();
    });
    return close;
  },
  closeAll() {
    /* 选项按下后有一段"原地亮账"的停留：窗口被整体关掉时先把这一步结清，不能让定时器悬空补刀。
       只有真按过选项（ctx.opt 有值）才结清 —— 没选过就 closeAll 不能凭空替玩家下一条决定。 */
    const c = Game.activeCtx;
    if (c && c.settle && !c.done && c.opt) { c.done = true; c.settle(); }
    else if (c && !c.opt && !c.done && Game.activeCtx === c) Game.activeCtx = null;
    [...this.stack].forEach(e => { CgWeather.stop(e.el); e.el.remove(); });
    this.stack = []; document.body.classList.remove('hud-hidden', 'modal-open');
  }
};

/* ---------- Sound：音效开关（17 §3.10 S9）----------
   默认全关，公开试玩里自动放声是差评来源。
   音频文件由人后补；没有文件时点了也不加载任何资源、不发声。 */
const Sound = {
  on: false,
  toggle() {
    this.on = !this.on;
    Toast.show(this.on ? '音效已开（当前没有音频文件，仍然静音）' : '音效已关');
    Hud.render();
  }
};

/* ---------- S4 军帐议事 / S6 追兵学你（轻量±5% 叠加层，已启用，不碰 C11）----------
   只陈列本局与历史事实、给一个 ±5% 的「议事/学你」提示；绝不改写 BALANCE 数值。 */
const Council = {
  render() {
    if (!BALANCE.council.enabled) return;
    const bench = window.__CWQS_BENCH;                 // 可选：由 测试/bench-*.json 注入
    const s = Store.s;
    const hunger = (s.log || []).filter(e => e.kind === 'march' && e.hunger).length;
    const lines = [
      '本局断粮 ' + hunger + ' 次',
      '木牌已刻 ' + (s.board.names.length) + ' 个名字',
      '违纪标记 ' + (s.sin || 0) + ' 处'
    ];
    if (bench) lines.push('历史均值断粮 ' + (bench.avgHunger != null ? bench.avgHunger : '—') + ' 次');
    lines.push('军帐议事：本局难度按 ±5% 叠加层微调（仅供参考，不改动定稿数值）');
    Router.open({
      title: '军帐议事', kicker: '只陈列本局与历史事实',
      html: '<p class="cg">' + lines.join(' · ') + '</p>',
      actions: [{ text: '知道了', kind: 'ghost' }]
    });
  }
};
/* S6 追兵学你：本局至多 maxPerRun 次，每次给一个 ±5% 的叠加层提示（不进 C11 结算）。
   clamp 保证幅度落在 ±5% 内，且绝不回写 BALANCE。 */
function enemyMod() {
  if (!BALANCE.enemyLearn.enabled) return 0;
  const s = Store.s;
  if ((s._enemyLearned || 0) >= BALANCE.enemyLearn.maxPerRun) return 0;
  s._enemyLearned = (s._enemyLearned || 0) + 1;
  const v = clamp((Math.random() * 2 - 1) * 0.05, -0.05, 0.05);
  const pct = Math.round(v * 100);
  Toast.show('追兵学你：本局节奏微调约 ' + (pct > 0 ? '+' : '') + pct + '%（±5% 叠加层，仅供参考）');
  return v;
}

/* ---------- Share：一页「你的这一程」分享卡（17 §3.3 / 19 §5）----------
   纯 canvas，零依赖；所有数字由引擎给，叙事只取一行通过守卫的摘录。
   二维码位留空框 —— 链接由人发布后自行补，不引外部二维码库。 */
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

/* ---------- Chronicle：终章战史官（17 §3.3 / 19 §5）----------
   输入只有 Store.s.log 的结构化字段；史实、数字、地名一个都不让模型补。
   AI 通道可插拔：外部注入 window.__CWQS_AI.ask(prompt, facts) 才启用，
   game.js 内不写 fetch —— 零外链、file:// 可玩、断网/429/越界一律回模板。 */
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
    /* 下限只用来挡空串和半句，不强制 150 字 —— 否则合规的短句会被误拒回模板，
       AI 在场感就没了（2026-11-06 冒烟实测发现）。 */
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
    const el = document.getElementById(hostId);
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

/* ---------- Memory：战友记忆（17 §3.2 S1）----------
   记忆与后果全由引擎判定，AI 只被允许改「一句人话」的措辞。
   四类事实全部来自真实结算：收编、交出去的人、看见的违纪、同饿。 */
const MEM_KIND = { saved: '收编', abandoned: '交出去的人', sin_witness: '看见的事', shared_hunger: '同饿' };
const Memory = {
  add(kind, what, extra) {
    const s = Store.s;
    if (!s.mem) s.mem = [];
    const at = NODE_BY_ID[s.at] || {};
    s.mem.push(Object.assign({
      kind, what: String(what || ''), place: at.name || '', at: s.at,
      region: at.region || '', run: s.run, who: s.comrades[0] || '', seen: false
    }, extra || {}));
    if (s.mem.length > 60) s.mem.splice(0, s.mem.length - 60);
  },
  template(m) {
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

/* ---------- Hud：右上角四资源 ---------- */
const Hud = {
  build() {
    $('#hud').innerHTML = Object.values(RES).map(r => `
      <div class="res" data-res="${r.key}" role="group" title="${esc(r.desc)}">
        <span class="res-label">${r.label}</span>
        <span class="res-val" id="v-${r.key}">0</span>
        <span class="res-unit">${r.unit}</span>
        <span class="res-bar"><i id="b-${r.key}" style="width:0%"></i></span>
        <span class="res-drip" id="d-${r.key}"></span>
      </div>`).join('') + `
      <div class="res res-extra">
        <span class="res-label">牌</span>
        <span class="res-val" id="v-board">0</span>
        <span class="res-unit">个名字</span>
        <span class="res-sub" id="v-run">第 1 程</span>
        <span class="res-sub" id="v-items">馆藏 0/7</span>
        <button class="res-sound" id="sound-btn" aria-label="音效开关" title="音效（默认关）">音 关</button>
      </div>`;
  },
  render() {
    const s = Store.s;
    const vals = { men: s.men, food: s.food, window: s.window, trust: s.trust };
    Object.keys(vals).forEach(k => {
      const v = vals[k], r = RES[k];
      $('#v-' + k).textContent = v;
      $('#b-' + k).style.width = clamp(v / r.max * 100, 0, 100) + '%';
      const el = $('#v-' + k).parentElement;
      el.classList.toggle('low', v <= (r.max * 0.2));
      el.classList.toggle('zero', v <= 0);
      let statusLab = r.label + ' ' + v + r.unit;
      if (v <= 0) statusLab += '，缺';
      else if (v <= (r.max * 0.2)) statusLab += '，紧缺';
      el.setAttribute('aria-label', statusLab);
    });
    $('#v-men').textContent = s.men;
    $('#v-board').textContent = s.board.names.length;
    $('#v-run').textContent = '第 ' + s.run + ' 程';
    const itemsEl = $('#v-items');
    if (itemsEl) itemsEl.textContent = '馆藏 ' + s.items.length + '/' + Object.keys(ITEMS).length;
    const snd = $('#sound-btn');
    if (snd) { snd.textContent = Sound.on ? '音 开' : '音 关'; snd.classList.toggle('on', !!Sound.on); }
    $('#v-trust').parentElement.classList.toggle('seep', s.sin > 0);
    $('#hand-tray').innerHTML = s.hand.map(id => {
      const c = CARDS[id]; if (!c) return '';
      const used = s.used.indexOf(id) >= 0;
      return `<button class="chip school-${c.school}" data-card="${id}" ${used ? 'disabled' : ''}
        title="${esc(c.desc)}"><b>${esc(c.name)}</b><i>${esc(c.school)}</i></button>`;
    }).join('');
    $('#comrade-tray').innerHTML = s.comrades.map(id => {
      const m = COMRADES[id]; if (!m) return '';
      return `<button class="chip comrade" data-comrade="${id}" title="${esc(m.note)}"><b>${esc(m.name)}</b><i>${esc(m.role)}</i></button>`;
    }).join('');
    this.fit();
  },
  /* 窄屏的军账是绝对定位的：底边距要按页脚与托盘的实际高度现算，写死会压住手法卡 */
  fit() {
    const f = $('#footbar'), t = $('.bottom-trays');
    document.documentElement.style.setProperty('--hud-bottom',
      ((f ? f.offsetHeight : 0) + (t ? t.offsetHeight : 0) + 10) + 'px');
  },
  flash(deltas) {
    Object.keys(deltas || {}).forEach(k => {
      const d = deltas[k]; if (!d) return;
      const host = $('#v-' + k); if (!host) return;
      const span = document.createElement('span');
      span.className = 'float ' + (d > 0 ? 'up' : 'down');
      span.textContent = (d > 0 ? '+' : '') + d;
      host.parentElement.appendChild(span);
      setTimeout(() => span.remove(), 1400);
    });
  }
};

/* ---------- MapView：底图 SVG + 拖拽 + 视野遮罩 ---------- */
const MapView = {
  tx: 0, ty: 0, s: 0.3, dragging: false, moved: false, far: false,

  init() {
    this.map = $('#map');
    this.vp = $('#viewport');
    /* 触屏设备的命中圈要更大，否则两根手指头点不准同一个格子 */
    this.coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    this.nn = {};
    NODES.forEach(a => {
      let best = 1e9;
      NODES.forEach(b => { if (a !== b) best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y)); });
      this.nn[a.id] = best;
    });
    this.buildArt();
    this.bindPointer();
    this.goTo(NODE_BY_ID[Store.s.at], true);
    this.render();
  },

  buildArt() {
    const p = $('#art-layer');
    let out = '';
    out += `<defs>
      <filter id="paper" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7"/>
        <feColorMatrix type="saturate" values="0"/>
        <feComponentTransfer><feFuncA type="linear" slope="0.06"/></feComponentTransfer>
        <feComposite operator="over" in2="SourceGraphic"/>
      </filter>
      <filter id="cloud" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="4" seed="19"/>
        <feDisplacementMap in="SourceGraphic" scale="42"/>
      </filter>
      <pattern id="marsh" width="34" height="34" patternUnits="userSpaceOnUse">
        <rect width="34" height="34" fill="none"/>
        <path d="M4,26 q6,-8 12,-2 t12,-4" stroke="#3d5040" stroke-width="1.3" fill="none" opacity=".5"/>
        <circle cx="9" cy="10" r="1.6" fill="#3d5040" opacity=".45"/>
        <circle cx="25" cy="16" r="1.4" fill="#3d5040" opacity=".4"/>
      </pattern>
      <pattern id="hatch" width="12" height="12" patternUnits="userSpaceOnUse">
        <path d="M0,12 L12,0" stroke="#8a7a52" stroke-width="1" opacity=".35"/>
      </pattern>
    </defs>`;

    /* 区域底色块 */
    out += `<g id="region-fill">`;
    TERRAIN_PATCHES.forEach(t => {
      const fill = t.kind === 'grass' ? 'url(#marsh)' : t.kind === 'snow' ? '#dfe9ef' : 'url(#hatch)';
      out += `<path d="${t.d}" fill="${fill}" opacity=".8"/>`;
      out += `<path d="${t.d}" fill="none" stroke="#6b6450" stroke-width="2" stroke-dasharray="8 6" opacity=".5"/>`;
      const m = /M(\d+),(\d+)/.exec(t.d);
      if (m) out += `<text class="terrain-name" x="${+m[1] + 40}" y="${+m[2] + 30}">${esc(t.name)}</text>`;
    });
    out += `</g>`;

    /* 省界 */
    out += `<g id="prov">`;
    PROVINCES.forEach(pr => {
      out += `<path d="${pr.path}" fill="none" stroke="#7a6f57" stroke-width="3" stroke-dasharray="16 12" opacity=".55"/>`;
      out += `<text class="prov-name" x="${pr.x}" y="${pr.y}"><tspan>${esc(pr.code)}</tspan></text>`;
      out += `<text class="prov-sub" x="${pr.x}" y="${pr.y + 26}">${esc(pr.name)}</text>`;
    });
    out += `</g>`;

    /* 山脉（示廓线） */
    out += `<g id="ranges">`;
    RANGES.forEach(r => {
      out += `<g class="range ${r.snow ? 'snow' : ''}">`;
      r.pts.forEach((pt, i) => {
        const h = r.snow ? 46 : 34;
        out += `<path d="M${pt[0] - 26},${pt[1] + 12} L${pt[0]},${pt[1] - h} L${pt[0] + 26},${pt[1] + 12} Z"
                 fill="${r.snow ? '#f3f7fa' : 'none'}" stroke="${r.snow ? '#93a8b4' : '#6f6a55'}" stroke-width="2.4" opacity=".9"/>`;
        if (i < r.pts.length - 1) {
          const n = r.pts[i + 1];
          out += `<path d="M${pt[0]},${pt[1] - h + 10} L${n[0]},${n[1] - h + 10}" stroke="#6f6a55" stroke-width="1.2" stroke-dasharray="3 5" opacity=".4"/>`;
        }
      });
      const f = r.pts[0];
      out += `<text class="range-name" x="${f[0] - 10}" y="${f[1] - 56}">${esc(r.name)}</text>`;
      out += `</g>`;
    });
    out += `</g>`;

    /* 江河 */
    out += `<g id="rivers">`;
    RIVERS.forEach(rv => {
      out += `<path class="river ${rv.cold ? 'cold' : ''}" d="${rv.d}" stroke-width="${rv.w}" fill="none"/>`;
      if (rv.zig) out += `<path class="river zig" d="${rv.d}" stroke-width="${rv.w + 5}" fill="none"/>`;
      if (rv.label) out += `<text class="river-name" x="${rv.label.x}" y="${rv.label.y}">${esc(rv.name)}</text>`;
    });
    out += `</g>`;

    /* 敌军箭头 */
    out += `<g id="enemy-layer"></g>`;
    /* 路线 */
    out += `<g id="route-layer"></g>`;
    /* 节点 */
    out += `<g id="node-layer"></g>`;
    /* 主角（army-inner 按缩放反向放大，屏幕上始终一样大） */
    out += `<g id="army"><g class="army-inner">
      <circle r="34" class="army-pulse"/>
      <circle r="26" class="army-halo"/>
      <g class="army-mark"><circle r="11"/><path d="M0,-22 L0,-40 M-1,-39 L16,-32 L-1,-26 Z"/></g>
      <text class="army-here" y="52">你在这里</text>
    </g></g>`;
    p.innerHTML = out;
    this.enemyLayer = $('#enemy-layer', p);
    this.routeLayer = $('#route-layer', p);
    this.nodeLayer = $('#node-layer', p);
    this.army = $('#army', p);
  },

  /* 视野半径（格 → map 单位）：民心、马灯、雪山草地都会改它 */
  sight() {
    const s = Store.s;
    let r = 520;
    const reg = (NODE_BY_ID[s.at] || {}).region;
    if (reg === 'chuan' || reg === 'grass') r -= 120;
    if (s.trust < 20) r -= 220;
    if (s.items.indexOf('it_lantern') >= 0) r += 90;
    if (s.flags.guide) r += 160;
    s.hand.forEach(id => { const f = CARD_FX[id]; if (f && f.sight && s.used.indexOf(id) < 0) r += 90; });
    return Math.max(260, r);
  },

  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },

  visible(node) {
    const cur = NODE_BY_ID[Store.s.at] || NODE_BY_ID.g1;
    if (node.id === cur.id) return true;
    if (Store.s.visited[node.id]) return true;
    return this.dist(cur, node) <= this.sight();
  },

  /* 脚下这一步真能踩下去的去向：相邻 + 已探明 + 没被锁。
     只推前进方向（路线节点 y 单调减小）；走到尽头/支线末端才允许回退。
     先没走过的（别把玩家推荐回已经打完的来路），都没走过再大关卡优先，最后就近；
     都已走过（死路/叶子）则纯就近回退，不跳回起点关卡。 */
  frontNodes() {
    const s = Store.s, cur = NODE_BY_ID[s.at];
    if (!cur) return [];
    const d = n => this.dist(cur, n);
    const all = [...(ADJ[s.at] || new Set())]
      .map(id => NODE_BY_ID[id])
      .filter(n => n && n.id !== s.at && this.visible(n)
        && !(n.lockedUntil && !s.done[n.lockedUntil])
        && !(n.hiddenUntilWin && !(Store.meta.wins > 0)));
    const forward = all.filter(n => n.y < cur.y);
    return (forward.length ? forward : all).sort((a, b) => {
        const da = s.done[a.id] ? 1 : 0, db = s.done[b.id] ? 1 : 0;   /* 先没走过的 */
        if (da !== db) return da - db;
        if (!da) {                                                    /* 都没走过：大关卡优先 */
          const ga = a.kind === 'gate' ? 0 : 1, gb = b.kind === 'gate' ? 0 : 1;
          if (ga !== gb) return ga - gb;
        }                                                            /* 都已走过：纯就近回退 */
        return d(a) - d(b);
      });
  },
  nextNode() { return this.frontNodes()[0] || null; },

  /* 下一站的屏幕坐标（视口 px）：控件与边缘箭头都靠它定位 */
  nextScreenXY(n) {
    const vp = this.vp.getBoundingClientRect();
    return { x: n.x * this.s + this.tx, y: n.y * this.s + this.ty, w: vp.width, h: vp.height };
  },

  /* 下一站不在眼前时，把箭头钉在视口边上指着它 —— 新玩家最容易卡在这里 */
  renderNextArrow() {
    const el = $('#next-arrow');
    if (!el) return;
    const n = this.nextNode();
    if (!n || Game.marching) { el.classList.remove('on'); return; }
    const { x, y, w, h } = this.nextScreenXY(n);
    const m = this.coarse ? 116 : 84;   /* 边距：让开地图控件（触屏上还要让开底部军账条） */
    if (x > m && x < w - m && y > m && y < h - m) { el.classList.remove('on'); return; }
    const cx = clamp(x, m, Math.max(m, w - m));
    const cy = clamp(y, m, Math.max(m, h - m));
    el.style.left = cx.toFixed(1) + 'px';
    el.style.top = cy.toFixed(1) + 'px';
    el.style.setProperty('--ang', (Math.atan2(y - cy, x - cx) * 180 / Math.PI).toFixed(1) + 'deg');
    el.title = '下一站 · ' + n.name;
    el.dataset.node = n.id;
    el.classList.add('on');
  },

  renderNextPill() {
    const pill = $('#next-pill');
    if (!pill) return;
    const n = this.nextNode();
    if (!n) { pill.hidden = true; return; }
    const gate = n.kind === 'gate';
    pill.hidden = false;
    pill.innerHTML = `<span class="np-tag">${gate ? '下一站 · 大关卡' : '下一站'}</span>` +
      `<span class="np-name">${esc(n.name)}</span><span class="np-go">点我行军 ▸</span>`;
    pill.title = gate ? '攻坚 / 抉择 —— 这一格有 CG 分镜与木牌刻名' : '走过去：一格一次抉择，粮 -1 · 时 -1';
  },

  render() {
    const s = Store.s;
    /* 路线：只画两端至少一个可见的边 */
    let rl = '';
    EDGES.forEach(([a, b]) => {
      const na = NODE_BY_ID[a], nb = NODE_BY_ID[b];
      if (!na || !nb) return;
      const va = this.visible(na), vb = this.visible(nb);
      if (!va && !vb) return;
      const walked = s.done[a] && s.done[b];
      const cur = s.at === a || s.at === b;
      rl += `<path class="route ${walked ? 'walked' : ''} ${cur ? 'now' : ''}" d="M${na.x},${na.y} L${nb.x},${nb.y}"/>`;
    });
    /* 未探明的分支stub：给一点“复杂感”但不出内容 */
    rl += `<g opacity=".28">` + GHOST_PATHS.map(g => `<path class="route ghost" d="${g}"/>`).join('') + `</g>`;
    this.routeLayer.innerHTML = rl;

    /* 节点 */
    const nxt = this.nextNode();
    let nl = '';
    NODES.forEach(n => {
      if (!this.visible(n)) return;
      const adj = (ADJ[s.at] || new Set()).has(n.id);
      const here = n.id === s.at;
      const done = !!s.done[n.id];
      const hidden = n.known === 'hidden' && !done;
      const isNext = !!nxt && n.id === nxt.id;
      const cls = ['node', n.kind, here ? 'here' : '', adj ? 'reach' : '', isNext ? 'next' : '', done ? 'done' : '', hidden ? 'unknown' : ''].filter(Boolean).join(' ');
      const label = hidden ? '?' : n.name;
      const go = isNext ? '▸ 下一站 · ' + (this.hintOf(n, hidden).split(' · ')[0]) : this.hintOf(n, hidden);
      /* 键盘可达：相邻（reach）/ 下一站（next）/ 当前（here）节点可被 Tab 聚焦，Enter/Space 行军 */
      const a11y = (adj || isNext || here)
        ? ` tabindex="0" role="button" aria-label="${esc(here ? ('查看' + label) : ('行军至' + label))}"`
        : '';
      nl += `<g class="${cls}" data-node="${n.id}"${a11y} transform="translate(${n.x},${n.y})">
        ${isNext ? '<circle class="next-halo" r="58"/><circle class="next-ring" r="58"/>' : ''}
        <circle class="hit" r="34"/>
        ${n.kind === 'gate'
          ? `<g class="glyph gate-g"><path d="M0,-17 L15,0 L0,17 L-15,0 Z"/><circle r="5"/></g>`
          : `<g class="glyph ev-g"><circle r="12"/></g>`}
        <text class="n-label" y="40">${esc(label)}</text>
        ${n.kind === 'gate' && n.date ? `<text class="n-date" y="58">${esc(n.date)}</text>` : ''}
        ${hidden ? `<text class="n-hint" y="-26">?</text>` : ''}
        ${adj && !here ? `<text class="n-go${isNext ? ' on' : ''}" y="-30">${esc(go)}</text>` : ''}
      </g>`;
    });
    this.nodeLayer.innerHTML = nl;
    this.renderNextPill();

    /* 敌军 */
    let el = '';
    ENEMIES.forEach(e => {
      const idx = clamp(Math.round((8 - s.window) / 8 * (e.path.length - 1)), 0, e.path.length - 1);
      const pos = e.path[idx];
      const closeness = idx / (e.path.length - 1);
      el += `<g class="enemy" transform="translate(${pos[0]},${pos[1]})" opacity="${0.35 + closeness * 0.6}">
        <path class="en-arrow" d="M-22,10 L0,-16 L22,10 L0,2 Z"/>
        <text class="en-name" y="34">${esc(e.name)}</text>
      </g>`;
    });
    this.enemyLayer.innerHTML = el;

    /* 主角 */
    const cur = NODE_BY_ID[s.at];
    this.army.setAttribute('transform', `translate(${cur.x},${cur.y})`);
    this.applyTransform();
  },

  hintOf(n, hidden) {
    if (n.known === 'open') return ICON_HINT[n.icon] || '前方';
    if (hidden) return '不明';
    return '前方';
  },

  applyTransform() {
    const s = Store.s;
    this.map.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`;
    const cur = NODE_BY_ID[s.at];
    const xy = this.armyXY || { x: cur.x, y: cur.y };
    const cx = xy.x * this.s + this.tx;
    const cy = xy.y * this.s + this.ty;
    const r = this.sight() * this.s;
    const fog = REGIONS[(cur.region || 'gan')] || REGIONS.gan;
    const mask = $('#fog');
    mask.style.setProperty('--fog', fog.fog);
    mask.style.background =
      `radial-gradient(circle at ${cx}px ${cy}px, rgba(0,0,0,0) 0, rgba(0,0,0,0) ${r * 0.72}px, var(--fog) ${r * 1.15}px, var(--fog) 100%)`;
    $('#sight-ring').setAttribute('cx', cx);
    $('#sight-ring').setAttribute('cy', cy);
    $('#sight-ring').setAttribute('r', r);
    $('#zoom-label').textContent = Math.round(this.s * 100) + '%';
    $('#far-toggle').textContent = this.far ? '回到视野' : '远望全图';
    document.body.classList.toggle('far-view', this.far);
    /* 反向缩放：命圈与字号按屏幕尺寸恒定，缩得再小也点得着、看得清 */
    const k = clamp(1 / this.s, 1, 3.05);
    this.map.style.setProperty('--k', k.toFixed(3));
    const hr = 26 / this.s;
    this.nodeLayer.querySelectorAll('.hit').forEach(c => {
      const id = c.parentElement && c.parentElement.dataset.node;
      const lim = (this.nn && this.nn[id]) ? this.nn[id] * .55 : 90;
      c.setAttribute('r', Math.max(this.coarse ? 30 : 20, Math.min(hr, lim)).toFixed(1));
    });
    const a = this.army.firstElementChild;
    if (a) a.setAttribute('transform', `scale(${k.toFixed(3)})`);
    this.renderNextArrow();
  },

  goTo(node, instant) {
    const vp = this.vp.getBoundingClientRect();
    const target = this.far ? 0.17 : 0.34;
    const s = target;
    const tx = vp.width / 2 - node.x * s;
    const ty = vp.height * 0.52 - node.y * s;
    if (instant) { this.s = s; this.tx = tx; this.ty = ty; this.applyTransform(); return; }
    const from = { s: this.s, tx: this.tx, ty: this.ty };
    const t0 = performance.now();
    const step = (t) => {
      const k = clamp((t - t0) / 520, 0, 1);
      const e = k < .5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
      this.s = from.s + (s - from.s) * e;
      this.tx = from.tx + (tx - from.tx) * e;
      this.ty = from.ty + (ty - from.ty) * e;
      this.applyTransform();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },

  setFar(on) {
    this.far = on;
    this.goTo(NODE_BY_ID[Store.s.at]);
  },

  /* 重开／清空后把镜头拉回部队（不带动画） */
  recenter() {
    this.far = false;
    this.goTo(NODE_BY_ID[Store.s.at], true);
    this.render();
  },

  /* 以屏幕上某一点为锚做缩放：滚轮与双指捏合共用 */
  zoomAt(next, cx, cy) {
    const rect = this.vp.getBoundingClientRect();
    const mx = cx - rect.left, my = cy - rect.top;
    const before = this.s;
    const after = clamp(next, 0.12, 1.0);
    this.tx = mx - (mx - this.tx) * (after / before);
    this.ty = my - (my - this.ty) * (after / before);
    this.s = after;
    this.far = after < 0.22;
    this.applyTransform();
  },

  bindPointer() {
    const vp = this.vp;
    const pts = new Map();
    let sx = 0, sy = 0, ox = 0, oy = 0, pid = -1;
    let pinch0 = 0, pinchS = 1, pinchMid = null;
    const two = () => { const v = [...pts.values()]; return [v[0], v[1]]; };
    /* 拖拽可以从地图任意处起手（包括节点上）：位移过阈值才真正进入拖动，按下节点不会被误判成拖动。
       控件上的手指不算拖拽起手 —— 否则抖动一过阈值就 setPointerCapture，这次点击会被改派给 #viewport，手机上点不动。 */
    vp.addEventListener('pointerdown', (e) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || (e.target.closest && e.target.closest('.map-tools, #next-arrow, .bottom-trays'))) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        /* 第二指落下：转成捏合，单指拖动立刻让位 */
        this.dragging = false; vp.classList.remove('grabbing');
        const [a, b] = two();
        pinch0 = Math.max(12, Math.hypot(a.x - b.x, a.y - b.y));
        pinchS = this.s;
        pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      } else if (pts.size === 1) {
        sx = e.clientX; sy = e.clientY; ox = this.tx; oy = this.ty;
        pid = e.pointerId; this.dragging = true; this.moved = false;
      }
    });
    const move = (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && pinch0 > 0) {
        const [a, b] = two();
        const d = Math.max(12, Math.hypot(a.x - b.x, a.y - b.y));
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.zoomAt(pinchS * (d / pinch0), mid.x, mid.y);
        this.tx += mid.x - pinchMid.x; this.ty += mid.y - pinchMid.y;
        pinchMid = mid;
        this.moved = true;
        this.applyTransform();
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!this.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 5) return;
        this.moved = true;
        vp.classList.add('grabbing');
        try { vp.setPointerCapture(pid); } catch (err) {}
      }
      this.tx = ox + dx; this.ty = oy + dy;
      this.applyTransform();
    };
    const stop = (e) => {
      if (!pts.has(e.pointerId)) { if (!this.dragging) return; }
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch0 = 0;
      if (pts.size === 1) {
        /* 捏合抬起一根手指后，剩下那根接着当单指拖用，不能突然跳 */
        const rest = [...pts.entries()][0];
        sx = rest[1].x; sy = rest[1].y; ox = this.tx; oy = this.ty; pid = rest[0];
        this.dragging = true; this.moved = true;
        return;
      }
      if (pts.size === 0) {
        this.dragging = false; vp.classList.remove('grabbing');
        if (this.moved) { try { vp.releasePointerCapture(e.pointerId); } catch (err) {} }
      }
    };
    window.addEventListener('pointermove', move);
    vp.addEventListener('pointerup', stop);
    window.addEventListener('pointerup', stop);
    vp.addEventListener('pointercancel', stop);
    window.addEventListener('pointercancel', stop);
    vp.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomAt(this.s * (e.deltaY > 0 ? 0.9 : 1.1), e.clientX, e.clientY);
    }, { passive: false });
    this.nodeLayer.addEventListener('click', (e) => {
      if (this.moved) { this.moved = false; return; }
      const g = e.target.closest('[data-node]');
      if (!g) return;
      Game.onNodeClick(g.dataset.node);
    });
    window.addEventListener('resize', () => this.applyTransform());
    document.addEventListener('keydown', (e) => {
      /* 焦点落在地图节点（<g data-node>，tabindex=0，role=button）上时：
         Enter / Space 直接行军至该节点，不再抢走"走下一站"，也不被地图快捷键劫持 */
      const fn = e.target && e.target.dataset && e.target.dataset.node;
      if (fn && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); Game.onNodeClick(e.target.dataset.node); return; }
      /* 焦点在按钮 / 链接 / 输入框时，按键交给控件自己处理，地图不抢 */
      const tag = (e.target.tagName || '').toUpperCase();
      if (/^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      /* 'f' 键 = 远望全图（不再劫持 Tab，Tab 留给原生遍历顶栏/下一站/托盘/地图工具） */
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); this.setFar(!this.far); }
      if (e.key === '+' || e.key === '=') { this.s = clamp(this.s * 1.12, 0.12, 1); this.applyTransform(); }
      if (e.key === '-') { this.s = clamp(this.s * 0.89, 0.12, 1); this.applyTransform(); }
      /* 空格 = 走下一站（焦点不在节点/按钮上时） */
      if (e.key === ' ') { e.preventDefault(); Game.goNext(); }
    });
  }
};

const ICON_HINT = {
  village: '村落 · 可筹粮', ford: '渡口 · 花时间', battle: '战斗 · 折人', hall: '会议 · 不折人',
  fork: '岔路 · 可省时', snow: '雪山 · 缺粮', swamp: '草地 · 极限', pass: '隘口 · 攻坚',
  bridge: '铁索桥 · 限时', granary: '粮仓 · 得民心', checkpoint: '封锁线', road: '急行军',
  camp: '宿营', news: '消息', city: '城镇', mountain: '山地', shop: '补给', river: '河水', '?': '不明'
};

/* 全图态里那些“看不见的分支”，只造复杂感，不可点 */
const GHOST_PATHS = [
  'M1400,4280 C1500,4200 1560,4100 1520,3980 C1480,3880 1350,3860 1250,3900',
  'M1180,4300 C1260,4400 1380,4440 1520,4420',
  'M880,3752 C820,3820 760,3900 700,3960 C620,4020 520,4000 470,3930',
  'M730,3660 C660,3700 600,3760 540,3780 C480,3790 430,3750 420,3690',
  'M620,3520 C540,3540 460,3520 400,3470 C350,3430 330,3360 350,3300',
  'M640,3300 C720,3260 800,3240 860,3200 C920,3150 940,3080 900,3020',
  'M580,3020 C500,3000 420,2980 360,2940 C300,2900 280,2840 300,2780',
  'M380,2660 C300,2620 220,2600 160,2640 C120,2680 120,2760 160,2800',
  'M290,2250 C200,2240 120,2280 90,2340',
  'M290,1850 C200,1820 130,1780 100,1720 C80,1660 110,1600 170,1580',
  'M390,1650 C300,1600 220,1560 160,1500',
  'M400,1200 C300,1180 220,1140 170,1080 C140,1030 160,980 220,960',
  'M470,1000 C380,960 300,920 250,860',
  'M540,860 C460,820 400,780 360,720',
  'M920,620 C1020,600 1120,560 1180,500 C1220,450 1200,390 1140,360'
];

/* ---------- Game：主流程 ---------- */
const Game = {

  /* ---------- 逐格战史日志（17 §3.1 S0） ----------
     只记引擎已经算出来的字段。AI 战史官与战友记忆都从这里取事实，
     日志里没有的一个字不许补。旧档会自动补出 log:[]，无需迁移。 */
  logStep(e) {
    const s = Store.s;
    if (!s.log) s.log = [];
    const at = NODE_BY_ID[s.at] || {};
    s.log.push(Object.assign({
      i: s.log.length + 1, at: s.at, place: at.name || '', region: at.region || '', run: s.run
    }, e));
    /* localStorage 体积控制：超过 120 条把前 60 条压成一条摘要 */
    if (s.log.length > 120) {
      const head = s.log.splice(0, 60);
      s.log.unshift({ i: 0, kind: 'digest', place: '前段路程', region: '',
        steps: head.length, note: '前 ' + head.length + ' 步已压缩，只保留摘要' });
    }
  },

  /* 民心回响（17 §3.6 S5）：锁死选项时不写判词，用画面回指本局真实发生过的那一次。
     只取日志里的地名与玩家按下的按钮文字，一个字都不补。 */
  echoLine(node) {
    const s = Store.s;
    const sin = (s.log || []).filter(e => e.kind === 'choice' && e.sin);
    if (!sin.length) return '';
    const first = sin[0];
    const what = String(first.label || '那一次').replace(/[（(].*?[）)]/g, '').trim();
    return '那天在' + (first.place || '路上') + '，你按下了「' + what + '」。' +
      '今天走到' + (node.name || '这里') + '，门口没有人出来。';
  },

  /* 人物篇目过场（19 §4）：插在「上一格结算完 → 本格打开前」，一局只播一次，无交互 */
  pendingCutscene(node) {
    const s = Store.s;
    if (typeof CUTSCENES === 'undefined') return null;
    const prev = s.flags.lastResolvedNode;
    if (!prev) return null;
    const keys = Object.keys(CUTSCENES);
    for (let i = 0; i < keys.length; i++) {
      const c = CUTSCENES[keys[i]];
      if (c.afterNode === prev && (!c.beforeNode || c.beforeNode === node.id) &&
          !s.done['cut_' + keys[i]]) return { key: keys[i], c };
    }
    return null;
  },

  playCutscene(node, hit, done) {
    const s = Store.s, c = hit.c;
    s.done['cut_' + hit.key] = true;
    s.flags.lastResolvedNode = null;   /* 防止本格之后再次命中同一段过场 */
    Router.open({
      title: c.title, kicker: c.kicker, size: 'wide', cinematic: true,
      art: c.art, motion: c.motion, closable: false, blocking: true,
      html: c.html,
      actions: [{ text: '继续走', kind: 'primary', onClick: () => { setTimeout(done, 240); } }]
    });
  },

  boot() {
    Store.load();
    Hud.build();
    MapView.init();
    this.bindChrome();
    Hud.render();
    if (!Store.s.flags.seenIntro) { Store.s.flags.seenIntro = true; Store.save(); Pages.intro(); }
    else if (!Store.s.flags.sawNotes) {
      /* 老存档第一次补看须知：这条提示会被弹窗压住，等看完再说 */
      setTimeout(() => Pages.notes(), 700);
    } else {
      Toast.show(MapView.coarse ? '单指拖动地图 · 双指捏合缩放 · 点击前方节点行军' : '拖动地图可移动视野 · 滚轮缩放 · 点击前方节点行军');
    }
  },

  bindChrome() {
    $('#nav-board').addEventListener('click', () => Pages.board());
    $('#nav-wall').addEventListener('click', () => Pages.wall());
    $('#nav-history').addEventListener('click', () => Pages.history());
    $('#nav-cards').addEventListener('click', () => Pages.cards());
    $('#nav-help').addEventListener('click', () => Pages.help());
    $('#nav-memory').addEventListener('click', () => Pages.memory());
    $('#nav-code').addEventListener('click', () => Pages.codePage());
    $('#sound-btn').addEventListener('click', () => Sound.toggle());
    $('#far-toggle').addEventListener('click', () => MapView.setFar(!MapView.far));
    $('#center-btn').addEventListener('click', () => MapView.goTo(NODE_BY_ID[Store.s.at]));
    $('#reset-btn').addEventListener('click', () => Pages.confirmReset());
    /* S4 军帐议事：开关启用时挂一个顶栏入口，点开即出本局/历史事实 + ±5% 提示（复用 .navlink 样式） */
    if (BALANCE.council.enabled) {
      const cbtn = document.createElement('button');
      cbtn.className = 'navlink'; cbtn.id = 'nav-council'; cbtn.textContent = '军帐议事';
      cbtn.addEventListener('click', () => Council.render());
      const nav = $('.nav-group-links') || $('#topnav'); if (nav) nav.appendChild(cbtn);
    }
    /* V1：远望全图改用 F 键（不再劫持 Tab）；页面提示在运行时同步 */
    const mn = document.querySelector('.map-note');
    if (mn) mn.textContent = mn.textContent.replace('Tab 远望全图', 'F 键远望全图');
    $('#notes-btn').addEventListener('click', () => Pages.notes());

    /* 新手引导：顶栏常驻入口 + 功能菜单里的同一入口 */
    document.querySelectorAll('[data-tutorial]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.Tutorial) Tutorial.open({ mode: '2d', from: 'game' });
        else Toast.show('新手引导正在载入，请稍后再点一次');
      });
    });

    /* 顶栏只留核心操作，行囊/木牌/史料等统一收进功能菜单 */
    const menuBtn = $('#nav-menu-2d'), menu = $('#topnav'), scrim = $('#nav-scrim');
    if (menuBtn && menu) {
      const closeMenu = () => {
        menu.classList.remove('open');
        if (scrim) scrim.classList.remove('on');
        document.body.classList.remove('menu-open');
        menuBtn.setAttribute('aria-expanded', 'false');
      };
      const openMenu = () => {
        menu.classList.add('open');
        if (scrim) scrim.classList.add('on');
        document.body.classList.add('menu-open');
        menuBtn.setAttribute('aria-expanded', 'true');
      };
      menuBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        menu.classList.contains('open') ? closeMenu() : openMenu();
      });
      if (scrim) scrim.addEventListener('click', closeMenu);
      menu.addEventListener('click', (ev) => {
        if (ev.target.closest('button, a')) setTimeout(closeMenu, 0);
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && menu.classList.contains('open')) closeMenu();
      });
    }

    window.addEventListener('resize', () => Hud.fit());
    /* 下一站的两种点法：底部药丸 + 视口边缘箭头，都走同一套可达性判定 */
    $('#next-pill').addEventListener('click', () => this.goNext());
    $('#next-arrow').addEventListener('click', () => { if (!MapView.moved) this.goNext(); });
    $('#hand-tray').addEventListener('click', (e) => {
      const c = e.target.closest('[data-card]'); if (!c) return;
      Pages.cardDetail(c.dataset.card);
    });
    $('#comrade-tray').addEventListener('click', (e) => {
      const c = e.target.closest('[data-comrade]'); if (!c) return;
      Pages.comradeDetail(c.dataset.comrade);
    });
  },

  /* 走下一站：药丸、边缘箭头、空格键共用。视野外的先把镜头拉过去，免得点了没反应 */
  goNext() {
    const n = MapView.nextNode();
    if (!n) { Toast.show('这一步没有能走的格 —— 点「远望全图」看路线，或先处理脚下这一格'); return; }
    const vp = MapView.vp.getBoundingClientRect();
    const p = MapView.nextScreenXY(n);
    const inView = p.x > 60 && p.x < vp.width - 60 && p.y > 60 && p.y < vp.height - 60;
    if (!inView) MapView.goTo(n);
    this.onNodeClick(n.id);
  },

  /* 点击节点：可达 → 行军；已在原地 → 打开 */
  onNodeClick(id) {
    const s = Store.s, n = NODE_BY_ID[id];
    if (!n || this.marching) return;
    if (!MapView.visible(n)) { Toast.show('那片还在云里，先往前走'); return; }
    if (id === s.at) { this.enter(n); return; }
    if (!(ADJ[s.at] || new Set()).has(id)) { Toast.show('这条路不通 —— 只能走到与当前位置相连的格子'); return; }
    if (n.lockedUntil && !s.done[n.lockedUntil]) { Toast.show('这条路还没打开'); return; }
    if (n.hiddenUntilWin && !(Store.meta.wins > 0)) { Toast.show('一年以后这里才有人 —— 先走完一次长征'); return; }
    this.march(n);
  },

  march(node) {
    const s = Store.s;
    if (this.marching) return;
    this.marching = true;
    this.animateArmy(node, () => {
      this.marching = false;
      s.at = node.id;
      s.visited[node.id] = true;
      /* 行军 tick：粮 -1、时 -1 */
      this.apply(BALANCE.march);
      this.charityTop();
      Store.save(); MapView.render(); Hud.render();
      let surprise = null;
      /* 追兵压顶：时窗归零只烧成一格 — 这一格代价翻倍、最多打一场遭遇战，然后甩开尾巴喘两天（pursuitGrace）。
         不能让它赖在零上，否则每格都必发敌袭，事件刷屏 + 折损全程翻倍。 */
      const crisis = s.window <= 0;
      s.flags.pursuitHot = crisis;
      if (crisis) {
        if (!s.flags.lastMarchSurprise && node.kind !== 'gate') surprise = this.rollMoveEvent();
        else Toast.show('追兵咬住这一格 — 这一格的折损翻倍，但队伍把尾巴甩开了');
        s.window = BALANCE.pursuitGrace;
        s.flags.lastMarchSurprise = !!surprise;
      } else {
        const p = s.flags.lastMarchSurprise ? BALANCE.eventCooldownP : BALANCE.eventP;
        if (s.blockNextSurprise) { s.blockNextSurprise = false; Toast.show('夜行：一支队伍摸过去了，没有惊动哨兵'); }
        else if (Math.random() < p && node.kind !== 'gate') surprise = this.rollMoveEvent();
        s.flags.lastMarchSurprise = !!surprise;
      }
      /* 逐格战史：没有抉择的一格也要记，否则战史官只能靠终值编故事 */
      this.logStep({
        kind: 'march', label: '行军',
        delta: { food: BALANCE.march.food, window: BALANCE.march.window },
        menAfter: s.men, foodAfter: s.food, windowAfter: s.window, trustAfter: s.trust,
        hunger: s.food <= 0, pursuit: !!crisis, surprise: surprise ? surprise.title : null
      });
      this.afterArrive(node, surprise);
    });
  },

  animateArmy(node, done) {
    const from = NODE_BY_ID[Store.s.at];
    const rect = MapView.vp.getBoundingClientRect();
    const t0 = performance.now(), dur = 430, sc = MapView.s;
    const c0 = { tx: MapView.tx, ty: MapView.ty };
    const c1 = { tx: rect.width / 2 - node.x * sc, ty: rect.height * 0.52 - node.y * sc };
    const step = (t) => {
      const k = clamp((t - t0) / dur, 0, 1);
      const e = k < .5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
      const x = from.x + (node.x - from.x) * e;
      const y = from.y + (node.y - from.y) * e;
      MapView.armyXY = { x, y };
      MapView.army.setAttribute('transform', `translate(${x},${y})`);
      MapView.tx = c0.tx + (c1.tx - c0.tx) * e;
      MapView.ty = c0.ty + (c1.ty - c0.ty) * e;
      MapView.applyTransform();
      if (k < 1) requestAnimationFrame(step);
      else { MapView.armyXY = null; done(); }
    };
    requestAnimationFrame(step);
  },

  afterArrive(node, surprise) {
    Store.snapshot();
    if (surprise) {
      this.chosenCard = null;
      Router.open({
        title: '行进途中 · ' + surprise.title, kicker: '突发事件', size: 'mid', blocking: true, closable: false,
        html: `<p class="lead">${esc(surprise.text)}</p>` + this.optHtml(surprise, 'mv'),
        actions: []
      });
      this.bindOptions(surprise, { source: 'move', opts: surprise.options, dest: node });
      return;
    }
    this.enter(node);
  },

  enter(node) {
    const s = Store.s;
    /* 人物篇目过场：上一格结算完、本格打开前播一次；播完再进本格 */
    const cut = this.pendingCutscene(node);
    if (cut) { this.playCutscene(node, cut, () => this.enter(node)); return; }
    if (node.kind === 'hub') { this.enterHub(node); return; }
    if (s.done[node.id]) {
      Router.open({
        title: node.name, kicker: '故地', size: 'mid',
        html: `<p class="lead">此地已经了结。${node.kind === 'gate' ? '木牌上刻着 ' + esc((node.carve || {}).place || '') + '。' : ''}</p>`
          + (node.epilogue ? `<p class="quote">${esc(node.epilogue)}</p>` : '')
          + this.loreLinks(node),
        actions: [{ text: '回到地图', kind: 'primary' }]
      });
      return;
    }
    if (node.finale) { Ending.run(); return; }
    if (node.sits) { Memory.receipt(); this.sitLoop(node, () => this.openNode(node)); return; }
    this.openNode(node);
  },

  enterHub(node) {
    Store.s.done[node.id] = true;
    Router.open({
      title: node.name, kicker: '路径点', size: 'sm',
      html: this.roadHtml() + `<p class="lead">${esc(node.note || '队伍在这里合流，继续往前走。')}</p>`,
      actions: [{ text: '继续', kind: 'primary', onClick: () => { Store.save(); MapView.render(); } }]
    });
    Store.save(); MapView.render(); Hud.render();
  },

  /* 雪山／草地的“坐下”判定：每次 -2 兵；坐满次数出“大石头”文本 */
  sitLoop(node, done) {
    const s = Store.s;
    const canSkip = s.hand.indexOf('c_no_sit') >= 0 && s.used.indexOf('c_no_sit') < 0;
    let left = node.sits, sat = 0;
    let closeSelf = null, closed = false;
    const dismiss = () => { if (!closed) { closed = true; if (closeSelf) closeSelf(); } };

    const go = () => { dismiss(); if (sat > 0) this.showSitLore(node, done); else done(); };
    const sit = () => {
      dismiss();
      s.men = Math.max(0, s.men - 2); sat += 1; left -= 1;
      Hud.flash({ men: -2 }); Store.save(); Hud.render();
      if (s.men <= 0) { Flow.nextCheng(node); return; }
      if (left <= 0) { this.showSitLore(node, done); return; }
      ask();
    };
    const skip = () => {
      dismiss();
      if (s.used.indexOf('c_no_sit') < 0) s.used.push('c_no_sit');
      s.window = Math.max(0, s.window - 1);
      Hud.flash({ window: -1 }); Store.save(); Hud.render();
      Toast.show('你一路没有坐下');
      done();
    };

    function ask() {
      closed = false;
      const actions = [];
      if (canSkip && sat === 0) actions.push({ text: '用「不坐下」跳过整段', kind: 'ghost', onClick: () => { skip(); return true; } });
      actions.push({ text: '不坐，继续走', kind: 'primary', onClick: () => { go(); return true; } });
      actions.push({ text: '坐下歇一口气', kind: 'ghost', onClick: () => { sit(); return true; } });
      closeSelf = Router.open({
        title: node.name + ' · 歇一会儿？',
        kicker: '坐下判定 · 还剩 ' + left + ' 次', size: 'mid', blocking: true, closable: false,
        html: `<p class="lead">风停了一瞬，路边有人示意可以坐。坐下去的人里，有几个再没起来。</p>
          <p class="note-hint">你已经坐过 ${sat} 次。坐下之后的账，等这一段走完再给你看。</p>`,
        actions
      });
    }
    ask();
  },

  showSitLore(node, after) {
    Store.s.done['sit_' + node.id] = true;
    Router.open({
      title: '那块“大石头”', kicker: 'R · 据老红军回忆', size: 'mid', cinematic: true, art: 'cg-10',
      onClose: () => { if (after) after(); },
      html: `<p class="cg">十九岁的郝毅走不动了，朦胧间见前面有块大石头，把包袱放上去想坐一会儿——一坐下去，“大石头”歪倒了：那是前面部队牺牲的战友，身子已经僵硬。</p>
             <p class="cg dim">刘洪才记得另一夜：头天挤在雪洞里取暖，第二天醒来只剩副班长还躺着，一推才知道已经冻死。</p>
             <p class="src">新华网《他们历经苦难 我们收获辉煌》 · 转述老红军回忆 · 分级 R</p>`,
      actions: [{ text: '把这段记进史料', kind: 'primary', onClick: () => History.unlock('h_jiajinshan') }]
    });
  },

  openNode(node) {
    const s = Store.s;
    Store.snapshot();
    const lock = node.requires && s.trust < node.requires.trustMin;
    let opts = (node.options || []).slice();
    if (node.sinOption) opts = opts.concat([Object.assign({ sinNote: true }, node.sinOption)]);
    if (lock) {
      Router.open({
        title: node.name, kicker: node.date || '', size: 'mid',
        html: `<p class="lead">${esc(node.scene || node.text || '')}</p>
               <div class="lockbox"><b>选项已被锁死</b><p>${esc(node.requires.failText)}</p>
               ${this.echoLine(node) ? `<p class="echo">${esc(this.echoLine(node))}</p>` : ''}</div>`,
        actions: [{ text: '接受代价继续', kind: 'ghost', onClick: () => this.resolve(node, {
          label: '被迫硬闯（无人带路）', cost: { men: -8, window: -2 }, outcome: '没有向导，没有借粮。你的队伍在自己找路上耗掉了两天。'
        }) }]
      });
      return;
    }
    this.chosenCard = null;
    Router.open({
      title: node.name, kicker: (node.kind === 'gate' ? '大关卡 · ' : '事件 · ') + (node.date || ICON_HINT[node.icon] || ''),
      size: node.kind === 'gate' ? 'wide' : 'mid',
      closable: false, blocking: true,
      html: this.roadHtml() + `<p class="lead">${esc(node.scene || node.text || '')}</p>` +
        (node.brief ? `<p class="brief">${esc(node.brief)}</p>` : '') +
        (node.note ? `<p class="rule-note">${esc(node.note)}</p>` : '') +
        this.optHtml(node, node.id, opts),
      actions: []
    });
    this.bindOptions(node, { source: 'node', opts });
  },

  optHtml(node, key, list) {
    const s = Store.s;
    const opts = list || node.options || [];
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
        `<button class="chip tiny" data-pick="${id}" title="${esc(CARDS[id].desc)}">${esc(CARDS[id].name)}</button>`).join('') || '<i class="dim">（手上没有可用卡）</i>'
    }</span></div>`;
  },

  bindOptions(node, ctx) {
    const mask = Router.stack[Router.stack.length - 1];
    if (!mask) return;
    const root = mask.el;
    let settled = false;
    const timer = { id: 0 };
    const go = () => {
      if (settled) return;
      settled = true;
      ctx.done = true;
      clearTimeout(timer.id);
      if (Game.activeCtx === ctx) Game.activeCtx = null;
      Router.closeAll();
      if (ctx.source === 'move') this.applyChoice(node, ctx.opt, () => this.afterMove(ctx.dest));
      else this.resolve(node, ctx.opt);
    };
    ctx.settle = go;
    this.activeCtx = ctx;
    this.curOpts = ctx.opts || node.options || [];
    root.addEventListener('click', (e) => {
      if (ctx.opt) {
        /* 亮账期间：点正文任意处提前跳转；点史料链接／关闭按钮不算跳转 */
        if (!e.target.closest('[data-link],[data-x]')) go();
        return;
      }
      const pickBtn = e.target.closest('[data-pick]');
      if (pickBtn) {
        const id = pickBtn.dataset.pick;
        this.chosenCard = this.chosenCard === id ? null : id;
        $$('[data-pick]', root).forEach(b => b.classList.toggle('on', b.dataset.pick === this.chosenCard));
        return;
      }
      const ob = e.target.closest('[data-opt]');
      const opts = ctx.opts || node.options || [];
      if (!ob) return;
      const opt = opts[+ob.dataset.opt];
      if (!opt) return;
      ctx.opt = opt;
      this.revealOptions(root, opts, ob);
      timer.id = setTimeout(go, 3400);
    });
  },

  /* 按下之后才亮账：选了的、没选的都在自己那一行下面写出增减，
     停几秒让玩家看完（点任意处提前走），再跳转结算页 */
  revealOptions(root, opts, picked) {
    const list = picked.closest('.opts');
    $$('[data-opt]', list).forEach(b => {
      const o = opts[+b.dataset.opt];
      if (!o) return;
      const isPick = b === picked;
      b.insertAdjacentHTML('beforeend', this.revealHtml(o, isPick));
      b.classList.add(isPick ? 'picked' : 'passed');
    });
    list.classList.add('locked');
    list.insertAdjacentHTML('beforeend', '<span class="reveal-tip">账亮出来了 —— 点任意处继续</span>');
    const bar = root.querySelector('.cardbar');
    if (bar) bar.classList.add('locked');
  },

  revealHtml(o, picked) {
    const c = o.cost || {};
    const parts = [];
    [['men', '兵'], ['food', '粮'], ['window', '时'], ['trust', '民']].forEach(([k, lb]) => {
      if (!c[k]) return;
      parts.push(lb + ' ' + (c[k] > 0 ? '+' : '') + c[k] + (k === 'trust' && o.sin ? '（当场不收）' : ''));
    });
    return `<span class="opt-reveal">${picked ? '你选的：' : '没选的那条：'}${esc(parts.join(' · ') || '没有资源增减')}</span>`;
  },

  /* 行进突发事件：每种一局最多两次，权重按"这局见过几次"衰减，
     且不跟上一次重复；同一类型的多条写法优先挑没读过的 */
  rollMoveEvent() {
    const s = Store.s, f = s.flags;
    const cur = NODE_BY_ID[s.at] || {};
    const seen = f.moveSeen || (f.moveSeen = {});
    /* ① 独立地域池：只抽当前区域的专属事件，抽中就直接返回。
       主池 10 条、权重和 90、eventP=0.24 一个数字都不动（17 §5.3 方案 B）。 */
    if (BALANCE.regionP > 0 && Math.random() < BALANCE.regionP) {
      const local = MOVE_EVENTS.filter(m => m.localRegion === cur.region &&
        (seen[m.id] || 0) < 2 && m.id !== f.lastMoveId);
      if (local.length) {
        const m = local[rnd(local.length)];
        seen[m.id] = (seen[m.id] || 0) + 1;
        f.lastMoveId = m.id;
        f.lastMoveLocal = true;
        return this.pickVariant(m);
      }
    }
    f.lastMoveLocal = false;
    const pool = MOVE_EVENTS.filter(m => {
      if (m.localRegion) return false;   /* ★ 区域专属必须排除出主池，否则权重和 90→114 */
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
    if (!cands.length) {
      const min = Math.min.apply(null, pool.map(m => seen[m.id] || 0));
      cands = pool.filter(m => (seen[m.id] || 0) === min);
    }
    let total = cands.reduce((a, m) => a + w(m), 0), r = Math.random() * total;
    let picked = cands[cands.length - 1];
    for (const m of cands) { r -= w(m); if (r <= 0) { picked = m; break; } }
    seen[picked.id] = (seen[picked.id] || 0) + 1;
    f.lastMoveId = picked.id;
    return this.pickVariant(picked);
  },

  /* 同一条事件的几种说法：先出没见过的，都出过就随机重出。
     变体可以自带 options —— 不带就沿用事件的那几条。
     口径：屏幕上出现的每一个人名、物件、数字，都必须在这一次的正文里交代过，
     否则选项读起来就是没头没尾的（「杀掉」杀什么？玩家不知道）。 */
  pickVariant(m) {
    const f = Store.s.flags;
    /* 地域皮（17 §3.4 S3 / 19 §2）：带 region 的变体只在本区域进入候选，
       不带 region 的原变体照常全局可用。校验器原生就能逐个载体查锚点。 */
    const region = (NODE_BY_ID[Store.s.at] || {}).region;
    const raw = (m.variants || []).filter(v => !v.region || v.region === region);
    const list = [{ title: m.title, text: m.text, options: m.options }].concat(raw);
    const used = f.mvVar || (f.mvVar = {});
    const fresh = list.map((v, i) => i).filter(i => !used[m.id + '#' + i]);
    const i = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : Math.floor(Math.random() * list.length);
    used[m.id + '#' + i] = 1;
    const v = list[i];
    /* S6 追兵学你：启用时本局至多 maxPerRun 次，给一个 ±5% 叠加层提示（不进 C11 结算） */
    enemyMod();
    return Object.assign({}, m, { title: v.title, text: v.text, options: v.options || m.options });
  },

  /* ---------- 结算：一条清晰的管线 ----------
     compute(算清四项增减) → 战友卡分支 → commit(落账) → after(刻名/解锁) → postChoice(收账与展示) */

  resolve(node, opt) {
    this.applyChoice(node, opt, () => this.afterResolve(node, opt));
  },

  regionOf(node) {
    return node.region || (NODE_BY_ID[Store.s.at] || {}).region || 'gan';
  },

  isCombatOf(node) {
    return /battle|pass|bridge|ford|snow|swamp/.test(node.icon || '') || !!(node.floor && node.floor.men);
  },

  compute(node, opt) {
    const s = Store.s;
    const cost = opt.cost || {};
    const d = { men: 0, food: cost.food || 0, window: cost.window || 0, trust: cost.trust || 0 };
    let loss = Math.max(0, -(cost.men || 0));
    let gain = Math.max(0, cost.men || 0);
    const notes = [];
    const isCombat = this.isCombatOf(node);

    /* ① 手法卡 */
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
        const id = s.comrades.shift();
        this.carve(COMRADES[id].name + '（' + COMRADES[id].role + '）');
        notes.push(COMRADES[id].name + ' 的名字刻上了木牌');
      }
      if (s.used.indexOf(cardId) < 0) s.used.push(cardId);
      notes.push('手法卡生效：' + (CARDS[cardId] ? CARDS[cardId].name : cardId));
      this.chosenCard = null;
    }

    /* ② 追兵压上：这一格折损翻倍（除被卡顶掉）。压顶只占一格，由 flags.pursuitHot 标记 */
    if ((s.window <= 0 || s.flags.pursuitHot) && loss > 0) {
      if (s.flags.ignorePursuit) notes.push('这一格的追兵被手法卡顶掉了');
      else { loss *= 2; notes.push('追兵压上来了 — 这一格的代价翻倍'); }
    }
    s.flags.pursuitHot = false;
    s.flags.ignorePursuit = false;

    /* ③ 断粮饿倒 */
    if (s.food + d.food <= 0) {
      if (s.hungerImmune) { s.hungerImmune = false; notes.push('「分最后一口」把这一次饿倒顶掉了'); }
      else { loss += BALANCE.hungerLoss; notes.push('断了粮：倒在地上的人比枪子多（多折 ' + BALANCE.hungerLoss + ' 支）'); }
    }

    /* ④ 民心低于 20：民族地区再多耗一层（向导与借粮都锁着） */
    if (s.trust < 20 && ['chuan', 'grass', 'min'].indexOf(this.regionOf(node)) >= 0) {
      loss += 3;
      notes.push('这一带没人肯带路，多绕出来的路要用人换');
    }

    /* ⑤ 民心的账是延迟的：违纪选项当场不掉民 */
    if (opt.sin) d.trust = 0;

    /* ⑥ 上一格许下的民心回弹 */
    if (s.trustNext) { d.trust += s.trustNext; s.trustNext = 0; }

    d.men = gain - loss;
    return { d, loss, gain, isCombat, notes };
  },

  applyChoice(node, opt, after) {
    const s = Store.s;
    s.flags.lastChoiceLabel = opt.label;
    const p = this.compute(node, opt);
    /* 战友卡只挡作战与冻饿，绝不挡违纪的账 */
    const canOffer = !opt.sin && p.isCombat && p.loss >= 5 && s.comrades.length > 0;
    if (canOffer) this.offerComrade(node, opt, p, after);
    else this.commit(node, opt, p, after);
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
    /* 逐格战史：记的是引擎刚算完的账，不是模型写出来的话 */
    s.flags.lastResolvedNode = node.id;
    this.logStep({
      kind: 'choice', label: opt.label,
      delta: { men: p.d.men, food: p.d.food, window: p.d.window, trust: p.d.trust },
      sin: opt.sin ? opt.sin.type : null, hunger: s.food <= 0,
      menAfter: s.men, foodAfter: s.food, windowAfter: s.window, trustAfter: s.trust,
      blank: s.board.blanks, note: (s.flags.lastNotes || []).slice(-1)[0] || ''
    });
    if (opt.recruit && COMRADES[opt.recruit]) Memory.add('saved', '把' + COMRADES[opt.recruit].name + '编进了队伍');
    if (s.food <= 0) Memory.add('shared_hunger', '断粮的一格');
    if (opt.sin) Sin.register(opt.sin);
    Store.save();
    if (after) after();
    else this.postChoice(node);
  },

  offerComrade(node, opt, p, after) {
    const s = Store.s;
    const lost = p.loss;
    Router.open({
      title: '有人往前站了一步', kicker: '战友卡', size: 'mid', closable: false, blocking: true,
      html: `<p class="lead">${esc(opt.outcome || node.text || node.scene || '')}</p>
        <p class="note-hint">这一格要折 ${lost} 支建制。战友可以替你挡一次（每人最多顶 ${BALANCE.mateSave} 支；只挡作战与冻饿，挡不住违纪的账）。</p>`,
      actions: s.comrades.map((id, i) => ({
        text: '让 ' + COMRADES[id].name + ' 顶上去', kind: i === 0 ? 'primary' : 'ghost',
        onClick: () => {
          s.comrades.splice(i, 1);
          Memory.add('abandoned', '让' + COMRADES[id].name + '顶上去');
          const saved = Math.min(BALANCE.mateSave, p.loss);
          p.loss -= saved;
          p.d.men = p.gain - p.loss;
          this.carve(COMRADES[id].name + '（' + COMRADES[id].role + '）');
          p.notes.push(COMRADES[id].name + ' 替你挡住了这一格：折损 ' + lost + ' → ' + p.loss);
          this.commit(node, opt, p, after);
        }
      })).concat([{ text: '谁也别顶，我们自己扛', kind: 'ghost', onClick: () => this.commit(node, opt, p, after) }])
    });
  },

  carve(nm) {
    const s = Store.s;
    if (nm && s.board.names.indexOf(nm) < 0) s.board.names.push(nm);
  },

  finishChoice(node, opt, d) {
    const s = Store.s;
    const addItem = (id) => { if (ITEMS[id] && s.items.indexOf(id) < 0) s.items.push(id); };
    (opt.gain || []).forEach(addItem);
    (node.gain || []).forEach(addItem);
    if (opt.reward === 'guide' || node.reward === 'guide') s.flags.guide = true;
    if (opt.outcomeCard && CARDS[opt.outcomeCard] && s.hand.indexOf(opt.outcomeCard) < 0) s.hand.push(opt.outcomeCard);
    if (opt.outcome) s.flags.lastText = opt.outcome; else s.flags.lastText = '';
    /* 中途收编：这一格救下来的人编进队伍，战友卡多一张（data.js 里用 recruit 指定） */
    const rid = opt.recruit;
    if (rid && COMRADES[rid] && s.comrades.indexOf(rid) < 0) {
      if (s.comrades.length < BALANCE.comradeCap) {
        s.comrades.push(rid);
        s.flags.lastNotes = (s.flags.lastNotes || []).concat([COMRADES[rid].name + '（' + COMRADES[rid].role + '）编进了队伍 — 战友卡多一张']);
      } else {
        s.flags.lastNotes = (s.flags.lastNotes || []).concat([COMRADES[rid].name + ' 留不下来：建制已经满编，他在原地养伤']);
      }
    }
    Store.save();
  },

  afterResolve(node, opt) {
    const s = Store.s;
    const first = !s.done[node.id];
    s.done[node.id] = true;
    if (node.carve) {
      if (node.carve.place && s.board.places.indexOf(node.carve.place) < 0) s.board.places.push(node.carve.place);
      (node.carve.names || []).forEach(nm => this.carve(nm));
      if (node.carve.blank) s.board.blanks += node.carve.blank;
    }
    (node.gainCards || []).forEach(id => { if (CARDS[id] && s.hand.indexOf(id) < 0) s.hand.push(id); });
    /* 大关卡第一次打下来才有缴获与休整：主走廊 42 格的固定支出靠这一段回补。
       粮／时／兵三样只能带一样 —— 这是四条资源之间唯一一次真正的交换。 */
    if (first && node.kind === 'gate') { Memory.receipt(); this.gateSpoils(node); return; }
    this.postChoice(node);
  },

  gateSpoils(node) {
    const g = BALANCE.gateSpoils, s = Store.s;
    let picked = false;
    const take = (want, label) => {
      if (picked) return true;
      picked = true;
      const before = { men: s.men, food: s.food, window: s.window, trust: s.trust };
      this.apply(want);
      const real = {};
      Object.keys(want).forEach(k => { const v = s[k] - before[k]; if (v) real[k] = v; });
      const txt = ['men', 'food', 'window', 'trust'].filter(k => real[k])
        .map(k => RES[k].label + ' +' + real[k]).join(' · ');
      s.flags.lastNotes = (s.flags.lastNotes || []).concat([
        label + '：' + (txt || '这一样已经到了上限，什么也没多出来')
      ]);
      const ld = s.flags.lastDelta || { men: 0, food: 0, window: 0, trust: 0 };
      Object.keys(real).forEach(k => { ld[k] = (ld[k] || 0) + real[k]; });
      s.flags.lastDelta = ld;
      Hud.flash(real); Store.save();
      Router.closeAll();
      this.postChoice(node);
      return true;
    };
    Router.open({
      title: '缴获与休整', kicker: node.name + ' · 三样只能带一样', size: 'mid', blocking: true, closable: false,
      html: `<p class="lead">打下来这一处，院子里堆着缴获，队伍也争到半天空当。可带走的只够一样。</p>
        <p class="note-hint">现在：兵 ${s.men} · 粮 ${s.food} · 时 ${s.window}</p>`,
      actions: [
        { text: `先把口粮运走（粮 +${g.food}）`, kind: 'primary', onClick: () => take({ food: g.food }, '缴获先紧着口粮') },
        { text: `连夜赶路，抢回时间（时 +${g.window}）`, kind: 'ghost', onClick: () => take({ window: g.window }, '连夜赶路，把追兵甩远') },
        { text: `就地整编掉队的人（兵 +${g.men}）`, kind: 'ghost', onClick: () => take({ men: g.men }, '就地整编') }
      ]
    });
  },

  /* 突发事件结算后：先收违纪的账，再进目的地 */
  afterMove(dest) {
    const s = Store.s;
    /* 突发事件的账先记下，到下一格的弹窗顶部再亮出来（选项上不标价） */
    s.flags.road = { text: this.resultText(), notes: (s.flags.lastNotes || []).slice(), delta: s.flags.lastDelta };
    Sin.tick();
    Store.save(); Hud.render(); MapView.render();
    if (Sin.shouldTrigger()) { s.flags.road = null; Sin.collect(NODE_BY_ID[s.at]); return; }
    if (s.men <= 0) { s.flags.road = null; Flow.nextCheng(NODE_BY_ID[s.at] || dest); return; }
    this.enter(dest);
  },

  postChoice(node) {
    const s = Store.s;
    Sin.tick();
    Store.save(); Hud.render(); MapView.render();
    /* 死线检查：违纪的账优先于作战失败 */
    if (Sin.shouldTrigger()) { Sin.collect(node); return; }
    if (s.men <= 0) { Flow.nextCheng(node); return; }
    if (node.kind === 'gate') this.showLore(node);
    else Router.open({
      title: node.name, kicker: '了结', size: 'mid',
      html: `<p class="lead">${esc(this.resultText())}</p>` +
        this.notesHtml() +
        this.deltaHtml() + this.loreLinks(node),
      actions: [{ text: '回到地图', kind: 'primary' }]
    });
  },

  resultText() {
    const f = Store.s.flags;
    if (f.lastText) return f.lastText;
    return f.lastChoiceLabel ? `你按下去的是：「${f.lastChoiceLabel}」。队伍按命令继续走。` : '队伍继续往前走。';
  },

  notesHtml(list) {
    const notes = (list || Store.s.flags.lastNotes || []).filter(Boolean);
    if (!notes.length) return '';
    return `<ul class="notelist">` + notes.map(n => `<li>${esc(n)}</li>`).join('') + `</ul>`;
  },

  showLore(node) {
    const s = Store.s;
    const ids = node.lore || [];
    const items = ids.map(id => HISTORY.find(h => h.id === id)).filter(Boolean);
    const html = `<p class="cg">${esc(this.resultText())}</p>` +
      this.notesHtml() +
      this.deltaHtml() +
      (items.length ? `<div class="lore-list">` + items.map(h => `
        <article class="lore" data-h="${esc(h.id)}">
          <div class="lore-top"><span class="grade g-${h.grade}">${h.grade}</span><h4>${esc(h.title)}</h4></div>
          <p class="lore-where">${esc(h.where || '')}</p>
          <p class="lore-t">${esc(h.text)}</p>
          <p class="lore-s">出处：${esc(h.src)}</p>
        </article>`).join('') + `</div>` : '') +
      (node.carve && (node.carve.names || []).length
        ? `<p class="carve">木牌上刻下了：${node.carve.names.map(esc).join('、')}</p>` : '') +
      (node.blanks ? '' : '') +
      (node.epilogue ? `<p class="quote">${esc(node.epilogue)}</p>` : '');
    Router.open({
      title: node.name, kicker: (node.date || '') + ' · 剧情翻面', size: 'wide', cinematic: true, blocking: true,
      art: node.art || (typeof GATE_ART !== 'undefined' ? GATE_ART[node.id] : null),
      motion: node.motion, closable: false,
      html: html + (node.epilogue ? '' : ''),
      actions: [{
        text: '把这一段的史料记进名册', kind: 'primary',
        onClick: () => { items.forEach(h => History.unlock(h.id)); if (node.epilogue) Toast.show('这一段也记下了'); }
      }]
    });
    items.forEach(h => History.unlock(h.id));
  },

  loreLinks(node) {
    const ids = node.lore || [];
    if (!ids.length) return '';
    return `<p class="lore-links">史料：<a data-link="history" data-hid="${esc(ids[0])}" href="#">${esc((HISTORY.find(h => h.id === ids[0]) || {}).title || '')}</a> 等 ${ids.length} 条</p>`;
  },

  /* 账只在按下之后亮出来：选项上不标价 */
  deltaHtml(d) {
    const s = Store.s;
    const x = d || s.flags.lastDelta || {};
    const txt = ['men', 'food', 'window', 'trust']
      .filter(k => x[k]).map(k => `${RES[k].label} ${x[k] > 0 ? '+' : ''}${x[k]}`).join(' · ');
    return `<p class="delta">这一格的账：${esc(txt || '没有资源的增减')}</p>
      <p class="costline">现在：兵 ${s.men} · 粮 ${s.food} · 时 ${s.window} · 民 ${s.trust}</p>`;
  },

  /* 行进途中那一段的结算，贴在下一格的弹窗顶部 */
  roadHtml() {
    const r = Store.s.flags.road;
    if (!r) return '';
    Store.s.flags.road = null;
    return `<div class="road-note"><span class="road-tag">路上</span>
      <p class="lead">${esc(r.text)}</p>${this.notesHtml(r.notes)}${this.deltaHtml(r.delta)}</div>`;
  },

  /* 民心换口粮：真断粮了（粮=0）才接济，一局最多三次 — 再多就等于民心能当饭吃 */
  charityTop() {
    const s = Store.s, c = BALANCE.charity;
    if (s.food > 0 || s.trust < c.trust) return false;
    const n = s.flags.charityCount || 0;
    if (n >= c.max) return false;
    s.food = clamp(s.food + c.food, 0, RES.food.max);
    s.flags.charityCount = n + 1;
    Toast.show('百姓把粮分出来 — 民心换回 ' + c.food + ' 天口粮（第 ' + (n + 1) + '/' + c.max + ' 次）');
    return true;
  },

  apply(d) {
    const s = Store.s;
    if (!d) return;
    if (d.men) s.men = clamp(s.men + d.men, 0, s.menCap);
    if (d.food) s.food = clamp(s.food + d.food, 0, RES.food.max);
    if (d.window) s.window = clamp(s.window + d.window, 0, RES.window.max);
    if (d.trust) s.trust = clamp(s.trust + d.trust, 0, RES.trust.max);
    Store.save();
  }
};

/* ---------- Sin：多行不义必自毙 ---------- */
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
    Router.open({
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
    Router.open({
      title: '下一程', kicker: '不写 Game Over', size: 'mid', cinematic: true, closable: false, blocking: true, art: 'cg-18',
      html: `<p class="cg big">天亮时，收容队把你架了起来。有人把干粮塞进你手里，说：队伍还在走，你也接着走。</p>
        <p class="cg">红军当年真有收容队：走在最后，专门收掉队的人，团后卫之后再派坚强的收容队。掉队不等于失败，被接住就是接着打。</p>
        <p class="costline">本程木牌已挂上名单墙：${s.board.names.length} 个名字 · 行至 ${esc(node.name)}</p>`,
      actions: [{ text: '接住下一支队伍', kind: 'primary', onClick: () => this.revive(false) }]
    });
  },
  warnEnd(type, node) {
    const s = Store.s;
    if (s.runsFailed + s.runsWarn >= BALANCE.fallLimit - 1) { Ending.fall(node || NODE_BY_ID[s.at], 'warn', type); return; }
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
    Router.closeAll();
    MapView.recenter(); Hud.render();
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
    Router.closeAll();
    MapView.recenter(); Hud.render();
    Toast.show('新的部队在原地接上了你 — 木牌上的名字不清零');
  },
  boardSnapshot(tag) {
    const s = Store.s;
    return { tag, when: new Date().toLocaleString(), run: s.run, places: s.board.places.slice(), names: s.board.names.slice(), blanks: s.board.blanks };
  }
};

/* ---------- History：史料页 ---------- */
const History = {
  unlock(id) {
    if (!id) return;
    if (Store.meta.unlocked.indexOf(id) < 0) {
      Store.meta.unlocked.push(id);
      if (Store.s.historyRead.indexOf(id) < 0) Store.s.historyRead.push(id);
      Store.save();
    }
  }
};

/* ---------- Pages：链接式页面（全部走弹窗） ---------- */

const Pages = {

  /* 出发前的 30 秒须知；地图上的朱红章子可以重新打开 */
  notes(after) {
    const first = !Store.s.flags.sawNotes;
    Router.open({
      title: '玩家须知', kicker: first ? '出发前读这一页 · 约 30 秒' : '玩家须知', size: 'wide',
      onClose: () => {
        Store.s.flags.sawNotes = true; Store.save();
        if (after) setTimeout(after, 120);
        else Toast.show('亮红圈、写着「▸ 下一站」的那一格 —— 点它就走');
      },
      html: `
      <h3>这一局你要做什么</h3>
      <p class="lead">从于都河走到吴起镇。地图上一格一格往北推，<b>每走一格就是一次抉择</b>。走到终点时，你带出来的人和没带出来的人，都记在那块空白杉木牌上。</p>
      <h3>只要记住三件事</h3>
      <ul>
        <li><b>找红圈</b>：套着<b>呼吸红圈</b>、头顶写着「<b>▸ 下一站</b>」的那一格，就是眼下能走的地方 —— 点它即行军。屏幕边上亮起<b>红箭头</b>时，说明下一站在视野外，点箭头也照样过去。</li>
        <li><b>盯右上角</b>：<b>兵 · 粮 · 时 · 民</b> 四条是你全部的判断依据。粮和时每走一格各 <b>-1</b>；哪个归零，那一格就开始死人，兵归零这一程打完。</li>
        <li><b>代价按下去才看得见</b>：选项上故意不标价。按完之后<b>不跳转</b> —— 选了的和没选的那几条，会在各自下面同时亮起增减，原地停几秒给你看，那就是这一格的真实账。</li>
      </ul>
      <h3>别的不做也能玩，但会更快</h3>
      <ul>
        <li>底部「<b>手法卡</b>」能在抉择里附一张卡减折损，一局一张；「<b>身边人</b>」是被动，替你挡一次作战或冻饿的判定 —— 挡不住违纪的账。</li>
        <li>拖地图：按住拖动（从格子上按住也能拖），滚轮缩放，<kbd>Tab</kbd> 或点「远望全图」看整条路线。触屏：单指拖、双指捏合缩放。</li>
        <li>大关卡打下来会有一次<b>缴获与休整</b>：<b>粮 / 时 / 兵三样只能带一样</b>，由你在当场选；同时把英雄之名刻上木牌、解锁一条史料。</li>
      </ul>
      <h3>卡住了怎么办</h3>
      <ul>
        <li>点了没反应 → 只能走到与脚下<b>相连</b>的格子；不相邻的会提示，云里的先看不见。</li>
        <li>忘了规则 → 顶栏「<b>功能</b>」菜单里的「<b>规则手册</b>」写得很细；想一次看全全部玩法，点顶栏「<b>新手指南</b>」。这页也能随时重看：地图左下角那颗<b>朱红「须知」章</b>。</li>
      </ul>
      <p class="note-hint">部队打散<b>不是 Game Over</b>：收容队会把你接住，下一程接着走，木牌上的名字不清零。违纪也不立刻结算 —— 「多行不义必自毙」，那笔账延迟两三格才到，而那时你正好需要带路的人。</p>`,
      actions: [{ text: after ? '出发' : '回到地图', kind: 'primary' }]
    });
  },

  help() {
    Router.open({
      title: '操作与规则', kicker: '手册', size: 'wide',
      html: `
      <h3>怎么玩</h3>
      <ul>
        <li>在地图上<b>按住拖动</b>可以推地图（从节点上按住也能拖），滚轮缩放，按 <kbd>F</kbd> 或点左下「远望全图」看整条路线；视野外是阴云与飞雪。<b>触屏</b>：单指拖、<b>双指捏合缩放</b>（捏合时两指中点往哪走，地图就往哪推），格子的命中圈在触屏上会自动放大。</li>
        <li>红圈呼吸的地方写着<b>你在这里</b>。套着<b>淡红虚线圈</b>的格子是这一步能踩的去向；其中<b>转着朱红圈、头顶写「▸ 下一站」</b>的那一格是主推的去向（大关卡优先）。三种点法都行：<b>点格子</b>、点地图左下角的<b>「下一站」药丸</b>、按<b>空格</b>；下一站跑出视野时，屏幕边上会亮起<b>红箭头</b>，点箭头同样过去。不相邻的点不动。</li>
        <li>事件分三档：<b>明</b>（图标写清类型，可预判）、<b>暗</b>（只显示 ?，走到才弹窗）、<b>动</b>（行进途中随机触发，10 类：敌袭、埋伏、老乡问路、疫病、逃兵、涨水、收容队、担架、断水、驮马）。同一类有好几种说法，<b>出没读过的先出</b>；一类一局最多两次，也不会跟上一格连着重复；刚出过事，下一格的概率还会压低。</li>
        <li>选项<b>不标价</b>：先按你的判断按下去。按完之后<b>不跳转</b> —— 选了的和没选的那几条，各自下面亮起资源增减，原地停几秒给你看（点任意处提前继续），再进结算。追兵翻倍、断粮饿倒、民族地区多绕的路，这些实际落账要下一页才对得上。</li>
        <li>大关卡通关后进入剧情翻面，英雄之名<b>刻上木牌</b>，同时解锁史料词条。</li>
      </ul>
      <h3>四条资源</h3>
      <ul>
        <li><b>兵</b>：建制完整度，归零即“下一程”。不能直接买回来——整补要时间、要民心。</li>
        <li><b>粮</b>：可撑天份。每走一格 -1；<b>归零那一格多饿倒 ${BALANCE.hungerLoss} 支</b>。大关卡打下来可以<b>把缴获先紧着口粮（粮 +${BALANCE.gateSpoils.food}）</b>—— 粮、时、兵三样只能带一样；真断了粮而<b>民 ≥${BALANCE.charity.trust}</b>，沿途百姓接济 ${BALANCE.charity.food} 天，一局最多 ${BALANCE.charity.max} 次。</li>
        <li><b>时</b>：追兵窗口。每走一格 -1；归零只<b>压成一格</b> —— 那一格折损翻倍、多半打一场遭遇战，打完甩开尾巴挣回 <b>时 +${BALANCE.pursuitGrace}</b>。大关卡也可以选择<b>连夜赶路，时 +${BALANCE.gateSpoils.window}</b>。</li>
        <li><b>民</b>：沿途人心。低于 20 时，彝海、崔古仓、草地筹粮的向导与借粮选项<b>全部锁死</b>，视野骤缩；高于 ${BALANCE.charity.trust} 时，断粮那格百姓肯分粮。</li>
      </ul>
      <h3>民心的账是延迟的</h3>
      <p class="note-hint">抢粮当场不掉民。掉下去的数在两三个事件之后才收——那时你正需要带路的人。</p>
      <h3>战友卡</h3>
      <ul>
        <li>开局四个人：小谢、老范、三伢子、老钱。硬仗格子里有人会自动往前站一步，替你挡一次折损（每人最多顶 ${BALANCE.mateSave} 支；只挡作战与冻饿，<b>挡不住违纪的账</b>）。</li>
        <li>会救人的那几格 —— <b>湘江脚山铺</b>、<b>大渡河西岸</b>、<b>草地班佑河</b> —— 把活下来的人<b>编进队伍</b>，战友卡多一张。一局同时在队最多 ${BALANCE.comradeCap} 人，满了只能说「他在原地养伤」。</li>
      </ul>
      <h3>两种结局页</h3>
      <ul>
        <li><b>下一程</b>：作战、冻饿、掉队。收容队把你接回去，宽慰与鼓励，木牌挂<b>正名区</b>。</li>
        <li><b>多行不义必自毙</b>：违纪选项可以选、当场有甜头；标记累积到 3，一到三个事件内必收账，不可回避、战友卡挡不住。木牌挂<b>警示区</b>。</li>
      </ul>
      <p class="src">本游戏史实分级 A（权威记载）/ R（回忆转述）/ ?（待核实）。地图为路线示意图，省界非精确边界。</p>`,
      actions: [{ text: '知道了', kind: 'primary' }]
    });
  },


  /* 战友记忆页：把结构化事实摊开给玩家看，就是「AI NPC 有记忆」的证据 */
  memory() {
    const s = Store.s;
    const list = (s.mem || []).slice().reverse();
    const html = list.length ? list.map((m, i) => `
      <div class="cell ${m.seen ? '' : 'fresh'}">
        <b>${esc(m.place || '路上')} · ${esc(MEM_KIND[m.kind] || m.kind)}</b>
        <p>${esc(m.what || '')}</p>
        <p class="dim" id="mem-line-${i}">${esc(Memory.template(m))}</p>
      </div>`).join('') : '<p class="dim">还没有发生过会被记住的事。</p>';
    Router.open({
      title: '战友记忆', kicker: '他们记得你做过什么', size: 'wide',
      html: `<p class="lead">记忆只记引擎里真实发生过的事。AI 只负责把措辞改成一句人话；越界、超时或断网，一律回模板。</p>
        <div class="grid">${html}</div>`,
      actions: [{ text: '关闭', kind: 'ghost' }]
    });
    /* 最新一条若有 AI 通道，异步改写措辞；失败/越界保持模板 */
    if (list.length) {
      Memory.refine(list[0]).then(t => {
        const el = document.getElementById('mem-line-0');
        if (el && t) el.textContent = t;
      }).catch(() => {});
    }
  },

  /* 存档码：复制出去、粘贴回来就能续上 */
  codePage() {
    const s = Store.s;
    const current = Store.exportCode() || '';
    const place = (NODE_BY_ID[s.at] || {}).name || '';
    Router.open({
      title: '存档码', kicker: '把这一程带走 · 换设备也能续', size: 'mid',
      html: `<p class="lead">复制下面这段码，回来粘贴，接着走。换设备、清了浏览器也能续上。</p>
        <p class="note-hint">当前：第 ${s.run} 程 · 行至 ${esc(place)} · 木牌 ${s.board.names.length} 个名字 · 馆藏 ${s.items.length}/${Object.keys(ITEMS).length}</p>
        <textarea id="code-box" class="code-box" spellcheck="false" rows="5">${esc(current)}</textarea>
        <p class="note-hint">只存本机浏览器状态，不含个人信息。名单墙带最近 6 块、日志带最近 20 条；载入会覆盖当前进度。</p>`,
      actions: [
        { text: '复制', kind: 'ghost', onClick: () => {
            const t = $('#code-box');
            if (t) { t.select(); try { document.execCommand('copy'); Toast.show('已复制存档码'); }
              catch (e) { Toast.show('请手动全选复制'); } }
            return true;
          } },
        { text: '载入这段码', kind: 'primary', onClick: () => {
            const v = ($('#code-box') || {}).value || '';
            if (Store.importCode(v)) {
              Router.closeAll(); MapView.recenter(); Hud.render();
              Toast.show('已载入，接着走');
            } else Toast.show('这段码读不出来，请检查是否复制完整');
            return true;
          } },
        { text: '关闭', kind: 'ghost' }
      ]
    });
  },

  cards() {
    const s = Store.s;
    const groupBy = {};
    s.hand.forEach(id => { const c = CARDS[id]; (groupBy[c.school] = groupBy[c.school] || []).push(c); });
    const html = Object.keys(groupBy).map(k => `
      <h3>${esc(k)}</h3><div class="grid">` + groupBy[k].map(c => `
        <div class="cell ${s.used.indexOf(c.id) >= 0 ? 'used' : ''}">
          <b>${esc(c.name)}</b><p>${esc(c.desc)}</p>
          ${CARD_FX[c.id] ? '' : '<p class="dim">本版仅叙事，未接入数值</p>'}
        </div>`).join('') + `</div>`).join('')
      /* S8 馆藏：看得见的收集度 + 未收集暗格（只写出处，不剧透内容） */
      + `<h3>馆藏 ${s.items.length}/${Object.keys(ITEMS).length}</h3><div class="grid">` +
        Object.keys(ITEMS).map(id => {
          const it = ITEMS[id], got = s.items.indexOf(id) >= 0;
          return got
            ? `<div class="cell item"><b>${esc(it.name)}</b><p>${esc(it.note)}</p><p class="lore-s">${esc(it.src)}</p></div>`
            : `<div class="cell item missing"><b>未收集</b><p class="lore-s">出处：${esc(String(it.src || '').slice(0, 40))}</p></div>`;
        }).join('') + `</div>`;
    Router.open({ title: '手法卡与道具', kicker: '你手上的东西', size: 'wide', html, actions: [{ text: '关闭', kind: 'ghost' }] });
  },

  cardDetail(id) {
    const c = CARDS[id]; if (!c) return;
    Router.open({
      title: c.name, kicker: c.school + ' 流派', size: 'sm',
      html: `<p class="lead">${esc(c.desc)}</p>` +
        (Store.s.used.indexOf(id) >= 0 ? '<p class="dim">本程已用过。</p>' : '<p class="dim">在事件弹窗里点选一张附在决定上。</p>'),
      actions: [{ text: '好', kind: 'ghost' }]
    });
  },

  comradeDetail(id) {
    const m = COMRADES[id]; if (!m) return;
    Router.open({
      title: m.name, kicker: m.role + ' · ' + m.from, size: 'sm',
      html: `<p class="lead">${esc(m.note)}</p>${m.proto ? `<p class="lore-s">${esc(m.proto)}</p>` : ''}
        <p class="dim">战友卡被动生效：替你挡一次作战或冻饿的判定；挡不住违纪的账。</p>`,
      actions: [{ text: '好', kind: 'ghost' }]
    });
  },

  board() {
    const s = Store.s;
    Router.open({
      title: '木牌', kicker: '第 ' + s.run + ' 程 · 局内', size: 'mid',
      html: `<div class="wood">
          <div class="wood-head"><span class="knot"></span><span>出发时空白，一路刻成名单</span></div>
          <div class="wood-places">${s.board.places.map(p => `<i>${esc(p)}</i>`).join('') || '<i class="dim">还没刻下地名</i>'}</div>
          <div class="wood-names">${s.board.names.map(n => `<b>${esc(n)}</b>`).join('') || '<i class="dim">还没有刻下名字</i>'}</div>
          ${s.board.blanks ? `<div class="wood-blanks">${'<span class="blank"></span>'.repeat(Math.min(10, s.board.blanks))}<i>泸定桥还差 ${s.board.blanks} 个名字没找到</i></div>` : ''}
        </div>
        <p class="note-hint">牌上名字：${s.board.names.length} 个 · 身边战友 ${s.comrades.length} 人</p>`,
      actions: [
        { text: '看名单墙', kind: 'ghost', onClick: () => { this.wall(); return true; } },
        { text: '关闭', kind: 'primary' }
      ]
    });
  },

  wall() {
    const m = Store.meta;
    const cell = (w, warn) => `
      <div class="wall-card ${warn ? 'warn' : ''}">
        <div class="wc-top"><b>第 ${w.run} 程</b><span>${esc(w.tag)}</span><i>${esc(w.when)}</i></div>
        <div class="wc-places">${w.places.map(p => `<i>${esc(p)}</i>`).join('')}</div>
        <div class="wc-names">${w.names.length ? w.names.map(n => `<b>${esc(n)}</b>`).join('') : '<i class="dim">（没刻下名字）</i>'}</div>
        ${w.blanks ? `<div class="wc-blanks">留白 ${w.blanks} 格</div>` : ''}
      </div>`;
    Router.open({
      title: '名单墙', kicker: '重开的动机不是赢，是让更多人被人记住', size: 'wide',
      html: `<h3>正名区 · ${m.wall.length} 块</h3>${m.wall.map(w => cell(w, false)).join('') || '<p class="dim">还没有挂上木牌。</p>'}
        <h3 class="warn-title">警示区 · ${m.warnWall.length} 块</h3>
        <p class="note-hint">此处记的是走错的路，不是走错的人。</p>
        ${m.warnWall.map(w => cell(w, true)).join('') || '<p class="dim">还没有。愿你一直不用看见这里。</p>'}`,
      actions: [{ text: '关闭', kind: 'ghost' }]
    });
  },

  history(presetId) {
    const m = Store.meta;
    const list = HISTORY.map(h => {
      const on = m.unlocked.indexOf(h.id) >= 0;
      return `<article class="hist ${on ? 'on' : 'off'}" data-hid="${esc(h.id)}">
        <div class="hist-top"><span class="grade g-${h.grade}">${h.grade}</span>
          <b>${on ? esc(h.title) : '未解锁的史料'}</b><i>${esc(h.where || '')}</i></div>
        ${on ? `<p>${esc(h.text)}</p><p class="lore-s">出处：${esc(h.src)}</p>`
             : `<p class="dim">走到对应的路段、或把这一格打赢，这段才会出现在这里。</p>`}
      </article>`;
    }).join('');
    const close = Router.open({
      title: '史料与出处', kicker: `已解锁 ${m.unlocked.length} / ${HISTORY.length} 条`, size: 'wide',
      html: `<div class="hist-wrap">
        <nav class="hist-index">${HISTORY.map(h => `<a data-jump="${esc(h.id)}" class="${m.unlocked.indexOf(h.id) >= 0 ? '' : 'off'}">${esc(h.title.slice(0, 12))}</a>`).join('')}</nav>
        <div class="hist-list">${list}</div></div>`,
      actions: [{ text: '关闭', kind: 'ghost' }]
    });
    const top = Router.stack[Router.stack.length - 1];
    if (top) top.el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-jump]');
      if (!a) return;
      const card = top.el.querySelector(`[data-hid="${a.dataset.jump}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    if (presetId) setTimeout(() => {
      const card = top && top.el.querySelector(`[data-hid="${presetId}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 260);
  },

  confirmReset() {
    Router.open({
      title: '清空存档？', size: 'sm',
      html: '<p class="lead">这会抹掉木牌、名单墙与已解锁的史料。真的要空出一块新牌吗？</p>',
      actions: [
        { text: '取消', kind: 'ghost' },
        { text: '确认清空', kind: 'warn', onClick: () => {
            try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(META_KEY); } catch (e) {}
            Store.load(); Router.closeAll(); MapView.recenter(); Hud.render();
            Toast.show('牌已擦净');
          } }
      ]
    });
  },
  intro() {
    Router.open({
      title: '长征：万水千山', kicker: '平面行军 · 第一程', size: 'wide', cinematic: true, closable: false, blocking: true, art: 'cg-01',
      html: `<p class="cg big">十月下旬，于都河上搭起浮桥。八万余人要在三个夜里渡完。</p>
        <p class="cg">你不是指挥全局的人，你是这支队伍的指挥员。你手里有一块空白杉木牌，用来记宿营地和伤亡名单。</p>
        <p class="cg dim">出发时同村三个：通信员小谢、警卫员老范、担架队长三伢子。走到终章时，只剩一个。</p>
        <p class="src">史实分级 A／R／? ；地图为路线示意图。数据与文案出处见「史料与出处」。</p>`,
      actions: [
        { text: '开始这一程', kind: 'primary', onClick: () => { setTimeout(() => Pages.notes(() => Game.enter(NODE_BY_ID['g1'])), 120); } },
        { text: '先看规则', kind: 'ghost', onClick: () => { setTimeout(() => Pages.help(), 120); return true; } }
      ]
    });
  }
};

/* ---------- Toast ---------- */
const Toast = {
  show(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(this._h);
    this._h = setTimeout(() => t.classList.remove('on'), 2600);
  }
};

/* ---------- Ending ---------- */
const Ending = {
  /* S7 木牌亲手刻字：划一下浮现一格；留白格永远不填满（泸定桥只找齐 12 个名字） */
  bindCarve() {
    const stage = $('#carve-stage'); if (!stage) return;
    const names = $$('.carve-name', stage);
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      names.forEach(n => n.classList.add('revealed')); return;
    }
    let i = 0;
    const reveal = () => { if (i < names.length) names[i++].classList.add('revealed'); };
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
        <div class="carve-board">${s.board.names.map(n => `<span class="carve-name">${esc(n)}</span>`).join('') ||
          '<span class="carve-blank">（空）</span>'}${'<span class="carve-blank"></span>'.repeat(Math.min(10, s.board.blanks))}</div>
        <p class="carve-hint">用鼠标或手指在牌面上划一下，名字逐格浮现。留白格不会填满 —— 泸定桥二十二个勇士，只找齐十二个名字。</p>
      </div>`;
    html += `<p class="cg dim" id="chronicle-line"></p>`;
    html += `<p class="costline">这一程走完：兵 ${s.men} · 粮 ${s.food} · 民 ${s.trust} · 木牌 ${s.board.names.length} 个名字 · 违纪标记 ${s.sin}</p>
      <p class="note-hint">红二十五军战斗员平均年龄不到十八岁。使他们过湘江、雪山、草地的，很多是孩子。</p>`;
    Router.open({
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
            Store.s = st; Store.save();
            Router.closeAll(); MapView.recenter(); Hud.render();
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
    Router.closeAll();
    Router.open({
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
          Store.s = st; Store.save();
          Router.closeAll(); MapView.recenter(); Hud.render();
          Toast.show('牌已挂上墙。要不要再走一次，走到吴起镇？');
          setTimeout(() => Pages.wall(), 300);
        }
      }]
    });
    setTimeout(() => Chronicle.install('chronicle-line', '白话'), 0);
  }
};

/* ---------- 启动 ---------- */
Game.debug = {
  Store, Router, Hud, MapView, Sin, Flow, Pages, Ending, History, Toast, Game, Sound, Share, Chronicle, Memory,
  NODE_BY_ID, EDGES, NODES, MOVE_EVENTS, CARDS, ITEMS, REGIONS, HISTORY, DISCIPLINE, ENEMIES, COMRADES,
  CARD_FX, ADJ, RES, BALANCE,
  /* 只想看某一条行进事件怎么写出来的时候用：Game.debug.event('mv_mule', 1)
     第二个下标 0 是事件正文，1..n 是 variants 里的第几条；不写就随机。 */
  event(id, vi) {
    const m = MOVE_EVENTS.find(x => x.id === id);
    if (!m) { Toast.show('没有这条事件：' + id); return null; }
    const v = vi == null ? null : (vi === 0 ? {} : m.variants[vi - 1]);
    if (vi != null && !v) { Toast.show('这条事件没有第 ' + vi + ' 个变体'); return null; }
    const s = Object.assign({}, m, v || {}, { options: (v && v.options) || m.options });
    Game.afterArrive(NODE_BY_ID[Store.s.at], s);
    return s;
  }
};
window.Game = Game;
window.addEventListener('DOMContentLoaded', () => Game.boot());
})();

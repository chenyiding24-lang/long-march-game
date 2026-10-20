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
  init:        { men: 100, food: 12, window: 7, trust: 40 },
  march:       { food: -1, window: -1 },   /* 每走一格的固定支出 */
  gateGain:    { food: 2, window: 2 },     /* 大关卡第一次打下来：缴获 + 休整 */
  hungerLoss:  3,                          /* 断粮那一格多折的建制 */
  pursuitGrace: 3,                         /* 时窗归零打完遭遇战，甩开尾巴挣回的天数 */
  eventP: 0.24, eventCooldownP: 0.10,      /* 行进突发事件：常态概率 / 上一格刚出过事的概率 */
  charity:     { trust: 70, food: 1, max: 3 }, /* 民心够高又真断了粮：沿途百姓接济，一局至多三次 */
  comradeCap:  6,                              /* 战友卡同时在队的上限：开局四人 + 中途收编 */
  mateSave:    4                               /* 一个战友一次最多替你挡下的建制数 */
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
      historyRead: [], flags: {}
    };
  },
  defaultMeta() {
    return { wall: [], warnWall: [], unlocked: [], lessons: {}, best: 0, plays: 0, wins: 0 };
  },
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      this.s = raw ? Object.assign(this.defaultState(), JSON.parse(raw)) : this.defaultState();
      if (!this.s.at || !NODE_BY_ID[this.s.at]) this.s.at = 'g1';
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

/* ---------- Router：弹窗栈（不用下拉菜单，全部链接 + 弹窗） ---------- */
const Router = {
  stack: [],
  open(opts) {
    /* opts: {title, html, actions:[{text, kind, onClick, hrefNote}], size, cinematic, onClose} */
    const wrap = document.createElement('div');
    wrap.className = 'modal-mask' + (opts.cinematic ? ' cinematic' : '');
    wrap.innerHTML = `
      <div class="modal ${opts.size || ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || '弹窗')}">
        <header class="modal-head">
          ${opts.kicker ? `<span class="kicker">${esc(opts.kicker)}</span>` : ''}
          <h2>${esc(opts.title || '')}</h2>
          ${opts.closable === false ? '' : '<button class="modal-x" data-x aria-label="关闭">✕</button>'}
        </header>
        <div class="modal-body">${opts.html || ''}</div>
        <footer class="modal-foot">${(opts.actions || []).map((a, i) =>
          `<button class="btn ${a.kind || 'ghost'}" data-act="${i}">${esc(a.text)}</button>`).join('')}</footer>
      </div>`;
    $('#modal-root').appendChild(wrap);
    document.body.classList.toggle('hud-hidden', !!opts.cinematic);
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => wrap.classList.add('show'));

    const entry = { el: wrap, opts };
    this.stack.push(entry);

    const close = () => {
      wrap.classList.remove('show');
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
    document.addEventListener('keydown', function onKey(ev) {
      if (ev.key === 'Escape' && opts.closable !== false) { close(); document.removeEventListener('keydown', onKey); }
    });
    return close;
  },
  closeAll() {
    /* 选项按下后有一段"原地亮账"的停留：窗口被整体关掉时先把这一步结清，不能让定时器悬空补刀 */
    const c = Game.activeCtx;
    if (c && c.settle && !c.done) { c.done = true; c.settle(); }
    [...this.stack].forEach(e => { e.el.remove(); }); this.stack = []; document.body.classList.remove('hud-hidden', 'modal-open');
  }
};

/* ---------- Hud：右上角四资源 ---------- */
const Hud = {
  build() {
    $('#hud').innerHTML = Object.values(RES).map(r => `
      <div class="res" data-res="${r.key}" title="${esc(r.desc)}">
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
    });
    $('#v-men').textContent = s.men;
    $('#v-board').textContent = s.board.names.length;
    $('#v-run').textContent = '第 ' + s.run + ' 程';
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
    let nl = '';
    NODES.forEach(n => {
      if (!this.visible(n)) return;
      const adj = (ADJ[s.at] || new Set()).has(n.id);
      const here = n.id === s.at;
      const done = !!s.done[n.id];
      const hidden = n.known === 'hidden' && !done;
      const cls = ['node', n.kind, here ? 'here' : '', adj ? 'reach' : '', done ? 'done' : '', hidden ? 'unknown' : ''].filter(Boolean).join(' ');
      const label = hidden ? '?' : n.name;
      nl += `<g class="${cls}" data-node="${n.id}" transform="translate(${n.x},${n.y})">
        <circle class="hit" r="34"/>
        ${n.kind === 'gate'
          ? `<g class="glyph gate-g"><path d="M0,-17 L15,0 L0,17 L-15,0 Z"/><circle r="5"/></g>`
          : `<g class="glyph ev-g"><circle r="12"/></g>`}
        <text class="n-label" y="40">${esc(label)}</text>
        ${n.kind === 'gate' && n.date ? `<text class="n-date" y="58">${esc(n.date)}</text>` : ''}
        ${hidden ? `<text class="n-hint" y="-26">?</text>` : ''}
        ${adj && !here ? `<text class="n-go" y="-30">${esc(this.hintOf(n, hidden))}</text>` : ''}
      </g>`;
    });
    this.nodeLayer.innerHTML = nl;

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
    /* 拖拽可以从任意处起手（包括节点上）：位移过阈值才真正进入拖动，
       否则就是一次点击 —— 这样按下节点不会被误判成拖动，拖完也不会吃掉下一次点击。 */
    vp.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
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
      if (e.key === 'Tab') { e.preventDefault(); this.setFar(!this.far); }
      if (e.key === '+' || e.key === '=') { this.s = clamp(this.s * 1.12, 0.12, 1); this.applyTransform(); }
      if (e.key === '-') { this.s = clamp(this.s * 0.89, 0.12, 1); this.applyTransform(); }
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

  boot() {
    Store.load();
    Hud.build();
    MapView.init();
    this.bindChrome();
    Hud.render();
    if (!Store.s.flags.seenIntro) { Store.s.flags.seenIntro = true; Store.save(); Pages.intro(); }
    else { Toast.show(MapView.coarse ? '单指拖动地图 · 双指捏合缩放 · 点击前方节点行军' : '拖动地图可移动视野 · 滚轮缩放 · 点击前方节点行军'); }
  },

  bindChrome() {
    $('#nav-board').addEventListener('click', () => Pages.board());
    $('#nav-wall').addEventListener('click', () => Pages.wall());
    $('#nav-history').addEventListener('click', () => Pages.history());
    $('#nav-cards').addEventListener('click', () => Pages.cards());
    $('#nav-help').addEventListener('click', () => Pages.help());
    $('#far-toggle').addEventListener('click', () => MapView.setFar(!MapView.far));
    $('#center-btn').addEventListener('click', () => MapView.goTo(NODE_BY_ID[Store.s.at]));
    $('#reset-btn').addEventListener('click', () => Pages.confirmReset());
    $('#hand-tray').addEventListener('click', (e) => {
      const c = e.target.closest('[data-card]'); if (!c) return;
      Pages.cardDetail(c.dataset.card);
    });
    $('#comrade-tray').addEventListener('click', (e) => {
      const c = e.target.closest('[data-comrade]'); if (!c) return;
      Pages.comradeDetail(c.dataset.comrade);
    });
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
      /* 追兵压顶：时窗归零只烧成一格 — 这一格代价翻倍、最多打一场遭遇战，然后甩开尾巴喘三天。
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
    if (node.sits) { this.sitLoop(node, () => this.openNode(node)); return; }
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
      title: '那块“大石头”', kicker: 'R · 据老红军回忆', size: 'mid', cinematic: true,
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
               <div class="lockbox"><b>选项已被锁死</b><p>${esc(node.requires.failText)}</p></div>`,
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
    const pool = MOVE_EVENTS.filter(m => {
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

  /* 同一条事件的几种说法：先出没见过的，都出过就随机重出 */
  pickVariant(m) {
    const f = Store.s.flags;
    const list = [{ title: m.title, text: m.text }].concat(m.variants || []);
    const used = f.mvVar || (f.mvVar = {});
    const fresh = list.map((v, i) => i).filter(i => !used[m.id + '#' + i]);
    const i = fresh.length ? fresh[Math.floor(Math.random() * fresh.length)] : Math.floor(Math.random() * list.length);
    used[m.id + '#' + i] = 1;
    return Object.assign({}, m, { title: list[i].title, text: list[i].text });
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
    /* 大关卡第一次打下来才有缴获与休整：主走廊 42 格的固定支出靠这一段回补 */
    if (first && node.kind === 'gate') {
      const g = BALANCE.gateGain;
      this.apply({ food: g.food, window: g.window });
      s.flags.lastNotes = (s.flags.lastNotes || []).concat(['拿下这一处，缴获与休整：粮 +' + g.food + ' · 时 +' + g.window]);
      const ld = s.flags.lastDelta || { men: 0, food: 0, window: 0, trust: 0 };
      ld.food = (ld.food || 0) + g.food; ld.window = (ld.window || 0) + g.window;
      s.flags.lastDelta = ld;
      Hud.flash({ food: g.food, window: g.window });
    }
    this.postChoice(node);
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
      closable: false,
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
    Router.open({
      title: '多行不义必自毙', kicker: '警示 · ' + scene.title, size: 'wide', cinematic: true, blocking: true, closable: false,
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
          <h4>⑤ 再走一次</h4>
          <p class="invite">从你还没走错的那一步开始。下一次你路过同样的路口，按钮上会多一行小字。</p>
        </div>`,
      actions: [{ text: '记下这一页', kind: 'warn', onClick: () => { Flow.warnEnd(type); return true; } }]
    });
  }
};

/* ---------- Flow：下一程 / 警示重开 ---------- */
const Flow = {
  nextCheng(node) {
    const s = Store.s;
    Store.meta.wall.push(this.boardSnapshot('正常行军 · 部队打散'));
    Store.meta.plays += 1;
    Router.open({
      title: '下一程', kicker: '不写 Game Over', size: 'mid', cinematic: true, closable: false, blocking: true,
      html: `<p class="cg big">天亮时，收容队把你架了起来。有人把干粮塞进你手里，说：队伍还在走，你也接着走。</p>
        <p class="cg">红军当年真有收容队：走在最后，专门收掉队的人，团后卫之后再派坚强的收容队。掉队不等于失败，被接住就是接着打。</p>
        <p class="costline">本程木牌已挂上名单墙：${s.board.names.length} 个名字 · 行至 ${esc(node.name)}</p>`,
      actions: [{ text: '接住下一支队伍', kind: 'primary', onClick: () => this.revive(false) }]
    });
  },
  warnEnd(type) {
    const s = Store.s;
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

  help() {
    Router.open({
      title: '操作与规则', kicker: '手册', size: 'wide',
      html: `
      <h3>怎么玩</h3>
      <ul>
        <li>在地图上<b>按住拖动</b>可以推地图（从节点上按住也能拖），滚轮缩放，按 <kbd>Tab</kbd> 或点右上「远望全图」看整条路线；视野外是阴云与飞雪。<b>触屏</b>：单指拖、<b>双指捏合缩放</b>（捏合时两指中点往哪走，地图就往哪推），格子的命中圈在触屏上会自动放大。</li>
        <li>红圈呼吸的地方写着<b>你在这里</b>；套着<b>淡红虚线圈</b>的格子就是这一步能踩的去向，点它即<b>行军</b>，每走一格：粮 -1、时 -1。不相邻的点不动。</li>
        <li>事件分三档：<b>明</b>（图标写清类型，可预判）、<b>暗</b>（只显示 ?，走到才弹窗）、<b>动</b>（行进途中随机触发，10 类：敌袭、埋伏、老乡问路、疫病、逃兵、涨水、收容队、担架、断水、驮马）。同一类有好几种说法，<b>出没读过的先出</b>；一类一局最多两次，也不会跟上一格连着重复；刚出过事，下一格的概率还会压低。</li>
        <li>选项<b>不标价</b>：先按你的判断按下去。按完之后<b>不跳转</b> —— 选了的和没选的那几条，各自下面亮起资源增减，原地停几秒给你看（点任意处提前继续），再进结算。追兵翻倍、断粮饿倒、民族地区多绕的路，这些实际落账要下一页才对得上。</li>
        <li>大关卡通关后进入剧情翻面，英雄之名<b>刻上木牌</b>，同时解锁史料词条。</li>
      </ul>
      <h3>四条资源</h3>
      <ul>
        <li><b>兵</b>：建制完整度，归零即“下一程”。不能直接买回来——整补要时间、要民心。</li>
        <li><b>粮</b>：可撑天份。每走一格 -1；<b>归零那一格多饿倒 ${BALANCE.hungerLoss} 支</b>。打下一个大关卡缴获回补 <b>粮 +${BALANCE.gateGain.food}</b>；真断了粮而<b>民 ≥${BALANCE.charity.trust}</b>，沿途百姓接济 ${BALANCE.charity.food} 天，一局最多 ${BALANCE.charity.max} 次。</li>
        <li><b>时</b>：追兵窗口。每走一格 -1；归零只<b>压成一格</b> —— 那一格折损翻倍、多半打一场遭遇战，打完甩开尾巴挣回 <b>时 +${BALANCE.pursuitGrace}</b>。大关卡打完再回补 <b>时 +${BALANCE.gateGain.window}</b>。</li>
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
      <p class="src">本作品为思政实践作业，史实分级 A（权威记载）/ R（回忆转述）/ ?（待核实）。地图为路线示意图，省界非精确边界。</p>`,
      actions: [{ text: '知道了', kind: 'primary' }]
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
      + `<h3>道具</h3><div class="grid">` + (s.items.length ? s.items.map(id => `
        <div class="cell item"><b>${esc(ITEMS[id].name)}</b><p>${esc(ITEMS[id].note)}</p><p class="lore-s">${esc(ITEMS[id].src)}</p></div>`).join('')
        : '<p class="dim">还没有拿到道具。</p>') + `</div>`;
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
      title: '长征：万水千山', kicker: 'v1 初版', size: 'wide', cinematic: true, closable: false, blocking: true,
      html: `<p class="cg big">十月下旬，于都河上搭起浮桥。八万余人要在三个夜里渡完。</p>
        <p class="cg">你不是指挥全局的人，你是这支队伍的指挥员。你手里有一块空白杉木牌，用来记宿营地和伤亡名单。</p>
        <p class="cg dim">出发时同村三个：通信员小谢、警卫员老范、担架队长三伢子。走到终章时，只剩一个。</p>
        <p class="src">史实分级 A／R／? ；地图为路线示意图。数据与文案出处见「史料与出处」。</p>`,
      actions: [
        { text: '开始这一程', kind: 'primary', onClick: () => { setTimeout(() => Game.enter(NODE_BY_ID['g1']), 120); } },
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
      html += `<p class="cg">牌上还留着 ${s.board.blanks} 格空白。泸定桥二十二个勇士，只找齐十二个名字；写《十七个强渡的英雄》的人，把自己那一格空掉了。</p>`;
    }
    if (readRatio >= .5) {
      html += `<p class="cg">最后放上来的是物件：泸定桥的十三根铁索、半截皮带、黄花草标本、盖了苏维埃财政印章的借据、缝进百褶裙夹层的队旗。</p>`;
    }
    html += `<p class="costline">这一程走完：兵 ${s.men} · 粮 ${s.food} · 民 ${s.trust} · 木牌 ${s.board.names.length} 个名字 · 违纪标记 ${s.sin}</p>
      <p class="note-hint">红二十五军战斗员平均年龄不到十八岁。使他们过湘江、雪山、草地的，很多是孩子。</p>`;
    Router.open({
      title: '念名字', kicker: '终章 · 1935.10.19 吴起镇', size: 'wide', cinematic: true, closable: false, blocking: true,
      html,
      actions: [
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
  }
};

/* ---------- 启动 ---------- */
Game.debug = {
  Store, Router, Hud, MapView, Sin, Flow, Pages, Ending, History, Toast, Game,
  NODE_BY_ID, EDGES, NODES, MOVE_EVENTS, CARDS, ITEMS, REGIONS, HISTORY, DISCIPLINE, ENEMIES, COMRADES,
  CARD_FX, ADJ, RES, BALANCE
};
window.Game = Game;
window.addEventListener('DOMContentLoaded', () => Game.boot());
})();

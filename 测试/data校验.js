const fs=require('fs');
const src=fs.readFileSync(process.argv[2],'utf8');
const D=new Function(src+'\nreturn {REGIONS,PROVINCES,RIVERS,RANGES,TERRAIN_PATCHES,CARDS,COMRADES,ITEMS,HISTORY,DISCIPLINE,SIN_TEXT,NODES,EDGES,MOVE_EVENTS,ENEMIES};')();
const COST_KEYS=['men','food','window','trust'];
const LIST = process.argv.indexOf('--对账') >= 0;
const list = [];
const err=[], warn=[];
const hids=new Set(D.HISTORY.map(h=>h.id));
const cids=new Set(Object.values(D.CARDS).map(c=>c.id));
const iids=new Set(Object.values(D.ITEMS).map(i=>i.id));
const rids=new Set(Object.keys(D.REGIONS));
const nids=new Set(D.NODES.map(n=>n.id));
const coIds=new Set(Object.values(D.COMRADES).map(c=>c.id));

const cardGain={};
const mateGain={};
const optsOf=n=>(n.options||[]).concat(n.sinOption?[n.sinOption]:[]);
function checkOpts(owner, opts){
  opts.forEach((o,i)=>{
    if(!o.label) err.push(owner+' opt'+i+' 无 label');
    (o.gain||[]).forEach(id=>{ if(!iids.has(id)) err.push(owner+' gain 缺道具 '+id); });
    if(o.outcomeCard){ if(!cids.has(o.outcomeCard)) err.push(owner+' outcomeCard 缺 '+o.outcomeCard); (cardGain[o.outcomeCard]=cardGain[o.outcomeCard]||[]).push(owner+'(选项)'); }
    Object.keys(o.cost||{}).forEach(k=>{ if(COST_KEYS.indexOf(k)<0) err.push(owner+' cost 未知键 '+k); });
    if(o.sin && !D.DISCIPLINE[o.sin.type]) err.push(owner+' sin.type 缺 '+o.sin.type);
    if(!o.outcome) warn.push(owner+' opt'+i+'「'+(o.label||'')+'」无 outcome');
    if(o.recruit){ if(!coIds.has(o.recruit)) err.push(owner+' recruit 缺战友 '+o.recruit); mateGain[o.recruit]=mateGain[o.recruit]||[]; mateGain[o.recruit].push(owner); }
    if(o.comrades && o.comrades!=='save') err.push(owner+' comrades 只能是 save，实为 '+o.comrades);
    if(o.comrades==='save' && !o.recruit) warn.push(owner+' opt'+i+' 标了 comrades:save 却没有 recruit，救下的人进不了队伍');
  });
}
D.NODES.forEach(n=>{
  (n.lore||[]).forEach(id=>{ if(!hids.has(id)) err.push(n.id+' lore 缺 '+id); });
  if(n.region && !rids.has(n.region)) err.push(n.id+' region 缺 '+n.region);
  checkOpts(n.id, optsOf(n));
  (n.gainCards||[]).forEach(id=>{ if(!cids.has(id)) err.push(n.id+' gainCards 缺 '+id); cardGain[id]=cardGain[id]||[]; cardGain[id].push(n.id); });
  if(n.lockedUntil && !nids.has(n.lockedUntil)) err.push(n.id+' lockedUntil 缺 '+n.lockedUntil);
  if(typeof n.x!=='number' || typeof n.y!=='number') err.push(n.id+' 无坐标');
  if(n.type==='boss' && !n.carve) warn.push(n.id+' 大关卡无 carve');
  if(n.sits && n.kind!=='gate') warn.push(n.id+' 有 sits 但非大关卡');
});
D.EDGES.forEach(e=>{ if(!Array.isArray(e)||e.length!==2) { err.push('edge 结构 '+JSON.stringify(e)); return; }
  e.forEach(id=>{ if(!nids.has(id)) err.push('edge 缺节点 '+id); }); });
D.MOVE_EVENTS.forEach(m=>{ if(!m.title) err.push(m.id+' 无 title'); checkOpts(m.id, m.options||[]);
  /* 变体：自带 options 就用自带的，否则沿用事件级 options（game.js pickVariant 就是这个口径）。
     因此每一条 anch 都必须在「会用到这条选项的那一段正文」里出现，不然选项读起来就是没头没尾的。 */
  const carriers = [{ who:'正文', text:m.text, opts:m.options||[] }]
    .concat((m.variants||[]).map((v,i)=>({ who:'变体'+(i+1)+'「'+(v.title||'')+'」', text:v.text, opts:v.options||m.options||[] })));
  (m.variants||[]).forEach((v,i)=>{
    if(!v.title) err.push(m.id+' 变体'+(i+1)+' 无 title');
    if(!v.text) err.push(m.id+' 变体'+(i+1)+' 无 text');
    if(v.options) checkOpts(m.id+'#'+(i+1), v.options);
  });
  carriers.forEach(c=>{
    if(!c.text) { err.push(m.id+' '+c.who+' 无正文'); return; }
    c.opts.forEach((o,i)=>{
      (o.anch||[]).forEach(a=>{
        if(typeof a!=='string' || !a) { err.push(m.id+' opt'+i+' anch 有非法项'); return; }
        if(c.text.indexOf(a)<0) err.push(m.id+' '+c.who+' → 选项「'+(o.label||'')+'」的锚点「'+a+'」在正文里没有');
      });
      if(LIST && (o.anch||[]).length) list.push(m.id+' | '+c.who+' | '+o.label+' | 锚 '+o.anch.join(','));
    });
  });
  (m.lore||[]).forEach(id=>{ if(!hids.has(id)) err.push(m.id+' lore 缺 '+id); });
  (m.gainCards||[]).forEach(id=>{ if(!cids.has(id)) err.push(m.id+' gainCards 缺 '+id); cardGain[id]=cardGain[id]||[]; cardGain[id].push(m.id+'(移动事件)'); }); });
// 重复 id / 坐标
const seen={}, pseen={};
D.NODES.forEach(n=>{ if(seen[n.id]) err.push('重复 id '+n.id); seen[n.id]=1;
  const k=n.x+','+n.y; if(pseen[k]) err.push('重复坐标 '+k+'：'+pseen[k]+' / '+n.id); pseen[k]=n.id; });
// 可达性（从 g1 出发，沿 EDGES 无向）
const adj={}; D.NODES.forEach(n=>adj[n.id]=[]);
D.EDGES.forEach(([a,b])=>{ if(adj[a]&&adj[b]){adj[a].push(b);adj[b].push(a);} });
const q=['g1'],vis={g1:1}; while(q.length){const c=q.shift();(adj[c]||[]).forEach(x=>{if(!vis[x]){vis[x]=1;q.push(x);}});}
D.NODES.forEach(n=>{ if(!vis[n.id]) err.push('不可达 '+n.id); });
D.NODES.forEach(n=>{ if(!(adj[n.id]||[]).length) err.push('孤立 '+n.id); });
// 未被任何节点引用的卡 / 道具
Object.keys(D.CARDS).forEach(id=>{ if(!cardGain[id]) warn.push('卡 '+id+' 无发放途径'); });
const usedItems=new Set(); D.NODES.forEach(n=>{(n.gain||[]).forEach(g=>usedItems.add(g)); optsOf(n).forEach(o=>(o.gain||[]).forEach(g=>usedItems.add(g)));});
D.MOVE_EVENTS.forEach(m=>{ (m.options||[]).forEach(o=>(o.gain||[]).forEach(g=>usedItems.add(g)));
  (m.variants||[]).forEach(v=>(v.options||[]).forEach(o=>(o.gain||[]).forEach(g=>usedItems.add(g)))); });
/* 战友：开局四人写在 game.js 的 defaultState 里，其余必须有 recruit 途径 */
const START_MATES=['m_xiaoxie','m_laofan','m_sanya','m_qian'];
Object.keys(D.COMRADES).forEach(id=>{
  if(START_MATES.indexOf(id)>=0) return;
  if(!mateGain[id]) warn.push('战友 '+id+'（'+D.COMRADES[id].name+'）没有任何 recruit 途径 — 永远遇不到');
  else if(mateGain[id].length>1) warn.push('战友 '+id+' 被 '+mateGain[id].length+' 处 recruit：'+mateGain[id].join(' / '));
});
Object.keys(D.ITEMS).forEach(id=>{ if(!usedItems.has(id)) warn.push('道具 '+id+' 无人掉落'); });
// 史料是否都被用到
const usedLore=new Set(); D.NODES.forEach(n=>(n.lore||[]).forEach(l=>usedLore.add(l)));
D.MOVE_EVENTS.forEach(m=>(m.lore||[]).forEach(l=>usedLore.add(l)));
D.HISTORY.forEach(h=>{ if(!usedLore.has(h.id)) warn.push('史料 '+h.id+' 未被任何节点引用'); });
console.log('=== 错误 ===\n'+(err.length?err.join('\n'):'（无）'));
console.log('\n=== 提示 ===\n'+(warn.length?warn.join('\n'):'（无）'));
if(LIST) console.log('\n=== 行进事件 选项×正文 锚点对账 ===\n'+(list.join('\n')||'（无 anch）'));
console.log('\n节点 '+D.NODES.length+' / 边 '+D.EDGES.length+' / 移动事件 '+D.MOVE_EVENTS.length+' / 史料 '+D.HISTORY.length+' / 卡 '+Object.keys(D.CARDS).length+' / 道具 '+Object.keys(D.ITEMS).length);

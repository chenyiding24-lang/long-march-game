const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("游戏/route3d.html", "utf8");

// extract #map3d JSON
const m = html.match(/<script type="application\/json" id="map3d">([\s\S]*?)<\/script>/);
const MAP3D_JSON = m ? m[1] : "{}";

// permissive element proxy
function makeEl(id) {
  let clickCb = null;
  const styleProxy = new Proxy({}, {
    get: (t, p) => (p in t ? t[p] : ""),
    set: (t, p, v) => { t[p] = v; return true; }
  });
  const classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
  const target = {
    _id: id,
    style: styleProxy,
    classList,
    textContent: id === "map3d" ? MAP3D_JSON : "",
    innerHTML: "",
    value: "",
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    parentNode: null,
    addEventListener: (ev, cb) => { if (id === "enter" && ev === "click") clickCb = cb; },
    removeEventListener: () => {},
    appendChild: function(c){ return c; },
    removeChild: function(){},
    setAttribute: function(){}, getAttribute: function(){ return null; },
    removeAttribute: function(){},
    focus: function(){}, blur: function(){},
    querySelector: () => makeEl("q"),
    querySelectorAll: () => [],
    getContext: () => webglProxy(),
    toDataURL: () => "data:image/png;base64,",
    getBoundingClientRect: () => ({ left:0, top:0, width:800, height:600 }),
    __clickCb: () => clickCb
  };
  target.parentNode = target;
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      // unknown -> callable noop (avoids false TypeErrors on method calls)
      return function(){ return undefined; };
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

function webglProxy() {
  const consts = {};
  const handler = {
    get(t, p) {
      if (typeof p === "string" && /^[A-Z0-9_]+$/.test(p)) {
        if (!(p in consts)) consts[p] = Object.keys(consts).length + 1;
        return consts[p];            // GL constants -> number
      }
      // methods return a truthy number (handle) so upload()/compile logic proceeds
      return function(){ return 1; };
    }
  };
  return new Proxy(function(){}, handler);
}

const elCache = {};
const document = {
  getElementById: (id) => (elCache[id] || (elCache[id] = makeEl(id))),
  querySelector: (sel) => {
    const id = sel.replace(/^#/, "");
    return (elCache[id] || (elCache[id] = makeEl(id)));
  },
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => makeEl("created_" + tag),
  hidden: false,
  body: makeEl("body")
};

const sandbox = {};
sandbox.window = sandbox;
sandbox.document = document;
sandbox.console = console;
sandbox.performance = { now: () => Date.now() };
sandbox.requestAnimationFrame = () => 1; // do NOT invoke callback (avoid loop)
sandbox.cancelAnimationFrame = () => {};
sandbox.setTimeout = () => 0;
sandbox.clearTimeout = () => {};
sandbox.setInterval = () => 0;
sandbox.clearInterval = () => {};
sandbox.alert = () => {};
sandbox.Image = function(){ return makeEl("img"); };
sandbox.localStorage = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k,v)=>m.set(k,String(v)), removeItem: k=>m.delete(k) };
})();
sandbox.navigator = { userAgent: "node", platform: "node" };
sandbox.location = { href: "file:///route3d.html", search: "" };
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.JSON = JSON; sandbox.Math = Math; sandbox.Date = Date;
sandbox.Float32Array = Float32Array; sandbox.Uint16Array = Uint16Array;
sandbox.Uint8Array = Uint8Array; sandbox.Array = Array; sandbox.Object = Object;
sandbox.Proxy = Proxy; sandbox.Map = Map; sandbox.Set = Set;

vm.createContext(sandbox);

function NODES3D_STUB() {
  return [
    { id: "g1", name: "于都河夜渡", x: 1400, z: 4280, h: 10 },
    { id: "e_y1", name: "雁尾洲边的村子", x: 1290, z: 4230, h: 12 },
    { id: "h_w1", name: "汝城方向", x: 1090, z: 4090, h: 14 },
    { id: "g2", name: "湘江", x: 880, z: 3752, h: 8 },
    { id: "g12", name: "吴起镇", x: 920, z: 620, h: 20 }
  ];
}

function runScript(code, label) {
  try {
    vm.runInContext(code, sandbox, { filename: label });
    console.log("✅ " + label + " 加载无异常");
    return true;
  } catch (e) {
    console.log("❌ " + label + " 抛错: " + e.message);
    console.log("   " + (e.stack || "").split("\n").slice(0,4).join("\n   "));
    return false;
  }
}

// 1) inline scripts (in order) — skip application/json blocks (browser does not execute them)
const inlineMatches = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const inlineScripts = inlineMatches
  .filter(m => !/application\/json/.test(m[1]))
  .map(m => m[2]).filter(s => s.trim().length > 0);
console.log("inline script blocks (js):", inlineScripts.length);
let ok = true;
inlineScripts.forEach((s, i) => { if (!runScript(s, "inline#" + i)) ok = false; });

// 2) data.js then game3d.js
ok = runScript(fs.readFileSync("游戏/data.js","utf8"), "data.js") && ok;
ok = runScript(fs.readFileSync("游戏/game3d.js","utf8"), "game3d.js") && ok;

// 3) was #enter handler attached?
const enterEl = elCache["enter"];
const enterCb = enterEl && enterEl.__clickCb ? enterEl.__clickCb() : null;
console.log(enterCb ? "✅ #enter 点击处理器已挂载" : "❌ #enter 点击处理器未挂载（IIFE 在挂载前抛错）");

console.log("window.VoxelMap set:", !!sandbox.window.VoxelMap);
console.log("window.Game3D set:", !!sandbox.window.Game3D);

// 4) simulate clicking enter
if (enterCb) {
  try {
    enterCb();
    console.log("✅ 点击进入 3D：处理器执行无异常");
  } catch (e) {
    console.log("❌ 点击进入 3D 抛错: " + e.message);
    console.log("   " + (e.stack || "").split("\n").slice(0,6).join("\n   "));
  }
}

// 5) directly exercise Game3D.init + _tick (the gameplay layer) with the same stub VoxelMap
if (sandbox.window.Game3D && sandbox.window.VoxelMap) {
  try {
    sandbox.window.Game3D.setNodes(NODES3D_STUB());
    sandbox.window.Game3D.init(sandbox.window.VoxelMap);
    console.log("✅ Game3D.init 直接调用无异常");
  } catch (e) {
    console.log("❌ Game3D.init 抛错: " + e.message);
    console.log("   " + (e.stack || "").split("\n").slice(0,8).join("\n   "));
  }
  try {
    if (typeof sandbox.window.Game3D._tick === "function") {
      sandbox.window.Game3D._tick();
      console.log("✅ Game3D._tick 直接调用无异常");
    }
  } catch (e) {
    console.log("❌ Game3D._tick 抛错: " + e.message);
    console.log("   " + (e.stack || "").split("\n").slice(0,8).join("\n   "));
  }
}

console.log(ok ? "\n=== 加载整体：无明显异常 ===" : "\n=== 加载整体：存在异常 ===");

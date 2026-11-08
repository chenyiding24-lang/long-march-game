const fs = require("fs");

function decls(code) {
  const names = new Map();
  let depth = 0;
  let inS = false, inD = false, inT = false, inLC = false, inBC = false;
  const N = code.length;
  let k = 0;
  while (k < N) {
    const c = code[k], dn = code[k + 1];
    if (inLC) { if (c === "\n") inLC = false; k++; continue; }
    if (inBC) { if (c === "*" && dn === "/") { inBC = false; k += 2; continue; } k++; continue; }
    if (inS) { if (c === "\\") { k += 2; continue; } if (c === "'") inS = false; k++; continue; }
    if (inD) { if (c === "\\") { k += 2; continue; } if (c === '"') inD = false; k++; continue; }
    if (inT) { if (c === "\\") { k += 2; continue; } if (c === "`") inT = false; k++; continue; }
    if (c === "/" && dn === "/") { inLC = true; k += 2; continue; }
    if (c === "/" && dn === "*") { inBC = true; k += 2; continue; }
    if (c === "'") { inS = true; k++; continue; }
    if (c === '"') { inD = true; k++; continue; }
    if (c === "`") { inT = true; k++; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth === 0) {
      const m = /^\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(code.slice(k));
      if (m) names.set(m[1], (names.get(m[1]) || 0) + 1);
    }
    k++;
  }
  return names;
}

const read = (p) => fs.readFileSync(p, "utf8");
const html = read("游戏/route3d.html");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).filter(s => s.trim().length > 0);
console.log("inline script blocks in route3d.html:", scripts.length);
const inline = scripts.join("\n;\n");
const d = decls(read("游戏/data.js"));
const g = decls(read("游戏/game3d.js"));
const r = decls(inline);
console.log("route3d inline top-level decls:", [...r.keys()].length);
console.log("data.js top-level decls:", [...d.keys()].length);
console.log("game3d.js top-level decls:", [...g.keys()].length);

const inter = (a, b) => [...a.keys()].filter(x => b.has(x));
console.log("\n=== COLLISIONS route3d <-> data.js ===");
console.log(inter(r, d));
console.log("\n=== COLLISIONS route3d <-> game3d.js ===");
console.log(inter(r, g));
console.log("\n=== COLLISIONS data.js <-> game3d.js ===");
console.log(inter(d, g));

// also dump route3d decls for manual inspect
console.log("\n=== route3d inline decl names ===");
console.log([...r.keys()].sort().join(", "));

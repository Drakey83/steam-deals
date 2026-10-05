// Verify that every named import in the UI modules is actually exported by the file it points at.
// (ESLint checks names inside a file; a browser only finds a wrong import name when the page loads.)
//   node scripts/check-imports.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [join(root, "src", "renderer"), join(root, "web", "src")];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
}

const files = dirs.flatMap(walk);
const exportsOf = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const part of m[1].split(",")) {
    const name = part.trim().split(/\s+as\s+/).pop();
    if (name) names.add(name);
  }
  exportsOf.set(f, names);
}

let problems = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const target = resolve(dirname(f), m[2]);
    const names = exportsOf.get(target);
    if (!names) {
      console.log(`${relative(root, f)}: imports missing file ${m[2]}`);
      problems++;
      continue;
    }
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name && !names.has(name)) {
        console.log(`${relative(root, f)}: "${name}" is not exported by ${m[2]}`);
        problems++;
      }
    }
  }
}
console.log(problems ? `${problems} import problem(s)` : `imports ok (${files.length} modules)`);
process.exit(problems ? 1 : 0);

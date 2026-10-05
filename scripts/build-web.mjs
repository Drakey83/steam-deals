// Assemble the website (web/public) from the shared sources. No bundler: browsers load the ES modules directly.
//   src/renderer/**  (UI modules + styles)   -> web/public/          same UI as the desktop app
//   src/shared/core.js                        -> web/public/ and web/api/_lib/   shared scoring + taste logic
//   web/src/**       (page, browser API layer) -> web/public/
//   build/*.png      (icons)                   -> web/public/
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "web", "public");
rmSync(pub, { recursive: true, force: true });
mkdirSync(pub, { recursive: true });

const at = (...p) => join(root, ...p);
// Desktop-only files in src/renderer that the website replaces with its own.
const DESKTOP_ONLY = new Set(["index.html", "package.json"]);
cpSync(at("src", "renderer"), pub, { recursive: true, filter: (src) => !DESKTOP_ONLY.has(basename(src)) || dirname(src) !== at("src", "renderer") });
cpSync(at("web", "src"), pub, { recursive: true });
cpSync(at("src", "shared", "core.js"), join(pub, "core.js"));
cpSync(at("src", "shared", "core.js"), at("web", "api", "_lib", "core.js"));
for (const icon of ["icon.png", "icon-192.png", "icon-512.png", "icon-512-maskable.png", "apple-touch-icon.png"]) cpSync(at("build", icon), join(pub, icon));

// The website reports the same version as the desktop app it was built with.
const { version } = JSON.parse(readFileSync(at("package.json"), "utf8"));
const apiEntry = join(pub, "web-api.js");
const src = readFileSync(apiEntry, "utf8");
const stamped = src.replace(`const VERSION = "web";`, `const VERSION = "${version} · web";`);
if (stamped === src) throw new Error("build-web: version marker not found in web-api.js");
writeFileSync(apiEntry, stamped);

console.log(`web build ${version}: web/public assembled`);

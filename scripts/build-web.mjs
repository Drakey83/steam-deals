// Assemble the website from the shared sources:
//   src/renderer/{app.js,styles.css}  -> web/public/      (same UI as the desktop app)
//   src/shared/core.js                -> web/public/ and web/api/_lib/  (shared scoring + taste logic)
//   web/src/{index.html,web-api.js}   -> web/public/      (website shell + browser implementation)
//   build/icon.png                    -> web/public/icon.png
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "web", "public");
rmSync(pub, { recursive: true, force: true });
mkdirSync(pub, { recursive: true });

const copies = [
  ["src/renderer/app.js", "web/public/app.js"],
  ["src/renderer/styles.css", "web/public/styles.css"],
  ["src/shared/core.js", "web/public/core.js"],
  ["src/shared/core.js", "web/api/_lib/core.js"],
  ["web/src/index.html", "web/public/index.html"],
  ["web/src/web-api.js", "web/public/web-api.js"],
  ["web/src/manifest.webmanifest", "web/public/manifest.webmanifest"],
  ["web/src/app.html", "web/public/app.html"],
  ["build/icon.png", "web/public/icon.png"],
  ["build/icon-192.png", "web/public/icon-192.png"],
  ["build/icon-512.png", "web/public/icon-512.png"],
  ["build/icon-512-maskable.png", "web/public/icon-512-maskable.png"],
  ["build/apple-touch-icon.png", "web/public/apple-touch-icon.png"],
];
for (const [from, to] of copies) cpSync(join(root, from), join(root, to));
console.log(`web build: ${copies.length} files -> web/public, web/api/_lib`);

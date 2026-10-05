// Run the website locally with plain Node: no Vercel account needed.
//   npm run web:local            then open http://localhost:3000
// Serves web/public and runs the same web/api/* functions the hosted site uses.
// Optional: put STEAM_API_KEY=... and SESSION_SECRET=... (32+ chars) in a .env file at the repo root
// (or the environment) to enable "Sign in through Steam". Without them, the API-key and guest
// options still work.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT || 3000);

// Minimal .env loader (KEY=value lines).
const envFile = join(root, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

execFileSync(process.execPath, [join(root, "scripts", "build-web.mjs")], { stdio: "inherit" });
const pub = join(root, "web", "public");
const apiDir = join(root, "web", "api");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml" };
const CSP =
  "default-src 'self'; img-src 'self' https://*.steamstatic.com https://*.akamaihd.net data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const rel = normalize(url.pathname.slice(5)).replace(/^([/\\])+/, "");
      req.query = Object.fromEntries(url.searchParams);
      let file = join(apiDir, `${rel}.js`);
      // Like Vercel: a [param].js file answers any name in its folder, with the name in req.query.
      if (!existsSync(file)) {
        const dir = dirname(file);
        const dynamic = existsSync(dir) ? readdirSync(dir).find((n) => /^\[\w+\]\.js$/.test(n)) : null;
        if (dynamic) {
          req.query[dynamic.slice(1, -4)] = basename(file, ".js");
          file = join(dir, dynamic);
        }
      }
      if (!file.startsWith(apiDir) || rel.startsWith("_lib") || !existsSync(file)) {
        res.statusCode = 404;
        return res.end("Not found");
      }
      // Local requests are plain http; tell the sign-in code so its return URL matches.
      req.headers["x-forwarded-proto"] = "http";
      return await require(file)(req, res);
    }
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    let file = join(pub, path || "index.html");
    if (!file.startsWith(pub)) {
      res.statusCode = 403;
      return res.end();
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(pub, "index.html");
    res.setHeader("Content-Type", TYPES[extname(file)] || "application/octet-stream");
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("Cache-Control", "no-cache");
    res.end(readFileSync(file));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.statusCode = 500;
    res.end("Server error");
  }
});

server.listen(PORT, () => {
  const signIn = process.env.STEAM_API_KEY && (process.env.SESSION_SECRET || "").length >= 32;
  console.log(`\nSteam Deals (web) running at http://localhost:${PORT}`);
  console.log(signIn ? "Sign in through Steam: on" : "Sign in through Steam: off (add STEAM_API_KEY and SESSION_SECRET to .env to enable). API key and guest modes work.");
});

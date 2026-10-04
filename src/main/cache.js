// Tiny TTL cache: one JSON file per key under userData/cache. Keys are hashed to filenames.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function dir() {
  const d = path.join(app.getPath("userData"), "cache");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function fileFor(key) {
  const h = crypto.createHash("sha1").update(String(key)).digest("hex").slice(0, 24);
  return path.join(dir(), `${h}.json`);
}

/** Returns { value, age } if present and younger than maxAgeMs, else null. */
function get(key, maxAgeMs) {
  try {
    const raw = JSON.parse(fs.readFileSync(fileFor(key), "utf8"));
    const age = Date.now() - raw.savedAt;
    if (!Number.isFinite(age) || age > maxAgeMs) return null;
    return { value: raw.value, age, savedAt: raw.savedAt };
  } catch {
    return null;
  }
}

function set(key, value) {
  const target = fileFor(key);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), value }), "utf8");
  fs.renameSync(tmp, target);
}

function clear() {
  try {
    fs.rmSync(dir(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

module.exports = { get, set, clear };

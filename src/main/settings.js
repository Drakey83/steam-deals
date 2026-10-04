// Persistent user settings: a single JSON file in the app's userData folder.
// Written atomically (temp file + rename) so a crash mid-write never corrupts it.
const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = Object.freeze({
  country: null, // null = detect from OS locale on first run
  language: "english",
  minDiscount: 50,
  minRating: 80,
  minReviews: 0,
  scanDepth: 3000,
  weights: { discount: 40, rating: 35, popularity: 25 },
  hideOwned: true,
  wishlistOnly: false,
  sort: "score",
  selectedTags: [],
  account: null, // { steamid, name, avatar, method: 'steam' | 'apikey', signedInAt }
  apiKey: null,
  manualSteamId: null,
  windowBounds: null,
});

let cached = null;

function filePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function load() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(filePath(), "utf8");
    cached = deepMerge(DEFAULTS, JSON.parse(raw));
  } catch {
    cached = { ...DEFAULTS, weights: { ...DEFAULTS.weights }, selectedTags: [] };
  }
  if (!cached.country) {
    const cc = (app.getLocaleCountryCode && app.getLocaleCountryCode()) || "US";
    cached.country = /^[A-Z]{2}$/.test(cc) ? cc : "US";
  }
  return cached;
}

function save(next) {
  cached = next;
  const target = filePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, target);
  return cached;
}

function get() {
  return load();
}

function update(patch) {
  return save(deepMerge(load(), patch));
}

// Settings safe to hand to the renderer: never the API key itself, only whether one is set.
function publicView() {
  const s = load();
  const { apiKey, ...rest } = s;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

module.exports = { DEFAULTS, get, update, save, publicView };

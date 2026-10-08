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
  scanDepth: 10000, // 3000 | 10000 | 25000 most-popular items scanned
  catalog: "sale", // 'sale' = discounted games only | 'all' = whole catalog
  weights: { discount: 40, rating: 35, popularity: 25 },
  hideOwned: true,
  wishlistOnly: false,
  sort: "score",
  selectedTags: [],
  alerts: [], // price alerts (renderer/logic/alerts.js), newest first, capped
  behavior: [], // what the person did in the app: [{ type, appid, tags, at }], newest first, capped (renderer/logic/behavior.js)
  tasteTags: { added: [], removed: [] }, // tags put in / taken out of "Your taste" by hand (renderer/logic/taste.js)
  dismissed: [], // "Not interested": [{ appid, name, tags:[{id,w}], at }], newest first, capped (renderer/logic/dismiss.js)
  deckMachineOnly: false, // only games Valve rates Verified or Playable on Steam Deck or Steam Machine
  view: "foryou", // 'foryou' | 'all'
  personalWeight: 60, // 0–100: how much the For-you ranking favours taste match over raw deal score
  showTaste: true, // the "Your taste" panel above For-you results
  showTastePhone: false, // same panel on narrow screens: collapsed unless opened
  basket: [], // [{ appid, packageid, name, price, priceCents, originalCents, discount }]
  taxRegion: null, // null = not chosen yet (US/CA), "included", "none", "US-WA", "CA-ON", "custom"
  taxCustomRate: 0,
  taxRegionAuto: false, // true while the region came from location detection and hasn't been changed by hand
  pairId: null, // shared secret with the person's phone (website); baskets sent from it land here
  pairVia: null, // "account" when pairId is the Steam account's own channel (account-sync.js), else a code pairing
  pairAutoCart: true, // keep the Steam cart in step with the shared basket (adds and removals; never a purchase)
  basketRev: 0, // revision of the shared basket last seen on the relay
  alertsRev: 0, // revision of the website's price alerts last merged from the relay
  prefsRev: 0, // revision of the shared preferences last merged from the relay (src/shared/sharing.js)
  filtersAt: 0, // when the filters / view / sort / weights last changed (the newest change wins across devices)
  dismissRestored: [], // [{ appid, at }]: games taken off "Not interested", so other devices drop them too
  behaviorClearedAt: 0, // "Reset my recommendations": behaviour before this is forgotten on every device
  mirror: {}, // appid -> { packageid, lineItemId, addedAt }: cart lines this app put there, so only those are ever removed
  syncPaused: false,
  closeToTray: true, // the X button hides the app to the tray so syncing keeps running
  startWithWindows: false,
  startMinimized: false, // with Start with Windows: wait in the tray instead of opening maximized
  trayHintShown: false,
  account: null, // { steamid, name, avatar, method: 'steam' | 'apikey', signedInAt }
  apiKey: null,
  manualSteamId: null,
  windowBounds: null,
});

let cached = null;

function filePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

// Objects that are replaced as a whole rather than merged key by key.
const REPLACE_KEYS = new Set(["mirror", "account", "windowBounds", "tasteTags"]);

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!REPLACE_KEYS.has(k) && v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) {
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

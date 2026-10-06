// The visitor's settings, kept in this browser only. Also the visitor's own Steam Web API key, if they
// chose that sign-in, which is only ever sent on to Steam.
import { store } from "./store.js";

const SETTINGS_KEY = "sd:settings";
export const APIKEY_KEY = "sd:apikey";

const DEFAULTS = {
  country: null,
  language: "english",
  minDiscount: 50,
  minRating: 80,
  minReviews: 0,
  scanDepth: 10000,
  catalog: "sale",
  weights: { discount: 40, rating: 35, popularity: 25 },
  hideOwned: true,
  wishlistOnly: false,
  sort: "score",
  selectedTags: [],
  deckMachineOnly: false,
  dismissed: [],
  behavior: [],
  tasteTags: { added: [], removed: [] },
  alerts: [],
  view: "foryou",
  personalWeight: 60,
  showTaste: true,
  account: null,
};

/** Keys the UI may change (the same list the desktop app enforces). */
export const ALLOWED_SETTINGS = new Set([
  "country", "language", "minDiscount", "minRating", "minReviews", "scanDepth", "weights", "hideOwned",
  "wishlistOnly", "sort", "selectedTags", "view", "personalWeight", "catalog", "showTaste", "showTastePhone",
  "basket", "taxRegion", "taxCustomRate", "taxRegionAuto", "deckMachineOnly", "dismissed", "behavior", "alerts", "tasteTags",
]);

function guessCountry() {
  for (const l of navigator.languages || [navigator.language || "en-US"]) {
    const m = String(l).match(/-([A-Z]{2})$/i);
    if (m) return m[1].toUpperCase();
  }
  return "US";
}

function load() {
  const saved = store.get(SETTINGS_KEY, {}) || {};
  const s = { ...DEFAULTS, ...saved, weights: { ...DEFAULTS.weights, ...(saved.weights || {}) } };
  if (!s.country) s.country = guessCountry();
  return s;
}

/** The live settings object. Mutate it, then call saveSettings(). */
export const settings = load();
export const saveSettings = () => store.set(SETTINGS_KEY, settings);
export const publicSettings = () => ({ ...settings, hasApiKey: Boolean(store.get(APIKEY_KEY)) });

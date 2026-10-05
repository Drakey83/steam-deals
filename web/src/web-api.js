// Website implementation of the `window.steamDeals` interface the shared UI talks to.
// The desktop app provides the same interface from Electron (src/preload.js); here it is backed by the
// site's /api functions, with settings kept in this browser's localStorage. The pieces live in ./browser-api/.
import { cancelDeals, fetchDeals } from "./browser-api/deals.js";
import { device } from "./browser-api/device.js";
import { on } from "./browser-api/events.js";
import { ApiError, fail, http, wrap } from "./browser-api/http.js";
import { loadLibrary, setLibrary } from "./browser-api/library.js";
import { claim, pairId, pushBasket, syncNow, syncStatus, unpair } from "./browser-api/pairing.js";
import { ALLOWED_SETTINGS, APIKEY_KEY, publicSettings, saveSettings, settings } from "./browser-api/settings.js";
import { features, ready } from "./browser-api/startup.js";
import { store } from "./browser-api/store.js";
import { buildTaste } from "./browser-api/taste.js";

const VERSION = "web"; // replaced with "<version> · web" by scripts/build-web.mjs
const TAGS_TTL = 7 * 86400000;

const auth = {
  status: async () => ({ ok: true, account: settings.account, sessionValid: true }),
  signIn: async () => {
    if (!features.steamSignIn) return fail(new ApiError("Sign in through Steam isn't available on this site yet. Use your own API key instead.", "not_configured"));
    location.href = "/api/auth/login";
    return new Promise(() => {}); // the page navigates away
  },
  signOut: wrap(async () => {
    const wasSteam = settings.account?.method === "steam";
    settings.account = null;
    setLibrary(null);
    store.del(APIKEY_KEY);
    saveSettings();
    if (wasSteam) await http("/api/auth/logout", { method: "POST" }).catch(() => {});
    return { settings: publicSettings() };
  }),
  continueAsGuest: wrap(async () => {
    settings.account = { method: "guest", steamid: null, name: "Guest", avatar: null, signedInAt: Date.now() };
    saveSettings();
    return { account: settings.account };
  }),
  useApiKey: wrap(async ({ apiKey, steamIdOrVanity } = {}) => {
    const key = String(apiKey || "").trim();
    const data = await http("/api/owned", { method: "POST", body: { apiKey: key, account: steamIdOrVanity } });
    store.set(APIKEY_KEY, key);
    settings.account = { method: "apikey", steamid: data.steamid, name: data.name || "Steam user", avatar: data.avatar || null, signedInAt: Date.now() };
    const lib = setLibrary(data);
    saveSettings();
    return { account: settings.account, ownedCount: lib.games.length };
  }),
};

const library = {
  fetch: wrap(async ({ force = false } = {}) => {
    try {
      const lib = await loadLibrary(force);
      if (!lib) return { owned: [], wishlist: [], signedIn: false };
      if (lib.siteKeyInvalid) return { owned: [], wishlist: lib.wishlist, signedIn: false, siteKeyInvalid: true };
      return { owned: lib.games.map((g) => g.appid), wishlist: lib.wishlist, signedIn: lib.games.length > 0 || !lib.privateProfile, privateProfile: lib.privateProfile };
    } catch (err) {
      if (err.code === "signed_out") return { owned: [], wishlist: [], signedIn: false, sessionExpired: true };
      throw err;
    }
  }),
};

const tags = {
  fetch: wrap(async () => {
    const cacheKey = `sd:tags:${settings.language}`;
    const cached = store.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < TAGS_TTL) return { tags: cached.tags, fromCache: true };
    const r = await http(`/api/tags?l=${settings.language}`);
    store.set(cacheKey, { savedAt: Date.now(), tags: r.tags });
    return { tags: r.tags, fromCache: false };
  }),
};

window.steamDeals = {
  platform: "web",
  device: device(),
  features,
  ready,
  version: async () => ({ ok: true, value: VERSION }),

  settings: {
    get: async () => ({ ok: true, settings: publicSettings() }),
    update: async (patch) => {
      const prevBasket = settings.basket || [];
      for (const [k, v] of Object.entries(patch || {})) if (ALLOWED_SETTINGS.has(k)) settings[k] = v;
      saveSettings();
      if (patch && "basket" in patch && pairId()) pushBasket(prevBasket, settings.basket || []);
      return { ok: true, settings: publicSettings() };
    },
  },
  auth,
  library,
  deals: {
    fetch: wrap(fetchDeals),
    cancel: async () => {
      cancelDeals();
      return { ok: true, value: true };
    },
    onProgress: (cb) => on("progress", cb),
    onPartial: (cb) => on("partial", cb),
  },
  tags,
  taste: {
    build: wrap(buildTaste),
    onProgress: (cb) => on("taste-progress", cb),
  },
  geo: {
    // Country + state/province from the connection, via the site's own endpoint. Nothing stored server-side.
    detect: wrap(async () => {
      const g = await http("/api/geo");
      return { country: g.country, region: g.region, taxRegion: g.taxRegion };
    }),
  },
  cart: {
    mode: "handoff", // the website can't touch the Steam cart; the Windows app does it
    device: device(),
    supported: async () => ({ ok: true, value: false }),
    /** Link that opens the desktop app with these games (it registers the steamdeals:// scheme). */
    appLink: (items) => `steamdeals://cart?items=${items.map((i) => `${i.appid}:${i.packageid || 0}`).join(",")}&v=1`,
  },
  // Pairing with the Steam Deals Windows app on a PC: a random key shared once, kept in this browser.
  pair: {
    isPaired: () => Boolean(pairId()),
    claim: wrap(claim),
    // Only this browser forgets the pairing; the PC and any other devices keep theirs.
    unpair: wrap(async () => {
      unpair();
      return {};
    }),
  },
  sync: {
    status: async () => ({ ok: true, ...syncStatus() }),
    now: async () => {
      await syncNow();
      return { ok: true, value: true };
    },
    onBasket: (cb) => on("basket:replaced", cb),
    onCart: (cb) => on("cart:status", cb),
  },
  openExternal: async (url) => {
    if (/^steam:\/\//i.test(url)) location.href = url;
    else if (/^https:\/\/(store\.steampowered\.com|steamcommunity\.com)\//i.test(url)) window.open(url, "_blank", "noopener");
    return { ok: true, value: true };
  },
  window: { isMaximized: async () => ({ ok: true, value: false }), onMaximizedChange: () => () => {} },
};

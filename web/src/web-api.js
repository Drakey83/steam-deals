// Website implementation of the `window.steamDeals` interface the shared UI (app.js) talks to.
// The desktop app provides the same interface from Electron's main process; here it is backed by
// the site's /api endpoints, with settings kept in this browser's localStorage.
(function () {
  const Core = window.SteamCore;
  const PAGE = 500;
  const CONCURRENCY = 4;

  // ---------- storage ----------
  const store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* full or blocked: settings just won't persist */
      }
    },
    del(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };

  function guessCountry() {
    const langs = navigator.languages || [navigator.language || "en-US"];
    for (const l of langs) {
      const m = String(l).match(/-([A-Z]{2})$/i);
      if (m) return m[1].toUpperCase();
    }
    return "US";
  }

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
    view: "foryou",
    personalWeight: 60,
    showTaste: true,
    account: null,
  };
  const SETTINGS_KEY = "sd:settings";
  const APIKEY_KEY = "sd:apikey"; // the visitor's own key, only in their browser

  function loadSettings() {
    const saved = store.get(SETTINGS_KEY, {}) || {};
    const s = { ...DEFAULTS, ...saved, weights: { ...DEFAULTS.weights, ...(saved.weights || {}) } };
    if (!s.country) s.country = guessCountry();
    return s;
  }
  let settings = loadSettings();
  const saveSettings = () => store.set(SETTINGS_KEY, settings);
  const publicSettings = () => ({ ...settings, hasApiKey: Boolean(store.get(APIKEY_KEY)) });

  // ---------- events ----------
  const listeners = {};
  const on = (name, cb) => {
    (listeners[name] ||= new Set()).add(cb);
    return () => listeners[name].delete(cb);
  };
  const emit = (name, data) => listeners[name]?.forEach((cb) => cb(data));

  // ---------- http ----------
  class ApiError extends Error {
    constructor(message, code, status) {
      super(message);
      this.code = code || "error";
      this.status = status ?? null;
    }
  }
  async function http(path, { method = "GET", body, signal } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        signal,
        credentials: "same-origin",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      throw new ApiError("You appear to be offline, or the site couldn't be reached.", "network");
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) throw new ApiError(data?.error?.message || `The server answered HTTP ${res.status}.`, data?.error?.code, res.status);
    return data;
  }
  const ok = (data) => ({ ok: true, ...(data && typeof data === "object" ? data : { value: data }) });
  const fail = (err) => ({
    ok: false,
    error: { message: err?.message || String(err), code: err?.name === "AbortError" ? "cancelled" : err?.code || "error", status: err?.status ?? null },
  });
  const wrap = (fn) => async (arg) => {
    try {
      return ok(await fn(arg));
    } catch (err) {
      return fail(err);
    }
  };

  // ---------- library (per page load, refreshed on demand) ----------
  let library = null; // { steamid, games:[{appid,playtime,recent,name}], wishlist, fetchedAt, privateProfile }
  async function loadLibrary(force) {
    const a = settings.account;
    if (!a || a.method === "guest") return null;
    if (library && !force && Date.now() - library.fetchedAt < 10 * 60 * 1000) return library;
    let data;
    if (a.method === "steam") {
      data = await http("/api/me");
    } else {
      const apiKey = store.get(APIKEY_KEY);
      if (!apiKey) throw new ApiError("Your API key isn't saved in this browser. Sign out and add it again.", "no_key");
      data = await http("/api/owned", { method: "POST", body: { apiKey, account: a.steamid } });
    }
    library = { steamid: data.steamid, games: data.games || [], wishlist: data.wishlist || [], privateProfile: Boolean(data.privateProfile), siteKeyInvalid: Boolean(data.siteKeyInvalid), fetchedAt: Date.now() };
    // Keep the displayed name and avatar current.
    if (data.name || data.avatar) {
      settings.account = { ...a, name: data.name || a.name, avatar: data.avatar || a.avatar };
      saveSettings();
    }
    return library;
  }

  // ---------- deals (pages fetched in parallel, streamed to the UI) ----------
  let dealsAbort = null;
  async function fetchDeals({ force = false } = {}) {
    dealsAbort?.abort();
    const controller = new AbortController();
    dealsAbort = controller;
    const s = settings;
    const discounted = s.catalog !== "all";
    const depth = Number(s.scanDepth);
    let limit = depth === 0 && discounted ? Infinity : Math.min(Math.max(depth || 10000, 500), 25000);
    const runId = Date.now();
    // "Refresh" asks the edge for a newer copy at most every 10 minutes, so Steam isn't hammered.
    const bust = force ? `&r=${Math.floor(Date.now() / 600000)}` : "";
    const qs = (start) => `/api/deals?catalog=${discounted ? "sale" : "all"}&start=${start}&cc=${s.country}&l=${s.language}${bust}`;

    const first = await http(qs(0), { signal: controller.signal });
    const total = first.total ?? 0;
    if (!Number.isFinite(limit)) limit = total;
    limit = Math.min(limit, total || limit);
    const items = [];
    const seen = new Set();
    let scanned = 0;
    const take = (page) => {
      const fresh = [];
      for (const it of page.items || []) {
        if (seen.has(it.appid)) continue;
        seen.add(it.appid);
        it.tagids = (it.tags || []).map((t) => t.id);
        it.image = Core.headerImage(it.appid);
        it.url = Core.storeUrl(it.appid);
        items.push(it);
        fresh.push(it);
      }
      scanned += page.scanned || 0;
      emit("progress", { fetched: Math.min(scanned, limit), target: limit, total });
      emit("partial", { runId, items: fresh, scanned, total, discounted });
    };
    take(first);

    const starts = [];
    for (let st = PAGE; st < limit; st += PAGE) starts.push(st);
    let next = 0;
    const worker = async () => {
      while (next < starts.length) {
        const st = starts[next++];
        if (controller.signal.aborted) return;
        take(await http(qs(st), { signal: controller.signal }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, starts.length) }, worker));
    if (dealsAbort === controller) dealsAbort = null;
    return { items, total, scanned, discounted, runId, fetchedAt: Date.now(), truncated: scanned < total, fromCache: false };
  }

  // ---------- taste profile ----------
  const TASTE_TTL = 3 * 24 * 60 * 60 * 1000;
  const TAGS_TTL = 30 * 24 * 60 * 60 * 1000;
  async function buildTaste({ force = false } = {}) {
    const a = settings.account;
    if (!a || a.method === "guest") return { taste: null, reason: "guest" };
    let lib;
    try {
      lib = await loadLibrary(force);
    } catch (err) {
      if (err.code === "signed_out") return { taste: null, reason: "session_expired" };
      throw err;
    }
    if (!lib || !lib.games.length) return { taste: null, reason: lib?.privateProfile ? "private" : "empty" };
    const key = `sd:taste:${a.method}:${a.steamid}:${settings.language}`;
    const sample = Core.pickSample(lib.games, 220);
    const fingerprint = Core.libraryFingerprint(sample);
    const cached = store.get(key);
    if (!force && cached && cached.fingerprint === fingerprint && Date.now() - cached.builtAt < TASTE_TTL) return { taste: cached, fromCache: true };

    const tagKey = `sd:itemtags:${settings.language}`;
    const tagStore = store.get(tagKey, null);
    const known = tagStore && Date.now() - tagStore.savedAt < TAGS_TTL ? tagStore.items : {};
    const missing = sample.filter((g) => !known[g.appid]).map((g) => g.appid);
    emit("taste-progress", { done: 0, total: missing.length });
    for (let i = 0; i < missing.length; i += 50) {
      const ids = missing.slice(i, i + 50);
      const r = await http(`/api/items?ids=${ids.join(",")}&cc=${settings.country}&l=${settings.language}`);
      for (const it of r.items || []) known[it.appid] = { name: it.name, type: it.type, tags: it.tags };
      for (const id of ids) if (!known[id]) known[id] = { name: null, type: -1, tags: [] };
      emit("taste-progress", { done: Math.min(i + 50, missing.length), total: missing.length });
    }
    store.set(tagKey, { savedAt: tagStore?.savedAt && missing.length === 0 ? tagStore.savedAt : Date.now(), items: known });
    const items = sample.map((g) => ({ appid: g.appid, ...(known[g.appid] || { name: null, type: -1, tags: [] }) }));
    const taste = Core.buildTasteProfile(sample, items);
    taste.source = a.method;
    taste.libraryCount = lib.games.length;
    taste.builtAt = Date.now();
    taste.fingerprint = fingerprint;
    store.set(key, taste);
    return { taste, fromCache: false };
  }

  // ---------- config + return from Steam sign-in ----------
  const features = { steamSignIn: false };
  // Anonymous user counter: a random id made in this browser, counted at most once a day.
  async function countUser() {
    try {
      let id = store.get("sd:uid");
      if (!id) {
        id = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
        store.set("sd:uid", id);
      }
      const today = new Date().toISOString().slice(0, 10);
      const r = store.get("sd:counted") === today ? await http("/api/stats") : await http("/api/stats", { method: "POST", body: { id } });
      if (r.enabled) {
        store.set("sd:counted", today);
        features.users = { total: r.total, week: r.week };
      }
    } catch {
      /* the counter is decoration; never block the app on it */
    }
  }

  async function ready() {
    const counted = countUser();
    try {
      const c = await http("/api/config");
      features.steamSignIn = Boolean(c.steamSignIn);
    } catch {
      features.steamSignIn = false;
    }
    await Promise.race([counted, new Promise((r) => setTimeout(r, 1500))]);
    const hash = location.hash.replace(/^#/, "");
    if (hash === "signedin" || hash === "signin-cancelled") history.replaceState(null, "", location.pathname + location.search);
    if (hash === "signedin") {
      try {
        const me = await http("/api/me");
        settings.account = { method: "steam", steamid: me.steamid, name: me.name || "Steam user", avatar: me.avatar || null, signedInAt: Date.now() };
        library = { steamid: me.steamid, games: me.games || [], wishlist: me.wishlist || [], privateProfile: Boolean(me.privateProfile), siteKeyInvalid: Boolean(me.siteKeyInvalid), fetchedAt: Date.now() };
        store.del(APIKEY_KEY);
        saveSettings();
        features.justSignedIn = settings.account.name;
        features.privateProfile = library.privateProfile;
        features.siteKeyInvalid = library.siteKeyInvalid;
      } catch (err) {
        features.signInError = err.message;
      }
    }
  }

  const ALLOWED_SETTINGS = new Set([
    "country", "language", "minDiscount", "minRating", "minReviews", "scanDepth", "weights", "hideOwned",
    "wishlistOnly", "sort", "selectedTags", "view", "personalWeight", "catalog", "showTaste", "showTastePhone",
    "basket", "taxRegion", "taxCustomRate", "taxRegionAuto",
  ]);

  // The website can't touch a Steam cart itself (browsers block that on purpose). The Steam Deals
  // desktop app can, so the website hands the basket to it: a steamdeals:// link on Windows, or a
  // short basket code to type into the app from a phone or another computer.
  function device() {
    const forced = new URLSearchParams(location.search).get("device"); // testing aid: ?device=windows|mac|linux|ios|android
    if (["windows", "mac", "linux", "ios", "android"].includes(forced)) return forced;
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
    if (/Android/.test(ua)) return "android";
    if (/Windows/.test(ua)) return "windows";
    if (/Mac/.test(ua)) return "mac";
    return "linux";
  }

  window.steamDeals = {
    platform: "web",
    device: device(),
    features,
    ready,
    version: async () => ({ ok: true, value: "web" }),

    settings: {
      get: async () => ({ ok: true, settings: publicSettings() }),
      update: async (patch) => {
        for (const [k, v] of Object.entries(patch || {})) if (ALLOWED_SETTINGS.has(k)) settings[k] = v;
        saveSettings();
        return { ok: true, settings: publicSettings() };
      },
    },

    auth: {
      status: async () => ({ ok: true, account: settings.account, sessionValid: true }),
      signIn: async () => {
        if (!features.steamSignIn) return fail(new ApiError("Sign in through Steam isn't available on this site yet. Use your own API key instead.", "not_configured"));
        location.href = "/api/auth/login";
        return new Promise(() => {}); // the page navigates away
      },
      signOut: wrap(async () => {
        const wasSteam = settings.account?.method === "steam";
        settings.account = null;
        library = null;
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
        const data = await http("/api/owned", { method: "POST", body: { apiKey: String(apiKey || "").trim(), account: steamIdOrVanity } });
        store.set(APIKEY_KEY, String(apiKey).trim());
        settings.account = { method: "apikey", steamid: data.steamid, name: data.name || "Steam user", avatar: data.avatar || null, signedInAt: Date.now() };
        library = { steamid: data.steamid, games: data.games || [], wishlist: data.wishlist || [], fetchedAt: Date.now() };
        saveSettings();
        return { account: settings.account, ownedCount: library.games.length };
      }),
    },

    library: {
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
    },

    deals: {
      fetch: wrap(fetchDeals),
      cancel: async () => {
        dealsAbort?.abort();
        return { ok: true, value: true };
      },
      onProgress: (cb) => on("progress", cb),
      onPartial: (cb) => on("partial", cb),
    },

    tags: {
      fetch: wrap(async () => {
        const cacheKey = `sd:tags:${settings.language}`;
        const cached = store.get(cacheKey);
        if (cached && Date.now() - cached.savedAt < 7 * 86400000) return { tags: cached.tags, fromCache: true };
        const r = await http(`/api/tags?l=${settings.language}`);
        store.set(cacheKey, { savedAt: Date.now(), tags: r.tags });
        return { tags: r.tags, fromCache: false };
      }),
    },

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
      mode: "handoff",
      device: device(),
      supported: async () => ({ ok: true, value: false }),
      /** Link that opens the desktop app with these games (it registers the steamdeals:// scheme). */
      appLink: (items) => `steamdeals://cart?items=${items.map((i) => `${i.appid}:${i.packageid || 0}`).join(",")}&v=1`,
    },

    // Pairing with the Steam Deals Windows app on a PC: a random key shared once, kept in this browser.
    pair: {
      isPaired: () => Boolean(store.get("sd:pair")),
      claim: wrap(async (code) => {
        const r = await http("/api/pair", { method: "POST", body: { action: "claim", code } });
        if (r.enabled === false) throw new ApiError("Pairing isn't available on this site right now.", "pair_down");
        store.set("sd:pair", r.pairId);
        return { pairId: r.pairId };
      }),
      send: wrap(async (items) => {
        const pairId = store.get("sd:pair");
        if (!pairId) throw new ApiError("Not paired with a PC.", "bad_pair");
        try {
          const r = await http("/api/pair", { method: "POST", body: { action: "send", pairId, items: items.map((i) => ({ appid: i.appid, packageid: i.packageid })) } });
          return { sentAt: r.sentAt };
        } catch (err) {
          if (err.code === "bad_pair") store.del("sd:pair");
          throw err;
        }
      }),
      status: wrap(async () => {
        const pairId = store.get("sd:pair");
        if (!pairId) throw new ApiError("Not paired with a PC.", "bad_pair");
        const r = await http("/api/pair", { method: "POST", body: { action: "status", pairId } });
        return { box: r.box };
      }),
      unpair: wrap(async () => {
        const pairId = store.get("sd:pair");
        if (pairId) http("/api/pair", { method: "POST", body: { action: "unpair", pairId } }).catch(() => {});
        store.del("sd:pair");
        return {};
      }),
    },

    openExternal: async (url) => {
      if (/^steam:\/\//i.test(url)) location.href = url;
      else if (/^https:\/\/(store\.steampowered\.com|steamcommunity\.com)\//i.test(url)) window.open(url, "_blank", "noopener");
      return { ok: true, value: true };
    },
    window: { isMaximized: async () => ({ ok: true, value: false }), onMaximizedChange: () => () => {} },
  };
})();

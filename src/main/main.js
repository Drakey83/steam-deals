// Electron main process: window, lifecycle, and every IPC handler the UI can call.
const { app, BrowserWindow, ipcMain, shell, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const settings = require("./settings");
const cache = require("./cache");
const steam = require("./steam");
const auth = require("./auth");

const DEALS_TTL_MS = 30 * 60 * 1000;
const LIBRARY_TTL_MS = 10 * 60 * 1000;
const TAGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BG = "#0b0f14";

let mainWindow = null;
let dealsAbort = null;

// ---------- steamdeals:// links (the website hands baskets to the app this way) ----------
const PROTOCOL = "steamdeals";
let pendingDeepLink = null;

// Only the installed app claims the scheme (the installer registers it as well). A dev run must not,
// or it would steal links from the installed copy on a developer's machine.
if (!process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL);

function parseDeepLink(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== `${PROTOCOL}:` || u.hostname !== "cart") return null;
    const items = String(u.searchParams.get("items") || "")
      .split(",")
      .map((pair) => pair.split(":").map(Number))
      .filter(([appid]) => Number.isInteger(appid) && appid > 0)
      .slice(0, 100)
      .map(([appid, packageid]) => ({ appid, packageid: packageid > 0 ? packageid : null }));
    return items.length ? { items } : null;
  } catch {
    return null;
  }
}
const deepLinkIn = (argv) => (argv || []).find((a) => typeof a === "string" && a.startsWith(`${PROTOCOL}://`)) || null;

function handleDeepLink(url) {
  const parsed = parseDeepLink(url);
  if (!parsed) return;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    sendToUI("deeplink:basket", parsed);
  } else {
    pendingDeepLink = parsed; // the renderer asks for it once it has started
  }
}

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    const link = deepLinkIn(argv);
    if (link) handleDeepLink(link);
  });
  app.on("open-url", (e, url) => {
    e.preventDefault();
    handleDeepLink(url);
  });
  const first = deepLinkIn(process.argv);
  if (first) pendingDeepLink = parseDeepLink(first);
}

// ---------- window ----------
function createWindow() {
  const s = settings.get();
  const b = s.windowBounds || {};
  const iconPath = path.join(__dirname, "..", "..", "build", "icon.png");
  mainWindow = new BrowserWindow({
    width: b.width || 1320,
    height: b.height || 860,
    x: Number.isFinite(b.x) ? b.x : undefined,
    y: Number.isFinite(b.y) ? b.y : undefined,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: BG,
    title: "Steam Deals",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: BG, symbolColor: "#c9d4df", height: 44 },
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (b.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Remember size/position.
  let saveTimer = null;
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const maximized = mainWindow.isMaximized();
      const bounds = maximized ? settings.get().windowBounds || {} : mainWindow.getBounds();
      settings.update({ windowBounds: { ...bounds, maximized } });
    }, 250);
  };
  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);
  mainWindow.on("maximize", () => {
    saveBounds();
    mainWindow.webContents.send("window:maximized", true);
  });
  mainWindow.on("unmaximize", () => {
    saveBounds();
    mainWindow.webContents.send("window:maximized", false);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // The UI never navigates; links open outside.
  mainWindow.webContents.on("will-navigate", (e) => e.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12" || (input.control && input.shift && input.key.toUpperCase() === "I")) {
      mainWindow.webContents.toggleDevTools();
      e.preventDefault();
    }
  });
}

// ---------- helpers ----------
const ALLOWED_EXTERNAL = [/^https:\/\/store\.steampowered\.com\//i, /^https:\/\/steamcommunity\.com\//i, /^steam:\/\//i];

function openExternal(url) {
  if (typeof url !== "string" || !ALLOWED_EXTERNAL.some((re) => re.test(url))) return false;
  shell.openExternal(url);
  return true;
}

function fail(err) {
  const code = err?.name === "AbortError" ? "cancelled" : err?.code || "error";
  return { ok: false, error: { message: err?.message || String(err), code, status: err?.status ?? null } };
}

// Wrap a handler so the renderer always gets an { ok, ... } envelope instead of a thrown string.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      const data = await fn(payload, event);
      return { ok: true, ...(data && typeof data === "object" ? data : { value: data }) };
    } catch (err) {
      return fail(err);
    }
  });
}

async function profileFor(steamid) {
  try {
    const p = await steam.fetchProfile(steamid);
    return { name: p.name || null, avatar: p.avatar || null, privacy: p.privacy || null };
  } catch {
    return { name: null, avatar: null, privacy: null };
  }
}

const ALLOWED_SETTING_KEYS = new Set([
  "country", "language", "minDiscount", "minRating", "minReviews", "scanDepth", "weights",
  "hideOwned", "wishlistOnly", "sort", "selectedTags", "view", "personalWeight", "catalog", "showTaste",
  "basket", "taxRegion", "taxCustomRate", "taxRegionAuto", "pairAutoCart",
]);
const TASTE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function sendToUI(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

// Learn what the signed-in person likes from their library. Playtime comes from
// IPlayerService via a store-session token (no API key needed); if that path is
// unavailable we fall back to the plain owned list without playtime.
const ITEM_TAGS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function buildTaste({ force = false } = {}) {
  const s = settings.get();
  const a = s.account;
  if (!a || a.method === "guest" || !a.steamid) return { taste: null, reason: "guest" };
  const key = `taste:v2:${a.method}:${a.steamid}:${s.language}`;
  const cached = cache.get(key, TASTE_TTL_MS);

  // 1. The current library with playtime: one request. This runs on every refresh, which is
  //    what lets the profile follow what the person is actually playing.
  let games = null;
  let source = null;
  if (a.method === "steam") {
    try {
      const token = await steam.fetchWebApiToken({ fetchImpl: auth.sessionFetch });
      games = await steam.fetchOwnedGamesDetailed({ steamid: a.steamid, accessToken: token });
      source = "session";
    } catch (err) {
      console.warn("[taste] token path unavailable:", err.message);
    }
    if (!games) {
      const ud = await steam.fetchUserData({ fetchImpl: auth.sessionFetch, steamid: a.steamid });
      if (!ud.signedIn) {
        return cached ? { taste: cached.value, fromCache: true, stale: true } : { taste: null, reason: "session_expired" };
      }
      games = ud.owned.map((appid) => ({ appid, name: null, playtime: 0, recent: 0 }));
      source = "userdata";
    }
  } else {
    games = await steam.fetchOwnedGamesDetailed({ steamid: a.steamid, apiKey: s.apiKey });
    source = "apikey";
  }

  // 2. Nothing changed since last time (same games, same hours)? Reuse the profile.
  const sample = steam.pickSample(games, 220);
  const fingerprint = steam.libraryFingerprint(sample);
  if (!force && cached && cached.value?.fingerprint === fingerprint) return { taste: cached.value, fromCache: true };

  // 3. Tags: remember every game we've looked up, so a rebuild only fetches newcomers.
  const tagKey = `itemtags:v1:${s.language}`;
  const known = cache.get(tagKey, ITEM_TAGS_TTL_MS)?.value || {};
  const missing = sample.filter((g) => !known[g.appid] || (force && known[g.appid].type === -1)).map((g) => g.appid);
  sendToUI("taste:progress", { done: 0, total: missing.length });
  if (missing.length) {
    const fetched = await steam.fetchItems(missing, {
      language: s.language,
      country: s.country,
      onProgress: (p) => sendToUI("taste:progress", p),
    });
    for (const it of fetched) known[it.appid] = { name: it.name, type: it.type, tags: it.tags };
    for (const id of missing) if (!known[id]) known[id] = { name: null, type: -1, tags: [] }; // delisted/unknown: remember the miss
    cache.set(tagKey, known);
  }
  const items = sample.map((g) => ({ appid: g.appid, ...(known[g.appid] || { name: null, type: -1, tags: [] }) }));

  const taste = steam.buildTasteProfile(sample, items);
  taste.source = source;
  taste.libraryCount = games.length;
  taste.builtAt = Date.now();
  taste.fingerprint = fingerprint;
  cache.set(key, taste);
  return { taste, fromCache: false };
}

// ---------- IPC ----------
handle("app:version", () => ({ value: app.getVersion() }));

handle("settings:get", () => ({ settings: settings.publicView() }));

handle("settings:update", (patch) => {
  const clean = {};
  for (const [k, v] of Object.entries(patch || {})) if (ALLOWED_SETTING_KEYS.has(k)) clean[k] = v;
  settings.update(clean);
  return { settings: settings.publicView() };
});

handle("auth:status", async () => {
  const s = settings.get();
  const steamid = await auth.readSteamId().catch(() => null);
  const account = s.account;
  const sessionValid = account?.method === "steam" ? Boolean(steamid) && steamid === account.steamid : true;
  return { account, sessionValid };
});

handle("auth:signIn", async () => {
  // If an account is already set, the person is re-authenticating: start from a clean session.
  const fresh = Boolean(settings.get().account?.steamid);
  const r = await auth.signIn(mainWindow, { fresh });
  if (!r.ok) return { account: null, cancelled: true };
  const profile = await profileFor(r.steamid);
  const account = {
    method: "steam",
    steamid: r.steamid,
    name: profile.name || "Steam user",
    avatar: profile.avatar,
    signedInAt: Date.now(),
  };
  settings.update({ account, apiKey: null, manualSteamId: null });
  return { account };
});

handle("auth:signOut", async () => {
  await auth.signOut();
  settings.update({ account: null, apiKey: null, manualSteamId: null });
  return { settings: settings.publicView() };
});

handle("auth:guest", () => {
  const account = { method: "guest", steamid: null, name: "Guest", avatar: null, signedInAt: Date.now() };
  settings.update({ account });
  return { account };
});

handle("auth:useApiKey", async ({ apiKey, steamIdOrVanity } = {}) => {
  const key = String(apiKey || "").trim();
  const who = String(steamIdOrVanity || "").trim();
  if (!/^[A-F0-9]{32}$/i.test(key)) throw new steam.SteamError("That doesn't look like a Steam Web API key (32 hex characters).", null, "bad_key");
  if (!who) throw new steam.SteamError("Enter your SteamID64 or profile name.", null, "bad_input");
  let steamid = who;
  if (!steam.isSteamId64(who)) {
    const vanity = who.replace(/^https?:\/\/steamcommunity\.com\/id\//i, "").replace(/\/.*$/, "");
    steamid = await steam.resolveVanity(key, vanity);
  }
  const owned = await steam.fetchOwnedWithKey(key, steamid);
  const profile = await profileFor(steamid);
  const account = {
    method: "apikey",
    steamid,
    name: profile.name || "Steam user",
    avatar: profile.avatar,
    signedInAt: Date.now(),
  };
  settings.update({ account, apiKey: key, manualSteamId: steamid });
  cache.set(`library:apikey:${steamid}`, { owned, wishlist: [], signedIn: true });
  return { account, ownedCount: owned.length };
});

handle("library:fetch", async ({ force = false } = {}) => {
  const s = settings.get();
  const account = s.account;
  if (!account || account.method === "guest" || !account.steamid) {
    return { owned: [], wishlist: [], signedIn: false, fromCache: false };
  }
  const key = `library:${account.method}:${account.steamid}`;
  if (!force) {
    const hit = cache.get(key, LIBRARY_TTL_MS);
    if (hit) return { ...hit.value, fromCache: true, age: hit.age };
  }
  if (account.method === "steam") {
    const ud = await steam.fetchUserData({ fetchImpl: auth.sessionFetch, steamid: account.steamid });
    if (!ud.signedIn) {
      // Cookie may still exist but the store no longer honours it.
      return { owned: [], wishlist: [], signedIn: false, sessionExpired: true, fromCache: false };
    }
    const value = { owned: ud.owned, wishlist: ud.wishlist, signedIn: true };
    cache.set(key, value);
    return { ...value, fromCache: false };
  }
  // apikey
  const owned = await steam.fetchOwnedWithKey(s.apiKey, account.steamid);
  const wishlist = await steam.fetchWishlist(account.steamid).catch(() => []);
  const value = { owned, wishlist, signedIn: true };
  cache.set(key, value);
  return { ...value, fromCache: false };
});

handle("deals:fetch", async ({ force = false } = {}) => {
  const s = settings.get();
  const discounted = s.catalog !== "all";
  // scanDepth 0 = "everything on sale" (the discounted list is ~70k items; the whole catalog is ~240k, so it stays capped there).
  const depth = Number(s.scanDepth);
  const limit = depth === 0 && discounted ? Infinity : Math.min(Math.max(depth || 10000, 500), 25000);
  const key = `catalog:v2:${discounted ? "sale" : "all"}:${s.country}:${s.language}:${s.scanDepth}:${steam.SERVER_MIN_DISCOUNT}`;
  if (!force) {
    const hit = cache.get(key, DEALS_TTL_MS);
    if (hit) return { ...hit.value, fromCache: true, age: hit.age };
  }
  if (dealsAbort) dealsAbort.abort();
  const controller = new AbortController();
  dealsAbort = controller;
  const runId = Date.now();
  try {
    const result = await steam.fetchDeals({
      country: s.country,
      language: s.language,
      limit,
      discounted,
      signal: controller.signal,
      onProgress: (p) => sendToUI("deals:progress", p),
      // Stream each page so the UI can show results while the scan continues.
      onPage: (items, meta) => sendToUI("deals:partial", { runId, items, ...meta, discounted }),
    });
    cache.set(key, result);
    return { ...result, runId, fromCache: false };
  } finally {
    if (dealsAbort === controller) dealsAbort = null;
  }
});

handle("deals:cancel", () => {
  dealsAbort?.abort();
  return { value: true };
});

handle("tags:fetch", async () => {
  const s = settings.get();
  const key = `tags:${s.language}`;
  const hit = cache.get(key, TAGS_TTL_MS);
  if (hit) return { tags: hit.value, fromCache: true };
  const tags = await steam.fetchTagList(s.language);
  cache.set(key, tags);
  return { tags, fromCache: false };
});

handle("taste:build", (opts) => buildTaste(opts));

// ---------- Steam cart (desktop: the signed-in store session can fill the cart directly) ----------
let storeCountry = null;
async function cartSession() {
  const a = settings.get().account;
  if (!a || a.method !== "steam") throw new steam.SteamError("Sign in through Steam to send your basket to your Steam cart.", null, "needs_steam");
  let token;
  try {
    token = await steam.fetchWebApiToken({ fetchImpl: auth.sessionFetch });
  } catch {
    throw new steam.SteamError("Your Steam session has expired. Sign in again to use your cart.", null, "session_expired");
  }
  storeCountry ||= await steam.fetchStoreCountry({ fetchImpl: auth.sessionFetch });
  return { token, country: storeCountry };
}

// Tax-region detection: ask the Steam Deals website, which sees the connection's country and
// state/province. One small request, nothing stored; the person can always change the region.
handle("geo:detect", async () => {
  const res = await fetch("https://steamdeal.vercel.app/api/geo", { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new steam.SteamError("Location lookup unavailable", res.status, "geo");
  const g = await res.json();
  return { country: g.country ?? null, region: g.region ?? null, taxRegion: g.taxRegion ?? null };
});

handle("deeplink:pending", () => {
  const p = pendingDeepLink;
  pendingDeepLink = null;
  return { basket: p };
});

handle("items:lookup", async ({ appids = [] } = {}) => {
  const s = settings.get();
  const ids = [...new Set(appids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
  if (!ids.length) return { items: [] };
  return { items: await steam.lookupItems(ids, { language: s.language, country: s.country }) };
});

// ---------- phone pairing: baskets sent from the website on a phone land in this app ----------
const SITE = "https://steamdeal.vercel.app";
async function pairApi(action, extra = {}) {
  const res = await fetch(`${SITE}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new steam.SteamError(data?.error?.message || "Pairing service didn't answer", res.status, data?.error?.code || "pair");
  return data;
}
let pairTimer = null;
let lastSeenSentAt = 0;
let pairPolling = false;
async function pollPairInbox() {
  const s = settings.get();
  if (!s.pairId || !mainWindow || mainWindow.isDestroyed() || pairPolling) return;
  pairPolling = true; // one check at a time, so a basket is never delivered twice
  try {
    const { box } = await pairApi("inbox", { pairId: s.pairId });
    if (box && box.status === "sent" && box.sentAt > lastSeenSentAt) {
      lastSeenSentAt = box.sentAt;
      console.log(`[pair] basket from phone: ${box.items.length} item(s)`);
      sendToUI("pair:basket", { items: box.items, sentAt: box.sentAt });
    }
  } catch {
    /* offline or service down: try again next tick */
  } finally {
    pairPolling = false;
  }
}
function startPairPolling() {
  clearInterval(pairTimer);
  if (!settings.get().pairId) return;
  pairTimer = setInterval(pollPairInbox, 12000);
  pollPairInbox();
}

handle("pair:start", async () => {
  const r = await pairApi("start");
  if (r.enabled === false) throw new steam.SteamError("Pairing isn't available right now.", null, "pair_down");
  return { code: r.code, pairId: r.pairId, expiresIn: r.expiresIn };
});
handle("pair:check", async ({ pairId } = {}) => {
  const r = await pairApi("check", { pairId });
  if (r.claimed) {
    settings.update({ pairId });
    lastSeenSentAt = Date.now(); // ignore anything older than the pairing itself
    startPairPolling();
  }
  return { claimed: Boolean(r.claimed), expired: Boolean(r.expired) };
});
handle("pair:status", () => ({ paired: Boolean(settings.get().pairId), autoCart: settings.get().pairAutoCart !== false }));
handle("pair:ack", async ({ sentAt, status, result } = {}) => {
  const s = settings.get();
  if (!s.pairId) return { value: false };
  await pairApi("ack", { pairId: s.pairId, sentAt, status, result }).catch(() => {});
  return { value: true };
});
handle("pair:unpair", async () => {
  const s = settings.get();
  if (s.pairId) await pairApi("unpair", { pairId: s.pairId }).catch(() => {});
  settings.update({ pairId: null });
  clearInterval(pairTimer);
  return { value: true };
});
handle("pair:poll", async () => {
  await pollPairInbox();
  return { value: true };
});
app.whenReady().then(() => setTimeout(startPairPolling, 4000));

handle("cart:supported", () => ({ value: settings.get().account?.method === "steam" }));

handle("cart:get", async () => {
  const { token, country } = await cartSession();
  return { cart: await steam.getCart(token, country) };
});

handle("cart:add", async ({ packageids = [] } = {}) => {
  const { token, country } = await cartSession();
  const result = await steam.addToCart(token, packageids, country);
  return { cart: { items: result.items, subtotal: result.subtotal, subtotalCents: result.subtotalCents }, added: result.added };
});

handle("cart:remove", async ({ lineItemIds = [] } = {}) => {
  const { token, country } = await cartSession();
  return { cart: await steam.removeFromCart(token, lineItemIds, country) };
});

handle("shell:openExternal", (url) => ({ value: openExternal(url) }));

handle("window:isMaximized", () => ({ value: Boolean(mainWindow?.isMaximized()) }));

// ---------- lifecycle ----------
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

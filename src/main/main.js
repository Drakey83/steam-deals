// Electron main process: window, lifecycle, and every IPC handler the UI can call.
const { app, BrowserWindow, ipcMain, shell, Menu, Tray, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const settings = require("./settings");
const cache = require("./cache");
const steam = require("./steam");
const auth = require("./auth");
const createSync = require("./sync");

const DEALS_TTL_MS = 30 * 60 * 1000;
const LIBRARY_TTL_MS = 10 * 60 * 1000;
const TAGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BG = "#0b0f14";

let mainWindow = null;
let dealsAbort = null;
let tray = null;
let quitting = false;
const startHidden = process.argv.includes("--hidden"); // "Start with Windows" launches straight into the tray

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
    showWindow();
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
      backgroundThrottling: false, // keep syncing at full speed while hidden in the tray
    },
  });

  if (b.maximized) mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => {
    if (!startHidden) mainWindow.show();
  });

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
  // The X button hides the app to the tray, so the basket keeps syncing with the phone. Quit from the tray menu.
  mainWindow.on("close", (e) => {
    if (quitting || settings.get().closeToTray === false || !tray) return;
    e.preventDefault();
    mainWindow.hide();
    if (!settings.get().trayHintShown) {
      settings.update({ trayHintShown: true });
      try {
        tray.displayBalloon({ title: "Steam Deals is still running", content: "It keeps your Steam cart in sync with your phone from here. Right-click the icon to quit or change that.", iconType: "info" });
      } catch {
        /* balloons are optional */
      }
    }
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
  "hideOwned", "wishlistOnly", "sort", "selectedTags", "view", "personalWeight", "catalog", "showTaste", "showTastePhone",
  "basket", "taxRegion", "taxCustomRate", "taxRegionAuto", "pairAutoCart", "syncPaused", "closeToTray", "startWithWindows",
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
  const before = settings.get();
  settings.update(clean);
  if ("basket" in clean) sync.onLocalBasketChange(before.basket, clean.basket);
  if ("pairAutoCart" in clean || "syncPaused" in clean) sync.kick();
  if ("startWithWindows" in clean) applyLoginItem();
  if ("closeToTray" in clean || "syncPaused" in clean || "startWithWindows" in clean) refreshTray();
  return { settings: settings.publicView() };
});

handle("auth:status", async () => {
  const s = settings.get();
  const account = s.account;
  let steamid = await auth.readSteamId().catch(() => null);
  if (account?.method === "steam" && steamid !== account.steamid) {
    // The store session may just need renewing (a browser does this on every visit): let Steam's page do it.
    steamid = await auth.keepAlive().catch(() => null);
  }
  const sessionValid = account?.method === "steam" ? Boolean(steamid) && steamid === account.steamid : true;
  return { account, sessionValid };
});

// Renew the Steam sign-in now and then while the app runs, so the cart keeps working for weeks without
// asking the person to sign in again (exactly as long as the Steam website would keep them signed in).
const KEEPALIVE_MS = 6 * 60 * 60 * 1000;
function scheduleKeepAlive() {
  setInterval(() => {
    if (settings.get().account?.method === "steam") auth.keepAlive().catch(() => {});
  }, KEEPALIVE_MS);
}
app.whenReady().then(() => setTimeout(scheduleKeepAlive, 15000));

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
  sync.kick(); // a fresh Steam session can now mirror the basket into the cart
  return { account };
});

handle("auth:signOut", async () => {
  await auth.signOut();
  settings.update({ account: null, apiKey: null, manualSteamId: null });
  sync.kick();
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
    // Renew through Steam's own page first; only give up if the store still says no.
    const renewed = await auth.keepAlive().catch(() => null);
    try {
      if (!renewed) throw new Error("not signed in");
      token = await steam.fetchWebApiToken({ fetchImpl: auth.sessionFetch });
    } catch {
      throw new steam.SteamError("Your Steam session has expired. Sign in again to use your cart.", null, "session_expired");
    }
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

// ---------- pairing + the shared basket (the engine lives in sync.js) ----------
const SITE = process.env.STEAM_DEALS_SITE || "https://steamdeal.vercel.app"; // override only for testing against a preview deploy
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

const sync = createSync({
  settings,
  steam,
  cartSession,
  sessionFetch: auth.sessionFetch,
  pairApi,
  sendToUI,
  version: app.getVersion(),
  // Toasts cover it while the window is in front; otherwise a Windows notification.
  shouldNotify: () => !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible() || !mainWindow.isFocused(),
  onNotificationClick: () => showWindow(),
  log: (m) => console.log(m),
});

let pairStartDevices = 0;
handle("pair:start", async () => {
  const r = await pairApi("start", { pairId: settings.get().pairId || undefined });
  if (r.enabled === false) throw new steam.SteamError("Pairing isn't available right now.", null, "pair_down");
  pairStartDevices = r.devices || 0;
  return { code: r.code, pairId: r.pairId, expiresIn: r.expiresIn };
});
handle("pair:check", async ({ pairId } = {}) => {
  const r = await pairApi("check", { pairId });
  const joined = Boolean(r.claimed) && (r.devices || 0) > pairStartDevices;
  if (joined && settings.get().pairId !== pairId) {
    settings.update({ pairId, basketRev: 0 });
    await sync.afterPaired();
    refreshTray();
  }
  return { claimed: joined, expired: Boolean(r.expired), devices: r.devices || 0 };
});
handle("pair:status", () => ({ paired: Boolean(settings.get().pairId), autoCart: settings.get().pairAutoCart !== false, sync: sync.status() }));
handle("pair:unpair", async () => {
  const s = settings.get();
  if (s.pairId) await pairApi("unpair", { pairId: s.pairId }).catch(() => {});
  settings.update({ pairId: null, basketRev: 0, mirror: {} });
  sync.afterUnpaired();
  refreshTray();
  return { value: true };
});
handle("sync:status", () => sync.status());
handle("sync:now", () => {
  sync.syncNow();
  return { value: true };
});
app.whenReady().then(() => setTimeout(() => sync.start(), 3000));

// ---------- tray, close-to-tray, start with Windows ----------
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
function applyLoginItem() {
  if (!app.isPackaged) return; // a dev run must never register itself to start with Windows
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(settings.get().startWithWindows), path: process.execPath, args: ["--hidden"] });
  } catch {
    /* not fatal */
  }
}
function refreshTray() {
  if (!tray) return;
  const s = settings.get();
  tray.setToolTip(!s.pairId ? "Steam Deals" : s.syncPaused ? "Steam Deals · syncing paused" : "Steam Deals · basket synced with your phone");
  const toggled = () => {
    refreshTray();
    sendToUI("settings:changed", settings.publicView());
  };
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Steam Deals", click: showWindow },
      { type: "separator" },
      { label: "Pause syncing with my phone", type: "checkbox", checked: Boolean(s.syncPaused), enabled: Boolean(s.pairId), click: (mi) => { settings.update({ syncPaused: mi.checked }); sync.kick(); toggled(); } },
      { label: "Close to tray instead of quitting", type: "checkbox", checked: s.closeToTray !== false, click: (mi) => { settings.update({ closeToTray: mi.checked }); toggled(); } },
      { label: "Start with Windows", type: "checkbox", checked: Boolean(s.startWithWindows), enabled: app.isPackaged, click: (mi) => { settings.update({ startWithWindows: mi.checked }); applyLoginItem(); toggled(); } },
      { type: "separator" },
      { label: "Quit Steam Deals", click: () => { quitting = true; app.quit(); } },
    ]),
  );
}
function createTray() {
  const ico = path.join(__dirname, "..", "..", "build", "icon.ico");
  const png = path.join(__dirname, "..", "..", "build", "icon.png");
  let image = fs.existsSync(ico) ? nativeImage.createFromPath(ico) : fs.existsSync(png) ? nativeImage.createFromPath(png).resize({ width: 16, height: 16 }) : null;
  if (!image || image.isEmpty()) return;
  tray = new Tray(image);
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  refreshTray();
}


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
  createTray();
  applyLoginItem();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

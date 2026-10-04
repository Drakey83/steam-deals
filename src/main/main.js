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

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
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
  "hideOwned", "wishlistOnly", "sort", "selectedTags",
]);

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
  const r = await auth.signIn(mainWindow);
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
  const key = `deals:${s.country}:${s.language}:${s.scanDepth}:${steam.SERVER_MIN_DISCOUNT}`;
  if (!force) {
    const hit = cache.get(key, DEALS_TTL_MS);
    if (hit) return { ...hit.value, fromCache: true, age: hit.age };
  }
  if (dealsAbort) dealsAbort.abort();
  const controller = new AbortController();
  dealsAbort = controller;
  try {
    const result = await steam.fetchDeals({
      country: s.country,
      language: s.language,
      limit: s.scanDepth,
      signal: controller.signal,
      onProgress: (p) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("deals:progress", p);
      },
    });
    cache.set(key, result);
    return { ...result, fromCache: false };
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

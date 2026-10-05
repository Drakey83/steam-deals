// App-level handlers: version, settings, links, window state, location for the tax estimate, deep links.
const { app } = require("electron");
const settings = require("../settings");
const steam = require("../steam");
const { openExternal } = require("../external");
const { takePending } = require("../deeplink");
const { sync } = require("../pairing");
const { SITE } = require("../site");
const { runtime } = require("../runtime");
const { applyLoginItem, refreshTray } = require("../tray");
const { handle } = require("./handle");

/** Settings the UI may change. Everything else (account, API key, pairing ids…) is managed here. */
const ALLOWED_SETTING_KEYS = new Set([
  "country", "language", "minDiscount", "minRating", "minReviews", "scanDepth", "weights",
  "hideOwned", "wishlistOnly", "sort", "selectedTags", "view", "personalWeight", "catalog", "showTaste", "showTastePhone", "deckMachineOnly",
  "basket", "dismissed", "behavior", "alerts", "taxRegion", "taxCustomRate", "taxRegionAuto", "pairAutoCart", "syncPaused", "closeToTray", "startWithWindows", "startMinimized",
]);

function register() {
  handle("app:version", () => ({ value: app.getVersion() }));

  handle("settings:get", () => ({ settings: settings.publicView() }));
  handle("settings:update", (patch) => {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) if (ALLOWED_SETTING_KEYS.has(k)) clean[k] = v;
    const before = settings.get();
    settings.update(clean);
    if ("basket" in clean) sync.onLocalBasketChange(before.basket, clean.basket);
    if ("pairAutoCart" in clean || "syncPaused" in clean) sync.kick();
    if ("startWithWindows" in clean || "startMinimized" in clean) applyLoginItem();
    if ("closeToTray" in clean || "syncPaused" in clean || "startWithWindows" in clean) refreshTray();
    return { settings: settings.publicView() };
  });

  handle("shell:openExternal", (url) => ({ value: openExternal(url) }));
  handle("window:isMaximized", () => ({ value: Boolean(runtime.mainWindow?.isMaximized()) }));

  // Tax-region detection: ask the Steam Deals website, which sees the connection's country and
  // state/province. One small request, nothing stored; the person can always change the region.
  handle("geo:detect", async () => {
    const res = await fetch(`${SITE}/api/geo`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new steam.SteamError("Location lookup unavailable", res.status, "geo");
    const g = await res.json();
    return { country: g.country ?? null, region: g.region ?? null, taxRegion: g.taxRegion ?? null };
  });

  handle("deeplink:pending", () => ({ basket: takePending() }));
}

module.exports = { register, ALLOWED_SETTING_KEYS };

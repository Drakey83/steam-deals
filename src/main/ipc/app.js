// App-level handlers: version, settings, links, window state, location for the tax estimate, deep links.
const { app } = require("electron");
const settings = require("../settings");
const steam = require("../steam");
const { openExternal } = require("../external");
const { takePending } = require("../deeplink");
const { sync } = require("../pairing");
const { SITE } = require("../site");
const { runtime, sendToUI } = require("../runtime");
const { keepUnseen } = require("../../shared/core.js");
const { applyLoginItem, refreshTray } = require("../tray");
const { handle } = require("./handle");

/** Settings the UI may change. Everything else (account, API key, pairing ids…) is managed here. */
const ALLOWED_SETTING_KEYS = new Set([
  "country", "language", "minDiscount", "minRating", "minReviews", "scanDepth", "weights",
  "hideOwned", "wishlistOnly", "sort", "selectedTags", "view", "personalWeight", "catalog", "showTaste", "showTastePhone", "deckMachineOnly",
  "basket", "dismissed", "behavior", "alerts", "tasteTags", "taxRegion", "taxCustomRate", "taxRegionAuto", "pairAutoCart", "syncPaused", "closeToTray", "startWithWindows", "startMinimized",
]);

function register() {
  handle("app:version", () => ({ value: app.getVersion() }));

  handle("settings:get", () => {
    runtime.shownBasket = settings.get().basket || []; // what the window has been shown (a save can only remove those)
    return { settings: settings.publicView() };
  });
  handle("settings:update", (patch) => {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) if (ALLOWED_SETTING_KEYS.has(k)) clean[k] = v;
    if ("alerts" in clean) clean.alerts = sync.guardAlerts(clean.alerts);
    const before = settings.get();
    let keptUnseen = false;
    if ("basket" in clean) {
      // Games that arrived from another device before the window showed them can't have been removed on purpose.
      const guarded = keepUnseen(before.basket || [], clean.basket, runtime.shownBasket);
      keptUnseen = guarded !== clean.basket;
      clean.basket = guarded;
      runtime.shownBasket = guarded;
    }
    settings.update(clean);
    if (keptUnseen) sendToUI("basket:replaced", { items: clean.basket, source: "merge" });
    if ("basket" in clean) sync.onLocalBasketChange(before.basket, clean.basket);
    if ("alerts" in clean) sync.onLocalAlertsChange();
    if ("tasteTags" in clean) sync.onLocalPrefsChange();
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

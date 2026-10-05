// The only bridge between the UI and the main process. Nothing else from Node or
// Electron is reachable from the renderer.
const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

function subscribe(channel, cb) {
  const handler = (_event, data) => cb(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("steamDeals", {
  version: () => invoke("app:version"),
  platform: process.platform,

  settings: {
    get: () => invoke("settings:get"),
    update: (patch) => invoke("settings:update", patch),
    onChanged: (cb) => subscribe("settings:changed", cb), // the tray menu can flip a few settings
  },

  auth: {
    status: () => invoke("auth:status"),
    signIn: () => invoke("auth:signIn"),
    signOut: () => invoke("auth:signOut"),
    useApiKey: (payload) => invoke("auth:useApiKey", payload),
    continueAsGuest: () => invoke("auth:guest"),
  },

  library: {
    fetch: (opts) => invoke("library:fetch", opts),
  },

  deals: {
    fetch: (opts) => invoke("deals:fetch", opts),
    cancel: () => invoke("deals:cancel"),
    onProgress: (cb) => subscribe("deals:progress", cb),
    onPartial: (cb) => subscribe("deals:partial", cb),
  },

  tags: {
    fetch: () => invoke("tags:fetch"),
  },

  taste: {
    build: (opts) => invoke("taste:build", opts),
    onProgress: (cb) => subscribe("taste:progress", cb),
  },

  geo: {
    detect: () => invoke("geo:detect"),
  },

  // Baskets arriving from the website (steamdeals:// links) and basket codes.
  deeplink: {
    onBasket: (cb) => subscribe("deeplink:basket", cb),
    pending: () => invoke("deeplink:pending"),
  },
  items: {
    lookup: (appids) => invoke("items:lookup", { appids }),
  },
  // Price alerts: the UI decides what fired; the app shows the Windows notification.
  alerts: {
    notify: (alerts) => invoke("alerts:notify", { alerts }),
    onOpen: (cb) => subscribe("alerts:open", cb), // a notification was clicked
  },
  // Price history (IsThereAnyDeal data, through the website so the key stays on the server).
  history: {
    get: (appids, { points = false } = {}) => invoke("history:get", { appids, points }),
  },
  // Pairing with phones and browsers: one shared basket, mirrored into the Steam cart by this app.
  pair: {
    start: () => invoke("pair:start"),
    check: (pairId) => invoke("pair:check", { pairId }),
    status: () => invoke("pair:status"),
    unpair: () => invoke("pair:unpair"),
  },
  sync: {
    status: () => invoke("sync:status"),
    now: () => invoke("sync:now"),
    onBasket: (cb) => subscribe("basket:replaced", cb),
    onCart: (cb) => subscribe("cart:status", cb),
    onStatus: (cb) => subscribe("sync:status", cb),
  },

  // Desktop can fill the signed-in account's Steam cart directly.
  cart: {
    mode: "direct",
    supported: () => invoke("cart:supported"),
    get: () => invoke("cart:get"),
    add: (payload) => invoke("cart:add", payload),
    remove: (payload) => invoke("cart:remove", payload),
  },

  openExternal: (url) => invoke("shell:openExternal", url),
  window: {
    isMaximized: () => invoke("window:isMaximized"),
    onMaximizedChange: (cb) => subscribe("window:maximized", cb),
  },
});

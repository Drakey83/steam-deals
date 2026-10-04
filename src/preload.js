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
  basketCode: {
    create: (items) => invoke("basketcode:create", { items }),
    fetch: (code) => invoke("basketcode:fetch", { code }),
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

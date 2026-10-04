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
  },

  tags: {
    fetch: () => invoke("tags:fetch"),
  },

  openExternal: (url) => invoke("shell:openExternal", url),
  window: {
    isMaximized: () => invoke("window:isMaximized"),
    onMaximizedChange: (cb) => subscribe("window:maximized", cb),
  },
});

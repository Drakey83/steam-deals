// The pairing relay client, the shared-basket sync engine (the engine itself lives in sync/), and whether this
// app's window is in use (busy mode).
const { app, BrowserWindow, powerMonitor } = require("electron");
const settings = require("./settings");
const steam = require("./steam");
const auth = require("./auth");
const createSync = require("./sync");
const { cartSession } = require("./steam-session");
const { sendToUI, windowHidden } = require("./runtime");

const { SITE } = require("./site");

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

// Set by main.js once the window module exists (a notification click brings the window back).
let showWindow = () => {};
const onNotificationClick = (fn) => {
  showWindow = fn;
};

const sync = createSync({
  settings,
  steam,
  cartSession,
  sessionFetch: auth.sessionFetch,
  pairApi,
  sendToUI,
  version: app.getVersion(),
  // Toasts cover it while the window is in front; otherwise a Windows notification.
  shouldNotify: windowHidden,
  onNotificationClick: () => showWindow(),
  log: (m) => console.log(m),
  inUse,
});

// Busy mode: the window is "in use" while it has focus and the mouse or keyboard was touched in the last 25 s.
// Checked locally every 2 s; when use starts, the other devices are told right away (they then check every second).
const IN_USE_IDLE_S = 25;
function inUse() {
  const win = BrowserWindow.getFocusedWindow();
  return Boolean(win && win.isVisible()) && powerMonitor.getSystemIdleTime() < IN_USE_IDLE_S;
}
let wasInUse = false;
app.whenReady().then(() =>
  setInterval(() => {
    const now = inUse();
    if (now && !wasInUse) sync.nowInUse();
    wasInUse = now;
  }, 2000).unref?.(),
);

module.exports = { pairApi, sync, onNotificationClick };

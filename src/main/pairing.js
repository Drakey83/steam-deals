// The pairing relay client and the shared-basket sync engine (the engine itself lives in sync.js).
const { app } = require("electron");
const settings = require("./settings");
const steam = require("./steam");
const auth = require("./auth");
const createSync = require("./sync");
const { cartSession } = require("./steam-session");
const { sendToUI, windowHidden } = require("./runtime");

// Override only for testing against another deployment.
const SITE = process.env.STEAM_DEALS_SITE || "https://steamdeal.vercel.app";

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
});

module.exports = { SITE, pairApi, sync, onNotificationClick };

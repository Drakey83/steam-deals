// steamdeals:// links: the website hands a basket to the app with steamdeals://cart?items=appid:packageid,…
const { runtime, sendToUI } = require("./runtime");

const PROTOCOL = "steamdeals";
const MAX_ITEMS = 100;
let pending = null;

/** "steamdeals://cart?items=10:7,20:0" → { items: [{appid:10, packageid:7}, {appid:20, packageid:null}] } | null */
function parseDeepLink(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== `${PROTOCOL}:` || u.hostname !== "cart") return null;
    const items = String(u.searchParams.get("items") || "")
      .split(",")
      .map((pair) => pair.split(":").map(Number))
      .filter(([appid]) => Number.isInteger(appid) && appid > 0)
      .slice(0, MAX_ITEMS)
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
  const w = runtime.mainWindow;
  if (w && !w.isDestroyed() && !w.webContents.isLoading()) sendToUI("deeplink:basket", parsed);
  else pending = parsed; // the UI asks for it once it has started
}

/**
 * Claim the scheme and route links. Only the installed app claims it (the installer registers it too):
 * a dev run must not, or it would steal links from the installed copy on a developer's machine.
 * `onSecondInstance` runs when another launch hands its arguments to this one.
 */
function registerDeepLinks(onSecondInstance) {
  const { app } = require("electron"); // required here so parseDeepLink can be unit-tested in plain Node
  if (!process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL);
  app.on("second-instance", (_e, argv) => {
    onSecondInstance();
    const link = deepLinkIn(argv);
    if (link) handleDeepLink(link);
  });
  app.on("open-url", (e, url) => {
    e.preventDefault();
    handleDeepLink(url);
  });
  const first = deepLinkIn(process.argv);
  if (first) pending = parseDeepLink(first);
}

/** The basket from a link that arrived before the UI was ready (once). */
function takePending() {
  const p = pending;
  pending = null;
  return p;
}

module.exports = { parseDeepLink, registerDeepLinks, takePending };

// Steam account sync for the Windows app: signed in to Steam, the app joins its account's own sync channel on the
// website's relay (web/api/_lib/auth/link.js), shared by every phone, browser and PC signed in to that account.
// No code to type. To prove which account it is, the app shows the site its short-lived Steam store token once;
// the site checks it with Steam and keeps nothing. Code pairing (pairing.js) still adds devices that aren't
// signed in, to the same channel.
const settings = require("./settings");
const { webApiToken } = require("./steam-session");
const { sync } = require("./pairing");
const { sendToUI } = require("./runtime");
const { SITE } = require("./site");
const steam = require("./steam");

const RETRY_MS = 10 * 60000; // if the site or Steam didn't answer, try again later
let retryTimer = null;
let linking = null;

const signedInToSteam = () => settings.get().account?.method === "steam";

async function askSite(token) {
  const res = await fetch(`${SITE}/api/auth/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.pairId) throw new steam.SteamError(data?.error?.message || "Account sync isn't available right now.", res.status, data?.error?.code || "link");
  return data.pairId;
}

/** Join the account's channel (or confirm we're on it). Safe to call any time; does nothing when not signed in. */
function linkAccount() {
  if (!signedInToSteam()) return Promise.resolve({ linked: false });
  linking ||= (async () => {
    clearTimeout(retryTimer);
    try {
      const pairId = await askSite(await webApiToken());
      const s = settings.get();
      if (s.pairId === pairId) {
        if (s.pairVia !== "account") settings.update({ pairVia: "account" });
        return { linked: true, already: true };
      }
      // A code pairing gives way to the account's channel; this app's basket, alerts and taste edits come along.
      settings.update({ pairId, pairVia: "account", basketRev: 0, alertsRev: 0, prefsRev: 0 });
      await sync.afterPaired();
      sendToUI("sync:status", sync.status());
      return { linked: true, already: false };
    } catch (err) {
      retryTimer = setTimeout(linkAccount, RETRY_MS);
      return { linked: false, error: err.message };
    } finally {
      linking = null;
    }
  })();
  return linking;
}

/** Signed out of Steam: leave the account's channel. This app keeps its basket and alerts. */
function unlinkAccount() {
  clearTimeout(retryTimer);
  if (settings.get().pairVia !== "account") return;
  settings.update({ pairId: null, pairVia: null, basketRev: 0, alertsRev: 0, prefsRev: 0 });
  sync.afterUnpaired();
  sendToUI("sync:status", sync.status());
}

module.exports = { linkAccount, unlinkAccount };

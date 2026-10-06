// Page startup: site configuration, the anonymous user counter, and finishing a Steam sign-in redirect.
import { linkAccount } from "./pairing.js";
import { isTestLoad } from "./device.js";
import { http } from "./http.js";
import { setLibrary } from "./library.js";
import { startSync, watchVisibility } from "./pairing.js";
import { APIKEY_KEY, saveSettings, settings } from "./settings.js";
import { store } from "./store.js";

/** Read by the UI: what this site supports, plus one-off notices for the first screen. */
export const features = { steamSignIn: false };

// Anonymous user counter: a random id made in this browser, counted at most once a day.
async function countUser() {
  try {
    if (isTestLoad()) return;
    let id = store.get("sd:uid");
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      store.set("sd:uid", id);
    }
    const today = new Date().toISOString().slice(0, 10);
    const r = store.get("sd:counted") === today ? await http("/api/stats") : await http("/api/stats", { method: "POST", body: { id } });
    if (r.enabled) {
      store.set("sd:counted", today);
      features.users = { total: r.total, week: r.week };
    }
  } catch {
    /* the counter is decoration; never block the app on it */
  }
}

export async function ready() {
  const counted = countUser();
  watchVisibility();
  startSync();
  try {
    const c = await http("/api/config");
    features.steamSignIn = Boolean(c.steamSignIn);
  } catch {
    features.steamSignIn = false;
  }
  await Promise.race([counted, new Promise((r) => setTimeout(r, 1500))]);

  // Back from Steam's sign-in page: /api/auth/return sends people to #signedin.
  const hash = location.hash.replace(/^#/, "");
  if (hash === "signedin" || hash === "signin-cancelled") history.replaceState(null, "", location.pathname + location.search);
  if (hash === "signedin") await finishSignIn();
  // Signed in through Steam: this browser shares one basket, alerts and taste with the account's other devices.
  if (features.steamSignIn && settings.account?.method === "steam") linkAccount().catch(() => {});
}

async function finishSignIn() {
  try {
    const me = await http("/api/me");
    settings.account = { method: "steam", steamid: me.steamid, name: me.name || "Steam user", avatar: me.avatar || null, signedInAt: Date.now() };
    const lib = setLibrary(me);
    store.del(APIKEY_KEY);
    saveSettings();
    features.justSignedIn = settings.account.name;
    features.privateProfile = lib.privateProfile;
    features.siteKeyInvalid = lib.siteKeyInvalid;
  } catch (err) {
    features.signInError = err.message;
  }
}

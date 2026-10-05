// Keeping the Steam store session usable.
//
// The store login (steamLoginSecure) carries a short-lived token. Steam's own pages renew it from the
// long-lived "Remember me" login whenever they load, which is why a browser stays signed in for months.
// The app does the same (auth.keepAlive loads the store page in a hidden window): every few hours, and
// whenever a request finds the session no longer accepted, before telling the person to sign in again.
const settings = require("./settings");
const steam = require("./steam");
const auth = require("./auth");

const KEEPALIVE_MS = 6 * 60 * 60 * 1000;
const isSteamAccount = () => settings.get().account?.method === "steam";

/**
 * Run `attempt()`. If it reports the session as not accepted (returns `stale(result)` true, or throws),
 * renew once through Steam's page and try again. The second result (or error) is final.
 */
async function withRenewal(attempt, stale = () => false) {
  let first;
  try {
    first = await attempt();
    if (!stale(first)) return first;
  } catch (err) {
    if (!isSteamAccount()) throw err;
  }
  if (!isSteamAccount()) return first;
  await auth.keepAlive().catch(() => null);
  return attempt();
}

/** The person's owned games and wishlist through the store session ({ signedIn:false } if Steam says no). */
function userData(steamid) {
  return withRenewal(() => steam.fetchUserData({ fetchImpl: auth.sessionFetch, steamid }), (ud) => !ud.signedIn);
}

/** A Web API token for the signed-in account (used for playtime and the cart). */
function webApiToken() {
  return withRenewal(() => steam.fetchWebApiToken({ fetchImpl: auth.sessionFetch }));
}

let storeCountry = null;
/** What the cart calls need: a token and the store country. Throws needs_steam / session_expired. */
async function cartSession() {
  if (!isSteamAccount()) throw new steam.SteamError("Sign in through Steam to send your basket to your Steam cart.", null, "needs_steam");
  let token;
  try {
    token = await webApiToken();
  } catch {
    throw new steam.SteamError("Your Steam session has expired. Sign in again to use your cart.", null, "session_expired");
  }
  storeCountry ||= await steam.fetchStoreCountry({ fetchImpl: auth.sessionFetch });
  return { token, country: storeCountry };
}

/** Renew in the background while the app runs, so the session never goes stale in the first place. */
function startKeepAlive() {
  setInterval(() => {
    if (isSteamAccount()) auth.keepAlive().catch(() => {});
  }, KEEPALIVE_MS);
}

module.exports = { withRenewal, userData, webApiToken, cartSession, startKeepAlive };

// The signed-in visitor's games, wishlist and playtime (fetched per page load, refreshed on demand).
import { ApiError, http } from "./http.js";
import { APIKEY_KEY, saveSettings, settings } from "./settings.js";
import { store } from "./store.js";

const FRESH_MS = 10 * 60 * 1000;

/** { steamid, games:[{appid,playtime,recent,name}], wishlist, privateProfile, siteKeyInvalid, fetchedAt } | null */
let library = null;

export function setLibrary(data) {
  library = data
    ? { steamid: data.steamid, games: data.games || [], wishlist: data.wishlist || [], privateProfile: Boolean(data.privateProfile), siteKeyInvalid: Boolean(data.siteKeyInvalid), fetchedAt: Date.now() }
    : null;
  return library;
}

export async function loadLibrary(force) {
  const a = settings.account;
  if (!a || a.method === "guest") return null;
  if (library && !force && Date.now() - library.fetchedAt < FRESH_MS) return library;
  let data;
  if (a.method === "steam") {
    data = await http("/api/me");
  } else {
    const apiKey = store.get(APIKEY_KEY);
    if (!apiKey) throw new ApiError("Your API key isn't saved in this browser. Sign out and add it again.", "no_key");
    data = await http("/api/owned", { method: "POST", body: { apiKey, account: a.steamid } });
  }
  setLibrary(data);
  // Keep the displayed name and avatar current.
  if (data.name || data.avatar) {
    settings.account = { ...a, name: data.name || a.name, avatar: data.avatar || a.avatar };
    saveSettings();
  }
  return library;
}

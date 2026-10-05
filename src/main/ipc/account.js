// Signing in and out: Steam's own login page, a guest session, or the person's own Steam Web API key.
const settings = require("../settings");
const cache = require("../cache");
const steam = require("../steam");
const auth = require("../auth");
const { sync } = require("../pairing");
const { runtime } = require("../runtime");
const { handle } = require("./handle");

async function profileFor(steamid) {
  try {
    const p = await steam.fetchProfile(steamid);
    return { name: p.name || null, avatar: p.avatar || null };
  } catch {
    return { name: null, avatar: null };
  }
}

const makeAccount = (method, steamid, profile) => ({ method, steamid, name: profile.name || "Steam user", avatar: profile.avatar, signedInAt: Date.now() });

function register() {
  handle("auth:status", async () => {
    const account = settings.get().account;
    let steamid = await auth.readSteamId().catch(() => null);
    // The store session may just need renewing (a browser does this on every visit): let Steam's page do it.
    if (account?.method === "steam" && steamid !== account.steamid) steamid = await auth.keepAlive().catch(() => null);
    const sessionValid = account?.method === "steam" ? Boolean(steamid) && steamid === account.steamid : true;
    return { account, sessionValid };
  });

  handle("auth:signIn", async () => {
    // If an account is already set, the person is re-authenticating: start from a clean session.
    const fresh = Boolean(settings.get().account?.steamid);
    const r = await auth.signIn(runtime.mainWindow, { fresh });
    if (!r.ok) return { account: null, cancelled: true };
    const account = makeAccount("steam", r.steamid, await profileFor(r.steamid));
    settings.update({ account, apiKey: null, manualSteamId: null });
    sync.kick(); // a fresh Steam session can now mirror the basket into the cart
    return { account };
  });

  handle("auth:signOut", async () => {
    await auth.signOut();
    settings.update({ account: null, apiKey: null, manualSteamId: null });
    sync.kick();
    return { settings: settings.publicView() };
  });

  handle("auth:guest", () => {
    const account = { method: "guest", steamid: null, name: "Guest", avatar: null, signedInAt: Date.now() };
    settings.update({ account });
    return { account };
  });

  handle("auth:useApiKey", async ({ apiKey, steamIdOrVanity } = {}) => {
    const key = String(apiKey || "").trim();
    const who = String(steamIdOrVanity || "").trim();
    if (!/^[A-F0-9]{32}$/i.test(key)) throw new steam.SteamError("That doesn't look like a Steam Web API key (32 hex characters).", null, "bad_key");
    if (!who) throw new steam.SteamError("Enter your SteamID64 or profile name.", null, "bad_input");
    let steamid = who;
    if (!steam.isSteamId64(who)) {
      const vanity = who.replace(/^https?:\/\/steamcommunity\.com\/id\//i, "").replace(/\/.*$/, "");
      steamid = await steam.resolveVanity(key, vanity);
    }
    const owned = await steam.fetchOwnedWithKey(key, steamid);
    const account = makeAccount("apikey", steamid, await profileFor(steamid));
    settings.update({ account, apiKey: key, manualSteamId: steamid });
    cache.set(`library:apikey:${steamid}`, { owned, wishlist: [], signedIn: true });
    return { account, ownedCount: owned.length };
  });
}

module.exports = { register };

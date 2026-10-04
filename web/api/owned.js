// "Use your own API key": the visitor's key goes to Steam and nowhere else. It is never stored,
// logged or cached here, and the response is marked no-store.
const core = require("./_lib/core.js");
const { send, handler, readJsonBody, fetchOwned, fetchWishlist, fetchProfile, resolveVanity, HttpError } = require("./_lib/server.js");

module.exports = handler(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.", "method");
  const body = await readJsonBody(req);
  const apiKey = String(body.apiKey || "").trim();
  let who = String(body.account || "").trim();
  if (!/^[A-F0-9]{32}$/i.test(apiKey)) throw new HttpError(400, "That doesn't look like a Steam Web API key. It's 32 letters and numbers.", "bad_key");
  if (!who) throw new HttpError(400, "Enter your SteamID64 or profile name.", "bad_input");
  who = who.replace(/^https?:\/\/steamcommunity\.com\/(id|profiles)\//i, "").replace(/\/.*$/, "");
  const steamid = core.isSteamId64(who) ? who : await resolveVanity(apiKey, who);
  const [games, wishlist, profile] = await Promise.all([fetchOwned(apiKey, steamid), fetchWishlist(steamid), fetchProfile(steamid)]);
  send(res, 200, { steamid, name: profile.name, avatar: profile.avatar, games, wishlist });
});

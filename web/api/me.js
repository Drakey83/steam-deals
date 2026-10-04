// The signed-in visitor (Steam sign-in): profile, library with playtime, and wishlist,
// read with the site's own API key.
const { send, handler, readSession, signInConfigured, fetchOwned, fetchWishlist, fetchProfile, HttpError } = require("./_lib/server.js");

module.exports = handler(async (req, res) => {
  if (!signInConfigured()) throw new HttpError(503, "Sign-in isn't configured on this site.", "not_configured");
  const session = readSession(req);
  if (!session) throw new HttpError(401, "You're signed out.", "signed_out");
  const steamid = session.steamid;
  const [profile, wishlist] = await Promise.all([fetchProfile(steamid), fetchWishlist(steamid)]);
  let games = [];
  let privateProfile = false;
  try {
    games = await fetchOwned(process.env.STEAM_API_KEY, steamid);
  } catch (err) {
    if (err.code !== "private") throw err;
    privateProfile = true;
  }
  send(res, 200, { steamid, name: profile.name, avatar: profile.avatar, games, wishlist, privateProfile });
});

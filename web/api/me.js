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
  let siteKeyInvalid = false;
  try {
    games = await fetchOwned(process.env.STEAM_API_KEY, steamid);
  } catch (err) {
    if (err.code === "private") privateProfile = true;
    else if (err.code === "bad_key") {
      // The site's own key is wrong or revoked. Sign the person in anyway; the page explains that
      // libraries can't be read until the site owner fixes the key.
      siteKeyInvalid = true;
      console.error("[me] STEAM_API_KEY was rejected by Steam; update it in the project's environment variables");
    } else throw err;
  }
  send(res, 200, { steamid, name: profile.name, avatar: profile.avatar, games, wishlist, privateProfile, siteKeyInvalid });
});

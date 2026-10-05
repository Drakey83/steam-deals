// Start "Sign in through Steam" (OpenID 2.0). Steam handles the password; we only get a SteamID back.
const { handler, origin, signInConfigured, HttpError } = require("../server.js");

module.exports = handler(async (req, res) => {
  if (!signInConfigured()) throw new HttpError(503, "Sign-in isn't configured on this site.", "not_configured");
  const base = origin(req);
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${base}/api/auth/callback`,
    "openid.realm": base,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  });
  res.statusCode = 302;
  res.setHeader("Location", `https://steamcommunity.com/openid/login?${params}`);
  res.setHeader("Cache-Control", "no-store");
  res.end();
});

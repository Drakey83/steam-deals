// Steam redirects back here. We ask Steam to confirm the assertion is genuine before trusting the SteamID.
const { handler, origin, makeSessionCookie, HttpError } = require("../server.js");

module.exports = handler(async (req, res) => {
  const q = req.query || {};
  const base = origin(req);
  const redirect = (hash) => {
    res.statusCode = 302;
    res.setHeader("Location", `${base}/#${hash}`);
    res.setHeader("Cache-Control", "no-store");
    res.end();
  };
  if (q["openid.mode"] !== "id_res") return redirect("signin-cancelled");
  if (q["openid.return_to"] !== `${base}/api/auth/callback`) throw new HttpError(400, "Sign-in response didn't match this site.", "bad_return");
  const claimed = String(q["openid.claimed_id"] || "");
  const m = claimed.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/);
  if (!m) throw new HttpError(400, "Steam didn't return a valid account id.", "bad_identity");

  const verify = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (k.startsWith("openid.")) verify.set(k, String(v));
  verify.set("openid.mode", "check_authentication");
  const r = await fetch("https://steamcommunity.com/openid/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: verify.toString(),
    signal: AbortSignal.timeout(15000),
  });
  const text = await r.text();
  if (!/is_valid\s*:\s*true/.test(text)) throw new HttpError(401, "Steam couldn't confirm the sign-in. Please try again.", "invalid");

  res.setHeader("Set-Cookie", makeSessionCookie(m[1]));
  redirect("signedin");
});

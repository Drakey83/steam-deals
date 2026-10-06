// Steam account sync: every device signed in to the same Steam account shares one sync channel on the pairing
// relay (basket, Steam-cart status, price alerts, "Your taste" edits), with no code to type.
//
//   GET  /api/auth/link              the website (phone or computer), signed in through Steam: its session cookie
//                                    says which account
//   POST /api/auth/link { token }    the Windows app, signed in to Steam: it shows its short-lived Steam store
//                                    token once; Steam is asked whether the token is genuine (a cart read, which
//                                    fails for a forged or expired token), and the account is the token's subject.
//                                    The token is used for that one check and never stored or logged.
// → { pairId, steamid }
//
// The channel id is derived from the Steam ID with the site's secret, so it's the same on every device and
// can't be guessed from the Steam ID. It's a pairing like any other: code pairing can still add a device that
// isn't signed in (a guest browser) to the same channel.
const crypto = require("node:crypto");
const { handler, send, readSession, readJsonBody, HttpError } = require("../server.js");
const { redisClient } = require("../redis.js");
const { K, KEEP } = require("../relay/keys.js");

const STEAMID = /^7656119\d{10}$/;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new HttpError(503, "Account sync isn't configured on this site.", "not_configured");
  return s;
}

/** The account's sync channel id: 32 hex characters, stable, unguessable without the site's secret. */
const accountPairId = (steamid) => crypto.createHmac("sha256", secret()).update(`steam-deals-sync:${steamid}`).digest("hex").slice(0, 32);

/** The Steam ID a store access token (a JWT) was issued to, or null. The signature is checked by Steam below. */
function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
    if (payload?.exp && payload.exp * 1000 < Date.now()) return null;
    return STEAMID.test(String(payload?.sub)) ? String(payload.sub) : null;
  } catch {
    return null;
  }
}

/** Ask Steam whether the token is genuine: reading the token owner's cart only works with a valid token. */
async function steamAccepts(token) {
  const input = encodeURIComponent(JSON.stringify({ user_country: "US" }));
  const res = await fetch(`https://api.steampowered.com/IAccountCartService/GetCart/v1/?access_token=${encodeURIComponent(token)}&input_json=${input}`, { signal: AbortSignal.timeout(10000) });
  const eresult = res.headers.get("x-eresult");
  return res.ok && (!eresult || eresult === "1");
}

const link = handler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  let steamid = null;
  if (req.method === "GET") {
    steamid = readSession(req)?.steamid || null;
    if (!steamid) throw new HttpError(401, "Sign in through Steam to sync this browser with your other devices.", "signed_out");
  } else if (req.method === "POST") {
    const token = String((await readJsonBody(req)).token || "");
    const sub = tokenSubject(token);
    if (!sub || !(await steamAccepts(token))) throw new HttpError(401, "Steam didn't confirm this sign-in. Sign in through Steam again.", "signed_out");
    steamid = sub;
  } else {
    throw new HttpError(405, "Use GET or POST.", "method");
  }

  const db = redisClient({ message: "Sync is unavailable right now.", code: "pair_down" });
  if (!db) return send(res, 200, { enabled: false });
  const pairId = accountPairId(steamid);
  const now = Date.now();
  // Open the channel the first time; afterwards just keep it alive.
  await db.pipeline([
    ["SET", K.pair(pairId), JSON.stringify({ createdAt: now, claimedAt: now, devices: 0, account: true }), "EX", KEEP, "NX"],
    ["EXPIRE", K.pair(pairId), KEEP],
    ["HSETNX", K.sig(pairId), "rev", "0"],
    ["EXPIRE", K.sig(pairId), KEEP],
  ]);
  send(res, 200, { enabled: true, pairId, steamid });
});

module.exports = Object.assign(link, { accountPairId, tokenSubject }); // the helpers, for the tests

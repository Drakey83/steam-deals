// Basket codes: a short code that carries a basket between devices (phone -> PC) for 24 hours.
// Stores only Steam app and package ids. No account, name or address is involved. Needs the same
// Upstash Redis as the user counter; without it the feature reports `enabled: false`.
const { send, handler, readJsonBody, HttpError } = require("./_lib/server.js");

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}
async function redis(cfg, ...command) {
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new HttpError(502, "Basket codes are unavailable right now.", "codes_down");
  return (await res.json()).result;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
function makeCode() {
  const bytes = require("node:crypto").randomBytes(6);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
const TTL = 24 * 60 * 60;

module.exports = handler(async (req, res) => {
  const cfg = redisConfig();
  res.setHeader("Access-Control-Allow-Origin", "*"); // the desktop app reads codes too
  if (!cfg) return send(res, 200, { enabled: false });

  if (req.method === "POST") {
    const body = await readJsonBody(req);
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((i) => ({ appid: Number(i.appid), packageid: Number(i.packageid) || null }))
      .filter((i) => Number.isInteger(i.appid) && i.appid > 0)
      .slice(0, 100);
    if (!items.length) throw new HttpError(400, "The basket is empty.", "bad_input");
    let code;
    for (let tries = 0; tries < 5; tries++) {
      code = makeCode();
      const ok = await redis(cfg, "SET", `sd:basket:${code}`, JSON.stringify(items), "EX", TTL, "NX");
      if (ok === "OK") break;
      code = null;
    }
    if (!code) throw new HttpError(503, "Couldn't make a code. Try again.", "codes_busy");
    return send(res, 200, { enabled: true, code, expiresIn: TTL });
  }

  const code = String((req.query || {}).code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) throw new HttpError(400, "A basket code is 6 letters and numbers.", "bad_input");
  const raw = await redis(cfg, "GET", `sd:basket:${code}`);
  if (!raw) throw new HttpError(404, "That code isn't valid or has expired (codes last 24 hours).", "not_found");
  send(res, 200, { enabled: true, code, items: JSON.parse(raw) });
});

// Phone ↔ PC pairing relay. The Windows app and a phone share a random pairing key once; after
// that the phone can hand baskets to the PC, which puts them in the Steam cart. Stored here:
// the pairing key (random, no account data) and the basket (Steam app/package ids only), 24 h.
//   start  → { code, pairId }            PC asks for a pairing code (10 minutes)
//   claim  → { pairId }                   phone redeems the code
//   check  → { claimed }                  PC asks whether the code was redeemed
//   send   → { sentAt }                   phone sends a basket
//   inbox  → { box|null }                 PC fetches the latest basket
//   ack    → { ok }                       PC reports what happened (received / added to cart)
//   status → { box|null }                 phone watches for the PC's report
//   unpair → { ok }                       either side forgets the pairing
const crypto = require("node:crypto");
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
  if (!res.ok) throw new HttpError(502, "Pairing is unavailable right now.", "pair_down");
  return (await res.json()).result;
}
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("");
const PAIR_RE = /^[a-f0-9]{32}$/;
const DAY = 86400;

module.exports = handler(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.", "method");
  const cfg = redisConfig();
  res.setHeader("Access-Control-Allow-Origin", "*"); // the Windows app calls this too
  if (!cfg) return send(res, 200, { enabled: false });
  const body = await readJsonBody(req);
  const action = String(body.action || "");
  const pairId = String(body.pairId || "");
  const needPair = () => {
    if (!PAIR_RE.test(pairId)) throw new HttpError(400, "Not paired.", "bad_pair");
    return pairId;
  };

  if (action === "start") {
    const id = crypto.randomBytes(16).toString("hex");
    let code = null;
    for (let i = 0; i < 5 && !code; i++) {
      const c = makeCode();
      if ((await redis(cfg, "SET", `sd:paircode:${c}`, id, "EX", 600, "NX")) === "OK") code = c;
    }
    if (!code) throw new HttpError(503, "Couldn't make a pairing code. Try again.", "pair_busy");
    await redis(cfg, "SET", `sd:pair:${id}`, JSON.stringify({ createdAt: Date.now(), claimedAt: null }), "EX", 600);
    return send(res, 200, { enabled: true, code, pairId: id, expiresIn: 600 });
  }

  if (action === "claim") {
    const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) throw new HttpError(400, "A pairing code is 6 letters and numbers.", "bad_input");
    const id = await redis(cfg, "GETDEL", `sd:paircode:${code}`);
    if (!id) throw new HttpError(404, "That code isn't valid or has expired. Codes last 10 minutes; ask the PC for a new one.", "not_found");
    await redis(cfg, "SET", `sd:pair:${id}`, JSON.stringify({ createdAt: Date.now(), claimedAt: Date.now() }), "EX", 365 * DAY);
    return send(res, 200, { enabled: true, pairId: id });
  }

  if (action === "check") {
    const raw = await redis(cfg, "GET", `sd:pair:${needPair()}`);
    const p = raw ? JSON.parse(raw) : null;
    if (p?.claimedAt) await redis(cfg, "EXPIRE", `sd:pair:${pairId}`, 365 * DAY);
    return send(res, 200, { claimed: Boolean(p?.claimedAt), expired: !p });
  }

  if (action === "send") {
    needPair();
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((i) => ({ appid: Number(i.appid), packageid: Number(i.packageid) || null }))
      .filter((i) => Number.isInteger(i.appid) && i.appid > 0)
      .slice(0, 100);
    if (!items.length) throw new HttpError(400, "The basket is empty.", "bad_input");
    const box = { items, sentAt: Date.now(), status: "sent", result: null };
    await redis(cfg, "SET", `sd:pairbox:${pairId}`, JSON.stringify(box), "EX", DAY);
    return send(res, 200, { sentAt: box.sentAt });
  }

  if (action === "inbox" || action === "status") {
    const raw = await redis(cfg, "GET", `sd:pairbox:${needPair()}`);
    return send(res, 200, { box: raw ? JSON.parse(raw) : null });
  }

  if (action === "ack") {
    needPair();
    const raw = await redis(cfg, "GET", `sd:pairbox:${pairId}`);
    if (!raw) return send(res, 200, { ok: true });
    const box = JSON.parse(raw);
    if (Number(body.sentAt) !== box.sentAt) return send(res, 200, { ok: true, stale: true });
    const status = ["received", "added", "failed"].includes(body.status) ? body.status : "received";
    const result = body.result && typeof body.result === "object" ? { added: Number(body.result.added) || 0, subtotal: String(body.result.subtotal || "").slice(0, 40), message: String(body.result.message || "").slice(0, 200) } : null;
    await redis(cfg, "SET", `sd:pairbox:${pairId}`, JSON.stringify({ ...box, status, result, ackedAt: Date.now() }), "EX", 3600);
    return send(res, 200, { ok: true });
  }

  if (action === "unpair") {
    needPair();
    await redis(cfg, "DEL", `sd:pair:${pairId}`, `sd:pairbox:${pairId}`);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(400, "Unknown action.", "bad_input");
});

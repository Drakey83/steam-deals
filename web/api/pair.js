// Pairing relay: the Steam Deals Windows app and the website (on a phone or in any browser) share one
// basket. Everything here is keyed by a random pairing id that both sides learned from a one-time
// 6-character code. Stored per pairing: the basket (Steam app/package ids plus the name and price shown
// in the UI), a small signal record (basket revision, "a phone is active", "the PC checked in"), and the
// PC's report of what is in the Steam cart. No account data, no names of people, nothing personal.
//
//   start       { pairId? }                   → { code, pairId, expiresIn }   PC asks for a code (10 min); with
//                                                                               pairId, a new code for the same pairing
//   claim       { code }                      → { pairId, rev }               phone/browser redeems the code
//   check       { pairId }                    → { claimed, expired }          PC waits for the code to be redeemed
//   sig         { pairId, touch?, pc?, withCart? } → { rev, active, pc, pcok, pcv, cart? }
//                                                                            cheap poll: has anything changed?
//   basket.get  { pairId }                    → { rev, items, updatedAt }
//   basket.ops  { pairId, ops, by }           → { rev, items, updatedAt }     add/remove/clear, applied atomically
//   cart.set    { pairId, cart, ok }          → { ok }                        PC reports Steam-cart status per game
//   unpair      { pairId }                    → { ok }                        the PC forgets the pairing (all devices)
//   send/inbox/ack/status                                                    legacy one-shot hand-off (v1.4–1.5 apps)
const crypto = require("node:crypto");
const { send, handler, readJsonBody, HttpError } = require("./_lib/server.js");
const { redisClient } = require("./_lib/redis.js");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("");
const PAIR_RE = /^[a-f0-9]{32}$/;
const DAY = 86400;
const KEEP = 365 * DAY; // a pairing lives a year past its last use
const ACTIVE_MS = 120000; // "a phone is looking" lasts this long after its last poll
const MAX_ITEMS = 100;

const K = {
  code: (c) => `sd:paircode:${c}`,
  pair: (id) => `sd:pair:${id}`,
  basket: (id) => `sd:basket:${id}`,
  sig: (id) => `sd:sig:${id}`,
  cart: (id) => `sd:cart:${id}`,
  box: (id) => `sd:pairbox:${id}`,
};

const str = (v, max) => String(v ?? "").slice(0, max);
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : 0);
function cleanItem(i) {
  const appid = int(i?.appid);
  if (appid <= 0) return null;
  const packageid = int(i?.packageid);
  return {
    appid,
    packageid: packageid > 0 ? packageid : null,
    name: str(i?.name, 120),
    price: str(i?.price, 30) || null,
    priceCents: Math.max(0, int(i?.priceCents)) || null,
    originalCents: Math.max(0, int(i?.originalCents)) || null,
    discount: Math.min(100, Math.max(0, int(i?.discount))),
  };
}
const emptyBasket = () => ({ rev: 0, items: [], updatedAt: 0, by: null });
const parse = (raw, fallback) => {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

// Compare-and-set: write the basket only if nobody else changed it since we read it.
// KEYS[1]=basket KEYS[2]=sig ARGV: expectedRev, basketJson, newRev, ttl, activeUntil ('' = leave)
const CAS = `
local cur = redis.call('HGET', KEYS[2], 'rev')
if cur == false then cur = '0' end
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
redis.call('HSET', KEYS[2], 'rev', ARGV[3])
if ARGV[5] ~= '' then redis.call('HSET', KEYS[2], 'active', ARGV[5]) end
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1`;

module.exports = handler(async (req, res) => {
  if (req.method !== "POST") throw new HttpError(405, "Use POST.", "method");
  const db = redisClient({ message: "Pairing is unavailable right now.", code: "pair_down" });
  res.setHeader("Access-Control-Allow-Origin", "*"); // the Windows app calls this too
  if (!db) return send(res, 200, { enabled: false });
  const body = await readJsonBody(req);
  const action = String(body.action || "");
  const pairId = String(body.pairId || "");
  const needPair = () => {
    if (!PAIR_RE.test(pairId)) throw new HttpError(400, "Not paired.", "bad_pair");
    return pairId;
  };
  const now = Date.now();

  if (action === "start") {
    // A PC that is already paired asks for another code so a second phone or browser can join the same basket.
    const existing = PAIR_RE.test(pairId) ? parse(await db.command("GET", K.pair(pairId)), null) : null;
    let id = existing ? pairId : null;
    const fresh = !id;
    if (!id) id = crypto.randomBytes(16).toString("hex");
    let code = null;
    for (let i = 0; i < 5 && !code; i++) {
      const c = makeCode();
      if ((await db.command("SET", K.code(c), id, "EX", 600, "NX")) === "OK") code = c;
    }
    if (!code) throw new HttpError(503, "Couldn't make a pairing code. Try again.", "pair_busy");
    if (fresh) await db.pipeline([["SET", K.pair(id), JSON.stringify({ createdAt: now, claimedAt: null, devices: 0 }), "EX", 600], ["HSET", K.sig(id), "rev", "0"], ["EXPIRE", K.sig(id), 600]]);
    return send(res, 200, { enabled: true, code, pairId: id, expiresIn: 600, devices: existing?.devices || 0 });
  }

  if (action === "claim") {
    const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) throw new HttpError(400, "A pairing code is 6 letters and numbers.", "bad_input");
    const id = await db.command("GETDEL", K.code(code));
    if (!id) throw new HttpError(404, "That code isn't valid or has expired. Codes last 10 minutes; ask the PC for a new one.", "not_found");
    const meta = parse(await db.command("GET", K.pair(id)), {}) || {};
    const [, , rev] = await db.pipeline([
      ["SET", K.pair(id), JSON.stringify({ createdAt: meta.createdAt || now, claimedAt: now, devices: (meta.devices || 0) + 1 }), "EX", KEEP],
      ["HSETNX", K.sig(id), "rev", "0"],
      ["HGET", K.sig(id), "rev"],
      ["EXPIRE", K.sig(id), KEEP],
    ]);
    return send(res, 200, { enabled: true, pairId: id, rev: Number(rev) || 0 });
  }

  if (action === "check") {
    const raw = await db.command("GET", K.pair(needPair()));
    const p = parse(raw, null);
    if (p?.claimedAt) await db.command("EXPIRE", K.pair(pairId), KEEP);
    return send(res, 200, { claimed: Boolean(p?.claimedAt), devices: p?.devices || 0, expired: !p });
  }

  if (action === "sig") {
    // The cheap poll both sides make. A phone adds touch=true to say "someone is looking", which makes the
    // PC check more often; the PC adds pc={ok} to say "I'm here and signed in (or not)".
    needPair();
    const h = (await db.command("HGETALL", K.sig(pairId))) || [];
    if (!h.length) throw new HttpError(404, "This pairing no longer exists. Pair again from the PC.", "bad_pair");
    const sig = {};
    for (let i = 0; i + 1 < h.length; i += 2) sig[h[i]] = h[i + 1];
    const cmds = [];
    const sets = [];
    if (body.touch) sets.push("active", String(now + ACTIVE_MS));
    if (body.pc && typeof body.pc === "object") sets.push("pc", String(now), "pcok", body.pc.ok ? "1" : "0", "pcv", str(body.pc.v, 20));
    if (sets.length) cmds.push(["HSET", K.sig(pairId), ...sets], ["EXPIRE", K.sig(pairId), KEEP]);
    if (body.withCart) cmds.push(["GET", K.cart(pairId)]);
    const out = cmds.length ? await db.pipeline(cmds) : [];
    // Echo what this very call just wrote, so a caller sees the state after its own update.
    if (body.touch) sig.active = String(now + ACTIVE_MS);
    if (body.pc && typeof body.pc === "object") Object.assign(sig, { pc: String(now), pcok: body.pc.ok ? "1" : "0", pcv: str(body.pc.v, 20) });
    const result = {
      rev: Number(sig.rev) || 0,
      active: Number(sig.active) > now,
      pc: Number(sig.pc) || 0,
      pcok: sig.pcok === "1",
      pcv: sig.pcv || null,
      now,
    };
    if (body.withCart) result.cart = parse(out[out.length - 1], null);
    return send(res, 200, result);
  }

  const alive = async () => {
    if (!(await db.command("EXISTS", K.pair(needPair())))) throw new HttpError(404, "This pairing no longer exists. Pair again from the PC.", "bad_pair");
  };

  if (action === "basket.get") {
    await alive();
    const b = parse(await db.command("GET", K.basket(pairId)), emptyBasket());
    return send(res, 200, { rev: b.rev || 0, items: b.items || [], updatedAt: b.updatedAt || 0 });
  }

  if (action === "basket.ops") {
    await alive();
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 200) : [];
    const by = ["pc", "phone", "web"].includes(body.by) ? body.by : "web";
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = parse(await db.command("GET", K.basket(pairId)), emptyBasket());
      const items = Array.isArray(cur.items) ? cur.items.map(cleanItem).filter(Boolean) : [];
      let changed = false;
      for (const op of ops) {
        if (op?.op === "clear" && items.length) {
          items.length = 0;
          changed = true;
        } else if (op?.op === "remove") {
          const appid = int(op.appid);
          const i = items.findIndex((x) => x.appid === appid);
          if (i >= 0) {
            items.splice(i, 1);
            changed = true;
          }
        } else if (op?.op === "add") {
          const item = cleanItem(op.item);
          if (!item) continue;
          const i = items.findIndex((x) => x.appid === item.appid);
          if (i >= 0) {
            // Refresh the price shown; the game is already in.
            if (JSON.stringify(items[i]) !== JSON.stringify(item)) {
              items[i] = item;
              changed = true;
            }
          } else if (items.length < MAX_ITEMS) {
            items.push(item);
            changed = true;
          }
        }
      }
      if (!changed) return send(res, 200, { rev: cur.rev || 0, items, updatedAt: cur.updatedAt || 0, applied: false });
      const next = { rev: (cur.rev || 0) + 1, items, updatedAt: now, by };
      const okFlag = await db.command("EVAL", CAS, 2, K.basket(pairId), K.sig(pairId), String(cur.rev || 0), JSON.stringify(next), String(next.rev), String(KEEP), by === "pc" ? "" : String(now + ACTIVE_MS));
      if (okFlag === 1) return send(res, 200, { rev: next.rev, items: next.items, updatedAt: now, applied: true });
    }
    throw new HttpError(409, "The basket is changing on another device. Try again.", "busy");
  }

  if (action === "cart.set") {
    await alive();
    const c = body.cart && typeof body.cart === "object" ? body.cart : {};
    const status = {};
    for (const [k, v] of Object.entries(c.status || {}).slice(0, MAX_ITEMS)) {
      const appid = int(k);
      if (appid > 0 && v && typeof v === "object") status[appid] = { s: str(v.s, 20), msg: str(v.msg, 160) || undefined, at: int(v.at) || now };
    }
    const doc = { at: now, status, subtotal: str(c.subtotal, 40) || null, count: int(c.count) };
    await db.pipeline([
      ["SET", K.cart(pairId), JSON.stringify(doc), "EX", KEEP],
      ["HSET", K.sig(pairId), "pc", String(now), "pcok", body.ok === false ? "0" : "1", "pcv", str(body.v, 20)],
      ["EXPIRE", K.sig(pairId), KEEP],
    ]);
    return send(res, 200, { ok: true });
  }

  if (action === "unpair") {
    needPair();
    await db.command("DEL", K.pair(pairId), K.box(pairId), K.basket(pairId), K.sig(pairId), K.cart(pairId));
    return send(res, 200, { ok: true });
  }

  // ----- legacy one-shot hand-off, still answered for older Windows apps -----
  if (action === "send") {
    needPair();
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((i) => ({ appid: int(i.appid), packageid: int(i.packageid) || null }))
      .filter((i) => i.appid > 0)
      .slice(0, MAX_ITEMS);
    if (!items.length) throw new HttpError(400, "The basket is empty.", "bad_input");
    const box = { items, sentAt: now, status: "sent", result: null };
    await db.command("SET", K.box(pairId), JSON.stringify(box), "EX", DAY);
    return send(res, 200, { sentAt: box.sentAt });
  }
  if (action === "inbox" || action === "status") {
    return send(res, 200, { box: parse(await db.command("GET", K.box(needPair())), null) });
  }
  if (action === "ack") {
    needPair();
    const box = parse(await db.command("GET", K.box(pairId)), null);
    if (!box) return send(res, 200, { ok: true });
    if (Number(body.sentAt) !== box.sentAt) return send(res, 200, { ok: true, stale: true });
    const status = ["received", "added", "failed"].includes(body.status) ? body.status : "received";
    const result = body.result && typeof body.result === "object" ? { added: int(body.result.added), subtotal: str(body.result.subtotal, 40), message: str(body.result.message, 200) } : null;
    await db.command("SET", K.box(pairId), JSON.stringify({ ...box, status, result, ackedAt: now }), "EX", 3600);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(400, "Unknown action.", "bad_input");
});

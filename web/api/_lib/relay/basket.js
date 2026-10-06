// The shared basket (add/remove/clear operations, applied atomically) and the PC's Steam-cart report.
const { HttpError } = require("../server.js");
const { K, KEEP, ACTIVE_MS } = require("./keys.js");
const { MAX_ITEMS, str, int, parse, cleanItem, emptyBasket } = require("./clean.js");

// Compare-and-set: write the basket only if nobody else changed it since we read it.
// KEYS[1]=basket KEYS[2]=sig ARGV: expectedRev, basketJson, newRev, ttl, activeUntil ('' = leave)
const BASKET_CAS = `
local cur = redis.call('HGET', KEYS[2], 'rev')
if cur == false then cur = '0' end
if cur ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[4])
redis.call('HSET', KEYS[2], 'rev', ARGV[3])
if ARGV[5] ~= '' then redis.call('HSET', KEYS[2], 'active', ARGV[5]) end
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1`;

/** Apply add/remove/clear operations to a list of games; returns whether anything changed. */
function applyOps(items, ops) {
  let changed = false;
  for (const op of ops) {
    if (op?.op === "clear" && items.length) {
      items.length = 0;
      changed = true;
    } else if (op?.op === "remove") {
      const i = items.findIndex((x) => x.appid === int(op.appid));
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
  return changed;
}

module.exports = {
  async "basket.get"({ db, alive }) {
    const id = await alive();
    const b = parse(await db.command("GET", K.basket(id)), emptyBasket());
    return { rev: b.rev || 0, items: b.items || [], updatedAt: b.updatedAt || 0, by: b.by || null };
  },

  async "basket.ops"({ db, body, alive, now }) {
    const id = await alive();
    const ops = Array.isArray(body.ops) ? body.ops.slice(0, 200) : [];
    const by = ["pc", "phone", "web"].includes(body.by) ? body.by : "web";
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = parse(await db.command("GET", K.basket(id)), emptyBasket());
      const items = Array.isArray(cur.items) ? cur.items.map(cleanItem).filter(Boolean) : [];
      if (!applyOps(items, ops)) return { rev: cur.rev || 0, items, updatedAt: cur.updatedAt || 0, applied: false };
      const next = { rev: (cur.rev || 0) + 1, items, updatedAt: now, by };
      const ok = await db.command("EVAL", BASKET_CAS, 2, K.basket(id), K.sig(id), String(cur.rev || 0), JSON.stringify(next), String(next.rev), String(KEEP), by === "pc" ? "" : String(now + ACTIVE_MS));
      if (ok === 1) return { rev: next.rev, items: next.items, updatedAt: now, applied: true };
    }
    throw new HttpError(409, "The basket is changing on another device. Try again.", "busy");
  },

  /** The PC reports the Steam-cart status per game (and checks in). */
  async "cart.set"({ db, body, alive, now }) {
    const id = await alive();
    const c = body.cart && typeof body.cart === "object" ? body.cart : {};
    const status = {};
    for (const [k, v] of Object.entries(c.status || {}).slice(0, MAX_ITEMS)) {
      const appid = int(k);
      if (appid > 0 && v && typeof v === "object") status[appid] = { s: str(v.s, 20), msg: str(v.msg, 160) || undefined, at: int(v.at) || now };
    }
    const doc = { at: now, status, subtotal: str(c.subtotal, 40) || null, count: int(c.count) };
    await db.pipeline([
      ["SET", K.cart(id), JSON.stringify(doc), "EX", KEEP],
      ["HSET", K.sig(id), "pc", String(now), "pcok", body.ok === false ? "0" : "1", "pcv", str(body.v, 20)],
      ["EXPIRE", K.sig(id), KEEP],
    ]);
    return { ok: true };
  },
};

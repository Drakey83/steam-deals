// Channels: making and redeeming codes, the cheap poll every device makes, and closing a code channel.
const crypto = require("node:crypto");
const { HttpError } = require("../server.js");
const { K, KEEP, ACTIVE_MS, BUSY_MS, TAG_RE, PAIR_RE } = require("./keys.js");
const { str, parse } = require("./clean.js");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = () => Array.from(crypto.randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("");
const CODE_TTL = 600;

module.exports = {
  /** The PC asks for a code (10 minutes). With its pairId, a new code for the same channel (another device). */
  async start({ db, body, now }) {
    const pairId = String(body.pairId || "");
    const existing = PAIR_RE.test(pairId) ? parse(await db.command("GET", K.pair(pairId)), null) : null;
    const id = existing ? pairId : crypto.randomBytes(16).toString("hex");
    let code = null;
    for (let i = 0; i < 5 && !code; i++) {
      const c = makeCode();
      if ((await db.command("SET", K.code(c), id, "EX", CODE_TTL, "NX")) === "OK") code = c;
    }
    if (!code) throw new HttpError(503, "Couldn't make a pairing code. Try again.", "pair_busy");
    if (!existing) await db.pipeline([["SET", K.pair(id), JSON.stringify({ createdAt: now, claimedAt: null, devices: 0 }), "EX", CODE_TTL], ["HSET", K.sig(id), "rev", "0"], ["EXPIRE", K.sig(id), CODE_TTL]]);
    return { enabled: true, code, pairId: id, expiresIn: CODE_TTL, devices: existing?.devices || 0 };
  },

  /** A phone or browser redeems a code. */
  async claim({ db, body, now }) {
    const code = String(body.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) throw new HttpError(400, "A pairing code is 6 letters and numbers.", "bad_input");
    const id = await db.command("GETDEL", K.code(code));
    if (!id) throw new HttpError(404, "That code isn't valid or has expired. Codes last 10 minutes; ask the PC for a new one.", "not_found");
    const meta = parse(await db.command("GET", K.pair(id)), {}) || {};
    const [, , rev] = await db.pipeline([
      ["SET", K.pair(id), JSON.stringify({ ...meta, createdAt: meta.createdAt || now, claimedAt: now, devices: (meta.devices || 0) + 1 }), "EX", KEEP],
      ["HSETNX", K.sig(id), "rev", "0"],
      ["HGET", K.sig(id), "rev"],
      ["EXPIRE", K.sig(id), KEEP],
    ]);
    return { enabled: true, pairId: id, rev: Number(rev) || 0 };
  },

  /** The PC waits for its code to be redeemed. */
  async check({ db, needPair }) {
    const id = needPair();
    const p = parse(await db.command("GET", K.pair(id)), null);
    if (p?.claimedAt) await db.command("EXPIRE", K.pair(id), KEEP);
    return { claimed: Boolean(p?.claimedAt), devices: p?.devices || 0, expired: !p };
  },

  /**
   * The cheap poll every device makes: has anything changed? A phone adds touch=true ("someone is looking", so
   * the PC checks more often); the PC adds pc={ok, v} ("I'm here, signed in or not, this version").
   * Busy mode: me=<device tag> names the caller; busy=true says "someone is using me right now" (for BUSY_MS).
   * The answer's `busy` is whether any *other* device is in use, so this one checks every second meanwhile.
   */
  async sig({ db, body, needPair, now }) {
    const id = needPair();
    const h = (await db.command("HGETALL", K.sig(id))) || [];
    if (!h.length) throw new HttpError(404, "This pairing no longer exists. Pair again from the PC.", "bad_pair");
    const sig = {};
    for (let i = 0; i + 1 < h.length; i += 2) sig[h[i]] = h[i + 1];
    const pc = body.pc && typeof body.pc === "object" ? { pc: String(now), pcok: body.pc.ok ? "1" : "0", pcv: str(body.pc.v, 20) } : null;
    const me = TAG_RE.test(String(body.me || "")) ? String(body.me) : null;
    const busyField = (f) => f.startsWith("busy:");
    const othersBusy = Object.keys(sig).some((f) => busyField(f) && f !== `busy:${me}` && Number(sig[f]) > now);
    const stale = Object.keys(sig).filter((f) => busyField(f) && Number(sig[f]) <= now && f !== `busy:${me}`);
    const sets = [];
    if (body.touch) sets.push("active", String(now + ACTIVE_MS));
    if (pc) sets.push(...Object.entries(pc).flat());
    if (me && body.busy) sets.push(`busy:${me}`, String(now + BUSY_MS));
    const cmds = [];
    if (sets.length) cmds.push(["HSET", K.sig(id), ...sets], ["EXPIRE", K.sig(id), KEEP]);
    if (sets.length && stale.length) cmds.push(["HDEL", K.sig(id), ...stale]); // devices no longer in use
    if (body.withCart) cmds.push(["GET", K.cart(id)]);
    const out = cmds.length ? await db.pipeline(cmds) : [];
    // Echo what this very call just wrote, so a caller sees the state after its own update.
    if (body.touch) sig.active = String(now + ACTIVE_MS);
    if (pc) Object.assign(sig, pc);
    const result = {
      rev: Number(sig.rev) || 0,
      arev: Number(sig.arev) || 0,
      prev: Number(sig.prev) || 0,
      active: Number(sig.active) > now,
      pc: Number(sig.pc) || 0,
      pcok: sig.pcok === "1",
      pcv: sig.pcv || null,
      busy: othersBusy,
      now,
    };
    if (body.withCart) result.cart = parse(out[out.length - 1], null);
    return result;
  },

  /**
   * The PC closes a code channel for every device. A Steam account's channel (../auth/link.js) belongs to every
   * device signed in to that account: leaving it happens on the device, and its data stays for the others.
   */
  async unpair({ db, needPair }) {
    const id = needPair();
    if (parse(await db.command("GET", K.pair(id)), null)?.account) return { ok: true, account: true };
    await db.command("DEL", K.pair(id), K.box(id), K.basket(id), K.sig(id), K.cart(id), K.alerts(id), K.prefs(id));
    return { ok: true };
  },
};

// Upstash Redis over its REST API (free plan, added through Vercel's Storage tab). Shared by the pairing relay,
// the anonymous counter and the price-history cache. Returns null when the project has no Redis configured,
// so each feature can turn itself off gracefully.
const { HttpError } = require("./server.js");

// The free plan has a monthly command limit shared by everyone. Once Upstash says it's reached, every caller gets
// one clear error ("over_limit"; devices then check only every half hour, see src/main/sync/index.js and
// web/src/browser-api/pairing.js), and this server instance stops asking Upstash for a while.
const OVER_LIMIT_RE = /max (daily |monthly )?requests? limit/i;
const OVER_LIMIT_PAUSE_MS = 10 * 60000;
let overLimitUntil = 0;
const overLimit = () =>
  new HttpError(503, "Syncing is paused for now: the free sync service reached its monthly limit. Everything still works on each device, and they catch up with each other when it resets.", "over_limit");

/**
 * @param {{ message?: string, code?: string }} [errors]  what callers see if Redis doesn't answer
 * @returns {{ command: (...args) => Promise<any>, pipeline: (cmds: any[][]) => Promise<any[]> } | null}
 */
function redisClient({ message = "Storage is unavailable right now.", code = "storage_down" } = {}) {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const post = async (path, body) => {
    if (Date.now() < overLimitUntil) throw overLimit();
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (OVER_LIMIT_RE.test(text)) {
        overLimitUntil = Date.now() + OVER_LIMIT_PAUSE_MS;
        throw overLimit();
      }
      throw new HttpError(502, message, code);
    }
    return res.json();
  };
  return {
    async command(...args) {
      const out = await post("", args);
      if (out.error && OVER_LIMIT_RE.test(out.error)) {
        overLimitUntil = Date.now() + OVER_LIMIT_PAUSE_MS;
        throw overLimit();
      }
      if (out.error) throw new HttpError(502, message, code);
      return out.result;
    },
    async pipeline(cmds) {
      if (!cmds.length) return [];
      const out = await post("/pipeline", cmds);
      if (out.some((r) => r?.error && OVER_LIMIT_RE.test(r.error))) {
        overLimitUntil = Date.now() + OVER_LIMIT_PAUSE_MS;
        throw overLimit();
      }
      return out.map((r) => r.result);
    },
  };
}

module.exports = { redisClient, OVER_LIMIT_RE };

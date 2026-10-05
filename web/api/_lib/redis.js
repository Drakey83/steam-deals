// Upstash Redis over its REST API (free plan, added through Vercel's Storage tab). Shared by the pairing relay,
// the anonymous counter and the price-history cache. Returns null when the project has no Redis configured,
// so each feature can turn itself off gracefully.
const { HttpError } = require("./server.js");

/**
 * @param {{ message?: string, code?: string }} [errors]  what callers see if Redis doesn't answer
 * @returns {{ command: (...args) => Promise<any>, pipeline: (cmds: any[][]) => Promise<any[]> } | null}
 */
function redisClient({ message = "Storage is unavailable right now.", code = "storage_down" } = {}) {
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const post = async (path, body) => {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new HttpError(502, message, code);
    return res.json();
  };
  return {
    async command(...args) {
      const out = await post("", args);
      if (out.error) throw new HttpError(502, message, code);
      return out.result;
    },
    async pipeline(cmds) {
      if (!cmds.length) return [];
      return (await post("/pipeline", cmds)).map((r) => r.result);
    },
  };
}

module.exports = { redisClient };

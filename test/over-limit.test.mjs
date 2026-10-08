// When the relay's free monthly limit is reached: the server says so clearly ("over_limit") and stops asking
// Upstash for a while, and the app backs off to a check every half hour instead of hammering the site.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);

test("Upstash's limit error becomes over_limit, and later calls fail fast without asking Upstash", async () => {
  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "t";
  const realFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async () => {
    asked += 1;
    return new Response(JSON.stringify({ error: "ERR max requests limit exceeded. Limit: 500000, Usage: 500000" }), { status: 400 });
  };
  try {
    const { redisClient } = require("../web/api/_lib/redis.js");
    const db = redisClient({ message: "Pairing is unavailable right now.", code: "pair_down" });
    await assert.rejects(db.command("GET", "x"), (e) => e.code === "over_limit" && e.status === 503);
    await assert.rejects(db.pipeline([["GET", "x"]]), (e) => e.code === "over_limit");
    assert.equal(asked, 1, "the second call didn't go to Upstash");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the app stops polling for half an hour once the relay is full, and tells the interface", async () => {
  const createSync = require("../src/main/sync/index.js");
  let calls = 0;
  const sent = [];
  const pairApi = async (action) => {
    if (action === "sig") calls += 1;
    throw Object.assign(new Error("Syncing is paused for now"), { code: "over_limit" });
  };
  const data = { basket: [], mirror: {}, account: null, pairAutoCart: false, pairId: "a".repeat(32), alerts: [], tasteTags: {}, prefsRev: 0 };
  const sync = createSync({
    settings: { get: () => data, update: (p) => Object.assign(data, p) },
    steam: {}, cartSession: async () => ({}), sessionFetch: null, pairApi, sendToUI: (c, p) => sent.push({ c, p }), version: "1.15.3",
    shouldNotify: () => false, inUse: () => true,
  });
  try {
    sync.nowInUse();
    await new Promise((r) => setTimeout(r, 300));
    sync.nowInUse(); // even being used doesn't make it check again
    sync.kick();
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(calls, 1);
    assert.equal(sync.status().overLimit, true);
    assert.ok(sent.some((m) => m.c === "cart:status" && m.p.overLimit === true));
  } finally {
    sync.stop();
  }
});

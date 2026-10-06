// Steam account sync on the server: which account a desktop token belongs to, the account's channel id, and that
// an account channel can't be wiped by "unpair" (web/api/_lib/auth/link.js, web/api/_lib/relay/channel.js).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-characters-long";
const require = createRequire(import.meta.url);
const { accountPairId, tokenSubject } = require("../web/api/_lib/auth/link.js");
const channel = require("../web/api/_lib/relay/channel.js");

const ME = "76561198000000001";
const jwt = (payload) => `${Buffer.from('{"alg":"EdDSA"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;

test("a desktop token names its account; expired, malformed or non-Steam ones name nobody", () => {
  const later = Math.floor(Date.now() / 1000) + 3600;
  assert.equal(tokenSubject(jwt({ sub: ME, exp: later })), ME);
  assert.equal(tokenSubject(jwt({ sub: ME, exp: Math.floor(Date.now() / 1000) - 10 })), null, "expired");
  assert.equal(tokenSubject(jwt({ sub: "12345", exp: later })), null, "not a SteamID64");
  assert.equal(tokenSubject("not-a-jwt"), null);
  assert.equal(tokenSubject(""), null);
});

test("an account's channel id is stable, relay-shaped, and different for every account", () => {
  const a = accountPairId(ME);
  assert.match(a, /^[a-f0-9]{32}$/);
  assert.equal(accountPairId(ME), a, "the same on every device");
  assert.notEqual(accountPairId("76561198000000002"), a);
  process.env.SESSION_SECRET = "a-different-secret-also-at-least-32-characters";
  assert.notEqual(accountPairId(ME), a, "unguessable without the site's secret");
  process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-characters-long";
});

function fakeDb(records) {
  const deleted = [];
  return {
    deleted,
    command: async (cmd, ...args) => {
      if (cmd === "GET") return records[args[0]] ?? null;
      if (cmd === "DEL") {
        deleted.push(...args);
        return args.length;
      }
      throw new Error(`unexpected ${cmd}`);
    },
  };
}

test("unpair never wipes a Steam account's channel (every signed-in device shares it)", async () => {
  const id = accountPairId(ME);
  const db = fakeDb({ [`sd:pair:${id}`]: JSON.stringify({ account: true }) });
  const r = await channel.unpair({ db, needPair: () => id });
  assert.deepEqual(r, { ok: true, account: true });
  assert.equal(db.deleted.length, 0);
});

test("unpair still closes a code channel for every device", async () => {
  const id = "c".repeat(32);
  const db = fakeDb({ [`sd:pair:${id}`]: JSON.stringify({ devices: 1 }) });
  const r = await channel.unpair({ db, needPair: () => id });
  assert.deepEqual(r, { ok: true });
  assert.ok(db.deleted.includes(`sd:basket:${id}`) && db.deleted.includes(`sd:prefs:${id}`));
});

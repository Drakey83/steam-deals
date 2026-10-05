// Live test of the pairing relay (web/api/pair.js) against a running deployment. Creates and deletes a
// throwaway pairing; touches no real basket or Steam cart.
//   node scripts/test-relay.mjs https://steamdeal.vercel.app
const base = process.argv[2];
if (!base) throw new Error("base url required");
let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
};
async function call(body, expectStatus = 200) {
  const res = await fetch(`${base}/api/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expectStatus) console.log(`     (HTTP ${res.status} for ${body.action}: ${JSON.stringify(data).slice(0, 200)})`);
  return { status: res.status, data };
}

const item = (appid, packageid, name, cents) => ({ appid, packageid, name, price: `$${(cents / 100).toFixed(2)}`, priceCents: cents, originalCents: cents * 10, discount: 90 });

// 1. PC starts a pairing
const s1 = await call({ action: "start" });
check("start gives a 6-char code and a 32-hex pairId", /^[A-Z2-9]{6}$/.test(s1.data.code) && /^[a-f0-9]{32}$/.test(s1.data.pairId), s1.data.code);
const pairId = s1.data.pairId;

// 2. not claimed yet
const c0 = await call({ action: "check", pairId });
check("check before claim → claimed:false", c0.data.claimed === false && c0.data.devices === 0);

// 3. sig works for a fresh pairing (rev 0)
const g0 = await call({ action: "sig", pairId });
check("sig on a fresh pairing → rev 0", g0.data.rev === 0 && g0.data.active === false);

// 4. phone claims
const cl = await call({ action: "claim", code: s1.data.code.toLowerCase() });
check("claim with lower-case code → same pairId, rev 0", cl.data.pairId === pairId && cl.data.rev === 0);
const c1 = await call({ action: "check", pairId });
check("check after claim → claimed:true, devices 1", c1.data.claimed === true && c1.data.devices === 1);
const again = await call({ action: "claim", code: s1.data.code }, 404);
check("a code can be used once", again.status === 404);

// 5. phone adds two games
const o1 = await call({ action: "basket.ops", pairId, by: "phone", ops: [{ op: "add", item: item(10, 7, "Counter-Strike", 99) }, { op: "add", item: item(20, 8, "Team Fortress Classic", 49) }] });
check("ops add two → rev 1, 2 items, applied", o1.data.rev === 1 && o1.data.items.length === 2 && o1.data.applied === true);

// 6. sig shows the change and that a phone is active
const g1 = await call({ action: "sig", pairId, withCart: true });
check("sig → rev 1, active (phone just wrote), no cart yet", g1.data.rev === 1 && g1.data.active === true && g1.data.cart === null);

// 7. PC heartbeat + pull
const g2 = await call({ action: "sig", pairId, pc: { ok: true, v: "1.6.0-test" } });
check("sig with pc heartbeat → pc timestamp, pcok", g2.data.pc > 0 && g2.data.pcok === true && g2.data.pcv === "1.6.0-test");
const b1 = await call({ action: "basket.get", pairId });
check("basket.get → 2 items with names and prices", b1.data.items.length === 2 && b1.data.items[0].name === "Counter-Strike" && b1.data.items[1].priceCents === 49);

// 8. PC reports cart status
const cs = await call({ action: "cart.set", pairId, ok: true, v: "1.6.0-test", cart: { status: { 10: { s: "added" }, 20: { s: "no_package", msg: "x" } }, subtotal: "$0.99", count: 2 } });
check("cart.set → ok", cs.data.ok === true);
const g3 = await call({ action: "sig", pairId, withCart: true, touch: true });
check("sig withCart → statuses per game + subtotal", g3.data.cart?.status?.[10]?.s === "added" && g3.data.cart?.status?.[20]?.s === "no_package" && g3.data.cart?.subtotal === "$0.99");

// 9. idempotent add, remove by PC, clear
const o2 = await call({ action: "basket.ops", pairId, by: "pc", ops: [{ op: "add", item: item(10, 7, "Counter-Strike", 99) }] });
check("re-adding the same item changes nothing (rev stays 1)", o2.data.rev === 1 && o2.data.applied === false);
const o3 = await call({ action: "basket.ops", pairId, by: "pc", ops: [{ op: "remove", appid: 20 }] });
check("remove → rev 2, 1 item", o3.data.rev === 2 && o3.data.items.length === 1 && o3.data.items[0].appid === 10);
const o4 = await call({ action: "basket.ops", pairId, by: "phone", ops: [{ op: "add", item: { appid: "bogus" } }, { op: "add", item: item(30, 9, "Half-Life", 199) }] });
check("junk items are dropped, good ones kept → rev 3, 2 items", o4.data.rev === 3 && o4.data.items.length === 2);

// 10. concurrent writers: 6 parallel adds all land
const burst = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => call({ action: "basket.ops", pairId, by: "web", ops: [{ op: "add", item: item(100 + n, 200 + n, `Game ${n}`, 100 * n) }] })));
const b2 = await call({ action: "basket.get", pairId });
check("6 parallel adds → all 6 present (compare-and-set retries)", b2.data.items.length === 8, `rev ${b2.data.rev}, statuses ${burst.map((r) => r.status).join(",")}`);

// 11. second device joins the same pairing through a new code
const s2 = await call({ action: "start", pairId });
check("start with pairId → new code for the same pairing, devices 1", s2.data.pairId === pairId && s2.data.devices === 1 && s2.data.code !== s1.data.code);
const cl2 = await call({ action: "claim", code: s2.data.code });
check("second claim → same pairId, current rev", cl2.data.pairId === pairId && cl2.data.rev === b2.data.rev);
const c2 = await call({ action: "check", pairId });
check("devices now 2", c2.data.devices === 2);

// 12. clear, then unpair; dead pairing is refused everywhere
const o5 = await call({ action: "basket.ops", pairId, by: "pc", ops: [{ op: "clear" }] });
check("clear → empty", o5.data.items.length === 0);
const un = await call({ action: "unpair", pairId });
check("unpair → ok", un.data.ok === true);
const dead1 = await call({ action: "sig", pairId }, 404);
const dead2 = await call({ action: "basket.ops", pairId, ops: [{ op: "add", item: item(1, 1, "x", 1) }] }, 404);
const dead3 = await call({ action: "basket.get", pairId }, 404);
check("sig / ops / get on a dead pairing → 404 bad_pair", dead1.data.error?.code === "bad_pair" && dead2.data.error?.code === "bad_pair" && dead3.data.error?.code === "bad_pair");
const bad = await call({ action: "sig", pairId: "nope" }, 400);
check("malformed pairId → 400", bad.status === 400);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall relay checks passed");
process.exit(failures ? 1 : 0);

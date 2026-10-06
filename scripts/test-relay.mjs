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

// 12. price alerts: the website writes its list, the PC writes back what fired; stale writes are refused
const alert = (appid, target, extra = {}) => ({ appid, name: `Game ${appid}`, country: "us", targetCents: target, priceSample: "$9.99", armed: true, createdAt: Date.now(), lastCents: 999, triggeredAt: null, triggeredCents: null, seen: true, ...extra });
const a0 = await call({ action: "alerts.get", pairId });
check("alerts.get on a new pairing → empty, rev 0", a0.data.rev === 0 && a0.data.alerts.length === 0);
const a1 = await call({ action: "alerts.set", pairId, rev: 0, alerts: [alert(10, 499), alert(10, 499), alert(20, 299), { appid: -1 }] });
check("alerts.set → applied, cleaned (deduped, junk dropped, region upper-case, origin web)", a1.data.applied === true && a1.data.rev === 1 && a1.data.alerts.length === 2 && a1.data.alerts.every((x) => x.country === "US" && x.origin === "web"));
const aSig = await call({ action: "sig", pairId });
check("sig carries the alert revision", aSig.data.arev === 1);
const aStale = await call({ action: "alerts.set", pairId, rev: 0, alerts: [] });
check("a stale alerts.set is refused and returns the current list", aStale.data.applied === false && aStale.data.rev === 1 && aStale.data.alerts.length === 2);
const fired = a1.data.alerts.map((x) => (x.appid === 10 ? { ...x, armed: false, triggeredAt: Date.now(), triggeredCents: 450, lastCents: 450, seen: true } : x));
const a2 = await call({ action: "alerts.set", pairId, rev: 1, alerts: fired });
check("PC writes back a fired alert", a2.data.applied === true && a2.data.alerts.find((x) => x.appid === 10).triggeredCents === 450);
const a3 = await call({ action: "alerts.get", pairId });
check("alerts.get returns it", a3.data.rev === 2 && a3.data.alerts.find((x) => x.appid === 10).armed === false);

// 13. "Your taste" edits: shared preferences with the same compare-and-set
const p0 = await call({ action: "prefs.get", pairId });
check("prefs.get on a new pairing → empty, rev 0", p0.data.rev === 0 && p0.data.prefs.tasteTags.added.length === 0);
const p1 = await call({ action: "prefs.set", pairId, rev: 0, prefs: { tasteTags: { added: [4004, "1628", -2, 4004], removed: [19], at: 1790000000000 } } });
check("prefs.set → applied and cleaned", p1.data.applied === true && p1.data.rev === 1 && JSON.stringify(p1.data.prefs.tasteTags.added) === "[4004,1628]");
const pSig = await call({ action: "sig", pairId });
check("sig carries the preferences revision", pSig.data.prev === 1);
const pStale = await call({ action: "prefs.set", pairId, rev: 0, prefs: { tasteTags: { added: [], removed: [], at: 1 } } });
check("a stale prefs.set is refused and returns the current edits", pStale.data.applied === false && pStale.data.prefs.tasteTags.added.length === 2);

// 14. clear, then unpair; dead pairing is refused everywhere
const o5 = await call({ action: "basket.ops", pairId, by: "pc", ops: [{ op: "clear" }] });
check("clear → empty", o5.data.items.length === 0);
const un = await call({ action: "unpair", pairId });
check("unpair → ok", un.data.ok === true);
const dead1 = await call({ action: "sig", pairId }, 404);
const dead2 = await call({ action: "basket.ops", pairId, ops: [{ op: "add", item: item(1, 1, "x", 1) }] }, 404);
const dead3 = await call({ action: "basket.get", pairId }, 404);
const dead4 = await call({ action: "alerts.get", pairId }, 404);
check("sig / ops / get / alerts on a dead pairing → 404 bad_pair", [dead1, dead2, dead3, dead4].every((d) => d.data.error?.code === "bad_pair"));
const bad = await call({ action: "sig", pairId: "nope" }, 400);
check("malformed pairId → 400", bad.status === 400);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall relay checks passed");
process.exit(failures ? 1 : 0);

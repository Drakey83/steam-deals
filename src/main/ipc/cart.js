// The Steam cart (desktop only: the signed-in store session can fill it directly), and pairing.
const settings = require("../settings");
const steam = require("../steam");
const { cartSession } = require("../steam-session");
const { pairApi, sync } = require("../pairing");
const { refreshTray } = require("../tray");
const { handle } = require("./handle");

function registerCart() {
  handle("cart:supported", () => ({ value: settings.get().account?.method === "steam" }));
  handle("cart:get", async () => {
    const { token, country } = await cartSession();
    return { cart: await steam.getCart(token, country) };
  });
  handle("cart:add", async ({ packageids = [] } = {}) => {
    const { token, country } = await cartSession();
    const result = await steam.addToCart(token, packageids, country);
    return { cart: { items: result.items, subtotal: result.subtotal, subtotalCents: result.subtotalCents }, added: result.added };
  });
  handle("cart:remove", async ({ lineItemIds = [] } = {}) => {
    const { token, country } = await cartSession();
    return { cart: await steam.removeFromCart(token, lineItemIds, country) };
  });
}

function registerPairing() {
  // "Claimed" means a device joined since this code was made (a pairing can already have devices).
  let devicesAtStart = 0;
  handle("pair:start", async () => {
    const r = await pairApi("start", { pairId: settings.get().pairId || undefined });
    if (r.enabled === false) throw new steam.SteamError("Pairing isn't available right now.", null, "pair_down");
    devicesAtStart = r.devices || 0;
    return { code: r.code, pairId: r.pairId, expiresIn: r.expiresIn };
  });
  handle("pair:check", async ({ pairId } = {}) => {
    const r = await pairApi("check", { pairId });
    const joined = Boolean(r.claimed) && (r.devices || 0) > devicesAtStart;
    if (joined && settings.get().pairId !== pairId) {
      settings.update({ pairId, basketRev: 0 });
      await sync.afterPaired();
      refreshTray();
    }
    return { claimed: joined, expired: Boolean(r.expired), devices: r.devices || 0 };
  });
  handle("pair:status", () => ({ paired: Boolean(settings.get().pairId), autoCart: settings.get().pairAutoCart !== false, sync: sync.status() }));
  handle("pair:unpair", async () => {
    const s = settings.get();
    if (s.pairId) await pairApi("unpair", { pairId: s.pairId }).catch(() => {});
    settings.update({ pairId: null, basketRev: 0, mirror: {} });
    sync.afterUnpaired();
    refreshTray();
    return { value: true };
  });
  handle("sync:status", () => sync.status());
  handle("sync:now", () => {
    sync.syncNow();
    return { value: true };
  });
}

function register() {
  registerCart();
  registerPairing();
}

module.exports = { register };

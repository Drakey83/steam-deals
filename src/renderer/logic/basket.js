// Basket arithmetic. Pure: no DOM, no network (unit-tested). `core` is src/shared/core.js.

/** The fields a basket entry keeps (enough to show it and put it in the Steam cart). */
export function basketItem(d) {
  return {
    appid: d.appid,
    packageid: d.packageid ?? null,
    name: d.name,
    price: d.price,
    priceCents: d.priceCents ?? null,
    originalCents: d.originalCents ?? null,
    discount: d.discount || 0,
    image: d.image || null, // the game's own art path (newer games have no plain header.jpg)
  };
}

/** Add the game if it's missing, remove it if it's there. Returns { list, added }. */
export function toggleInList(list, d) {
  const i = list.findIndex((b) => b.appid === d.appid);
  if (i >= 0) return { list: list.filter((_, j) => j !== i), added: false };
  return { list: [...list, basketItem(d)], added: true };
}

/**
 * Merge games handed over from elsewhere (a steamdeals:// link) into the basket.
 * `lookup` maps appid → full item; games it can't describe are skipped.
 */
export function mergeIncoming(list, incoming, lookup) {
  const out = list.slice();
  let added = 0;
  for (const i of incoming) {
    if (out.some((b) => b.appid === i.appid)) continue;
    const d = lookup.get(i.appid);
    if (!d) continue;
    out.push(basketItem({ ...d, packageid: d.packageid ?? i.packageid }));
    added++;
  }
  return { list: out, added };
}

/** Subtotal, savings and the estimated tax for the person's region. Money is in cents. */
export function basketTotals(items, settings, core) {
  const subtotal = items.reduce((s, b) => s + (b.priceCents || 0), 0);
  const original = items.reduce((s, b) => s + (b.originalCents || b.priceCents || 0), 0);
  const region = settings.taxRegion ?? core.defaultTaxRegion(settings.country);
  const { rate, taxCents } = core.estimateTax(subtotal, region, settings.taxCustomRate);
  return {
    items,
    subtotal,
    original,
    savings: Math.max(0, original - subtotal),
    region,
    rate,
    taxCents,
    total: subtotal + taxCents,
    sample: items.find((b) => b.price)?.price, // a real price string, for the currency format
  };
}

// Looking up games by app id with their current price (for price alerts and wishlist games outside the scan).
// Same result shape as the desktop app's items.lookup: normalized store items.
import { http } from "./http.js";
import { settings } from "./settings.js";

const Core = window.SteamCore;
const BATCH = 50;
const MAX = 100;

export async function lookupItems(appids) {
  const ids = [...new Set((appids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, MAX);
  const items = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    const r = await http(`/api/items?ids=${ids.slice(i, i + BATCH).join(",")}&cc=${settings.country}&l=${settings.language}&full=1`);
    for (const it of r.items || []) {
      it.tagids = (it.tags || []).map((t) => t.id);
      it.image = Core.headerImage(it.appid);
      it.url = Core.storeUrl(it.appid);
      items.push(it);
    }
  }
  return { items };
}

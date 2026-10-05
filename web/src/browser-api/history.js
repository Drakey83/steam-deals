// Price history for the website: /api/history (IsThereAnyDeal data; the key stays on the server).
// Responses are cached at the edge for days; this keeps a per-page copy so a game is asked for once.
import { http } from "./http.js";
import { settings } from "./settings.js";

const MAX_IDS = 200;
const memo = new Map(); // `${cc}:${appid}` → entry (with points once loaded)
let disabled = false;

/** { appids, points } → { enabled, source, items: { [appid]: { low, points? } } } */
export async function getHistory({ appids = [], points = false } = {}) {
  const cc = settings.country || "US";
  const ids = [...new Set(appids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b).slice(0, MAX_IDS);
  if (disabled || !ids.length) return { enabled: !disabled, items: {} };
  const items = {};
  const missing = ids.filter((a) => {
    const hit = memo.get(`${cc}:${a}`);
    if (hit && (!points || "points" in hit)) items[a] = hit;
    return !items[a];
  });
  if (missing.length) {
    const qs = points && ids.length === 1 ? `id=${ids[0]}&points=1` : `ids=${missing.join(",")}`;
    const data = await http(`/api/history?${qs}&cc=${cc}`);
    if (data.enabled === false) {
      disabled = true;
      return { enabled: false, items: {} };
    }
    for (const [appid, entry] of Object.entries(data.items || {})) {
      memo.set(`${cc}:${appid}`, entry);
      items[appid] = entry;
    }
  }
  return { enabled: true, source: "IsThereAnyDeal", items };
}

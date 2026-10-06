// Calls to the pairing relay (/api/pair): the one channel through which this browser shares its basket, price
// alerts and "Your taste" edits with the Steam Deals Windows app and other paired devices.
import { ApiError, http } from "./http.js";

export async function relay(body) {
  const r = await http("/api/pair", { method: "POST", body });
  if (r.enabled === false) throw new ApiError("Pairing isn't available on this site right now.", "pair_down");
  return r;
}

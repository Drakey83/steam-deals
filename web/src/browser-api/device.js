// Which kind of device the website is open on (decides phone vs desktop wording and Steam links).

export function device() {
  const forced = new URLSearchParams(location.search).get("device"); // testing aid: ?device=windows|mac|linux|ios|android
  if (["windows", "mac", "linux", "ios", "android"].includes(forced)) return forced;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Mac/.test(ua)) return "mac";
  return "linux";
}

export const isPhone = () => ["ios", "android"].includes(device());

/** Loads made by the layout test rig (?device=…) never touch the anonymous user counter. */
export const isTestLoad = () => new URLSearchParams(location.search).has("device");

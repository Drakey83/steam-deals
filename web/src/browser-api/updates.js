// Noticing a newer website. A tab left open keeps running the code it loaded, so after an update it can quietly
// miss new behaviour (and, for syncing, talk to the relay the old way). The build writes /version.json; this
// checks it now and then and whenever the tab comes back into view, and says so once when it changed.
import { emit } from "./events.js";

const CHECK_MS = 15 * 60 * 1000;

export function watchForUpdates(running) {
  let told = false;
  const check = async () => {
    if (told) return;
    try {
      const res = await fetch("/version.json", { cache: "no-store" });
      const { version } = await res.json();
      if (version && running && version !== running) {
        told = true;
        emit("update:available", { version });
      }
    } catch {
      /* offline or no file: try again later */
    }
  };
  setInterval(check, CHECK_MS);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
}

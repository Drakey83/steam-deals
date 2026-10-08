// Noticing a newer website. A tab left open keeps running the code it loaded, so after an update it can quietly
// miss new behaviour (and, for syncing, talk to the relay the old way). The build writes /version.json with a
// build id per deploy; this checks it every few minutes, whenever the tab comes back into view or gets focus.
// A newer build is put in place without asking: right away if the tab is in the background, otherwise the next
// time the person switches away (nothing is lost: settings and the basket live in this browser and on the relay;
// a reload re-reads both). The interface also offers a Reload button meanwhile.
import { emit } from "./events.js";

const CHECK_MS = 5 * 60 * 1000;
const SETTLE_MS = 3000; // let a sync write that's under way finish before reloading

export function watchForUpdates(running) {
  if (!running || running === "dev") return; // a local copy that wasn't built
  let newer = null;
  let timer = null;

  const reloadSoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => document.visibilityState === "hidden" && location.reload(), SETTLE_MS);
  };

  const check = async () => {
    if (newer) return;
    try {
      const res = await fetch("/version.json", { cache: "no-store" });
      const { version, build } = await res.json();
      if (!build || build === running) return;
      newer = build;
      if (document.visibilityState === "hidden") reloadSoon();
      else emit("update:available", { version });
    } catch {
      /* offline or no file: try again later */
    }
  };

  setInterval(check, CHECK_MS);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (newer) reloadSoon();
    } else {
      clearTimeout(timer);
      check();
    }
  });
}

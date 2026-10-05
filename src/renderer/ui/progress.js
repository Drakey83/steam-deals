// The thin progress bar under the title bar, and the status text in the desktop title bar.
import { $ } from "../lib/dom.js";
import { fmtInt } from "../lib/format.js";

/** p = null (hide) | { fetched, target } (determinate) | { label } (indeterminate). */
export function setProgress(p) {
  const bar = $("#progress");
  const status = $("#titlebar-status");
  if (!bar || !status) return;
  if (!p) {
    bar.hidden = true;
    bar.classList.remove("indeterminate");
    status.textContent = "";
    return;
  }
  bar.hidden = false;
  if (p.target) {
    bar.classList.remove("indeterminate");
    $(".progress-bar", bar).style.width = `${Math.min(100, (p.fetched / p.target) * 100)}%`;
    status.textContent = `Scanning Steam · ${fmtInt(p.fetched)} / ${fmtInt(p.target)}`;
  } else {
    bar.classList.add("indeterminate");
    status.textContent = p.label || "Loading…";
  }
}

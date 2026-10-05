// "Not interested": dismissing a game from a card or the details panel, and restoring it.
import { el } from "../lib/dom.js";
import { ICON } from "../lib/icons.js";
import { addDismissed, removeDismissed } from "../logic/dismiss.js";
import { learn } from "../learning.js";
import { dismissedList, patchSettings, state } from "../state.js";
import { closeDrawer } from "../ui/overlays.js";
import { toast } from "../ui/toast.js";
import { updateResults } from "./feed.js";

function save(list) {
  patchSettings({ dismissed: list }, { persistNow: true });
  // Re-rank right away (dismissals change the taste model) without jumping back to the top of the list.
  updateResults({ keepPlace: true });
}

export function dismissGame(d) {
  learn("dismissed", d);
  save(addDismissed(dismissedList(), d));
  if (state.selected?.appid === d.appid) closeDrawer();
  toast(`Not interested: ${d.name}. Similar games will rank lower.`, { type: "ok", action: () => restoreGame(d.appid), actionLabel: "Undo", timeout: 7000 });
}

export function restoreGame(appid) {
  save(removeDismissed(dismissedList(), appid));
}

export function restoreAll() {
  save([]);
}

/** The small "Not interested" button on cards (icon) and in the details panel (with a label). */
export function dismissButton(d, { label = false } = {}) {
  return el("button", {
    class: `btn btn-sm btn-ghost dismiss-btn ${label ? "" : "btn-icon"}`,
    title: "Not interested: hide this game and rank similar ones lower",
    "aria-label": `Not interested in ${d.name}`,
    html: ICON.eyeOff + (label ? "<span>Not interested</span>" : ""),
    onclick: (e) => {
      e.stopPropagation();
      dismissGame(d);
    },
  });
}

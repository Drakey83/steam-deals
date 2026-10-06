// The For-you panel above the cards: what the app learned from the library ("Your taste"), while it's learning, or
// why it couldn't. Its tags can be edited by hand (taste-tags.js has the dragging, the typing and the rules).
import { $, el } from "../lib/dom.js";
import { fmtInt, timeAgo } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { PHONE } from "../lib/platform.js";
import { patchSettings, state, tagName, tasteModel, viewMode } from "../state.js";
import { rebuildTaste } from "../data.js";
import { signInFromBrowse } from "./account.js";
import { TASTE_HELP, addTagInput, addToTaste, dragTag, removeFromTaste, resetTasteEdits, restoreToTaste, tagDropZone } from "./taste-tags.js";

export function renderForYouHead() {
  const host = $("#foryou-head");
  if (!host) return;
  host.replaceChildren();
  if (viewMode() !== "foryou") return;

  if (state.tasteLoading) {
    const p = state.tasteProgress;
    host.append(el("div", { class: "fy-head" },
      el("div", { class: "fy-title", html: ICON.sparkle }, el("span", {}, "Learning your taste")),
      el("div", { class: "muted" }, p?.total ? `Reading tags for ${fmtInt(p.done)} of ${fmtInt(p.total)} games you own…` : "Looking at your library and playtime…"),
      el("div", { class: "fy-bar" }, el("span", { style: { width: p?.total ? `${(p.done / p.total) * 100}%` : "15%" }, class: p?.total ? "" : "pulse" })),
    ));
    return;
  }

  const t = state.taste;
  if (!t) {
    const expired = state.tasteReason === "session_expired";
    const msg = expired ? "Your Steam session expired. Sign in again to get personal picks."
      : state.tasteReason === "private" ? "Your Steam profile's Game details are private, so your library can't be read. Set them to Public in Steam's privacy settings, or sign in with your own API key, then rebuild."
      : state.tasteReason === "empty" ? "Your library looks empty, so there's nothing to learn from yet."
      : "Couldn't build a taste profile from your library.";
    host.append(el("div", { class: "fy-head" },
      el("div", { class: "fy-title", html: ICON.warning }, el("span", {}, "No taste profile yet")),
      el("div", { class: "muted" }, msg),
      el("div", {}, el("button", { class: "btn btn-sm", onclick: expired ? signInFromBrowse : rebuildTaste }, expired ? "Sign in again" : "Try again"))));
    return;
  }

  const model = tasteModel();
  const phone = PHONE.matches; // phones start with the panel collapsed, and remember that separately
  const shown = phone ? state.settings.showTastePhone === true : state.settings.showTaste !== false;
  const toggle = el("button", {
    class: "btn btn-ghost btn-sm",
    title: shown ? "Hide this panel" : "Show your taste profile",
    "aria-expanded": shown,
    onclick: () => {
      patchSettings(phone ? { showTastePhone: !shown } : { showTaste: !shown }, { persistNow: true });
      renderForYouHead();
    },
  }, shown ? "Hide" : "Show");
  const chips = (model?.topTags || []).map((id) => tasteChip(id, model));
  const help = el("span", { class: "help-tip", tabindex: "0", role: "note", title: TASTE_HELP, "aria-label": TASTE_HELP }, "?");
  const title = el("div", { class: "fy-title", html: ICON.sparkle }, el("span", {}, "Your taste"), help);

  if (!shown) {
    host.append(el("div", { class: "fy-head fy-collapsed" },
      el("div", { class: "fy-row" }, title,
        el("span", { class: "muted fy-basis" }, `${fmtInt(chips.length)} signature tags · learned from ${fmtInt(t.basedOn)} games${t.builtAt ? ` · updated ${timeAgo(t.builtAt)}` : ""}`),
        el("div", { class: "spacer" }), toggle)));
    return;
  }
  const basis = `Learned from ${fmtInt(t.basedOn)} of your ${fmtInt(t.libraryCount)} games${t.hasPlaytime ? ", weighted by hours played" : ""}. It re-learns from your playtime every time the app refreshes.`;
  const anchors = t.anchors || [];
  const top = anchors.slice(0, 3).map((a) => (a.hours ? `${a.name} (${fmtInt(Math.round(a.hours))} h)` : a.name)).join(" · ");
  const lately = anchors.filter((a) => a.recent > 0).sort((a, b) => b.recent - a.recent).slice(0, 3).map((a) => a.name).join(" · ");
  const edited = model && (model.added.size || model.removed.size);
  const removed = [...(model?.removed || [])].map((id) => el("button", {
    class: "chip chip-sm taste-removed",
    title: `You removed ${tagName(id)} from your taste. Click to put it back.`,
    onclick: () => restoreToTaste(id),
  }, el("span", { "aria-hidden": "true" }, "↺ "), tagName(id)));
  const zone = tagDropZone(el("div", { class: "tags-wrap taste-drop", "data-drop-hint": "Drop here to add it to your taste" },
    chips.length ? chips : el("span", { class: "muted" }, "Not enough tagged games to find a pattern yet. Drag tags here from Tags, or add one.")), "sidebar", addToTaste);
  host.append(el("div", { class: "fy-head" },
    el("div", { class: "fy-row" }, title, el("div", { class: "spacer" }),
      addTagInput(),
      edited ? el("button", { class: "btn btn-ghost btn-sm", title: "Undo every tag you added or removed by hand", onclick: resetTasteEdits }, "Reset") : null,
      el("button", { class: "btn btn-ghost btn-sm", title: "Re-read your library and playtime now", html: `${ICON.refresh}<span>Rebuild</span>`, onclick: rebuildTaste }),
      toggle),
    zone,
    removed.length ? el("div", { class: "taste-removed-row" }, el("span", { class: "muted small" }, "Removed:"), removed) : null,
    el("div", { class: "muted fy-basis" }, basis, top ? ` Most played: ${top}.` : "", lately ? ` Lately: ${lately}.` : ""),
  ));
}

/** One tag of "Your taste": drag it to Tags, or click ×, to remove it. Tags you added are marked. */
function tasteChip(id, model) {
  const mine = model.added.has(id);
  const chip = el("span", {
    class: `chip on taste-chip ${mine ? "added" : ""}`,
    title: `${mine ? "You added this tag." : "Learned from your library."} Drag it onto Tags (left) or click × to remove it from your taste.`,
  },
  mine ? el("span", { class: "taste-plus", "aria-hidden": "true" }, "+") : null,
  el("span", {}, tagName(id)),
  el("button", { class: "taste-x", title: `Remove ${tagName(id)} from your taste`, "aria-label": `Remove ${tagName(id)} from your taste`, onclick: () => removeFromTaste(id) }, "×"));
  return dragTag(chip, id, "taste");
}

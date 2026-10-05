// Small pieces of UI used by several views.
import { el } from "../lib/dom.js";
import { fmtInt } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { api, steamLink } from "../lib/platform.js";
import { STEAM_CART_URL } from "../config.js";

/** A link that opens outside the app (Steam pages only; the platform layer enforces that). */
export function linkTo(url, label) {
  return el("a", {
    class: "link",
    href: "#",
    onclick: (e) => {
      e.preventDefault();
      api.openExternal(url);
    },
  }, label);
}

/** The Steam avatar, or a person icon. */
export function avatarEl(account, cls = "avatar") {
  if (account?.avatar) return el("img", { class: cls, src: account.avatar, alt: "" });
  return el("span", { class: cls, html: ICON.user, style: { display: "grid", placeItems: "center", color: "#fff", padding: "5px" } });
}

/** Small anonymous user count (website only; hidden when the counter isn't set up). */
export function usersLine() {
  const u = api.features?.users;
  if (!u || !u.total) return null;
  const week = u.week ? ` · ${fmtInt(u.week)} this week` : "";
  return el("div", { class: "users-line num", title: "Counted anonymously: one random id per browser, no names or Steam accounts." },
    `${fmtInt(u.total)} ${u.total === 1 ? "person has" : "people have"} used Steam Deals${week}`);
}

/** "Open my Steam cart" in the Steam app, and in the browser. */
export function openCartButtons(primary = false) {
  return el("div", { class: "btn-row" },
    el("button", { class: `btn btn-sm ${primary ? "btn-primary" : ""}`, html: `${ICON.play}<span>Open my Steam cart</span>`, onclick: () => api.openExternal(steamLink(STEAM_CART_URL)) }),
    el("button", { class: "btn btn-sm", html: `${ICON.external}<span>Cart in browser</span>`, onclick: () => api.openExternal(STEAM_CART_URL) }),
  );
}

/** A labelled on/off switch. */
export function switchEl(label, checked, onChange, { disabled = false } = {}) {
  const input = el("input", { type: "checkbox", checked: Boolean(checked), disabled });
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "toggle", style: disabled ? { opacity: 0.5 } : {} }, el("span", {}, label), input, el("span", { class: "switch" }));
}

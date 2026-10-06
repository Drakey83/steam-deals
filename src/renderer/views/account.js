// Signing in and out from inside the app, and the account chip + menu in the top bar.
import { $, el } from "../lib/dom.js";
import { ICON } from "../lib/icons.js";
import { api } from "../lib/platform.js";
import { emptyLibrary, state } from "../state.js";
import { loadAll, refreshLibrary } from "../data.js";
import { go } from "../router.js";
import { avatarEl } from "../ui/common.js";
import { closeAll, closeMenu, closeModal, isMenuOpen, openMenu } from "../ui/overlays.js";
import { toast } from "../ui/toast.js";
import { renderBanners } from "./feed.js";
import { openSettings } from "./settings.js";

/** From the sign-in screen into browsing, with a fresh (unknown) library. */
export function enterBrowse() {
  state.library = emptyLibrary();
  go("browse");
  loadAll();
}

/** Sign in through Steam without leaving the browse screen (guest → signed in, or session renewal). */
export async function signInFromBrowse() {
  const r = await api.auth.signIn();
  if (r.ok && r.account) {
    state.account = r.account;
    $("#account")?.replaceWith(accountChip());
    closeModal();
    await refreshLibrary();
    renderBanners();
    toast(`Welcome, ${r.account.name}`, { type: "ok" });
  } else if (!r.ok) toast(r.error.message, { type: "err" });
}

export async function signOut() {
  await api.deals.cancel();
  const r = await api.auth.signOut();
  if (r.ok) state.settings = r.settings;
  state.account = null;
  state.loading = false;
  closeAll();
  go("login");
}

/** The avatar + name button in the top bar. */
export function accountChip() {
  const a = state.account;
  const chip = el("button", { class: "account", id: "account", "aria-haspopup": "menu", title: !a || a.method === "guest" ? "Browsing as a guest. Click to sign in." : "Your account: library, sign-in and sign-out" }, avatarEl(a), el("span", { class: "name" }, a?.name || "Guest"));
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isMenuOpen()) closeMenu();
    else openMenu(chip, menuItems());
  });
  return chip;
}

function menuItems() {
  const a = state.account;
  const signedIn = a && a.method !== "guest";
  const item = (icon, label, onClick, cls = "") =>
    el("button", {
      class: `menu-item ${cls}`,
      role: "menuitem",
      html: icon,
      onclick: () => {
        closeMenu();
        onClick();
      },
    }, el("span", {}, label));
  return [
    signedIn
      ? el("div", { class: "menu-head" }, avatarEl(a),
          el("div", {}, el("div", { style: { fontWeight: 600 } }, a.name), el("div", { class: "sub" }, a.method === "steam" ? "Signed in through Steam" : "Using a Steam Web API key")))
      : null,
    signedIn ? item(ICON.library, "Refresh library", refreshLibrary) : item(ICON.login, "Sign in through Steam", signInFromBrowse),
    signedIn ? item(ICON.external, "View Steam profile", () => api.openExternal(`https://steamcommunity.com/profiles/${a.steamid}/`)) : null,
    item(ICON.refresh, "Refresh deals", () => loadAll({ force: true })),
    item(ICON.settings, "Settings", openSettings),
    signedIn ? item(ICON.logout, "Sign out", signOut, "btn-danger") : item(ICON.logout, "Back to start", signOut),
  ];
}

// The sign-in screen: Steam sign-in, guest browsing, or a Steam Web API key.
import { $, el } from "../lib/dom.js";
import { fmtInt } from "../lib/format.js";
import { ICON } from "../lib/icons.js";
import { api, isWeb } from "../lib/platform.js";
import { state } from "../state.js";
import { linkTo, usersLine } from "../ui/common.js";
import { setProgress } from "../ui/progress.js";
import { toast } from "../ui/toast.js";
import { enterBrowse } from "./account.js";

const API_KEY_URL = "https://steamcommunity.com/dev/apikey";

export function renderLogin() {
  const app = $("#app");
  app.innerHTML = "";
  setProgress(null);

  const signInBtn = el("button", { class: "btn btn-steam", html: `${ICON.login}<span>Sign in through Steam</span>` });
  signInBtn.addEventListener("click", async () => {
    signInBtn.disabled = true;
    signInBtn.innerHTML = `${ICON.login}<span>Waiting for Steam…</span>`;
    const r = await api.auth.signIn();
    if (r.ok && r.account) {
      state.account = r.account;
      enterBrowse();
      toast(`Welcome, ${r.account.name}`, { type: "ok" });
      return;
    }
    signInBtn.disabled = false;
    signInBtn.innerHTML = `${ICON.login}<span>Sign in through Steam</span>`;
    if (!r.ok) toast(r.error.message, { type: "err" });
  });

  const guestBtn = el("button", { class: "btn btn-ghost" }, "Browse as guest");
  guestBtn.addEventListener("click", async () => {
    const r = await api.auth.continueAsGuest();
    if (r.ok) {
      state.account = r.account;
      enterBrowse();
    }
  });

  const canSignIn = !isWeb || api.features?.steamSignIn;
  const card = el("div", { class: "login-card" },
    el("div", { class: "login-logo", html: ICON.percent }),
    el("h1", {}, "Steam Deals"),
    el("p", { class: "tagline" }, "The best discounts on Steam right now, minus everything you already own."),
    el("div", { class: "login-actions" }, canSignIn ? signInBtn : null, guestBtn),
    apiKeyForm(canSignIn),
    el("p", { class: "login-foot" }, isWeb
      ? "Sign in on Steam's own page: this site never sees your password and only reads your game list and playtime. Signing in needs your profile's Game details set to Public. Your settings stay in this browser."
      : "You sign in on Steam's own page. This app never sees your password and only reads which games you own. Nothing leaves your computer except requests to Steam."),
    isWeb ? el("p", { class: "login-app" }, linkTo("/app", "Have a Windows PC? Get the free app"), ": it keeps your Steam cart in sync with your basket, from this site or your phone.") : null,
    usersLine(),
  );
  app.append(el("div", { class: "login" },
    el("div", { class: "blobs" }, el("div", { class: "blob blob-a" }), el("div", { class: "blob blob-b" }), el("div", { class: "blob blob-c" })),
    card));
}

function apiKeyForm(canSignIn) {
  const keyInput = el("input", { class: "input", type: "password", placeholder: "Steam Web API key", autocomplete: "off", spellcheck: "false" });
  const idInput = el("input", { class: "input", type: "text", placeholder: "SteamID64 or profile name", autocomplete: "off", spellcheck: "false" });
  const keyBtn = el("button", { class: "btn btn-sm" }, "Continue with API key");
  keyBtn.addEventListener("click", async () => {
    keyBtn.disabled = true;
    const r = await api.auth.useApiKey({ apiKey: keyInput.value, steamIdOrVanity: idInput.value });
    keyBtn.disabled = false;
    if (!r.ok) return toast(r.error.message, { type: "err", timeout: 7000 });
    state.account = r.account;
    enterBrowse();
    toast(`Found ${fmtInt(r.ownedCount)} games in your library`, { type: "ok" });
  });
  const hint = isWeb
    ? ["Get a free key at ", linkTo(API_KEY_URL, "steamcommunity.com/dev/apikey"), ". It stays in this browser and is only ever sent on to Steam."]
    : ["Get a free key at ", linkTo(API_KEY_URL, "steamcommunity.com/dev/apikey"), ". Your profile's Game details must be public."];
  return el("details", { class: "advanced", open: !canSignIn },
    el("summary", {}, canSignIn ? "Use a Steam Web API key instead" : "Use your Steam Web API key"),
    el("div", { class: "advanced-form" },
      el("label", {}, "API key"), keyInput,
      el("label", {}, "Your Steam account"), idInput,
      el("div", { class: "hint" }, ...hint),
      keyBtn,
    ),
  );
}

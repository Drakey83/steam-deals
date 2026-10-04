// Steam Deals "Fill my Steam cart" button.
// Runs on a store.steampowered.com page the person is signed in to (a bookmarklet on desktop and
// Android, an iOS Shortcut "Run JavaScript on Web Page" on iPhone/iPad). Reads the package ids from
// the address (#sd=1,2,3), asks Steam's page for its own session token, and adds the items to the
// account cart through Steam's cart service, which only accepts calls from Steam's own pages.
// Nothing is purchased: the person reviews and pays in Steam's normal checkout.
(async () => {
  const notice = (text, ok) => {
    let n = document.getElementById("sd-notice");
    if (!n) {
      n = document.createElement("div");
      n.id = "sd-notice";
      n.style.cssText =
        "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;max-width:92vw;padding:12px 16px;border-radius:12px;font:600 15px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.45)";
      document.body.appendChild(n);
    }
    n.style.background = ok ? "#2a7a3b" : "#8a2d2d";
    n.textContent = text;
  };
  try {
    if (!/(^|\.)steampowered\.com$/.test(location.hostname)) {
      notice("Open this on store.steampowered.com. In Steam Deals, press “Send to Steam” first, then run the button on the Steam page that opens.", false);
      return;
    }
    const m = (location.hash || "").match(/sd=([\d,]+)/);
    if (!m) {
      notice("No basket found in the address. In Steam Deals, press “Send to Steam” and run this button on the page it opens.", false);
      return;
    }
    const ids = [...new Set(m[1].split(",").map(Number).filter((n) => n > 0))];
    notice(`Adding ${ids.length} game${ids.length === 1 ? "" : "s"} to your Steam cart…`, true);
    const cfg = await (await fetch("/pointssummary/ajaxgetasyncconfig", { credentials: "same-origin" })).json();
    const token = cfg && cfg.data && cfg.data.webapi_token;
    if (!token) {
      notice("Steam says you're not signed in here. Sign in to the Steam store in this browser, then try again.", false);
      return;
    }
    let country = "US";
    try {
      country = JSON.parse(document.querySelector("[data-userinfo]").getAttribute("data-userinfo")).country_code || country;
    } catch (e) {
      /* keep default */
    }
    const r = await fetch("https://api.steampowered.com/IAccountCartService/AddItemsToCart/v1/?access_token=" + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "input_json=" + encodeURIComponent(JSON.stringify({ user_country: country, items: ids.map((packageid) => ({ packageid })) })),
    });
    const eresult = r.headers.get("x-eresult");
    if (!r.ok || (eresult && eresult !== "1")) {
      notice("Steam didn't accept the items (code " + (eresult || r.status) + "). Try again in a moment.", false);
      return;
    }
    const data = await r.json();
    const n = ((data.response && data.response.cart && data.response.cart.line_items) || []).length;
    notice(`Done: ${n} item${n === 1 ? "" : "s"} in your Steam cart. Loading it now…`, true);
    setTimeout(() => {
      location.replace("/cart/");
    }, 900);
  } catch (e) {
    notice("Couldn't add to cart: " + (e && e.message ? e.message : e), false);
  }
})();

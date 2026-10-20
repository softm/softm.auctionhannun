(function (root) {
  "use strict";

  const states = new Map();
  const appWithNativeAds = /\bAdMobNative\/\d+\b/.test(root.navigator?.userAgent || "");
  const callbacks = Object.freeze({
    results: {failed: "auctionhannunResultsAdFailed", loaded: "auctionhannunResultsAdLoaded"}
  });

  function config() {
    return root.AUCTIONHANNUN_AD_CONFIG || {};
  }

  function validSlot(slot) {
    return /^DAN-[A-Za-z0-9]+$/.test(String(slot?.unit || "").trim())
      && Number(slot?.width) === 320
      && Number(slot?.height) === 100;
  }

  function hide(state) {
    root.clearTimeout(state.timeout);
    state.failed = true;
    state.zone.hidden = true;
    state.host.replaceChildren();
  }

  function load(state) {
    if (state.requested || state.failed || root.document.hidden) return;
    const settings = config();
    const slot = settings.placements?.[state.placement];
    if (!settings.enabled || appWithNativeAds || !validSlot(slot) || state.host.clientWidth < slot.width) {
      hide(state);
      return;
    }

    state.requested = true;
    state.zone.hidden = false;
    state.zone.dataset.state = "loading";

    const ad = root.document.createElement("ins");
    ad.className = "kakao_ad_area";
    ad.style.display = "none";
    ad.dataset.adUnit = slot.unit;
    ad.dataset.adWidth = String(slot.width);
    ad.dataset.adHeight = String(slot.height);
    ad.dataset.adOnfail = callbacks[state.placement].failed;
    ad.dataset.adOnload = callbacks[state.placement].loaded;
    state.ad = ad;
    state.host.appendChild(ad);

    const script = root.document.createElement("script");
    script.async = true;
    script.charset = "utf-8";
    script.src = settings.script || "https://t1.kakaocdn.net/kas/static/ba.min.js";
    script.onerror = () => hide(state);
    script.onload = () => {
      state.timeout = root.setTimeout(() => {
        if (!state.host.querySelector("iframe")) hide(state);
      }, 30000);
    };
    root.document.head.appendChild(script);
  }

  function register(id, placement) {
    const zone = root.document.getElementById(id);
    const host = zone?.querySelector("[data-adfit-host]");
    if (!zone || !host || states.has(placement)) return;
    const state = {zone, host, placement, requested: false, failed: false, ad: null, timeout: 0, observer: null};
    states.set(placement, state);
    if (!config().enabled || appWithNativeAds || !validSlot(config().placements?.[placement])) {
      hide(state);
      return;
    }
    zone.hidden = false;
    if (!root.IntersectionObserver) {
      load(state);
      return;
    }
    state.observer = new root.IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      state.observer.disconnect();
      load(state);
    }, {rootMargin: "200px 0px"});
    state.observer.observe(state.zone);
  }

  for (const [placement, names] of Object.entries(callbacks)) {
    root[names.failed] = ad => {
      const state = states.get(placement);
      if (state?.ad === ad) hide(state);
    };
    root[names.loaded] = ad => {
      const state = states.get(placement);
      if (state?.ad !== ad || state.failed) return;
      root.clearTimeout(state.timeout);
      state.zone.dataset.state = "loaded";
    };
  }

  function init() {
    register("resultsAd", "results");
    root.document.addEventListener("visibilitychange", () => {
      const state = states.get("results");
      if (!root.document.hidden && state && !state.requested && !state.failed) load(state);
    });
  }

  root.AuctionhannunAds = Object.freeze({init});
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, {once: true});
  else init();
})(typeof window === "undefined" ? globalThis : window);

(function (root) {
  "use strict";

  const states = new Map();
  const stateByAd = new WeakMap();
  const appWithNativeAds = /\bAdMobNative\/\d+\b/.test(root.navigator?.userAgent || "");
  const ENTRY_SEEN_KEY = "auctionhannun:entry-ad-seen";
  const BOTTOM_COLLAPSED_KEY = "auctionhannun:bottom-ad-collapsed";

  function config() { return root.AUCTIONHANNUN_AD_CONFIG || {}; }
  function resolveSlot(placement) {
    const settings = config();
    const value = settings.placements?.[placement];
    if (!value) return null;
    if (value.mobile || value.desktop) {
      const desktop = root.matchMedia?.(`(min-width: ${settings.desktopBreakpoint || 768}px)`).matches;
      return desktop ? value.desktop : value.mobile;
    }
    return value;
  }
  function validSlot(slot) {
    return /^DAN-[A-Za-z0-9]+$/.test(String(slot?.unit || "").trim())
      && Number.isInteger(Number(slot?.width)) && Number.isInteger(Number(slot?.height))
      && Number(slot.width) > 0 && Number(slot.height) > 0;
  }
  function closeEntry() {
    const backdrop = root.document.getElementById("entryAdBackdrop");
    if (!backdrop) return;
    backdrop.hidden = true;
    root.document.body.classList.remove("entry-ad-open");
  }
  function hide(state) {
    root.clearTimeout(state.timeout);
    state.failed = true;
    state.zone.dataset.state = "failed";
    state.zone.hidden = true;
    state.host.replaceChildren();
    if (state.placement === "entry") closeEntry();
  }
  function entryAllowed(slot) {
    const hours = Number(config().placements?.entry?.cooldownHours) || 24;
    const seen = Number(root.localStorage?.getItem(ENTRY_SEEN_KEY) || 0);
    return validSlot(slot) && Date.now() - seen >= hours * 3600000;
  }
  function showLoadedState(state) {
    root.clearTimeout(state.timeout);
    state.zone.dataset.state = "loaded";
    if (state.placement !== "entry") return;
    root.localStorage?.setItem(ENTRY_SEEN_KEY, String(Date.now()));
    const delay = Math.max(0, Number(config().placements?.entry?.delayMs) || 0);
    root.setTimeout(() => {
      if (state.failed || root.document.hidden) return;
      state.zone.hidden = false;
      root.document.getElementById("entryAdBackdrop").hidden = false;
      root.document.body.classList.add("entry-ad-open");
      root.document.getElementById("entryAdClose")?.focus({preventScroll: true});
    }, delay);
  }
  function load(state) {
    if (state.requested || state.failed || root.document.hidden) return;
    const settings = config();
    const slot = resolveSlot(state.placement);
    if (!settings.enabled || appWithNativeAds || !validSlot(slot) || (state.placement === "entry" && !entryAllowed(slot))) {
      hide(state); return;
    }
    if (state.host.clientWidth && state.host.clientWidth < slot.width) { hide(state); return; }
    state.requested = true;
    state.zone.dataset.state = "loading";
    state.host.style.width = `${slot.width}px`;
    state.host.style.minHeight = `${slot.height}px`;
    const ad = root.document.createElement("ins");
    ad.className = "kakao_ad_area";
    ad.style.display = "none";
    ad.dataset.adUnit = slot.unit;
    ad.dataset.adWidth = String(slot.width);
    ad.dataset.adHeight = String(slot.height);
    ad.dataset.adOnfail = "auctionhannunAdFailed";
    ad.dataset.adOnload = "auctionhannunAdLoaded";
    state.ad = ad;
    stateByAd.set(ad, state);
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
  function register(id, placement, {lazy = true} = {}) {
    const zone = root.document.getElementById(id);
    const host = zone?.querySelector("[data-adfit-host]");
    const existing = states.get(placement);
    if (!zone || !host || (existing && existing.zone === zone)) return;
    if (existing) hide(existing);
    const state = {zone, host, placement, requested: false, failed: false, ad: null, timeout: 0, observer: null};
    states.set(placement, state);
    const slot = resolveSlot(placement);
    if (!config().enabled || appWithNativeAds || !validSlot(slot)) { hide(state); return; }
    if (placement !== "entry") zone.hidden = false;
    if (!lazy || !root.IntersectionObserver) { load(state); return; }
    state.observer = new root.IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      state.observer.disconnect(); load(state);
    }, {rootMargin: "240px 0px"});
    state.observer.observe(zone);
  }
  root.auctionhannunAdFailed = ad => {
    const state = stateByAd.get(ad);
    if (state?.ad === ad) hide(state);
  };
  root.auctionhannunAdLoaded = ad => {
    const state = stateByAd.get(ad);
    if (state?.ad === ad && !state.failed) showLoadedState(state);
  };
  function bindControls() {
    root.document.getElementById("entryAdClose")?.addEventListener("click", closeEntry);
    root.document.getElementById("entryAdBackdrop")?.addEventListener("click", event => {
      if (event.target === event.currentTarget) closeEntry();
    });
    root.document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !root.document.getElementById("entryAdBackdrop")?.hidden) closeEntry();
    });
    const bottom = root.document.getElementById("bottomAd");
    const toggle = root.document.getElementById("bottomAdToggle");
    const collapsed = root.sessionStorage?.getItem(BOTTOM_COLLAPSED_KEY) === "1";
    bottom?.classList.toggle("collapsed", collapsed);
    toggle?.setAttribute("aria-expanded", String(!collapsed));
    if (collapsed && toggle) toggle.textContent = "광고 펼치기";
    toggle?.addEventListener("click", () => {
      const next = !bottom.classList.contains("collapsed");
      bottom.classList.toggle("collapsed", next);
      toggle.setAttribute("aria-expanded", String(!next));
      toggle.textContent = next ? "광고 펼치기" : "광고 접기";
      root.sessionStorage?.setItem(BOTTOM_COLLAPSED_KEY, next ? "1" : "0");
    });
  }
  function registerInfeed() { register("infeedAd", "infeed"); }
  function init() {
    bindControls();
    register("entryAd", "entry", {lazy: false});
    register("bottomAd", "bottom", {lazy: false});
    registerInfeed();
    root.document.addEventListener("auctionhannun:ads-updated", registerInfeed);
    root.document.addEventListener("visibilitychange", () => {
      if (!root.document.hidden) for (const state of states.values()) if (!state.requested && !state.failed) load(state);
    });
  }
  root.AuctionhannunAds = Object.freeze({init, closeEntry});
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, {once: true});
  else init();
})(typeof window === "undefined" ? globalThis : window);

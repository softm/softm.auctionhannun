(function (root) {
  "use strict";

  const states = new Map();
  const stateByAd = new WeakMap();
  const appWithNativeAds = /\bAdMobNative\/\d+\b/.test(root.navigator?.userAgent || "");
  const ENTRY_SEEN_KEY = "auctionhannun:entry-ad-seen";
  const BOTTOM_COLLAPSED_KEY = "auctionhannun:bottom-ad-collapsed";
  // Hide ads below 600px of usable height. From 600–639px the stylesheet
  // keeps a complete, non-sticky map in document flow. Base this cutoff on
  // the viewport, never dock height, so showing/hiding cannot oscillate.
  const MIN_AD_VIEWPORT_HEIGHT = 600;
  const pendingScripts = new Set();
  let initialized = false;
  let scriptTimer = 0;
  let sdkState = "idle";
  let resizeTimer = 0;
  let bottomCollapsed = false;
  let entryClosed = false;

  function config() { return root.AUCTIONHANNUN_AD_CONFIG || {}; }
  function storageGet(kind, key) { try { return root[kind]?.getItem(key); } catch { return null; } }
  function storageSet(kind, key, value) { try { root[kind]?.setItem(key, value); } catch {} }
  function enabled(placement) {
    const settings = config();
    if (!settings.enabled || appWithNativeAds || settings.placements?.[placement]?.enabled === false) return false;
    if (root.location?.protocol !== "https:" || !settings.allowedHosts?.includes(root.location?.hostname)) return false;
    return placement !== "entry" || settings.placements.entry.enabled === true && settings.placements.entry.policyApproved === true;
  }
  function validSlot(slot) {
    return /^DAN-[A-Za-z0-9]+$/.test(String(slot?.unit || "").trim())
      && Number.isInteger(slot?.width) && Number.isInteger(slot?.height)
      && slot.width > 0 && slot.height > 0;
  }
  function availableWidth(state) {
    const style = root.getComputedStyle?.(state.zone);
    const padding = (parseFloat(style?.paddingLeft) || 0) + (parseFloat(style?.paddingRight) || 0);
    return Math.max(0, state.zone.clientWidth - padding);
  }
  function resolveSlot(state) {
    const settings = config();
    const value = settings.placements?.[state.placement];
    if (!value) return null;
    const width = availableWidth(state);
    const desktop = root.matchMedia?.(`(min-width: ${settings.desktopBreakpoint || 768}px)`).matches;
    const candidates = value.mobile || value.desktop ? (desktop ? [value.desktop, value.mobile] : [value.mobile]) : [value];
    return candidates.find(slot => validSlot(slot) && slot.width <= width) || null;
  }
  function busy() {
    const document = root.document;
    const viewportHeight = Math.min(Number(root.innerHeight) || Infinity, Number(root.visualViewport?.height) || Infinity);
    return document.body.classList.contains("detail-open")
      || Boolean(document.querySelector("dialog[open]"))
      || Boolean(document.activeElement?.matches?.("input, textarea, select, [contenteditable='true']"))
      || viewportHeight < MIN_AD_VIEWPORT_HEIGHT;
  }
  function eligible(state) {
    if (state.placement !== "infeed") return true;
    const after = Math.max(1, Number(config().placements?.infeed?.after) || 5);
    return root.document.querySelectorAll("#caseList .case-card").length >= after;
  }
  function syncSpace() {
    const state = states.get("bottom");
    const height = state && !state.zone.hidden ? Math.ceil(state.zone.getBoundingClientRect().height) : 0;
    const value = `${height}px`;
    if (root.document.documentElement.style.getPropertyValue("--auction-ad-space") !== value) {
      root.document.documentElement.style.setProperty("--auction-ad-space", value);
    }
  }
  function destroyAd(state) {
    root.clearTimeout(state.timeout);
    state.timeout = 0;
    pendingScripts.delete(state);
    if (state.ad) {
      stateByAd.delete(state.ad);
      try { root.adfit?.destroy?.(state.ad.dataset.adUnit); } catch {}
      state.ad = null;
    }
    state.host.replaceChildren();
  }
  function closeEntry() {
    entryClosed = true;
    root.document.getElementById("entryAdBackdrop")?.setAttribute("hidden", "");
    root.document.body.classList.remove("entry-ad-open");
    const state = states.get("entry");
    if (state) {
      state.zone.hidden = true;
      destroyAd(state);
    }
    sync();
  }
  function fail(state) {
    if (state.failed) return;
    state.failed = true;
    state.observer?.disconnect();
    state.zone.dataset.state = "failed";
    state.zone.hidden = true;
    destroyAd(state);
    if (state.placement === "entry") closeEntry();
    syncSpace();
  }
  function loaded(state) {
    if (state.failed || !state.ad) return;
    root.clearTimeout(state.timeout);
    state.timeout = 0;
    state.loaded = true;
    state.zone.dataset.state = "loaded";
    if (state.placement === "entry") storageSet("localStorage", ENTRY_SEEN_KEY, String(Date.now()));
    syncSpace();
  }
  function startTimeout(state) {
    root.clearTimeout(state.timeout);
    if (state.failed || state.loaded || !state.ad) return;
    state.timeout = root.setTimeout(() => {
      if (state.host.querySelector("iframe")) loaded(state);
      else fail(state);
    }, 30000);
  }
  function renderPending() {
    for (const state of [...pendingScripts]) {
      if (state.failed || !state.ad) { pendingScripts.delete(state); continue; }
      if (state.zone.hidden || state.host.hidden || root.document.hidden || busy() || !eligible(state) || state.slot.width > availableWidth(state)
        || state.placement === "bottom" && bottomCollapsed || state.placement === "infeed" && !state.near) {
        root.clearTimeout(state.timeout);
        state.timeout = 0;
        continue;
      }
      pendingScripts.delete(state);
      state.host.appendChild(state.ad);
      state.observer?.disconnect();
      try {
        // The SDK's global scan refreshes completed units. Render only this new
        // element so opening a list slot never refreshes the existing bottom ad.
        root.adfit.render(state.ad);
        startTimeout(state);
      } catch { fail(state); }
    }
  }
  function flushScript() {
    scriptTimer = 0;
    if (!pendingScripts.size) return;
    if (typeof root.adfit?.render === "function") { sdkState = "ready"; renderPending(); return; }
    if (sdkState === "loading") return;
    if (sdkState === "failed") { [...pendingScripts].forEach(fail); return; }
    sdkState = "loading";
    const script = root.document.createElement("script");
    script.async = true;
    script.charset = "utf-8";
    script.src = config().script || "https://t1.kakaocdn.net/kas/static/ba.min.js";
    script.onerror = () => { sdkState = "failed"; [...pendingScripts].forEach(fail); script.remove(); };
    script.onload = () => {
      sdkState = typeof root.adfit?.render === "function" ? "ready" : "failed";
      if (sdkState === "ready") renderPending();
      else [...pendingScripts].forEach(fail);
      script.remove();
    };
    root.document.head.appendChild(script);
  }
  function request(state, slot) {
    if (state.requested || state.failed || root.document.hidden || busy() || !eligible(state)) return;
    if (state.placement === "bottom" && bottomCollapsed) return;
    state.requested = true;
    state.slot = slot;
    state.zone.dataset.state = "loading";
    state.host.style.width = `${slot.width}px`;
    state.host.style.minHeight = `${slot.height}px`;
    state.zone.style.setProperty("--adfit-slot-width", `${slot.width}px`);
    const ad = root.document.createElement("ins");
    ad.className = "kakao_ad_area";
    ad.style.display = "none";
    ad.dataset.adUnit = slot.unit;
    ad.dataset.adWidth = String(slot.width);
    ad.dataset.adHeight = String(slot.height);
    // Each placement has its own callback names, as required by the Web SDK guide.
    const suffix = state.placement[0].toUpperCase() + state.placement.slice(1);
    ad.dataset.adOnfail = `auctionhannun${suffix}AdFailed`;
    ad.dataset.adOnload = `auctionhannun${suffix}AdLoaded`;
    root[ad.dataset.adOnfail] = element => { if (stateByAd.get(element) === state && state.ad === element) fail(state); };
    root[ad.dataset.adOnload] = element => { if (stateByAd.get(element) === state && state.ad === element) loaded(state); };
    state.ad = ad;
    stateByAd.set(ad, state);
    // Keep the element detached while loading the SDK. Its initial automatic
    // scan sees no ad; the onload handler mounts only currently visible slots.
    pendingScripts.add(state);
    if (!scriptTimer) scriptTimer = root.setTimeout(flushScript, 0);
    startTimeout(state);
  }
  function syncState(state) {
    const {zone, host, placement} = state;
    const blocked = !enabled(placement) || state.failed || !eligible(state) || busy() || root.document.hidden
      || placement !== "entry" && root.document.body.classList.contains("entry-ad-open");
    if (blocked || placement === "entry" && (!state.entryReady || entryClosed)) {
      zone.hidden = true;
      return;
    }
    zone.hidden = false;
    const needsResize = Boolean(state.slot && state.slot.width > availableWidth(state));
    if (placement === "bottom") {
      const collapsed = bottomCollapsed || needsResize;
      zone.classList.toggle("collapsed", collapsed);
      host.hidden = collapsed;
      const toggle = root.document.getElementById("bottomAdToggle");
      toggle?.setAttribute("aria-expanded", String(!collapsed));
      if (toggle) toggle.textContent = collapsed ? "광고 펼치기" : "광고 접기";
      if (collapsed) return;
    }
    // Keep an already requested creative and its original dimensions. Resizing or
    // moving the same list DOM must not refresh impressions or crop an ad.
    const slot = state.slot || resolveSlot(state);
    if (!slot || slot.width > availableWidth(state)) {
      zone.hidden = true;
      return;
    }
    if (!state.requested && (placement !== "infeed" || state.near)) request(state, slot);
    if (!state.requested && placement === "infeed" && !state.observing) {
      state.observing = true;
      state.observer?.observe(zone);
    }
  }
  function sync() {
    for (const state of states.values()) syncState(state);
    if (sdkState === "ready") renderPending();
    syncSpace();
  }
  function register(id, placement) {
    const zone = root.document.getElementById(id);
    const host = zone?.querySelector("[data-adfit-host]");
    const existing = states.get(placement);
    if (existing && existing.zone === zone && existing.host === host) { sync(); return; }
    if (existing) {
      existing.failed = true;
      existing.observer?.disconnect();
      destroyAd(existing);
      states.delete(placement);
    }
    if (!zone || !host) return;
    const state = {zone, host, placement, requested: false, failed: false, loaded: false, near: placement !== "infeed" || !root.IntersectionObserver, observing: false, timeout: 0, ad: null, slot: null, observer: null};
    states.set(placement, state);
    if (placement === "infeed" && root.IntersectionObserver) {
      state.observer = new root.IntersectionObserver(entries => {
        state.near = entries.some(entry => entry.isIntersecting);
        sync();
      }, {rootMargin: "0px"});
    }
    if (placement === "entry" && enabled(placement)) {
      const value = config().placements.entry;
      const seen = Number(storageGet("localStorage", ENTRY_SEEN_KEY) || 0);
      if (Date.now() - seen >= (Number(value.cooldownHours) || 24) * 3600000) {
        root.setTimeout(() => {
          if (entryClosed || root.document.hidden || busy() || !enabled(placement)) return;
          state.entryReady = true;
          root.document.getElementById("entryAdBackdrop").hidden = false;
          root.document.body.classList.add("entry-ad-open");
          sync();
          if (zone.hidden) { closeEntry(); return; }
          root.document.getElementById("entryAdClose")?.focus({preventScroll: true});
        }, Math.max(0, Number(value.delayMs) || 0));
      }
    }
    sync();
  }
  function init() {
    if (initialized) return;
    initialized = true;
    bottomCollapsed = storageGet("sessionStorage", BOTTOM_COLLAPSED_KEY) === "1";
    root.document.getElementById("bottomAdToggle")?.addEventListener("click", event => {
      const expand = event.currentTarget.getAttribute("aria-expanded") !== "true";
      const state = states.get("bottom");
      // A resize never automatically requests a replacement impression. A user
      // can reopen the folded dock to request a unit that fits the new width.
      if (expand && state?.slot && state.slot.width > availableWidth(state)) {
        destroyAd(state);
        state.requested = false;
        state.loaded = false;
        state.slot = null;
      }
      bottomCollapsed = !expand;
      storageSet("sessionStorage", BOTTOM_COLLAPSED_KEY, bottomCollapsed ? "1" : "0");
      sync();
    });
    root.document.getElementById("entryAdClose")?.addEventListener("click", closeEntry);
    root.document.getElementById("entryAdBackdrop")?.addEventListener("click", event => {
      if (event.target === event.currentTarget) closeEntry();
    });
    root.document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !root.document.getElementById("entryAdBackdrop")?.hidden) closeEntry();
    });
    register("entryAd", "entry");
    register("bottomAd", "bottom");
    register("infeedAd", "infeed");
    root.document.addEventListener("auctionhannun:ads-updated", () => register("infeedAd", "infeed"));
    root.document.addEventListener("visibilitychange", sync);
    root.document.addEventListener("focusin", sync);
    root.document.addEventListener("focusout", () => root.setTimeout(sync, 0));
    root.addEventListener("resize", () => { root.clearTimeout(resizeTimer); resizeTimer = root.setTimeout(sync, 120); }, {passive: true});
    root.visualViewport?.addEventListener("resize", sync, {passive: true});
    if (root.ResizeObserver) {
      const observer = new root.ResizeObserver(syncSpace);
      const bottom = states.get("bottom");
      if (bottom) observer.observe(bottom.zone);
    }
    if (root.MutationObserver) {
      const observer = new root.MutationObserver(sync);
      observer.observe(root.document.body, {attributes: true, attributeFilter: ["class"]});
      for (const dialog of root.document.querySelectorAll("dialog")) observer.observe(dialog, {attributes: true, attributeFilter: ["open"]});
    }
  }
  root.AuctionhannunAds = Object.freeze({init, sync, closeEntry});
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, {once: true});
  else init();
})(typeof window === "undefined" ? globalThis : window);

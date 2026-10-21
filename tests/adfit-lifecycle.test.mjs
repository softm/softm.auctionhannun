import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const runtime = await readFile(new URL("../adfit.js", import.meta.url), "utf8");
const settings = await readFile(new URL("../adfit-config.js", import.meta.url), "utf8");

class Events {
  listeners = new Map();
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(callback);
  }
  emit(name, values = {}) {
    for (const callback of this.listeners.get(name) || []) callback({target: this, currentTarget: this, ...values});
  }
}
class Element extends Events {
  children = [];
  dataset = {};
  attributes = new Map();
  hidden = false;
  width = 0;
  constructor(tagName = "div", width = 0) {
    super();
    this.tagName = tagName.toUpperCase();
    this.width = width;
    const properties = new Map();
    this.style = {
      setProperty: (name, value) => properties.set(name, value),
      getPropertyValue: name => properties.get(name) || ""
    };
    const classes = new Set();
    this.classList = {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, value) => {
        const next = value ?? !classes.has(name);
        if (next) classes.add(name); else classes.delete(name);
        return next;
      }
    };
  }
  get clientWidth() { return this.hidden ? 0 : this.width; }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; children.forEach(child => this.appendChild(child)); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) { this.attributes.set(name, value); if (name === "hidden") this.hidden = true; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector(selector) {
    if (selector === "[data-adfit-host]") return this.children.find(child => child.host) || null;
    if (selector === "iframe") return this.children.find(child => child.tagName === "IFRAME") || this.children.map(child => child.querySelector(selector)).find(Boolean) || null;
    return null;
  }
  getBoundingClientRect() { return {width: this.clientWidth, height: this.hidden ? 0 : this.classList.contains("collapsed") ? 52 : 177}; }
  matches(selector) { return selector.includes("input") && ["INPUT", "SELECT", "TEXTAREA"].includes(this.tagName); }
  focus() {}
}

function harness({width = 390, height = 844, infeedWidth = 358, collapsed = false, cards = 0, hostname = "auctionhannun.designboard.net", native = false, storageThrows = false, hidden = false} = {}) {
  const nodes = new Map();
  for (const id of ["entryAd", "bottomAd", "infeedAd", "entryAdBackdrop", "entryAdClose", "bottomAdToggle"]) {
    const element = new Element(id.includes("Close") || id.includes("Toggle") ? "button" : "aside", id === "infeedAd" ? infeedWidth : width);
    element.hidden = !id.includes("Close") && !id.includes("Toggle");
    if (["entryAd", "bottomAd", "infeedAd"].includes(id)) {
      const host = new Element(); host.host = true; element.appendChild(host);
    }
    nodes.set(id, element);
  }
  const document = new Events();
  Object.assign(document, {
    readyState: "complete", hidden, head: new Element("head"), body: new Element("body"),
    documentElement: new Element("html", width), activeElement: null,
    getElementById: id => nodes.get(id) || null,
    createElement: tag => new Element(tag),
    querySelector: selector => selector === "dialog[open]" && document.modalOpen ? new Element("dialog") : null,
    querySelectorAll: selector => selector === "#caseList .case-card" ? Array.from({length: document.cards}) : []
  });
  document.cards = cards;
  const timers = new Map(); let timerId = 0;
  const observers = [];
  const session = new Map(collapsed ? [["auctionhannun:bottom-ad-collapsed", "1"]] : []);
  const stored = values => ({getItem: key => { if (storageThrows) throw new Error("Storage blocked"); return values.get(key) ?? null; }, setItem: (key, value) => { if (storageThrows) throw new Error("Storage blocked"); values.set(key, value); }});
  const root = new Events();
  const requested = []; const destroyed = []; const scriptLoads = [];
  const appendScript = document.head.appendChild.bind(document.head);
  document.head.appendChild = script => { scriptLoads.push(script); return appendScript(script); };
  Object.assign(root, {
    document, innerHeight: height,
    navigator: {userAgent: native ? "Auction AdMobNative/1" : "Test browser"},
    location: {protocol: "https:", hostname}, sessionStorage: stored(session), localStorage: stored(new Map()),
    getComputedStyle: () => ({paddingLeft: "0px", paddingRight: "0px"}),
    matchMedia: () => ({matches: document.documentElement.width >= 768}),
    setTimeout: (callback, delay) => { timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimeout: id => timers.delete(id),
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(element) { this.element = element; }
      disconnect() { this.element = null; }
    }
  });
  root.window = root;
  const context = vm.createContext(root);
  vm.runInContext(settings, context);
  vm.runInContext(runtime, context);
  const flush = (maximum = 0) => {
    for (const [id, timer] of [...timers]) if (timer.delay <= maximum && timers.has(id)) { timers.delete(id); timer.callback(); }
  };
  const loadSdk = () => {
    flush();
    root.adfit = {
      render: ad => requested.push(ad),
      destroy: unit => destroyed.push(unit)
    };
    for (const script of [...document.head.children]) script.onload();
  };
  const intersect = () => observers.forEach(observer => { if (observer.element) observer.callback([{isIntersecting: true}]); });
  const load = ad => root[ad.dataset.adOnload](ad);
  const fail = ad => root[ad.dataset.adOnfail](ad);
  const toggle = () => nodes.get("bottomAdToggle").emit("click");
  const space = () => document.documentElement.style.getPropertyValue("--auction-ad-space");
  return {root, document, nodes, requested, destroyed, scriptLoads, session, flush, loadSdk, intersect, load, fail, toggle, space};
}

test("saved folded state sends no ad request; expansion uses one SDK load and refolding preserves the creative", () => {
  const h = harness({collapsed: true});
  h.flush();
  assert.equal(h.scriptLoads.length, 0);
  assert.equal(h.nodes.get("bottomAdToggle").getAttribute("aria-expanded"), "false");
  h.toggle(); h.loadSdk();
  assert.equal(h.requested.length, 1);
  const ad = h.requested[0]; h.load(ad);
  h.toggle(); h.toggle(); h.root.AuctionhannunAds.init(); h.flush();
  assert.equal(h.requested.length, 1);
  assert.equal(h.scriptLoads.length, 1);
  assert.equal(h.nodes.get("bottomAd").querySelector("[data-adfit-host]").children[0], ad);
  assert.equal(h.session.get("auctionhannun:bottom-ad-collapsed"), "0");
});

test("the popup banner is never requested or opened without explicit placement approval", () => {
  const h = harness(); h.loadSdk(); h.flush(1000);
  assert.equal(h.nodes.get("entryAdBackdrop").hidden, true);
  assert.equal(h.nodes.get("entryAd").querySelector("[data-adfit-host]").children.length, 0);
  assert.ok(h.requested.every(ad => ad.dataset.adWidth !== "300"));
});

test("the fifth-card ad waits for visibility and uses the column width, without refreshing the bottom unit", () => {
  const h = harness({width: 1280, infeedWidth: 590, cards: 10}); h.loadSdk();
  assert.equal(h.requested.length, 1);
  assert.equal(h.requested[0].dataset.adWidth, "728");
  h.load(h.requested[0]); h.intersect(); h.flush();
  assert.equal(h.requested.length, 2);
  assert.equal(h.requested[1].dataset.adWidth, "320");
  assert.notEqual(h.requested[0].dataset.adUnit, h.requested[1].dataset.adUnit);
  assert.notEqual(h.requested[0].dataset.adOnfail, h.requested[1].dataset.adOnfail);
  assert.equal(h.scriptLoads.length, 1);
  for (let index = 0; index < 4; index++) h.document.emit("auctionhannun:ads-updated");
  assert.equal(h.requested.length, 2);
});

test("empty and short lists never create an infeed request or a blank ad panel", () => {
  const h = harness({cards: 4}); h.loadSdk(); h.intersect(); h.flush();
  assert.equal(h.requested.length, 1);
  assert.equal(h.nodes.get("infeedAd").hidden, true);
  h.document.cards = 5; h.document.emit("auctionhannun:ads-updated"); h.intersect(); h.flush();
  assert.equal(h.requested.length, 2);
  h.document.cards = 0; h.document.emit("auctionhannun:ads-updated");
  assert.equal(h.nodes.get("infeedAd").hidden, true);
});

test("NO-AD destroys the failed unit, removes its reserved space, and ignores stale load callbacks", () => {
  const h = harness(); h.loadSdk();
  const ad = h.requested[0]; const callback = h.root[ad.dataset.adOnload];
  assert.notEqual(h.space(), "0px");
  h.fail(ad);
  assert.deepEqual(h.destroyed, [ad.dataset.adUnit]);
  assert.equal(h.nodes.get("bottomAd").hidden, true);
  assert.equal(h.space(), "0px");
  callback(ad); h.root.AuctionhannunAds.sync();
  assert.equal(h.nodes.get("bottomAd").hidden, true);
  assert.equal(h.space(), "0px");
});

test("a slow SDK cannot request a hidden or folded ad; returning to the foreground resumes once", () => {
  const h = harness(); h.flush(); h.toggle(); h.document.hidden = true;
  h.document.emit("visibilitychange"); h.loadSdk();
  assert.equal(h.requested.length, 0);
  assert.equal(h.space(), "0px");
  h.document.hidden = false; h.document.emit("visibilitychange");
  assert.equal(h.requested.length, 0);
  h.toggle();
  assert.equal(h.requested.length, 1);
  assert.equal(h.scriptLoads.length, 1);
});

test("editing, modal review, and tab backgrounding hide the dock and restore the saved fold preference", () => {
  const h = harness(); h.loadSdk(); h.load(h.requested[0]);
  h.document.activeElement = new Element("input"); h.document.emit("focusin");
  assert.equal(h.nodes.get("bottomAd").hidden, true);
  assert.equal(h.space(), "0px");
  h.document.activeElement = null; h.document.emit("focusout"); h.flush();
  assert.equal(h.nodes.get("bottomAd").hidden, false);
  h.document.body.classList.add("detail-open"); h.root.AuctionhannunAds.sync();
  assert.equal(h.nodes.get("bottomAd").hidden, true);
  h.document.body.classList.remove("detail-open"); h.root.AuctionhannunAds.sync();
  assert.equal(h.nodes.get("bottomAdToggle").getAttribute("aria-expanded"), "true");
  assert.equal(h.requested.length, 1);
});

test("shrinking a desktop dock folds it without a new impression; explicit expansion selects a fitting unit", () => {
  const h = harness({width: 1280}); h.loadSdk(); h.load(h.requested[0]);
  const desktop = h.requested[0];
  h.document.documentElement.width = 390; h.nodes.get("bottomAd").width = 390;
  h.root.emit("resize"); h.flush(120);
  assert.equal(h.nodes.get("bottomAd").hidden, false);
  assert.equal(h.nodes.get("bottomAdToggle").getAttribute("aria-expanded"), "false");
  assert.equal(h.requested.length, 1);
  h.toggle(); h.flush();
  assert.equal(h.requested.length, 2);
  assert.equal(h.requested[1].dataset.adWidth, "320");
  assert.deepEqual(h.destroyed, [desktop.dataset.adUnit]);
  assert.equal(h.scriptLoads.length, 1);
});

test("blocked storage does not break the page or prevent the fold control", () => {
  const h = harness({storageThrows: true}); h.loadSdk();
  assert.doesNotThrow(() => { h.toggle(); h.toggle(); });
  assert.equal(h.nodes.get("bottomAdToggle").getAttribute("aria-expanded"), "true");
  assert.equal(h.requested.length, 1);
});

test("unapproved hosts and native AdMob sessions do not load the Web SDK", () => {
  for (const options of [{hostname: "localhost"}, {hostname: "softm.github.io"}, {native: true}]) {
    const h = harness(options); h.flush(); h.intersect(); h.flush();
    assert.equal(h.scriptLoads.length, 0);
    assert.equal(h.nodes.get("bottomAd").hidden, true);
    assert.equal(h.space(), "0px");
  }
});

test("SDK failures release the dock and a failed SDK load is not retried by scrolling or sorting", () => {
  const h = harness({cards: 10}); h.flush();
  h.scriptLoads[0].onerror();
  h.intersect(); h.flush();
  assert.equal(h.nodes.get("bottomAd").hidden, true);
  assert.equal(h.nodes.get("infeedAd").hidden, true);
  assert.equal(h.scriptLoads.length, 1);
  assert.equal(h.space(), "0px");
});

test("a replaced list container destroys the old unit and late callbacks cannot hide its replacement", () => {
  const h = harness({cards: 10}); h.loadSdk(); h.intersect(); h.flush();
  const oldAd = h.requested[1];
  const oldFailure = h.root[oldAd.dataset.adOnfail];
  const replacement = new Element("aside", 358);
  const host = new Element(); host.host = true; replacement.appendChild(host);
  h.nodes.set("infeedAd", replacement);
  h.document.emit("auctionhannun:ads-updated"); h.intersect(); h.flush();
  assert.equal(h.requested.length, 3);
  assert.deepEqual(h.destroyed, [oldAd.dataset.adUnit]);
  oldFailure(oldAd);
  assert.equal(replacement.hidden, false);
  assert.equal(host.children[0], h.requested[2]);
  assert.equal(h.scriptLoads.length, 1);
});

test("an unanswered request times out, while a confirmed creative survives the same deadline", () => {
  const missing = harness(); missing.loadSdk(); missing.flush(30000);
  assert.equal(missing.nodes.get("bottomAd").hidden, true);
  assert.equal(missing.space(), "0px");
  const loaded = harness(); loaded.loadSdk(); loaded.load(loaded.requested[0]); loaded.flush(30000);
  assert.equal(loaded.nodes.get("bottomAd").hidden, false);
  assert.equal(loaded.destroyed.length, 0);
});

test("430px landscape and narrow screens leave the map usable without loading or reserving advertisements", () => {
  for (const width of [932, 390]) {
    const h = harness({width, height: 430, cards: 10});
    h.flush(); h.intersect(); h.flush();
    assert.equal(h.scriptLoads.length, 0);
    assert.equal(h.nodes.get("bottomAd").hidden, true);
    assert.equal(h.nodes.get("infeedAd").hidden, true);
    assert.equal(h.space(), "0px");
    for (let index = 0; index < 4; index++) h.root.AuctionhannunAds.sync();
    assert.equal(h.scriptLoads.length, 0);
    assert.equal(h.space(), "0px");
  }
});

test("the short viewport boundary restores an existing creative without a second request or dock oscillation", () => {
  const h = harness({width: 932, height: 600}); h.loadSdk(); h.load(h.requested[0]);
  assert.equal(h.requested.length, 1);
  h.root.innerHeight = 599; h.root.emit("resize"); h.flush(120);
  assert.equal(h.nodes.get("bottomAd").hidden, true);
  assert.equal(h.space(), "0px");
  h.root.innerHeight = 600; h.root.emit("resize"); h.flush(120);
  assert.equal(h.nodes.get("bottomAd").hidden, false);
  for (let index = 0; index < 4; index++) h.root.AuctionhannunAds.sync();
  assert.equal(h.nodes.get("bottomAd").hidden, false);
  assert.equal(h.requested.length, 1);
  assert.equal(h.scriptLoads.length, 1);
  h.root.visualViewport = {height: 430}; h.root.AuctionhannunAds.sync();
  assert.equal(h.nodes.get("bottomAd").hidden, true);
  assert.equal(h.space(), "0px");
});

test("the normal 1440 by 635 browser viewport displays the mandatory bottom dock", () => {
  const h = harness({width: 1440, height: 635}); h.loadSdk();
  assert.equal(h.nodes.get("bottomAd").hidden, false);
  assert.notEqual(h.space(), "0px");
  assert.equal(h.requested.length, 1);
  assert.equal(h.requested[0].dataset.adWidth, "728");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AuctionMap } from "../auction-map.js";
import { cadastralParams, cadastralSourceUrl } from "../vworld-map.js";
import { mapConfig } from "../map-config.js";

test("VWorld cadastral source uses dedicated key and actual origin with both parcel layers", () => {
  const url = new URL(cadastralSourceUrl(new URL("http://localhost:3000/")));
  assert.equal(url.origin, "https://api.vworld.kr"); assert.equal(url.pathname, "/req/wms");
  assert.equal(url.searchParams.get("domain"), "http://localhost:3000");
  assert.equal(url.searchParams.get("key"), mapConfig.vworldLocalKey);
  const production = new URL(cadastralSourceUrl(new URL(mapConfig.vworldServiceOrigin)));
  assert.equal(production.searchParams.get("key"), mapConfig.vworldKey);
  assert.notEqual(production.searchParams.get("key"), url.searchParams.get("key"));
  assert.equal(cadastralParams.LAYERS, "lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun");
  assert.equal(cadastralParams.TRANSPARENT, true); assert.equal(cadastralParams.VERSION, "1.3.0");
  assert.throws(() => cadastralSourceUrl(new URL("https://tojihannun.designboard.net/")), /등록된 운영 주소/);
});
test("map focus and zoom route to active map and switching back preserves location", async () => {
  const point = { latitude: 37.56, longitude: 126.97 }, events = [];
  const map = new AuctionMap({ hidden: true }, () => {}, { hidden: false });
  map.maps = { LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } } };
  map.map = { setCenter: value => events.push(["naver-center", value]), setZoom: value => events.push(["naver-zoom", value]) };
  map.vworld = { focus: value => events.push(["vworld-focus", value]), zoom: value => events.push(["vworld-zoom", value]), clearParcel() {}, resize() {}, center: () => point, zoomLevel: () => 18 };
  map.cadastralEnabled = true; map.focus(point); map.zoom(1);
  assert.deepEqual(events.find(x => x[0] === "vworld-focus")[1], point);
  assert.deepEqual(events.find(x => x[0] === "vworld-zoom"), ["vworld-zoom", 1]);
  await map.setCadastral(false);
  assert.equal(map.element.hidden, false); assert.equal(map.vworldElement.hidden, true);
  assert.equal(map.cadastralEnabled, false); assert.deepEqual(events.at(-1), ["naver-zoom", 18]);
});
test("automatic loading, retry, list-to-map and separate review actions are wired", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(app, /async function bootstrap\(\)\s*\{\s*void enableMap\(\)/);
  assert.match(app, /data-open-case-id/); assert.match(app, /focusCaseOnMap\(card.dataset.mapCaseId\)/);
  assert.match(app, /if \(operation !== mapOperation\) return;/);
  assert.match(html, /id="vworldCanvas"/); assert.match(html, /지도 다시 연결/);
  assert.doesNotMatch(html, /네이버 지도 켜기/);
});

test("a stale parcel request cannot switch the map or draw its boundary", async () => {
  const map = new AuctionMap({ hidden: false }, () => {}, { hidden: true });
  let finish, current = true;
  map.map = {};
  map.vworld = { ready: () => new Promise(resolve => { finish = resolve; }), activate() { assert.fail("stale activation"); } };
  const task = map.showParcel({}, () => current);
  await Promise.resolve(); await Promise.resolve();
  current = false; finish();
  assert.equal(await task, false);
  assert.equal(map.element.hidden, false);
  assert.equal(map.vworldElement.hidden, true);
});

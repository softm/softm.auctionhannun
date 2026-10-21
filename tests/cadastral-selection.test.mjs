import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const [html, app, map, vworld] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("app.js", "utf8"),
  readFile("auction-map.js", "utf8"),
  readFile("vworld-map.js", "utf8")
]);

test("지도 표시 방식은 일반·위성·위성+지적을 제공한다", () => {
  assert.match(html, /data-map-mode="normal"[^>]*>일반/);
  assert.match(html, /data-map-mode="satellite"[^>]*>위성/);
  assert.match(html, /data-map-mode="cadastral"[^>]*>위성\+지적/);
  assert.match(map, /setMode\(mode/);
  assert.match(vworld, /Satellite\/service/);
  assert.match(vworld, /Hybrid\/service/);
});

test("지적 모드에서 선택 매물의 실제 PNU 폴리곤만 자동 표시한다", () => {
  assert.match(app, /async function showCaseParcelBoundary/);
  assert.match(app, /validPnu\(pnu\)/);
  assert.match(app, /candidates\.length !== 1/);
  assert.match(app, /await loadParcel\(pnu\)/);
  assert.match(app, /auctionMap\.showParcel\(feature/);
  assert.match(vworld, /ol\.format\.GeoJSON/);
  assert.match(vworld, /readFeature\(feature/);
  assert.match(vworld, /#f51d76/);
});

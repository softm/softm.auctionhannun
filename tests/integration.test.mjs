import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collect, normalizeDataset, normalizeItem, requestFeed, nextPageUrl, validateFeedPage } from "../scripts/collect-auctions.mjs";
import { publishDataset } from "../scripts/publish-data.mjs";
import { validateData } from "../scripts/validate-data.mjs";
import { createDataLoader, safeDataPath } from "../auction-data.js";
import { validCoordinate, validPnu, eumUrl, polygonPaths, parcelCandidates } from "../parcel-utils.js";
import { createGeocoder } from "../auction-map.js";
import { parcelRequestUrl } from "../parcel-api.js";
import { gzipSync } from "node:zlib";

const item = { id: "test-only", type: "land", title: "수집 검증용 fixture", address: "서울특별시 중구 세종대로 110", court: "테스트 법원", caseNumber: "TEST", saleDate: "2026-11-01", sourceUrl: "https://www.courtauction.go.kr/", pnu: "1114010300100310000", location: { latitude: 37.5666, longitude: 126.9784, source: "test" } };
const input = items => ({ metadata: { demo: false, reviewed: true, redistributionAllowed: true, datasetKind: "court-auction", sourceUrl: item.sourceUrl, coverage: "테스트 파일만", snapshotId: "test-snapshot", expectedCount: items.length }, items });
const response = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

test("운영 입력은 예시·승인 누락·공매를 거부한다", () => {
  assert.throws(() => validateFeedPage({ ...input([item]), metadata: { ...input([]).metadata, demo: true } }), /예시/);
  assert.throws(() => validateFeedPage({ ...input([item]), metadata: { ...input([]).metadata, redistributionAllowed: false } }), /승인/);
  assert.throws(() => validateFeedPage({ ...input([item]), metadata: { ...input([]).metadata, datasetKind: "onbid" } }), /법원경매/);
  assert.throws(() => validateFeedPage(input([{ ...item, auctionKind: "onbid" }])), /다른 경매 구분/);
});

test("가짜 좌표 생성 없이 날짜·PNU·국내 좌표를 검증한다", () => {
  const normalized = normalizeItem({ ...item, location: null, pnu: null }, 0);
  assert.equal(normalized.location, null);
  assert.equal("pos" in normalized, false);
  assert.throws(() => normalizeItem({ ...item, saleDate: "2026-02-30" }, 0), /매각기일/);
  assert.throws(() => normalizeItem({ ...item, location: { latitude: 0, longitude: 0 } }, 0), /위도/);
  assert.throws(() => normalizeItem({ ...item, pnu: "111" }, 0), /PNU/);
});

test("차단·호출 한도는 재시도 없이 중단, 5xx만 제한 재시도", async () => {
  for (const code of [401, 403, 429]) {
    let calls = 0;
    await assert.rejects(requestFeed("https://example.test/feed", { fetcher: async () => { calls++; return new Response("", { status: code }); }, sleep: async () => {} }), new RegExp(String(code)));
    assert.equal(calls, 1);
  }
  let calls = 0;
  const result = await requestFeed("https://example.test/feed", { fetcher: async () => ++calls < 3 ? new Response("", { status: 503 }) : response(input([item])), sleep: async () => {} });
  assert.equal(result.items.length, 1);
  assert.equal(calls, 3);
  assert.throws(() => nextPageUrl("https://other.test/page", "https://example.test/feed"), /다른 출처/);
});

test("목록·상세·원본은 일치하며 불완전한 수집은 마지막 정상 자료를 보존한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "auction-pipeline-"));
  const dataDir = join(root, "data");
  const rawDir = join(root, "private-source");
  const feedUrl = "https://example.test/feed";
  await collect({ feedUrl, dataDir, rawDir, fetcher: async () => response(input([item])) });
  assert.equal((await validateData(dataDir)).count, 1);
  const before = await readFile(join(dataDir, "manifest.json"), "utf8");
  const incomplete = input([item]); incomplete.metadata.expectedCount = 10;
  await assert.rejects(collect({ feedUrl, dataDir, rawDir, fetcher: async () => response(incomplete) }), /불완전/);
  assert.equal(await readFile(join(dataDir, "manifest.json"), "utf8"), before);
  assert.equal(JSON.parse(await readFile(join(dataDir, "collection-status.json"))).state, "error");
  await assert.rejects(collect({ feedUrl, dataDir, rawDir, fetcher: async () => response(input([item, item])) }), /중복/);
  assert.equal(await readFile(join(dataDir, "manifest.json"), "utf8"), before);
  assert.ok((await readdir(rawDir)).length);
});

test("페이지 전체를 수집하고 snapshot이 섞이면 배포하지 않는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "auction-pages-"));
  const first = input([item]); first.metadata.expectedCount = 2; first.nextPage = "/page2";
  const second = input([{ ...item, id: "second" }]); second.metadata.expectedCount = 2;
  const options = { feedUrl: "https://example.test/feed", dataDir: join(root, "data"), rawDir: join(root, "raw"), fetcher: async url => response(url.endsWith("page2") ? second : first) };
  assert.equal((await collect(options)).items.length, 2);
  second.metadata.snapshotId = "changed";
  await assert.rejects(collect(options), /원본 버전/);
  assert.equal((await validateData(options.dataDir)).count, 2);
});

test("공급원 누락은 테스트 예시를 읽지 않고 실패한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "auction-empty-"));
  await publishDataset(normalizeDataset(input([])), root);
  await assert.rejects(collect({ dataDir: root }), /미연결/);
  assert.equal((await validateData(root)).count, 0);
});

test("검색 로더는 gzip과 진행 중 요청을 공유하고 실패는 재시도한다", async () => {
  let calls = 0;
  const load = createDataLoader(async () => { calls++; return new Response(gzipSync(JSON.stringify({ items: [item] }))); });
  const [a, b] = await Promise.all([load("data"), load("data")]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  let failures = 0;
  const retry = createDataLoader(async () => { if (++failures === 1) throw new Error("offline"); return response({ ok: true }); });
  await assert.rejects(retry("data"), /offline/);
  assert.equal((await retry("data")).ok, true);
  assert.equal(safeDataPath("../../secrets", "detail"), false);
});

test("필지는 실제 PNU·Polygon만 허용하며 토지이음에 동일 PNU를 전달한다", () => {
  assert.equal(validPnu(item.pnu), true);
  assert.equal(validPnu("1114010300100000000"), false);
  assert.equal(new URL(eumUrl(item.pnu)).searchParams.get("pnu"), item.pnu);
  assert.equal(eumUrl("invalid"), null);
  assert.equal(validCoordinate({ latitude: "37", longitude: "127" }), false);
  assert.deepEqual(polygonPaths({ type: "Point", coordinates: [127, 37] }), []);
  assert.throws(() => polygonPaths({ type: "Polygon", coordinates: [[[0, 0], [1, 1], [2, 1], [0, 0]]] }), /국내 좌표/);
  const result = parcelCandidates({ response: { status: "OK", result: { items: [{ id: item.pnu, point: { x: 127, y: 37 }, address: { parcel: "선택 후보" } }] } } });
  assert.equal(result[0].pnu, item.pnu);
});

test("VWorld는 경매한눈 전용 등록 URL과 실제 origin만 사용한다", () => {
  for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000", "https://auctionhannun.designboard.net/"]) {
    const location = new URL(origin);
    const url = parcelRequestUrl("/req/data", { domain: "tojihannun.designboard.net", service: "data" }, location);
    assert.equal(url.origin, "https://api.vworld.kr");
    assert.equal(url.searchParams.get("domain"), location.origin);
    assert.equal(url.searchParams.get("service"), "data");
  }
  for (const origin of ["https://softm.github.io/softm.auctionhannun/", "https://tojihannun.designboard.net/", "http://auctionhannun.designboard.net/", "https://auctionhannun.designboard.net.example.com/"]) {
    assert.throws(() => parcelRequestUrl("/req/data", {}, new URL(origin)), /등록된 운영 주소/);
  }
  assert.throws(() => parcelRequestUrl("/req/data", {}, new URL("file:///index.html")), /HTTP/);
});

test("주소 조회는 4개 동시 요청·캐시·중복 제거·다중 후보 거부를 적용한다", async () => {
  let active = 0, maximum = 0, calls = 0;
  const storage = new Map();
  const geocode = createGeocoder({ Service: { Status: { OK: "OK" }, geocode({ query }, callback) {
    active++; calls++; maximum = Math.max(maximum, active);
    setTimeout(() => { active--; callback("OK", { v2: { meta: { totalCount: query.includes("모호") ? 2 : 1 }, addresses: [{ x: "127", y: "37", jibunAddress: query }] } }); }, 5);
  } } }, { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) });
  await Promise.all(Array.from({ length: 12 }, (_, index) => geocode(`주소 ${index + 1}`)));
  assert.equal(maximum, 4);
  const before = calls;
  await Promise.all([geocode("중복 1"), geocode("중복 1")]);
  await geocode("중복 1");
  assert.equal(calls, before + 1);
  await assert.rejects(geocode("모호 1"), /후보가 여러/);
  await assert.rejects(geocode("서울특별시"), /지번/);
});

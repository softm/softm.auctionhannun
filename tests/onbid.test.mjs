import test from "node:test";
import assert from "node:assert/strict";
import { onbidListUrl, probeOnbid } from "../scripts/probe-onbid.mjs";
import { onbidRecord, onbidPage, collectOnbid } from "../scripts/collect-onbid.mjs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateData } from "../scripts/validate-data.mjs";
import { normalizeDataset } from "../scripts/collect-auctions.mjs";
import { filterAndSortCases, reviewMetrics } from "../auction-utils.js";

const row = { cltrMngNo: "test-only-001", pbctCdtnNo: 12, onbidCltrNm: "서울특별시 테스트구 산2-45", cltrUsgMclsCtgrNm: "토지", cltrUsgSclsCtgrNm: "임야", cltrBidBgngDt: "202610190900", cltrBidEndDt: "202610261700", ltnoPnu: "1153010700100020045", apslEvlAmt: 100000000, lowstBidPrcIndctCont: "비공개" };

test("차세대 온비드 공식 주소·필수값과 키 인코딩을 사용한다", () => {
  const url = onbidListUrl("fake%2Bkey%3D");
  assert.equal(url.origin, "https://apis.data.go.kr");
  assert.equal(url.pathname, "/B010003/OnbidRlstListSrvc2/getRlstCltrList2");
  assert.equal(url.searchParams.get("serviceKey"), "fake+key=");
  assert.equal(url.searchParams.get("prptDivCd"), "0007");
  assert.equal(url.searchParams.get("pvctTrgtYn"), "N");
});

test("온비드 물건은 법원 사건으로 변환하지 않고 마감시각·비공개 가격을 보존한다", () => {
  const item = onbidRecord(row);
  assert.equal(item.auctionKind, "onbid");
  assert.equal(item.bidEndsAt, "2026-10-26T17:00:00+09:00");
  assert.equal(item.minimum, "비공개");
  assert.equal(item.rounds, "원문 확인", "유찰 누락값을 0회로 만들지 않는다");
  assert.equal(item.pnu, null, "0/1 산 코드가 섞인 원본을 표준 PNU로 오인하지 않는다");
  const normalized = normalizeDataset({ metadata: { reviewed: true, demo: false, datasetKind: "onbid-public-sale", sourceUrl: "https://www.onbid.co.kr/" }, items: [item] });
  assert.equal(normalized.items[0].auctionKind, "onbid");
  assert.equal(normalized.items[0].bidEndsAt, item.bidEndsAt);
  assert.equal(normalized.metadata.datasetKind, "onbid-public-sale");
});

test("온비드 전체 페이지를 검증하고 실패·키 누락 시 정상 목록을 보존한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "onbid-verified-"));
  const options = { key: "test-only-key", dataDir: join(root, "data"), rawDir: join(root, "raw"), now: new Date("2026-10-19T09:00:00Z") };
  const payload = (pageNo, items, total = 2) => ({ response: { header: { resultCode: "00" }, body: { pageNo, numOfRows: 1, totalCount: total, items: { item: items } } } });
  const response = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
  const fixture = page => payload(page, [{ ...row, cltrMngNo: `test-only-${page}` }]);
  const data = await collectOnbid({ ...options, fetcher: async url => response(fixture(Number(new URL(url).searchParams.get("pageNo")))) });
  assert.equal(data.items.length, 2);
  assert.equal(data.metadata.distinctProperties, 2);
  assert.equal((await validateData(options.dataDir)).count, 2);
  const manifest = await readFile(join(options.dataDir, "manifest.json"), "utf8");
  await assert.rejects(collectOnbid({ ...options, fetcher: async () => response(fixture(1)) }), /페이지/);
  await assert.rejects(collectOnbid({ ...options, fetcher: async () => response(payload(1, [], 0)) }), /갑자기 0건/);
  await assert.rejects(collectOnbid({ ...options, key: "", fetcher: async () => { throw new Error("must not request"); } }), /SERVICE_KEY/);
  assert.equal(await readFile(join(options.dataDir, "manifest.json"), "utf8"), manifest);
  const status = JSON.parse(await readFile(join(options.dataDir, "collection-status.json"), "utf8"));
  assert.equal(status.state, "unconfigured");
  assert.equal(status.lastSuccessAt, options.now.toISOString());
});

test("API 오류를 빈 목록 성공으로 취급하지 않는다", async () => {
  assert.throws(() => onbidPage({ response: { header: { resultCode: "30" } } }), /응답 오류/);
  assert.throws(() => onbidPage({ header: { resultCode: "00" }, body: {} }), /전체 건수/);
  const result = await probeOnbid("private-secret", async () => new Response("<returnReasonCode>30</returnReasonCode><secret>private-secret</secret>", { status: 403 }));
  assert.equal(result.httpStatus, 403);
  assert.equal(JSON.stringify(result).includes("private-secret"), false);
});

test("법원·온비드 필터와 서류 기록은 혼합하지 않는다", () => {
  const onbid = onbidRecord(row);
  const court = { id: "court-only", auctionKind: "court" };
  assert.deepEqual(filterAndSortCases([court, onbid], { kind: "court" }), [court]);
  assert.deepEqual(filterAndSortCases([court, onbid], { kind: "onbid" }), [onbid]);
  assert.equal(reviewMetrics([onbid], new Set(), { [onbid.id]: { "doc:onbid-notice": true, "doc:sale-spec": true } }).checked, 1);
});

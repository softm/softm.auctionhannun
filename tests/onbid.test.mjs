import test from "node:test";
import assert from "node:assert/strict";
import { onbidListUrl, probeOnbid } from "../scripts/probe-onbid.mjs";
import { onbidRecord, onbidPage, onbidDetailUrl, onbidDetailItems, onbidPhotoUrls, onbidDetailEnrichment, collectOnbid } from "../scripts/collect-onbid.mjs";
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

test("온비드 공식 상세 API의 사진 목록만 추출한다", () => {
  const url = onbidDetailUrl("fake%2Bkey%3D", "2026-001-001");
  assert.equal(url.pathname, "/B010003/OnbidRlstDtlSrvc2/getRlstDtlInf2");
  assert.equal(url.searchParams.get("serviceKey"), "fake+key=");
  assert.equal(url.searchParams.get("cltrMngNo"), "2026-001-001");
  const payload = { header: { resultCode: "00" }, body: { items: { item: { potoUrlList: [{ urlAdr: "https://img.onbid.co.kr/a.jpg" }, { urlAdr: "https://img.onbid.co.kr/b.jpg" }] } } } };
  assert.deepEqual(onbidPhotoUrls(onbidDetailItems(payload)[0]), ["https://img.onbid.co.kr/a.jpg", "https://img.onbid.co.kr/b.jpg"]);
  assert.deepEqual(onbidPhotoUrls({ potoUrlList: "https://img.onbid.co.kr/a.jpg|https://img.onbid.co.kr/b.jpg" }), ["https://img.onbid.co.kr/a.jpg", "https://img.onbid.co.kr/b.jpg"]);
});

test("온비드 상세정보에서 사진·면적·감정평가를 개인정보 없이 보강한다", () => {
  const enrichment = onbidDetailEnrichment([{
    cltrMngNo: "2026-001-001",
    zadrNm: "경기도 테스트시 테스트로 1",
    locVntyPscdCont: "테스트역 인근",
    utlzPscdCont: "주거용",
    cltrEtcCont: "엘리베이터 있음",
    potoUrlList: [{ urlAdr: "https://img.onbid.co.kr/a.jpg" }],
    sqmsList: [{ clandCont: "건물>건물", sqmsCont: "59.76", pursAlcCont: "전부", dtlCltrNm: "테스트동 101호" }],
    apslEvlClgList: [{ apslEvlYmd: "20261001", apslEvlAmt: 123000000, urlAdr: "https://www.onbid.co.kr/appraisal.pdf" }],
    ocpyRelList: [{ ocpyRelCdNm: "소유자", acpmPrptOcpyIrpsFlnm: "홍길동" }],
    leasInfList: [{ irstDivNm: "전세권", cltrInprNm: "김**" }]
  }], "2026-001-001");
  assert.deepEqual(enrichment.imageUrls, ["https://img.onbid.co.kr/a.jpg"]);
  assert.equal(enrichment.propertyLots[0].area, "59.76㎡");
  assert.equal(enrichment.appraisalSummary.valuedAt, "2026-10-01");
  assert.equal(enrichment.documents.appraisalReport.url, "https://www.onbid.co.kr/appraisal.pdf");
  assert.equal(enrichment.tenancySummary.occupantCount, 1);
  assert.equal(JSON.stringify(enrichment).includes("홍길동"), false);
  assert.equal(JSON.stringify(enrichment).includes("김**"), false);
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
  assert.deepEqual(normalizeDataset({ metadata: { reviewed: true, demo: false, sourceUrl: "https://www.onbid.co.kr/" }, items: [{ ...item, imageUrls: ["http://unsafe.example/a.jpg", "https://img.onbid.co.kr/a.jpg"] }] }).items[0].imageUrls, ["https://img.onbid.co.kr/a.jpg"]);
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

test("수집기가 마감 임박 물건을 상세 조회해 공식 사진을 보강한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "onbid-photos-"));
  const list = { response: { header: { resultCode: "00" }, body: { pageNo: 1, numOfRows: 500, totalCount: 1, items: { item: [row] } } } };
  const detail = { header: { resultCode: "00" }, body: { items: { item: { cltrMngNo: row.cltrMngNo, potoUrlList: [{ urlAdr: "https://img.onbid.co.kr/property.jpg" }] } } } };
  const data = await collectOnbid({
    key: "test-only-key", dataDir: join(root, "data"), rawDir: join(root, "raw"), imageLimit: 1,
    now: new Date("2026-10-19T09:00:00Z"),
    fetcher: async url => new Response(JSON.stringify(new URL(url).pathname.includes("OnbidRlstDtlSrvc2") ? detail : list), { headers: { "content-type": "application/json" } })
  });
  assert.deepEqual(data.items[0].imageUrls, ["https://img.onbid.co.kr/property.jpg"]);
  assert.equal(data.metadata.photoProperties, 1);
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


test("상세 API 권한 거부는 첫 요청에서 사진 보강을 중단하고 상태를 기록한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "onbid-detail-denied-"));
  const rows = Array.from({ length: 3 }, (_, index) => ({ ...row, cltrMngNo: `denied-${index + 1}`, pbctCdtnNo: index + 1 }));
  const list = { response: { header: { resultCode: "00" }, body: { pageNo: 1, numOfRows: 500, totalCount: 3, items: { item: rows } } } };
  let detailCalls = 0;
  const data = await collectOnbid({
    key: "list-key", detailKey: "detail-key", dataDir: join(root, "data"), rawDir: join(root, "raw"), imageLimit: 3,
    now: new Date("2026-10-22T00:00:00Z"),
    fetcher: async url => {
      if (new URL(url).pathname.includes("OnbidRlstDtlSrvc2")) { detailCalls++; return new Response("", { status: 403 }); }
      return new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(data.metadata.photoProperties, 0);
  assert.equal(detailCalls, 1);
  const status = JSON.parse(await readFile(join(root, "data", "collection-status.json"), "utf8"));
  assert.equal(status.photoEnrichment.state, "detail-api-access-required");
  assert.equal(status.photoEnrichment.attempted, 1);
  assert.equal(status.photoEnrichment.requested, 3);
  assert.equal(status.photoEnrichment.denied, 1);
});

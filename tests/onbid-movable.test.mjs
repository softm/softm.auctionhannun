import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  onbidMovableListUrl, onbidMovableDetailUrl, onbidMovablePage,
  onbidMovableRecord, onbidMovableEnrichment, collectOnbidMovable
} from "../scripts/collect-onbid-movable.mjs";
import { validateData } from "../scripts/validate-data.mjs";

const row = {
  cltrMngNo: "2026-1000-056628",
  pbctCdtnNo: "0001",
  onbidCltrNm: "충주국유림관리소 국유임산물 입목 1545 + 부산물 869",
  prptDivCd: "0005",
  prptDivNm: "기타일반재산",
  orgNm: "충주국유림관리소",
  cltrBidBgngDt: "202610241600",
  cltrBidEndDt: "202610291800",
  apslEvlAmt: "34750000",
  lowstBidPrcIndctCont: "34750000",
  pbctStatNm: "입찰시작 전",
  ctprvnNm: "충청북도",
  sggNm: "음성군",
  cltrUsgMclsCtgrNm: "임산물",
  cltrUsgSclsCtgrNm: "입목"
};

const response = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

test("온비드 동산 공식 목록·상세 URL을 사용한다", () => {
  const list = onbidMovableListUrl("fake%2Bkey%3D", { prptDivCd: "0005" });
  assert.equal(list.pathname, "/B010003/OnbidMvastListSrvc2/getMvastCltrList2");
  assert.equal(list.searchParams.get("serviceKey"), "fake+key=");
  assert.equal(list.searchParams.get("prptDivCd"), "0005");
  assert.equal(list.searchParams.get("pvctTrgtYn"), "N");
  const detail = onbidMovableDetailUrl("fake%2Bkey%3D", row.cltrMngNo);
  assert.equal(detail.pathname, "/B010003/OnbidMvastDtlSrvc2/getMvastDtlInf2");
  assert.equal(detail.searchParams.get("cltrMngNo"), row.cltrMngNo);
});

test("기타일반재산 동산을 경매한눈 공매 물건으로 정규화한다", () => {
  const item = onbidMovableRecord(row, "0005");
  assert.equal(item.caseNumber, "2026-1000-056628");
  assert.equal(item.title, row.onbidCltrNm);
  assert.equal(item.category, "기타일반재산 · 임산물 · 입목");
  assert.equal(item.address, "충청북도 음성군");
  assert.equal(item.minimum, "34,750,000원");
  assert.deepEqual(item.schedules.map(value => value.type), ["입찰 시작", "입찰 마감"]);
});

test("동산 상세에서 수량·보관장소·사진을 구조화한다", () => {
  const result = onbidMovableEnrichment([{
    cltrMngNo: row.cltrMngNo,
    prptNm: "국유임산물",
    qnt: "1545",
    qntUnitNm: "m³",
    strgPlc: "충청북도 음성군 원남면",
    mnfctNm: "충주국유림관리소",
    apslEvlYmd: "20261008",
    potoUrlList: [{ urlAdr: "https://www.onbid.co.kr/sample.jpg" }]
  }], row.cltrMngNo);
  assert.equal(result.assetDetails.quantity, "1545 m³");
  assert.equal(result.assetDetails.storagePlace, "충청북도 음성군 원남면");
  assert.equal(result.appraisalSummary.valuedAt, "2026-10-08");
  assert.deepEqual(result.imageUrls, ["https://www.onbid.co.kr/sample.jpg"]);
});

test("동산 목록·상세 수집 결과를 별도 데이터셋으로 검증한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "onbid-movable-"));
  const dataDir = join(root, "data");
  const rawDir = join(root, "raw");
  const list = { response: { header: { resultCode: "00" }, body: { pageNo: 1, numOfRows: 500, totalCount: 1, items: { item: [row] } } } };
  const detail = { response: { header: { resultCode: "00" }, body: { items: { item: [{
    cltrMngNo: row.cltrMngNo, prptNm: "국유임산물", qnt: "1545", qntUnitNm: "m³",
    strgPlc: "충청북도 음성군 원남면", potoUrlList: [{ urlAdr: "https://www.onbid.co.kr/sample.jpg" }]
  }] } } } };
  const dataset = await collectOnbidMovable({
    key: "test-key", dataDir, rawDir, propertyCodes: ["0005"], detailLimit: 1,
    now: new Date("2026-10-23T12:00:00Z"),
    fetcher: async url => response(new URL(url).pathname.includes("OnbidMvastDtlSrvc2") ? detail : list)
  });
  assert.equal(dataset.metadata.datasetKind, "onbid-public-sale-movable");
  assert.equal(dataset.items.length, 1);
  assert.equal(dataset.items[0].assetDetails.quantity, "1545 m³");
  assert.equal(dataset.items[0].imageUrls.length, 1);
  assert.equal((await validateData(dataDir)).count, 1);
  const status = JSON.parse(await readFile(join(dataDir, "collection-status.json"), "utf8"));
  assert.equal(status.state, "ready");
  assert.equal(status.detailEnrichment.added, 1);
});

test("동산 목록 권한 거부는 실패로 기록한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "onbid-movable-denied-"));
  await assert.rejects(collectOnbidMovable({
    key: "test-key", dataDir: join(root, "data"), rawDir: join(root, "raw"), propertyCodes: ["0005"],
    fetcher: async () => new Response("", { status: 403 })
  }), /HTTP 403/);
  const status = JSON.parse(await readFile(join(root, "data", "collection-status.json"), "utf8"));
  assert.equal(status.state, "error");
});

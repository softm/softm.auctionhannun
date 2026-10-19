import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { filterAndSortCases, minimumAmount, reviewMetrics } from "../auction-utils.js";

const { items } = JSON.parse(await readFile(new URL("./fixtures/demo-auctions.json", import.meta.url), "utf8"));

test("주소·사건번호·유형·지역·법원 조건을 교차 적용한다", () => {
  assert.deepEqual(filterAndSortCases(items, { query: "광명", region: "경기", filter: "land", court: "수원지방법원 안산지원" }).map(item => item.id), ["sample-2"]);
  assert.equal(filterAndSortCases(items, { query: "2026타경100003" })[0].id, "sample-3");
  assert.equal(filterAndSortCases(items, { region: "서울", filter: "land" }).length, 0);
});

test("관심 물건 필터는 저장된 항목만 표시한다", () => {
  assert.deepEqual(filterAndSortCases(items, { filter: "favorite", favorites: new Set(["sample-4"]) }).map(item => item.id), ["sample-4"]);
  assert.equal(filterAndSortCases(items, { filter: "favorite" }).length, 0);
});

test("최저가를 숫자로 정렬하고 미입력 금액은 뒤에 둔다", () => {
  assert.equal(minimumAmount("3억 6,400만원"), 364000000);
  assert.equal(minimumAmount("9,000만원"), 90000000);
  assert.equal(minimumAmount("공식 확인"), Infinity);
  const result = filterAndSortCases([{ id: "new", minimum: "공식 확인" }, ...items], { sort: "minimum" });
  assert.deepEqual(result.map(item => item.id), ["sample-4", "sample-3", "sample-2", "sample-1", "new"]);
});

test("기일이 없는 사건은 뒤에 두고 원본 배열을 바꾸지 않는다", () => {
  const input = [{ id: "new" }, ...items];
  const result = filterAndSortCases(input);
  assert.equal(result.at(-1).id, "new");
  assert.equal(result[0].id, "sample-3");
  assert.equal(input[0].id, "new");
  assert.equal(filterAndSortCases(input, { sort: "recent" })[0].id, "new");
});

test("현황 지표는 실제 목록과 서류 체크만 집계한다", () => {
  const input = [...items, { id: "user-1", userAdded: true }];
  const metrics = reviewMetrics(input, new Set(["sample-1", "missing"]), {
    "sample-1": { "doc:sale-spec": true, "doc:appraisal": true, "right:registry": true },
    missing: { "doc:sale-spec": true }
  });
  assert.deepEqual(metrics, { total: 5, saved: 1, added: 1, checked: 2, documents: 15 });
});

test("Stitch 화면은 실제 지도 조작과 접근성 구조를 유지한다", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size, "HTML id는 중복되면 안 됩니다");
  for (const id of ["regionFilter", "courtFilter", "sortOrder", "mapToggle", "detailBackdrop", "checkedDocuments"]) assert.ok(ids.includes(id));
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /네이버 지도/);
  assert.match(html, /cadastralToggle/);
  assert.doesNotMatch(html, /map-art|mapPins|예시 배치도/);
  assert.doesNotMatch(html, /100% 정합|안전 추천|인수 0원/);
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");
  assert.match(build, /dist\/auction-utils\.js/);
});

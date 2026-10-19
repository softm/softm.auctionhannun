import test from "node:test";
import assert from "node:assert/strict";
import { collectionRow, number, date } from "../data-status.js";

test("status counters preserve zero and never present unknown as zero", () => {
  assert.equal(number(0), "0");
  for (const v of [null, undefined, "", -1, NaN]) assert.equal(number(v), "—");
  assert.equal(date(null), "—");
  assert.equal(date("bad"), "—");
  assert.match(date("2026-10-19T09:42:00Z"), /18:42/);
});
test("collection counts are from manifest, not an unpublished attempt", () => {
  const manifest = { demo: false, itemCount: 7512, distinctProperties: 4466, collectedAt: "2026-10-19T08:31:55Z" };
  const row = collectionRow("온비드", manifest, { state: "failed", itemCount: 7499, expectedCount: 7499 });
  assert.equal(row[1], "7,512");
  assert.equal(row[2], "4,466");
  assert.match(row[3], /비교 대상 없음/);
  assert.match(row[5], /실패/);
  const good = collectionRow("온비드", manifest, { state: "ready", itemCount: 7512, expectedCount: 7512, lastSuccessAt: manifest.collectedAt });
  assert.match(good[3], /100%/);
});
test("unconfigured, missing and demo data remain distinct", () => {
  assert.equal(collectionRow("법원", { demo: false, itemCount: 0 }, { state: "unconfigured" })[1], "0");
  assert.match(collectionRow("법원", { demo: false, itemCount: 0 }, { state: "unconfigured" })[5], /미연결/);
  assert.equal(collectionRow("법원", null, null)[1], "확인 불가");
  assert.equal(collectionRow("법원", { demo: true, itemCount: 4 }, null)[1], "확인 불가");
});

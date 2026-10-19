import assert from "node:assert/strict";
import test from "node:test";
import { containsSensitiveData, normalizeDataset } from "../scripts/collect-auctions.mjs";

const validItem = {
  id: "2026-1",
  type: "land",
  address: "서울시 테스트구 1",
  court: "서울중앙지방법원",
  caseNumber: "2026타경1",
  saleDate: "2026-11-01",
  sourceUrl: "https://www.courtauction.go.kr/"
};

test("검수 자료를 안정적인 순서와 해시로 정규화한다", () => {
  const input = { metadata: { demo: false, reviewed: true, sourceUrl: validItem.sourceUrl }, items: [validItem] };
  const first = normalizeDataset(input, null, new Date("2026-10-19T00:00:00.000Z"));
  const second = normalizeDataset(input, first, new Date("2026-10-20T00:00:00.000Z"));
  assert.equal(first.items.length, 1);
  assert.equal(second.metadata.contentHash, first.metadata.contentHash);
  assert.equal(second.metadata.collectedAt, first.metadata.collectedAt);
});

test("개인정보 필드와 주민등록번호 패턴을 거부한다", () => {
  assert.equal(containsSensitiveData({ ownerName: "홍길동" }), true);
  assert.equal(containsSensitiveData({ memo: "900101-1234567" }), true);
  assert.throws(() => normalizeDataset({ metadata: { reviewed: true, sourceUrl: validItem.sourceUrl }, items: [{ ...validItem, phone: "010-0000-0000" }] }), /개인정보/);
});

test("검수 승인 표시가 없는 피드를 거부한다", () => {
  assert.throws(() => normalizeDataset({ metadata: { sourceUrl: validItem.sourceUrl }, items: [validItem] }), /검수 승인/);
});

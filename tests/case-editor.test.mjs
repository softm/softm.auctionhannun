import test from "node:test";
import assert from "node:assert/strict";
import { editRegisteredCase, removeRegisteredCase } from "../case-editor.js";
import { createWorkspaceStore, emptyWorkspace } from "../workspace-store.js";
import { filterAndSortCases } from "../auction-utils.js";

const item = { id: "user-test", userAdded: true, court: "서울중앙지방법원", caseNumber: "검증-1", address: "서울특별시 중구 세종대로 110", title: "서울특별시 중구 세종대로 110", type: "other", saleDate: "" };
const fixture = () => ({ ...emptyWorkspace(), cases: [item], favorites: [item.id, "other"], notes: { [item.id]: "보존할 메모", other: "다른 메모" }, checks: { [item.id]: { "right:registry": true } }, verified: { [item.id]: "확인일" } });
const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };

test("registered filter excludes collected cases and preserves search", () => {
  const rows = [item, { ...item, id: "onbid-1", userAdded: false }];
  assert.deepEqual(filterAndSortCases(rows, { filter: "registered" }).map(x => x.id), [item.id]);
  assert.equal(filterAndSortCases(rows, { filter: "registered", query: "없는주소" }).length, 0);
});
test("editing keeps ID, linked notes and checks without mutating the input", () => {
  const before = fixture(), result = editRegisteredCase(before, item.id, { ...item, address: " 서울특별시 중구 을지로 12 ", type: "commercial", saleDate: "2026-12-01" });
  assert.equal(result.cases[0].id, item.id); assert.equal(result.cases[0].title, "서울특별시 중구 을지로 12");
  assert.equal(result.cases[0].category, "상가·업무");
  for (const key of ["notes", "checks", "favorites", "verified"]) assert.deepEqual(result[key], before[key]);
  assert.equal(before.cases[0].address, item.address);
  for (const changes of [{ address: " " }, { saleDate: "2026-02-30" }, { type: "__proto__" }]) assert.throws(() => editRegisteredCase(before, item.id, { ...item, ...changes }));
  assert.throws(() => editRegisteredCase(before, "collected-case", item));
});
test("delete removes only the selected registered case and linked records", () => {
  const before = fixture(), result = removeRegisteredCase(before, item.id);
  assert.equal(result.cases.length, 0); assert.deepEqual(result.favorites, ["other"]);
  assert.deepEqual(result.notes, { other: "다른 메모" }); assert.deepEqual(result.checks, {}); assert.deepEqual(result.verified, {});
  assert.equal(before.cases.length, 1); assert.throws(() => removeRegisteredCase(before, "collected-case"));
});
test("guest/account deletion commits once and survives reload; failures preserve everything", () => {
  for (const uid of [null, "case-editor-test"]) {
    const local = memory(), store = createWorkspaceStore(local);
    if (uid) { store.switchUser(uid); store.load(emptyWorkspace()); }
    store.commit(fixture()); let events = 0; store.subscribe(() => events++);
    const write = local.setItem;
    local.setItem = () => { throw new Error("quota"); };
    assert.throws(() => store.commit(removeRegisteredCase(store.snapshot(), item.id)), /quota/);
    assert.deepEqual(store.snapshot(), fixture()); assert.equal(events, 0);
    local.setItem = write; store.commit(removeRegisteredCase(store.snapshot(), item.id));
    assert.equal(events, 1);
    const restored = uid ? store.pending(uid) : createWorkspaceStore(local).snapshot();
    assert.deepEqual(restored, removeRegisteredCase(fixture(), item.id));
  }
});
test("legacy guest records migrate without deleting their original copy", () => {
  const local = memory(); local.setItem("auctionhannun:cases", JSON.stringify([item]));
  const store = createWorkspaceStore(local); assert.equal(store.snapshot().cases.length, 1);
  store.commit(removeRegisteredCase(store.snapshot(), item.id));
  assert.equal(createWorkspaceStore(local).snapshot().cases.length, 0);
  assert.equal(JSON.parse(local.getItem("auctionhannun:cases")).length, 1);
});

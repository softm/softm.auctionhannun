import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceStore, emptyWorkspace, validateWorkspace, mergeGuest } from "../workspace-store.js";
import { cloudWorkspace } from "../cloud-workspace.js";
const memory = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };
test("guest and different accounts never share writes or unsent drafts", () => {
  const local = memory(), store = createWorkspaceStore(local);
  store.set("notes", { example: "guest" }); store.switchUser("alice");
  assert.throws(() => store.set("notes", {}));
  store.load(emptyWorkspace()); store.set("notes", { example: "alice private" });
  store.switchUser("bob"); store.load(emptyWorkspace());
  assert.deepEqual(store.snapshot().notes, {}); assert.equal(store.pending("bob"), null);
  assert.equal(store.pending("alice").notes.example, "alice private");
  store.switchUser(null); assert.equal(store.snapshot().notes.example, "guest");
});
test("acknowledging an earlier save cannot remove a newer pending draft", () => {
  const store = createWorkspaceStore(memory()); store.switchUser("alice"); store.load(emptyWorkspace());
  store.set("notes", { x: "first" }); const first = store.snapshot(); store.set("notes", { x: "second" }); store.markSaved("alice", first);
  assert.equal(store.pending("alice").notes.x, "second"); store.markSaved("alice", store.snapshot()); assert.equal(store.pending("alice"), null);
});
test("guest migration preserves remote collisions and leaves original unchanged", () => {
  const remote = { ...emptyWorkspace(), notes: { x: "remote" }, favorites: ["a"] };
  const guest = { ...emptyWorkspace(), notes: { x: "local", y: "new" }, favorites: ["a", "b"] };
  const result = mergeGuest(remote, guest); assert.deepEqual(result.notes, { x: "remote", y: "new" }); assert.deepEqual(result.favorites, ["a", "b"]); assert.equal(guest.notes.x, "local");
});
test("reject malformed data, oversized notes and prototype-pollution keys", () => {
  for (const bad of [{ ...emptyWorkspace(), notes: { x: "a".repeat(3001) } }, { ...emptyWorkspace(), favorites: ["__proto__"] }, { ...emptyWorkspace(), checks: { x: { test: 1 } } }, { ...emptyWorkspace(), admin: true }]) assert.throws(() => validateWorkspace(bad));
});
test("server snapshot restore and optimistic conflict protection", async () => {
  let document;
  const snap = () => ({ exists: () => !!document, data: () => structuredClone(document) });
  const sdk = { doc: (...parts) => parts, getDocFromServer: async () => snap(), serverTimestamp: () => "server", runTransaction: async (_, fn) => fn({ get: async () => snap(), set: (_, data) => { document = data; } }) };
  const client = cloudWorkspace({}, sdk, "alice"), data = { ...emptyWorkspace(), notes: { x: "saved" } };
  assert.equal((await client.read()).revision, 0); assert.equal(await client.save(data, 0), 1); assert.equal((await client.read()).data.notes.x, "saved");
  await assert.rejects(client.save(emptyWorkspace(), 0), error => error.code === "workspace/conflict"); assert.equal((await client.read()).data.notes.x, "saved");
});
test("failed local persistence leaves the previous workspace intact", () => {
  const local = memory(), store = createWorkspaceStore(local);
  store.switchUser("alice"); store.load(emptyWorkspace());
  local.setItem = () => { throw new Error("quota"); };
  assert.throws(() => store.replace({ ...emptyWorkspace(), notes: { x: "not persisted" } }));
  assert.deepEqual(store.snapshot(), emptyWorkspace());
});

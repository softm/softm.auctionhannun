// Run only against the emulator: never create test users/data in production.
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, deleteDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import * as sdk from "firebase/firestore";
import { cloudWorkspace } from "../cloud-workspace.js";
import { emptyWorkspace } from "../workspace-store.js";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Firestore emulator required");
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const env = await initializeTestEnvironment({ projectId: "demo-auction-workspace", firestore: { host, port: Number(port), rules: await readFile("firestore.rules", "utf8") } });
const owner = env.authenticatedContext("alice").firestore(), other = env.authenticatedContext("bob").firestore(), guest = env.unauthenticatedContext().firestore();
const ref = db => doc(db, "workspaces", "alice");
const valid = revision => ({ schemaVersion: 1, payload: "{}", revision, updatedAt: serverTimestamp() });
try {
  await assertFails(getDocs(collection(guest, "workspaces")));
  for (const db of [guest, other]) { await assertFails(getDoc(ref(db))); await assertFails(setDoc(ref(db), valid(1))); await assertFails(deleteDoc(ref(db))); }
  await assertSucceeds(setDoc(ref(owner), valid(1))); await assertSucceeds(getDoc(ref(owner))); await assertSucceeds(setDoc(ref(owner), valid(2)));
  const attacks = [ { ...valid(3), extra: true }, { ...valid(3), ownerId: "bob" }, { ...valid(3), role: "admin" }, { ...valid(3), payload: "a".repeat(200001) }, { ...valid(3), payload: {} }, { ...valid(3), updatedAt: "now" }, { ...valid(3), updatedAt: new Date(0) }, { ...valid(3), schemaVersion: 2 }, { ...valid(3), revision: 2 }, { ...valid(3), revision: -1 }, { payload: "{}" } ];
  for (const [index, bad] of attacks.entries()) {
    await assertFails(setDoc(ref(owner), bad));
    const uid = `create-attack-${index}`, db = env.authenticatedContext(uid).firestore();
    // Exercise schema validation with the correct owner and valid create revision.
    const createBad = { ...bad, revision: 1 };
    if (![8, 9].includes(index)) await assertFails(setDoc(doc(db, "workspaces", uid), createBad));
    await assertFails(setDoc(doc(db, "workspaces", uid), { ...valid(1), revision: 2 }));
  }
  await assertFails(deleteDoc(ref(owner))); await assertFails(getDoc(ref(other)));
  await assertFails(setDoc(doc(owner, "workspaces/alice/private/extra"), valid(1)));
  await assertSucceeds(setDoc(ref(owner), valid(3)));
  const aliceClient = cloudWorkspace(owner, sdk, "integration-owner");
  await assertFails(aliceClient.read());
  const db = env.authenticatedContext("integration-owner").firestore();
  const firstDevice = cloudWorkspace(db, sdk, "integration-owner"), secondDevice = cloudWorkspace(db, sdk, "integration-owner");
  const saved = { ...emptyWorkspace(), notes: { "test-item": "메모 저장·복원 검증" }, favorites: ["test-item"], checks: { "test-item": { registry: true } }, verified: { "test-item": "2026-10-20" } };
  await assertSucceeds(firstDevice.save(saved, 0));
  const restored = await secondDevice.read();
  if (JSON.stringify(restored.data) !== JSON.stringify(saved)) throw new Error("Restored workspace mismatch");
  await assertSucceeds(secondDevice.save({ ...saved, notes: { "test-item": "다른 기기 수정" } }, restored.revision));
  try { await firstDevice.save(saved, 1); throw new Error("Conflict not blocked"); } catch (error) { if (error.code !== "workspace/conflict") throw error; }
  console.log("Firestore owner isolation, revision, schema, size and timestamp attack tests passed");
} finally { await env.cleanup(); }

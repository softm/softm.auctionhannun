import { validateWorkspace, emptyWorkspace } from "./workspace-store.js";

// Single-document transactions give each workspace an explicit conflict boundary.
// We do not query public auction records or persist OAuth access tokens in Firestore.
export function cloudWorkspace(db, sdk, uid) {
  const ref = sdk.doc(db, "workspaces", uid);
  return {
    async read() {
      const snap = await sdk.getDocFromServer(ref);
      if (!snap.exists()) return { revision: 0, data: emptyWorkspace() };
      const record = snap.data();
      if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1) throw new Error("지원하지 않는 저장 형식입니다.");
      return { revision: record.revision, data: validateWorkspace(JSON.parse(record.payload)) };
    },
    async save(data, expectedRevision) {
      const payload = JSON.stringify(validateWorkspace(data));
      return sdk.runTransaction(db, async transaction => {
        const snap = await transaction.get(ref);
        const current = snap.exists() ? snap.data().revision : 0;
        if (current !== expectedRevision) { const error = new Error("다른 기기에서 변경했습니다. 내 사본을 백업한 뒤 서버 자료를 다시 불러오세요."); error.code = "workspace/conflict"; throw error; }
        const revision = current + 1;
        transaction.set(ref, { schemaVersion: 1, payload, revision, updatedAt: sdk.serverTimestamp() });
        return revision;
      });
    }
  };
}

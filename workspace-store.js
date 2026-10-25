import { validateCaseFlows } from "./case-flow.js";
// Account data is never written into the legacy guest storage namespace.
export const KEYS = ["cases", "favorites", "checks", "notes", "verified", "flows"];
export const emptyWorkspace = () => ({ cases: [], favorites: [], checks: {}, notes: {}, verified: {}, flows: {} });
const plain = value => value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const safeId = value => typeof value === "string" && /^[\\p{L}\\p{N}:._-]{1,180}$/u.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
export function validateWorkspace(value) {
  if (!plain(value) || Object.keys(value).some(key => !KEYS.includes(key))) throw new Error("저장 자료 형식이 올바르지 않습니다.");
  const data = { ...emptyWorkspace(), ...value };
  if (!Array.isArray(data.cases) || data.cases.length > 500 || !Array.isArray(data.favorites) || data.favorites.length > 5000 || data.favorites.some(id => !safeId(id))) throw new Error("관심·사건 자료의 형식 또는 한도를 확인해 주세요.");
  const allowedCase = ["id", "userAdded", "court", "caseNumber", "address", "title", "type", "saleDate", "appraisal", "minimum", "ratio", "rounds", "area", "occupancy", "category"];
  const ids = new Set();
  for (const item of data.cases) {
    if (!plain(item) || !safeId(item.id) || ids.has(item.id) || item.userAdded !== true || Object.keys(item).some(key => !allowedCase.includes(key)) || Object.entries(item).some(([key, v]) => key !== "userAdded" && (typeof v !== "string" || v.length > 1000))) throw new Error("직접 등록 사건 자료를 확인해 주세요.");
    if (!["apartment", "land", "commercial", "movable", "other"].includes(item.type) || !item.address || !item.caseNumber) throw new Error("사건의 주소·번호·유형이 필요합니다.");
    ids.add(item.id);
  }
  for (const key of ["checks", "notes", "verified"]) {
    if (!plain(data[key]) || Object.keys(data[key]).length > 5000) throw new Error("작업 기록이 너무 많거나 형식이 다릅니다.");
    for (const [id, v] of Object.entries(data[key])) {
      if (!safeId(id)) throw new Error("물건 식별자가 올바르지 않습니다.");
      if (key === "checks") {
        if (!plain(v) || Object.keys(v).length > 30 || Object.entries(v).some(([k, b]) => !safeId(k) || typeof b !== "boolean")) throw new Error("체크리스트 형식 오류");
      } else if (typeof v !== "string" || v.length > (key === "notes" ? 3000 : 100)) throw new Error("메모·확인 기록 길이를 확인해 주세요.");
    }
  }
  data.flows = validateCaseFlows(data.flows || {});
  if (new TextEncoder().encode(JSON.stringify(data)).length > 200000) throw new Error("계정 작업 정보는 200KB까지 저장할 수 있습니다. 백업 후 불필요한 기록을 정리해 주세요.");
  return structuredClone(data);
}
export function mergeGuest(remote, guest) {
  const cloud = validateWorkspace(remote), local = validateWorkspace(guest);
  // Existing cloud records win on collision. The guest copy remains untouched.
  return validateWorkspace({ cases: [...cloud.cases, ...local.cases.filter(x => !cloud.cases.some(y => y.id === x.id))], favorites: [...new Set([...cloud.favorites, ...local.favorites])], checks: { ...local.checks, ...cloud.checks }, notes: { ...local.notes, ...cloud.notes }, verified: { ...local.verified, ...cloud.verified }, flows: { ...local.flows, ...cloud.flows } });
}
export function createWorkspaceStore(storage) {
  let uid = null, data = emptyWorkspace(), locked = false;
  const listeners = new Set();
  const guest = () => {
    const snapshot = storage.getItem("auctionhannun:guest-workspace");
    if (snapshot !== null) return validateWorkspace(JSON.parse(snapshot));
    const result = emptyWorkspace();
    for (const key of KEYS) { try { result[key] = JSON.parse(storage.getItem(`auctionhannun:${key}`)) ?? result[key]; } catch { /* Preserve unreadable original. */ } }
    return validateWorkspace(result);
  };
  try { data = guest(); } catch { /* Keep invalid originals on disk for recovery. */ }
  const emit = change => listeners.forEach(fn => fn({ uid, locked, data: structuredClone(data), change }));
  const commit = value => {
    if (locked) throw new Error("계정 자료 확인 중입니다. 잠시 후 다시 시도해 주세요.");
    const next = validateWorkspace(value);
    // One write/event for a whole change, including case deletion and linked records.
    if (uid) storage.setItem(`auctionhannun:account:${uid}`, JSON.stringify({ data: next, dirty: true }));
    else storage.setItem("auctionhannun:guest-workspace", JSON.stringify(next));
    data = next; emit(true);
  };
  return {
    get(key, fallback) { return structuredClone(data[key] ?? fallback); },
    set(key, value) {
      commit({ ...data, [key]: value });
    },
    commit,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    guest,
    snapshot: () => structuredClone(data),
    pending(userId) { try { const cache = JSON.parse(storage.getItem(`auctionhannun:account:${userId}`)); return cache?.dirty ? validateWorkspace(cache.data) : null; } catch { return null; } },
    switchUser(userId) { uid = userId; locked = !!uid; data = emptyWorkspace(); if (!uid) { try { data = guest(); } catch { /* Invalid originals remain on disk. */ } } emit(false); },
    load(value) { data = validateWorkspace(value); locked = false; emit(false); },
    lock() { locked = true; emit(false); },
    markSaved(userId, saved) { const current = JSON.parse(storage.getItem(`auctionhannun:account:${userId}`) || "null"); if (JSON.stringify(current?.data) === JSON.stringify(saved)) storage.removeItem(`auctionhannun:account:${userId}`); },
    replace(value) { if (!uid || locked) throw new Error("먼저 계정 자료를 불러와 주세요."); const next = validateWorkspace(value); storage.setItem(`auctionhannun:account:${uid}`, JSON.stringify({ data: next, dirty: true })); data = next; emit(true); }
  };
}
export const workspace = typeof window === "undefined" ? null : createWorkspaceStore(window.localStorage);

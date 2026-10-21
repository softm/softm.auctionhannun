import { firebaseConfig } from "./firebase-config.js";
import { workspace, mergeGuest, emptyWorkspace } from "./workspace-store.js";
import { cloudWorkspace } from "./cloud-workspace.js";
import { socialConfig } from "./social-config.js";
const $ = id => document.getElementById(id);
let task, current, epoch = 0, revision = 0, client, timer, saving = false, dirty = false, blocked = false;
const message = text => { $("accountStatus").textContent = text; $("accountDialogStatus").textContent = text; };
function showPending() {
  const pending = current && workspace.pending(current.uid);
  $("restorePending").hidden = !pending; $("keepServer").hidden = !pending;
  if (pending) workspace.lock(); // Never overwrite an unacknowledged draft with a new edit.
  return pending;
}
function download(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `auctionhannun-backup-${Date.now()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function services() {
  if (!task) task = Promise.all([
    import("https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js"),
    import("https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js")
  ]).then(([appSdk, authSdk, dbSdk]) => {
    const app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app), db = dbSdk.getFirestore(app, "auction-workspace");
    authSdk.onAuthStateChanged(auth, user => { void changeAccount(user, db, dbSdk); });
    return { auth, authSdk };
  }).catch(error => { task = null; throw error; });
  return task;
}
async function changeAccount(user, db, sdk) {
  const generation = ++epoch;
  clearTimeout(timer); dirty = false; blocked = false; saving = false; client = null; current = user;
  $("accountButton").textContent = user ? "내 계정" : "로그인";
  $("accountIdentity").textContent = user ? (user.displayName || "로그인한 사용자") : "로그인하고 작업 이어가기";
  $("accountSignedIn").hidden = !user; $("accountProviders").hidden = !!user;
  workspace.switchUser(user?.uid || null);
  if (!user) { message("비로그인 · 이 브라우저에만 저장됩니다."); return; }
  message("계정 작업 정보를 불러오는 중…"); client = cloudWorkspace(db, sdk, user.uid);
  try {
    const remote = await client.read(); if (generation !== epoch) return;
    revision = remote.revision; workspace.load(remote.data);
    const pending = showPending();
    message(pending ? "미전송 사본 보호를 위해 편집을 잠갔습니다. 내 계정에서 복구하거나 서버 자료를 선택하세요." : "계정 자료 복원 완료 · 변경 시 자동 저장됩니다.");
  } catch { if (generation === epoch) { blocked = true; message("계정 자료 조회 실패 · 기존 자료는 보존됩니다. 내 계정에서 다시 불러오거나 로그아웃하세요."); } }
}
async function flush() {
  if (!current || !client || !dirty || saving || blocked) return;
  const generation = epoch, user = current, writer = client, snapshot = workspace.snapshot();
  saving = true; dirty = false; message("계정에 저장 중… 창을 닫기 전에 완료를 확인하세요.");
  try {
    const next = await writer.save(snapshot, revision); if (generation !== epoch) return;
    revision = next; workspace.markSaved(user.uid, snapshot); $("restorePending").hidden = !workspace.pending(user.uid);
    message("계정 저장 완료 · " + new Date().toLocaleTimeString("ko-KR"));
  } catch (error) {
    if (generation !== epoch) return;
    dirty = true; blocked = true;
    message(error.code === "workspace/conflict" ? error.message : "계정 저장 실패 · 로컬 사본 보존됨. 내 계정에서 저장 재시도 또는 백업하세요.");
  } finally { if (generation === epoch) { saving = false; if (dirty && !blocked) void flush(); } }
}
workspace.subscribe(({ change }) => {
  if (!change || !current) return;
  dirty = true; clearTimeout(timer);
  message(blocked ? "로컬 사본에 보관됨 · 서버 저장 문제를 해결해야 동기화됩니다." : "변경됨 · 계정 저장 대기 중…"); timer = setTimeout(flush, 600);
});
window.addEventListener("beforeunload", event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } });
$("accountButton").addEventListener("click", () => $("accountDialog").showModal());
$("closeAccount").addEventListener("click", () => $("accountDialog").close());
$("googleLogin").addEventListener("click", async event => {
  const button = event.currentTarget; button.disabled = true;
  try { const { auth, authSdk } = await services(); await authSdk.signInWithPopup(auth, new authSdk.GoogleAuthProvider()); $("accountDialog").close(); }
  catch (error) { const code = /^auth\/[a-z-]+$/.test(error.code || "") ? ` (${error.code})` : ""; message(error.code === "auth/popup-closed-by-user" ? "로그인이 취소되었습니다." : `로그인 실패${code}. 팝업 허용·네트워크·등록 도메인을 확인해 주세요. Android 앱에서 실패하면 외부 브라우저를 사용해 주세요.`); }
  finally { button.disabled = false; }
});
$("logoutAccount").addEventListener("click", async () => {
  if ((dirty || saving) && !confirm("저장되지 않은 사본이 있습니다. 이 기기에 보존하고 로그아웃할까요?")) return;
  try { const { auth, authSdk } = await services(); await authSdk.signOut(auth); $("accountDialog").close(); }
  catch { message("로그아웃 실패. 다시 시도해 주세요."); }
});
$("retrySave").addEventListener("click", () => { blocked = false; void flush(); });
$("reloadCloud").addEventListener("click", async () => {
  if (!current || saving) return;
  if (dirty && !confirm("내 사본을 백업한 뒤 서버 자료로 화면을 바꿀까요?")) return;
  if (dirty) download(workspace.snapshot());
  const generation = ++epoch; clearTimeout(timer); workspace.lock();
  try { const remote = await client.read(); if (generation !== epoch) return; revision = remote.revision; dirty = false; blocked = false; workspace.load(remote.data); const pending = showPending(); message(pending ? "서버 자료를 불러왔습니다. 편집하려면 미전송 사본 복구 또는 서버 자료 사용을 선택하세요." : "서버 자료를 불러왔습니다."); }
  catch { if (generation === epoch) { blocked = true; message("서버 조회 실패. 로그아웃하거나 다시 불러오세요."); } }
});
$("importGuest").addEventListener("click", () => {
  if (!current || saving || blocked || !confirm("비로그인 작업 정보를 현재 계정에 가져올까요? 중복은 계정 자료를 우선하며 원본은 유지합니다.")) return;
  try { workspace.replace(mergeGuest(workspace.snapshot(), workspace.guest())); } catch (error) { message(error.message); }
});
$("restorePending").addEventListener("click", () => {
  if (!current || saving || blocked) return;
  const pending = workspace.pending(current.uid);
  if (!pending || !confirm("미전송 사본으로 현재 계정 자료를 교체할까요? 기존 서버 사본은 먼저 다운로드합니다.")) return;
  try { const remote = workspace.snapshot(); download(remote); workspace.load(remote); workspace.replace(pending); }
  catch (error) { workspace.lock(); message(error.message); }
});
$("keepServer").addEventListener("click", () => {
  if (!current || saving || blocked) return;
  const pending = workspace.pending(current.uid);
  if (!pending || !confirm("미전송 사본을 다운로드하고 서버 자료로 계속할까요? 다운로드 파일을 안전하게 보관하세요.")) return;
  download(pending); workspace.markSaved(current.uid, pending); workspace.load(workspace.snapshot());
  $("restorePending").hidden = true; $("keepServer").hidden = true; message("서버 자료를 사용합니다. 변경 시 자동 저장됩니다.");
});
$("exportWorkspace").addEventListener("click", () => download(current ? (workspace.pending(current.uid) || workspace.snapshot()) : workspace.snapshot()));
$("clearCloud").addEventListener("click", () => {
  if (!current || saving || blocked || !confirm("계정 작업 정보를 비울까요? 현재 사본을 먼저 다운로드합니다. 다른 기기에도 반영됩니다.")) return;
  try { download(workspace.snapshot()); workspace.replace(emptyWorkspace()); } catch (error) { message(error.message); }
});
for (const provider of ["kakao", "naver"]) {
  const button = $(`${provider}Login`); button.disabled = !socialConfig.baseUrl || !socialConfig.providers.includes(provider);
  button.addEventListener("click", async () => {
    try {
      const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem("auctionhannun:oauth", JSON.stringify({ verifier, expires: Date.now() + 600000 }));
      const callback = new URL("./auth-callback.html", location.href).href;
      location.assign(`${socialConfig.baseUrl}/start/${provider}?returnTo=${encodeURIComponent(callback)}&challenge=${challenge}`);
    } catch { message("로그인 준비 실패. 브라우저 저장소와 보안 연결을 확인해 주세요."); }
  });
}
void services().catch(() => message("로그인 서버 연결 실패 · 비로그인 작업은 이 브라우저에 저장됩니다."));

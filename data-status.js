const repo = "https://api.github.com/repos/softm/softm.auctionhannun";
export const datasets = [
  { name: "온비드 부동산", base: "./data/onbid" },
  { name: "온비드 동산", base: "./data/onbid-movable", optional: true },
  { name: "법원 경매", base: "./data" }
];
export function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value.toLocaleString("ko-KR") : "—";
}
export function date(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}
function publishedManifest(manifest) {
  return manifest?.demo === false && Number.isSafeInteger(manifest.itemCount) && manifest.itemCount >= 0;
}
function matchesPublishedSnapshot(manifest, status) {
  return publishedManifest(manifest) && Boolean(manifest.collectedAt)
    && status?.state === "ready" && status.lastSuccessAt === manifest.collectedAt
    && status.itemCount === manifest.itemCount
    && (!manifest.snapshotId || !status.snapshotId || manifest.snapshotId === status.snapshotId);
}
export function publishedPhotoCount(manifest, status) {
  if (!publishedManifest(manifest)) return null;
  const maximum = Number.isSafeInteger(manifest.distinctProperties) && manifest.distinctProperties >= 0
    ? manifest.distinctProperties : manifest.itemCount;
  const validCount = value => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
  if (validCount(manifest.photoProperties)) return manifest.photoProperties;
  if (matchesPublishedSnapshot(manifest, status) && validCount(status.photoProperties)) return status.photoProperties;
  // An explicitly empty published catalog contains no photo-bearing records.
  return manifest.itemCount === 0 ? 0 : null;
}
export function publishedPhotoTotal(results) {
  const counts = results.map(({ manifest, status }) => publishedPhotoCount(manifest, status));
  return counts.length && counts.every(value => value != null) ? counts.reduce((sum, value) => sum + value, 0) : null;
}
export function collectionRow(name, manifest, status) {
  if (!publishedManifest(manifest)) return [name, "확인 불가", "—", "—", "확인 불가", "—", "—", "배포 매니페스트 확인 필요"];
  const sameSnapshot = matchesPublishedSnapshot(manifest, status);
  const verified = sameSnapshot && Number.isInteger(status.expectedCount) && status.expectedCount > 0 && status.itemCount <= status.expectedCount;
  const nationwideCoverage = sameSnapshot && manifest.lazyDetails === true && Number.isFinite(status.coveragePercent) ? status.coveragePercent : null;
  const labels = { ready: "정상", unconfigured: "공급원 미연결", failed: "실패 · 이전 정상 자료 유지", error: "실패 · 이전 정상 자료 유지" };
  const propertyCount = Number.isSafeInteger(manifest.distinctProperties) && manifest.distinctProperties >= 0 ? manifest.distinctProperties : Number.isSafeInteger(manifest.uniquePropertyCount) && manifest.uniquePropertyCount >= 0 ? manifest.uniquePropertyCount : null;
  const photoCount = publishedPhotoCount(manifest, status);
  const photoCoverage = photoCount == null ? "—" : `${number(photoCount)}건${propertyCount > 0 ? ` (${Math.floor(photoCount / propertyCount * 1000) / 10}%)` : ""}`;
  const coverage = nationwideCoverage != null
    ? `전국 기본목록 ${nationwideCoverage}% · 원본 ${number(status.rawRowCount)}행`
    : verified ? `${number(status.itemCount)} / ${number(status.expectedCount)}건 (${Math.floor(status.itemCount / status.expectedCount * 1000) / 10}%)` : "— (비교 대상 없음)";
  const completed = manifest.lazyDetails === true ? `${number(status.regionCount)}개 시·도` : sameSnapshot ? number(status.completedPages) : "—";
  return [name, number(manifest.itemCount), number(propertyCount), photoCoverage, coverage, completed, date(manifest.collectedAt), `${labels[status?.state] || "상태 확인 필요"}${status?.attemptedAt ? ` · ${date(status.attemptedAt)}` : ""}`];
}
async function json(url) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function rows(id, values) {
  document.getElementById(id).replaceChildren(...values.map(cells => {
    const tr = document.createElement("tr");
    cells.forEach((value, index) => {
      const cell = document.createElement(index ? "td" : "th");
      if (!index) cell.scope = "row";
      if (id === "collectionRows" && index === 6) cell.className = "collection-time";
      if (value instanceof Node) cell.append(value); else cell.textContent = value;
      tr.append(cell);
    });
    return tr;
  }));
}
function link(label, path) {
  const a = document.createElement("a");
  a.textContent = label;
  a.href = `https://github.com/softm/softm.auctionhannun/${path}`;
  return a;
}
async function loadPublished() {
  const results = await Promise.all(datasets.map(async ({ name, base, optional = false }) => {
    const [manifest, status] = await Promise.allSettled([json(`${base}/manifest.json`), json(`${base}/collection-status.json`)]);
    return { name, optional, manifest: manifest.status === "fulfilled" ? manifest.value : null, status: status.status === "fulfilled" ? status.value : null };
  }));
  rows("collectionRows", results.map(x => collectionRow(x.name, x.manifest, x.status)));
  const onbid = results[0]?.manifest?.demo === false ? results[0].manifest : null;
  const movable = results[1]?.manifest?.demo === false ? results[1].manifest : null;
  const court = results[2]?.manifest?.demo === false ? results[2].manifest : null;
  const onbidCount = [onbid?.itemCount, movable?.itemCount].filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  const propertyCount = [onbid?.distinctProperties, movable?.distinctProperties].filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  document.getElementById("onbidCount").textContent = number(onbidCount);
  document.getElementById("propertyCount").textContent = number(propertyCount);
  document.getElementById("courtCount").textContent = number(court?.itemCount);
  const photoTotal = publishedPhotoTotal(results.filter(x => !(x.optional && !publishedManifest(x.manifest))));
  document.getElementById("photoCount").textContent = number(photoTotal);
  const onbidStatus = results[0]?.status;
  document.getElementById("photoNote").textContent = onbidStatus?.photoEnrichment?.state === "detail-api-access-required"
    ? "온비드 상세 API 권한 필요 · 사진 보강 중단"
    : onbidStatus?.photoEnrichment?.state === "rate-limited"
      ? "온비드 호출 제한 도달 · 다음 정기 수집에서 이어서 보강"
      : photoTotal == null ? "배포 자료의 사진 집계 미확인" : "온비드·법원 배포자료 합계";
  const publishedDates = results.filter(x => publishedManifest(x.manifest) && x.manifest.itemCount > 0)
    .map(x => x.manifest.collectedAt).filter(value => value && Number.isFinite(Date.parse(value))).sort();
  document.getElementById("lastCollectedAt").textContent = date(publishedDates.at(-1));
  const courtStatus = results[2]?.status;
  document.getElementById("courtDetailStatus").textContent = courtStatus?.state === "unconfigured" && court?.itemCount === 0
    ? "법원 경매 공급원 미연결 · 사건·사진·상세자료 미수집"
    : court?.lazyDetails === true && court?.itemCount > 0
      ? `전국 기본목록 ${number(court.itemCount)}건 확보 · 물건 선택 시 사건·물건 상세를 조회하고 CDN 캐시합니다.`
      : court?.itemCount > 0 ? "물건별 제공 자료 확인 필요 · 수집 건수만으로 상세자료 확보를 뜻하지 않습니다."
        : "법원 상세자료 확보 상태 확인 필요";
  document.getElementById("scope").textContent = results.map(x => `${x.name} 수집 범위: ${x.manifest?.coverage || "확인 불가"}`).join("\n");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  document.getElementById("notice").textContent = `${local ? "로컬 미리보기 자료 기준 (운영 배포본과 다를 수 있음)" : "현재 사이트에서 제공 중인 자료 기준"} · 확인 ${date(new Date())} KST${results.some(x => !x.manifest || !x.status) ? " · 일부 자료를 불러오지 못했습니다. 새로고침해 주세요." : ""}`;
}
async function loadRuns() {
  try {
    const [onbid, court] = await Promise.all([
      json(`${repo}/actions/workflows/collect-auctions.yml/runs?per_page=4`),
      json(`${repo}/actions/workflows/collect-court-public.yml/runs?per_page=4`)
    ]);
    const runs = [
      ...(Array.isArray(onbid.workflow_runs) ? onbid.workflow_runs.map(run => ({ ...run, sourceLabel: "온비드" })) : []),
      ...(Array.isArray(court.workflow_runs) ? court.workflow_runs.map(run => ({ ...run, sourceLabel: "법원 전국목록" })) : [])
    ].sort((a, b) => Date.parse(b.run_started_at || b.created_at || 0) - Date.parse(a.run_started_at || a.created_at || 0)).slice(0, 8);
    const labels = { success: "성공", failure: "실패", cancelled: "취소", skipped: "건너뜀", timed_out: "시간 초과", in_progress: "실행 중", queued: "대기 중", waiting: "대기 중" };
    rows("runRows", runs.length ? runs.map(run => [link(`${run.sourceLabel} #${Number(run.run_number)}`, `actions/runs/${Number(run.id)}`), date(run.run_started_at || run.created_at), ({ schedule: "정기 예약", workflow_dispatch: "수동 실행", push: "수동 트리거" })[run.event] || run.event, labels[run.conclusion || run.status] || "확인 필요"]) : [["실행 내역 없음", "—", "—", "—"]]);
    return true;
  } catch {
    rows("runRows", [["조회 실패", "—", "—", "GitHub API 제한 또는 네트워크 오류. 전체 실행 보기에서 확인해 주세요."]]);
    return false;
  }
}
async function loadPulls() {
  const target = document.getElementById("pulls");
  try {
    const pulls = await json(`${repo}/pulls?state=open&base=main&per_page=100`);
    if (!Array.isArray(pulls)) throw new Error("invalid pulls");
    const pending = pulls.filter(pr => pr.head?.ref?.startsWith("feature/data-refresh-") && pr.head?.repo?.full_name === "softm/softm.auctionhannun");
    target.replaceChildren(...pending.map(pr => {
      const item = document.createElement("div");
      item.className = "pr-item";
      item.append(link(`#${Number(pr.number)} ${pr.title}`, `pull/${Number(pr.number)}`), document.createTextNode(` · 검토·병합 대기 · 생성 ${date(pr.created_at)} KST`));
      return item;
    }));
    if (!pending.length) target.textContent = "조회한 열린 PR 중 수집 PR 없음. 운영 반영 완료 여부는 위 배포 자료 시각과 Pages 배포 결과를 확인하세요.";
    if (pulls.length === 100) target.append(document.createTextNode("최근 열린 PR 100개 기준입니다. 전체 목록은 GitHub에서 확인하세요."));
    return true;
  } catch {
    target.textContent = "PR 조회 실패 · 반영 대기 여부를 확인할 수 없습니다. ";
    target.append(link("GitHub PR 목록 확인 ↗", "pulls"));
    return false;
  }
}
async function refresh() {
  const button = document.getElementById("refresh");
  if (button.disabled) return;
  button.disabled = true;
  try {
    const [, runsOk, pullsOk] = await Promise.all([loadPublished(), loadRuns(), loadPulls()]);
    document.getElementById("remoteNote").textContent = `${runsOk && pullsOk ? "GitHub 공개 실행·PR 조회 완료" : "GitHub 일부 조회 실패 · 현재 제공 자료와 구분해서 확인하세요"} · ${date(new Date())} KST · 화면이 열려 있는 동안 90초마다 확인합니다. 이 버튼은 수집을 실행하지 않습니다.`;
  } finally { button.disabled = false; }
}
if (typeof document !== "undefined") {
  document.getElementById("refresh").addEventListener("click", refresh);
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 90000);
}

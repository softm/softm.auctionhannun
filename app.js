import { filterAndSortCases, regionOf, reviewMetrics } from "./auction-utils.js";
import { loadCatalog, loadDetail, cachedDetail, loadCollectionStatus } from "./auction-data.js";
import { AuctionMap } from "./auction-map.js";
import { mapConfig } from "./map-config.js";
import { eumUrl, validCoordinate, validPnu, selectParcelCandidate, parcelScopeMessage } from "./parcel-utils.js";
import { searchParcels, loadParcel } from "./parcel-api.js";
import { workspace } from "./workspace-store.js";
import { editRegisteredCase, removeRegisteredCase } from "./case-editor.js";
import { cardAtReadingLine, createScrollSelection } from "./list-map-sync.js";
const storage = {
  get: (...args) => workspace.get(...args),
  subscribe: (...args) => workspace.subscribe(...args),
  set(key, value) {
    try { workspace.set(key, value); return true; }
    catch (error) {
      const data = workspace.snapshot();
      state.added = data.cases; state.favorites = new Set(data.favorites); state.checks = data.checks; state.notes = data.notes; state.verified = data.verified;
      renderCases(); if (state.selectedId) renderDetail();
      showToast(`저장하지 못했습니다: ${error.message}`); return false;
    }
  }
};

const COURT_URL = "https://www.courtauction.go.kr/";
const ONBID_URL = "https://www.onbid.co.kr/";
const EASYLAW_URL = "https://easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=2&cciNo=2&cnpClsNo=1&csmSeq=306&popMenu=ov";
const IROS_URL = "https://www.iros.go.kr/";
const GOV24_URL = "https://www.gov.kr/";

const typeMeta = {
  apartment: { label: "주거", className: "" },
  land: { label: "토지·임야", className: "land" },
  commercial: { label: "상가·업무", className: "commercial" },
  other: { label: "기타", className: "" }
};

const documents = [
  {
    key: "sale-spec", title: "매각물건명세서", subtitle: "인수 권리와 특별매각조건의 최종 기준",
    points: ["점유자·점유 권원·보증금 관계", "매각으로 소멸하지 않는 권리", "법정지상권 성립 개요와 특별매각조건"]
  },
  {
    key: "field-report", title: "현황조사보고서", subtitle: "집행관이 조사한 점유·현장 현황",
    points: ["조사 일시·장소·방법", "점유관계와 차임·보증금", "현황 도면·사진과 실제 이용 상태"]
  },
  {
    key: "appraisal", title: "감정평가서", subtitle: "감정 시점과 평가액 산출 근거",
    points: ["평가액·평가일과 가격 산출 과정", "입지·환경·공법상 제한", "건물 구조·면적 또는 토지 공시지가"]
  }
];
const onbidDocuments = [
  { key: "onbid-notice", title: "공매 공고문", subtitle: "해당 공고의 입찰조건과 일정", points: ["입찰기간·보증금·입찰 자격", "정정·취소·특별 조건", "납부기한·계약조건"] },
  { key: "onbid-property", title: "물건 상세·명세", subtitle: "재산유형별 공개 자료 확인", points: ["일괄·지분매각 범위", "점유·명도 책임·인수 조건", "필지·건축물 현황과 원문 대조"] },
  { key: "onbid-appraisal", title: "감정평가 자료", subtitle: "제공 여부와 평가 기준 확인", points: ["평가금액·평가 시점", "첨부자료 제공 여부", "현재 현황과 차이 확인"] }
];

const rightsChecklist = [
  ["registry", "최신 등기기록 확인", "말소기준권리, 가압류, 가처분, 전세권 등 권리 순위를 직접 확인합니다."],
  ["tenant", "임차인 대항력·배당 확인", "전입일, 확정일자, 점유, 배당요구 종기를 서로 대조합니다."],
  ["ledger", "대장·토지이용계획 대조", "건축물대장, 토지대장, 위반건축물, 용도지역·지구를 확인합니다."],
  ["field", "현장조사 완료", "실제 점유자, 출입 상태, 누수·하자, 경계와 주변 거래환경을 살핍니다."],
  ["cost", "추가 비용 계산", "인수보증금, 명도비, 체납관리비, 취득세, 수선비를 보수적으로 반영합니다."],
  ["day", "입찰 당일 상태 재확인", "취하·변경·연기와 기일 진행 여부를 공식 사이트 또는 경매계에서 확인합니다."]
];


const state = {
  collected: [],
  dataset: { demo: false, collectedAt: "", status: "loading" },
  onbidDataset: null,
  onbidStatus: null,
  onbidError: "",
  onbidMovableDataset: null,
  onbidMovableStatus: null,
  onbidMovableError: "",
  collection: null,
  dataError: "",
  added: storage.get("cases", []),
  favorites: new Set(storage.get("favorites", [])),
  checks: storage.get("checks", {}),
  notes: storage.get("notes", {}),
  verified: storage.get("verified", {}),
  query: "",
  filter: "all",
  region: "all",
  court: "all",
  kind: "all",
  visibleCount: 40,
  sort: "date",
  view: "search",
  selectedId: null,
  activeTab: "summary"
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const allCases = () => [...state.added, ...state.collected];
function setParcelScopeNotice(text = "") {
  $("#parcelScopeNotice").textContent = text;
  $("#parcelScopeNotice").hidden = !text;
}
const auctionMap = new AuctionMap($("#mapCanvas"), selectCase, $("#vworldCanvas"), text => { $("#mapStatus").textContent = text; }, () => setParcelScopeNotice());
const parcelSelections = new Map();
let parcelRequest;
let boundaryRequest;
let mapOperation = 0;
let mapSelectedId = null;
let editingCaseId = null;
let deletingCaseId = null;
let scrollSyncPausedUntil = 0;
const listScrollSelection = createScrollSelection({ select: id => {
  if (id !== mapSelectedId) void focusCaseOnMap(id, { fromScroll: true });
} });

function pauseListScrollSync() {
  scrollSyncPausedUntil = Date.now() + 1000;
  listScrollSelection.cancel();
}

function selectedCardInViewport() {
  if (Date.now() < scrollSyncPausedUntil || state.selectedId || $('dialog[open]') || $(".workspace").inert) return null;
  const list = $("#caseList").getBoundingClientRect(), map = $("#mapStage").getBoundingClientRect();
  let top = Math.max(0, $(".topbar").getBoundingClientRect().bottom);
  // In the stacked mobile layout the sticky map occupies the top of the reading area.
  if (map.left < list.right && map.right > list.left && map.top < innerHeight) top = Math.max(top, map.bottom);
  const bottomNav = $(".bottom-nav").getBoundingClientRect();
  const bottomAd = $("#bottomAd");
  const adRect = bottomAd && !bottomAd.hidden ? bottomAd.getBoundingClientRect() : null;
  const bottom = Math.min(innerHeight, bottomNav.height ? bottomNav.top : innerHeight, adRect?.height ? adRect.top : innerHeight);
  return cardAtReadingLine($$("#caseList [data-map-case-id]").map(card => {
    const rect = card.getBoundingClientRect(); return { id: card.dataset.mapCaseId, top: rect.top, bottom: rect.bottom };
  }), top, bottom);
}

window.addEventListener("scroll", () => listScrollSelection.queue(selectedCardInViewport), { passive: true });
$("#resultsSheet").addEventListener("scroll", () => listScrollSelection.queue(selectedCardInViewport), { passive: true });
// Map control focus/drag must not be treated as browsing a different card.
$("#mapStage").addEventListener("pointerdown", pauseListScrollSync, { passive: true });
$("#mapStage").addEventListener("keydown", pauseListScrollSync);

function applyWorkspace(data) {
  state.added = data.cases; state.favorites = new Set(data.favorites);
  state.checks = data.checks; state.notes = data.notes; state.verified = data.verified;
}

function showRegisteredCases() {
  resetFilters(); state.filter = "registered"; state.sort = "recent";
  setView("search"); syncFilters(); renderCases();
  $("#resultsSheet").scrollIntoView({ block: "start" });
}

async function loadCollectedCases() {
  try {
    const dataset = await loadCatalog();
    state.collected = dataset.items;
    state.dataset = dataset.metadata;
  } catch (error) {
    state.dataError = location.protocol === "file:" ? "file:// 미리보기에서는 자료를 읽을 수 없습니다. npm start 후 http://localhost:3000 에서 열어 주세요." : error.message;
    state.dataset.status = "error";
  }
  try { state.collection = await loadCollectionStatus(); } catch { state.collection = { state: "unknown" }; }
  try {
    const onbid = await loadCatalog("./data/onbid", "onbid");
    state.onbidDataset = onbid.metadata;
    state.collected.push(...onbid.items);
    state.onbidStatus = await loadCollectionStatus("./data/onbid");
  } catch (error) { state.onbidError = `온비드 부동산 자료 읽기 실패: ${error.message}`; }
  try {
    const movable = await loadCatalog("./data/onbid-movable", "onbid");
    state.onbidMovableDataset = movable.metadata;
    state.collected.push(...movable.items);
    state.onbidMovableStatus = await loadCollectionStatus("./data/onbid-movable");
  } catch (error) {
    state.onbidMovableError = /HTTP 404/.test(error.message) ? "온비드 동산 API 미연결" : `온비드 동산 자료 읽기 실패: ${error.message}`;
  }
  renderDatasetStatus();
}

function renderDatasetStatus() {
  const onbidItems = state.collected.filter(item => item.auctionKind === "onbid");
  const movableCount = state.onbidMovableDataset?.itemCount || 0;
  const realEstateCount = Math.max(0, onbidItems.length - movableCount);
  const courtCount = state.collected.length - onbidItems.length;
  $("#datasetStatus").textContent = `법원경매 ${courtCount}건${state.collection?.state === "unconfigured" ? " (미연결)" : ""} · 온비드 부동산 ${realEstateCount.toLocaleString()}건 · 동산 ${movableCount.toLocaleString()}건`;
  const coverage = [
    state.onbidDataset?.coverage ? `부동산: ${state.onbidDataset.coverage}` : "",
    state.onbidMovableDataset?.coverage ? `동산: ${state.onbidMovableDataset.coverage}` : ""
  ].filter(Boolean).join(" · ");
  $("#datasetNotice").textContent = onbidItems.length
    ? `한국자산관리공사 온비드 공식 API 자료 · ${coverage || "공매 물건 수집 범위 확인 필요"}. 공고문과 최신 상태를 온비드에서 다시 확인하세요.`
    : state.dataError || state.onbidError || state.onbidMovableError || "현재 수집된 실제 물건은 0건입니다. 예시 물건으로 대체하지 않습니다.";
  const onbidState = state.onbidStatus?.state === "ready" ? "부동산 정상" : state.onbidStatus?.state === "error" ? "부동산 최근 실패" : "부동산 미확인";
  const movableState = state.onbidMovableStatus?.state === "ready" ? "동산 정상" : state.onbidMovableError ? "동산 미연결" : "동산 미수집";
  $("#collectionHealth").textContent = `법원: ${state.dataError ? "자료 오류" : state.collection?.state === "unconfigured" ? "공급원 미연결" : state.collection?.state || "미확인"} · 온비드: ${onbidState} / ${movableState}`;
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function dateLabel(date) {
  if (!date) return "기일 미입력";
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" }).format(new Date(`${date}T00:00:00`));
}

function daysUntil(date) {
  if (!date) return "일정 확인";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  const days = Math.ceil((target - today) / 86400000);
  if (days === 0) return "오늘 입찰";
  return days > 0 ? `D-${days}` : "기일 경과";
}

function filteredCases() {
  return filterAndSortCases(allCases(), state);
}

function renderMetrics() {
  const metrics = reviewMetrics(allCases(), state.favorites, state.checks);
  $("#totalCases").textContent = metrics.total.toLocaleString("ko-KR");
  $("#savedCases").textContent = metrics.saved.toLocaleString("ko-KR");
  $("#addedCases").textContent = metrics.added.toLocaleString("ko-KR");
  $("#registeredCount").textContent = metrics.added.toLocaleString("ko-KR");
  $("#checkedDocuments").textContent = `${metrics.checked.toLocaleString("ko-KR")} / ${metrics.documents.toLocaleString("ko-KR")}`;
}

function renderFilterOptions() {
  const items = allCases();
  for (const [id, values, label, key] of [
    ["#regionFilter", items.map(regionOf), "전체 지역", "region"],
    ["#courtFilter", items.map(item => item.court), "전체 법원·기관", "court"]
  ]) {
    $(id).innerHTML = `<option value="all">${label}</option>` + [...new Set(values)].filter(Boolean).sort().map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    if (state[key] !== "all" && !values.includes(state[key])) state[key] = "all";
    $(id).value = state[key];
  }
}

function propertyIllustration(type) {
  const building = type === "movable"
    ? '<path d="m33 63 47-23 48 23-48 24Z" fill="#d7e8e3"/><path d="M33 63v52l47 24V87Z" fill="#edf8f6"/><path d="M128 63v52l-48 24V87Z" fill="#b8d8d1"/><path d="m57 51 47 23M80 87v52M49 82l31 16 31-16"/><path d="M62 112h36" stroke-width="3"/>'
    : type === "land"
    ? '<path d="m20 110 56-32 62 28-57 35Z" fill="#d0dfc8"/><path d="m24 97 54-30 61 26-56 32Z" fill="#e7edce"/><path d="M44 86v-28m-10 2 10-21 10 21Z" fill="#92b39a"/><path d="M121 101V72m-10 3 10-22 10 22Z" fill="#92b39a"/><path d="m55 82 26 14 31-17M81 96v26"/>'
    : type === "commercial"
      ? '<path d="M26 65h105v67H26Z" fill="#fafcfd"/><path d="m22 65 56-28 58 28Z" fill="#bed0dd"/><path d="M37 84h29v48H37Zm43 0h40v28H80Z" fill="#d2e3e8"/><path d="M78 84v28h44V84M101 84v28"/><path d="M27 71h104v10H27Z" fill="#7faea7"/>'
      : '<path d="M34 44h59v93H34Z" fill="#f4f8fa"/><path d="m93 44 28 15v78H93Z" fill="#b9ccd9"/><path d="m34 44 27-15 60 30-28-15Z" fill="#d6e2e9"/><path d="M46 58h12v12H46Zm23 0h12v12H69ZM46 83h12v12H46Zm23 0h12v12H69ZM46 108h12v12H46Zm23 0h12v29H69Z" fill="#b3cfd3"/><path d="M103 68v57M112 72v53"/>';
  return `<svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="127" cy="30" r="13" fill="#ffffff88" stroke="none"/><path d="M15 138h130"/>${building}</svg>`;
}

function propertyVisual(item, meta) {
  const image = item.imageUrls?.[0];
  const movable = item.dataBase === "./data/onbid-movable";
  return `<div class="property-visual ${meta.className}" aria-hidden="true">${propertyIllustration(movable ? "movable" : item.type)}${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.hidden=true;this.nextElementSibling.textContent='사진을 불러오지 못했습니다'"><small>${item.auctionKind === "onbid" ? "온비드 제공 사진" : "법원경매 제공 사진"}</small>` : `<small>${movable ? "동산 물건 · 상세 사진 확인" : "유형 일러스트 · 실제 사진 아님"}</small>`}</div>`;
}

function renderPins(cases) {
  auctionMap.render(cases, state.selectedId || mapSelectedId);
  const located = cases.filter(item => validCoordinate(auctionMap.position(item))).length;
  $("#mapResultCount").textContent = String(auctionMap.map ? Math.min(500, located) : 0);
  $("#mapMissingCount").textContent = `목록 ${cases.length}건 · 좌표 미확인 ${cases.length - located}건${located > 500 ? " · 지도 최대 500건" : ""}`;
}

function renderCases() {
  listScrollSelection.cancel();
  const infeedAd = $("#infeedAd");
  const cases = filteredCases();
  const signature = JSON.stringify([state.query, state.filter, state.region, state.court, state.kind, state.sort]);
  if (renderCases.signature !== signature) state.visibleCount = 40;
  renderCases.signature = signature;
  const visibleCases = cases.slice(0, state.visibleCount);
  $("#resultCount").textContent = String(cases.length);
  $("#clearSearch").hidden = !state.query;
  renderPins(cases);
  const cards = visibleCases.map(item => {
    const meta = typeMeta[item.type] || typeMeta.other;
    const selected = (state.selectedId || mapSelectedId) === item.id ? " selected" : "";
    const favorite = state.favorites.has(item.id);
    const sample = !item.userAdded && (item.demo === true || state.dataset.demo !== false);
    return `<article class="case-card${selected}" data-map-case-id="${escapeHtml(item.id)}"${selected ? ' aria-current="true"' : ''} aria-label="${escapeHtml(item.title)}">
      ${propertyVisual(item, meta)}
      <div class="case-body">
        <div class="case-card-head"><span class="type ${meta.className}">${meta.label}</span><span class="sample-tag">${item.userAdded ? "직접 등록" : item.auctionKind === "onbid" ? "온비드 공매" : sample ? "예시 물건" : "법원경매"}</span><span class="due">${daysUntil(item.saleDate)}</span></div>
        <h3><button class="case-title" type="button" data-case-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button></h3>
        <p class="case-id">${escapeHtml(item.court)} · ${escapeHtml(item.caseNumber)}${item.auctionKind === "onbid" ? ` · ${escapeHtml(item.status)}` : ""}</p>
        <p class="case-address">${escapeHtml(item.address)} · ${escapeHtml(item.area || "면적 확인 필요")}</p>
        <div class="price-row"><div><span>감정가</span><b>${escapeHtml(item.appraisal || "직접 확인")}</b></div><div><span>최저매각가격</span><b>${escapeHtml(item.minimum || "직접 확인")}</b></div></div>
        <div class="case-bottom"><span>${dateLabel(item.saleDate)} ${item.auctionKind === "onbid" ? "입찰 마감" : "매각기일"} · 제목 선택 시 지도 이동</span><button class="case-open" type="button" data-open-case-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 상세 보기">검토하기 ${icon("arrow")}</button></div>
      </div>
      <button class="bookmark-mini${favorite ? " active" : ""}" type="button" data-favorite-id="${escapeHtml(item.id)}" aria-pressed="${favorite}" aria-label="${escapeHtml(item.title)} ${favorite ? "관심 물건에서 삭제" : "관심 물건에 추가"}">${icon("bookmark")}</button>
    </article>`;
  });
  const after = Math.max(1, Number(window.AUCTIONHANNUN_AD_CONFIG?.placements?.infeed?.after) || 5);
  // Keep the ad and its iframe connected: moving an existing iframe resets its
  // browsing context. Only replace the cards on either side of the fixed slot.
  $("#caseListBeforeAd").innerHTML = cases.length ? cards.slice(0, after).join("") : `<div class="empty-state">${state.filter === "registered" && !state.added.length ? "직접 등록한 사건이 없습니다.<br />상단 ‘사건 등록’에서 추가해 주세요." : state.kind === "court" && state.collection?.state === "unconfigured" ? "법원경매 자동 수집 공급원이 아직 연결되지 않았습니다.<br />직접 사건을 등록하거나 온비드 공매를 선택해 주세요." : "조건에 맞는 검토 물건이 없습니다.<br />검색어를 지우거나 사건을 직접 추가해 보세요."}</div>`;
  $("#caseListAfterAd").innerHTML = cards.slice(after).join("");
  if (infeedAd) infeedAd.hidden = visibleCases.length < after || infeedAd.dataset.state === "failed";
  document.dispatchEvent(new CustomEvent("auctionhannun:ads-updated"));
  updateFavoriteBadge();
  renderMetrics();
  $("#loadMore").hidden = visibleCases.length >= cases.length;
  $("#loadMore").textContent = `다음 40건 보기 · ${visibleCases.length.toLocaleString()}/${cases.length.toLocaleString()}건 표시`;
}

function getSelected() {
  return cachedDetail(state.selectedId) || allCases().find(item => item.id === state.selectedId) || null;
}

function selectCase(id) {
  pauseListScrollSync();
  const item = allCases().find(candidate => candidate.id === id);
  if (!item) return;
  ++mapOperation;
  state.selectedId = id;
  parcelRequest?.abort();
  state.activeTab = "summary";
  renderCases();
  renderDetail();
  $("#detailSheet").classList.add("open");
  $("#detailSheet").setAttribute("aria-hidden", "false");
  $("#detailSheet").inert = false;
  $("#detailBackdrop").hidden = false;
  document.body.classList.add("detail-open");
  setBackgroundInert(true);
  $("#detailSheet").scrollTop = 0;
  $("#detailClose").focus();
  void loadDetail(item).then(() => { if (state.selectedId === id) renderDetail(); }).catch(() => { if (state.selectedId === id) showToast("상세 자료를 읽지 못했습니다. 공식 원문에서 확인해 주세요."); });
  if (auctionMap.mode === "cadastral") void showCaseParcelBoundary(item, mapOperation);
}

function setBackgroundInert(inert) {
  $$(".topbar, .search-panel, .filter-panel, .mobile-filters, .skip-link, .results-sheet, .map-stage, .bottom-nav, .workspace-footer").forEach(element => { element.inert = inert; });
}

function closeDetail() {
  parcelRequest?.abort();
  const returnId = state.selectedId;
  $("#detailSheet").classList.remove("open");
  $("#detailSheet").setAttribute("aria-hidden", "true");
  $("#detailSheet").inert = true;
  $("#detailBackdrop").hidden = true;
  document.body.classList.remove("detail-open");
  setBackgroundInert(false);
  state.selectedId = null;
  renderCases();
  $$(".case-title").find(button => button.dataset.caseId === returnId)?.focus({ preventScroll: true });
}

function renderDetail() {
  const item = getSelected();
  if (!item) return;
  const meta = typeMeta[item.type] || typeMeta.other;
  const movable = item.dataBase === "./data/onbid-movable" || Boolean(item.assetDetails);
  $("#detailType").textContent = movable ? "온비드 동산" : meta.label;
  $("#detailType").className = `status-pill ${meta.className}`;
  $("#registeredActions").hidden = !item.userAdded;
  $("#detailCourt").textContent = item.court;
  $("#detailTabs [data-tab=documents]").textContent = item.auctionKind === "onbid" ? "공매 서류" : "3대 서류";
  $("#detailTitle").textContent = item.title;
  $("#detailCaseNumber").textContent = `${item.caseNumber}${item.itemNumber ? ` · ${item.itemNumber}` : ""}`;
  $("#detailFavorite").classList.toggle("active", state.favorites.has(item.id));
  $("#detailFavorite").setAttribute("aria-label", state.favorites.has(item.id) ? "관심 물건에서 삭제" : "관심 물건 저장");
  $("#priceGrid").innerHTML = [
    ["감정가", item.appraisal || "공식 확인", ""], ["최저매각가격", item.minimum || "공식 확인", "accent"],
    ["최저가율", item.ratio || "-", ""], [item.auctionKind === "onbid" ? "입찰 마감" : "매각기일", item.bidEndsAt ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" }).format(new Date(item.bidEndsAt)) : dateLabel(item.saleDate), ""]
  ].map(([label, value, cls]) => `<div class="price-cell ${cls}"><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join("");
  $$("#detailTabs button").forEach(button => {
    const active = button.dataset.tab === state.activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    button.id = `tab-${button.dataset.tab}`;
    button.setAttribute("aria-controls", "detailContent");
  });
  renderActiveTab();
}

function renderActiveTab() {
  const item = getSelected();
  if (!item) return;
  const renderers = { summary: renderSummary, documents: renderDocuments, rights: renderRights, notes: renderNotes, official: renderOfficial };
  $("#detailContent").innerHTML = renderers[state.activeTab](item);
  $("#detailContent").setAttribute("role", "tabpanel");
  $("#detailContent").setAttribute("aria-labelledby", `tab-${state.activeTab}`);
}

function detailSectionHead(iconName, kicker, title, description = "") {
  return `<div class="detail-section-head"><span class="detail-section-icon">${icon(iconName)}</span><div><small>${escapeHtml(kicker)}</small><h3>${escapeHtml(title)}</h3>${description ? `<p>${escapeHtml(description)}</p>` : ""}</div></div>`;
}

function renderDetailOverview(item) {
  const photoCount = Array.isArray(item.imageUrls) ? item.imageUrls.length : 0;
  const lotCount = Array.isArray(item.propertyLots) ? item.propertyLots.length : 0;
  const scheduleCount = Array.isArray(item.schedules) ? item.schedules.length : 0;
  const documentCount = item.documents ? Object.values(item.documents).filter(Boolean).length : 0;
  const entries = [
    ["detail-photos", "사진", photoCount ? `${photoCount}장` : "미수집", photoCount > 0],
    ["detail-basic", "기본정보", "확인", true],
    ["detail-schedule", item.auctionKind === "onbid" ? "입찰일정" : "기일내역", scheduleCount ? `${scheduleCount}건` : "원문 확인", scheduleCount > 0],
    [item.assetDetails ? "detail-asset" : "detail-lots", item.assetDetails ? "동산상세" : "물건구성", item.assetDetails ? "수집됨" : lotCount ? `${lotCount}건` : "원문 확인", Boolean(item.assetDetails) || lotCount > 0],
    ["detail-appraisal", "감정평가", item.appraisalSummary ? "수집됨" : "원문 확인", Boolean(item.appraisalSummary)],
    ["detail-tenancy", "권리·점유", item.tenancySummary ? "요약 있음" : "원문 확인", Boolean(item.tenancySummary)],
    ["detail-documents", "공식문서", documentCount ? `${documentCount}건` : "원문 확인", documentCount > 0],
    ["detail-similar", "유사물건", "비교", true]
  ];
  const available = entries.filter(([, , , ok]) => ok).length;
  return `<section class="detail-overview" aria-label="상세 정보 바로가기">
    <div class="detail-overview-copy">
      <span>PROPERTY DETAIL</span>
      <strong>물건 상세정보</strong>
      <p>사진·일정·물건 구성·감정평가·권리 기초정보를 한 흐름으로 확인합니다.</p>
    </div>
    <div class="detail-overview-score"><b>${available}/${entries.length}</b><span>정보 영역</span></div>
    <div class="detail-quick-nav">${entries.map(([target, label, value, ok]) => `<button type="button" data-action="jump-detail" data-target="${target}" class="${ok ? "available" : ""}" ${ok ? "" : "disabled"}><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></button>`).join("")}</div>
  </section>`;
}

function numericPrice(value) {
  const number = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : Number.POSITIVE_INFINITY;
}

function renderSimilarCases(item) {
  const region = regionOf(item);
  const peers = allCases().filter(candidate => candidate.id !== item.id && candidate.auctionKind === item.auctionKind).map(candidate => {
    const score = (regionOf(candidate) === region ? 4 : 0) + (candidate.type === item.type ? 3 : 0) + (candidate.category === item.category ? 2 : 0);
    return { candidate, score };
  }).filter(({ score }) => score >= 3).sort((a, b) => b.score - a.score || numericPrice(a.candidate.minimum) - numericPrice(b.candidate.minimum) || (a.candidate.saleDate || "9999").localeCompare(b.candidate.saleDate || "9999")).slice(0, 3);
  return `<section class="summary-card proptech-section" id="detail-similar">
    ${detailSectionHead("search", "COMPARE", "유사 진행 물건", "현재 수집된 같은 지역·유형의 진행 물건을 비교합니다. 낙찰사례 통계는 아닙니다.")}
    ${peers.length ? `<div class="similar-property-grid">${peers.map(({ candidate }) => `<button type="button" class="similar-property-card" data-action="related-case" data-case-id="${escapeHtml(candidate.id)}"><span>${escapeHtml(regionOf(candidate) || candidate.court)}</span><b>${escapeHtml(candidate.title)}</b><small>${escapeHtml(candidate.minimum || "가격 확인")} · ${escapeHtml(dateLabel(candidate.saleDate))}</small></button>`).join("")}</div>` : `<p class="detail-empty-copy">현재 수집 범위에서 바로 비교할 유사 물건을 찾지 못했습니다.</p>`}
  </section>`;
}

function renderSummary(item) {
  const lastVerified = state.verified[item.id];
  const notice = item.userAdded ? "직접 입력한 사건입니다. 가격·기일·진행상태는 공식 사이트 원문을 기준으로 보완하세요." : item.auctionKind === "onbid" ? "한국자산관리공사 온비드 공매 자료입니다. 법원경매가 아니며 법원 3대 서류 공시 기준을 적용하지 않습니다. 공고문·입찰 마감시각·정정 여부를 온비드 원문에서 확인하세요." : item.detailLevel === "list" ? "전국 목록 기본정보를 먼저 표시하고 있습니다. 법원 사건·물건 상세를 불러오는 중이며, 실패해도 목록 정보와 공식 원문 연결은 유지됩니다." : "수집 시점 이후 변경될 수 있습니다. 최신 진행상태와 매각조건을 공식 원문에서 다시 확인하세요.";
  return `${renderDetailOverview(item)}
    <div class="demo-banner">${icon("help")}<span>${notice}</span></div>
    ${renderImageGallery(item)}
    <section class="summary-card proptech-section" id="detail-basic">
      ${detailSectionHead("file", "BASIC", "물건 기본정보", "사건·물건 식별정보와 현재 상태를 먼저 확인합니다.")}
      <dl class="fact-list">
        <div><dt>소재지</dt><dd>${escapeHtml(item.address)}</dd></div>
        <div><dt>물건 구분</dt><dd>${escapeHtml(item.category || typeMeta[item.type]?.label || "기타")}</dd></div>
        <div><dt>진행 상태</dt><dd>${escapeHtml(item.status || "원문 확인")}</dd></div>
        <div><dt>면적</dt><dd>${escapeHtml(item.area || "원문 확인")}</dd></div>
        <div><dt>점유</dt><dd>${escapeHtml(item.occupancy || "현황조사서 확인")}</dd></div>
        <div><dt>유찰 정보</dt><dd>${escapeHtml(item.rounds || "원문 확인")}</dd></div>
        <div><dt>최근 공식 확인</dt><dd>${lastVerified ? escapeHtml(lastVerified) : "아직 기록 없음"}</dd></div>
      </dl>
    </section>
    ${renderCollectedDetails(item)}
    ${renderLandTools(item)}
    ${renderSimilarCases(item)}
    <div class="step-card"><span>1</span><div><b>공식 물건 원문 찾기</b><small>${item.auctionKind === "onbid" ? "물건관리번호로 온비드에서 검색" : "사건번호·주소로 법원경매정보에서 검색"}</small></div><button type="button" data-action="official">열기</button></div>
    <div class="step-card"><span>2</span><div><b>${item.auctionKind === "onbid" ? "공매 공고·명세 대조" : "3대 서류 대조"}</b><small>${item.auctionKind === "onbid" ? "공고별 입찰·명도·인수조건 확인" : "공시는 매각기일마다 1주일 전까지"}</small></div><button type="button" data-action="tab" data-tab-target="documents">확인</button></div>
    <div class="step-card"><span>3</span><div><b>권리·현장 체크</b><small>등기기록과 현장 점유를 원문과 교차 확인</small></div><button type="button" data-action="tab" data-tab-target="rights">체크</button></div>`;
}

function renderImageGallery(item) {
  const images = Array.isArray(item.imageUrls) ? item.imageUrls.slice(0, 8) : [];
  if (!images.length) {
    const message = item.auctionKind === "onbid"
      ? "현재 목록 자료에는 사진이 포함되지 않습니다. 온비드 부동산 물건상세 API 권한이 연결되면 공식 사진을 자동 보강합니다."
      : item.userAdded
        ? "직접 등록한 사건에는 사진이 저장되지 않았습니다."
        : "법원경매 사진 공급원이 아직 연결되지 않아 공식 사진을 표시할 수 없습니다.";
    return `<section class="detail-media-empty proptech-section" id="detail-photos" role="status"><b>공식 사진 미수집</b><span>${escapeHtml(message)}</span></section>`;
  }
  return `<section class="detail-gallery proptech-section" id="detail-photos" aria-label="${escapeHtml(item.title)} 공식 제공 사진"><div class="detail-gallery-label"><span>PHOTO</span><b>현장·물건 사진</b><small>공식 제공 사진을 좌우로 넘겨 확인하세요.</small></div>
    <div class="detail-gallery-stage"><img data-gallery-main data-gallery-index="0" src="${escapeHtml(images[0])}" alt="${escapeHtml(item.title)} 사진 1/${images.length}" decoding="async" referrerpolicy="no-referrer"><button type="button" data-action="gallery-prev" aria-label="이전 사진">‹</button><button type="button" data-action="gallery-next" aria-label="다음 사진">›</button><span data-gallery-caption>공식 제공 사진 1/${images.length}</span></div>
    ${images.length > 1 ? `<div class="detail-gallery-thumbs" aria-label="사진 선택">${images.map((url, index) => `<button type="button" data-action="gallery-select" data-gallery-index="${index}" aria-label="사진 ${index + 1} 보기" aria-current="${index === 0}"><img src="${escapeHtml(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></button>`).join("")}</div>` : ""}
  </section>`;
}

function factRows(values) {
  return values.filter(([, value]) => value !== "" && value != null).map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function renderCollectedDetails(item) {
  const sections = [];
  if (item.caseDetails) {
    const distributionLabel = item.auctionKind === "onbid" ? "배분요구종기" : "배당요구종기";
    const rows = factRows([["사건접수일", item.caseDetails.filedAt], ["경매개시결정일", item.caseDetails.commencedAt], [distributionLabel, item.caseDetails.distributionDeadline], ["청구금액", item.caseDetails.claimAmount]]);
    if (rows) sections.push(`<section class="summary-card proptech-section" id="detail-case">${detailSectionHead("file", item.auctionKind === "onbid" ? "PUBLIC SALE" : "CASE", item.auctionKind === "onbid" ? "공매 기본정보" : "사건 기본정보", "공식 상세자료에서 확인된 사건·공매 기준정보입니다.")}<dl class="fact-list">${rows}</dl></section>`);
  }
  if (Array.isArray(item.schedules) && item.schedules.length) {
    const title = item.auctionKind === "onbid" ? "입찰 일정" : "기일내역";
    const description = item.auctionKind === "onbid" ? "입찰 시작과 마감 시각, 현재 진행상태를 확인합니다." : "매각기일·매각결정기일과 유찰·변경 등 진행 이력을 확인합니다.";
    sections.push(`<section class="summary-card collected-detail proptech-section" id="detail-schedule">${detailSectionHead("clock", "SCHEDULE", title, description)}<div class="detail-table-wrap"><table><thead><tr><th>기일</th><th>종류</th><th>장소</th><th>최저가격</th><th>결과</th></tr></thead><tbody>${item.schedules.map(value => `<tr><td>${escapeHtml([value.date, value.time].filter(Boolean).join(" ") || "—")}</td><td>${escapeHtml(value.type || "—")}</td><td>${escapeHtml(value.place || "—")}</td><td>${escapeHtml(value.minimum || "—")}</td><td>${escapeHtml(value.result || "—")}</td></tr>`).join("")}</tbody></table></div></section>`);
  }
  if (Array.isArray(item.propertyLots) && item.propertyLots.length) sections.push(`<section class="summary-card collected-detail proptech-section" id="detail-lots">${detailSectionHead("list", "PROPERTY", "물건 구성·목록내역", "토지·건물의 종별, 면적, 지분과 상세 구성을 확인합니다.")}<div class="property-lot-list">${item.propertyLots.map(value => `<article><div class="lot-number">목록 ${escapeHtml(value.number)}</div><b>${escapeHtml(value.type || "구분 확인")}</b><p>${escapeHtml(value.address || item.address)}</p>${value.area ? `<span>면적 <strong>${escapeHtml(value.area)}</strong></span>` : ""}${value.share ? `<span>지분 <strong>${escapeHtml(value.share)}</strong></span>` : ""}${value.details ? `<small>${escapeHtml(value.details)}</small>` : ""}</article>`).join("")}</div></section>`);
  if (item.assetDetails) {
    const rows = factRows([
      ["재산명", item.assetDetails.assetName],
      ["수량", item.assetDetails.quantity],
      ["중량", item.assetDetails.weight],
      ["제조사", item.assetDetails.manufacturer],
      ["모델명", item.assetDetails.model],
      ["생산지", item.assetDetails.origin],
      ["보관장소", item.assetDetails.storagePlace],
      ["작품명", item.assetDetails.artworkTitle],
      ["작가명", item.assetDetails.artist],
      ["종목명", item.assetDetails.itemName],
      ["기타사항", item.assetDetails.note]
    ]);
    if (rows) sections.push(`<section class="summary-card proptech-section" id="detail-asset">${detailSectionHead("list", "MOVABLE ASSET", "동산 상세정보", "온비드 동산 상세 API의 수량·제조·모델·보관 정보를 구조화해 표시합니다.")}<dl class="fact-list asset-facts">${rows}</dl></section>`);
  }
  if (item.appraisalSummary) {
    const labels = { valuedAt: "감정평가일", location: "위치", transport: "교통", surroundings: "주변환경", usage: "이용상태", structure: "건물구조", facilities: "설비", landUse: "토지이용계획", other: "기타" };
    const rows = factRows(Object.entries(labels).map(([key, label]) => [label, item.appraisalSummary[key]]));
    if (rows) sections.push(`<section class="summary-card proptech-section" id="detail-appraisal">${detailSectionHead("search", "APPRAISAL", "감정평가 핵심 요약", "위치·교통·이용상태·구조·설비 등 감정평가 핵심 내용을 읽기 쉽게 정리합니다.")}<dl class="fact-list appraisal-facts">${rows}</dl></section>`);
  }
  if (item.tenancySummary) {
    const rows = factRows([["조사 상태", item.tenancySummary.status], ["확인된 점유 주체 수", item.tenancySummary.occupantCount], ["비식별 요약", item.tenancySummary.note]]);
    if (rows) sections.push(`<section class="summary-card proptech-section" id="detail-tenancy">${detailSectionHead("shield", "RIGHTS & OCCUPANCY", "권리·점유 기초정보", "등기·배분요구·점유·임대차 공개정보를 개인 식별정보 없이 요약합니다.")}<dl class="fact-list">${rows}</dl><p class="legal-note">개인 이름·연락처·주민등록번호는 저장하지 않습니다. 권리순위와 대항력·배당 상태는 반드시 최신 원문과 등기기록을 직접 대조하세요.</p></section>`);
  }
  if (item.documents && Object.keys(item.documents).length) {
    const labels = { saleSpecification: "매각물건명세서", fieldReport: "현황조사보고서", appraisalReport: "감정평가서" };
    sections.push(`<section class="summary-card collected-documents proptech-section" id="detail-documents">${detailSectionHead("external", "DOCUMENTS", "공식 공개문서", "수집된 공식 문서를 바로 열어 원문과 현재 정보를 대조합니다.")}${Object.entries(labels).map(([key, label]) => {
      const document = item.documents[key];
      if (!document) return "";
      return `<div><span><b>${label}</b><small>${document.publishedAt ? `공시 ${escapeHtml(document.publishedAt)}` : "공시일 확인 필요"}</small></span>${document.url ? `<a href="${escapeHtml(document.url)}" target="_blank" rel="noopener noreferrer">원문 열기 ${icon("external")}</a>` : "<em>공식 사이트 확인</em>"}</div>`;
    }).join("")}</section>`);
  }
  return sections.join("");
}

function setGalleryImage(action) {
  const item = getSelected();
  const images = item?.imageUrls;
  const main = $("[data-gallery-main]", $("#detailContent"));
  if (!main || !Array.isArray(images) || !images.length) return;
  const current = Number(main.dataset.galleryIndex) || 0;
  const requested = action.dataset.action === "gallery-prev" ? current - 1 : action.dataset.action === "gallery-next" ? current + 1 : Number(action.dataset.galleryIndex);
  const index = (requested + images.length) % images.length;
  main.src = images[index]; main.dataset.galleryIndex = String(index); main.alt = `${item.title} 사진 ${index + 1}/${images.length}`;
  $("[data-gallery-caption]", $("#detailContent")).textContent = `공식 제공 사진 ${index + 1}/${images.length}`;
  $$('[data-action="gallery-select"]', $("#detailContent")).forEach(button => button.setAttribute("aria-current", String(Number(button.dataset.galleryIndex) === index)));
}

function renderLandTools(item) {
  const selected = parcelSelections.get(item.id);
  const pnu = selected?.pnu || item.pnu;
  const url = eumUrl(pnu);
  return `<section class="summary-card land-tools proptech-section" id="detail-land">${detailSectionHead("map", "MAP & PARCEL", "위치·필지·토지이용계획", "지도 위치와 필지 후보를 확인하고 지적 경계를 공식 원문과 대조합니다.")}
    <p>주소 확인 시 소재지를 네이버에, 필지 찾기 시 소재지를 VWorld에 전송합니다. 메모·사건번호는 전송하지 않습니다.</p>
    <div class="land-actions"><button type="button" data-action="locate">지도에서 주소 확인</button><button type="button" data-action="parcel-search">필지 찾기</button></div>
    <div id="parcelResults" aria-live="polite"></div>
    ${url ? `<p>${escapeHtml(selected?.address || item.address)}<br/><small>PNU ${escapeHtml(pnu)} · ${selected ? "사용자 선택 필지" : "수집 원본 필지"}</small></p><div class="land-actions"><button type="button" data-action="parcel-map">필지 경계 보기</button><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">토지이음 원문 ↗</a></div>` : "<p>확인된 필지가 없습니다. 검색 결과의 지번을 원문과 대조한 후 선택해 주세요.</p>"}
    <small>지적도·연속지적도는 참고용입니다. 건물 대표 주소의 필지와 실제 경매 대상·일괄매각 범위가 다를 수 있으며 경계 확정·권리분석을 대신하지 않습니다.</small></section>`;
}

function renderDocuments(item) {
  const applicable = item.auctionKind === "onbid" ? onbidDocuments : documents;
  const itemChecks = state.checks[item.id] || {};
  const complete = applicable.filter(doc => itemChecks[`doc:${doc.key}`]).length;
  if (item.auctionKind === "onbid") return `<div class="section-title"><strong>온비드 공매 서류 ${complete}/3 확인</strong></div><p class="legal-note">법원경매 서류가 아닙니다. 공고별 첨부자료와 정정 여부를 확인하세요.</p>${applicable.map(doc => `<article class="document-card"><h3>${doc.title}</h3><p>${doc.subtitle}</p><ul>${doc.points.map(point => `<li>${point}</li>`).join("")}</ul><label><input type="checkbox" data-check-key="doc:${doc.key}" ${itemChecks[`doc:${doc.key}`] ? "checked" : ""}> 원문 확인 기록</label><button class="document-action" type="button" data-action="official">온비드 원문 찾기 ↗</button></article>`).join("")}`;
  return `<div class="section-title"><span>COURT DOCUMENTS</span><strong>법원 3대 핵심서류 ${complete}/3 확인</strong></div>
    <div class="official-note">${icon("clock")}<p><b>공식 공시 기준</b><span>매각기일마다 그 1주일 전까지 법원에 비치되거나 전자 공시됩니다. 기간입찰은 입찰기간 시작일을 기준으로 합니다.</span></p></div>
    ${documents.map(doc => {
      const checked = Boolean(itemChecks[`doc:${doc.key}`]);
      return `<article class="document-card${checked ? " checked" : ""}">
        <div class="document-head"><span class="document-icon">${icon("file")}</span><div><b>${doc.title}</b><small>${doc.subtitle}</small></div>
          <label class="document-check" aria-label="${doc.title} 확인 완료"><input type="checkbox" data-check-key="doc:${doc.key}" ${checked ? "checked" : ""}/>${icon("check")}</label></div>
        <ul class="document-points">${doc.points.map(point => `<li>${point}</li>`).join("")}</ul>
        <button class="document-action" type="button" data-action="official">공식 사이트에서 원문 찾기 ${icon("external")}</button>
      </article>`;
    }).join("")}
    <p class="legal-note">체크 표시는 원문을 읽었다는 개인 기록일 뿐 권리분석의 완료나 안전성을 보증하지 않습니다. 변경·정정된 문서가 있는지 입찰 직전 다시 확인하세요.</p>`;
}

function renderRights(item) {
  if (item.auctionKind === "onbid") return `<div class="section-title"><strong>공매 조건·현장 검토</strong></div><p class="legal-note">법원경매와 절차·명도·권리 소멸 기준이 같다고 가정하면 안 됩니다. 재산유형과 공고별 조건이 우선입니다.</p><div class="rights-list">${[["notice", "공고문과 정정공고 확인"], ["property", "일괄·지분매각 대상 범위 대조"], ["registry", "최신 등기기록·대장 대조"], ["handover", "점유·명도·인수 부담 확인"], ["payment", "입찰 자격·보증금·납부기한 확인"], ["field", "현장 조사·추가 비용 확인"]].map(([key, label]) => `<label class="rights-item"><input type="checkbox" data-check-key="right:onbid-${key}" ${state.checks[item.id]?.[`right:onbid-${key}`] ? "checked" : ""}><span><b>${label}</b></span></label>`).join("")}</div>`;
  const itemChecks = state.checks[item.id] || {};
  const completed = rightsChecklist.filter(([key]) => itemChecks[`right:${key}`]).length;
  const progress = Math.round((completed / rightsChecklist.length) * 100);
  return `<div class="section-title"><span>DUE DILIGENCE</span><strong>권리·현장 검토 체크리스트</strong></div>
    <div class="check-progress" style="--progress:${progress}%"><span></span><b>${completed}/${rightsChecklist.length} 완료</b></div>
    <div class="rights-list">${rightsChecklist.map(([key, title, description]) => `<label class="rights-item"><input type="checkbox" data-check-key="right:${key}" ${itemChecks[`right:${key}`] ? "checked" : ""}/><span><b>${title}</b><small>${description}</small></span></label>`).join("")}</div>
    <p class="legal-note">법원 서류만으로 확인하기 어려운 권리가 있을 수 있습니다. 필요하면 법률·세무·건축 등 분야별 전문가의 검토를 받으세요.</p>`;
}

function renderNotes(item) {
  const note = state.notes[item.id] || "";
  return `<div class="section-title"><span>FIELD NOTE</span><strong>물건별 현장·권리 메모</strong></div>
    <label class="notes-label">메모<textarea id="caseNotes" maxlength="3000" placeholder="점유자 응답, 현장 상태, 인수 가능 비용, 확인할 질문 등을 기록하세요.">${escapeHtml(note)}</textarea></label>
    <div class="note-meta"><span>로그인 시 계정에 저장합니다. 상단 저장 상태를 확인하세요.</span><button type="button" id="saveNotes" data-action="save-notes">메모 저장</button></div>
    <div class="step-card"><span>✓</span><div><b>입찰 당일 마지막 확인</b><small>취하·변경·연기·정정공고 여부와 보증금 기준 확인</small></div><button type="button" data-action="verified">오늘 확인</button></div>`;
}

function renderOfficial(item) {
  const links = [
    [item.auctionKind === "onbid" ? ONBID_URL : COURT_URL, "shield", item.auctionKind === "onbid" ? "온비드 · 한국자산관리공사" : "대한민국 법원경매정보", "물건·일정·공고 원문"],
    [IROS_URL, "file", "대법원 인터넷등기소", "최신 부동산 등기기록"],
    [GOV24_URL, "file", "정부24", "토지·건축물 등 공적 장부"],
    [EASYLAW_URL, "help", "찾기쉬운 생활법령", "경매 절차와 확인사항 안내"]
  ];
  const landUrl = eumUrl(parcelSelections.get(item.id)?.pnu || item.pnu);
  if (landUrl) links.push([landUrl, "map", "토지이음", "확인한 필지의 토지이용계획 원문"]);
  return `<div class="section-title"><span>OFFICIAL SOURCES</span><strong>공식 원문과 공적 장부</strong></div>
    <div class="official-grid">${links.map(([url, iconName, title, description]) => `<a class="official-card" href="${url}" target="_blank" rel="noopener noreferrer"><span>${icon(iconName)}</span><div><b>${title}</b><small>${description}</small></div>${icon("external")}</a>`).join("")}</div>
    <p class="legal-note">경매한눈은 공식 원문을 대체하지 않습니다. ${item.auctionKind === "onbid" ? "물건관리번호" : "사건번호"} ${escapeHtml(item.caseNumber)}의 진행상태, 매각조건, 보증금과 서류 정정 여부는 반드시 공식 사이트에서 다시 확인하세요.</p>
    `;
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  if (!storage.set("favorites", [...state.favorites])) return;
  renderCases();
  if (state.selectedId === id) renderDetail();
}

function updateFavoriteBadge() {
  const badge = $("#favoriteCount");
  const count = allCases().filter(item => state.favorites.has(item.id)).length;
  badge.textContent = String(count);
  badge.classList.toggle("show", count > 0);
}

function openOfficial(item = getSelected()) {
  if (!item) return;
  const summary = `${item.caseNumber} ${item.address}`;
  void navigator.clipboard?.writeText(summary).then(() => showToast("물건·사건번호와 주소를 복사했습니다.")).catch(() => showToast("공식 사이트에서 물건·사건번호를 검색해 주세요."));
  window.open(item.auctionKind === "onbid" ? ONBID_URL : COURT_URL, "_blank", "noopener,noreferrer");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function addCase(form) {
  const data = new FormData(form);
  const item = {
    id: `user-${Date.now()}`,
    userAdded: true,
    court: String(data.get("court") || "").trim(),
    caseNumber: String(data.get("caseNumber") || "").trim(),
    address: String(data.get("address") || "").trim(),
    title: String(data.get("address") || "").trim(),
    type: String(data.get("type") || "other"),
    saleDate: String(data.get("saleDate") || ""),
    appraisal: "공식 확인",
    minimum: "공식 확인",
    ratio: "-",
    rounds: "공식 확인",
    area: "원문 확인",
    occupancy: "현황조사서 확인",
    category: typeMeta[String(data.get("type"))]?.label || "기타"
  };
  state.added.unshift(item);
  if (!storage.set("cases", state.added)) return;
  form.reset();
  $("#addCaseDialog").close();
  state.filter = "all";
  state.query = "";
  state.region = "all";
  state.court = "all";
  state.kind = "all";
  renderFilterOptions();
  syncFilters();
  renderCases();
  selectCase(item.id);
  showToast("검토 목록에 사건을 추가했습니다.");
}

function openCaseEditor(edit = false) {
  const item = edit ? getSelected() : null;
  if (edit && !item?.userAdded) return;
  editingCaseId = item?.id || null;
  const form = $("#addCaseForm"); form.reset();
  $("#caseFormError").textContent = "";
  $("#addCaseTitle").textContent = edit ? "등록 사건 정보 수정" : "검토할 사건 추가";
  $("#caseFormIntro").textContent = edit ? "법원·사건번호·소재지·유형·기일을 수정합니다. 기존 메모·관심·체크 기록은 유지됩니다. 주소 변경 시 지도 위치와 선택 필지는 다시 확인해야 합니다." : "공식 사이트에서 확인한 사건번호와 주소를 적어 두세요. 사건 정보나 서류를 자동으로 수집하지 않습니다.";
  $(".dialog-submit", form).textContent = edit ? "수정 내용 저장" : "검토 목록에 추가";
  if (item) for (const key of ["court", "caseNumber", "address", "type", "saleDate"]) form.elements.namedItem(key).value = item[key] || "";
  openDialog("#addCaseDialog");
}

function saveCaseEdit(form) {
  try {
    const original = state.added.find(item => item.id === editingCaseId);
    const data = editRegisteredCase(workspace.snapshot(), editingCaseId, Object.fromEntries(new FormData(form)));
    workspace.commit(data); applyWorkspace(data);
    ++mapOperation;
    if (original.address !== data.cases.find(item => item.id === editingCaseId).address) {
      auctionMap.positions.delete(editingCaseId); parcelSelections.delete(editingCaseId);
      parcelRequest?.abort(); auctionMap.clearParcel();
      $("#mapStatus").textContent = "소재지가 변경되었습니다. 목록을 선택해 새 주소 위치를 확인하세요.";
    }
    $("#addCaseDialog").close();
    renderFilterOptions(); syncFilters(); renderCases(); renderDetail();
    showToast("사건 정보를 수정했습니다. 메모·관심·체크 기록은 유지됩니다.");
  } catch (error) { $("#caseFormError").textContent = error.message; }
}

function requestCaseDeletion() {
  const item = getSelected();
  if (!item?.userAdded) return;
  deletingCaseId = item.id;
  $("#deleteCaseSummary").textContent = `${item.caseNumber} · ${item.address}`;
  $("#deleteCaseError").textContent = "";
  openDialog("#deleteCaseDialog");
}

function deleteSelectedCase() {
  try {
    const data = removeRegisteredCase(workspace.snapshot(), deletingCaseId);
    workspace.commit(data); applyWorkspace(data);
    ++mapOperation; mapSelectedId = null;
    auctionMap.positions.delete(deletingCaseId); parcelSelections.delete(deletingCaseId); auctionMap.clearParcel();
    $("#deleteCaseDialog").close(); renderFilterOptions(); closeDetail(); showRegisteredCases();
    showToast("등록 사건과 연결된 기록을 삭제했습니다.");
  } catch (error) { $("#deleteCaseError").textContent = error.message; }
}

function syncFilters() {
  $$("#filterRow button").forEach(button => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#favoritesButton").setAttribute("aria-pressed", String(state.filter === "favorite"));
  $("#searchInput").value = state.query;
  $("#regionFilter").value = state.region;
  $("#courtFilter").value = state.court;
  $("#kindFilter").value = state.kind;
  $("#sortOrder").value = state.sort;
  const conditions = [state.region !== "all", state.court !== "all", state.kind !== "all", state.sort !== "date"].filter(Boolean).length;
  $("#filtersToggle").innerHTML = `지역·법원·정렬 조건${conditions ? ` · ${conditions}개 적용` : ""} ${icon(document.body.classList.contains("filters-open") ? "close" : "plus")}`;
  const current = state.view === "map" ? "map" : state.filter === "favorite" ? "favorite" : "search";
  $$('[data-nav]').forEach(button => {
    button.classList.toggle("active", button.dataset.nav === current);
    if (button.dataset.nav === current) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function setView(view) {
  state.view = view;
  document.body.classList.toggle("map-view", view === "map");
  $("#mapToggle").setAttribute("aria-pressed", String(view === "map"));
  $("#mapToggle").innerHTML = `${icon(view === "map" ? "list" : "map")}<span>${view === "map" ? "목록 보기" : "지도 보기"}</span>`;
  syncFilters();
  if (view === "map") void enableMap();
}

function resetFilters() {
  state.filter = "all";
  state.query = "";
  state.region = "all";
  state.court = "all";
  state.kind = "all";
  state.sort = "date";
  syncFilters();
  renderCases();
}

function setTab(tab) {
  state.activeTab = tab;
  renderDetail();
  $("#detailContent").scrollIntoView({ block: "start" });
}

$("#caseList").addEventListener("click", event => {
  const favorite = event.target.closest("[data-favorite-id]");
  if (favorite) { event.stopPropagation(); toggleFavorite(favorite.dataset.favoriteId); return; }
  const detail = event.target.closest("[data-open-case-id]");
  if (detail) { selectCase(detail.dataset.openCaseId); return; }
  const card = event.target.closest("[data-map-case-id]");
  if (card) void focusCaseOnMap(card.dataset.mapCaseId);
});

$("#filterRow").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  if (button.dataset.filter === "registered") { showRegisteredCases(); return; }
  state.filter = button.dataset.filter;
  syncFilters();
  renderCases();
});

$("#searchForm").addEventListener("submit", event => {
  event.preventDefault();
  state.query = $("#searchInput").value.trim();
  syncFilters();
  renderCases();
  $("#resultsSheet").scrollIntoView({ block: "start" });
  if (!filteredCases().length) showToast("일치하는 검토 물건이 없습니다.");
});

$("#searchInput").addEventListener("input", event => {
  if (!event.target.value) { state.query = ""; renderCases(); }
});

$("#clearSearch").addEventListener("click", () => {
  state.query = "";
  syncFilters();
  renderCases();
});

$("#favoritesButton").addEventListener("click", () => {
  state.filter = state.filter === "favorite" ? "all" : "favorite";
  syncFilters();
  renderCases();
});

$("#brandButton").addEventListener("click", () => {
  resetFilters();
  setView("search");
  closeDetail();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

$("#resetFilters").addEventListener("click", resetFilters);
$("#filtersToggle").addEventListener("click", event => {
  const open = document.body.classList.toggle("filters-open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
  syncFilters();
});
for (const [id, key] of [["#regionFilter", "region"], ["#courtFilter", "court"], ["#kindFilter", "kind"], ["#sortOrder", "sort"]]) {
  $(id).addEventListener("change", event => { state[key] = event.target.value; syncFilters(); renderCases(); });
}
$("#loadMore").addEventListener("click", () => { state.visibleCount += 40; renderCases(); });
$("#mapToggle").addEventListener("click", () => {
  setView(state.view === "map" ? "search" : "map");
  $(state.view === "map" ? "#mapStage" : "#resultsSheet").scrollIntoView({ block: "start" });
});
$$('[data-nav]').forEach(button => button.addEventListener("click", () => {
  const view = button.dataset.nav;
  if (view === "help") { openDialog("#helpDialog"); return; }
  if (view === "favorite") { state.filter = "favorite"; state.query = ""; state.region = "all"; state.court = "all"; }
  if (view === "search") state.filter = "all";
  setView(view === "map" ? "map" : "search");
  renderCases();
  $(view === "map" ? "#mapStage" : view === "favorite" ? "#resultsSheet" : ".search-panel").scrollIntoView({ block: "start" });
}));

$("#detailClose").addEventListener("click", closeDetail);
$("#detailBackdrop").addEventListener("click", closeDetail);
$("#detailFavorite").addEventListener("click", () => state.selectedId && toggleFavorite(state.selectedId));
$("#officialQuickOpen").addEventListener("click", () => openOfficial());
$("#copyCase").addEventListener("click", async () => {
  const item = getSelected();
  if (!item) return;
  try { await navigator.clipboard.writeText(`${item.caseNumber} ${item.address}`); showToast("사건번호와 주소를 복사했습니다."); }
  catch { showToast(`${item.caseNumber} · ${item.address}`); }
});

$("#detailTabs").addEventListener("click", event => {
  const button = event.target.closest("[data-tab]");
  if (button) setTab(button.dataset.tab);
});
$("#detailTabs").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = $$("#detailTabs button");
  const index = tabs.findIndex(button => button.dataset.tab === state.activeTab);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  setTab(tabs[next].dataset.tab);
  tabs[next].focus();
});

$("#detailContent").addEventListener("change", event => {
  const input = event.target.closest("[data-check-key]");
  if (!input || !state.selectedId) return;
  state.checks[state.selectedId] ||= {};
  state.checks[state.selectedId][input.dataset.checkKey] = input.checked;
  if (!storage.set("checks", state.checks)) return;
  renderActiveTab();
  renderMetrics();
  $$('[data-check-key]').find(candidate => candidate.dataset.checkKey === input.dataset.checkKey)?.focus();
});

$("#detailContent").addEventListener("click", event => {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action.startsWith("gallery-")) { setGalleryImage(action); return; }
  if (action.dataset.action === "jump-detail") {
    const target = document.getElementById(action.dataset.target);
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action.dataset.action === "related-case") { selectCase(action.dataset.caseId); return; }
  if (action.dataset.action === "locate") void locateSelected();
  if (action.dataset.action === "parcel-search") void findSelectedParcel();
  if (action.dataset.action === "parcel-map") void showSelectedParcel();
  if (action.dataset.action === "official") openOfficial();
  if (action.dataset.action === "tab") setTab(action.dataset.tabTarget);
  if (action.dataset.action === "verified") {
    state.verified[state.selectedId] = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
    if (!storage.set("verified", state.verified)) return;
    renderActiveTab();
    showToast("오늘 공식 확인 기록을 저장했습니다.");
  }
  if (action.dataset.action === "save-notes") {
    state.notes[state.selectedId] = $("#caseNotes").value.trim();
    if (!storage.set("notes", state.notes)) return;
    showToast("메모를 반영했습니다. 상단에서 계정 저장 상태를 확인하세요.");
  }
});

$("#addCaseForm").addEventListener("submit", event => {
  event.preventDefault();
  if (event.currentTarget.reportValidity()) {
    if (editingCaseId) saveCaseEdit(event.currentTarget); else addCase(event.currentTarget);
  }
});

function openDialog(id) { $(id).showModal(); }
$("#addCaseButton").addEventListener("click", () => openCaseEditor());
$("#editCaseButton").addEventListener("click", () => openCaseEditor(true));
$("#deleteCaseButton").addEventListener("click", requestCaseDeletion);
$("#confirmDeleteCase").addEventListener("click", deleteSelectedCase);
$("#registeredCasesButton").addEventListener("click", showRegisteredCases);
$("#helpButton").addEventListener("click", () => openDialog("#helpDialog"));
$$('[data-close-dialog]').forEach(button => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
$$('dialog').forEach(dialog => dialog.addEventListener("click", event => {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));

$("#zoomIn").addEventListener("click", () => auctionMap.zoom(1));
$("#zoomOut").addEventListener("click", () => auctionMap.zoom(-1));
$("#resetMap").addEventListener("click", () => {
  auctionMap.fit();
  $("#mapStatus").textContent = "현재 검색 결과의 확인된 좌표를 표시합니다.";
});

async function enableMap() {
  if (auctionMap.map) { auctionMap.resize(); return true; }
  try {
    $("#mapStatus").textContent = "네이버 지도 연결 중…";
    $("#enableMap").hidden = true;
    await auctionMap.ready();
    $("#mapPlaceholder").hidden = true;
    $("#mapStatus").textContent = "목록 스크롤 또는 제목 선택 시 지도가 동기화됩니다. 지적도: VWorld 연속지적도";
    $$("[data-map-mode]").forEach(button => { button.disabled = false; });
    auctionMap.resize();
    renderPins(filteredCases());
    return true;
  } catch (error) {
    $("#mapStatus").textContent = error.message;
    $("#mapPlaceholder").hidden = false;
    $("#mapPlaceholderMessage").textContent = error.message;
    $("#enableMap").hidden = false;
    return false;
  }
}

async function focusCaseOnMap(id, { fromScroll = false } = {}) {
  const item = allCases().find(candidate => candidate.id === id);
  if (!item) return;
  if (!fromScroll) pauseListScrollSync();
  const operation = ++mapOperation;
  boundaryRequest?.abort();
  auctionMap.clearParcel();
  mapSelectedId = id;
  if (!fromScroll) {
    if (state.selectedId) closeDetail();
    setView("map"); renderCases();
    $("#mapStage").scrollIntoView({ block: "start", behavior: "smooth" });
  } else {
    // Preserve DOM, keyboard focus and scroll offset during scroll-driven selection.
    $$("#caseList [data-map-case-id]").forEach(card => {
      const selected = card.dataset.mapCaseId === id;
      card.classList.toggle("selected", selected);
      if (selected) card.setAttribute("aria-current", "true"); else card.removeAttribute("aria-current");
    });
  }
  try {
    if (!await enableMap() || operation !== mapOperation) return;
    $("#mapStatus").textContent = `선택 물건 주소 확인 중: ${item.address}`;
    let position;
    try { position = await auctionMap.locate(item); }
    catch (error) {
      // A NAVER address lookup failure does not imply that VWorld has no boundary.
      if (operation !== mapOperation) return;
      if (auctionMap.mode === "cadastral") { await showCaseParcelBoundary(item, operation); return; }
      throw error;
    }
    if (operation !== mapOperation) return;
    renderPins(filteredCases()); auctionMap.focus(position);
    if (auctionMap.mode === "cadastral") await showCaseParcelBoundary(item, operation);
    else $("#mapStatus").textContent = `${position.address || item.address} · 주소 대표 위치 (경매 경계 아님)`;
  } catch (error) {
    if (operation !== mapOperation) return;
    $("#mapStatus").textContent = `선택 물건 위치 확인 실패: ${error.message} 기존 지도 위치를 유지합니다.`;
    if (!fromScroll) showToast(error.message);
  }
}

function syncMapModeControls(mode) {
  $$('[data-map-mode]').forEach(button => {
    const active = button.dataset.mapMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

async function showCaseParcelBoundary(item, operation = mapOperation) {
  if (!item || auctionMap.mode !== "cadastral") return false;
  let pnu = parcelSelections.get(item.id)?.pnu || item.pnu;
  try {
    if (!validPnu(pnu)) {
      boundaryRequest?.abort();
      const request = new AbortController();
      boundaryRequest = request;
      $("#mapStatus").textContent = `선택 매물의 필지 확인 중: ${item.address}`;
      const candidates = await searchParcels(item.address, request.signal, { primaryOnly: true });
      if (operation !== mapOperation || request.signal.aborted) return false;
      const candidate = selectParcelCandidate(item.address, candidates, { allowPrimary: true });
      parcelSelections.set(item.id, candidate);
      pnu = candidate.pnu;
    }
    $("#mapStatus").textContent = `PNU ${pnu} · 선택 매물 경계 불러오는 중…`;
    const feature = await loadParcel(pnu);
    const stillSelected = state.selectedId === item.id || mapSelectedId === item.id;
    if (operation !== mapOperation || !stillSelected || auctionMap.mode !== "cadastral") return false;
    if (!await auctionMap.showParcel(feature, () => operation === mapOperation && auctionMap.mode === "cadastral")) return false;
    syncMapModeControls("cadastral");
    const scope = parcelScopeMessage(item.address, feature.properties?.addr || parcelSelections.get(item.id)?.address);
    setParcelScopeNotice(scope);
    $("#mapStatus").textContent = `PNU ${pnu} · ${scope || "분홍색 영역은 선택 매물의 필지 경계 · 경매 대상 범위는 원문 대조"}`;
    return true;
  } catch (error) {
    if (operation !== mapOperation || error?.name === "AbortError") return false;
    auctionMap.clearParcel();
    $("#mapStatus").textContent = `선택 매물 경계 미표시: ${error.message}`;
    return false;
  }
}

async function locateSelected() {
  const item = getSelected();
  if (!item) return;
  await focusCaseOnMap(item.id);
}

async function findSelectedParcel() {
  const item = getSelected();
  if (!item) return;
  parcelRequest?.abort();
  const request = new AbortController();
  parcelRequest = request;
  const container = $("#parcelResults");
  container.textContent = "VWorld에서 필지 후보를 찾는 중…";
  try {
    const candidates = await searchParcels(item.address, request.signal);
    if (request.signal.aborted || state.selectedId !== item.id || !container.isConnected) return;
    container.replaceChildren();
    if (!candidates.length) { container.textContent = "일치하는 필지가 없습니다. 정확한 지번을 확인해 주세요."; return; }
    for (const candidate of candidates) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "parcel-candidate";
      button.textContent = `${candidate.address} · PNU ${candidate.pnu} 선택`;
      button.addEventListener("click", () => { parcelSelections.set(item.id, candidate); renderActiveTab(); });
      container.append(button);
    }
  } catch (error) { if (!request.signal.aborted && container.isConnected) container.textContent = error.message; }
}

async function showSelectedParcel() {
  const item = getSelected();
  if (!item) return;
  const pnu = parcelSelections.get(item.id)?.pnu || item.pnu;
  const operation = ++mapOperation;
  try {
    if (!await enableMap()) return;
    const feature = await loadParcel(pnu);
    if (operation !== mapOperation || state.selectedId !== item.id) return;
    closeDetail();
    setView("map");
    if (!await auctionMap.showParcel(feature, () => operation === mapOperation)) return;
    if (operation !== mapOperation) return;
    syncMapModeControls("cadastral");
    const scope = parcelScopeMessage(item.address, feature.properties?.addr || parcelSelections.get(item.id)?.address);
    setParcelScopeNotice(scope);
    $("#mapStage").scrollIntoView({ block: "start" });
    $("#mapStatus").textContent = `PNU ${pnu} · ${scope || "VWorld 연속지적도 · 경매 대상 범위는 원문 대조"}`;
  } catch (error) {
    if (operation === mapOperation) {
      const results = $("#parcelResults");
      if (results) results.textContent = error.message;
      showToast(error.message);
    }
  }
}

$("#enableMap").addEventListener("click", () => void enableMap());
$$('[data-map-mode]').forEach(button => button.addEventListener("click", async event => {
  const selectedMode = event.currentTarget.dataset.mapMode;
  $$('[data-map-mode]').forEach(control => { control.disabled = true; });
  try {
    $("#mapStatus").textContent = selectedMode === "normal" ? "네이버 일반지도로 전환 중…" : selectedMode === "satellite" ? "VWorld 위성지도로 전환 중…" : "VWorld 위성지도·연속지적도 연결 중…";
    await auctionMap.setMode(selectedMode);
    syncMapModeControls(selectedMode);
    if (selectedMode !== "cadastral") {
      auctionMap.clearParcel();
      $("#mapStatus").textContent = selectedMode === "normal" ? "네이버 일반지도 · 위치를 유지했습니다." : "VWorld 위성지도 · 위치를 유지했습니다.";
    } else {
      const selected = allCases().find(item => item.id === (state.selectedId || mapSelectedId));
      if (selected) await showCaseParcelBoundary(selected, mapOperation);
      else $("#mapStatus").textContent = "위성+지적 모드 · 목록에서 매물을 선택하면 해당 필지 경계를 표시합니다.";
    }
  } catch (error) { $("#mapStatus").textContent = error.message; showToast(error.message); }
  finally { $$('[data-map-mode]').forEach(control => { control.disabled = false; }); }
}));
$("#locateList").addEventListener("click", async event => {
  const button = event.currentTarget;
  const operation = ++mapOperation;
  button.disabled = true;
  try {
    if (!await enableMap()) return;
    const items = filteredCases().filter(item => !validCoordinate(auctionMap.position(item))).slice(0, mapConfig.geocodeBatchLimit);
    const results = await Promise.allSettled(items.map(item => auctionMap.locate(item)));
    renderPins(filteredCases());
    if (operation !== mapOperation) return;
    auctionMap.fit();
    const failures = results.filter(result => result.status === "rejected");
    $("#mapStatus").textContent = `${items.length}건 주소 확인 · 실패 ${failures.length}건${failures.length ? ` (${failures[0].reason.message})` : ""}. 미확인 물건은 목록에 유지됩니다.`;
  } finally { button.disabled = false; }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("#detailSheet").classList.contains("open") && !$('dialog[open]')) closeDetail();
  if (event.key === "Tab" && $("#detailSheet").classList.contains("open")) {
    const focusable = $$('button:not([disabled]), a[href], input, textarea, select, [tabindex="0"]', $("#detailSheet")).filter(element => element.tabIndex >= 0 && element.getClientRects().length);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});

async function bootstrap() {
  void enableMap();
  await loadCollectedCases();
  renderFilterOptions();
  syncFilters();
  renderCases();
}

storage.subscribe(({ data, locked, change }) => {
  $(".workspace").inert = locked;
  if (change) return;
  ++mapOperation; mapSelectedId = null;
  state.added = data.cases;
  state.favorites = new Set(data.favorites);
  state.checks = data.checks;
  state.notes = data.notes;
  state.verified = data.verified;
  closeDetail();
  if ($("#addCaseDialog").open) $("#addCaseDialog").close();
  if ($("#deleteCaseDialog").open) $("#deleteCaseDialog").close();
  editingCaseId = null; deletingCaseId = null;
  $("#addCaseForm").reset();
  renderFilterOptions();
  renderCases();
});
void bootstrap();

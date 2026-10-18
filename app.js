const COURT_URL = "https://www.courtauction.go.kr/";
const EASYLAW_URL = "https://easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=2&cciNo=2&cnpClsNo=1&csmSeq=306&popMenu=ov";
const IROS_URL = "https://www.iros.go.kr/";
const GOV24_URL = "https://www.gov.kr/";

const typeMeta = {
  apartment: { label: "아파트", className: "" },
  land: { label: "토지", className: "land" },
  commercial: { label: "상가", className: "commercial" },
  other: { label: "기타", className: "" }
};

const fallbackCases = [
  {
    id: "sample-1", type: "apartment", title: "서울 강남구 업무시설", address: "서울 강남구 테헤란로 000",
    court: "서울중앙지방법원", caseNumber: "2026타경100001", itemNumber: "물건 1", saleDate: "2026-11-05",
    appraisal: "12억 4,000만원", minimum: "9억 9,200만원", ratio: "80%", rounds: "1회 유찰",
    area: "전용 84.7㎡", occupancy: "점유관계 원문 확인 필요", category: "집합건물", pos: [28, 37]
  },
  {
    id: "sample-2", type: "land", title: "경기 광명시 대지", address: "경기 광명시 일직동 000-0",
    court: "수원지방법원 안산지원", caseNumber: "2026타경100002", itemNumber: "물건 1", saleDate: "2026-11-12",
    appraisal: "7억 8,000만원", minimum: "5억 4,600만원", ratio: "70%", rounds: "1회 유찰",
    area: "대지 328.1㎡", occupancy: "현장 점유 확인 필요", category: "토지", pos: [49, 55]
  },
  {
    id: "sample-3", type: "commercial", title: "인천 연수구 근린상가", address: "인천 연수구 송도동 00-0",
    court: "인천지방법원", caseNumber: "2026타경100003", itemNumber: "물건 2", saleDate: "2026-10-29",
    appraisal: "5억 2,000만원", minimum: "3억 6,400만원", ratio: "70%", rounds: "2회 유찰",
    area: "전용 61.3㎡", occupancy: "임차 현황 원문 확인 필요", category: "집합건물", pos: [72, 34]
  },
  {
    id: "sample-4", type: "apartment", title: "경기 의정부시 공동주택", address: "경기 의정부시 민락동 000",
    court: "의정부지방법원", caseNumber: "2026타경100004", itemNumber: "물건 1", saleDate: "2026-11-19",
    appraisal: "4억 8,000만원", minimum: "3억 3,600만원", ratio: "70%", rounds: "1회 유찰",
    area: "전용 59.9㎡", occupancy: "소유자 점유 추정 금지", category: "집합건물", pos: [42, 71]
  }
];

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

const rightsChecklist = [
  ["registry", "최신 등기기록 확인", "말소기준권리, 가압류, 가처분, 전세권 등 권리 순위를 직접 확인합니다."],
  ["tenant", "임차인 대항력·배당 확인", "전입일, 확정일자, 점유, 배당요구 종기를 서로 대조합니다."],
  ["ledger", "대장·토지이용계획 대조", "건축물대장, 토지대장, 위반건축물, 용도지역·지구를 확인합니다."],
  ["field", "현장조사 완료", "실제 점유자, 출입 상태, 누수·하자, 경계와 주변 거래환경을 살핍니다."],
  ["cost", "추가 비용 계산", "인수보증금, 명도비, 체납관리비, 취득세, 수선비를 보수적으로 반영합니다."],
  ["day", "입찰 당일 상태 재확인", "취하·변경·연기와 기일 진행 여부를 공식 사이트 또는 경매계에서 확인합니다."]
];

const storage = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`auctionhannun:${key}`)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) { localStorage.setItem(`auctionhannun:${key}`, JSON.stringify(value)); }
};

const state = {
  collected: fallbackCases,
  dataset: { demo: true, collectedAt: "", sourceType: "fallback" },
  added: storage.get("cases", []),
  favorites: new Set(storage.get("favorites", [])),
  checks: storage.get("checks", {}),
  notes: storage.get("notes", {}),
  verified: storage.get("verified", {}),
  query: "",
  filter: "all",
  selectedId: null,
  activeTab: "summary",
  zoom: 1
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const allCases = () => [...state.added, ...state.collected];

async function loadCollectedCases() {
  try {
    const response = await fetch("./data/auctions.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const dataset = await response.json();
    if (!Array.isArray(dataset.items) || !dataset.items.length) throw new Error("empty dataset");
    state.collected = dataset.items;
    state.dataset = dataset.metadata || state.dataset;
  } catch (error) {
    console.warn("Collected auction data unavailable; using verified UI fallback", error);
  }
  renderDatasetStatus();
}

function renderDatasetStatus() {
  const demo = state.dataset.demo !== false;
  const collected = state.dataset.collectedAt
    ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.dataset.collectedAt))
    : "내장 자료";
  $("#datasetStatus").textContent = demo ? "화면 기능 확인용 검수 예시" : `수집자료 갱신 ${collected}`;
  $("#datasetNotice").textContent = demo
    ? "예시 물건은 실제 사건이 아닙니다. 직접 추가한 사건도 최신 상태와 서류 원문을 대한민국 법원경매정보에서 확인하세요."
    : `출처가 기록된 수집자료입니다. ${collected} 기준이며 최신 상태와 서류 원문은 대한민국 법원경매정보에서 다시 확인하세요.`;
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
  const normalized = state.query.trim().toLowerCase();
  return allCases().filter(item => {
    const matchesFilter = state.filter === "all"
      || (state.filter === "favorite" ? state.favorites.has(item.id) : item.type === state.filter);
    const haystack = `${item.title} ${item.address} ${item.court} ${item.caseNumber}`.toLowerCase();
    return matchesFilter && (!normalized || haystack.includes(normalized));
  });
}

function renderPins(cases) {
  $("#mapPins").innerHTML = cases.map((item, index) => {
    const [x, y] = item.pos || [38 + (index * 9) % 42, 34 + (index * 13) % 40];
    const active = state.selectedId === item.id ? " active" : "";
    const added = item.userAdded ? " user-added" : "";
    return `<button class="map-pin${active}${added}" style="left:${x}%;top:${y}%" type="button" data-case-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)}"><span>${index + 1}</span></button>`;
  }).join("");
}

function renderCases() {
  const cases = filteredCases();
  $("#resultCount").textContent = String(cases.length);
  $("#mapResultCount").textContent = String(cases.length);
  $("#clearSearch").hidden = !state.query;
  renderPins(cases);
  $("#caseList").innerHTML = cases.length ? cases.map(item => {
    const meta = typeMeta[item.type] || typeMeta.other;
    const selected = state.selectedId === item.id ? " selected" : "";
    const favorite = state.favorites.has(item.id);
    return `<article class="case-card${selected}" tabindex="0" role="button" data-case-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)} 상세 보기">
      <div class="case-card-head"><span class="type ${meta.className}">${meta.label}</span><span class="due">${daysUntil(item.saleDate)} · ${dateLabel(item.saleDate)}</span></div>
      <h2>${escapeHtml(item.title)}</h2>
      <p class="case-id">${escapeHtml(item.court)} · ${escapeHtml(item.caseNumber)}</p>
      <div class="price-row"><div><span>감정가</span><b>${escapeHtml(item.appraisal || "직접 확인")}</b></div><div><span>최저가</span><b>${escapeHtml(item.minimum || "직접 확인")}</b></div></div>
      <button class="bookmark-mini${favorite ? " active" : ""}" type="button" data-favorite-id="${escapeHtml(item.id)}" aria-label="${favorite ? "관심 물건에서 삭제" : "관심 물건에 추가"}">${icon("bookmark")}</button>
    </article>`;
  }).join("") : `<div class="empty-state">조건에 맞는 검토 물건이 없습니다.<br />검색어를 지우거나 사건을 직접 추가해 보세요.</div>`;
  updateFavoriteBadge();
}

function getSelected() {
  return allCases().find(item => item.id === state.selectedId) || null;
}

function selectCase(id) {
  const item = allCases().find(candidate => candidate.id === id);
  if (!item) return;
  state.selectedId = id;
  state.activeTab = "summary";
  renderCases();
  renderDetail();
  $("#detailSheet").classList.add("open");
  $("#detailSheet").setAttribute("aria-hidden", "false");
}

function closeDetail() {
  $("#detailSheet").classList.remove("open");
  $("#detailSheet").setAttribute("aria-hidden", "true");
  state.selectedId = null;
  renderCases();
}

function renderDetail() {
  const item = getSelected();
  if (!item) return;
  const meta = typeMeta[item.type] || typeMeta.other;
  $("#detailType").textContent = meta.label;
  $("#detailType").className = `status-pill ${meta.className}`;
  $("#detailCourt").textContent = item.court;
  $("#detailTitle").textContent = item.title;
  $("#detailCaseNumber").textContent = `${item.caseNumber}${item.itemNumber ? ` · ${item.itemNumber}` : ""}`;
  $("#detailFavorite").classList.toggle("active", state.favorites.has(item.id));
  $("#detailFavorite").setAttribute("aria-label", state.favorites.has(item.id) ? "관심 물건에서 삭제" : "관심 물건 저장");
  $("#priceGrid").innerHTML = [
    ["감정가", item.appraisal || "공식 확인", ""], ["최저매각가격", item.minimum || "공식 확인", "accent"],
    ["최저가율", item.ratio || "-", ""], ["매각기일", dateLabel(item.saleDate), ""]
  ].map(([label, value, cls]) => `<div class="price-cell ${cls}"><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join("");
  $$("#detailTabs button").forEach(button => {
    const active = button.dataset.tab === state.activeTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  renderActiveTab();
}

function renderActiveTab() {
  const item = getSelected();
  if (!item) return;
  const renderers = { summary: renderSummary, documents: renderDocuments, rights: renderRights, notes: renderNotes, official: renderOfficial };
  $("#detailContent").innerHTML = renderers[state.activeTab](item);
}

function renderSummary(item) {
  const lastVerified = state.verified[item.id];
  return `<div class="demo-banner">${icon("help")}<span>${item.userAdded ? "직접 입력한 사건입니다. 가격·기일·진행상태는 공식 사이트 원문을 기준으로 보완하세요." : "화면 기능 확인용 예시 물건입니다. 실제 사건·가격·기일 정보가 아닙니다."}</span></div>
    <section class="summary-card">
      <h3>물건 검토 기준정보</h3>
      <dl class="fact-list">
        <div><dt>소재지</dt><dd>${escapeHtml(item.address)}</dd></div>
        <div><dt>물건 구분</dt><dd>${escapeHtml(item.category || typeMeta[item.type]?.label || "기타")}</dd></div>
        <div><dt>면적</dt><dd>${escapeHtml(item.area || "원문 확인")}</dd></div>
        <div><dt>점유</dt><dd>${escapeHtml(item.occupancy || "현황조사서 확인")}</dd></div>
        <div><dt>유찰 정보</dt><dd>${escapeHtml(item.rounds || "원문 확인")}</dd></div>
        <div><dt>최근 공식 확인</dt><dd>${lastVerified ? escapeHtml(lastVerified) : "아직 기록 없음"}</dd></div>
      </dl>
    </section>
    <div class="step-card"><span>1</span><div><b>공식 물건 원문 찾기</b><small>사건번호·주소를 복사한 뒤 법원경매정보에서 검색</small></div><button type="button" data-action="official">열기</button></div>
    <div class="step-card"><span>2</span><div><b>3대 서류 대조</b><small>공시는 매각기일마다 1주일 전까지</small></div><button type="button" data-action="tab" data-tab-target="documents">확인</button></div>
    <div class="step-card"><span>3</span><div><b>권리·현장 체크</b><small>등기기록과 현장 점유를 원문과 교차 확인</small></div><button type="button" data-action="tab" data-tab-target="rights">체크</button></div>`;
}

function renderDocuments(item) {
  const itemChecks = state.checks[item.id] || {};
  const complete = documents.filter(doc => itemChecks[`doc:${doc.key}`]).length;
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
    <div class="note-meta"><span>이 브라우저에만 저장됩니다.</span><button type="button" id="saveNotes" data-action="save-notes">메모 저장</button></div>
    <div class="step-card"><span>✓</span><div><b>입찰 당일 마지막 확인</b><small>취하·변경·연기·정정공고 여부와 보증금 기준 확인</small></div><button type="button" data-action="verified">오늘 확인</button></div>`;
}

function renderOfficial(item) {
  const links = [
    [COURT_URL, "shield", "대한민국 법원경매정보", "물건·기일·3대 서류 원문"],
    [IROS_URL, "file", "대법원 인터넷등기소", "최신 부동산 등기기록"],
    [GOV24_URL, "file", "정부24", "토지·건축물 등 공적 장부"],
    [EASYLAW_URL, "help", "찾기쉬운 생활법령", "경매 절차와 확인사항 안내"]
  ];
  return `<div class="section-title"><span>OFFICIAL SOURCES</span><strong>공식 원문과 공적 장부</strong></div>
    <div class="official-grid">${links.map(([url, iconName, title, description]) => `<a class="official-card" href="${url}" target="_blank" rel="noopener noreferrer"><span>${icon(iconName)}</span><div><b>${title}</b><small>${description}</small></div>${icon("external")}</a>`).join("")}</div>
    <p class="legal-note">경매한눈은 공식 원문을 대체하지 않습니다. 사건번호 ${escapeHtml(item.caseNumber)}의 진행상태, 매각조건, 보증금과 서류 정정 여부는 반드시 공식 사이트에서 다시 확인하세요.</p>
    ${item.userAdded ? `<button class="delete-case" type="button" data-action="delete-case">이 사건을 검토 목록에서 삭제</button>` : ""}`;
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id); else state.favorites.add(id);
  storage.set("favorites", [...state.favorites]);
  renderCases();
  if (state.selectedId === id) renderDetail();
}

function updateFavoriteBadge() {
  const badge = $("#favoriteCount");
  badge.textContent = String(state.favorites.size);
  badge.classList.toggle("show", state.favorites.size > 0);
}

function openOfficial(item = getSelected()) {
  if (!item) return;
  const summary = `${item.caseNumber} ${item.address}`;
  void navigator.clipboard?.writeText(summary).then(() => showToast("사건번호와 주소를 복사했습니다.")).catch(() => showToast("공식 사이트에서 사건번호를 검색해 주세요."));
  window.open(COURT_URL, "_blank", "noopener,noreferrer");
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
  const count = state.added.length;
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
    category: typeMeta[String(data.get("type"))]?.label || "기타",
    pos: [32 + (count * 13) % 45, 32 + (count * 17) % 42]
  };
  state.added.unshift(item);
  storage.set("cases", state.added);
  form.reset();
  $("#addCaseDialog").close();
  state.filter = "all";
  state.query = "";
  syncFilters();
  renderCases();
  selectCase(item.id);
  showToast("검토 목록에 사건을 추가했습니다.");
}

function deleteSelectedCase() {
  const item = getSelected();
  if (!item?.userAdded) return;
  state.added = state.added.filter(candidate => candidate.id !== item.id);
  state.favorites.delete(item.id);
  delete state.checks[item.id];
  delete state.notes[item.id];
  delete state.verified[item.id];
  storage.set("cases", state.added);
  storage.set("favorites", [...state.favorites]);
  storage.set("checks", state.checks);
  storage.set("notes", state.notes);
  storage.set("verified", state.verified);
  closeDetail();
  showToast("추가한 사건을 삭제했습니다.");
}

function syncFilters() {
  $$("#filterRow button").forEach(button => button.classList.toggle("active", button.dataset.filter === state.filter));
  $("#searchInput").value = state.query;
}

function setTab(tab) {
  state.activeTab = tab;
  renderDetail();
  $("#detailContent").scrollIntoView({ block: "nearest" });
}

$("#caseList").addEventListener("click", event => {
  const favorite = event.target.closest("[data-favorite-id]");
  if (favorite) { event.stopPropagation(); toggleFavorite(favorite.dataset.favoriteId); return; }
  const card = event.target.closest("[data-case-id]");
  if (card) selectCase(card.dataset.caseId);
});

$("#caseList").addEventListener("keydown", event => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches(".case-card")) {
    event.preventDefault();
    selectCase(event.target.dataset.caseId);
  }
});

$("#mapPins").addEventListener("click", event => {
  const pin = event.target.closest("[data-case-id]");
  if (pin) selectCase(pin.dataset.caseId);
});

$("#filterRow").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  syncFilters();
  renderCases();
});

$("#searchForm").addEventListener("submit", event => {
  event.preventDefault();
  state.query = $("#searchInput").value.trim();
  renderCases();
  const first = filteredCases()[0];
  if (first) selectCase(first.id); else showToast("일치하는 검토 물건이 없습니다.");
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
  state.filter = "all";
  state.query = "";
  syncFilters();
  closeDetail();
  $("#resultsSheet").classList.remove("collapsed");
});

$("#sheetHandle").addEventListener("click", event => {
  const sheet = $("#resultsSheet");
  sheet.classList.toggle("collapsed");
  event.currentTarget.setAttribute("aria-expanded", String(!sheet.classList.contains("collapsed")));
});

$("#detailClose").addEventListener("click", closeDetail);
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

$("#detailContent").addEventListener("change", event => {
  const input = event.target.closest("[data-check-key]");
  if (!input || !state.selectedId) return;
  state.checks[state.selectedId] ||= {};
  state.checks[state.selectedId][input.dataset.checkKey] = input.checked;
  storage.set("checks", state.checks);
  renderActiveTab();
});

$("#detailContent").addEventListener("click", event => {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "official") openOfficial();
  if (action.dataset.action === "tab") setTab(action.dataset.tabTarget);
  if (action.dataset.action === "verified") {
    state.verified[state.selectedId] = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date());
    storage.set("verified", state.verified);
    renderActiveTab();
    showToast("오늘 공식 확인 기록을 저장했습니다.");
  }
  if (action.dataset.action === "delete-case") deleteSelectedCase();
  if (action.dataset.action === "save-notes") {
    state.notes[state.selectedId] = $("#caseNotes").value.trim();
    storage.set("notes", state.notes);
    showToast("메모를 이 브라우저에 저장했습니다.");
  }
});

$("#addCaseForm").addEventListener("submit", event => {
  event.preventDefault();
  if (event.currentTarget.reportValidity()) addCase(event.currentTarget);
});

function openDialog(id) { $(id).showModal(); }
$("#addCaseButton").addEventListener("click", () => openDialog("#addCaseDialog"));
$("#desktopAddCase").addEventListener("click", () => openDialog("#addCaseDialog"));
$("#helpButton").addEventListener("click", () => openDialog("#helpDialog"));
$$('[data-close-dialog]').forEach(button => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
$$('dialog').forEach(dialog => dialog.addEventListener("click", event => {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));

$("#zoomIn").addEventListener("click", () => {
  state.zoom = Math.min(1.35, state.zoom + .1);
  document.documentElement.style.setProperty("--map-scale", state.zoom);
});
$("#zoomOut").addEventListener("click", () => {
  state.zoom = Math.max(.9, state.zoom - .1);
  document.documentElement.style.setProperty("--map-scale", state.zoom);
});
$("#resetMap").addEventListener("click", () => {
  state.zoom = 1;
  document.documentElement.style.setProperty("--map-scale", 1);
  showToast("지도 보기를 초기화했습니다.");
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && $("#detailSheet").classList.contains("open") && !$('dialog[open]')) closeDetail();
});

async function bootstrap() {
  await loadCollectedCases();
  syncFilters();
  renderCases();
}

void bootstrap();

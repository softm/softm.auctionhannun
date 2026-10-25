const FLOW_STATUSES = [
  ["interest", "관심"],
  ["researching", "조사중"],
  ["analyzing", "분석중"],
  ["hold", "보류"],
  ["planned", "입찰예정"],
  ["bidding", "입찰"],
  ["won", "낙찰"],
  ["lost", "패찰"],
  ["dropped", "포기"],
  ["aftercare", "사후관리"],
  ["done", "완료"]
];

export const CASE_STATUS_OPTIONS = FLOW_STATUSES.map(([value, label]) => ({ value, label }));
export const CASE_STATUS_LABELS = Object.fromEntries(FLOW_STATUSES);

export const ASSET_PROFILE_OPTIONS = [
  { value: "apartment", label: "주거·아파트" },
  { value: "land", label: "토지·농지·임야" },
  { value: "commercial", label: "상가·업무·공장" },
  { value: "movable", label: "차량·기계·동산" },
  { value: "other", label: "기타·복합물건" }
];

const profileLabels = Object.fromEntries(ASSET_PROFILE_OPTIONS.map(x => [x.value, x.label]));
const safeId = value => typeof value === "string" && /^[\\p{L}\\p{N}:._-]{1,180}$/u.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
const iso = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
const moneyText = value => {
  const v = text(value, 40);
  return !v || /^\d{1,15}$/.test(v.replace(/[, ]/g, "")) ? v : "";
};

const COMMON_TASKS = [
  ["source", "공식 원문·진행상태 최신 확인", "기본"],
  ["rights", "권리·인수조건 확인", "권리"],
  ["market", "현재 시세·비교물건 조사", "가격"],
  ["field", "현장·점유 상태 확인", "현장"],
  ["cost", "취득·명도·수리·금융비용 계산", "비용"],
  ["decision", "최대입찰가와 최종 판단 기록", "판단"]
];

const SOURCE_TASKS = {
  court: [
    ["court-sale-spec", "매각물건명세서 확인", "서류"],
    ["court-field-report", "현황조사서 확인", "서류"],
    ["court-appraisal", "감정평가서 확인", "서류"]
  ],
  onbid: [
    ["onbid-notice", "공매 공고문·정정사항 확인", "서류"],
    ["onbid-terms", "입찰·계약·명도 조건 확인", "서류"],
    ["onbid-property", "물건명세·감정자료 확인", "서류"]
  ]
};

const PROFILE_TASKS = {
  apartment: [
    ["apt-occupancy", "전입·점유·대항력 확인", "주거"],
    ["apt-trades", "동일단지 실거래·매물 비교", "주거"],
    ["apt-fees", "체납관리비·수선 상태 확인", "주거"]
  ],
  land: [
    ["land-use", "지목·용도지역·토지이용계획 확인", "토지"],
    ["land-road", "도로접면·맹지 여부 확인", "토지"],
    ["land-permit", "농취증·산지·개발행위 등 인허가 확인", "토지"]
  ],
  commercial: [
    ["biz-rent", "임대료·공실·상권 수준 확인", "수익"],
    ["biz-license", "용도·영업·공장등록 등 제한 확인", "규제"],
    ["biz-facility", "시설·설비·원상복구 비용 확인", "물리"]
  ],
  movable: [
    ["movable-condition", "연식·주행/사용시간·작동상태 확인", "동산"],
    ["movable-history", "사고·정비·등록·압류 등 이력 확인", "동산"],
    ["movable-disposal", "운송·보관·수리·재판매 가능성 확인", "동산"]
  ],
  other: [
    ["other-scope", "매각 대상 범위와 구성 자산 확정", "복합"],
    ["other-risk", "특수조건·규제·인수사항 추가 확인", "복합"],
    ["other-exit", "처분·임대·활용 시나리오 확인", "복합"]
  ]
};

export function profileForItem(item = {}) {
  if (item.dataBase === "./data/onbid-movable" || item.assetDetails) return "movable";
  return profileLabels[item.type] ? item.type : "other";
}

export function taskTemplate(item = {}, profile = profileForItem(item)) {
  const source = item.auctionKind === "onbid" ? "onbid" : "court";
  const rows = [...COMMON_TASKS, ...SOURCE_TASKS[source], ...(PROFILE_TASKS[profile] || PROFILE_TASKS.other)];
  const seen = new Set();
  return rows.filter(([id]) => !seen.has(id) && seen.add(id)).map(([id, label, group]) => ({ id, label, group }));
}

function event(at, type, label) {
  return { at, type, label: text(label, 300) };
}

export function createCaseFlow(item, now = new Date().toISOString()) {
  if (!item?.id || !safeId(item.id)) throw new Error("경매물건 식별자를 확인해 주세요.");
  const profile = profileForItem(item);
  return {
    status: "researching",
    profile,
    tasks: Object.fromEntries(taskTemplate(item, profile).map(task => [task.id, false])),
    customTasks: [],
    decision: { maxBid: "", targetBid: "", note: "" },
    events: [event(now, "created", "내 경매 Case 생성 · 조사 시작")],
    createdAt: now,
    updatedAt: now
  };
}

export function changeCaseStatus(flow, status, now = new Date().toISOString()) {
  if (!CASE_STATUS_LABELS[status]) throw new Error("경매 진행상태를 확인해 주세요.");
  const next = structuredClone(flow);
  if (next.status === status) return next;
  next.status = status;
  next.updatedAt = now;
  next.events = [...next.events, event(now, "status", `상태 변경 · ${CASE_STATUS_LABELS[status]}`)].slice(-60);
  return next;
}

export function changeCaseProfile(flow, profile, item, now = new Date().toISOString()) {
  if (!profileLabels[profile]) throw new Error("물건 분석 유형을 확인해 주세요.");
  const next = structuredClone(flow);
  if (next.profile === profile) return next;
  const previous = next.tasks || {};
  next.profile = profile;
  next.tasks = Object.fromEntries(taskTemplate(item, profile).map(task => [task.id, previous[task.id] === true]));
  next.updatedAt = now;
  next.events = [...next.events, event(now, "profile", `분석 유형 변경 · ${profileLabels[profile]}`)].slice(-60);
  return next;
}

export function setCaseTask(flow, taskId, done, now = new Date().toISOString()) {
  if (!safeId(taskId)) throw new Error("확인 항목을 찾을 수 없습니다.");
  const next = structuredClone(flow);
  if (Object.hasOwn(next.tasks, taskId)) next.tasks[taskId] = Boolean(done);
  else {
    const custom = next.customTasks.find(task => task.id === taskId);
    if (!custom) throw new Error("확인 항목을 찾을 수 없습니다.");
    custom.done = Boolean(done);
  }
  next.updatedAt = now;
  return next;
}

export function addCustomTask(flow, label, now = new Date().toISOString()) {
  const value = text(label, 80);
  if (!value) throw new Error("추가할 확인 항목을 입력해 주세요.");
  const next = structuredClone(flow);
  if (next.customTasks.length >= 12) throw new Error("사용자 확인 항목은 물건당 12개까지 추가할 수 있습니다.");
  const id = `custom-${now.replace(/[^0-9]/g, "").slice(0, 17)}-${next.customTasks.length + 1}`;
  next.customTasks.push({ id, label: value, done: false });
  next.updatedAt = now;
  next.events = [...next.events, event(now, "task", `확인 항목 추가 · ${value}`)].slice(-60);
  return next;
}

export function setCaseDecision(flow, values = {}, now = new Date().toISOString()) {
  const next = structuredClone(flow);
  next.decision = {
    maxBid: moneyText(values.maxBid),
    targetBid: moneyText(values.targetBid),
    note: text(values.note, 700)
  };
  next.updatedAt = now;
  next.events = [...next.events, event(now, "decision", "입찰 판단·금액 업데이트")].slice(-60);
  return next;
}

export function flowProgress(flow, item) {
  if (!flow) return { done: 0, total: 0, percent: 0 };
  const template = taskTemplate(item, flow.profile);
  const standardDone = template.filter(task => flow.tasks?.[task.id]).length;
  const customDone = (flow.customTasks || []).filter(task => task.done).length;
  const total = template.length + (flow.customTasks || []).length;
  const done = standardDone + customDone;
  return { done, total, percent: total ? Math.round(done / total * 100) : 0 };
}

export function validateCaseFlows(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("내 경매 Case 자료 형식이 올바르지 않습니다.");
  if (Object.keys(value).length > 500) throw new Error("내 경매 Case는 최대 500건까지 저장할 수 있습니다.");
  const out = {};
  for (const [caseId, raw] of Object.entries(value)) {
    if (!safeId(caseId) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("내 경매 Case 식별자가 올바르지 않습니다.");
    if (!CASE_STATUS_LABELS[raw.status] || !profileLabels[raw.profile] || !iso(raw.createdAt) || !iso(raw.updatedAt)) throw new Error("내 경매 Case 상태 또는 날짜 형식을 확인해 주세요.");
    const tasks = raw.tasks;
    if (!tasks || typeof tasks !== "object" || Array.isArray(tasks) || Object.keys(tasks).length > 40 || Object.entries(tasks).some(([id, done]) => !safeId(id) || typeof done !== "boolean")) throw new Error("내 경매 체크리스트 형식이 올바르지 않습니다.");
    const customTasks = Array.isArray(raw.customTasks) ? raw.customTasks : [];
    if (customTasks.length > 12 || customTasks.some(task => !task || !safeId(task.id) || typeof task.label !== "string" || !task.label.trim() || task.label.length > 80 || typeof task.done !== "boolean")) throw new Error("사용자 확인 항목 형식이 올바르지 않습니다.");
    const decision = raw.decision || {};
    if (typeof decision.maxBid !== "string" || typeof decision.targetBid !== "string" || typeof decision.note !== "string" || decision.maxBid.length > 40 || decision.targetBid.length > 40 || decision.note.length > 700) throw new Error("입찰 판단 자료 형식을 확인해 주세요.");
    const events = Array.isArray(raw.events) ? raw.events : [];
    if (events.length > 60 || events.some(row => !row || !iso(row.at) || typeof row.type !== "string" || row.type.length > 30 || typeof row.label !== "string" || row.label.length > 300)) throw new Error("내 경매 타임라인 형식을 확인해 주세요.");
    out[caseId] = {
      status: raw.status,
      profile: raw.profile,
      tasks: { ...tasks },
      customTasks: customTasks.map(task => ({ id: task.id, label: task.label.trim(), done: task.done })),
      decision: { maxBid: decision.maxBid, targetBid: decision.targetBid, note: decision.note },
      events: events.map(row => ({ at: row.at, type: row.type, label: row.label })),
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt
    };
  }
  return out;
}

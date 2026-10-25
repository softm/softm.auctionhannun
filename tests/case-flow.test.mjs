import test from "node:test";
import assert from "node:assert/strict";
import {
  createCaseFlow, changeCaseStatus, changeCaseProfile, setCaseTask,
  addCustomTask, setCaseDecision, taskTemplate, flowProgress, validateCaseFlows
} from "../case-flow.js";
import { filterAndSortCases } from "../auction-utils.js";
import { emptyWorkspace, validateWorkspace, mergeGuest } from "../workspace-store.js";
import { removeRegisteredCase } from "../case-editor.js";

const courtApartment = {
  id: "court-B000210-2026타경100888-1",
  auctionKind: "court",
  type: "apartment",
  caseNumber: "2026타경100888",
  address: "서울특별시 종로구 신영동 254"
};
const onbidMovable = {
  id: "onbid-2026-001",
  auctionKind: "onbid",
  type: "other",
  dataBase: "./data/onbid-movable",
  caseNumber: "2026-001",
  address: "경기도 수원시"
};
const T0 = "2026-10-25T06:00:00.000Z";
const T1 = "2026-10-25T07:00:00.000Z";

test("법원·온비드 물건은 출처와 유형에 맞는 adaptive checklist를 만든다", () => {
  const court = createCaseFlow(courtApartment, T0);
  assert.equal(court.profile, "apartment");
  const courtIds = taskTemplate(courtApartment, court.profile).map(x => x.id);
  assert.ok(courtIds.includes("court-sale-spec"));
  assert.ok(courtIds.includes("apt-occupancy"));
  assert.ok(!courtIds.includes("onbid-notice"));

  const onbid = createCaseFlow(onbidMovable, T0);
  assert.equal(onbid.profile, "movable");
  const onbidIds = taskTemplate(onbidMovable, onbid.profile).map(x => x.id);
  assert.ok(onbidIds.includes("onbid-notice"));
  assert.ok(onbidIds.includes("movable-condition"));
});

test("Case 상태·유형·판단 변경은 물건별 timeline으로 누적된다", () => {
  let flow = createCaseFlow(courtApartment, T0);
  flow = changeCaseStatus(flow, "planned", T1);
  flow = changeCaseProfile(flow, "land", courtApartment, "2026-10-25T08:00:00.000Z");
  flow = setCaseDecision(flow, { maxBid: "612000000", targetBid: "598000000", note: "시세와 비용 반영" }, "2026-10-25T09:00:00.000Z");
  assert.equal(flow.status, "planned");
  assert.equal(flow.profile, "land");
  assert.equal(flow.decision.maxBid, "612000000");
  assert.ok(flow.events.some(x => x.label.includes("입찰예정")));
  assert.ok(flow.events.some(x => x.label.includes("토지")));
  assert.ok(flow.events.at(-1).label.includes("입찰 판단"));
});

test("체크리스트 진행도와 사용자 추가 항목을 함께 계산한다", () => {
  let flow = createCaseFlow(courtApartment, T0);
  const first = taskTemplate(courtApartment, flow.profile)[0];
  flow = setCaseTask(flow, first.id, true, T1);
  flow = addCustomTask(flow, "체납관리비 관리사무소 확인", "2026-10-25T08:00:00.000Z");
  flow = setCaseTask(flow, flow.customTasks[0].id, true, "2026-10-25T09:00:00.000Z");
  const progress = flowProgress(flow, courtApartment);
  assert.equal(progress.done, 2);
  assert.equal(progress.total, taskTemplate(courtApartment, flow.profile).length + 1);
  assert.ok(progress.percent > 0);
});

test("한글 사건번호가 포함된 Case ID도 안전한 저장 키로 검증된다", () => {
  const flow = createCaseFlow(courtApartment, T0);
  const flows = validateCaseFlows({ [courtApartment.id]: flow });
  const workspace = validateWorkspace({ ...emptyWorkspace(), flows });
  assert.equal(workspace.flows[courtApartment.id].profile, "apartment");
});

test("관심 후보와 내 경매 Case 필터는 서로 분리된다", () => {
  const items = [courtApartment, { ...onbidMovable, id: "onbid-2" }];
  const managed = filterAndSortCases(items, { filter: "managed", managedIds: new Set([courtApartment.id]) });
  const favorite = filterAndSortCases(items, { filter: "favorite", favorites: new Set(["onbid-2"]) });
  assert.deepEqual(managed.map(x => x.id), [courtApartment.id]);
  assert.deepEqual(favorite.map(x => x.id), ["onbid-2"]);
});

test("계정/게스트 병합은 서버 Case 흐름을 우선하고 직접등록 삭제 시 연결 흐름도 제거한다", () => {
  const remoteFlow = changeCaseStatus(createCaseFlow(courtApartment, T0), "planned", T1);
  const localFlow = createCaseFlow(courtApartment, T0);
  const merged = mergeGuest({ ...emptyWorkspace(), flows: { [courtApartment.id]: remoteFlow } }, { ...emptyWorkspace(), flows: { [courtApartment.id]: localFlow } });
  assert.equal(merged.flows[courtApartment.id].status, "planned");

  const user = { id: "user-1", userAdded: true, court: "서울중앙지방법원", caseNumber: "2026타경1", address: "서울특별시 중구", title: "서울특별시 중구", type: "movable", saleDate: "" };
  const userFlow = createCaseFlow(user, T0);
  const removed = removeRegisteredCase({ ...emptyWorkspace(), cases: [user], flows: { [user.id]: userFlow } }, user.id);
  assert.equal(removed.flows[user.id], undefined);
});

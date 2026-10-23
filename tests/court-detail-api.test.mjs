import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDetail } from "../api/court-detail.js";

test("클릭 상세 API 응답을 경매한눈 상세 구조로 정규화한다",()=>{
  const result={
    csBaseInfo:{rcptYmd:"20260102",cmdYmd:"20260109",clmAmt:"94959713"},
    dstrtDemnInfo:[{dstrtDemnLstprdYmd:"20260311"}],
    dspslGdsDxdyInfo:{
      realSt:"서울특별시 종로구 신영동 254 대아파크빌 4층401호",
      gamevalAmt:"691000000",minmaePrice:"552800000",yuchalCnt:"1",dspslUsgNm:"아파트",areaList:"84.84㎡"
    },
    gdsDspslDxdyLst:[{dxdyYmd:"20261028",dxdyHm:"1000",dxdyPlcNm:"경매법정",tsLwsDspslPrc:"552800000",auctnDxdyRsltNm:"진행"}],
    gdsDspslObjctLst:[{dspslObjctSeq:"1",dspslGdsObjctDvsNm:"집합건물",realSt:"서울특별시 종로구 신영동 254",objctArDts:"84.84㎡"}],
    aeeWevlMnpntLst:[
      {aeeWevlMnpntNm:"위치 및 주위환경",aeeWevlMnpntCts:"신영동 소재"},
      {aeeWevlMnpntNm:"교통상황",aeeWevlMnpntCts:"대중교통 이용 가능"}
    ]
  };
  const payload=normalizeDetail(result,"court-B000210-2026타경100888-1");
  assert.equal(payload.ok,true);
  assert.equal(payload.detail.detailLevel,"full");
  assert.equal(payload.detail.appraisal,"691,000,000원");
  assert.equal(payload.detail.minimum,"552,800,000원");
  assert.equal(payload.detail.ratio,"80%");
  assert.equal(payload.detail.caseDetails.distributionDeadline,"2026-03-11");
  assert.equal(payload.detail.schedules[0].time,"10:00");
  assert.equal(payload.detail.propertyLots[0].area,"84.84㎡");
  assert.match(payload.detail.appraisalSummary.location,/신영동/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeCourtNoticeDetail, courtNoticeRows, courtNoticeDetailRows,
  noticeDetailBody, collectCourtPublic
} from "../scripts/collect-court-public.mjs";
import { validateData } from "../scripts/validate-data.mjs";

const notice = {
  cortOfcCd:"B000210", cortOfcNm:"서울중앙지방법원", cortSptNm:"",
  dspslDxdyYmd:"20261028", bidBgngYmd:null, bidEndYmd:null, jdbnCd:"1004",
  bidDvsCd:"000331", cortAuctnJdbnNm:"경매4계", dspslPlcNm:"제4별관 2층 211호 경매법정",
  fstDspslHm:"1000"
};
const detail = {
  csNo:"2026타경100888", dspslSeq:"1", usgNm:"아파트",
  st:"서울특별시 종로구 신영동 254 대아파크빌 4층401호 <br />[상세내역]<br /> 철근콘크리트조 84.84㎡",
  aeeEvlAmt:"691,000,000",
  lwsDspslPrc:'<img src="/images/number_01.gif" alt="첫번째"> 691,000,000<br>입찰시간(10:00)<br>',
  dspslRmk:"매수인 대항력 포기조건 매각"
};
const response = value => new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json","set-cookie":"JSESSIONID=test; Path=/; HttpOnly"}});

test("법원 매각공고 상세를 경매한눈 스키마로 변환한다",()=>{
  const item=normalizeCourtNoticeDetail(detail,notice);
  assert.equal(item.caseNumber,"2026타경100888");
  assert.equal(item.court,"서울중앙지방법원");
  assert.equal(item.saleDate,"2026-10-28");
  assert.equal(item.minimum,"691,000,000원");
  assert.equal(item.ratio,"100%");
  assert.equal(item.schedules[0].time,"10:00");
  assert.match(item.propertyLots[0].details,/84.84㎡/);
  assert.equal(item.appraisalSummary.other,"매수인 대항력 포기조건 매각");
});

test("법원 차단 신호는 즉시 오류로 처리한다",()=>{
  assert.throws(()=>courtNoticeRows({data:{ipcheck:false}}),/우회하지 않고/);
  assert.throws(()=>courtNoticeDetailRows({data:{ipcheck:false}}),/우회하지 않고/);
});

test("매각공고 상세 요청 바디는 목록 응답 키를 보존한다",()=>{
  const body=noticeDetailBody(notice).dma_srchGnrlPbanc;
  assert.equal(body.cortOfcCd,"B000210");
  assert.equal(body.dspslDxdyYmd,"20261028");
  assert.equal(body.jdbnCd,"1004");
  assert.equal(body.bidDvsCd,"000331");
});

test("저빈도 증분 법원 수집기는 공개 목록·상세를 저장한다",async()=>{
  const root=await mkdtemp(join(tmpdir(),"court-public-"));
  const calls=[];
  const fetcher=async(url,opts={})=>{
    const path=new URL(url).pathname; calls.push(path);
    if(path==="/pgj/index.on") return response({});
    if(path.includes("selectCortOfcCdLst")) return response({data:{result:[{cortOfcCd:"B000210",cortOfcNm:"서울중앙지방법원"}]}});
    if(path.includes("selectRletDspslPbancDtl")) return response({data:{result:{dspslPbanc:{pbancInfo:{lst:[detail]}}}}});
    if(path.includes("selectRletDspslPbanc")) return response({data:{ipcheck:true,dlt_rletDspslPbancLst:[notice]}});
    throw new Error("unexpected "+path);
  };
  const dataset=await collectCourtPublic({dataDir:root,now:new Date("2026-10-23T13:00:00Z"),fetcher,maxCalls:4,minDelayMs:0});
  assert.equal(dataset.items.length,1);
  assert.equal(dataset.items[0].caseNumber,"2026타경100888");
  assert.equal(dataset.metadata.datasetKind,"court-auction");
  assert.equal((await validateData(root)).count,1);
  const status=JSON.parse(await readFile(join(root,"collection-status.json"),"utf8"));
  assert.equal(status.state,"ready");
  assert.ok(status.courtPublic.callsUsed<=4);
});

test("차단되면 마지막 정상 법원 데이터를 덮어쓰지 않는다",async()=>{
  const root=await mkdtemp(join(tmpdir(),"court-public-blocked-"));
  const okFetch=async(url)=>{
    const path=new URL(url).pathname;
    if(path==="/pgj/index.on") return response({});
    if(path.includes("selectCortOfcCdLst")) return response({data:{result:[{cortOfcCd:"B000210",cortOfcNm:"서울중앙지방법원"}]}});
    if(path.includes("selectRletDspslPbancDtl")) return response({data:{result:{dspslPbanc:{pbancInfo:{lst:[detail]}}}}});
    return response({data:{ipcheck:true,dlt_rletDspslPbancLst:[notice]}});
  };
  await collectCourtPublic({dataDir:root,now:new Date("2026-10-23T13:00:00Z"),fetcher:okFetch,maxCalls:4,minDelayMs:0});
  const before=await readFile(join(root,"auctions.json"),"utf8");
  const blockedFetch=async(url)=>{
    const path=new URL(url).pathname;
    if(path==="/pgj/index.on") return response({});
    return response({data:{ipcheck:false}});
  };
  await assert.rejects(collectCourtPublic({dataDir:root,now:new Date("2026-10-23T14:00:00Z"),fetcher:blockedFetch,maxCalls:4,minDelayMs:0}),/우회하지 않고/);
  assert.equal(await readFile(join(root,"auctions.json"),"utf8"),before);
});

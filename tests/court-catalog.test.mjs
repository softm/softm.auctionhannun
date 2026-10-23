import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCourtSearchBody, normalizeCourtSearchRow, collectCourtCatalog } from "../scripts/collect-court-catalog.mjs";
import { validateData } from "../scripts/validate-data.mjs";

const row = {
  boCd:"B000210", srnSaNo:"2026타경100888", maemulSer:"1", mokmulSer:"1",
  jiwonNm:"서울중앙지방법원", dspslUsgNm:"아파트",
  realSt:"서울특별시 종로구 신영동 254 대아파크빌 4층401호",
  gamevalAmt:"691000000", minmaePrice:"552800000", yuchalCnt:"1", maeGiil:"20261028",
  areaList:"84.84㎡", docid:"B0002102026100888", mulStatcd:"진행"
};
const json = value => new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json","set-cookie":"JSESSIONID=test; Path=/"}});

test("전국 법원 검색 바디는 페이지와 시도 필터를 보존한다",()=>{
  const body=buildCourtSearchBody("11",3,50);
  assert.equal(body.dma_pageInfo.pageNo,"3");
  assert.equal(body.dma_pageInfo.startRowNo,"101");
  assert.equal(body.dma_srchGdsDtlSrchInfo.rprsAdongSdCd,"11");
  assert.equal(body.dma_srchGdsDtlSrchInfo.mvprpRletDvsCd,"00031R");
});

test("법원 검색 행을 지연 상세 목록으로 정규화한다",()=>{
  const item=normalizeCourtSearchRow(row);
  assert.equal(item.id,"court-B000210-2026타경100888-1");
  assert.equal(item.detailLevel,"list");
  assert.equal(item.courtCode,"B000210");
  assert.equal(item.itemSeq,"1");
  assert.equal(item.minimum,"552,800,000원");
  assert.equal(item.ratio,"80%");
});

test("전국 목록 수집은 목적물 행 중복을 매물 단위로 제거하고 lazy detail로 게시한다",async()=>{
  const root=await mkdtemp(join(tmpdir(),"court-catalog-"));
  const fetcher=async(url,opts={})=>{
    const path=new URL(url).pathname;
    if(path==="/pgj/index.on") return json({});
    if(path.includes("selectAdongSdLst")) return json({data:{adongSdLst:[{code:"11",name:"서울특별시"},{code:"28",name:"인천광역시"}]}});
    if(path.includes("searchControllerMain")){
      const body=JSON.parse(opts.body);
      const sd=body.dma_srchGdsDtlSrchInfo.rprsAdongSdCd;
      const duplicate={...row,mokmulSer:"2",buldList:"철근콘크리트"};
      const second={...row,boCd:"B000240",srnSaNo:"2026타경200001",maemulSer:"2",mokmulSer:"1",jiwonNm:"인천지방법원",realSt:"인천광역시 미추홀구 예시로 1",docid:"B0002402026200001"};
      return json({data:{ipcheck:true,dma_pageInfo:{pageNo:"1",pageSize:"50",totalCnt:sd==="11"?"2":"1"},dlt_srchResult:sd==="11"?[row,duplicate]:[second]}});
    }
    throw new Error("unexpected "+path);
  };
  const dataset=await collectCourtCatalog({dataDir:root,now:new Date("2026-10-24T00:00:00Z"),fetcher,minDelayMs:0,jitterMs:0,checkpointEvery:0,maxRegions:2});
  assert.equal(dataset.metadata.lazyDetails,true);
  assert.equal(dataset.metadata.rawRowCount,3);
  assert.equal(dataset.metadata.uniquePropertyCount,2);
  assert.equal(dataset.items.length,2);
  const checked=await validateData(root);
  assert.equal(checked.count,2);
  const catalog=checked.catalog.items;
  assert.ok(catalog.every(x=>!x.detailFile));
  const status=JSON.parse(await readFile(join(root,"collection-status.json"),"utf8"));
  assert.equal(status.courtCatalog.coveragePercent,100);
});

test("전국 목록 응답이 예상건수의 98% 미만이면 기존 자료를 유지하고 실패한다",async()=>{
  const root=await mkdtemp(join(tmpdir(),"court-catalog-short-"));
  const fetcher=async(url,opts={})=>{
    const path=new URL(url).pathname;
    if(path==="/pgj/index.on") return json({});
    if(path.includes("selectAdongSdLst")) return json({data:{adongSdLst:[{code:"11",name:"서울특별시"},{code:"28",name:"인천광역시"}]}});
    if(path.includes("searchControllerMain")){
      const body=JSON.parse(opts.body), sd=body.dma_srchGdsDtlSrchInfo.rprsAdongSdCd;
      return json({data:{ipcheck:true,dma_pageInfo:{pageNo:"1",pageSize:"50",totalCnt:sd==="11"?"100":"0"},dlt_srchResult:sd==="11"?[row]:[]}});
    }
    throw new Error("unexpected "+path);
  };
  await assert.rejects(collectCourtCatalog({dataDir:root,now:new Date("2026-10-24T00:00:00Z"),fetcher,minDelayMs:0,jitterMs:0,checkpointEvery:0,maxRegions:2}),/누락 의심/);
});

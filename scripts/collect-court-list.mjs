import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeDataset } from "./collect-auctions.mjs";
import { publishDataset } from "./publish-data.mjs";

const BASE = "https://www.courtauction.go.kr";
const SEARCH_PATH = "/pgj/pgjsearch/searchControllerMain.on";
const SIDO_PATH = "/pgj/pgj002/selectAdongSdLst.on";
const WARMUP = "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00";
const PAGE_SIZE = 50;
const clean = (v, max=1000) => String(v ?? "").replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim().slice(0,max);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replaceAll(",","").replace(/[^0-9.-]/g,""));
  return Number.isFinite(n) ? n : null;
}
function money(v) {
  const n=num(v); return n == null ? "공식 확인" : `${Math.round(n).toLocaleString("ko-KR")}원`;
}
function date(v) {
  const s=clean(v,10).replace(/[^0-9]/g,"");
  return /^\d{8}$/.test(s) ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : "";
}
function joinUnique(...values) {
  return [...new Set(values.flatMap(v=>clean(v,500).split(/\s*·\s*/)).filter(Boolean))].join(" · ").slice(0,1000);
}
function usageName(row) {
  return clean(row.dspslUsgNm || row.usgNm || row.sclsUtilNm || row.mclsUtilNm || row.lclsUtilNm,120) || "경매물건";
}
function typeOf(row) {
  const usage=usageName(row);
  const l=clean(row.lclsUtilCd,20);
  if (l==="10000" || /토지|대지|임야|전|답|과수원|도로|잡종지/.test(usage)) return "land";
  if (/아파트|주택|다세대|다가구|연립|오피스텔|주거/.test(usage)) return "apartment";
  if (/상가|근린|업무|판매|공장|숙박|점포|상업/.test(usage)) return "commercial";
  return "other";
}
function addressOf(row) {
  return clean(row.bgPlaceRdAllAddr || row.rdAllAddr || row.bgPlaceLotAllAddr || row.lotAllAddr || row.convAddr || row.daepyoAddr || row.realSt || row.printSt,300);
}
function locationOf(row) {
  const x=num(row.wgs84Xcordi), y=num(row.wgs84Ycordi);
  if (x>=124 && x<=132.5 && y>=33 && y<=39.5) return {longitude:x,latitude:y};
  if (y>=124 && y<=132.5 && x>=33 && x<=39.5) return {longitude:y,latitude:x};
  return null;
}
function propertyKey(row) {
  const court=clean(row.boCd || row.cortOfcCd,20);
  const caseNo=clean(row.srnSaNo || row.printCsNo || row.csNo,80);
  const seq=clean(row.maemulSer || row.dspslGdsSeq || row.mokmulSer,20) || "1";
  return court && caseNo ? `${court}|${caseNo}|${seq}` : "";
}
export function normalizeCourtSearchRow(row, collectedAt = new Date().toISOString()) {
  const courtCode=clean(row.boCd || row.cortOfcCd,20);
  const caseNumber=clean(row.srnSaNo || row.printCsNo || row.csNo,80);
  const itemSeq=clean(row.maemulSer || row.dspslGdsSeq || row.mokmulSer,20) || "1";
  const address=addressOf(row);
  if (!courtCode || !caseNumber || !address) return null;
  const appraisalN=num(row.gamevalAmt || row.aeeEvlAmt);
  const minimumN=num(row.minmaePrice || row.lwsDspslPrc);
  const ratio=appraisalN>0 && minimumN!=null ? `${Math.round(minimumN/appraisalN*1000)/10}%` : "-";
  const usage=usageName(row);
  const fail=num(row.yuchalCnt ?? row.flbdNcnt);
  const loc=locationOf(row);
  return {
    id:`court-${courtCode}-${caseNumber}-${itemSeq}`,
    auctionKind:"court",
    demo:false,
    type:typeOf(row),
    title:`${usage} · ${address}`,
    address,
    court:clean(row.jiwonNm || row.cortOfcNm || row.cortSptNm,120) || "대한민국 법원",
    caseNumber,
    itemNumber:`물건 ${itemSeq}`,
    courtCode,
    itemSeq,
    documentId:clean(row.docid,120),
    detailLevel:"list",
    saleDate:date(row.maeGiil || row.dspslDxdyYmd),
    appraisal:money(appraisalN),
    minimum:money(minimumN),
    ratio,
    rounds:fail==null ? "원문 확인" : `유찰 ${fail}회`,
    area:joinUnique(row.areaList,row.buldList,row.jimokList) || "원문 확인",
    occupancy:"현황조사서 확인",
    category:usage,
    status:clean(row.mulStatNm || row.maemulStatNm || row.statusNm || row.mulStatcd,80) || "진행",
    ...(loc ? {location:{latitude:loc.latitude,longitude:loc.longitude,source:"court-search"}} : {}),
    sourceUpdatedAt:collectedAt,
    sourceUrl:BASE+"/"
  };
}
function mergeProperty(target, incoming) {
  if (!target) return incoming;
  const prefer = (a,b) => a && !/원문 확인|공식 확인/.test(a) ? a : b || a;
  return {
    ...target,
    title:prefer(target.title,incoming.title),
    address:prefer(target.address,incoming.address),
    court:prefer(target.court,incoming.court),
    saleDate:prefer(target.saleDate,incoming.saleDate),
    appraisal:prefer(target.appraisal,incoming.appraisal),
    minimum:prefer(target.minimum,incoming.minimum),
    ratio:prefer(target.ratio,incoming.ratio),
    rounds:prefer(target.rounds,incoming.rounds),
    area:joinUnique(target.area,incoming.area) || target.area,
    category:prefer(target.category,incoming.category),
    status:prefer(target.status,incoming.status),
    ...(!target.location && incoming.location ? {location:incoming.location} : {})
  };
}

class Client {
  constructor({minInterval=Number(process.env.COURT_LIST_MIN_INTERVAL_MS||1600),jitter=Number(process.env.COURT_LIST_JITTER_MS||900),checkpointEvery=80,checkpointPause=20000}={}) {
    this.minInterval=minInterval; this.jitter=jitter; this.checkpointEvery=checkpointEvery; this.checkpointPause=checkpointPause;
    this.jar=new Map(); this.calls=0; this.last=0; this.warmed=false;
  }
  ingest(headers) {
    const vals=typeof headers.getSetCookie==="function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for(const line of vals){const p=String(line).split(";")[0],i=p.indexOf("=");if(i>0)this.jar.set(p.slice(0,i).trim(),p.slice(i+1).trim());}
  }
  headers(extra={}) {
    return {
      "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
      "Accept":"application/json, text/javascript, */*; q=0.01","Accept-Language":"ko-KR,ko;q=0.9,en;q=0.8",
      "Origin":BASE,"Referer":BASE+WARMUP,"X-Requested-With":"XMLHttpRequest",
      ...(this.jar.size?{Cookie:[...this.jar].map(([k,v])=>`${k}=${v}`).join("; ")}:{}),...extra
    };
  }
  async throttle() {
    if (this.calls && this.checkpointEvery>0 && this.calls%this.checkpointEvery===0) await sleep(this.checkpointPause);
    const target=this.minInterval+Math.floor(Math.random()*Math.max(0,this.jitter));
    const wait=target-(Date.now()-this.last); if(wait>0) await sleep(wait);
  }
  async warmup() {
    if(this.warmed)return;
    const r=await fetch(BASE+WARMUP,{headers:this.headers({"Accept":"text/html,application/xhtml+xml,*/*"}),redirect:"manual",signal:AbortSignal.timeout(20000)});
    this.ingest(r.headers); this.warmed=true;
  }
  async post(path, body, extraHeaders={}) {
    await this.warmup(); await this.throttle();
    let r;
    try {
      r=await fetch(BASE+path,{method:"POST",headers:this.headers({"Content-Type":"application/json; charset=UTF-8",...extraHeaders}),body:JSON.stringify(body),redirect:"manual",signal:AbortSignal.timeout(30000)});
    } catch(error) {
      throw new Error(`법원 목록 네트워크 오류: ${error.message}`);
    }
    this.calls++; this.last=Date.now(); this.ingest(r.headers);
    if([401,403,429].includes(r.status)){const e=new Error(`법원 목록 접근 제한 HTTP ${r.status}`);e.code="COURT_BLOCKED";throw e;}
    if(!r.ok) throw new Error(`법원 목록 HTTP ${r.status}`);
    const payload=await r.json();
    if(payload?.data?.ipcheck===false){const e=new Error("법원경매정보 ipcheck=false: 우회하지 않고 전수수집을 중단합니다.");e.code="COURT_BLOCKED";throw e;}
    if(payload?.errors?.errorMessage) throw new Error(clean(payload.errors.errorMessage,300));
    return payload;
  }
}

function searchInfo(sdCode="") {
  const keys=["rletDspslSpcCondCd","bidDvsCd","mvprpRletDvsCd","cortAuctnSrchCondCd","rprsAdongSdCd","rprsAdongSggCd","rprsAdongEmdCd","rdnmSdCd","rdnmSggCd","rdnmNo","mvprpDspslPlcAdongSdCd","mvprpDspslPlcAdongSggCd","mvprpDspslPlcAdongEmdCd","rdDspslPlcAdongSdCd","rdDspslPlcAdongSggCd","rdDspslPlcAdongEmdCd","cortOfcCd","jdbnCd","execrOfcDvsCd","lclDspslGdsLstUsgCd","mclDspslGdsLstUsgCd","sclDspslGdsLstUsgCd","cortAuctnMbrsId","aeeEvlAmtMin","aeeEvlAmtMax","rletLwsDspslPrcMin","rletLwsDspslPrcMax","mvprpLwsDspslPrcMin","mvprpLwsDspslPrcMax","lwsDspslPrcRateMin","lwsDspslPrcRateMax","flbdNcntMin","flbdNcntMax","objctArDtsMin","objctArDtsMax","mvprpArtclKndCd","mvprpArtclNm","mvprpAtchmPlcTypCd","notifyLoc","lafjOrderBy","pgmId","csNo","cortStDvs","statNum","bidBgngYmd","bidEndYmd"];
  const info=Object.fromEntries(keys.map(k=>[k,""]));
  Object.assign(info,{mvprpRletDvsCd:"00031R",cortAuctnSrchCondCd:"0004601",rprsAdongSdCd:sdCode,notifyLoc:"Y",pgmId:"PGJ151M01",cortStDvs:sdCode?"2":"1",statNum:"1"});
  return info;
}
export function buildCourtSearchBody(sdCode,pageNo) {
  return {dma_pageInfo:{pageNo:String(pageNo),pageSize:String(PAGE_SIZE),bfPageNo:"",startRowNo:String((pageNo-1)*PAGE_SIZE+1),totalCnt:"0",totalYn:pageNo===1?"Y":"N",groupTotalCount:""},dma_srchGdsDtlSrchInfo:searchInfo(sdCode)};
}

export async function collectCourtList({dataDir="data",now=new Date(),client=new Client(),minRegions=19,minUniqueItems=5000}={}) {
  await mkdir(dataDir,{recursive:true});
  let previous=null, previousStatus={};
  try{previous=JSON.parse(await readFile(resolve(dataDir,"auctions.json"),"utf8"));}catch{}
  try{previousStatus=JSON.parse(await readFile(resolve(dataDir,"collection-status.json"),"utf8"));}catch{}
  const statusPath=resolve(dataDir,"collection-status.json");
  const saveStatus=async value=>{const tmp=`${statusPath}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2)+"\n");await rename(tmp,statusPath);};
  const collectedAt=now.toISOString();
  try {
    const sidoPayload=await client.post(SIDO_PATH,{pbancMidYn:"Y",srchDvsCd:"O",pbancDvsCd:"FB"});
    const rawSido=Array.isArray(sidoPayload?.data?.adongSdLst)?sidoPayload.data.adongSdLst:[];
    const sidos=rawSido.map(r=>({code:clean(r.code||r.adongSdCd,10),name:clean(r.name||r.adongSdNm,80)})).filter(r=>r.code&&r.name);
    if(sidos.length<minRegions) throw new Error(`시·도 코드가 ${sidos.length}개뿐이라 전수수집을 중단합니다. 최소 ${minRegions}개 필요`);

    const properties=new Map();
    const regionStats=[];
    let rawRowCount=0;
    for(const sd of sidos){
      let page=1,total=null,seen=0;
      while(true){
        const payload=await client.post(SEARCH_PATH,buildCourtSearchBody(sd.code,page),{submissionid:"mf_wfm_mainFrame_sbm_selectGdsDtlSrch","sc-userid":"SYSTEM"});
        const data=payload?.data||{};
        const rows=Array.isArray(data.dlt_srchResult)?data.dlt_srchResult:[];
        const info=data.dma_pageInfo||{};
        if(total===null){
          total=Number(info.totalCnt||0);
          if(!Number.isSafeInteger(total)||total<0) throw new Error(`${sd.name} totalCnt 오류`);
        }
        seen+=rows.length; rawRowCount+=rows.length;
        for(const row of rows){
          const key=propertyKey(row); if(!key) continue;
          const item=normalizeCourtSearchRow(row,collectedAt); if(!item) continue;
          properties.set(key,mergeProperty(properties.get(key),item));
        }
        console.log(`법원 전국목록 ${sd.name} ${page}/${Math.max(1,Math.ceil(total/PAGE_SIZE))} · ${seen}/${total}행 · 고유 ${properties.size}건`);
        if(seen>=total) break;
        if(!rows.length) throw new Error(`${sd.name} ${page}페이지가 비어 전수수집 완전성을 확인할 수 없습니다.`);
        page++;
        if(page>2000) throw new Error(`${sd.name} 페이지 상한 초과`);
      }
      if(seen!==total) throw new Error(`${sd.name} 행수 불일치: ${seen}/${total}`);
      regionStats.push({code:sd.code,name:sd.name,totalRows:total,pages:Math.ceil(total/PAGE_SIZE)});
    }

    if(regionStats.length!==sidos.length) throw new Error("전국 17개 시·도 완주 실패");
    const items=[...properties.values()];
    if(items.length<minUniqueItems) throw new Error(`고유 진행물건 ${items.length}건은 전국 전수수집 결과로 보기 어렵습니다. 최소 ${minUniqueItems}건 필요`);
    const coveragePercent=100;
    const metadata={
      schemaVersion:3,demo:false,reviewed:true,datasetKind:"court-auction",sourceType:"court-auction-public-search",
      sourceUrl:BASE+"/",coverage:`법원경매정보 전국 부동산 공고중 물건 · ${sidos.length}개 시·도 전 페이지 완주 · 원본 ${rawRowCount.toLocaleString()}행 / 고유 매물 ${items.length.toLocaleString()}건`,
      snapshotId:`court-list-${collectedAt}`,lazyDetails:true,rawRowCount,uniquePropertyCount:items.length,regionCount:sidos.length,coveragePercent
    };
    const dataset=normalizeDataset({metadata,items},previous,now);
    await publishDataset(dataset,dataDir);
    await saveStatus({
      state:"ready",attemptedAt:collectedAt,lastSuccessAt:dataset.metadata.collectedAt,itemCount:items.length,
      rawRowCount,uniquePropertyCount:items.length,regionCount:sidos.length,coveragePercent,callsUsed:client.calls,
      coverage:metadata.coverage,detailStrategy:"on-demand",regionStats
    });
    console.log(`법원 전국 기본목록 전수수집 완료 · ${sidos.length}개 시·도 · ${rawRowCount}행 · 고유 ${items.length}건 · 호출 ${client.calls}회`);
    return dataset;
  } catch(error) {
    await saveStatus({...previousStatus,state:previous?.items?.length?"failed":"error",attemptedAt:collectedAt,lastSuccessAt:previousStatus.lastSuccessAt||previous?.metadata?.collectedAt||null,itemCount:previous?.items?.length||0,message:`전국 목록 전수수집 실패. 마지막 정상자료 유지: ${clean(error.message,300)}`,lastErrorAt:collectedAt});
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)collectCourtList().catch(e=>{console.error(e.message);process.exitCode=1;});

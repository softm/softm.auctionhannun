import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeDataset } from "./collect-auctions.mjs";
import { publishDataset } from "./publish-data.mjs";

const BASE = "https://www.courtauction.go.kr";
const WARMUP = "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml&pgjId=151F00";
const SEARCH = "/pgj/pgjsearch/searchControllerMain.on";
const SIDO = "/pgj/pgj002/selectAdongSdLst.on";
const PAGE_SIZE = 50;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const clean = (v, max=2000) => String(v ?? "").replace(/<br\s*\/?\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim().slice(0,max);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function number(v) {
  const n = Number(String(v ?? "").replace(/[, ]/g,""));
  return Number.isFinite(n) ? n : null;
}
function ymd(v) {
  const s = clean(v,10).replace(/[^0-9]/g,"");
  return /^\d{8}$/.test(s) ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}` : "";
}
function money(v) {
  const n = number(v);
  return n != null && n >= 0 ? `${n.toLocaleString("ko-KR")}원` : "공식 확인";
}
function typeFrom(row) {
  const text = [row.dspslUsgNm,row.usgNm,row.buldList,row.jimokList].map(v=>clean(v,300)).join(" ");
  if (/아파트|주택|다세대|다가구|오피스텔|연립|주거/.test(text)) return "apartment";
  if (/토지|대지|임야|전|답|과수원|도로|묘지|잡종지/.test(text)) return "land";
  if (/상가|근린|판매|업무|공장|숙박|점포|상업/.test(text)) return "commercial";
  return "other";
}
function addressFrom(row) {
  const full = clean(row.realSt || row.printSt || row.bgPlaceRdAllAddr || row.bgPlaceLotAllAddr || row.convAddr, 300);
  if (full) return full;
  return [row.hjguSido,row.hjguSigu,row.hjguDong,row.hjguRd,row.daepyoLotno,row.buldNm].map(v=>clean(v,80)).filter(Boolean).join(" ");
}
function locationFrom(row) {
  const lng = number(row.wgs84Xcordi), lat = number(row.wgs84Ycordi);
  return lng >= 124 && lng <= 132.5 && lat >= 33 && lat <= 39.5
    ? { longitude: lng, latitude: lat, source: "court-search-wgs84" }
    : null;
}
function propertyKey(row) {
  const court = clean(row.boCd || row.cortOfcCd,20);
  const caseNo = clean(row.srnSaNo || row.printCsNo || row.saNo,80);
  const seq = clean(row.maemulSer || row.mokmulSer,20) || "1";
  return `${court}|${caseNo}|${seq}`;
}
function mergeRow(a,b) {
  if (!a) return b;
  const score = r => ["dspslUsgNm","realSt","printSt","buldList","areaList","jimokList","gamevalAmt","minmaePrice","maeGiil","docid"].reduce((n,k)=>n+(clean(r?.[k])?1:0),0);
  return score(b) > score(a) ? { ...a, ...b } : { ...b, ...a };
}
export function normalizeCourtSearchRow(row) {
  const courtCode = clean(row.boCd || row.cortOfcCd,20);
  const caseNumber = clean(row.srnSaNo || row.printCsNo || row.saNo,80);
  const itemSeq = clean(row.maemulSer || row.mokmulSer,20) || "1";
  const address = addressFrom(row);
  if (!/^B\d{6}$/.test(courtCode) || !caseNumber || !address) throw new Error("법원 목록 식별정보 누락");
  const appraisal = number(row.gamevalAmt);
  const minimum = number(row.minmaePrice);
  const ratio = appraisal > 0 && minimum != null ? `${Math.round(minimum / appraisal * 1000) / 10}%` : "-";
  const usage = clean(row.dspslUsgNm || row.usgNm || row.mclsUtilNm || row.sclsUtilNm,100) || "경매물건";
  const fail = number(row.yuchalCnt);
  const area = clean(row.areaList || row.objctArDts,120);
  return {
    id: `court-${courtCode}-${caseNumber}-${itemSeq}`,
    auctionKind:"court",
    demo:false,
    detailLevel:"list",
    courtCode,
    itemSeq,
    documentId:clean(row.docid,120),
    type:typeFrom(row),
    title:`${usage} · ${address}`,
    address,
    court:clean(row.jiwonNm || row.cortOfcNm,120) || "대한민국 법원",
    caseNumber,
    itemNumber:`물건 ${itemSeq}`,
    saleDate:ymd(row.maeGiil),
    appraisal:money(appraisal),
    minimum:money(minimum),
    ratio,
    rounds:fail != null ? `유찰 ${fail}회` : "원문 확인",
    area:area || "원문 확인",
    occupancy:"현황조사서 확인",
    category:usage,
    location:locationFrom(row),
    status:clean(row.mulStatNm || row.maemulStatNm || row.mulStatcd || row.jinstatCd,60) || "진행",
    sourceUpdatedAt:new Date().toISOString(),
    sourceUrl:"https://www.courtauction.go.kr/"
  };
}

function searchInfo(sdCode="") {
  const keys = [
    "rletDspslSpcCondCd","bidDvsCd","mvprpRletDvsCd","cortAuctnSrchCondCd",
    "rprsAdongSdCd","rprsAdongSggCd","rprsAdongEmdCd","rdnmSdCd","rdnmSggCd","rdnmNo",
    "mvprpDspslPlcAdongSdCd","mvprpDspslPlcAdongSggCd","mvprpDspslPlcAdongEmdCd",
    "rdDspslPlcAdongSdCd","rdDspslPlcAdongSggCd","rdDspslPlcAdongEmdCd",
    "cortOfcCd","jdbnCd","execrOfcDvsCd","lclDspslGdsLstUsgCd","mclDspslGdsLstUsgCd","sclDspslGdsLstUsgCd",
    "cortAuctnMbrsId","aeeEvlAmtMin","aeeEvlAmtMax","rletLwsDspslPrcMin","rletLwsDspslPrcMax",
    "mvprpLwsDspslPrcMin","mvprpLwsDspslPrcMax","lwsDspslPrcRateMin","lwsDspslPrcRateMax",
    "flbdNcntMin","flbdNcntMax","objctArDtsMin","objctArDtsMax","mvprpArtclKndCd","mvprpArtclNm",
    "mvprpAtchmPlcTypCd","notifyLoc","lafjOrderBy","pgmId","csNo","cortStDvs","statNum","bidBgngYmd","bidEndYmd"
  ];
  const info = Object.fromEntries(keys.map(k=>[k,""]));
  Object.assign(info,{mvprpRletDvsCd:"00031R",cortAuctnSrchCondCd:"0004601",rprsAdongSdCd:sdCode,notifyLoc:"Y",pgmId:"PGJ151M01",cortStDvs:sdCode?"2":"1",statNum:1});
  return info;
}
export function buildCourtSearchBody(sdCode,pageNo=1,pageSize=PAGE_SIZE) {
  return {
    dma_pageInfo:{pageNo:String(pageNo),pageSize:String(pageSize),bfPageNo:"",startRowNo:String((pageNo-1)*pageSize+1),totalCnt:"0",totalYn:pageNo===1?"Y":"N",groupTotalCount:""},
    dma_srchGdsDtlSrchInfo:searchInfo(sdCode)
  };
}

class Client {
  constructor({fetcher=fetch,minDelayMs=1800,jitterMs=700,checkpointEvery=50,checkpointPauseMs=15000}={}) {
    Object.assign(this,{fetcher,minDelayMs,jitterMs,checkpointEvery,checkpointPauseMs,last:0,calls:0,cookies:new Map(),warmed:false});
  }
  ingest(headers) {
    const lines=typeof headers?.getSetCookie==="function"?headers.getSetCookie():[headers?.get?.("set-cookie")].filter(Boolean);
    for(const line of lines||[]){const p=String(line).split(";")[0],i=p.indexOf("=");if(i>0)this.cookies.set(p.slice(0,i).trim(),p.slice(i+1).trim())}
  }
  headers(extra={}) {
    return {"User-Agent":USER_AGENT,"Accept":"application/json, text/javascript, */*; q=0.01","Accept-Language":"ko-KR,ko;q=0.9,en;q=0.8","Origin":BASE,"Referer":BASE+WARMUP,"X-Requested-With":"XMLHttpRequest",...(this.cookies.size?{Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join("; ")}:{}),...extra};
  }
  async throttle() {
    if(this.checkpointEvery>0 && this.calls>0 && this.calls%this.checkpointEvery===0) await sleep(this.checkpointPauseMs);
    const target=this.minDelayMs+Math.floor(Math.random()*Math.max(1,this.jitterMs));
    const wait=target-(Date.now()-this.last); if(this.last&&wait>0) await sleep(wait);
  }
  async warmup() {
    if(this.warmed)return;
    const r=await this.fetcher(BASE+WARMUP,{headers:this.headers(),redirect:"manual",signal:AbortSignal.timeout(20000)});
    this.ingest(r.headers); this.last=Date.now(); this.warmed=true;
    if(!r.ok&&!([301,302,303,307,308].includes(r.status)))throw new Error(`법원 초기접속 HTTP ${r.status}`);
  }
  async post(path,body) {
    await this.warmup(); await this.throttle();
    let r;
    try{r=await this.fetcher(BASE+path,{method:"POST",headers:this.headers({"Content-Type":"application/json; charset=UTF-8",submissionid:"mf_wfm_mainFrame_sbm_selectGdsDtlSrch","sc-userid":"SYSTEM"}),body:JSON.stringify(body),redirect:"manual",signal:AbortSignal.timeout(30000)})}
    catch(e){throw new Error(`법원 목록 네트워크 오류: ${e?.message||e}`)}
    this.calls++; this.last=Date.now(); this.ingest(r.headers);
    if([401,403,429].includes(r.status)){const e=new Error(`법원 접근 제한 HTTP ${r.status}`);e.code="COURT_BLOCKED";throw e}
    if(!r.ok)throw new Error(`법원 목록 HTTP ${r.status}`);
    const p=await r.json();
    if(p?.data?.ipcheck===false){const e=new Error("법원 ipcheck=false. 우회하지 않고 중단합니다.");e.code="COURT_BLOCKED";throw e}
    if(p?.errors?.errorMessage)throw new Error(clean(p.errors.errorMessage,300));
    return p;
  }
}

async function saveStatus(path,value){const t=`${path}.${process.pid}.tmp`;await writeFile(t,JSON.stringify(value,null,2)+"\n");await rename(t,path)}

export async function collectCourtCatalog({
  dataDir="data", now=new Date(), fetcher=fetch,
  minDelayMs=Number(process.env.COURT_CATALOG_MIN_DELAY_MS||1800),
  jitterMs=Number(process.env.COURT_CATALOG_JITTER_MS||700),
  checkpointEvery=Number(process.env.COURT_CATALOG_CHECKPOINT_EVERY||50),
  checkpointPauseMs=Number(process.env.COURT_CATALOG_CHECKPOINT_PAUSE_MS||15000),
  maxRegions=Number(process.env.COURT_CATALOG_MAX_REGIONS||0)
}={}) {
  await mkdir(dataDir,{recursive:true});
  const statusPath=resolve(dataDir,"collection-status.json");
  let previous=null, previousStatus={};
  try{previous=JSON.parse(await readFile(resolve(dataDir,"auctions.json"),"utf8"))}catch{}
  try{previousStatus=JSON.parse(await readFile(statusPath,"utf8"))}catch{}
  const client=new Client({fetcher,minDelayMs,jitterMs,checkpointEvery,checkpointPauseMs});
  const started=Date.now();
  try{
    const sidoPayload=await client.post(SIDO,{pbancMidYn:"Y",srchDvsCd:"O",pbancDvsCd:"FB"});
    const sidoRows=Array.isArray(sidoPayload?.data?.adongSdLst)?sidoPayload.data.adongSdLst:[];
    let regions=sidoRows.map(r=>({code:clean(r.code||r.adongSdCd,10),name:clean(r.name||r.adongSdNm,50)})).filter(r=>r.code&&r.name);
    if(maxRegions>0)regions=regions.slice(0,maxRegions);
    if(!regions.length)throw new Error("법원 시도 코드 0건");

    const unique=new Map(); let rawRows=0,totalExpected=0,pages=0;
    const perRegion=[];
    for(const region of regions){
      let page=1,total=null,regionRows=0;
      while(true){
        const payload=await client.post(SEARCH,buildCourtSearchBody(region.code,page));
        const data=payload?.data||{}, rows=Array.isArray(data.dlt_srchResult)?data.dlt_srchResult:[];
        const pageInfo=data.dma_pageInfo||{};
        if(total===null){total=Number(pageInfo.totalCnt||0);totalExpected+=total}
        rawRows+=rows.length; regionRows+=rows.length; pages++;
        for(const row of rows){const key=propertyKey(row);if(!/^B\d{6}\|/.test(key))continue;unique.set(key,mergeRow(unique.get(key),row))}
        if(!rows.length || page*PAGE_SIZE>=total)break;
        page++;
      }
      perRegion.push({code:region.code,name:region.name,rows:regionRows,unique:[...unique.keys()].length});
      console.log(`법원 목록 ${region.name} 완료 · 원시 ${regionRows}행 · 전국 고유 누계 ${unique.size}건`);
    }
    const requiredRows = totalExpected < 100 ? totalExpected : Math.floor(totalExpected * 0.98);
    if(rawRows < requiredRows) throw new Error(`법원 목록 누락 의심: 수집 ${rawRows}/예상 ${totalExpected}`);
    const items=[];
    for(const row of unique.values()){try{items.push(normalizeCourtSearchRow(row))}catch(e){console.warn(`법원 목록 정규화 생략: ${clean(row.srnSaNo||row.saNo,80)} · ${e.message}`)}}
    if(items.length < 100 && regions.length>1)throw new Error(`법원 고유 물건이 비정상적으로 적습니다: ${items.length}`);
    const coveragePercent=totalExpected?Math.min(100,Math.round(rawRows/totalExpected*10000)/100):0;
    const metadata={
      demo:false,reviewed:true,datasetKind:"court-auction",sourceType:"court-auction-public-search",
      sourceUrl:"https://www.courtauction.go.kr/",lazyDetails:true,
      coverage:`법원경매정보 전국 부동산 공고중 목록 · ${regions.length}개 시도 전수 · 원시 ${rawRows.toLocaleString()}행 / 고유 ${items.length.toLocaleString()}물건`,
      snapshotId:`court-catalog-${now.toISOString()}`,rawRowCount:rawRows,uniquePropertyCount:items.length,regionCount:regions.length,coveragePercent
    };
    const dataset=normalizeDataset({metadata,items},previous,now);
    await publishDataset(dataset,dataDir);
    await saveStatus(statusPath,{
      state:"ready",attemptedAt:now.toISOString(),lastSuccessAt:dataset.metadata.collectedAt,itemCount:items.length,
      completedPages:pages,coverage:metadata.coverage,
      courtCatalog:{mode:"nationwide-search",regions:regions.length,pages,rawRows,totalExpected,uniqueProperties:items.length,coveragePercent,callsUsed:client.calls,durationSeconds:Math.round((Date.now()-started)/1000),perRegion}
    });
    console.log(`법원 전국 목록 완료 · ${regions.length}개 시도 · ${pages}페이지 · ${rawRows}/${totalExpected}행 · 고유 ${items.length}물건 · ${coveragePercent}%`);
    return dataset;
  }catch(error){
    await saveStatus(statusPath,{...previousStatus,state:previous?.items?.length?"failed":"error",attemptedAt:now.toISOString(),lastSuccessAt:previousStatus.lastSuccessAt||previous?.metadata?.collectedAt||null,itemCount:previous?.items?.length||0,message:`전국 목록 수집 실패. 마지막 정상자료 유지: ${clean(error.message,300)}`,courtCatalog:{...(previousStatus.courtCatalog||{}),lastErrorAt:now.toISOString(),lastError:clean(error.message,300),callsUsed:client.calls}});
    throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) collectCourtCatalog().catch(e=>{console.error(e.message);process.exitCode=1});

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { requestFeed, normalizeDataset } from "./collect-auctions.mjs";
import { publishDataset } from "./publish-data.mjs";
import { onbidPhotoUrls } from "./collect-onbid.mjs";

const text = value => String(value ?? "").replace(/\s+/g, " ").trim();
const money = value => /^\d+$/.test(text(value)) ? `${Number(value).toLocaleString("ko-KR")}원` : text(value) || "원문 확인";
const date = value => /^\d{12,14}$/.test(text(value)) ? `${String(value).slice(0,4)}-${String(value).slice(4,6)}-${String(value).slice(6,8)}` : "";
const clock = value => /^\d{12,14}$/.test(text(value)) ? `${String(value).slice(8,10)}:${String(value).slice(10,12)}` : "";
const time = value => date(value) ? `${date(value)}T${clock(value)}:00+09:00` : "";
const first = (obj, keys) => keys.map(key => text(obj?.[key])).find(Boolean) || "";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const MOVABLE_PROPERTY_CODES = {
  "0001":"국유재산", "0002":"공유재산", "0003":"금융권담보재산", "0004":"불용품", "0005":"기타일반재산",
  "0006":"유입자산", "0007":"압류재산", "0008":"수탁재산", "0009":"유동화유입자산", "0010":"국유재산(캠코)"
};

function decodeKey(value) {
  let decoded = String(value || "").trim();
  if (/%[0-9a-f]{2}/i.test(decoded)) decoded = decodeURIComponent(decoded);
  return decoded;
}

export function onbidMovableListUrl(key, { pageNo = 1, numOfRows = 500, prptDivCd = "0005", pvctTrgtYn = "N" } = {}) {
  if (!key) throw new Error("온비드 동산 목록 조회에는 인증키가 필요합니다.");
  const url = new URL("https://apis.data.go.kr/B010003/OnbidMvastListSrvc2/getMvastCltrList2");
  url.search = new URLSearchParams({
    serviceKey: decodeKey(key), pageNo: String(pageNo), numOfRows: String(numOfRows),
    resultType: "json", prptDivCd: String(prptDivCd), pvctTrgtYn
  });
  return url;
}

export function onbidMovableDetailUrl(key, cltrMngNo) {
  if (!key || !text(cltrMngNo)) throw new Error("온비드 동산 상세 조회에는 인증키와 물건관리번호가 필요합니다.");
  const url = new URL("https://apis.data.go.kr/B010003/OnbidMvastDtlSrvc2/getMvastDtlInf2");
  url.search = new URLSearchParams({
    serviceKey: decodeKey(key), pageNo: "1", numOfRows: "100", resultType: "json", cltrMngNo: text(cltrMngNo)
  });
  return url;
}

export function onbidMovablePage(payload) {
  const data = payload?.response || payload;
  if (String(data?.header?.resultCode) !== "00") throw new Error("온비드 동산 목록 API 응답 오류");
  const value = data?.body?.items?.item;
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const total = Number(data?.body?.totalCount);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("온비드 동산 전체 건수 오류");
  return { rows, total, pageNo: Number(data.body?.pageNo), numOfRows: Number(data.body?.numOfRows) };
}

export function onbidMovableDetailItems(payload) {
  const data = payload?.response || payload;
  if (String(data?.header?.resultCode) !== "00") throw new Error("온비드 동산 상세 API 응답 오류");
  const value = data?.body?.items?.item;
  return Array.isArray(value) ? value : value ? [value] : [];
}

function movableAssetDetails(row = {}) {
  const quantity = first(row, ["qnt", "qty", "qnty", "qntt", "prptQnt", "cltrQnt"]);
  const quantityUnit = first(row, ["qntUnitNm", "qntUnit", "unitNm"]);
  const weight = first(row, ["wght", "wt", "prptWght"]);
  const weightUnit = first(row, ["wghtUnitNm", "wghtUnit"]);
  const result = {
    assetName: first(row, ["prptNm", "onbidCltrNm", "cltrNm", "mvastNm"]),
    quantity: [quantity, quantityUnit].filter(Boolean).join(" "),
    weight: [weight, weightUnit].filter(Boolean).join(" "),
    manufacturer: first(row, ["mnfctNm", "manfNm", "mkrNm", "makrNm"]),
    model: first(row, ["mdlNm", "modelNm"]),
    origin: first(row, ["prdcPlc", "prdcArea", "originNm"]),
    storagePlace: first(row, ["strgPlc", "strgPlcNm", "cltrRadr", "zadrNm"]),
    artworkTitle: first(row, ["artwNm", "artNm", "workNm"]),
    artist: first(row, ["artistNm", "authrNm", "writrNm"]),
    itemName: first(row, ["itemNm", "stockNm", "sctyNm", "mvastKndNm"]),
    note: first(row, ["cltrEtcCont", "etcCont", "rmrk", "rmk"])
  };
  return Object.values(result).some(Boolean) ? result : null;
}

export function onbidMovableRecord(row, prptDivCd = "") {
  const cltrMngNo = first(row, ["cltrMngNo"]);
  const pbctCdtnNo = first(row, ["pbctCdtnNo"]);
  const title = first(row, ["onbidCltrNm", "cltrNm", "prptNm", "mvastNm"]);
  const start = first(row, ["cltrBidBgngDt", "pbctBegnDtm", "bidBgngDt"]);
  const end = first(row, ["cltrBidEndDt", "pbctClsDtm", "bidEndDt"]);
  if (!cltrMngNo || !title || !date(end)) throw new Error("온비드 동산 필수 물건번호·물건명·마감일 누락");
  const category = [
    first(row, ["prptDivNm"]) || MOVABLE_PROPERTY_CODES[prptDivCd] || "동산",
    first(row, ["cltrUsgMclsCtgrNm", "ctgrMclsNm", "ctgrFullNm"]),
    first(row, ["cltrUsgSclsCtgrNm", "ctgrSclsNm"])
  ].filter(Boolean).join(" · ");
  const address = first(row, ["zadrNm", "cltrRadr", "addr", "roadNmAddr", "strgPlc", "strgPlcNm"]) ||
    [first(row, ["ctprvnNm", "sidoNm", "sido"]), first(row, ["sggNm", "sgg"]), first(row, ["emdNm", "emd"])].filter(Boolean).join(" ") ||
    title;
  const assetDetails = movableAssetDetails(row);
  const minimumRaw = first(row, ["lowstBidPrcIndctCont", "lowstBidPrc", "minBidPrc"]);
  const appraisalRaw = first(row, ["apslEvlAmt", "apslPrc"]);
  const status = first(row, ["pbctStatNm", "cltrStatNm"]) || "온비드 원문 확인";
  return {
    id: `onbid-movable-${cltrMngNo}-${pbctCdtnNo || "0"}-${end}`,
    auctionKind: "onbid", demo: false, type: "other", title, address,
    court: first(row, ["orgNm", "pbancOrgNm"]) || "한국자산관리공사",
    caseNumber: cltrMngNo, itemNumber: pbctCdtnNo ? `공매조건 ${pbctCdtnNo}` : "동산 공매",
    saleDate: date(end), bidStartsAt: time(start), bidEndsAt: time(end),
    appraisal: money(appraisalRaw), minimum: money(minimumRaw), ratio: "-",
    rounds: /^\d+$/.test(first(row, ["usbdNft"])) ? `${Number(first(row, ["usbdNft"]))}회 유찰` : "원문 확인",
    area: assetDetails?.quantity ? `수량 ${assetDetails.quantity}` : assetDetails?.weight ? `중량 ${assetDetails.weight}` : "동산 상세 확인",
    occupancy: "보관장소·인도조건 원문 확인", category: category || "동산", status,
    schedules: [
      { date: date(start), time: clock(start), type: "입찰 시작", place: "온비드", minimum: money(minimumRaw), result: "예정" },
      { date: date(end), time: clock(end), type: "입찰 마감", place: "온비드", minimum: money(minimumRaw), result: status }
    ].filter(value => value.date),
    ...(assetDetails ? { assetDetails } : {}),
    sourceUrl: "https://www.onbid.co.kr/", sourceUpdatedAt: first(row, ["mdfcnDt", "updtDt"])
  };
}

export function onbidMovableEnrichment(items, cltrMngNo) {
  const requested = text(cltrMngNo);
  const rows = (Array.isArray(items) ? items : []).filter(item => !item?.cltrMngNo || text(item.cltrMngNo) === requested);
  if (!rows.length) throw new Error("온비드 동산 상세 응답의 물건관리번호가 요청값과 일치하지 않습니다.");
  const combined = Object.assign({}, ...rows.reverse());
  const imageUrls = [...new Set(rows.flatMap(onbidPhotoUrls))].slice(0, 8);
  const assetDetails = movableAssetDetails(combined);
  const appraisalDate = first(combined, ["apslEvlYmd", "apslDt"]);
  const appraisalOrg = first(combined, ["apslEvlInsttNm", "apslInsttNm", "apslEvlrNm"]);
  const appraisalSummary = {
    valuedAt: /^\d{8}$/.test(appraisalDate) ? `${appraisalDate.slice(0,4)}-${appraisalDate.slice(4,6)}-${appraisalDate.slice(6,8)}` : "",
    location: assetDetails?.storagePlace ? `보관장소: ${assetDetails.storagePlace}` : "",
    usage: [assetDetails?.itemName, assetDetails?.assetName].filter(Boolean).join(" · "),
    other: [appraisalOrg ? `감정평가기관: ${appraisalOrg}` : "", assetDetails?.note].filter(Boolean).join(" · ")
  };
  return {
    ...(imageUrls.length ? { imageUrls } : {}),
    ...(assetDetails ? { assetDetails } : {}),
    ...(Object.values(appraisalSummary).some(Boolean) ? { appraisalSummary } : {})
  };
}

export async function collectOnbidMovable({
  key,
  dataDir = "data/onbid-movable",
  rawDir = "source-data/onbid-movable",
  propertyCodes = Object.keys(MOVABLE_PROPERTY_CODES),
  maxPagesPerCode = 50,
  detailLimit = 100,
  now = new Date(),
  fetcher = fetch
} = {}) {
  const startedAt = now.toISOString();
  await mkdir(dataDir, { recursive: true });
  const archive = resolve(rawDir, startedAt.replace(/[:.]/g, "-"));
  await mkdir(archive, { recursive: true });
  let previousStatus = {};
  try { previousStatus = JSON.parse(await readFile(resolve(dataDir, "collection-status.json"), "utf8")); } catch {}
  const saveStatus = async status => {
    const path = resolve(dataDir, "collection-status.json");
    await writeFile(`${path}.tmp`, JSON.stringify(status, null, 2) + "\n");
    await rename(`${path}.tmp`, path);
  };
  try {
    if (!key) throw new Error("온비드 동산 목록 활용신청이 승인된 ONBID_SERVICE_KEY가 필요합니다.");
    const records = [];
    const totals = {};
    let completedPages = 0;
    for (const prptDivCd of propertyCodes) {
      const firstPayload = await requestFeed(onbidMovableListUrl(key, { prptDivCd }), { fetcher });
      const firstPage = onbidMovablePage(firstPayload);
      totals[prptDivCd] = firstPage.total;
      const pageSize = firstPage.numOfRows || 500;
      const pageCount = firstPage.total ? Math.ceil(firstPage.total / pageSize) : 1;
      if (pageCount > maxPagesPerCode) throw new Error(`온비드 동산 ${prptDivCd} 페이지 한도 초과: ${pageCount}`);
      for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
        const payload = pageNo === 1 ? firstPayload : await requestFeed(onbidMovableListUrl(key, { pageNo, numOfRows: pageSize, prptDivCd }), { fetcher });
        const page = onbidMovablePage(payload);
        if (page.total !== firstPage.total) throw new Error(`온비드 동산 ${prptDivCd} 수집 중 전체 건수가 변경됐습니다.`);
        const normalized = page.rows.map(row => onbidMovableRecord(row, prptDivCd));
        records.push(...normalized);
        completedPages++;
        await writeFile(resolve(archive, `${prptDivCd}-${String(pageNo).padStart(3,"0")}.json.gz`), gzipSync(JSON.stringify(payload)));
        console.log(`온비드 동산 ${MOVABLE_PROPERTY_CODES[prptDivCd] || prptDivCd} ${pageNo}/${pageCount}페이지 · ${normalized.length}건`);
        if (pageNo < pageCount) await new Promise(resolve => setTimeout(resolve, 250));
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const deduped = [...new Map(records.map(item => [item.id, item])).values()];
    let previous;
    try { previous = JSON.parse(await readFile(resolve(dataDir, "auctions.json"), "utf8")); } catch {}
    const previousDetails = new Map((previous?.items || []).map(item => [item.caseNumber, {
      ...(item.imageUrls?.length ? { imageUrls: item.imageUrls } : {}),
      ...(item.assetDetails ? { assetDetails: item.assetDetails } : {}),
      ...(item.appraisalSummary ? { appraisalSummary: item.appraisalSummary } : {})
    }]));
    const byProperty = new Map();
    for (const record of deduped) {
      Object.assign(record, previousDetails.get(record.caseNumber) || {});
      if (!byProperty.has(record.caseNumber)) byProperty.set(record.caseNumber, []);
      byProperty.get(record.caseNumber).push(record);
    }
    const targets = [...byProperty.entries()]
      .filter(([, rows]) => !(rows[0].imageUrls?.length || rows[0].assetDetails || rows[0].appraisalSummary))
      .sort((a,b)=>(a[1][0].bidEndsAt || "9999").localeCompare(b[1][0].bidEndsAt || "9999"))
      .slice(0, Math.max(0, detailLimit));
    let detailAttempted = 0, detailAdded = 0, detailDenied = 0, detailRateLimited = 0, detailErrors = 0;
    for (const [cltrMngNo, rows] of targets) {
      try {
        detailAttempted++;
        const payload = await requestFeed(onbidMovableDetailUrl(key, cltrMngNo), { fetcher });
        const enrichment = onbidMovableEnrichment(onbidMovableDetailItems(payload), cltrMngNo);
        rows.forEach(record => Object.assign(record, enrichment));
        detailAdded++;
      } catch (error) {
        if (/HTTP\s*(401|403)|SERVICE_ACCESS_DENIED|PERMISSION_DENIED/i.test(error.message)) {
          detailDenied++; console.warn(`온비드 동산 상세 보강 중단: 상세 API 활용 권한 필요 · ${error.message}`); break;
        }
        if (/HTTP\s*429/i.test(error.message)) {
          detailRateLimited++; console.warn("온비드 동산 상세 보강 중단: 호출 제한 · 다음 수집에서 이어서 보강"); break;
        }
        detailErrors++; console.warn(`온비드 동산 상세 보강 생략: ${cltrMngNo} · ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    const photoProperties = deduped.filter(item => item.imageUrls?.length).reduce((set,item)=>set.add(item.caseNumber),new Set()).size;
    const metadata = {
      demo:false, reviewed:true, datasetKind:"onbid-public-sale-movable", redistributionAllowed:true,
      sourceType:"onbid-official-movable-api", sourceUrl:"https://www.data.go.kr/data/15157232/openapi.do",
      detailSourceUrl:"https://www.data.go.kr/data/15157245/openapi.do",
      coverage:"온비드 동산(차량 제외) 현재 입찰 중·입찰예정 물건 / 재산유형 전체 / 수의계약 대상 제외",
      snapshotId:`onbid-movable-${startedAt}`, photoProperties
    };
    const dataset = normalizeDataset({ metadata, items: deduped }, previous, now);
    dataset.metadata.distinctProperties = new Set(deduped.map(item => item.caseNumber)).size;
    dataset.metadata.propertyTypeTotals = totals;
    await publishDataset(dataset, dataDir);
    const status = {
      state:"ready", attemptedAt:startedAt, lastSuccessAt:startedAt, itemCount:deduped.length,
      completedPages, photoProperties,
      detailEnrichment:{ attempted:detailAttempted, requested:targets.length, added:detailAdded, denied:detailDenied, rateLimited:detailRateLimited, errors:detailErrors,
        state:detailDenied ? "detail-api-access-required" : detailRateLimited ? "rate-limited" : detailErrors ? "partial-error" : targets.length ? "checked" : "not-requested" },
      coverage:metadata.coverage
    };
    await saveStatus(status);
    console.log(`실제 온비드 동산 ${deduped.length}입찰건 / 상세 ${detailAdded}건 보강 / 사진 물건 ${photoProperties}건`);
    return dataset;
  } catch (error) {
    await saveStatus({ state:key ? "error" : "unconfigured", attemptedAt:startedAt, lastSuccessAt:previousStatus.lastSuccessAt || null, message:"온비드 동산 수집 실패. 목록·상세 API 활용신청과 호출 조건을 확인하세요." });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  collectOnbidMovable({
    key:process.env.ONBID_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY,
    detailLimit:Number(process.env.ONBID_MOVABLE_DETAIL_LIMIT || 100)
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}

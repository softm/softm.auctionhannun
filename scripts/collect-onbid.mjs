import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { onbidListUrl } from "./probe-onbid.mjs";
import { requestFeed, normalizeDataset } from "./collect-auctions.mjs";
import { publishDataset } from "./publish-data.mjs";

const hash = data => createHash("sha256").update(JSON.stringify(data)).digest("hex");
const text = value => String(value ?? "").replace(/\s+/g, " ").trim();
const money = value => /^\d+$/.test(text(value)) ? `${Number(value).toLocaleString("ko-KR")}원` : text(value) || "원문 확인";
const date = value => /^\d{12}$/.test(text(value)) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : "";
const time = value => date(value) ? `${date(value)}T${value.slice(8, 10)}:${value.slice(10, 12)}:00+09:00` : "";

export function onbidDetailUrl(key, cltrMngNo) {
  if (!key || !text(cltrMngNo)) throw new Error("온비드 상세 조회에는 인증키와 물건관리번호가 필요합니다.");
  let decoded = key.trim();
  if (/%[0-9a-f]{2}/i.test(decoded)) decoded = decodeURIComponent(decoded);
  const url = new URL("https://apis.data.go.kr/B010003/OnbidRlstDtlSrvc2/getRlstDtlInf2");
  url.search = new URLSearchParams({ serviceKey: decoded, pageNo: "1", numOfRows: "100", resultType: "json", cltrMngNo: text(cltrMngNo) });
  return url;
}

export function onbidDetailItems(payload) {
  const data = payload.response || payload;
  if (String(data.header?.resultCode) !== "00") throw new Error("온비드 상세 API 응답 오류");
  const value = data.body?.items?.item;
  return Array.isArray(value) ? value : value ? [value] : [];
}

export function onbidPhotoUrls(item) {
  let photos = item?.potoUrlList;
  if (photos && !Array.isArray(photos) && typeof photos === "object") photos = photos.potoUrl || photos.item || Object.values(photos);
  const values = Array.isArray(photos) ? photos.flatMap(photo => typeof photo === "string" ? photo.split("|") : [photo?.urlAdr]) : String(photos || "").split("|");
  return [...new Set(values.map(text).filter(Boolean))];
}

const date8 = value => /^\d{8}$/.test(text(value)) ? `${String(value).slice(0,4)}-${String(value).slice(4,6)}-${String(value).slice(6,8)}` : "";

function detailList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return [];
  for (const key of ["item", "items", "listItem"]) {
    if (Array.isArray(value[key])) return value[key];
    if (value[key] && typeof value[key] === "object") return [value[key]];
  }
  return [value];
}

function httpsOnly(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

function onbidArea(value) {
  const normalized = text(value).replace(/㎡+$/u, "").trim();
  return normalized ? `${normalized}㎡` : "";
}

function dedupeOnbidLots(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const cleaned = {
      number: "",
      type: text(value?.type),
      address: text(value?.address),
      area: onbidArea(value?.area),
      share: text(value?.share),
      details: text(value?.details)
    };
    const key = JSON.stringify([cleaned.type, cleaned.address, cleaned.area, cleaned.share, cleaned.details]);
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.number = String(result.length + 1);
    result.push(cleaned);
  }
  return result;
}

export function onbidDetailEnrichment(items, cltrMngNo) {
  const requested = text(cltrMngNo);
  const matching = (Array.isArray(items) ? items : []).filter(item => text(item?.cltrMngNo) === requested);
  if (!matching.length) throw new Error("온비드 상세 응답의 물건관리번호가 요청값과 일치하지 않습니다.");
  const first = key => matching.map(item => text(item?.[key])).find(Boolean) || "";
  const imageUrls = [...new Set(matching.flatMap(onbidPhotoUrls))].slice(0, 8);
  const sqms = matching.flatMap(item => detailList(item?.sqmsList));
  const propertyLots = dedupeOnbidLots(sqms.slice(0, 50).map(value => ({
    type: text(value?.clandCont),
    address: first("zadrNm") || first("cltrRadr"),
    area: onbidArea(value?.sqmsCont),
    share: text(value?.pursAlcCont),
    details: text(value?.dtlCltrNm)
  })).filter(value => value.type || value.area || value.share || value.details));
  const appraisals = matching.flatMap(item => detailList(item?.apslEvlClgList));
  const appraisal = appraisals[0] || {};
  const appraisalSummary = {
    valuedAt: date8(appraisal.apslEvlYmd),
    location: first("locVntyPscdCont"),
    usage: first("utlzPscdCont"),
    other: [first("cltrEtcCont"), first("icdlCdtnCont")].filter(Boolean).join(" · ")
  };
  const appraisalUrl = appraisals.map(value => httpsOnly(value?.urlAdr)).find(Boolean) || "";
  const documents = appraisals.length ? {
    appraisalReport: { available: true, publishedAt: date8(appraisal.apslEvlYmd), url: appraisalUrl }
  } : null;
  const occupantCount = Math.max(0, ...matching.map(item => detailList(item?.ocpyRelList).length));
  const leaseCount = Math.max(0, ...matching.map(item => detailList(item?.leasInfList).length));
  const tenancySummary = occupantCount || leaseCount ? {
    status: "온비드 상세정보 수집",
    occupantCount,
    note: [occupantCount ? `점유관계 ${occupantCount}건` : "", leaseCount ? `임대차정보 ${leaseCount}건` : ""].filter(Boolean).join(" · ")
  } : null;
  return {
    imageUrls,
    ...(propertyLots.length ? { propertyLots } : {}),
    ...(Object.values(appraisalSummary).some(Boolean) ? { appraisalSummary } : {}),
    ...(documents ? { documents } : {}),
    ...(tenancySummary ? { tenancySummary } : {})
  };
}

export function onbidRecord(row) {
  if (!row.cltrMngNo || !row.pbctCdtnNo || !row.onbidCltrNm || !date(row.cltrBidEndDt)) throw new Error("온비드 필수 물건번호·물건명·마감일 누락");
  const category = [row.cltrUsgMclsCtgrNm, row.cltrUsgSclsCtgrNm].map(text).filter(Boolean).join(" · ");
  const type = /토지|임야/.test(category) ? "land" : /아파트|주택|주거|오피스텔/.test(category) ? "apartment" : /상가|근린|판매|업무/.test(category) ? "commercial" : "other";
  return {
    id: `onbid-${row.cltrMngNo}-${row.pbctCdtnNo}-${row.cltrBidEndDt}`, auctionKind: "onbid", demo: false,
    type, title: text(row.onbidCltrNm), address: text(row.onbidCltrNm),
    court: text(row.orgNm) || "한국자산관리공사", caseNumber: text(row.cltrMngNo), itemNumber: `공매조건 ${row.pbctCdtnNo}`,
    saleDate: date(row.cltrBidEndDt), bidStartsAt: time(row.cltrBidBgngDt), bidEndsAt: time(row.cltrBidEndDt),
    appraisal: money(row.apslEvlAmt), minimum: money(row.lowstBidPrcIndctCont),
    ratio: row.apslPrcCtrsLowstBidRto == null ? "-" : `${row.apslPrcCtrsLowstBidRto}%`,
    rounds: /^\d+$/.test(text(row.usbdNft)) ? `${Number(row.usbdNft)}회 유찰` : "원문 확인",
    area: [Number(row.landSqms) > 0 ? `토지 ${row.landSqms}㎡` : "", Number(row.bldSqms) > 0 ? `건물 ${row.bldSqms}㎡` : ""].filter(Boolean).join(" · ") || "원문 확인",
    category, status: text(row.pbctStatNm) || "온비드 원문 확인", occupancy: "공고문·명도 책임 원문 확인",
    // Observed Onbid ltnoPnu uses 0/1 at the mountain flag, unlike standard PNU 1/2.
    // Do not guess a conversion: user confirms a VWorld parcel candidate before opening EUM.
    pnu: null,
    sourceUrl: "https://www.onbid.co.kr/", sourceUpdatedAt: text(row.mdfcnDt)
  };
}

export function onbidPage(payload) {
  const data = payload.response || payload;
  if (String(data.header?.resultCode) !== "00") throw new Error("온비드 제공기관 응답 오류: 권한·호출 한도·검색 조건을 확인해 주세요.");
  const value = data.body?.items?.item;
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  const total = Number(data.body?.totalCount);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("온비드 전체 건수 오류");
  return { rows, total };
}

export async function collectOnbid({ key, detailKey = key, dataDir = "data/onbid", rawDir = "source-data/onbid", days = 7, maxPages = 100, imageLimit = 0, now = new Date(), fetcher = fetch } = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 31) throw new Error("조회 범위는 1~31일입니다.");
  const startDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const startedAt = now.toISOString();
  const archive = resolve(rawDir, startedAt.replace(/[:.]/g, "-"));
  await mkdir(archive, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  let previousStatus = {};
  try { previousStatus = JSON.parse(await readFile(resolve(dataDir, "collection-status.json"), "utf8")); } catch {}
  const saveStatus = async status => {
    const path = resolve(dataDir, "collection-status.json");
    await writeFile(`${path}.tmp`, JSON.stringify(status, null, 2) + "\n"); await rename(`${path}.tmp`, path);
  };
  const request = async pageNo => {
    const url = onbidListUrl(key, { pageNo, numOfRows: 500 });
    url.searchParams.set("bidPrdYmdStart", startDate.replaceAll("-", ""));
    url.searchParams.set("bidPrdYmdEnd", endDate.replaceAll("-", ""));
    return requestFeed(url, { fetcher });
  };
  try {
    if (!key) throw new Error("온비드 활용신청이 승인된 ONBID_SERVICE_KEY가 필요합니다.");
    const first = await request(1);
    const { rows: firstRows, total } = onbidPage(first);
    const pageSize = Number((first.response || first).body.numOfRows);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error("온비드 페이지 크기 오류");
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (pageCount > maxPages) throw new Error(`호출 예산 초과: ${pageCount}페이지. 수집 범위를 줄여 주세요.`);
    const records = [];
    for (let page = 1; page <= pageCount; page++) {
      const payload = page === 1 ? first : await request(page);
      const result = onbidPage(payload);
      if (result.total !== total) throw new Error("수집 중 온비드 전체 건수가 변경됐습니다. 마지막 정상 자료 유지");
      const body = (payload.response || payload).body;
      if (Number(body.pageNo) !== page || Number(body.numOfRows) !== pageSize) throw new Error("온비드 페이지 번호·크기 불일치");
      if (result.rows.length !== Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))) throw new Error("온비드 페이지 건수 불일치");
      const normalized = result.rows.map(onbidRecord);
      records.push(...normalized);
      // Raw government response is kept locally only; the public schema is an explicit allowlist.
      await writeFile(resolve(archive, `${String(page).padStart(3, "0")}.json.gz`), gzipSync(JSON.stringify(payload)));
      await writeFile(resolve(archive, "checkpoint.json"), JSON.stringify({ completedPages: page, pageCount, receivedCount: records.length, expectedCount: total, complete: false, startDate, endDate }, null, 2));
      console.log(`온비드 ${page}/${pageCount}페이지 · ${records.length}/${total}입찰건`);
      if (page < pageCount) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (records.length !== total) throw new Error("온비드 전체 건수와 수집 건수가 다릅니다.");
    const check = onbidPage(await request(1));
    if (check.total !== total || hash(check.rows) !== hash(firstRows)) throw new Error("수집 중 첫 페이지가 변경됐습니다. 마지막 정상 자료 유지");
    let previous;
    try { previous = JSON.parse(await readFile(resolve(dataDir, "auctions.json"), "utf8")); } catch {}
    if (previous?.items?.length && !total) throw new Error("온비드 응답이 갑자기 0건으로 바뀌어 자동 반영을 중단합니다.");
    const previousDetails = new Map((previous?.items || []).map(item => [item.caseNumber, {
      ...(item.imageUrls?.length ? { imageUrls: item.imageUrls } : {}),
      ...(item.propertyLots?.length ? { propertyLots: dedupeOnbidLots(item.propertyLots) } : {}),
      ...(item.appraisalSummary ? { appraisalSummary: item.appraisalSummary } : {}),
      ...(item.documents ? { documents: item.documents } : {}),
      ...(item.tenancySummary ? { tenancySummary: item.tenancySummary } : {})
    }]));
    const recordsByProperty = new Map();
    for (const record of records) {
      Object.assign(record, previousDetails.get(record.caseNumber) || {});
      if (!recordsByProperty.has(record.caseNumber)) recordsByProperty.set(record.caseNumber, []);
      recordsByProperty.get(record.caseNumber).push(record);
    }
    const hasDetail = record => Boolean(record.imageUrls?.length || record.propertyLots?.length || record.appraisalSummary || record.documents || record.tenancySummary);
    const targets = [...recordsByProperty.entries()].filter(([, rows]) => !hasDetail(rows[0])).sort((a, b) => (a[1][0].bidEndsAt || "9999").localeCompare(b[1][0].bidEndsAt || "9999")).slice(0, Math.max(0, imageLimit));
    let photoProperties = 0;
    let photoDetailDenied = 0;
    let photoDetailErrors = 0;
    let photoAttempted = 0;
    for (const [cltrMngNo, rows] of targets) {
      try {
        photoAttempted++;
        const detail = await requestFeed(onbidDetailUrl(detailKey, cltrMngNo), { fetcher });
        const enrichment = onbidDetailEnrichment(onbidDetailItems(detail), cltrMngNo);
        rows.forEach(record => Object.assign(record, enrichment));
        if (enrichment.imageUrls?.length) photoProperties++;
      } catch (error) {
        if (/HTTP\s*(401|403)|SERVICE_ACCESS_DENIED|PERMISSION_DENIED/i.test(error.message)) {
          photoDetailDenied++;
          console.warn(`온비드 사진·상세 보강 중단: 부동산 물건상세 API 활용 권한을 확인하세요. · ${error.message}`);
          break;
        }
        photoDetailErrors++;
        console.warn(`온비드 사진 보강 생략: ${cltrMngNo} · ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    const photoPropertiesTotal = records.filter(item => item.imageUrls?.length).reduce((set, item) => set.add(item.caseNumber), new Set()).size;
    const metadata = { demo: false, reviewed: true, datasetKind: "onbid-public-sale", redistributionAllowed: true, sourceType: "onbid-official-api", sourceUrl: "https://www.data.go.kr/data/15157207/openapi.do", detailSourceUrl: "https://www.data.go.kr/data/15157247/openapi.do", coverage: `전국 압류재산·매각·수의계약 불가 / 입찰기간 검색 ${startDate}~${endDate} / 공매조건·마감일별 입찰건`, snapshotId: `onbid-${startedAt}`, photoProperties: photoPropertiesTotal };
    const dataset = normalizeDataset({ metadata, items: records }, previous, now);
    dataset.metadata.distinctProperties = new Set(records.map(item => item.caseNumber)).size;
    await publishDataset(dataset, dataDir);
    const status = { state: "ready", attemptedAt: startedAt, lastSuccessAt: startedAt, itemCount: records.length, expectedCount: total, completedPages: pageCount, photoProperties: photoPropertiesTotal, photoEnrichment: { attempted: photoAttempted, requested: targets.length, added: photoProperties, denied: photoDetailDenied, errors: photoDetailErrors, state: photoDetailDenied ? "detail-api-access-required" : photoDetailErrors ? "partial-error" : targets.length ? "checked" : "not-requested" }, coverage: metadata.coverage };
    await saveStatus(status);
    await writeFile(resolve(archive, "checkpoint.json"), JSON.stringify({ ...status, complete: true }, null, 2));
    console.log(`온비드 상세 보강 ${photoAttempted}건 확인 · 신규 사진 물건 ${photoProperties}건 · 배포 사진 물건 누계 ${photoPropertiesTotal}건`);
    return dataset;
  } catch (error) {
    await saveStatus({ state: key ? "error" : "unconfigured", attemptedAt: startedAt, lastSuccessAt: previousStatus.lastSuccessAt || null, message: "온비드 수집·검증 실패. 마지막 정상 자료를 유지합니다." });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  collectOnbid({ key: process.env.ONBID_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY, days: Number(process.env.ONBID_HORIZON_DAYS || 7), imageLimit: Number(process.env.ONBID_IMAGE_ENRICH_LIMIT || 80) })
    .then(data => console.log(`실제 온비드 ${data.items.length}입찰건 / ${data.metadata.distinctProperties}물건 수집 완료`))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

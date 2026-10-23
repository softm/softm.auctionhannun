import { createHash } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { validCoordinate, validPnu } from "../parcel-utils.js";
import { publishDataset } from "./publish-data.mjs";

const allowedTypes = new Set(["apartment", "land", "commercial", "other"]);
const forbiddenKeys = /^(ownerName|tenantName|debtorName|creditorName|residentRegistrationNumber|phone|email|소유자|임차인|채무자|주민등록번호|연락처)$/i;
const residentNumberPattern = /\b\d{6}\s*[- ]?\s*[1-4]\d{6}\b/;

function clean(value, max = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function requireText(item, key) {
  const value = clean(item[key]);
  if (!value) throw new Error(`필수값 누락: ${key}`);
  return value;
}

function validateSourceUrl(value) {
  const url = new URL(requireText({ value }, "value"));
  if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(key => /key|token|secret|auth/i.test(key))) throw new Error("인증정보 없는 HTTPS 출처만 허용합니다.");
  return url.href;
}

function normalizeImageUrls(values) {
  if (!Array.isArray(values)) return [];
  const urls = [];
  for (const value of values) {
    try {
      const url = new URL(clean(value, 2000));
      if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(key => /key|token|secret|auth|signature/i.test(key))) continue;
      if (!urls.includes(url.href)) urls.push(url.href);
    } catch {}
    if (urls.length === 8) break;
  }
  return urls;
}

function optionalDate(value, label) {
  const result = clean(value, 10);
  if (!result) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) throw new Error(`${label} 형식은 유효한 YYYY-MM-DD입니다.`);
  return result;
}

function normalizeCaseDetails(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {
    filedAt: optionalDate(value.filedAt, "사건접수일"),
    commencedAt: optionalDate(value.commencedAt, "경매개시결정일"),
    distributionDeadline: optionalDate(value.distributionDeadline, "배당요구종기"),
    claimAmount: clean(value.claimAmount, 80)
  };
  return Object.values(result).some(Boolean) ? result : null;
}

function normalizeSchedules(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 100).map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`기일내역 ${index + 1}: 객체가 아닙니다.`);
    return {
      date: optionalDate(value.date, `기일내역 ${index + 1} 기일`),
      time: clean(value.time, 20), type: clean(value.type, 40), place: clean(value.place, 120),
      minimum: clean(value.minimum, 80), result: clean(value.result, 80)
    };
  }).filter(value => Object.values(value).some(Boolean));
}

function normalizePropertyLots(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 100).map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`목록내역 ${index + 1}: 객체가 아닙니다.`);
    return {
      number: clean(value.number, 40) || String(index + 1), type: clean(value.type, 60),
      address: clean(value.address, 300), area: clean(value.area, 120), share: clean(value.share, 120),
      details: clean(value.details, 2000)
    };
  }).filter(value => value.type || value.address || value.area || value.details);
}

function normalizeAppraisalSummary(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = ["valuedAt", "location", "transport", "surroundings", "usage", "structure", "facilities", "landUse", "other"];
  const result = Object.fromEntries(keys.map(key => [key, key === "valuedAt" ? optionalDate(value[key], "감정평가일") : clean(value[key], 2000)]));
  return Object.values(result).some(Boolean) ? result : null;
}

function normalizeDocuments(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const key of ["saleSpecification", "fieldReport", "appraisalReport"]) {
    const document = value[key];
    if (!document || typeof document !== "object" || Array.isArray(document)) continue;
    const url = document.url ? validateSourceUrl(document.url) : "";
    const publishedAt = optionalDate(document.publishedAt, `${key} 공시일`);
    if (url || publishedAt || document.available === true) result[key] = { available: document.available === true || Boolean(url), publishedAt, url };
  }
  return Object.keys(result).length ? result : null;
}

function normalizeTenancySummary(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const occupantCount = Number.isSafeInteger(value.occupantCount) && value.occupantCount >= 0 ? value.occupantCount : null;
  const result = { status: clean(value.status, 100), occupantCount, note: clean(value.note, 1000) };
  return result.status || result.note || occupantCount != null ? result : null;
}

function normalizeAssetDetails(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = ["assetName", "quantity", "weight", "manufacturer", "model", "origin", "storagePlace", "artworkTitle", "artist", "itemName", "note"];
  const result = Object.fromEntries(keys.map(key => [key, clean(value[key], key === "note" ? 1500 : 300)]));
  return Object.values(result).some(Boolean) ? result : null;
}

export function containsSensitiveData(value) {
  if (typeof value === "string") return residentNumberPattern.test(value);
  if (Array.isArray(value)) return value.some(containsSensitiveData);
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entry]) => forbiddenKeys.test(key) || containsSensitiveData(entry));
  }
  return false;
}

export function normalizeItem(item, index) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`물건 ${index + 1}: 객체가 아닙니다.`);
  if (containsSensitiveData(item)) throw new Error(`물건 ${index + 1}: 개인정보로 의심되는 필드 또는 값이 있습니다.`);
  const type = allowedTypes.has(item.type) ? item.type : "other";
  const saleDate = clean(item.saleDate, 10);
  if (saleDate && (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate) || !Number.isFinite(Date.parse(saleDate)) || new Date(saleDate).toISOString().slice(0, 10) !== saleDate)) throw new Error(`물건 ${index + 1}: 매각기일 형식은 유효한 YYYY-MM-DD입니다.`);
  if (item.location != null && !validCoordinate(item.location)) throw new Error(`물건 ${index + 1}: 유효한 국내 위도·경도가 필요합니다.`);
  if (item.pnu && !validPnu(item.pnu)) throw new Error(`물건 ${index + 1}: PNU 형식 오류`);

  const imageUrls = normalizeImageUrls(item.imageUrls);
  const caseDetails = normalizeCaseDetails(item.caseDetails);
  const schedules = normalizeSchedules(item.schedules);
  const propertyLots = normalizePropertyLots(item.propertyLots);
  const appraisalSummary = normalizeAppraisalSummary(item.appraisalSummary);
  const documents = normalizeDocuments(item.documents);
  const tenancySummary = normalizeTenancySummary(item.tenancySummary);
  const assetDetails = normalizeAssetDetails(item.assetDetails);
  return {
    id: requireText(item, "id"),
    demo: Boolean(item.demo),
    auctionKind: item.auctionKind === "onbid" ? "onbid" : "court",
    type,
    title: clean(item.title) || requireText(item, "address"),
    address: requireText(item, "address"),
    court: requireText(item, "court"),
    caseNumber: requireText(item, "caseNumber"),
    itemNumber: clean(item.itemNumber, 40),
    courtCode: clean(item.courtCode, 20),
    itemSeq: clean(item.itemSeq, 20),
    documentId: clean(item.documentId, 120),
    detailLevel: item.detailLevel === "full" ? "full" : item.detailLevel === "list" ? "list" : "",
    saleDate,
    bidStartsAt: clean(item.bidStartsAt, 40),
    bidEndsAt: clean(item.bidEndsAt, 40),
    sourceUpdatedAt: clean(item.sourceUpdatedAt, 40),
    appraisal: clean(item.appraisal) || "공식 확인",
    minimum: clean(item.minimum) || "공식 확인",
    ratio: clean(item.ratio, 30) || "-",
    rounds: clean(item.rounds, 80) || "공식 확인",
    area: clean(item.area, 80) || "원문 확인",
    occupancy: clean(item.occupancy) || "현황조사서 확인",
    category: clean(item.category, 80) || "기타",
    location: item.location ? { latitude: item.location.latitude, longitude: item.location.longitude, source: clean(item.location.source, 80) || "feed" } : null,
    pnu: item.pnu || null,
    status: clean(item.status, 60) || "원문 확인",
    ...(imageUrls.length ? { imageUrls } : {}),
    ...(caseDetails ? { caseDetails } : {}),
    ...(schedules.length ? { schedules } : {}),
    ...(propertyLots.length ? { propertyLots } : {}),
    ...(appraisalSummary ? { appraisalSummary } : {}),
    ...(documents ? { documents } : {}),
    ...(tenancySummary ? { tenancySummary } : {}),
    ...(assetDetails ? { assetDetails } : {}),
    sourceUrl: validateSourceUrl(item.sourceUrl)
  };
}

export function normalizeDataset(input, previous = null, now = new Date()) {
  if (!input || !Array.isArray(input.items)) throw new Error("items 배열이 필요합니다.");
  if (input.metadata?.reviewed !== true) throw new Error("검수 승인된 데이터(metadata.reviewed=true)만 반영할 수 있습니다.");
  const items = input.items.map(normalizeItem);
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`중복 id: ${item.id}`);
    ids.add(item.id);
  }
  items.sort((a, b) => (a.saleDate || "9999").localeCompare(b.saleDate || "9999") || a.id.localeCompare(b.id));
  const contentHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  const unchanged = previous?.metadata?.contentHash === contentHash;
  const metadata = {
    schemaVersion: input.metadata?.schemaVersion === 3 ? 3 : 2,
    demo: input.metadata?.demo !== false,
    reviewed: true,
    sourceType: clean(input.metadata?.sourceType, 60) || "reviewed-json",
    datasetKind: ["onbid-public-sale", "onbid-public-sale-movable"].includes(input.metadata?.datasetKind) ? input.metadata.datasetKind : "court-auction",
    sourceUrl: validateSourceUrl(input.metadata?.sourceUrl || items[0]?.sourceUrl),
    coverage: clean(input.metadata?.coverage, 200) || "제공 범위 미확인",
    snapshotId: clean(input.metadata?.snapshotId, 120),
    collectedAt: unchanged && previous.metadata.collectedAt ? previous.metadata.collectedAt : now.toISOString(),
    itemCount: items.length,
    ...(Number.isSafeInteger(input.metadata?.photoProperties) && input.metadata.photoProperties >= 0 ? { photoProperties: input.metadata.photoProperties } : {}),
    ...(input.metadata?.lazyDetails === true ? { lazyDetails: true } : {}),
    ...(Number.isSafeInteger(input.metadata?.rawRowCount) && input.metadata.rawRowCount >= 0 ? { rawRowCount: input.metadata.rawRowCount } : {}),
    ...(Number.isSafeInteger(input.metadata?.uniquePropertyCount) && input.metadata.uniquePropertyCount >= 0 ? { uniquePropertyCount: input.metadata.uniquePropertyCount } : {}),
    ...(Number.isSafeInteger(input.metadata?.regionCount) && input.metadata.regionCount >= 0 ? { regionCount: input.metadata.regionCount } : {}),
    ...(Number.isFinite(input.metadata?.coveragePercent) && input.metadata.coveragePercent >= 0 && input.metadata.coveragePercent <= 100 ? { coveragePercent: input.metadata.coveragePercent } : {}),
    contentHash
  };
  return { metadata, items };
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function validateFeedPage(input) {
  if (containsSensitiveData(input)) throw new Error("개인정보가 포함된 입력은 저장하지 않습니다.");
  if (input?.metadata?.demo !== false || input.items?.some(item => item.demo === true)) throw new Error("운영 수집에 예시 자료를 사용할 수 없습니다.");
  if (input.metadata?.reviewed !== true || input.metadata?.redistributionAllowed !== true) throw new Error("검수·재배포 승인이 필요합니다.");
  if (input.metadata?.datasetKind !== "court-auction") throw new Error("법원경매 자료만 허용합니다. 공매 자료는 별도 서비스로 구분해야 합니다.");
  if (input.items?.some(item => item.auctionKind && item.auctionKind !== "court")) throw new Error("법원경매 피드에 다른 경매 구분이 포함되었습니다.");
  if (!input.metadata?.coverage || !input.metadata?.snapshotId) throw new Error("수집 범위와 snapshotId가 필요합니다.");
  if (!Number.isSafeInteger(input.metadata.expectedCount) || input.metadata.expectedCount < 0) throw new Error("전체 제공 건수 expectedCount가 필요합니다.");
  normalizeDataset(input);
  return input;
}

async function atomicJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
  await rename(temporary, path);
}

export async function requestFeed(url, { fetcher = fetch, token = "", sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response;
    try {
      response = await fetcher(url, {
        redirect: "error", signal: AbortSignal.timeout(20000),
        headers: { accept: "application/json", "user-agent": "auctionhannun-collector/2.0", ...(token ? { authorization: `Bearer ${token}` } : {}) }
      });
    } catch { if (attempt === 2) throw new Error("피드 네트워크 오류 또는 허용하지 않은 리다이렉트"); await sleep(500 * (attempt + 1)); continue; }
    // Access controls and rate limits are a stop condition, not a retry hint.
    if ([401, 403, 429].includes(response.status)) throw new Error(`피드 접근 중단: HTTP ${response.status}`);
    if (response.status >= 500 && attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
    if (!response.ok) throw new Error(`피드 HTTP ${response.status}`);
    if (!/json/i.test(response.headers.get("content-type") || "")) throw new Error("JSON 피드가 아닙니다. 차단 화면·HTML은 처리하지 않습니다.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("페이지가 8 MiB 제한을 초과했습니다."); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("피드 JSON 해석 오류"); }
  }
}

export function nextPageUrl(value, firstUrl) {
  const next = new URL(value, firstUrl);
  if (next.protocol !== "https:" || next.origin !== new URL(firstUrl).origin || next.username || next.password) throw new Error("다른 출처로 이동하는 페이지는 허용하지 않습니다.");
  return next.href;
}

export async function collect({ feedUrl = "", inputPath, dataDir = "data", rawDir = "source-data", token = "", fetcher = fetch, now = new Date() } = {}) {
  const startedAt = now.toISOString();
  const statusPath = resolve(dataDir, "collection-status.json");
  try {
    if (!feedUrl && !inputPath) throw new Error("데이터 공급원 미연결: AUCTION_FEED_URL 또는 --input 검수 파일이 필요합니다.");
    if (feedUrl && (new URL(feedUrl).protocol !== "https:" || new URL(feedUrl).username || new URL(feedUrl).password)) throw new Error("HTTPS 피드와 별도 인증 토큰을 사용해 주세요.");
    const identity = createHash("sha256").update(feedUrl || resolve(inputPath)).digest("hex").slice(0, 20);
    const archive = resolve(rawDir, identity, startedAt.slice(0, 10));
    await mkdir(archive, { recursive: true });
    const pages = [];
    const visited = new Set();
    let url = feedUrl;
    let metadata;
    do {
      if (pages.length >= 100 || visited.has(url)) throw new Error("페이지 한도 초과 또는 순환 페이지입니다.");
      visited.add(url);
      const input = validateFeedPage(feedUrl ? await requestFeed(url, { token, fetcher }) : JSON.parse(await readFile(inputPath, "utf8")));
      if (metadata && ["snapshotId", "expectedCount", "coverage", "sourceUrl"].some(key => input.metadata[key] !== metadata[key])) throw new Error("수집 중 원본 버전·범위가 바뀌었습니다. 전체를 다시 수집해 주세요.");
      metadata ||= input.metadata;
      pages.push(input);
      // Validated raw responses stay private and out of Pages / Git. No secrets or request URL are saved.
      const pageName = `${createHash("sha256").update(metadata.snapshotId).digest("hex").slice(0, 16)}-${String(pages.length).padStart(3, "0")}.json.gz`;
      await writeFile(resolve(archive, pageName), gzipSync(JSON.stringify(input)));
      await atomicJson(resolve(archive, "checkpoint.json"), { snapshotId: metadata.snapshotId, completedPages: pages.length, expectedCount: metadata.expectedCount, collectedCount: pages.reduce((sum, page) => sum + page.items.length, 0), complete: false, startedAt });
      url = input.nextPage ? nextPageUrl(input.nextPage, feedUrl) : "";
      if (!feedUrl && input.nextPage) throw new Error("파일 입력은 전체 물건을 포함해야 합니다.");
      if (url) await new Promise(resolve => setTimeout(resolve, 400));
    } while (url);
    const items = pages.flatMap(page => page.items);
    if (items.length !== metadata.expectedCount) throw new Error(`불완전한 수집: ${items.length}/${metadata.expectedCount}건. 기존 배포 자료를 유지합니다.`);
    let previous = null;
    try { previous = JSON.parse(await readFile(resolve(dataDir, "auctions.json"), "utf8")); } catch {}
    const result = normalizeDataset({ metadata, items }, previous, now);
    // A sudden empty feed needs an explicit provider-side review, never silently erase the last catalog.
    if (previous?.items?.length && !items.length && metadata.emptyConfirmed !== true) throw new Error("기존 목록을 0건으로 바꾸려면 emptyConfirmed 승인이 필요합니다.");
    await publishDataset(result, dataDir);
    const status = { state: "ready", attemptedAt: startedAt, lastSuccessAt: startedAt, itemCount: items.length, expectedCount: metadata.expectedCount, completedPages: pages.length, coverage: metadata.coverage };
    await atomicJson(statusPath, status);
    await atomicJson(resolve(archive, "checkpoint.json"), { ...status, snapshotId: metadata.snapshotId, complete: true });
    return result;
  } catch (error) {
    let previousStatus = {};
    try { previousStatus = JSON.parse(await readFile(statusPath, "utf8")); } catch {}
    await atomicJson(statusPath, { state: feedUrl || inputPath ? "error" : "unconfigured", attemptedAt: startedAt, lastSuccessAt: previousStatus.lastSuccessAt || null, message: "실제 자료 수집 미완료. 공급원 설정·권한·입력 검증을 확인해 주세요. 마지막 정상 자료는 유지됩니다." });
    throw error;
  }
}

async function main() {
  const result = await collect({ feedUrl: process.env.AUCTION_FEED_URL || "", inputPath: option("--input"), dataDir: option("--data-dir", "data"), rawDir: option("--raw-dir", "source-data"), token: process.env.AUCTION_FEED_TOKEN || "" });
  console.log(`경매 자료 ${result.items.length}건 수집·검증 완료 (${result.metadata.contentHash.slice(0, 12)})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeDataset } from "./collect-auctions.mjs";
import { publishDataset } from "./publish-data.mjs";

const BASE_URL = "https://www.courtauction.go.kr";
const NOTICE_WARMUP = "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ143M01.xml&pgjId=143M01";
const COURTS_PATH = "/pgj/pgjComm/selectCortOfcCdLst.on";
const NOTICE_PATH = "/pgj/pgj143/selectRletDspslPbanc.on";
const NOTICE_DETAIL_PATH = "/pgj/pgj143/selectRletDspslPbancDtl.on";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

const clean = (value, max = 2000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(value) {
  const text = stripHtml(value);
  const matches = text.match(/\d{1,3}(?:,\d{3})+|\d+/g);
  if (!matches?.length) return null;
  const candidates = matches.map(v => Number(v.replaceAll(",", ""))).filter(Number.isFinite);
  return candidates.find(v => v >= 10000) ?? candidates[0] ?? null;
}

function money(value) {
  const amount = typeof value === "number" ? value : parseAmount(value);
  return Number.isFinite(amount) && amount >= 0 ? `${amount.toLocaleString("ko-KR")}원` : "공식 확인";
}

function formatYmd(value) {
  const v = clean(value, 8);
  return /^\d{8}$/.test(v) ? `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}` : "";
}

function monthKey(now, add = 0) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).formatToParts(now).map(p => [p.type, p.value]));
  const base = Number(parts.year) * 12 + Number(parts.month) - 1 + add;
  return `${Math.floor(base / 12)}${String(base % 12 + 1).padStart(2, "0")}`;
}

function courtLabel(row) {
  return clean(row?.cortSptNm) || clean(row?.cortOfcNm) || "대한민국 법원";
}

function typeFromUsage(value) {
  const usage = clean(value);
  if (/아파트|주택|다세대|다가구|오피스텔|연립|주거/.test(usage)) return "apartment";
  if (/토지|대지|임야|전|답|과수원|도로|묘지|잡종지/.test(usage)) return "land";
  if (/상가|근린|판매|업무|공장|숙박|점포|상업/.test(usage)) return "commercial";
  return "other";
}

function splitAddressAndDetails(value) {
  const plain = stripHtml(value);
  const marker = plain.indexOf("[상세내역]");
  if (marker < 0) return { address: plain, details: "" };
  return {
    address: plain.slice(0, marker).trim(),
    details: plain.slice(marker + "[상세내역]".length).trim()
  };
}

function saleTime(value) {
  const match = stripHtml(value).match(/입찰시간\((\d{1,2}:\d{2})\)/);
  return match?.[1] || "";
}

export function normalizeCourtNoticeDetail(row, notice) {
  const caseNumber = clean(row?.csNo, 80);
  const itemSeq = clean(row?.dspslSeq, 40) || "1";
  const usage = clean(row?.usgNm, 120) || "경매물건";
  const { address, details } = splitAddressAndDetails(row?.st);
  const saleDate = formatYmd(notice?.dspslDxdyYmd);
  if (!caseNumber || !address || !saleDate) throw new Error("법원 경매 물건의 사건번호·주소·매각기일이 누락됐습니다.");
  const appraisalAmount = parseAmount(row?.aeeEvlAmt);
  const minimumAmount = parseAmount(row?.lwsDspslPrc);
  const ratio = Number.isFinite(appraisalAmount) && appraisalAmount > 0 && Number.isFinite(minimumAmount)
    ? `${Math.round(minimumAmount / appraisalAmount * 1000) / 10}%`
    : "-";
  const time = saleTime(row?.lwsDspslPrc) || clean(notice?.fstDspslHm, 20);
  const court = courtLabel(notice);
  return {
    id: `court-${clean(notice?.cortOfcCd,20)}-${caseNumber}-${itemSeq}-${saleDate.replaceAll("-","")}`,
    auctionKind: "court",
    demo: false,
    type: typeFromUsage(usage),
    title: `${usage} · ${address}`,
    address,
    court,
    caseNumber,
    itemNumber: `물건 ${itemSeq}`,
    saleDate,
    appraisal: money(appraisalAmount),
    minimum: money(minimumAmount),
    ratio,
    rounds: "기일내역 확인",
    area: "목록내역 확인",
    occupancy: "현황조사서 확인",
    category: usage,
    status: "매각 예정",
    schedules: [{
      date: saleDate,
      time,
      type: clean(notice?.bidDvsCd) === "000332" ? "기간입찰" : "매각기일",
      place: clean(notice?.dspslPlcNm, 160),
      minimum: money(minimumAmount),
      result: "예정"
    }],
    propertyLots: [{
      number: itemSeq,
      type: usage,
      address,
      area: "",
      share: "",
      details: clean(details, 2000)
    }],
    appraisalSummary: clean(row?.dspslRmk, 1500) ? { other: clean(row.dspslRmk, 1500) } : null,
    sourceUpdatedAt: saleDate,
    sourceUrl: "https://www.courtauction.go.kr/"
  };
}

export function courtNoticeRows(payload) {
  const data = payload?.data;
  if (data?.ipcheck === false) {
    const error = new Error("법원경매정보 사이트가 자동 조회를 제한했습니다. 우회하지 않고 수집을 중단합니다.");
    error.code = "COURT_BLOCKED";
    throw error;
  }
  return Array.isArray(data?.dlt_rletDspslPbancLst) ? data.dlt_rletDspslPbancLst : [];
}

export function courtNoticeDetailRows(payload) {
  const data = payload?.data;
  if (data?.ipcheck === false) {
    const error = new Error("법원경매정보 사이트가 자동 조회를 제한했습니다. 우회하지 않고 수집을 중단합니다.");
    error.code = "COURT_BLOCKED";
    throw error;
  }
  const nested = data?.result?.dspslPbanc?.pbancInfo?.lst;
  if (Array.isArray(nested)) return nested;
  return Array.isArray(data?.dlt_gnrlPbancLst) ? data.dlt_gnrlPbancLst : [];
}

class CourtPublicClient {
  constructor({ fetcher = fetch, minDelayMs = 2600, maxCalls = 10 } = {}) {
    this.fetcher = fetcher;
    this.minDelayMs = minDelayMs;
    this.maxCalls = maxCalls;
    this.calls = 0;
    this.lastCallAt = 0;
    this.cookies = new Map();
    this.warmed = false;
  }

  cookieHeader() {
    return [...this.cookies].map(([k,v]) => `${k}=${v}`).join("; ");
  }

  ingestCookies(headers) {
    const values = typeof headers?.getSetCookie === "function" ? headers.getSetCookie() : [headers?.get?.("set-cookie")].filter(Boolean);
    for (const line of values || []) {
      const first = String(line).split(";")[0];
      const at = first.indexOf("=");
      if (at > 0) this.cookies.set(first.slice(0,at).trim(), first.slice(at+1).trim());
    }
  }

  async throttle() {
    if (this.calls >= this.maxCalls) {
      const error = new Error(`법원경매정보 세션 호출 예산 ${this.maxCalls}회를 모두 사용했습니다.`);
      error.code = "COURT_BUDGET";
      throw error;
    }
    const elapsed = Date.now() - this.lastCallAt;
    if (this.lastCallAt && elapsed < this.minDelayMs) await sleep(this.minDelayMs - elapsed);
  }

  headers(referer, extra = {}) {
    return {
      "User-Agent": USER_AGENT,
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      "Origin": BASE_URL,
      "Referer": `${BASE_URL}${referer}`,
      "X-Requested-With": "XMLHttpRequest",
      ...(this.cookies.size ? { "Cookie": this.cookieHeader() } : {}),
      ...extra
    };
  }

  async warmup() {
    if (this.warmed) return;
    await this.throttle();
    let response;
    try {
      response = await this.fetcher(`${BASE_URL}${NOTICE_WARMUP}`, {
        method: "GET", headers: this.headers(NOTICE_WARMUP), redirect: "manual", signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      throw new Error(`법원경매정보 접속 실패: ${error?.message || error}`);
    }
    this.calls++;
    this.lastCallAt = Date.now();
    this.ingestCookies(response.headers);
    if (!response.ok && ![301,302,303,307,308].includes(response.status)) throw new Error(`법원경매정보 초기 접속 HTTP ${response.status}`);
    this.warmed = true;
  }

  async post(path, body, { referer = NOTICE_WARMUP, submissionId = "" } = {}) {
    await this.warmup();
    await this.throttle();
    let response;
    try {
      response = await this.fetcher(`${BASE_URL}${path}`, {
        method: "POST",
        headers: this.headers(referer, {
          "Content-Type": "application/json; charset=UTF-8",
          ...(submissionId ? { submissionid: submissionId, "sc-userid": "SYSTEM" } : {})
        }),
        body: JSON.stringify(body || {}),
        redirect: "manual",
        signal: AbortSignal.timeout(20000)
      });
    } catch (error) {
      throw new Error(`법원경매정보 조회 실패: ${error?.message || error}`);
    }
    this.calls++;
    this.lastCallAt = Date.now();
    this.ingestCookies(response.headers);
    if ([401,403,429].includes(response.status)) {
      const error = new Error(`법원경매정보 접근 제한 HTTP ${response.status}. 우회하지 않고 중단합니다.`);
      error.code = "COURT_BLOCKED";
      throw error;
    }
    if (!response.ok) throw new Error(`법원경매정보 HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!/json/i.test(contentType)) throw new Error("법원경매정보가 JSON이 아닌 응답을 반환했습니다.");
    let payload;
    try { payload = await response.json(); } catch { throw new Error("법원경매정보 JSON 해석 오류"); }
    if (payload?.data?.ipcheck === false) {
      const error = new Error("법원경매정보 사이트가 자동 조회를 제한했습니다. 우회하지 않고 수집을 중단합니다.");
      error.code = "COURT_BLOCKED";
      throw error;
    }
    if (payload?.errors?.errorMessage) throw new Error(`법원경매정보 제공 오류: ${clean(payload.errors.errorMessage,300)}`);
    return payload;
  }
}

export function noticeDetailBody(notice) {
  return {
    dma_srchGnrlPbanc: {
      cortOfcCd: clean(notice?.cortOfcCd,20),
      dspslDxdyYmd: clean(notice?.dspslDxdyYmd,8),
      bidBgngYmd: clean(notice?.bidBgngYmd,8),
      bidEndYmd: clean(notice?.bidEndYmd,8),
      jdbnCd: clean(notice?.jdbnCd,40),
      cortAuctnJdbnNm: clean(notice?.cortAuctnJdbnNm,100),
      jdbnTelno: clean(notice?.jdbnTelno,60),
      dspslPlcNm: clean(notice?.dspslPlcNm,160),
      fstDspslHm: clean(notice?.fstDspslHm,20),
      scndDspslHm: clean(notice?.scndDspslHm,20),
      thrdDspslHm: clean(notice?.thrdDspslHm,20),
      fothDspslHm: clean(notice?.fothDspslHm,20),
      bidDvsCd: clean(notice?.bidDvsCd || notice?.intgCd,40)
    }
  };
}

function advanceCursor(state, months, courts) {
  state.noticeOffset = 0;
  state.monthIndex++;
  if (state.monthIndex >= months.length) {
    state.monthIndex = 0;
    state.courtIndex++;
  }
  if (state.courtIndex >= courts.length) {
    state.courtIndex = 0;
    state.monthIndex = 0;
    state.cycleCompletedAt = new Date().toISOString();
  }
}

function safeCourtCodes(payload) {
  const values = Array.isArray(payload?.data?.result) ? payload.data.result : [];
  const map = new Map();
  for (const row of values) {
    const code = clean(row?.cortOfcCd,20);
    if (!/^B\d{6}$/.test(code)) continue;
    map.set(code, { code, name: courtLabel(row) });
  }
  return [...map.values()].sort((a,b)=>a.code.localeCompare(b.code));
}

function mergeRecords(previousItems, batchItems, now) {
  const cutoff = new Date(now.getTime() - 45 * 86400000).toISOString().slice(0,10);
  const merged = new Map();
  for (const item of previousItems || []) {
    if (!item?.saleDate || item.saleDate >= cutoff) merged.set(item.id, item);
  }
  for (const item of batchItems) {
    const old = merged.get(item.id);
    merged.set(item.id, {
      ...(old || {}),
      ...item,
      ...(old?.imageUrls?.length && !item.imageUrls?.length ? { imageUrls: old.imageUrls } : {}),
      ...(old?.caseDetails && !item.caseDetails ? { caseDetails: old.caseDetails } : {}),
      ...(old?.documents && !item.documents ? { documents: old.documents } : {}),
      ...(old?.tenancySummary && !item.tenancySummary ? { tenancySummary: old.tenancySummary } : {})
    });
  }
  return [...merged.values()];
}

export async function collectCourtPublic({
  dataDir = "data",
  now = new Date(),
  fetcher = fetch,
  maxCalls = Number(process.env.COURT_PUBLIC_MAX_CALLS || 10),
  minDelayMs = Number(process.env.COURT_PUBLIC_MIN_DELAY_MS || 2600)
} = {}) {
  await mkdir(dataDir, { recursive: true });
  let previous = null;
  let previousStatus = {};
  try { previous = JSON.parse(await readFile(resolve(dataDir,"auctions.json"),"utf8")); } catch {}
  try { previousStatus = JSON.parse(await readFile(resolve(dataDir,"collection-status.json"),"utf8")); } catch {}

  const months = [monthKey(now,0), monthKey(now,1)];
  const client = new CourtPublicClient({ fetcher, minDelayMs, maxCalls });
  const statusPath = resolve(dataDir,"collection-status.json");
  const saveStatus = async value => {
    const temp = `${statusPath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value,null,2)+"\n");
    await rename(temp,statusPath);
  };

  const crawl = previousStatus?.courtPublic && typeof previousStatus.courtPublic === "object"
    ? { ...previousStatus.courtPublic }
    : {};
  if (!Array.isArray(crawl.searchMonths) || crawl.searchMonths.join(",") !== months.join(",")) {
    crawl.courtIndex = 0; crawl.monthIndex = 0; crawl.noticeOffset = 0; crawl.searchMonths = months;
  }
  crawl.courtIndex = Number.isSafeInteger(crawl.courtIndex) ? crawl.courtIndex : 0;
  crawl.monthIndex = Number.isSafeInteger(crawl.monthIndex) ? crawl.monthIndex : 0;
  crawl.noticeOffset = Number.isSafeInteger(crawl.noticeOffset) ? crawl.noticeOffset : 0;

  const batch = [];
  let noticesRead = 0;
  let detailCalls = 0;
  let courts;
  try {
    if (Array.isArray(crawl.courtCodes) && crawl.courtCodes.length) {
      courts = crawl.courtCodes;
    } else {
      const payload = await client.post(COURTS_PATH, {}, { referer: NOTICE_WARMUP });
      courts = safeCourtCodes(payload);
      if (!courts.length) throw new Error("법원 사무소 코드 목록을 확인하지 못했습니다.");
      crawl.courtCodes = courts;
    }

    let guard = 0;
    while (client.calls < maxCalls - 1 && guard++ < courts.length * months.length + 5) {
      const court = courts[crawl.courtIndex % courts.length];
      const month = months[crawl.monthIndex % months.length];
      const listPayload = await client.post(NOTICE_PATH, {
        dma_srchDspslPbanc: { srchYmd: month, cortOfcCd: court.code, bidDvsCd: "", srchBtnYn: "Y" }
      }, { referer: NOTICE_WARMUP });
      const notices = courtNoticeRows(listPayload);
      noticesRead += notices.length;

      let offset = Math.min(crawl.noticeOffset, notices.length);
      while (offset < notices.length && client.calls < maxCalls) {
        const notice = notices[offset];
        const detailPayload = await client.post(NOTICE_DETAIL_PATH, noticeDetailBody(notice), { referer: NOTICE_WARMUP });
        const details = courtNoticeDetailRows(detailPayload);
        for (const row of details) {
          try { batch.push(normalizeCourtNoticeDetail(row, notice)); }
          catch (error) { console.warn(`법원 물건 정규화 생략: ${clean(row?.csNo,80)} · ${error.message}`); }
        }
        detailCalls++;
        offset++;
        crawl.noticeOffset = offset;
      }

      if (offset >= notices.length) advanceCursor(crawl, months, courts);
      else break;
    }

    const mergedItems = mergeRecords(previous?.items || [], batch, now);
    if (!mergedItems.length && previous?.items?.length) throw new Error("법원 신규 조회가 0건이어서 마지막 정상 자료를 유지합니다.");
    const metadata = {
      demo: false,
      reviewed: true,
      datasetKind: "court-auction",
      sourceType: "court-auction-public-site",
      sourceUrl: "https://www.courtauction.go.kr/",
      coverage: `법원경매정보 공개 부동산 매각공고 · ${months.join("·")} · 저빈도 증분수집 · 법원/월 순환 ${crawl.courtIndex + 1}/${courts.length}, ${crawl.monthIndex + 1}/${months.length}`,
      snapshotId: `court-public-${now.toISOString()}`
    };
    const dataset = normalizeDataset({ metadata, items: mergedItems }, previous, now);
    await publishDataset(dataset, dataDir);
    const status = {
      state: "ready",
      attemptedAt: now.toISOString(),
      lastSuccessAt: dataset.metadata.collectedAt,
      itemCount: dataset.items.length,
      completedPages: detailCalls,
      coverage: metadata.coverage,
      courtPublic: {
        ...crawl,
        courtCodes: courts,
        callsUsed: client.calls,
        noticesRead,
        detailsRead: detailCalls,
        batchItems: batch.length,
        lastBatchAt: now.toISOString()
      }
    };
    await saveStatus(status);
    console.log(`법원경매 공개자료 증분수집 완료 · 호출 ${client.calls}/${maxCalls} · 공고 ${noticesRead}건 · 상세 ${detailCalls}건 · 신규/갱신 ${batch.length}건 · 배포 누계 ${dataset.items.length}건`);
    return dataset;
  } catch (error) {
    await saveStatus({
      ...previousStatus,
      state: previous?.items?.length ? "failed" : "error",
      attemptedAt: now.toISOString(),
      lastSuccessAt: previousStatus.lastSuccessAt || previous?.metadata?.collectedAt || null,
      itemCount: previous?.items?.length || 0,
      message: error.code === "COURT_BLOCKED"
        ? "법원경매정보 사이트가 자동 조회를 제한해 즉시 중단했습니다. 우회하지 않고 마지막 정상 자료를 유지합니다."
        : `법원경매 공개자료 수집 실패. 마지막 정상 자료 유지: ${clean(error.message,300)}`,
      courtPublic: { ...crawl, callsUsed: client.calls, lastErrorAt: now.toISOString(), lastError: clean(error.message,300) }
    });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  collectCourtPublic().catch(error => { console.error(error.message); process.exitCode = 1; });
}

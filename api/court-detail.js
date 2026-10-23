const COURT_ORIGIN = "https://www.courtauction.go.kr";
const ALLOWED_ORIGINS = new Set([
  "https://auctionhannun.designboard.net",
  "https://softm.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const clean = (value, max = 2000) => String(value ?? "")
  .replace(/<br\s*\/?\s*>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const first = (obj, keys) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
};

function ymd(value) {
  const text = clean(value, 10).replace(/[^0-9]/g, "");
  return /^\d{8}$/.test(text) ? `${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}` : "";
}

function hm(value) {
  const text = clean(value, 8).replace(/[^0-9]/g, "");
  return /^\d{3,4}$/.test(text) ? `${text.padStart(4,"0").slice(0,2)}:${text.padStart(4,"0").slice(2)}` : clean(value, 8);
}

function amount(value) {
  const match = clean(value).match(/\d{1,3}(?:,\d{3})+|\d+/);
  if (!match) return null;
  const number = Number(match[0].replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function money(value) {
  const n = amount(value);
  return n == null ? "" : `${n.toLocaleString("ko-KR")}원`;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeSchedules(result) {
  return list(result.gdsDspslDxdyLst).slice(0, 60).map((row, index) => ({
    date: ymd(first(row, ["dxdyYmd","saleYmd","dspslYmd","dspslDxdyYmd"])),
    time: hm(first(row, ["dxdyHm","saleHm","dspslHm"])),
    type: clean(first(row, ["dxdyDvsNm","dxdyTypNm","dspslDvsNm"])) || "매각기일",
    place: clean(first(row, ["dxdyPlcNm","dspslPlc","dspslPlcNm"]), 160),
    minimum: money(first(row, ["tsLwsDspslPrc","lwsDspslPrc","minmaePrice"])),
    result: clean(first(row, ["auctnDxdyRsltNm","auctnDxdyRsltCd","dspslRsltNm","dspslRsltCd","rsltNm"]), 100)
  })).filter(row => row.date || row.minimum || row.result).map((row, index) => ({ ...row, seq: index + 1 }));
}

function normalizeLots(result, fallbackAddress) {
  const rows = list(result.gdsDspslObjctLst);
  if (!rows.length) {
    const info = result.dspslGdsDxdyInfo || {};
    const details = clean(first(info, ["buldList","areaList","jimokList","dspslGdsObjctCts"]), 2000);
    return details ? [{ number: "1", type: clean(first(info, ["dspslUsgNm","usgNm"])) || "물건", address: fallbackAddress, area: clean(first(info, ["objctArDts","areaList"]),120), share: "", details }] : [];
  }
  return rows.slice(0, 100).map((row, index) => ({
    number: clean(first(row, ["dspslObjctSeq","objctSeq","seq"]),40) || String(index + 1),
    type: clean(first(row, ["dspslGdsObjctDvsNm","objctDvsNm","usgNm","dspslUsgNm"]),100),
    address: clean(first(row, ["realSt","userSt","st","bgPlaceLotAllAddr","lotAllAddr"]),300) || fallbackAddress,
    area: clean(first(row, ["objctArDts","area","areaDts","printArea"]),120),
    share: clean(first(row, ["shrRt","share","shrDts"]),120),
    details: clean(first(row, ["objctDts","objctCts","rmk","bigo","buldList"]),2000)
  })).filter(row => row.type || row.address || row.area || row.details);
}

function normalizeAppraisal(result) {
  const rows = list(result.aeeWevlMnpntLst);
  if (!rows.length) return null;
  const out = {};
  const extras = [];
  for (const row of rows.slice(0, 30)) {
    const label = clean(first(row, ["aeeWevlMnpntNm","mnpntNm","dvsNm","itemNm","title"]),120);
    const value = clean(first(row, ["aeeWevlMnpntCts","mnpntCts","ctnt","contents","itemCts","rmk"]),1800);
    if (!value) continue;
    if (/위치/.test(label)) out.location ||= value;
    else if (/교통/.test(label)) out.transport ||= value;
    else if (/주위|환경/.test(label)) out.surroundings ||= value;
    else if (/이용|현황/.test(label)) out.usage ||= value;
    else if (/구조/.test(label)) out.structure ||= value;
    else if (/설비/.test(label)) out.facilities ||= value;
    else if (/토지.*이용|공법|용도지역/.test(label)) out.landUse ||= value;
    else extras.push(label ? `${label}: ${value}` : value);
  }
  if (extras.length) out.other = clean(extras.join(" · "), 2000);
  return Object.keys(out).length ? out : null;
}

function normalizeDetail(result, requestId) {
  const base = result.csBaseInfo || {};
  const info = result.dspslGdsDxdyInfo || {};
  const dstrt = list(result.dstrtDemnInfo)[0] || {};
  const address = clean(first(info, ["realSt","userSt","st","bgPlaceLotAllAddr","lotAllAddr","convAddr"]),300);
  const appraisal = money(first(info, ["gamevalAmt","aeeEvlAmt","appraisalAmt"]));
  const minimum = money(first(info, ["minmaePrice","lwsDspslPrc","tsLwsDspslPrc"]));
  const failCount = amount(first(info, ["yuchalCnt","flbdNcnt","failCnt"]));
  const caseDetails = {
    filedAt: ymd(first(base, ["rcptYmd","csRcptYmd","rcptDt"])),
    commencedAt: ymd(first(base, ["cmdYmd","csCmdcYmd","cmdDt","auctnCmdYmd"])),
    distributionDeadline: ymd(first(dstrt, ["dstrtDemnLstprdYmd","lstprdYmd","deadlineYmd"])),
    claimAmount: money(first(base, ["clmAmt","claimAmt"]))
  };
  const schedules = normalizeSchedules(result);
  const lots = normalizeLots(result, address);
  const appraisalSummary = normalizeAppraisal(result);
  const response = {
    detailLevel: "full",
    detailFetchedAt: new Date().toISOString(),
    sourceUrl: COURT_ORIGIN + "/",
    ...(address ? { address } : {}),
    ...(appraisal ? { appraisal } : {}),
    ...(minimum ? { minimum } : {}),
    ...(failCount != null ? { rounds: `유찰 ${failCount}회` } : {}),
    ...(clean(first(info, ["dspslUsgNm","usgNm"]),120) ? { category: clean(first(info, ["dspslUsgNm","usgNm"]),120) } : {}),
    ...(clean(first(info, ["mulStatNm","statusNm","statNm"]),100) ? { status: clean(first(info, ["mulStatNm","statusNm","statNm"]),100) } : {}),
    ...(clean(first(info, ["areaList","objctArDts"]),120) ? { area: clean(first(info, ["areaList","objctArDts"]),120) } : {}),
    ...(Object.values(caseDetails).some(Boolean) ? { caseDetails } : {}),
    ...(schedules.length ? { schedules } : {}),
    ...(lots.length ? { propertyLots: lots } : {}),
    ...(appraisalSummary ? { appraisalSummary } : {})
  };
  const a = amount(response.appraisal), m = amount(response.minimum);
  if (a && m) response.ratio = `${Math.round(m / a * 1000) / 10}%`;
  return { ok: true, requestId, detail: response };
}

function setCors(req, res) {
  const origin = String(req.headers.origin || "");
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok:false, message:"GET만 지원합니다." });

  const court = clean(req.query.court, 20);
  const caseNo = clean(req.query.case, 80);
  const seq = clean(req.query.seq, 20);
  const requestId = clean(req.query.id, 180);
  if (!/^B\d{6}$/.test(court) || !/^\d{4}타경\d+$/.test(caseNo) || !/^\d+$/.test(seq)) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).json({ ok:false, message:"법원코드·사건번호·물건번호 형식이 올바르지 않습니다." });
  }

  const jar = new Map();
  const ingest = headers => {
    const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
    for (const line of values) {
      const pair = String(line).split(";")[0], at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0,at).trim(), pair.slice(at+1).trim());
    }
  };
  const cookies = () => [...jar].map(([k,v]) => `${k}=${v}`).join("; ");
  const common = {
    "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    "Accept":"application/json, text/javascript, */*; q=0.01",
    "Accept-Language":"ko-KR,ko;q=0.9,en;q=0.8",
    "Origin":COURT_ORIGIN,
    "Referer":COURT_ORIGIN + "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ15BM01.xml&pgjId=15BM01",
    "X-Requested-With":"XMLHttpRequest"
  };

  try {
    const warm = await fetch(COURT_ORIGIN + "/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ15BM01.xml&pgjId=15BM01", {
      headers: common, redirect: "manual", signal: AbortSignal.timeout(8000)
    });
    ingest(warm.headers);
    await new Promise(resolve => setTimeout(resolve, 900));

    const upstream = await fetch(COURT_ORIGIN + "/pgj/pgj15B/selectAuctnCsSrchRslt.on", {
      method:"POST",
      headers:{...common,"Content-Type":"application/json; charset=UTF-8",...(jar.size?{Cookie:cookies()}:{})},
      body:JSON.stringify({dma_srchGdsDtlSrch:{csNo:caseNo,cortOfcCd:court,dspslGdsSeq:seq,pgmId:"PGJ15BM01",srchInfo:""}}),
      redirect:"manual",
      signal:AbortSignal.timeout(12000)
    });

    if ([401,403,429].includes(upstream.status)) {
      res.setHeader("Cache-Control","no-store");
      return res.status(503).json({ok:false,message:"법원경매정보가 현재 상세 자동조회를 제한하고 있습니다. 공식 원문을 확인해 주세요."});
    }
    if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
    const payload = await upstream.json();
    if (payload?.data?.ipcheck === false) {
      res.setHeader("Cache-Control","no-store");
      return res.status(503).json({ok:false,message:"법원경매정보가 현재 상세 자동조회를 제한하고 있습니다. 우회하지 않고 중단했습니다."});
    }
    const result = payload?.data?.dma_result;
    if (!result || typeof result !== "object") throw new Error("상세 응답 구조를 확인할 수 없습니다.");

    res.setHeader("Cache-Control","public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json(normalizeDetail(result, requestId));
  } catch (error) {
    res.setHeader("Cache-Control","no-store");
    return res.status(502).json({ok:false,message:"법원 상세정보를 가져오지 못했습니다. 목록 기본정보와 공식 원문을 이용해 주세요."});
  }
}

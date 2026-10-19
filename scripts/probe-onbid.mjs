// Read-only capability check. Official spec: https://www.data.go.kr/data/15157207/openapi.do
// Do not print URL, credentials, full response, or personal data from provider errors.
import { pathToFileURL } from "node:url";

export const ONBID_LIST_URL = "https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2";

export function onbidListUrl(key, { pageNo = 1, numOfRows = 1, prptDivCd = "0007", pvctTrgtYn = "N" } = {}) {
  if (!key) throw new Error("ONBID_SERVICE_KEY 또는 DATA_GO_KR_SERVICE_KEY가 필요합니다.");
  let decoded = key.trim();
  if (/%[0-9a-f]{2}/i.test(decoded)) decoded = decodeURIComponent(decoded);
  const url = new URL(ONBID_LIST_URL);
  url.search = new URLSearchParams({ serviceKey: decoded, pageNo: String(pageNo), numOfRows: String(numOfRows), resultType: "json", prptDivCd, pvctTrgtYn, dspsMthodCd: "0001" });
  return url;
}

export async function probeOnbid(key, fetcher = fetch) {
  let response;
  try { response = await fetcher(onbidListUrl(key), { signal: AbortSignal.timeout(20000), redirect: "error", headers: { accept: "application/json" } }); }
  catch { return { state: "unreachable", message: "온비드 API 네트워크 오류 또는 리다이렉트. 키·요청 URL은 기록하지 않습니다." }; }
  const text = await response.text();
  let envelope;
  try { const json = JSON.parse(text); envelope = json.response || json; } catch {}
  const rawCode = envelope?.header?.resultCode || text.match(/<(?:resultCode|returnReasonCode)>([^<]*)</)?.[1] || "";
  const code = /^[A-Z0-9_ -]{1,50}$/i.test(String(rawCode)) ? String(rawCode) : "UNKNOWN";
  const success = response.ok && ["00", "0", "0000"].includes(code);
  const body = envelope?.body;
  const rows = Array.isArray(body?.items?.item) ? body.items.item : body?.items?.item ? [body.items.item] : [];
  return {
    state: success ? "accessible" : "not-authorized-or-provider-error", httpStatus: response.status, resultCode: code,
    ...(success ? { sampleCount: rows.length, providerTotal: Number(body?.totalCount), scope: "압류재산·매각·수의계약 불가·현재 입찰/예정, 첫 페이지 1건만 조회" } : { message: "해당 차세대 온비드 API의 활용신청 승인·서비스키·제공기관 상태 확인 필요. 재시도·인증 우회하지 않았습니다." })
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.env.ONBID_SERVICE_KEY || process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) { console.error("환경변수에 온비드 활용신청이 승인된 공공데이터 키를 설정해 주세요."); process.exitCode = 1; }
  else console.log(JSON.stringify(await probeOnbid(key), null, 2));
}

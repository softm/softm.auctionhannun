import { mapConfig } from "./map-config.js";
import { validPnu, parcelCandidates, polygonPaths, parcelError } from "./parcel-utils.js";

let sequence = 0;
const pending = new Map();

// VWorld's registered website URL includes the scheme. Send only the real origin.
export function parcelRequestUrl(path, params, clientLocation = location) {
  if (!/^https?:$/.test(clientLocation.protocol)) throw new Error("필지 조회는 HTTP 미리보기에서 사용해 주세요.");
  const localPreview = ["localhost", "127.0.0.1", "[::1]"].includes(clientLocation.hostname);
  if (!localPreview && clientLocation.origin !== mapConfig.vworldServiceOrigin) {
    throw new Error(`VWorld 필지 조회는 등록된 운영 주소(${mapConfig.vworldServiceOrigin})에서 사용해 주세요.`);
  }
  const url = new URL(path, "https://api.vworld.kr");
  url.search = new URLSearchParams({ ...params, key: mapConfig.vworldKey, domain: clientLocation.origin });
  return url;
}

// VWorld's supported JSONP transport; actual origin only, never a forged domain.
function request(path, params, signal) {
  if (!/^https?:$/.test(location.protocol)) return Promise.reject(new Error("필지 조회는 HTTP 미리보기에서 사용해 주세요."));
  if (signal?.aborted) return Promise.reject(new DOMException("취소됨", "AbortError"));
  return new Promise((resolve, reject) => {
    const callback = `auctionParcel_${Date.now()}_${++sequence}`;
    const url = parcelRequestUrl(path, { ...params, callback });
    const script = document.createElement("script");
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.remove();
      signal?.removeEventListener("abort", abort);
      // A late JSONP response must not call a deleted callback.
      window[callback] = () => {};
      setTimeout(() => { delete window[callback]; }, 60000);
      if (error) reject(error); else resolve(data);
    };
    const abort = () => finish(new DOMException("취소됨", "AbortError"));
    const timer = setTimeout(() => finish(new Error("VWorld 조회 시간 초과. 등록 도메인과 네트워크를 확인해 주세요.")), 12000);
    window[callback] = data => finish(null, data);
    script.onerror = () => finish(new Error("VWorld 연결 실패"));
    script.src = url.href;
    signal?.addEventListener("abort", abort, { once: true });
    document.head.append(script);
  });
}

export async function searchParcels(address, signal) {
  const query = String(address).normalize("NFKC").trim();
  if (query.length < 2 || query.length > 180) throw new Error("조회할 소재지를 확인해 주세요.");
  const results = await Promise.all(["parcel", "road"].map(async category => parcelCandidates(await request("/req/search", {
    service: "search", request: "search", version: "2.0", crs: "EPSG:4326", size: "10", page: "1",
    query, type: "address", category, format: "json"
  }, signal))));
  return [...new Map(results.flat().map(item => [item.pnu, item])).values()];
}

export function loadParcel(pnu) {
  if (!validPnu(pnu)) return Promise.reject(new Error("확인된 19자리 필지고유번호가 필요합니다."));
  if (pending.has(pnu)) return pending.get(pnu);
  const task = (async () => {
    for (const dataset of ["LP_PA_CBND_BUBUN", "LP_PA_CBND_BONBUN"]) {
      const data = await request("/req/data", {
        service: "data", request: "GetFeature", version: "2.0", data: dataset,
        attrFilter: `pnu:=:${pnu}`, size: "10", page: "1", format: "json",
        geometry: "true", attribute: "true", crs: "EPSG:4326"
      });
      if (data?.response?.status === "NOT_FOUND") continue;
      if (data?.response?.status !== "OK") throw new Error(parcelError(data));
      const feature = data.response.result?.featureCollection?.features?.find(value => String(value.properties?.pnu) === pnu);
      if (feature && polygonPaths(feature.geometry).length) return feature;
    }
    throw new Error("선택한 PNU와 일치하는 필지 경계가 없습니다.");
  })();
  pending.set(pnu, task);
  task.catch(() => pending.delete(pnu));
  return task;
}

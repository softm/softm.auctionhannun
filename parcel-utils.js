export function validCoordinate(value) {
  return Boolean(value && typeof value.latitude === "number" && typeof value.longitude === "number" &&
    Number.isFinite(value.latitude) && Number.isFinite(value.longitude) &&
    value.latitude >= 33 && value.latitude <= 39 && value.longitude >= 124 && value.longitude <= 132);
}

export function validPnu(value) {
  return typeof value === "string" && /^\d{10}[12]\d{8}$/.test(value) && Number(value.slice(11, 15)) > 0;
}

export function parcelError(payload) {
  const code = String(payload?.response?.error?.code || "");
  if (code === "INCORRECT_KEY") return "VWorld 인증키가 거부되었습니다 (INCORRECT_KEY). 발급 키의 유효성·서비스 URL·데이터 API 사용 설정을 확인해야 합니다.";
  const suffix = /^[A-Z0-9_]{1,50}$/.test(code) ? ` (${code})` : "";
  return `VWorld 응답 오류${suffix}. 필지 제공 범위·키·등록 도메인·이용 한도를 확인해 주세요.`;
}

export function eumUrl(pnu) {
  if (!validPnu(pnu)) return null;
  const url = new URL("https://www.eum.go.kr/web/ar/lu/luLandDet.jsp");
  url.search = new URLSearchParams({
    mode: "search", pnu, add: "land", isNoScr: "script", s_type: "1", selGbn: "umd",
    landGbn: pnu[10], bobn: String(Number(pnu.slice(11, 15))), bubn: String(Number(pnu.slice(15)))
  });
  return url.href;
}

// A building/address point is not a parcel boundary. Only genuine Polygon data is drawn.
export function polygonPaths(geometry) {
  const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
    : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
  if (!Array.isArray(polygons) || polygons.length > 100) throw new Error("필지 경계 형식 오류");
  return polygons.map(rings => {
    if (!Array.isArray(rings) || !rings.length) throw new Error("필지 경계가 없습니다.");
    return rings.map(ring => {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > 20000) throw new Error("필지 경계 좌표 오류");
      const points = ring.map(point => {
        const position = { longitude: point?.[0], latitude: point?.[1] };
        if (!validCoordinate(position)) throw new Error("국내 좌표가 아닌 필지 경계입니다.");
        return position;
      });
      if (points[0].latitude !== points.at(-1).latitude || points[0].longitude !== points.at(-1).longitude) throw new Error("닫히지 않은 필지 경계입니다.");
      return points;
    });
  });
}

export function parcelCandidates(payload) {
  if (payload?.response?.status === "NOT_FOUND") return [];
  if (payload?.response?.status !== "OK") throw new Error(parcelError(payload));
  return (payload.response.result?.items || []).flatMap(item => {
    const position = { latitude: Number(item.point?.y), longitude: Number(item.point?.x) };
    if (!validPnu(String(item.id)) || !validCoordinate(position)) return [];
    return [{ pnu: String(item.id), address: item.address?.parcel || item.address?.road || item.title || "필지", roadAddress: item.address?.road || "", ...position }];
  });
}

const normalizeAddress = value => String(value || "").normalize("NFKC").replace(/[‐‑–−]/g, "-").replace(/\s+/g, " ").trim();

// Remove building/floor labels, but never collapse several land parcels into one.
export function parcelAddressParts(address) {
  const text = normalizeAddress(address);
  const parcel = text.match(/^(.+?(?:동|가|읍|면|리))\s+(산\s*)?(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?=$|[\s,(])/);
  const road = !parcel && text.match(/^(.+?(?:로|길))\s+(\d{1,4})(?:\s*-\s*(\d{1,4}))?(?=$|[\s,(])/);
  const match = parcel || road;
  if (!match) return { query: text, kind: null, key: null, multiple: false };
  const tail = text.slice(match[0].length);
  const multiple = /외\s*\d+\s*필지|(?:동|가|읍|면|리)\s+(?:산\s*)?\d/.test(tail) || /(?:^|[,;\s])(?:산\s*)?\d+(?:-\d+)?\s*(?=$|[,;(])/.test(tail);
  const main = Number(parcel ? parcel[3] : road[2]);
  const sub = Number((parcel ? parcel[4] : road[3]) || 0);
  const mountain = Boolean(parcel?.[2]);
  const query = `${match[1]} ${mountain ? "산 " : ""}${main}${sub ? `-${sub}` : ""}`;
  return { query: multiple ? text : query, key: query, kind: parcel ? "parcel" : "road", mountain, main, sub, multiple };
}

export function selectParcelCandidate(address, candidates, { allowPrimary = false } = {}) {
  const target = parcelAddressParts(address);
  if (target.multiple && (!allowPrimary || target.kind !== "parcel")) throw new Error("여러 필지가 포함된 소재지입니다. 상세 화면에서 필지를 확인·선택해 주세요. 한 필지를 전체 경매 범위로 표시하지 않습니다.");
  const exact = candidates.filter(candidate => {
    if (!validPnu(candidate.pnu) || !target.key) return false;
    const actual = parcelAddressParts(target.kind === "road" ? candidate.roadAddress : candidate.address);
    if (actual.kind !== target.kind || actual.key !== target.key || actual.multiple) return false;
    // Cross-check the land/mountain flag and lot number against the returned PNU.
    return target.kind === "road" || (candidate.pnu[10] === (target.mountain ? "2" : "1") && Number(candidate.pnu.slice(11, 15)) === target.main && Number(candidate.pnu.slice(15)) === target.sub);
  });
  const unique = [...new Map(exact.map(candidate => [candidate.pnu, candidate])).values()];
  if (unique.length !== 1) throw new Error(unique.length ? "동일 주소의 필지가 여러 개입니다. 상세 화면에서 정확한 필지를 선택해 주세요." : "소재지의 지번·산 여부와 정확히 일치하는 필지가 없습니다. 상세 화면에서 후보를 확인해 주세요.");
  return target.multiple ? { ...unique[0], partial: true } : unique[0];
}

export function parcelScopeMessage(address, displayedAddress) {
  if (!parcelAddressParts(address).multiple) return "";
  return `일부 필지만 표시: ${displayedAddress || "확인된 1필지"} · 다른 필지 미확인 · 전체 경매 범위가 아닙니다.`;
}

export function parcelFeature(payload, pnu) {
  if (payload?.response?.status === "NOT_FOUND") throw new Error("VWorld에 해당 PNU의 경계 데이터가 없습니다. 분할·합병·행정구역 변경 여부를 원문에서 확인해 주세요.");
  if (payload?.response?.status !== "OK") throw new Error(parcelError(payload));
  const feature = payload.response.result?.featureCollection?.features?.find(value => String(value.properties?.pnu) === pnu);
  if (!feature || !polygonPaths(feature.geometry).length) throw new Error("선택한 PNU와 일치하는 유효한 필지 경계가 없습니다.");
  return feature;
}

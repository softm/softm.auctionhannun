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
    return [{ pnu: String(item.id), address: item.address?.parcel || item.address?.road || item.title || "필지", ...position }];
  });
}

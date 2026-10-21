import { mapConfig } from "./map-config.js";
import { validCoordinate, polygonPaths } from "./parcel-utils.js";
import { VWorldMap } from "./vworld-map.js";

let sdkTask;
export function loadMapSdk() {
  if (window.naver?.maps?.Service) return Promise.resolve(window.naver.maps);
  if (sdkTask) return sdkTask;
  sdkTask = new Promise((resolve, reject) => {
    if (!/^https?:$/.test(location.protocol)) { reject(new Error("file://에서는 지도를 인증할 수 없습니다. npm start 후 http://localhost:3000 에서 열어 주세요.")); return; }
    const script = document.createElement("script");
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete window.auctionMapReady;
      if (error) { script.remove(); reject(error); } else resolve(window.naver.maps);
    };
    const timer = setTimeout(() => finish(new Error("네이버 지도 응답이 없습니다. 네트워크와 등록 도메인을 확인해 주세요.")), 15000);
    window.navermap_authFailure = () => finish(new Error("네이버 지도 인증 실패: 현재 도메인을 Maps 애플리케이션에 등록해야 합니다."));
    window.auctionMapReady = () => finish();
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(mapConfig.naverKeyId)}&submodules=geocoder&callback=auctionMapReady`;
    script.onerror = () => finish(new Error("네이버 지도 SDK 연결 실패"));
    document.head.append(script);
  }).catch(error => { sdkTask = null; throw error; });
  return sdkTask;
}

// SOFTM-MAP-QUEUE 20261019: 돌봄한눈의 동시 요청 제한·성공 캐시·실패 재시도 구조를 적용.
export function createGeocoder(maps, storage = window.localStorage) {
  const pending = new Map();
  const queue = [];
  let active = 0;
  function drain() {
    while (active < mapConfig.geocodeConcurrency && queue.length) {
      active++;
      const { query, resolve, reject } = queue.shift();
      let finished = false;
      const done = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        active--;
        if (error) reject(error); else resolve(result);
        drain();
      };
      const timer = setTimeout(() => done(new Error("주소 확인 시간 초과")), 10000);
      try {
        maps.Service.geocode({ query }, (status, response) => {
          const addresses = response?.v2?.addresses || [];
          if (status !== maps.Service.Status.OK) { done(new Error("주소 확인 실패: Geocoding 사용 설정·한도를 확인해 주세요.")); return; }
          if (addresses.length !== 1 || Number(response?.v2?.meta?.totalCount || addresses.length) !== 1) {
            done(new Error(addresses.length ? "주소 후보가 여러 개입니다. 지번 또는 도로명·건물번호를 정확히 입력해 주세요." : "일치하는 주소가 없습니다.")); return;
          }
          const row = addresses[0];
          const result = { latitude: Number(row.y), longitude: Number(row.x), address: row.jibunAddress || row.roadAddress, source: "naver-geocode", checkedAt: new Date().toISOString() };
          done(validCoordinate(result) ? null : new Error("유효한 국내 좌표가 없습니다."), result);
        });
      } catch (error) { done(error); }
    }
  }
  return function geocode(address) {
    const query = String(address || "").normalize("NFKC").replace(/\s+/g, " ").trim();
    // Do not geocode an administrative region as if it were a property location.
    if (!/\d/.test(query)) return Promise.reject(new Error("지번 또는 건물번호가 있는 소재지가 필요합니다."));
    const key = `auctionhannun:geocode:v1:${query}`;
    if (pending.has(query)) return pending.get(query);
    try {
      const cached = JSON.parse(storage.getItem(key));
      if (validCoordinate(cached) && Date.now() - Date.parse(cached.checkedAt) < 7 * 86400000) return Promise.resolve(cached);
    } catch {}
    const task = new Promise((resolve, reject) => { queue.push({ query, resolve, reject }); drain(); }).then(result => {
      try { storage.setItem(key, JSON.stringify(result)); } catch {}
      return result;
    });
    pending.set(query, task);
    task.finally(() => pending.delete(query)).catch(() => {});
    return task;
  };
}

export class AuctionMap {
  constructor(element, onSelect, vworldElement, onStatus = () => {}) {
    this.element = element;
    this.onSelect = onSelect;
    this.items = [];
    this.positions = new Map();
    this.markers = new Map();
    this.polygons = [];
    this.vworldElement = vworldElement;
    this.onStatus = onStatus;
    this.mode = "normal";
  }
  async ready() {
    if (this.map) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      this.maps = await loadMapSdk();
      this.map = new this.maps.Map(this.element, { center: new this.maps.LatLng(36.3, 127.8), zoom: 7, minZoom: 6, mapTypeControl: true, mapTypeControlOptions: { position: this.maps.Position.TOP_LEFT } });
      this.geocode = createGeocoder(this.maps);
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.element);
      this.render(this.items, this.selectedId);
    })().catch(error => { this.starting = null; throw error; });
    return this.starting;
  }
  position(item) { return validCoordinate(item.location) ? item.location : this.positions.get(item.id); }
  resize() {
    this.vworld?.resize();
    if (this.map && this.element.clientWidth && this.element.clientHeight) this.map.setSize(new this.maps.Size(this.element.clientWidth, this.element.clientHeight));
  }
  render(items, selectedId) {
    this.items = items;
    this.selectedId = selectedId;
    this.vworld?.render(items, selectedId, item => this.position(item));
    if (!this.map) return;
    for (const marker of this.markers.values()) { this.maps.Event.clearInstanceListeners(marker); marker.setMap(null); }
    this.markers.clear();
    const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => Number(b.item.id === selectedId) - Number(a.item.id === selectedId));
    for (const { item, index } of ordered) {
      if (this.markers.size >= 500) break;
      const position = this.position(item);
      if (!validCoordinate(position)) continue;
      const marker = new this.maps.Marker({
        map: this.map, position: new this.maps.LatLng(position.latitude, position.longitude), title: item.title,
        icon: { content: `<button type="button" class="map-pin${item.id === selectedId ? " active" : ""}">${index + 1}</button>`, anchor: new this.maps.Point(20, 40) }
      });
      this.maps.Event.addListener(marker, "click", () => this.onSelect(item.id));
      this.markers.set(item.id, marker);
    }
  }
  async locate(item) {
    await this.ready();
    let position = this.position(item);
    if (!validCoordinate(position)) {
      position = await this.geocode(item.address);
      // A pending lookup must not restore stale coordinates after an edit/deletion.
      if (this.items.some(current => current.id === item.id && current.address === item.address)) this.positions.set(item.id, position);
    }
    return position;
  }
  focus(position) { if (this.map && validCoordinate(position)) { this.clearParcel(); this.map.setCenter(new this.maps.LatLng(position.latitude, position.longitude)); this.map.setZoom(17); if (this.mode !== "normal" || this.cadastralEnabled) this.vworld.focus(position); } }
  fit() {
    if (!this.map) return;
    this.clearParcel();
    const positions = this.items.map(item => this.position(item)).filter(validCoordinate);
    if (this.mode !== "normal" || this.cadastralEnabled) { this.vworld.fit(positions); return; }
    if (!positions.length) { this.map.setCenter(new this.maps.LatLng(36.3, 127.8)); this.map.setZoom(7); return; }
    if (positions.length === 1) { this.focus(positions[0]); return; }
    const bounds = new this.maps.LatLngBounds();
    positions.forEach(pos => bounds.extend(new this.maps.LatLng(pos.latitude, pos.longitude)));
    this.map.fitBounds(bounds, { top: 60, right: 60, bottom: 60, left: 60 });
  }
  async setMode(mode, isCurrent = () => true) {
    await this.ready();
    if (!isCurrent()) return false;
    if (mode !== "normal") {
      if (!this.vworldElement) throw new Error("VWorld 지도 영역이 없습니다.");
      this.vworld ||= new VWorldMap(this.vworldElement, this.onSelect, this.onStatus);
      await this.vworld.ready();
      if (!isCurrent()) return false;
      const center = this.map.getCenter();
      this.vworld.setMode(mode);
      this.vworld.activate({ latitude: center.lat(), longitude: center.lng() }, this.map.getZoom());
      this.element.hidden = true; this.mode = mode; this.cadastralEnabled = mode === "cadastral";
      this.vworld.render(this.items, this.selectedId, item => this.position(item));
    } else if (this.mode !== "normal" || this.cadastralEnabled) {
      const center = this.vworld.center(), zoom = this.vworld.zoomLevel();
      this.vworldElement.hidden = true; this.element.hidden = false; this.mode = "normal"; this.cadastralEnabled = false;
      this.resize(); this.map.setCenter(new this.maps.LatLng(center.latitude, center.longitude)); this.map.setZoom(zoom);
    }
    return true;
  }
  setCadastral(enabled, isCurrent = () => true) { return this.setMode(enabled ? "cadastral" : "normal", isCurrent); }
  zoom(delta) { if (this.mode !== "normal" || this.cadastralEnabled) this.vworld.zoom(delta); else if (this.map) this.map.setZoom(this.map.getZoom() + delta); }
  clearParcel() { this.vworld?.clearParcel(); this.polygons.forEach(polygon => polygon.setMap(null)); this.polygons = []; }
  async showParcel(feature, isCurrent = () => true) {
    if (!await this.setMode("cadastral", isCurrent) || !isCurrent()) return false;
    const paths = polygonPaths(feature.geometry);
    this.clearParcel();
    if (!paths.length) return false;
    this.vworld.showParcel(feature);
    return true;
  }
}

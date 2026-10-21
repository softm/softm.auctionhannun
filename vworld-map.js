import { parcelRequestUrl } from "./parcel-api.js";
import { validCoordinate } from "./parcel-utils.js";

let sdkTask;
export function cadastralSourceUrl(clientLocation) {
  return parcelRequestUrl("/req/wms", {}, clientLocation).href;
}
export const cadastralParams = Object.freeze({ LAYERS: "lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun", STYLES: "lp_pa_cbnd_bonbun,lp_pa_cbnd_bubun", FORMAT: "image/png", TRANSPARENT: true, VERSION: "1.3.0" });
function loadOpenLayers() {
  if (window.ol) return Promise.resolve(window.ol);
  if (sdkTask) return sdkTask;
  sdkTask = new Promise((resolve, reject) => {
    const script = document.createElement("script"), style = document.createElement("link");
    style.rel = "stylesheet"; style.href = "https://cdn.jsdelivr.net/npm/ol@10.6.1/ol.css";
    script.src = "https://cdn.jsdelivr.net/npm/ol@10.6.1/dist/ol.js";
    let settled = false;
    const finish = error => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) { script.remove(); style.remove(); reject(error); } else resolve(window.ol);
    };
    const timer = setTimeout(() => finish(new Error("VWorld 지도 엔진 응답 시간이 초과되었습니다.")), 15000);
    script.onload = () => finish(window.ol ? null : new Error("지도 엔진을 초기화하지 못했습니다."));
    script.onerror = () => finish(new Error("VWorld 지도 엔진을 불러오지 못했습니다. 다시 시도해 주세요."));
    document.head.append(style, script);
  }).catch(error => { sdkTask = null; throw error; });
  return sdkTask;
}

// 토지한눈의 OpenLayers + VWorld XYZ/TileWMS 구성을 사용한다.
// Keys are this app's own key and real origin, never the reference app's credentials.
export class VWorldMap {
  constructor(element, onSelect, onStatus) { this.element = element; this.onSelect = onSelect; this.onStatus = onStatus; }
  async ready() {
    if (this.map) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const url = cadastralSourceUrl();
      const ol = this.ol = await loadOpenLayers();
      const base = new ol.source.XYZ({ url: "https://xdworld.vworld.kr/2d/Base/service/{z}/{x}/{y}.png", maxZoom: 19, attributions: "© VWorld", transition: 0 });
      const satellite = new ol.source.XYZ({ url: "https://xdworld.vworld.kr/2d/Satellite/service/{z}/{x}/{y}.jpeg", maxZoom: 19, attributions: "© VWorld", transition: 0 });
      const hybrid = new ol.source.XYZ({ url: "https://xdworld.vworld.kr/2d/Hybrid/service/{z}/{x}/{y}.png", maxZoom: 19, attributions: "© VWorld", transition: 0 });
      this.cadastral = new ol.source.TileWMS({ url, params: { ...cadastralParams }, transition: 0 });
      this.markers = new ol.source.Vector(); this.parcels = new ol.source.Vector();
      this.markerLayer = new ol.layer.Vector({ source: this.markers, zIndex: 20 });
      this.baseLayer = new ol.layer.Tile({ source: base, visible: false });
      this.satelliteLayer = new ol.layer.Tile({ source: satellite, visible: true });
      this.hybridLayer = new ol.layer.Tile({ source: hybrid, visible: false });
      this.cadastralLayer = new ol.layer.Tile({ source: this.cadastral, opacity: .88, minZoom: 15, preload: 0, useInterimTilesOnError: false });
      this.map = new ol.Map({ target: this.element, controls: ol.control.defaults.defaults({ zoom: false, rotate: false }), layers: [
        this.baseLayer, this.satelliteLayer, this.hybridLayer, this.cadastralLayer,
        new ol.layer.Vector({ source: this.parcels, zIndex: 18, style: [
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: "rgba(255,255,255,.96)", width: 8 }) }),
          new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#f51d76", width: 4 }), fill: new ol.style.Fill({ color: "rgba(245,29,118,.2)" }) })
        ] }), this.markerLayer
      ], view: new ol.View({ center: ol.proj.fromLonLat([127.8, 36.3]), zoom: 7, minZoom: 6, maxZoom: 19, constrainResolution: true }) });
      [base, satellite].forEach(source => source.on("tileloaderror", () => this.status("VWorld 배경지도 연결 실패 · 네트워크를 확인하세요.")));
      this.cadastral.on("tileloaderror", () => { this.failed = true; this.status("VWorld 지적도 연결 실패 · 인증키·등록 도메인·서비스 한도를 확인하세요. 지적도 버튼을 껐다 켜면 재시도합니다."); });
      // Background tile success must not overwrite a selected-parcel result/error.
      this.map.on("moveend", () => { if (this.map.getView().getZoom() < 16) this.status("VWorld 지도 · 지적도는 확대 레벨 16 이상에서 표시됩니다. 물건을 선택하거나 확대해 주세요."); });
      this.map.on("singleclick", event => { const hit = this.map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: layer => layer === this.markerLayer }); if (hit) this.onSelect(hit.get("caseId")); });
    })().catch(error => { this.starting = null; throw error; });
    return this.starting;
  }
  status(text) { if (!this.element.hidden) this.onStatus(text); }
  activate(center, zoom) {
    this.element.hidden = false; this.failed = false; this.map.updateSize();
    this.map.getView().setCenter(this.ol.proj.fromLonLat([center.longitude, center.latitude]));
    this.map.getView().setZoom(Math.min(19, zoom)); this.cadastral.refresh();
    this.status(zoom < 16 ? "VWorld 지도 · 지적도는 확대 레벨 16 이상에서 표시됩니다. 물건을 선택하거나 확대해 주세요." : "VWorld 연속지적도 불러오는 중…");
  }
  setMode(mode) {
    this.mode = mode;
    this.baseLayer.setVisible(mode === "normal");
    this.satelliteLayer.setVisible(mode !== "normal");
    this.hybridLayer.setVisible(mode === "satellite");
    this.cadastralLayer.setVisible(mode === "cadastral");
    this.map.render();
  }
  center() { const [longitude, latitude] = this.ol.proj.toLonLat(this.map.getView().getCenter()); return { longitude, latitude }; }
  zoomLevel() { return this.map.getView().getZoom(); }
  resize() { this.map?.updateSize(); }
  render(items, selectedId, positionOf) {
    if (!this.map) return;
    this.markers.clear();
    // Keep the selected marker even beyond the normal marker limit.
    const visible = [...items].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
    for (const item of visible) {
      if (this.markers.getFeatures().length >= 500) break;
      const point = positionOf(item); if (!validCoordinate(point)) continue;
      const feature = new this.ol.Feature({ geometry: new this.ol.geom.Point(this.ol.proj.fromLonLat([point.longitude, point.latitude])), caseId: item.id });
      feature.setStyle(new this.ol.style.Style({ image: new this.ol.style.Circle({ radius: item.id === selectedId ? 11 : 8, fill: new this.ol.style.Fill({ color: item.id === selectedId ? "#17324d" : "#0f766e" }), stroke: new this.ol.style.Stroke({ color: "white", width: 3 }) }) }));
      this.markers.addFeature(feature);
    }
  }
  focus(position) { const view = this.map.getView(); view.setCenter(this.ol.proj.fromLonLat([position.longitude, position.latitude])); view.setZoom(17); }
  zoom(delta) { this.map.getView().setZoom(this.map.getView().getZoom() + delta); }
  fit(positions) {
    if (!positions.length) { this.map.getView().setCenter(this.ol.proj.fromLonLat([127.8, 36.3])); this.map.getView().setZoom(7); return; }
    if (positions.length === 1) return this.focus(positions[0]);
    this.map.getView().fit(this.ol.extent.boundingExtent(positions.map(p => this.ol.proj.fromLonLat([p.longitude, p.latitude]))), { padding: [50, 50, 50, 50], maxZoom: 17 });
  }
  clearParcel() { this.parcels?.clear(); }
  showParcel(feature) { this.clearParcel(); const shape = new this.ol.format.GeoJSON().readFeature(feature, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }); this.parcels.addFeature(shape); this.map.getView().fit(shape.getGeometry(), { padding: [50, 50, 50, 50], maxZoom: 19 }); }
}

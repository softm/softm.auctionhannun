const cache = new Map();
export function createDataLoader(fetcher = fetch) {
  const loads = new Map();
  return function load(url, { fresh = false } = {}) {
    if (!fresh && loads.has(url)) return loads.get(url);
    const task = (async () => {
      const response = await fetcher(url, { cache: fresh ? "no-store" : "no-cache" });
      if (!response.ok) throw new Error(`자료 응답 오류 HTTP ${response.status}`);
      let bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined") throw new Error("압축 자료를 읽으려면 브라우저 / Android System WebView를 업데이트해 주세요.");
        bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    })();
    if (!fresh) { loads.set(url, task); task.catch(() => loads.delete(url)); }
    return task;
  };
}
const load = createDataLoader();

export function safeDataPath(path, kind) {
  return typeof path === "string" && (kind === "catalog" ? /^catalog\/[a-f0-9]{64}\.json\.gz$/ : /^details\/[a-f0-9]{64}\.json$/).test(path);
}

export async function loadCatalog(base = "./data", kind = "court") {
  const manifest = await load(`${base}/manifest.json`, { fresh: true });
  if (![2, 3].includes(manifest.schemaVersion) || manifest.demo !== false || !safeDataPath(manifest.catalogFile, "catalog")) throw new Error("운영 자료 매니페스트 오류");
  const catalog = await load(`${base}/${manifest.catalogFile}`);
  if (!Array.isArray(catalog.items) || catalog.items.length !== manifest.itemCount || new Set(catalog.items.map(item => item.id)).size !== catalog.items.length) throw new Error("검색 자료 건수·중복 검증 실패");
  if (catalog.items.some(item => item.demo || !safeDataPath(item.detailFile, "detail"))) throw new Error("운영 목록에 예시 또는 잘못된 상세 경로가 포함되었습니다.");
  if (catalog.items.some(item => item.auctionKind !== kind)) throw new Error("법원경매와 온비드 자료의 구분이 일치하지 않습니다.");
  return { metadata: manifest, items: catalog.items.map(item => ({ ...item, dataBase: base })) };
}

export async function loadDetail(item) {
  if (item.userAdded || !item.detailFile) return item;
  if (!safeDataPath(item.detailFile, "detail")) throw new Error("상세 경로 오류");
  const base = item.auctionKind === "onbid" ? "./data/onbid" : "./data";
  const detail = await load(`${base}/${item.detailFile}`);
  if (detail.id !== item.id || detail.demo) throw new Error("상세 물건 식별자 오류");
  cache.set(item.id, detail);
  return detail;
}
export const cachedDetail = id => cache.get(id);
export const loadCollectionStatus = (base = "./data") => load(`${base}/collection-status.json`, { fresh: true });

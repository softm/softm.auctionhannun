import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeDataset } from "./collect-auctions.mjs";
import { safeDataPath } from "../auction-data.js";

export async function validateData(dataDir = "data") {
const dataset = JSON.parse(await readFile(resolve(dataDir, "auctions.json"), "utf8"));
const normalized = normalizeDataset(dataset, dataset);
const actualHash = createHash("sha256").update(JSON.stringify(normalized.items)).digest("hex");
if (dataset.metadata?.contentHash !== actualHash) throw new Error("data/auctions.json contentHash가 일치하지 않습니다.");
if (dataset.metadata?.itemCount !== normalized.items.length) throw new Error("data/auctions.json itemCount가 일치하지 않습니다.");
if (dataset.metadata.demo !== false || dataset.items.some(item => item.demo)) throw new Error("운영 자료에 예시가 있습니다.");
const manifest = JSON.parse(await readFile(resolve(dataDir, "manifest.json"), "utf8"));
if (manifest.schemaVersion !== 2 || !safeDataPath(manifest.catalogFile, "catalog")) throw new Error("매니페스트 경로 오류");
if (manifest.contentHash !== actualHash || manifest.itemCount !== dataset.items.length || manifest.demo !== false) throw new Error("매니페스트가 원본과 일치하지 않습니다.");
const catalog = JSON.parse(gunzipSync(await readFile(resolve(dataDir, manifest.catalogFile))));
const catalogHash = createHash("sha256").update(JSON.stringify(catalog.items)).digest("hex");
if (catalogHash !== manifest.catalogHash || catalog.items.length !== manifest.itemCount) throw new Error("검색 인덱스 해시·건수 오류");
if (new Set(catalog.items.map(item => item.id)).size !== catalog.items.length) throw new Error("검색 인덱스 중복");
const expected = new Map(dataset.items.map(item => [item.id, item]));
for (const item of catalog.items) {
  if (!safeDataPath(item.detailFile, "detail")) throw new Error("상세 경로 오류");
  const detail = JSON.parse(await readFile(resolve(dataDir, item.detailFile), "utf8"));
  const detailHash = createHash("sha256").update(JSON.stringify(detail)).digest("hex");
  if (item.detailFile !== `details/${detailHash}.json` || JSON.stringify(expected.get(item.id)) !== JSON.stringify(detail)) throw new Error("상세 데이터가 원본과 일치하지 않습니다.");
  const { occupancy, ratio, rounds, category, ...summary } = detail;
  if (JSON.stringify(item) !== JSON.stringify({ ...summary, detailFile: item.detailFile })) throw new Error("검색 목록과 상세 자료가 다릅니다.");
}
return { manifest, catalog, count: normalized.items.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await validateData();
  const onbid = await validateData("data/onbid");
  if (onbid.manifest.datasetKind !== "onbid-public-sale" || onbid.catalog.items.some(item => item.auctionKind !== "onbid")) throw new Error("온비드 데이터 종류 오류");
  console.log(`법원경매 ${result.count}건 / 온비드 공매 ${onbid.count}입찰건 검증 완료`);
}

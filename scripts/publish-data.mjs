import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function publishDataset(dataset, dataDir = "data") {
  await mkdir(resolve(dataDir, "catalog"), { recursive: true });
  await mkdir(resolve(dataDir, "details"), { recursive: true });
  const items = [];
  for (const item of dataset.items) {
    const detailFile = `details/${hash(item)}.json`;
    await writeFile(resolve(dataDir, detailFile), `${JSON.stringify(item)}\n`);
    const { occupancy, ratio, rounds, category, caseDetails, schedules, propertyLots, appraisalSummary, documents, tenancySummary, assetDetails, ...summary } = item;
    items.push({ ...summary, detailFile });
  }
  const catalogHash = hash(items);
  const catalogFile = `catalog/${catalogHash}.json.gz`;
  await writeFile(resolve(dataDir, catalogFile), gzipSync(JSON.stringify({ items })));
  // Write the manifest last. All content-addressed files already exist when readers see it.
  const manifest = { ...dataset.metadata, status: dataset.items.length ? "ready" : "empty", catalogFile, catalogHash };
  for (const [name, value] of [["auctions.json", dataset], ["manifest.json", manifest]]) {
    const path = resolve(dataDir, name);
    await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    await rename(`${path}.tmp`, path);
  }
  return manifest;
}

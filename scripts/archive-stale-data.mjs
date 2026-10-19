// Recoverable cleanup of generated, unreferenced files; never remove a whole directory.
import { readFile, readdir, mkdir, rename } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
for (const base of ["data", "data/onbid"]) {
  const manifest = JSON.parse(await readFile(`${base}/manifest.json`, "utf8"));
  const catalog = JSON.parse(gunzipSync(await readFile(`${base}/${manifest.catalogFile}`)));
  const active = new Set([manifest.catalogFile, ...catalog.items.map(item => item.detailFile)]);
  let count = 0;
  for (const directory of ["catalog", "details"]) {
    for (const entry of await readdir(`${base}/${directory}`, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json(?:\.gz)?$/.test(entry.name) || active.has(path)) continue;
      const destination = `source-data/obsolete-published/${base}/${directory}`;
      await mkdir(destination, { recursive: true });
      await rename(`${base}/${path}`, `${destination}/${entry.name}`);
      count++;
    }
  }
  console.log(`${base}: 미참조 생성물 ${count}개를 비공개 source-data/obsolete-published로 보관`);
}

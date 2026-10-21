import { cp, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { validateData } from "./validate-data.mjs";

const { manifest, catalog } = await validateData();
const onbid = await validateData("data/onbid");
for (let attempt = 0; attempt < 3; attempt += 1) {
  try {
    await rm("dist", { recursive: true, force: true, maxRetries: 2, retryDelay: 50 });
    break;
  } catch (error) {
    if (error?.code !== "ENOTEMPTY" || attempt === 2) throw error;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
await mkdir("dist/data", { recursive: true });
await mkdir("dist/assets", { recursive: true });
await Promise.all([
  cp("index.html", "dist/index.html"),
  cp("privacy.html", "dist/privacy.html"),
  ...["account.css", "workspace-store.js", "cloud-workspace.js", "social-config.js", "auth-callback.html", "auth-callback.js"].map(file => cp(file, `dist/${file}`)),
  ...["firebase-config.js", "account.js", "adfit-config.js", "adfit.js"].map(file => cp(file, `dist/${file}`)),
  ...["data-status.html", "data-status.css", "data-status.js"].map(file => cp(file, `dist/${file}`)),
  cp("manifest.webmanifest", "dist/manifest.webmanifest"),
  cp("styles.css", "dist/styles.css"),
  cp("app.js", "dist/app.js"),
  cp("auction-utils.js", "dist/auction-utils.js"),
  cp("case-editor.js", "dist/case-editor.js"),
  cp("list-map-sync.js", "dist/list-map-sync.js"),
  ...["auction-data.js", "auction-map.js", "vworld-map.js", "parcel-api.js", "parcel-utils.js", "map-config.js"].map(file => cp(file, `dist/${file}`)),
  cp("assets/app-icon.svg", "dist/assets/app-icon.svg"),
  ...["auctions.json", "manifest.json", "collection-status.json"].map(file => cp(`data/${file}`, `dist/data/${file}`)),
  cp("robots.txt", "dist/robots.txt"),
  cp("sitemap.xml", "dist/sitemap.xml")
]);
for (const file of [manifest.catalogFile, ...catalog.items.map(item => item.detailFile)]) {
  await mkdir(dirname(`dist/data/${file}`), { recursive: true });
  await cp(`data/${file}`, `dist/data/${file}`);
}
for (const file of ["auctions.json", "manifest.json", "collection-status.json", onbid.manifest.catalogFile, ...onbid.catalog.items.map(item => item.detailFile)]) {
  await mkdir(dirname(`dist/data/onbid/${file}`), { recursive: true });
  await cp(`data/onbid/${file}`, `dist/data/onbid/${file}`);
}
console.log("GitHub Pages 산출물 생성 완료: dist/");

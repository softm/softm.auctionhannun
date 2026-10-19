import { cp, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { validateData } from "./validate-data.mjs";

const { manifest, catalog } = await validateData();
const onbid = await validateData("data/onbid");
await rm("dist", { recursive: true, force: true });
await mkdir("dist/data", { recursive: true });
await mkdir("dist/assets", { recursive: true });
await Promise.all([
  cp("index.html", "dist/index.html"),
  cp("privacy.html", "dist/privacy.html"),
  ...["data-status.html", "data-status.css", "data-status.js"].map(file => cp(file, `dist/${file}`)),
  cp("manifest.webmanifest", "dist/manifest.webmanifest"),
  cp("styles.css", "dist/styles.css"),
  cp("app.js", "dist/app.js"),
  cp("auction-utils.js", "dist/auction-utils.js"),
  ...["auction-data.js", "auction-map.js", "parcel-api.js", "parcel-utils.js", "map-config.js"].map(file => cp(file, `dist/${file}`)),
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

import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/data", { recursive: true });
await mkdir("dist/assets", { recursive: true });
await Promise.all([
  cp("index.html", "dist/index.html"),
  cp("privacy.html", "dist/privacy.html"),
  cp("manifest.webmanifest", "dist/manifest.webmanifest"),
  cp("styles.css", "dist/styles.css"),
  cp("app.js", "dist/app.js"),
  cp("assets/app-icon.svg", "dist/assets/app-icon.svg"),
  cp("data/auctions.json", "dist/data/auctions.json"),
  cp("robots.txt", "dist/robots.txt"),
  cp("sitemap.xml", "dist/sitemap.xml")
]);
console.log("GitHub Pages 산출물 생성 완료: dist/");

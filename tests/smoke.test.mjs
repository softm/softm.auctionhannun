import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("핵심 화면과 공식 출처가 포함된다", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /경매한눈/);
  assert.match(html, /매각물건명세서/);
  assert.match(html, /현황조사보고서/);
  assert.match(html, /감정평가서/);
  assert.match(html, /1주일 전까지/);
  assert.match(html, /easylaw\.go\.kr/);
});

test("공식 법원 연결과 브라우저 저장 기능이 선언된다", async () => {
  const app = await readFile(new URL("app.js", root), "utf8");
  assert.match(app, /https:\/\/www\.courtauction\.go\.kr\//);
  assert.match(app, /localStorage/);
  assert.match(app, /userAdded/);
  assert.match(app, /입찰 당일 상태 재확인/);
  assert.match(app, /loadCatalog/);
  assert.doesNotMatch(app, /fallbackCases|item\.pos/);
});

test("GitHub Actions 수집·배포 흐름이 선언된다", async () => {
  const collect = await readFile(new URL(".github/workflows/collect-auctions.yml", root), "utf8");
  const deploy = await readFile(new URL(".github/workflows/deploy-pages.yml", root), "utf8");
  assert.match(collect, /AUCTION_FEED_URL/);
  assert.match(collect, /commit-data/);
  assert.match(collect, /feature\/data-refresh/);
  assert.match(collect, /--base main/);
  assert.match(deploy, /actions\/deploy-pages@v4/);
});

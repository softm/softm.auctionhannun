import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const [html, css, runtime, config, build, privacy] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("styles.css", "utf8"),
  readFile("adfit.js", "utf8"),
  readFile("adfit-config.js", "utf8"),
  readFile("scripts/build.mjs", "utf8"),
  readFile("privacy.html", "utf8")
]);

test("최초 진입·목록 인피드·하단 접힘 광고 지면을 각각 한 번 배치한다", () => {
  for (const id of ["entryAd", "infeedAd", "bottomAd"]) {
    assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
  }
  assert.match(html, /id="entryAdClose"/);
  assert.match(html, /id="bottomAdToggle"/);
  assert.ok(html.indexOf('id="caseList"') < html.indexOf('id="infeedAd"'));
});

test("AdFit은 전용 설정, 지연 요청, 실패 시 지면 제거를 사용한다", () => {
  assert.match(runtime, /IntersectionObserver/);
  assert.match(runtime, /state\.zone\.hidden = true/);
  assert.match(runtime, /AdMobNative/);
  assert.match(runtime, /ENTRY_SEEN_KEY/);
  assert.match(runtime, /BOTTOM_COLLAPSED_KEY/);
  assert.match(runtime, /auctionhannun:ads-updated/);
  assert.match(config, /enabled: true/);
  for (const unit of ["DAN-ZqOFrLPUmlI5AWvH", "DAN-5dClDD1g2RiGnJwR", "DAN-5I0qVPgviCSNBEcc", "DAN-CuNtEfgzRE9ZSmn1", "DAN-3NtJk6tf5EHgkkOJ"]) {
    assert.match(config, new RegExp(unit));
  }
  assert.match(config, /cooldownHours: 24/);
});

test("광고 파일은 배포 산출물과 개인정보처리방침에 포함된다", () => {
  assert.match(build, /adfit-config\.js/);
  assert.match(build, /adfit\.js/);
  assert.match(privacy, /카카오 AdFit/);
  assert.match(css, /\.adfit-zone\[hidden\]/);
  assert.match(css, /\.adfit-bottom\.collapsed/);
  assert.match(css, /\.entry-ad-backdrop/);
});

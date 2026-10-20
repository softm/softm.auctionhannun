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

test("목록 광고 지면은 물건 목록 앞에 한 번만 배치된다", () => {
  assert.equal((html.match(/id="resultsAd"/g) || []).length, 1);
  assert.ok(html.indexOf('id="resultsAd"') < html.indexOf('id="caseList"'));
  assert.match(html, /data-adfit-host/);
});

test("AdFit은 전용 설정, 지연 요청, 실패 시 지면 제거를 사용한다", () => {
  assert.match(runtime, /IntersectionObserver/);
  assert.match(runtime, /state\.zone\.hidden = true/);
  assert.match(runtime, /AdMobNative/);
  assert.match(runtime, /DAN-/);
  assert.match(config, /enabled: true/);
  assert.match(config, /DAN-ZqOFrLPUmlI5AWvH/);
  assert.match(config, /width: 320, height: 100/);
});

test("광고 파일은 배포 산출물과 개인정보처리방침에 포함된다", () => {
  assert.match(build, /adfit-config\.js/);
  assert.match(build, /adfit\.js/);
  assert.match(privacy, /카카오 AdFit/);
  assert.match(css, /\.adfit-zone\[hidden\]/);
});

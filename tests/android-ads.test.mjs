import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [gradle, manifest, activity, controller, privacy, plan] = await Promise.all([
  readFile("android/app/build.gradle", "utf8"),
  readFile("android/app/src/main/AndroidManifest.xml", "utf8"),
  readFile("android/app/src/main/java/softm/realestate/auctionhannun/MainActivity.java", "utf8"),
  readFile("android/app/src/main/java/softm/realestate/auctionhannun/AdMobController.java", "utf8"),
  readFile("privacy.html", "utf8"),
  readFile("docs/ADVERTISING_PLAN.md", "utf8")
]);

test("Android AdMob은 운영 ID가 없으면 릴리스에서 비활성화된다", () => {
  assert.match(gradle, /releaseAdsEnabled.*false/);
  assert.match(gradle, /ADMOB_ENABLED/);
  assert.match(manifest, /com\.google\.android\.gms\.ads\.APPLICATION_ID/);
});

test("AdMob은 UMP 동의 후 배너를 요청하고 웹 AdFit과 중복하지 않는다", () => {
  assert.match(controller, /requestConsentInfoUpdate/);
  assert.match(controller, /canRequestAds\(\)/);
  assert.match(controller, /ConsentInformation\.PrivacyOptionsRequirementStatus\.REQUIRED/);
  assert.match(activity, /AdMobNative\/1/);
  assert.match(privacy, /Google AdMob/);
});

test("광고 계획은 웹과 앱 지면 및 전체화면 광고 제한을 문서화한다", () => {
  assert.match(plan, /카카오 AdFit/);
  assert.match(plan, /Google AdMob/);
  assert.match(plan, /전면·앱 오픈·보상형 광고를 넣지 않는다/);
});

test("Android 시작 주소와 내부 탐색 범위는 AdFit 승인 운영 도메인과 일치한다", async () => {
  const adContext = { window: {} };
  vm.runInNewContext(await readFile("adfit-config.js", "utf8"), adContext);
  const javaConstant = name => activity.match(new RegExp(`private static final String ${name} = "([^"]+)";`))?.[1];
  const home = new URL(javaConstant("HOME"));
  assert.equal(home.protocol, "https:");
  assert.equal(home.hostname, javaConstant("TRUSTED_HOST"));
  assert.ok(adContext.window.AUCTIONHANNUN_AD_CONFIG.allowedHosts.includes(home.hostname));
  assert.equal(home.pathname, "/");
  for (const path of ["/", "/index.html", "/privacy.html", "/data-status.html", "/auth-callback.html"]) {
    assert.ok(path.startsWith(javaConstant("TRUSTED_PATH")), `${path} must remain in the app`);
  }
  for (const path of ["android/store/listing-ko.txt", "android/store/play-console-checklist.md"]) {
    assert.ok((await readFile(path, "utf8")).includes(`${home.origin}/privacy.html`));
  }
});

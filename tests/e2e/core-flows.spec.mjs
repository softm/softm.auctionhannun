import { test, expect } from "@playwright/test";

async function openApp(page) {
  // Localhost is not an approved NAVER Maps origin. Abort deterministically so
  // external authentication callbacks cannot steal focus during form tests.
  await page.route("**/maps.js*", route => route.abort("failed"));
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/");
  await expect(page.locator("#resultCount")).not.toHaveText("0");
  await expect(page.locator(".case-card").first()).toBeVisible();
}

test("검색·관심목록·상세 탭이 실제 데이터로 동작한다", async ({ page }) => {
  await openApp(page);
  const firstTitle = await page.locator(".case-title").first().innerText();
  const keyword = firstTitle.trim().split(/\s+/).at(-1);

  await page.locator("#searchInput").fill(keyword);
  await expect(page.locator(".case-card").first()).toContainText(keyword);

  await page.locator(".bookmark-mini").first().click();
  await expect(page.locator("#favoriteCount")).toHaveText("1");
  await page.locator('[data-filter="favorite"]').click();
  await expect(page.locator(".case-card")).toHaveCount(1);

  await page.locator(".case-open").first().click();
  await expect(page.locator("#detailSheet")).toHaveAttribute("aria-hidden", "false");
  await page.getByRole("tab", { name: /서류/ }).click();
  await expect(page.locator("#detailContent")).toContainText(/공식|서류|공고/);
  await page.locator("#detailClose").click();
  await expect(page.locator("#detailSheet")).toHaveAttribute("aria-hidden", "true");
});

test("직접 사건을 등록하면 내 경매 작업실과 진행 상태가 생성된다", async ({ page }) => {
  await openApp(page);
  await page.locator("#addCaseButton").click();
  await expect(page.locator("#addCaseDialog")).toBeVisible();
  await page.locator("#addCaseForm").evaluate(form => {
    const values = { court: "서울중앙지방법원", caseNumber: "2026타경12345", address: "서울특별시 중구 세종대로 110", type: "commercial" };
    for (const [name, value] of Object.entries(values)) {
      form.elements.namedItem(name).value = value;
      form.elements.namedItem(name).dispatchEvent(new Event("input", { bubbles: true }));
    }
    form.requestSubmit();
  });

  await expect(page.locator("#detailSheet")).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#detailContent")).toContainText("물건별 경매 작업실");
  await expect(page.locator("[data-flow-status]")).toHaveValue("researching");
  await page.locator("[data-flow-task]").first().check();
  await expect(page.locator("#detailContent")).toContainText(/1\/|분석 준비도/);
});

test("지도 인증 실패 시 빈 지도를 표시하지 않고 재시도 안내를 제공한다", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#enableMap")).toBeVisible();
  await expect(page.locator("#mapPlaceholder")).toBeVisible();
  await expect(page.locator("#mapPlaceholderMessage")).toContainText(/인증|등록|지도/);
  await expect(page.locator('[data-map-mode="normal"]')).toBeDisabled();
});

test("모바일 화면은 가로 넘침 없이 검색·지도·하단 메뉴를 유지한다", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "모바일 프로젝트 전용");
  await openApp(page);
  const size = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.clientWidth);
  await expect(page.locator(".bottom-nav")).toBeVisible();
  await expect(page.locator("#searchInput")).toBeVisible();
  await expect(page.locator("#mapStage")).toBeVisible();
  const header = await page.locator(".topbar-inner").evaluate(element => ({ width: element.scrollWidth, client: element.clientWidth }));
  expect(header.width).toBeLessThanOrEqual(header.client);
  for (const selector of ["#accountButton", "#addCaseButton"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.height).toBeLessThanOrEqual(48);
  }
});

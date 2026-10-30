import { test, expect } from "@playwright/test";

test.afterEach(async ({ request, baseURL }) => {
  const response = await request.get("/api/state");
  const state = await response.json();
  for (const holding of state.holdings || []) {
    if (holding.label?.startsWith("SMOKE_"))
      await request.delete(`/api/purchases/${holding.id}`, {
        headers: { Origin: baseURL! },
      });
  }
  for (const alert of state.alerts || []) {
    if (alert.threshold === 999999)
      await request.delete(`/api/alerts/${alert.id}`, {
        headers: { Origin: baseURL! },
      });
  }
});

test("live desktop dashboard, purity conversion, weight and preferences", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByText("Feed current", { exact: true })).toBeVisible();
  await page
    .getByText("International spot benchmark (not dealer buying prices)", {
      exact: true,
    })
    .click();
  const india = page.getByRole("region", { name: "India prices" });
  const netherlands = page.getByRole("region", { name: "Netherlands prices" });
  await expect(
    india.getByRole("heading", { name: "India", exact: true }),
  ).toBeVisible();
  await expect(netherlands).toContainText("EUR / g");
  await page
    .getByRole("group", { name: "Gold purity" })
    .getByRole("button", { name: "22K", exact: true })
    .click();
  await page.getByRole("button", { name: "1 troy oz", exact: true }).click();
  await expect(page.getByLabel("Weight in grams")).toHaveValue("31.1034768");
  await page
    .getByRole("group", { name: "Display currency" })
    .getByRole("button", { name: "EUR", exact: true })
    .click();
  await expect(india.locator(".headline-price")).toHaveText(
    await netherlands.locator(".headline-price").innerText(),
  );
  await page.reload();
  await page
    .getByText("International spot benchmark (not dealer buying prices)", {
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("group", { name: "Gold purity" })
      .getByRole("button", { name: "22K", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("No forecast model", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".country-name img")
        .first()
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/desktop-live.png", fullPage: true });
});

test("normalized quote comparison, charges and mismatch guards", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Feed current", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  const india = page.locator(".quote-section").nth(0);
  const netherlands = page.locator(".quote-section").nth(1);
  await india.getByLabel("Currency", { exact: true }).selectOption("EUR");
  await india
    .getByLabel("Product price (before extras) (EUR)", { exact: true })
    .fill("900");
  await netherlands
    .getByLabel("Product price (before extras) (EUR)", { exact: true })
    .fill("800");
  await india.getByRole("checkbox").check();
  await netherlands.getByRole("checkbox").check();
  await expect(page.locator(".comparison-result")).toContainText("+12.50%");
  await india.getByLabel("Premium charge (EUR)").fill("100");
  await expect(page.locator(".comparison-result")).toContainText("+25.00%");
  await netherlands
    .getByLabel("Product", { exact: true })
    .selectOption("Jewellery");
  await expect(page.getByRole("status")).toContainText("Product mismatch");
});

test("purchase create edit CSV export import and delete", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Portfolio", exact: true }).click();
  await page.getByRole("button", { name: "Add purchase", exact: true }).click();
  await page.getByLabel("Country", { exact: true }).selectOption("Netherlands");
  await page.getByLabel("Currency", { exact: true }).selectOption("EUR");
  await page.getByLabel("Weight (grams)").fill("10");
  await page.getByLabel("Purity", { exact: true }).selectOption("995");
  await page.getByLabel("Product price (excluding extras)").fill("1000");
  await page.getByLabel("Optional extras (making, premium, tax)").fill("50");
  await page.getByLabel("Label (optional)").fill("SMOKE_LEDGER");
  await page
    .getByRole("button", { name: "Save purchase", exact: true })
    .click();
  await expect(page.locator(".ledger")).toContainText("SMOKE_LEDGER");
  await expect(page.locator(".ledger")).toContainText("995 fine");
  await expect(page.locator(".ledger")).toContainText("1,050.00");
  await page
    .getByRole("button", { name: "Edit SMOKE_LEDGER purchase" })
    .click();
  await page.getByLabel("Product price (excluding extras)").fill("1100");
  await page
    .getByRole("button", { name: "Save purchase", exact: true })
    .click();
  await expect(page.locator(".ledger")).toContainText("1,150.00");
  const downloadWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadWait;
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByLabel("Import purchases CSV").setInputFiles(path!);
  await expect(page.locator(".ledger tbody tr").filter({ hasText: "SMOKE_LEDGER" })).toHaveCount(2);
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete SMOKE_LEDGER purchase" })
    .first()
    .click();
  await expect(page.locator(".ledger tbody tr").filter({ hasText: "SMOKE_LEDGER" })).toHaveCount(1);
});

test("alert persistence and cross-origin write rejection", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await page.getByLabel("Target price").fill("999999");
  await page.getByLabel("Condition", { exact: true }).selectOption("above");
  await page.getByRole("button", { name: "Save alert", exact: true }).click();
  await expect(page.getByText("Watching", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Alerts", exact: true }).click();
  await expect(page.getByText("Watching", { exact: true })).toBeVisible();
  const rejected = await request.post("/api/alerts", {
    headers: { Origin: "https://untrusted.example" },
    data: {},
  });
  expect(rejected.status()).toBe(403);
});

test("mobile layouts have no page overflow and keyboard skip works", async ({
  page,
}) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    for (const name of [
      "Dashboard",
      "Compare",
      "Portfolio",
      "Alerts",
      "Settings",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
    }
    await page.getByRole("button", { name: "Dashboard", exact: true }).click();
    await page.screenshot({
      path: `artifacts/mobile-${width}-live.png`,
      fullPage: true,
    });
  }
});

test("stale provider state is clearly labelled", async ({ page }) => {
  await page.route("**/api/state**", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.market.gold.stale = true;
    data.market.gold.error = "Test fixture: provider unavailable";
    await route.fulfill({ json: data });
  });
  await page.goto("/");
  await expect(
    page.getByText("Stale / partial data", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Alert evaluation is paused",
  );
});

test("chart renders labelled interactive history using test-only fixture", async ({
  page,
}) => {
  const points = [0, 1, 2].map((index) => ({
    date: `2026-10-${27 + index}`,
    fxDate: `2026-10-${27 + index}`,
    usd: 3000 + index * 10,
    EUR: 2700 + index * 9,
    INR: 270000 + index * 900,
  }));
  await page.route("**/api/history**", (route) =>
    route.fulfill({
      json: {
        value: points,
        error: null,
        method: "TEST FIXTURE ONLY",
        authenticated: true,
        stale: false,
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: /gold daily history/ }),
  ).toBeVisible();
  await expect(page.locator(".recharts-area-curve")).toHaveAttribute("d", /M/);
  await page.getByText("View observations (3)", { exact: true }).click();
  await expect(page.locator(".history-table tbody tr")).toHaveCount(3);
  await page.screenshot({
    path: "artifacts/chart-test-fixture.png",
    fullPage: true,
  });
});

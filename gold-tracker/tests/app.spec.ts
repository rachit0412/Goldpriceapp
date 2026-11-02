import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import Papa from "papaparse";

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
    page.getByRole("button", { name: "Outlook", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Estimator", exact: true }),
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
  const exported = Papa.parse<Record<string, string>>(await readFile(path!, "utf8"), { header: true, skipEmptyLines: "greedy" });
  expect(exported.errors).toEqual([]);
  const ownRows = exported.data.filter(row => row.label === "SMOKE_LEDGER");
  expect(ownRows).toHaveLength(1);
  await page.getByLabel("Import purchases CSV").setInputFiles({
    name: "smoke-ledger.csv", mimeType: "text/csv",
    buffer: Buffer.from(Papa.unparse(ownRows)),
  });
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
  await expect(page.getByRole("status").filter({ hasText: "Stale data:" })).toContainText(
    "Alert evaluation is paused",
  );
});

test("price outlook shows a real statistical projection, not a fake AI forecast", async ({
  page,
  request,
}) => {
  const liveResponse = await request.get("/api/forecast?country=Netherlands&currency=EUR&days=90");
  expect(liveResponse.ok()).toBe(true);
  const live = await liveResponse.json();
  expect(live.method).toContain("Ordinary least squares");
  expect(live.method).toContain("not financial advice");
  expect(["Bullish", "Bearish", "Neutral", null]).toContain(live.direction);
  await page.route("**/api/forecast**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ json: {
      country: url.searchParams.get("country"), currency: url.searchParams.get("currency"),
      horizonDays: 7, stale: false, error: null, sourceError: null,
      regression: { rSquared: 0.42, slope: 1, intercept: 90, standardError: 2.5, n: 30, xMean: 14.5, sxx: 850 },
      basis: { count: 30, firstDate: "2026-10-01", lastDate: "2026-10-30" },
      current: { date: "2026-10-30", value: 100 },
      history: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-10-${String(index + 1).padStart(2, "0")}`,
        value: 91 + index + (index % 3),
      })),
      stats: { min: 91, max: 122, mean: 105, stdevPercent: 8.2 },
      projected: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-11-0${index + 1}`, expected: 108, lower: 101, upper: 115,
      })),
      changePercent: 8, direction: "Bullish",
      method: "TEST FIXTURE: Ordinary least squares linear regression; not financial advice.",
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Outlook", exact: true }).click();
  const outlook = page.locator(".outlook");
  await expect(outlook.locator(".forecast-badge")).toHaveText(/Bullish\s*\+8/);
  await expect(outlook).toContainText("Model fit (R²)");
  await expect(outlook).toContainText("42% · Medium");
  await expect(outlook).toContainText("Observations used");
  await expect(outlook).toContainText("30 days");
  await expect(outlook).toContainText("Upper");
  await expect(outlook).toContainText("Not a prediction service, AI");
  await expect(outlook).toContainText("Based on 30 daily observations");
  await expect(outlook).toContainText("Daily trend");
  await expect(outlook.getByText("/day", { exact: false })).toBeVisible();
  await expect(outlook).toContainText("Lookback low");
  await expect(outlook).toContainText("Volatility (stdev)");
  await expect(outlook).toContainText("8.2%");
  await expect(outlook.locator(".fit-gauge")).toBeVisible();
  await expect(
    outlook.getByRole("img", { name: /real daily observations/ }),
  ).toBeVisible();
  await expect(outlook.getByText("How we got this number (methodology)", { exact: true })).toBeVisible();
  await expect(outlook).toContainText("expected(days ahead) = today's price + slope × days ahead");
  await expect(outlook).toContainText("day 0 is 2026-10-01");
  await outlook.getByText("Day-by-day projection (7)", { exact: true }).click();
  const forecastRows = outlook.locator(".forecast-table tbody tr");
  await expect(forecastRows).toHaveCount(7);
  await expect(forecastRows.first()).toContainText("+8.00%");
});

test("jewelry price estimator adds making charges and tax to the reference rate", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Estimator", exact: true }).click();
  const estimator = page.locator(".estimator-section");
  await expect(estimator.getByText("Jewelry price estimator", { exact: true })).toBeVisible();
  const rateCell = estimator.locator(".calc-breakdown-row").first().locator("strong");
  await expect(rateCell).not.toHaveText("Unavailable / g");
  await expect(rateCell).toContainText("₹");
  await estimator.getByLabel("Gross weight (g)").fill("10");
  await estimator.getByLabel("Stone weight (g)").fill("2");
  await expect(estimator).toContainText("8 g");
  await estimator.getByLabel("Making charges (%)").fill("10");
  await estimator.getByLabel("Tax / VAT (%)").fill("5");
  const sourceProduct = estimator.getByLabel("Source product");
  await expect(sourceProduct).toBeVisible();
  await expect(estimator).toContainText("Raksha source SELL rate");
  await expect(estimator.getByLabel("Purity")).toHaveCount(0);
  const totalBefore = await estimator.locator(".calc-breakdown-total strong").innerText();
  await estimator.getByLabel("Region").selectOption("Netherlands");
  await expect(sourceProduct).toHaveCount(0);
  const purity = estimator.getByLabel("Purity");
  expect(await purity.locator("option").allTextContents()).toEqual(["24K", "22K", "18K", "14K"]);
  await expect(purity).toHaveValue("22");
  await expect(estimator).toContainText("International reference rate");
  await expect(estimator.locator(".calc-breakdown-row").first().locator("strong")).toContainText("€");
  const totalAfter = await estimator.locator(".calc-breakdown-total strong").innerText();
  expect(totalAfter).not.toBe(totalBefore);
  await expect(estimator).toContainText("Making charges (10%)");
  await expect(estimator).toContainText("Tax / VAT (5%)");
  await expect(estimator.getByRole("button", { name: "Print estimate", exact: true })).toBeVisible();
});

test("seven-day chart defaults to today-inclusive hourly observations", async ({
  page,
  request,
}) => {
  const liveResponse = await request.get("/api/history?days=7");
  expect(liveResponse.ok()).toBe(true);
  const liveHistory = await liveResponse.json();
  expect(liveHistory.method).toContain("Standard Bullion");
  expect(liveHistory.value.length).toBeGreaterThan(2);
  const today = new Date().toISOString().slice(0, 10);
  expect(liveHistory.value.some((point: { date: string }) => point.date.slice(0, 10) === today)).toBe(true);
  expect(liveHistory.stale).toBe(false);
  const now = Date.now();
  const points = [6 * 86400000, 86400000, 120000, 60000].map((age, index) => {
    const observed = new Date(now - age).toISOString();
    return {
      date: observed,
      fxDate: observed.slice(0, 10),
      usd: 3000 + index * 10,
      EUR: 2700 + index * 9,
      INR: 270000 + index * 900,
    };
  });
  await page.route("**/api/history**", (route) =>
    route.fulfill({
      json: {
        value: points,
        error: null,
        method: "TEST FIXTURE ONLY",
        stale: false,
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(
    page
      .getByRole("group", { name: "History range" })
      .getByRole("button", { name: "7D", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("img", { name: /gold observations over the selected range/ }),
  ).toBeVisible();
  const chartPurity = page.getByRole("group", { name: "Chart purity" });
  await expect(chartPurity.getByRole("button", { name: "24K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-section .recharts-area-curve")).toHaveAttribute("d", /M/);
  await page.getByText("View observations (3)", { exact: true }).click();
  await expect(page.locator(".history-table tbody tr")).toHaveCount(3);
  const detail = page.getByRole("group", { name: "Observation table detail", exact: true });
  await detail.getByRole("button", { name: "All observations", exact: true }).click();
  await expect(page.locator(".history-table tbody tr")).toHaveCount(4);
  await detail.getByRole("button", { name: "Daily", exact: true }).click();
  await expect(page.locator(".history-table tbody tr")).toHaveCount(3);
  const value24k = await page.locator(".history-table tbody tr").first().locator("td").nth(1).innerText();
  await chartPurity.getByRole("button", { name: "22K", exact: true }).click();
  await expect(chartPurity.getByRole("button", { name: "22K", exact: true })).toHaveAttribute("aria-pressed", "true");
  const value22k = await page.locator(".history-table tbody tr").first().locator("td").nth(1).innerText();
  expect(value22k).not.toBe(value24k);
  await chartPurity.getByRole("button", { name: "18K", exact: true }).click();
  await expect(chartPurity.getByRole("button", { name: "18K", exact: true })).toHaveAttribute("aria-pressed", "true");
  const value18k = await page.locator(".history-table tbody tr").first().locator("td").nth(1).innerText();
  expect(value18k).not.toBe(value22k);
  await page.getByRole("group", { name: "Chart currency" }).getByRole("button", { name: "EUR", exact: true }).click();
  await expect(page.locator(".history-table thead")).toContainText("EUR/g");
  await expect(page.getByLabel("Selected range price change")).toContainText("Change from first observation");
  await expect(page.locator(".history-table tbody tr").last()).toContainText(
    new Date(points.at(-1)!.date).toLocaleDateString("en", { timeZone: "UTC", dateStyle: "medium" }),
  );
});

test("country charts stay separate, persist country and refresh automatically", async ({ page, request }) => {
  const liveResponse = await request.get("/api/history?country=India&days=7");
  expect(liveResponse.ok()).toBe(true);
  const live = await liveResponse.json();
  expect(live.source).toContain("IBJA");
  expect(live.grain).toBe("daily");
  expect(live.value.length).toBeGreaterThanOrEqual(7);
  expect(new Set(live.value.map((point: { date: string }) => point.date)).size).toBeGreaterThanOrEqual(7);
  expect(live.error).toBeNull();
  await page.clock.install();
  let indianLoads = 0;
  const now = Date.now();
  await page.route("**/api/history**", async route => {
    const url = new URL(route.request().url());
    const country = url.searchParams.get("country") || "Netherlands";
    if (country === "India") indianLoads++;
    const point = (timestamp: number, amount: number) => ({
      date: new Date(timestamp).toISOString(), fxDate: new Date(timestamp).toISOString().slice(0, 10),
      INR: amount * 31.1034768, EUR: amount / 100 * 31.1034768, usd: amount / 90 * 31.1034768,
    });
    const points = country === "India"
      ? Array.from({ length: 7 }, (_, index) => ({
        ...point(now - (6 - index) * 86400000, 10000 + index * 100 + (index === 6 ? indianLoads : 0)),
        date: new Date(now - (6 - index) * 86400000).toISOString().slice(0, 10),
      }))
      : [point(now - 86400000, 11000), point(now, 11100)];
    await route.fulfill({ json: {
      country, value: points, stale: false, error: null,
      grain: country === "India" ? "daily" : undefined,
      retrievedAt: points.at(-1)!.date,
      method: `TEST FIXTURE ONLY · ${country}`,
    } });
  });
  await page.goto("/");
  const countries = page.getByRole("group", { name: "Chart country", exact: true });
  const chartPurity = page.getByRole("group", { name: "Chart purity", exact: true });
  await expect(countries.getByRole("button", { name: "Netherlands", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Chart currency", exact: true }).getByRole("button", { name: "EUR", exact: true })).toHaveAttribute("aria-pressed", "true");
  await chartPurity.getByRole("button", { name: "14K", exact: true }).click();
  await countries.getByRole("button", { name: "India", exact: true }).click();
  await expect(chartPurity.getByRole("button", { name: "14K", exact: true })).toHaveCount(0);
  await expect(chartPurity.getByRole("button", { name: "24K", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByText("View observations (7)", { exact: true }).click();
  await expect(page.locator(".history-table tbody tr")).toHaveCount(7);
  await expect(page.locator(".history-table thead")).toContainText("Publication date (India)");
  await expect(page.locator(".history-table tbody")).toContainText("₹10,601.00");
  await page.clock.fastForward(61000);
  await expect.poll(() => indianLoads).toBeGreaterThan(1);
  await expect(page.locator(".history-table tbody")).toContainText("₹10,602.00");
  await page.reload();
  await expect(countries.getByRole("button", { name: "India", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("India chart product")).toHaveCount(0);
  await countries.getByRole("button", { name: "Netherlands", exact: true }).click();
  await expect(page.getByText("View observations (2)", { exact: true })).toBeVisible();
  await expect(page.getByLabel("India chart product")).toHaveCount(0);
  await expect(chartPurity.getByRole("button", { name: "14K", exact: true })).toBeVisible();
});

test("theme toggle persists between light and dark modes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  const lightBackground = await root.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--background").trim(),
  );
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  const darkBackground = await root.evaluate((element) =>
    getComputedStyle(element).getPropertyValue("--background").trim(),
  );
  expect(darkBackground).not.toBe(lightBackground);
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
});

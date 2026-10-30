import { expect, test } from "@playwright/test";

test("Netherlands EUR reference and optional product quotes remain distinct", async ({
  page,
  request,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  const india = page.getByRole("region", {
    name: "India dealer prices",
    exact: true,
  });
  const nl = page.getByRole("region", {
    name: "Netherlands live gold reference",
    exact: true,
  });
  await expect(
    india.getByText("Raksha Bullion · Mumbai", { exact: true }).first(),
  ).toBeVisible();
  await expect(india.locator(".indian-reference .source-caution")).toContainText("Auto-refresh · fetched");
  await india.getByText("Original Raksha dealer quotes", { exact: true }).click();
  const indiaCurrency = page.getByLabel("India quote currency");
  const nlCurrency = page.getByLabel("Netherlands quote currency");
  await expect(indiaCurrency).toHaveValue("INR");
  await expect(nlCurrency).toHaveValue("EUR");
  const indiaAmountInInr = await india.locator(".dealer-rates tbody tr").first().locator("td").nth(1).innerText();
  await indiaCurrency.selectOption("EUR");
  await expect(india.locator(".dealer-rates thead")).toContainText("Source BUY (EUR / 10g)");
  await expect(nlCurrency).toHaveValue("EUR");
  const indiaAmountInEur = await india.locator(".dealer-rates tbody tr").first().locator("td").nth(1).innerText();
  expect(indiaAmountInEur).not.toBe(indiaAmountInInr);
  await india.getByText("Original Raksha dealer quotes", { exact: true }).click();
  await expect(nl).toContainText("Standard Bullion · global gold quote");
  await expect(nl).toContainText("Source ask · buy");
  await expect(nl).toContainText("Source bid · sell to source");
  await expect(nl).toContainText("Provider observation:");
  await expect(nl).toContainText("Data by Standard Bullion");
  await expect(nl).toContainText("not a Netherlands-specific product price");
  const indianReference = india.locator(".indian-reference");
  await expect(india.locator(".live-reference")).toHaveCount(0);
  await expect(indianReference).toContainText("per 1g · 24K estimate");
  await expect(indianReference).toContainText("total for 10g");
  await expect(nl.locator(".live-reference")).toContainText("per 1g · 24K equivalent");
  await expect(nl.locator(".live-reference")).toContainText("total for 10g");
  const indiaReference24 = await indianReference.locator(".spot-quote-value strong").first().innerText();
  await page.getByLabel("India reference purity").selectOption("22");
  await expect(indianReference).toContainText("per 1g · 22K estimate");
  expect(await indianReference.locator(".spot-quote-value strong").first().innerText()).not.toBe(indiaReference24);
  await expect(page.getByLabel("Netherlands reference purity")).toHaveValue("24");
  await page.getByLabel("India reference purity").selectOption("24");
  await page.getByLabel("Shared reference weight (g)").fill("5");
  await expect(indianReference).toContainText("total for 5g");
  await expect(indianReference.locator(".spot-quote-value strong").first()).toHaveText(indiaReference24);
  await expect(nl.locator(".live-reference")).toContainText("total for 5g");
  await page.getByLabel("Shared reference weight (g)").fill("10");
  const nlAmountInEur = await nl.locator(".spot-quote-value strong").first().innerText();
  await nlCurrency.selectOption("INR");
  const nlAmountInInr = await nl.locator(".spot-quote-value strong").first().innerText();
  expect(nlAmountInInr).toContain("₹");
  expect(nlAmountInInr).not.toBe(nlAmountInEur);
  await expect(indiaCurrency).toHaveValue("EUR");
  await nlCurrency.selectOption("EUR");
  await expect(india.getByText("Global spot comparison", { exact: false })).toHaveCount(0);
  await nl.getByRole("button", { name: "Add quote", exact: true }).click();
  await page.getByLabel("Dealer", { exact: true }).fill("SMOKE_PRODUCT_DEALER");
  await page
    .getByLabel("Product description", { exact: true })
    .fill("Test-only 999.9 bar");
  await page.getByLabel("Quoted weight (grams)").fill("10");
  await page.getByLabel("Quoted total (as stated)").fill("1000");
  await page
    .getByLabel("Tax treatment (dealer stated)")
    .selectOption("Included");
  await page
    .getByRole("button", { name: "Save product quote", exact: true })
    .click();
  await expect(nl).toContainText("999.9 fine");
  await expect(nl).toContainText("Tax: Included");
  await page.reload();
  await expect(indiaCurrency).toHaveValue("EUR");
  await expect(nlCurrency).toHaveValue("EUR");
  await expect(nl).toContainText("SMOKE_PRODUCT_DEALER");
  await page.screenshot({
    path: "artifacts/market-reference-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    )).toBe(true);
  await page.screenshot({
    path: "artifacts/market-reference-mobile.png",
    fullPage: true,
  });
  const data = await (await request.get("/api/dealers")).json();
  for (const quote of data.quotes)
    if (quote.dealer === "SMOKE_PRODUCT_DEALER")
      await request.delete(`/api/dealer-quotes/${quote.id}`, {
        headers: { Origin: baseURL! },
      });
});

test("Indian reference uses Raksha per gram, preserves GST and never substitutes global spot", async ({ page }) => {
  let unavailable = false;
  let onlyGst = false;
  const retrievedAt = new Date().toISOString();
  await page.route("**/api/dealers", async route => {
    await route.fulfill({ json: {
      raksha: {
        rows: unavailable ? [] : [
          { id: "gst999", label: "GOLD 999 WITH GST TEST FIXTURE", fineness: 999, buy: 102000, sell: 103000, gst: "Included (source label)", sourceNote: "TEST ONLY" },
          { id: "999", label: "GOLD 999 TEST FIXTURE", fineness: 999, buy: 100000, sell: 101000, gst: "Not stated", sourceNote: "TEST ONLY" },
          { id: "995", label: "GOLD 995 TEST FIXTURE", fineness: 995, buy: 90000, sell: 91000, gst: "Not stated", sourceNote: "TEST ONLY" },
        ].filter(row => !onlyGst || row.id === "gst999"),
        unitGrams: 10, observedAt: null, retrievedAt, attemptedAt: retrievedAt,
        error: unavailable ? "Test fixture: Indian feed unavailable" : null,
      },
      standardBullion: {
        value: { gold: { ask: 4000, bid: 3900 }, updated: retrievedAt, unit: "USD per troy ounce", disclaimer: "Test-only global fixture", attribution: "Data by Standard Bullion" },
        stale: false, error: null, retrievedAt, observedAt: retrievedAt,
      },
      quotes: [],
    } });
  });
  await page.goto("/");
  const india = page.getByRole("region", { name: "India dealer prices", exact: true });
  const reference = india.locator(".indian-reference");
  await expect(page.getByLabel("India reference product")).toHaveCount(0);
  await page.getByLabel("India reference purity").selectOption("999");
  const buy = reference.locator(".spot-quote-value").first();
  await expect(buy.locator("strong")).toHaveText("₹10,000.00");
  await expect(buy).toContainText("₹1,00,000.00 total for 10g");
  await expect(reference).toContainText("GST: Not stated");
  await page.getByLabel("India reference purity").selectOption("22");
  await expect(buy.locator("strong")).toHaveText("₹9,175.84");
  await page.getByLabel("India reference purity").selectOption("995");
  await expect(buy.locator("strong")).toHaveText("₹9,000.00");
  await expect(reference).toContainText("Based on GOLD 995 TEST FIXTURE");
  await page.getByLabel("India reference purity").selectOption("999");
  await expect(buy.locator("strong")).toHaveText("₹10,000.00");
  await page.getByLabel("Shared reference weight (g)").fill("5");
  await expect(buy.locator("strong")).toHaveText("₹10,000.00");
  await expect(buy).toContainText("₹50,000.00 total for 5g");
  onlyGst = true;
  await page.reload();
  await expect(buy.locator("strong")).toHaveText("₹10,200.00");
  await expect(buy).toContainText("₹51,000.00 total for 5g");
  await expect(reference).toContainText("GST: Included (source label)");
  await expect(india.locator(".live-reference")).toHaveCount(0);
  unavailable = true;
  await page.reload();
  await expect(reference).toContainText("Indian reference unavailable. No global-price substitution.");
  await expect(reference.locator(".spot-quote-value")).toHaveCount(0);
  await expect(india.locator(".live-reference")).toHaveCount(0);
});

test("Netherlands purity options are country-specific and migrate an old fineness preference", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aurum-market-purities", JSON.stringify({ India: 999, Netherlands: 995 }));
  });
  await page.goto("/");
  const nl = page.getByRole("region", { name: "Netherlands live gold reference", exact: true });
  const purity = page.getByLabel("Netherlands reference purity");
  await expect(purity).toHaveValue("24");
  expect(await purity.locator("option").allTextContents()).toEqual(["24K", "22K", "18K", "14K"]);
  await expect(page.getByLabel("India reference purity")).toHaveValue("999");
  const quote = nl.locator(".spot-quote-value strong").first();
  await expect(quote).not.toHaveText("Unavailable");
  const before = await quote.innerText();
  await purity.selectOption("14");
  await expect(nl).toContainText("per 1g · 14K equivalent");
  expect(await quote.innerText()).not.toBe(before);
  await expect(page.getByLabel("India reference purity")).toHaveValue("999");
});

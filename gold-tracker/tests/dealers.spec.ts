import { expect, test } from "@playwright/test";

test("dealer rows stay distinct from the collapsed benchmark and product quotes persist", async ({
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
    name: "Netherlands dealer prices",
    exact: true,
  });
  await expect(
    india.getByText("Raksha Bullion · Mumbai", { exact: true }),
  ).toBeVisible();
  await expect(
    india.getByText("Observation time unverified", { exact: true }),
  ).toBeVisible();
  await expect(
    nl.getByText("No verified automated retail quote", { exact: true }),
  ).toBeVisible();
  await expect(nl).toContainText("404 unknown_country");
  await expect(
    nl.getByRole("link", { name: /Physical API coverage and schema/ }),
  ).toHaveAttribute("href", "https://goldprice.dev/docs/physical");
  await expect(page.locator("details.benchmark-section")).not.toHaveAttribute(
    "open",
  );
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
  await expect(nl).toContainText("SMOKE_PRODUCT_DEALER");
  await page.screenshot({
    path: "artifacts/local-dealer-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/local-dealer-mobile.png",
    fullPage: true,
  });
  const data = await (await request.get("/api/dealers")).json();
  for (const quote of data.quotes)
    if (quote.dealer === "SMOKE_PRODUCT_DEALER")
      await request.delete(`/api/dealer-quotes/${quote.id}`, {
        headers: { Origin: baseURL! },
      });
});

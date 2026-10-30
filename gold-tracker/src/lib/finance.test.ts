import { describe, expect, it } from "vitest";
import {
  compareQuotes,
  convert,
  isStale,
  metalPrice,
  purchaseSchema,
  shouldTrigger,
  TROY_OUNCE,
  unitGrams,
  valuation,
  type Alert,
  type Purchase,
  type Quote,
} from "./finance";

const rates = { USD: 1, EUR: 0.9, INR: 90 };
const purchase: Purchase = {
  id: "test",
  date: "2025-01-01",
  country: "India",
  product: "Jewellery",
  purity: 22,
  weight: 10,
  currency: "INR",
  cost: 45000,
  charges: 5000,
  label: "",
};
const quote: Quote = {
  country: "India",
  product: "Bullion",
  purity: 24,
  weight: 10,
  currency: "INR",
  total: 90000,
  making: 0,
  premium: 0,
  tax: 0,
  complete: true,
  priceType: "Manual dealer quote",
};
describe("financial rules", () => {
  it("converts FX in both directions", () => {
    expect(convert(100, "EUR", "INR", rates)).toBe(10000);
    expect(convert(10000, "INR", "EUR", rates)).toBe(100);
  });
  it("uses troy ounces and linear purity", () => {
    expect(metalPrice(3100, 24, TROY_OUNCE, "EUR", rates)).toBeCloseTo(2790);
    expect(metalPrice(3100, 18, 1, "EUR", rates)).toBeCloseTo(
      metalPrice(3100, 24, 1, "EUR", rates) * 0.75,
    );
    expect(unitGrams("10 grams")).toBe(10);
  });
  it("normalizes quotes and uses the right-hand baseline", () => {
    const result = compareQuotes(
      quote,
      { ...quote, country: "Netherlands", currency: "EUR", total: 800 },
      rates,
      "EUR",
      24,
      5,
    );
    expect(result.first).toBe(90);
    expect(result.perGram).toBe(10);
    expect(result.total).toBe(50);
    expect(result.percent).toBe(12.5);
  });
  it("includes all charges", () => {
    expect(
      compareQuotes(
        { ...quote, making: 1000, premium: 1000, tax: 1000 },
        quote,
        rates,
        "INR",
        24,
        1,
      ).perGram,
    ).toBe(300);
  });
  it("rejects mismatched and incomplete quotes", () => {
    expect(() =>
      compareQuotes(
        quote,
        { ...quote, product: "Jewellery" },
        rates,
        "EUR",
        24,
        1,
      ),
    ).toThrow("mismatch");
    expect(() =>
      compareQuotes(quote, { ...quote, complete: false }, rates, "EUR", 24, 1),
    ).toThrow("Incomplete");
  });
  it("normalizes different purities", () => {
    expect(
      compareQuotes(
        { ...quote, purity: 18, total: 67500 },
        quote,
        rates,
        "INR",
        22,
        1,
      ).perGram,
    ).toBeCloseTo(0);
  });
  it("keeps charges in cost basis but out of metal value", () => {
    const result = valuation(purchase, 2000, rates, rates, "INR");
    expect(result.basis).toBe(50000);
    expect(result.gain).toBeCloseTo(result.value - 50000);
    expect(result.returnPct).toBeCloseTo(
      ((result.value - 50000) / 50000) * 100,
    );
  });
  it("decomposes FX and constant-FX gain without claiming recoverable fees", () => {
    const result = valuation(
      purchase,
      2000,
      rates,
      { ...rates, EUR: 0.8 },
      "EUR",
    );
    expect(result.fxEffect! + result.goldEffect!).toBeCloseTo(result.gain!);
  });
  it("does not invent historical conversion", () => {
    expect(valuation(purchase, 2000, rates, null, "EUR").basis).toBeNull();
  });
  it("rejects invalid holdings", () => {
    expect(purchaseSchema.safeParse({ ...purchase, weight: -1 }).success).toBe(
      false,
    );
    expect(purchaseSchema.safeParse({ ...purchase, charges: -1 }).success).toBe(
      false,
    );
  });
});
describe("freshness and alerts", () => {
  const alert: Alert = {
    id: "one",
    country: "India",
    priceType: "Spot estimate",
    purity: 24,
    currency: "INR",
    unit: "gram",
    direction: "above",
    threshold: 100,
  };
  it("checks observation separately from retrieval", () => {
    expect(
      isStale("2025-01-01", "2025-01-02", 1000, Date.parse("2025-01-02")),
    ).toBe(true);
    expect(isStale("invalid", "2025-01-02", 1000)).toBe(true);
  });
  it("suppresses stale and duplicate notifications", () => {
    expect(shouldTrigger(alert, 101, false)).toBe(true);
    expect(shouldTrigger(alert, 101, true)).toBe(false);
    expect(
      shouldTrigger({ ...alert, triggeredAt: "yesterday" }, 101, false),
    ).toBe(false);
    expect(shouldTrigger(alert, NaN, false)).toBe(false);
  });
  it("supports below thresholds", () => {
    expect(shouldTrigger({ ...alert, direction: "below" }, 99, false)).toBe(
      true,
    );
  });
});

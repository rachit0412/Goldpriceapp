import { describe, expect, it } from "vitest";
import {
  compareQuotes,
  metalPrice,
  purityFraction,
  purityLabel,
  purchaseSchema,
  type Quote,
} from "./finance";

describe("bullion fineness is not a karat count", () => {
  it("preserves 995, 999 and 999.9 fractions", () => {
    expect(purityFraction(995)).toBe(0.995);
    expect(purityFraction(999)).toBe(0.999);
    expect(purityFraction(999.9)).toBe(0.9999);
    expect(purityLabel(995)).toBe("995 fine");
    expect(purityLabel(22)).toBe("22K");
  });
  it("calculates fine-gold metal value without treating 999 as 999 karat", () => {
    const rates = { USD: 1, EUR: 0.9, INR: 90 };
    expect(metalPrice(3000, 999, 10, "EUR", rates)).toBeCloseTo(
      metalPrice(3000, 24, 10, "EUR", rates) * 0.999,
    );
  });
  it("normalizes a 995 and 999 quote on exact fine content", () => {
    const quote: Quote = {
      country: "India",
      product: "Bullion",
      purity: 995,
      weight: 10,
      currency: "EUR",
      total: 995,
      making: 0,
      premium: 0,
      tax: 0,
      complete: true,
      priceType: "Manual dealer quote",
    };
    expect(
      compareQuotes(
        quote,
        { ...quote, country: "Netherlands", purity: 999, total: 999 },
        { USD: 1, EUR: 0.9, INR: 90 },
        "EUR",
        24,
        10,
      ).perGram,
    ).toBeCloseTo(0);
  });
  it("accepts exact fineness in a purchase", () => {
    expect(
      purchaseSchema.safeParse({
        date: "2025-01-01",
        country: "India",
        product: "Bullion",
        purity: 995,
        weight: 10,
        currency: "INR",
        cost: 100000,
      }).success,
    ).toBe(true);
  });
});

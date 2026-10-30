import { describe, expect, it } from "vitest";
import { dealerQuoteSchema, normalizeRakshaObservation, parseRaksha, parseStandardBullion, rakshaUnitGrams } from "./dealers";
import { TROY_OUNCE } from "./finance";

describe("Indian chart observations", () => {
  const observation = {
    date: "2026-10-30T12:04:00Z", unitGrams: 10,
    product: { id: "999", label: "GOLD 999 WITH GST", fineness: 999 as const, buy: 99000, sell: 99900, gst: "Included (source label)" as const, sourceNote: "TEST ONLY" },
    rates: { USD: 1, INR: 100, EUR: 0.9 }, fxDate: "2026-10-30",
  };
  it("retains an actual retrieval time and normalizes Indian SELL without adding GST", () => {
    const point = normalizeRakshaObservation(observation)!;
    expect(point.date).toBe(observation.date);
    expect(point.INR / TROY_OUNCE).toBeCloseTo(10000);
    expect(point.EUR / TROY_OUNCE).toBeCloseTo(90);
    expect(point.fxDate).toBe(observation.fxDate);
  });
  it("does not replace missing SELL or unknown weight with a global price", () => {
    expect(normalizeRakshaObservation({ ...observation, unitGrams: 0 })).toBeNull();
    expect(normalizeRakshaObservation({ ...observation, product: { ...observation.product, sell: null } })).toBeNull();
  });
});

describe("dealer prices preserve source meaning", () => {
  const fixture =
    "\t1\tGold Spot\t3000\t3001\t3010\t2990\tTODAY\n\t2\tGOLD 995 DELIVERY DATE\t90000\t91000\t91000\t90000\t20 jan\n\t3\tGOLD 999 WITH GST(BIS)\t-\t94000\t94000\t94000\tTODAY";
  it("parses the source's BUY and SELL fields without swapping or using high/low", () => {
    const rows = parseRaksha(fixture);
    expect(rows).toHaveLength(2);
    expect(rows[0].buy).toBe(90000);
    expect(rows[0].sell).toBe(91000);
    expect(rows[1].buy).toBeNull();
    expect(rows[1].sell).toBe(94000);
  });
  it("preserves fineness, GST labels and ambiguous source notes without invented tax or timestamps", () => {
    const rows = parseRaksha(fixture);
    expect(rows[0].fineness).toBe(995);
    expect(rows[0].gst).toBe("Not stated");
    expect(rows[0].sourceNote).toBe("20 jan");
    expect(rows[1].fineness).toBe(999);
    expect(rows[1].gst).toBe("Included (source label)");
  });
  it("does not divide raw quotes by an assumed weight", () => {
    expect(parseRaksha(fixture)[1].sell).toBe(94000);
  });
  it("rejects HTML errors and missing quotes", () => {
    expect(() => parseRaksha("<html>Unavailable</html>")).toThrow();
    expect(() => parseRaksha("\t1\tGOLD 995\t-\t-\t-\t-\tTODAY")).toThrow();
  });
  it("validates exact fineness and dated manual quotes", () => {
    const quote = {
      country: "Netherlands",
      dealer: "Test dealer",
      sourceUrl: "https://example.com/product",
      product: "Bullion",
      description: "Test 999.9 bar",
      fineness: 999.9,
      weight: 10,
      currency: "EUR",
      total: 1000,
      taxStatus: "Unknown",
      observedAt: "2025-01-01T10:00:00Z",
    };
    expect(dealerQuoteSchema.safeParse(quote).success).toBe(true);
    expect(
      dealerQuoteSchema.safeParse({ ...quote, fineness: 1001 }).success,
    ).toBe(false);
    expect(dealerQuoteSchema.safeParse({ ...quote, weight: 0 }).success).toBe(
      false,
    );
  });
});

describe("Raksha quote display unit", () => {
  it("defaults to the requested 10g comparison and allows an explicit override", () => {
    expect(rakshaUnitGrams(undefined)).toBe(10);
    expect(rakshaUnitGrams("5")).toBe(5);
    expect(rakshaUnitGrams("invalid")).toBeNull();
  });
});

describe("Raksha quote unit display assumption", () => {
  it("defaults to 10g and allows a validated operator override", () => {
    expect(rakshaUnitGrams(undefined)).toBe(10);
    expect(rakshaUnitGrams("5")).toBe(5);
    expect(rakshaUnitGrams("")).toBe(10);
    expect(rakshaUnitGrams("invalid")).toBeNull();
  });
});

describe("Standard Bullion live reference", () => {
  const feed = {
    source: "Standard Bullion",
    url: "https://standardbullion.com",
    unit: "USD per troy ounce",
    updated: "2026-10-30T21:05:50.880Z",
    attribution: "Data by Standard Bullion — https://standardbullion.com",
    disclaimer: "Indicative live dealer prices. Ask = price to buy; Bid = price to sell to us.",
    metals: [
      { symbol: "XAU", page: "https://standardbullion.com/spot-gold-price", ask: 3900, bid: 3890, open: 4000, changeToday: { amount: -100, percent: -2.5 }, changes: { "1w": -1, "1m": -2, "1y": 3 } },
      { symbol: "XAG", page: "https://standardbullion.com/spot-silver-price", ask: 50, bid: 49, open: 52, changeToday: { amount: -2, percent: -4 }, changes: { "1w": 1, "1m": 2, "1y": 3 } },
    ],
  };
  it("parses the live USD/troy-ounce quote and provider timestamp", () => {
    const result = parseStandardBullion(feed);
    expect(result.gold.ask).toBe(3900);
    expect(result.gold.bid).toBe(3890);
    expect(result.updated).toBe(feed.updated);
    expect(result.unit).toBe("USD per troy ounce");
  });
  it("requires attribution and rejects invalid bid/ask ordering", () => {
    expect(() => parseStandardBullion({ ...feed, attribution: "" })).toThrow();
    expect(() => parseStandardBullion({ ...feed, metals: [{ ...feed.metals[0], bid: 3910 }] })).toThrow("bid exceeds ask");
  });
  it("rejects responses with no gold or no provider timestamp", () => {
    expect(() => parseStandardBullion({ ...feed, metals: [feed.metals[1]] })).toThrow("no XAU");
    expect(() => parseStandardBullion({ ...feed, updated: "not-a-date" })).toThrow();
  });
});

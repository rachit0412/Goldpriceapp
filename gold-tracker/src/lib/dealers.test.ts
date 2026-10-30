import { describe, expect, it } from "vitest";
import { dealerQuoteSchema, parseRaksha } from "./dealers";

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

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { valuation, type Purchase } from "./finance";
import { normalizeIndianDailyHistory, parseIndianDailyHistory } from "./india-history";

const directory = mkdtempSync(join(tmpdir(), "aurum-history-"));
process.env.DATABASE_PATH = join(directory, "history.sqlite");
const store = await import("./store");
const providers = await import("./market");
beforeEach(() => {
  store.db().exec("DELETE FROM records");
  vi.unstubAllGlobals();
  delete process.env.GOLD_API_KEY;
});
afterAll(() => {
  vi.unstubAllGlobals();
  store.db().close();
  rmSync(directory, { recursive: true, force: true });
});
describe("historical finance", () => {
  it("parses published Indian chart dates and prices without inventing weekends", () => {
    const chart = JSON.stringify({ labels: ["23/10/2026", "26/10/2026"], purity999: [141630, 141710] }).replaceAll('"', "&quot;");
    const html = `<body>Gold rates per 10gm. Rates without 3% GST and Making Charges<input id="HdnGold" value="${chart}"><script>const label = "999 Purity Gold Rates (PM)";</script></body>`;
    expect(parseIndianDailyHistory(html)).toEqual([
      { date: "2026-10-23", inrPer10g: 141630 }, { date: "2026-10-26", inrPer10g: 141710 },
    ]);
    expect(() => parseIndianDailyHistory(html.replace("10gm", "1gm"))).toThrow("could not be verified");
    expect(() => parseIndianDailyHistory(html.replace("without 3% GST", "tax unknown"))).toThrow("could not be verified");
  });
  it("normalizes Indian daily INR prices using same-day or prior FX and no added GST", () => {
    const result = normalizeIndianDailyHistory([{ date: "2026-10-25", inrPer10g: 99900 }], [
      { date: "2026-10-23", base: "USD", quote: "INR", rate: 100 },
      { date: "2026-10-23", base: "USD", quote: "EUR", rate: 0.9 },
      { date: "2026-10-26", base: "USD", quote: "INR", rate: 200 },
      { date: "2026-10-26", base: "USD", quote: "EUR", rate: 0.8 },
    ]);
    expect(result[0].INR / 31.1034768).toBeCloseTo(10000);
    expect(result[0].EUR / 31.1034768).toBeCloseTo(90);
    expect(result[0].date).toBe("2026-10-25");
    expect(result[0].fxDate).toBe("2026-10-23");
    expect(() => normalizeIndianDailyHistory([{ date: "2026-10-25", inrPer10g: 99900 }], [])).toThrow("FX is unavailable");
  });
  it("persists only actual Indian snapshots, replaces the current hourly bucket and never fills past dates", async () => {
    const indian = await import("./dealers");
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const product = { id: "999", label: "GOLD 999 WITH GST", fineness: 999, buy: 99000, sell: 99900, gst: "Included (source label)", sourceNote: "TEST ONLY" };
    const feed = { rows: [product], retrievedAt: now, attemptedAt: now, observedAt: null, error: null, unitGrams: 10 };
    store.put("cache", "raksha-dealer", feed);
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (!input.includes("frankfurter.dev")) throw new Error("Indian history must not fetch global gold");
      return new Response(JSON.stringify([
        { date: today, base: "USD", quote: "EUR", rate: 0.9 },
        { date: today, base: "USD", quote: "INR", rate: 100 },
      ]));
    }));
    const first = await indian.indianHistory(7);
    expect(first.value).toHaveLength(1);
    expect(first.value[0].date).toBe(now);
    expect(first.observedAt).toBeNull();
    expect(first.method).toContain("Included (source label)");
    expect(store.list("raksha-history")).toHaveLength(1);
    store.put("cache", "raksha-dealer", { ...feed, rows: [{ ...product, sell: 109890 }] });
    const updated = await indian.indianHistory(7);
    expect(updated.value).toHaveLength(1);
    expect(updated.value[0].INR).toBeGreaterThan(first.value[0].INR);
    expect(store.list("raksha-history")).toHaveLength(1);
    const unavailable = await indian.indianHistory(7, "missing-product");
    expect(unavailable.value).toHaveLength(0);
    expect(unavailable.error).toContain("Selected Indian product");
  });
  it("loads a no-key seven-day Standard Bullion series including today's live midpoint", async () => {
    const now = Date.now();
    const priorTime = new Date(now - 86400000).toISOString();
    const capturedToday = new Date(now - 120000).toISOString();
    const liveTime = new Date(now - 30000).toISOString();
    const priorDate = priorTime.slice(0, 10);
    const today = liveTime.slice(0, 10);
    const rates = [
      { date: priorDate, base: "USD", quote: "EUR", rate: 0.9 },
      { date: priorDate, base: "USD", quote: "INR", rate: 90 },
      { date: today, base: "USD", quote: "EUR", rate: 0.8 },
      { date: today, base: "USD", quote: "INR", rate: 80 },
    ];
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      calls.push(input);
      if (input.includes("/market/history")) return new Response(JSON.stringify({
        source: "Standard Bullion", unit: "USD per troy ounce", grain: "tick",
        points: [
          { t: priorTime, price: 3100 },
          { t: capturedToday, price: 3000 },
        ],
      }));
      if (input.includes("spot-prices.json")) return new Response(JSON.stringify({
        source: "Standard Bullion", url: "https://standardbullion.com", unit: "USD per troy ounce",
        updated: liveTime, attribution: "Data by Standard Bullion", disclaimer: "Indicative",
        metals: [{ symbol: "XAU", page: "https://standardbullion.com/spot-gold-price", ask: 3010, bid: 2990, open: 3000, changeToday: { amount: 0, percent: 0 }, changes: { "1w": 0, "1m": 0, "1y": 0 } }],
      }));
      if (input.includes("frankfurter.dev")) return new Response(JSON.stringify(rates));
      throw new Error(`Unexpected history dependency: ${input}`);
    }));
    const result = await providers.history(7);
    expect(result.error).toBeNull();
    expect(result.value).toHaveLength(3);
    expect(result.value?.at(-1)).toMatchObject({ date: liveTime, usd: 3000, EUR: 2400, INR: 240000, fxDate: today });
    expect(result.method).toContain("Standard Bullion");
    expect(result.stale).toBe(false);
    expect(calls.some((url) => url.includes("range=7d"))).toBe(true);
    expect(calls.some((url) => url.includes("spot-prices.json"))).toBe(true);
  });
  it("converts real observations with dated FX and appends a newer current quote", () => {
    const points = providers.normalizeStandardHistory(
      [
        { t: "2026-10-23T23:00:00Z", price: 4000 },
        { t: "2026-10-30T21:00:00Z", price: 3900 },
      ],
      [
        { date: "2026-10-23", base: "USD", quote: "EUR", rate: 0.9 },
        { date: "2026-10-23", base: "USD", quote: "INR", rate: 90 },
        { date: "2026-10-30", base: "USD", quote: "EUR", rate: 0.8 },
        { date: "2026-10-30", base: "USD", quote: "INR", rate: 80 },
      ],
      Date.parse("2026-10-23T22:00:00Z"),
      Date.parse("2026-10-30T22:00:00Z"),
      { t: "2026-10-30T21:20:00Z", price: 3950 },
    );
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ date: "2026-10-23T23:00:00Z", EUR: 3600, INR: 360000, fxDate: "2026-10-23" });
    expect(points.at(-1)).toMatchObject({ date: "2026-10-30T21:20:00Z", usd: 3950, EUR: 3160, INR: 316000, fxDate: "2026-10-30" });
  });
  it("does not append an older live quote or include observations outside the selected window", () => {
    const points = providers.normalizeStandardHistory(
      [
        { t: "2026-10-22T21:00:00Z", price: 5000 },
        { t: "2026-10-30T21:00:00Z", price: 3900 },
      ],
      [
        { date: "2026-10-30", base: "USD", quote: "EUR", rate: 0.8 },
        { date: "2026-10-30", base: "USD", quote: "INR", rate: 80 },
      ],
      Date.parse("2026-10-23T00:00:00Z"),
      Date.parse("2026-10-30T22:00:00Z"),
      { t: "2026-10-30T20:00:00Z", price: 5000 },
    );
    expect(points).toHaveLength(1);
    expect(points[0].usd).toBe(3900);
  });
  it("converts every real observation with its dated FX and appends a newer current quote", async () => {
    const now = Date.parse("2026-10-30T21:30:00Z");
    const fx = [
      { date: "2026-10-23", base: "USD", quote: "EUR", rate: 0.9 },
      { date: "2026-10-23", base: "USD", quote: "INR", rate: 90 },
      { date: "2026-10-30", base: "USD", quote: "EUR", rate: 0.8 },
      { date: "2026-10-30", base: "USD", quote: "INR", rate: 80 },
    ];
    const points = providers.normalizeStandardHistory(
      [
        { t: "2026-10-23T23:00:00Z", price: 4000 },
        { t: "2026-10-30T21:00:00Z", price: 3900 },
      ],
      fx,
      Date.parse("2026-10-23T22:00:00Z"),
      now,
      { t: "2026-10-30T21:20:00Z", price: 3950 },
    );
    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({ date: "2026-10-23T23:00:00Z", EUR: 3600, INR: 360000, fxDate: "2026-10-23" });
    expect(points.at(-1)).toMatchObject({ date: "2026-10-30T21:20:00Z", usd: 3950, EUR: 3160, INR: 316000, fxDate: "2026-10-30" });
  });
  it("does not append a live point older than the last history observation or outside the range", () => {
    const fx = [
      { date: "2026-10-30", base: "USD", quote: "EUR", rate: 0.8 },
      { date: "2026-10-30", base: "USD", quote: "INR", rate: 80 },
    ];
    const points = providers.normalizeStandardHistory(
      [{ t: "2026-10-30T21:00:00Z", price: 3900 }],
      fx,
      Date.parse("2026-10-23T21:00:00Z"),
      Date.parse("2026-10-30T22:00:00Z"),
      { t: "2026-10-30T20:00:00Z", price: 5000 },
    );
    expect(points).toHaveLength(1);
    expect(points[0].usd).toBe(3900);
  });
  it("uses preceding historical FX, never current FX", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { date: "2025-01-03", base: "USD", quote: "EUR", rate: 0.8 },
              { date: "2025-01-03", base: "USD", quote: "INR", rate: 80 },
            ]),
          ),
      ),
    );
    const result = await providers.historicalFx("2025-01-05");
    expect(result?.date).toBe("2025-01-03");
    expect(result?.rates.EUR).toBe(0.8);
  });
  it("rejects historical FX from after the selected date", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              { date: "2025-01-06", base: "USD", quote: "EUR", rate: 0.8 },
              { date: "2025-01-06", base: "USD", quote: "INR", rate: 80 },
            ]),
          ),
      ),
    );
    expect(await providers.historicalFx("2025-01-05")).toBeNull();
  });
  it("does not invent a historical gold baseline without a key", async () => {
    expect(await providers.historicalGold("2025-01-03")).toBeNull();
  });
  it("parses the documented daily-average history response", async () => {
    process.env.GOLD_API_KEY = "test-only-key";
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([{ day: "2025-01-03", avg_price: 2600 }])),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await providers.historicalGold("2025-01-05");
    expect(result?.price).toBe(2600);
    expect(result?.date).toBe("2025-01-03");
    await providers.historicalGold("2025-01-05");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("enforces a persistent hourly provider budget", async () => {
    store.put("usage", "history", Array(8).fill(Date.now()));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      providers.fetchJson("https://api.gold-api.com/history?symbol=XAU"),
    ).rejects.toThrow("budget");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("separates pure gold benchmark return from holding costs and FX", () => {
    const purchase: Purchase = {
      id: "test",
      date: "2025-01-03",
      country: "India",
      product: "Bullion",
      purity: 24,
      weight: 10,
      currency: "INR",
      cost: 80000,
      charges: 1000,
      label: "",
    };
    const result = valuation(
      purchase,
      3000,
      { USD: 1, EUR: 0.9, INR: 90 },
      { USD: 1, EUR: 0.8, INR: 80 },
      "EUR",
      2500,
    );
    expect(result.goldBenchmarkReturnPct).toBeCloseTo(20);
    expect(result.goldEffect! + result.fxEffect!).toBeCloseTo(result.gain!);
    expect(
      valuation(purchase, 3000, { USD: 1, EUR: 0.9, INR: 90 }, null, "EUR")
        .goldBenchmarkReturnPct,
    ).toBeNull();
  });
});

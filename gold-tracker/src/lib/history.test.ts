import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { valuation, type Purchase } from "./finance";

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

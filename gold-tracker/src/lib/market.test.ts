import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Alert } from "./finance";
import type { Cached } from "./market";

const directory = mkdtempSync(join(tmpdir(), "aurum-test-"));
process.env.DATABASE_PATH = join(directory, "test.sqlite");
const store = await import("./store");
const providers = await import("./market");
const { evaluateAlerts } = await import("./alerts");
const now = () => new Date().toISOString();
function goodFetch() {
  return vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("gold-api") ? { price: 3000, symbol: "XAU", currency: "USD", updatedAt: now() } : [{ date: now().slice(0, 10), base: "USD", quote: "EUR", rate: 0.9 }, { date: now().slice(0, 10), base: "USD", quote: "INR", rate: 90 }]), { status: 200 }));
}
beforeEach(() => { store.db().exec("DELETE FROM records"); vi.unstubAllGlobals(); delete process.env.ALERT_WEBHOOK_URL; delete process.env.GOLD_API_KEY; });
afterAll(() => { vi.unstubAllGlobals(); store.db().close(); rmSync(directory, { recursive: true, force: true }); });
describe("persistent provider cache", () => {
  it("validates real response shapes and coalesces concurrent refreshes", async () => {
    const fetch = goodFetch(); vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([providers.market(), providers.market()]);
    expect(first.gold.value?.price).toBe(3000); expect(second.fx.value?.rates.INR).toBe(90); expect(first.gold.stale).toBe(false); expect(fetch).toHaveBeenCalledTimes(2);
    await providers.market(); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("retains cached values and marks them stale on provider failure", async () => {
    vi.stubGlobal("fetch", goodFetch()); await providers.market();
    const saved = store.get<Cached<{ price: number }>>("cache", "spot")!;
    store.put("cache", "spot", { ...saved, attemptedAt: "2000-01-01T00:00:00Z" });
    const fail = vi.fn(async () => new Response("limited", { status: 429 })); vi.stubGlobal("fetch", fail);
    const result = await providers.market(); expect(result.gold.value?.price).toBe(3000); expect(result.gold.stale).toBe(true); expect(result.gold.retrievedAt).toBe(saved.retrievedAt); expect(result.gold.error).toContain("429");
    await providers.market(); expect(fail).toHaveBeenCalledTimes(1);
  });
  it("shows unavailable instead of substituting malformed prices", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ price: -1 }))));
    const result = await providers.market(); expect(result.gold.value).toBeNull(); expect(result.fx.value).toBeNull(); expect(result.gold.stale).toBe(true);
  });
  it("keeps independent partial-data states", async () => {
    const fetch = goodFetch(); vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("frankfurter") ? Promise.resolve(new Response("failure", { status: 503 })) : fetch(url)));
    const result = await providers.market(); expect(result.gold.value).not.toBeNull(); expect(result.fx.value).toBeNull();
  });
  it("does not refresh old provider observations into freshness", async () => {
    const fetch = goodFetch(); vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("gold-api") ? Promise.resolve(new Response(JSON.stringify({ symbol: "XAU", price: 3000, updatedAt: "2000-01-01T00:00:00Z" }))) : fetch(url)));
    const result = await providers.market(); expect(result.gold.stale).toBe(true); expect(store.list("observations")).toHaveLength(0);
  });
  it("rolls back atomic imports", () => { expect(() => store.atomic(() => { store.put("purchases", "test", { id: "test" }); throw new Error("rollback"); })).toThrow(); expect(store.list("purchases")).toHaveLength(0); });
});
describe("persistent monitoring", () => {
  const alert: Alert = { id: "target", country: "India", priceType: "Spot estimate", purity: 24, currency: "INR", unit: "gram", direction: "above", threshold: 1 };
  it("persists a one-shot trigger and deduplicates concurrent evaluations", async () => {
    vi.stubGlobal("fetch", goodFetch()); store.put("alerts", alert.id, alert);
    await Promise.all([evaluateAlerts(), evaluateAlerts()]); await evaluateAlerts();
    expect(store.get<Alert>("alerts", alert.id)?.triggeredAt).toBeTruthy(); expect(store.list("notifications")).toHaveLength(1);
  });
  it("never triggers on stale observations", async () => {
    store.put("alerts", alert.id, alert);
    const fetch = goodFetch(); vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("gold-api") ? Promise.resolve(new Response(JSON.stringify({ symbol: "XAU", price: 3000, updatedAt: "2000-01-01T00:00:00Z" }))) : fetch(url)));
    await evaluateAlerts(); expect(store.list("notifications")).toHaveLength(0); expect(store.get<Alert>("alerts", alert.id)?.triggeredAt).toBeUndefined();
  });
});
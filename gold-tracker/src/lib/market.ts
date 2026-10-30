import { z } from "zod";
import { get, put } from "./store";
import { isStale, type Rates } from "./finance";

function seconds(name: string, fallback: number, minimum: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}
export const config = {
  refreshSeconds: seconds("REFRESH_SECONDS", 300, 30),
  staleSeconds: seconds("STALE_SECONDS", 3600, 60),
  fxStaleSeconds: seconds("FX_STALE_SECONDS", 345600, 86400),
};
export type Cached<T> = {
  value: T | null;
  observedAt: string | null;
  retrievedAt: string | null;
  attemptedAt: string;
  error: string | null;
  source: string;
};
type Spot = { price: number };
type Fx = { rates: Rates };
const spotSchema = z.object({
  price: z.number().positive(),
  symbol: z.literal("XAU"),
  currency: z.literal("USD").optional(),
  updatedAt: z.iso.datetime(),
});
const fxSchema = z.array(
  z.object({
    date: z.iso.date(),
    base: z.literal("USD"),
    quote: z.enum(["EUR", "INR"]),
    rate: z.number().positive(),
  }),
);
const historySchema = z.array(
  z.object({ day: z.iso.date(), avg_price: z.number().positive() }),
);
const inFlight = new Map<string, Promise<unknown>>();
export async function fetchJson(url: string, headers?: Record<string, string>) {
  if (url.startsWith("https://api.gold-api.com/history")) {
    const now = Date.now();
    const requests = (get<number[]>("usage", "history") || []).filter(
      (timestamp) => timestamp > now - 3600000,
    );
    if (requests.length >= 8)
      throw new Error(
        "Local history budget reached (8 requests/hour); retry after cooldown.",
      );
    put("usage", "history", [...requests, now]);
  }
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
}
async function cached<T>(
  key: string,
  source: string,
  ttl: number,
  load: () => Promise<{ value: T; observedAt: string }>,
): Promise<Cached<T>> {
  const old = get<Cached<T>>("cache", key);
  if (
    old &&
    Date.now() - Date.parse(old.attemptedAt) <
      (old.error ? Math.min(ttl, 3600) : ttl) * 1000
  )
    return old;
  if (inFlight.has(key)) return inFlight.get(key) as Promise<Cached<T>>;
  const task = (async () => {
    let result: Cached<T>;
    const now = new Date().toISOString();
    try {
      const fresh = await load();
      result = {
        ...fresh,
        retrievedAt: now,
        attemptedAt: now,
        source,
        error: null,
      };
    } catch (error) {
      result = {
        value: old?.value ?? null,
        observedAt: old?.observedAt ?? null,
        retrievedAt: old?.retrievedAt ?? null,
        attemptedAt: now,
        source,
        error: error instanceof Error ? error.message : "Provider unavailable",
      };
    }
    put("cache", key, result);
    return result;
  })();
  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}
export function stale<T>(entry: Cached<T>, maxSeconds: number) {
  return (
    !entry.value ||
    !!entry.error ||
    !entry.observedAt ||
    !entry.retrievedAt ||
    isStale(entry.observedAt, entry.retrievedAt, maxSeconds * 1000)
  );
}
function parseRates(raw: unknown) {
  const rows = fxSchema.parse(raw);
  const dates = [...new Set(rows.map((row) => row.date))].sort().reverse();
  for (const date of dates) {
    const eur = rows.find((row) => row.date === date && row.quote === "EUR");
    const inr = rows.find((row) => row.date === date && row.quote === "INR");
    if (eur && inr)
      return { rates: { USD: 1, EUR: eur.rate, INR: inr.rate }, date };
  }
  throw new Error("Provider omitted EUR or INR rates");
}
export async function market() {
  const [gold, fx] = await Promise.all([
    cached<Spot>(
      "spot",
      "gold-api.com · XAU/USD spot",
      config.refreshSeconds,
      async () => {
        const data = spotSchema.parse(
          await fetchJson("https://api.gold-api.com/price/XAU"),
        );
        return { value: { price: data.price }, observedAt: data.updatedAt };
      },
    ),
    cached<Fx>(
      "fx",
      "Frankfurter · daily blended reference FX",
      21600,
      async () => {
        const data = parseRates(
          await fetchJson(
            "https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,INR",
          ),
        );
        return {
          value: { rates: data.rates },
          observedAt: `${data.date}T00:00:00Z`,
        };
      },
    ),
  ]);
  if (gold.value && gold.observedAt && !stale(gold, config.staleSeconds))
    put("observations", gold.observedAt.slice(0, 10), {
      date: gold.observedAt.slice(0, 10),
      price: gold.value.price,
    });
  return {
    gold: { ...gold, stale: stale(gold, config.staleSeconds) },
    fx: { ...fx, stale: stale(fx, config.fxStaleSeconds) },
  };
}
export async function historicalFx(
  date: string,
): Promise<{ rates: Rates; date: string } | null> {
  const from = new Date(`${date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 7);
  const data = await cached(
    `fx-${date}`,
    "Frankfurter historical daily FX",
    86400 * 30,
    async () => {
      const result = parseRates(
        await fetchJson(
          `https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,INR&from=${from.toISOString().slice(0, 10)}&to=${date}`,
        ),
      );
      if (result.date > date || result.date < from.toISOString().slice(0, 10))
        throw new Error("FX observation outside requested date range");
      return { value: result, observedAt: `${result.date}T00:00:00Z` };
    },
  );
  return data.value;
}
export type HistoryPoint = {
  date: string;
  usd: number;
  EUR: number;
  INR: number;
  fxDate: string;
};
export async function historicalGold(
  date: string,
): Promise<{ price: number; date: string; method: string } | null> {
  if (date >= new Date().toISOString().slice(0, 10)) return null;
  const observation = get<{ date: string; price: number }>(
    "observations",
    date,
  );
  if (observation)
    return { ...observation, method: "Collected daily observation" };
  if (!process.env.GOLD_API_KEY) return null;
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 7);
  const entry = await cached(
    `gold-${date}`,
    "gold-api.com historical daily average",
    86400 * 30,
    async () => {
      const end = Date.parse(`${date}T23:59:59Z`);
      const rows = historySchema.parse(
        await fetchJson(
          `https://api.gold-api.com/history?symbol=XAU&startTimestamp=${Math.floor(start.getTime() / 1000)}&endTimestamp=${Math.floor(end / 1000)}&groupBy=day&aggregation=avg&orderBy=asc`,
          { "x-api-key": process.env.GOLD_API_KEY! },
        ),
      );
      const result = rows
        .filter(
          (row) => row.day <= date && Date.parse(row.day) >= start.getTime(),
        )
        .sort((first, second) => first.day.localeCompare(second.day))
        .at(-1);
      if (!result)
        throw new Error("No historical gold benchmark available within 7 days");
      return {
        value: {
          price: result.avg_price,
          date: result.day,
          method: "Provider daily average",
        },
        observedAt: `${result.day}T00:00:00Z`,
      };
    },
  );
  return entry.value;
}
export async function history(days: number) {
  await market();
  const to = new Date().toISOString().slice(0, 10);
  const start = new Date(`${to}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const from = start.toISOString().slice(0, 10);
  const entry = await cached<HistoryPoint[]>(
    `history-${process.env.GOLD_API_KEY ? "api" : "collected"}-${days}-${to}`,
    "gold-api.com daily average + Frankfurter historical FX",
    21600,
    async () => {
      const { list } = await import("./store");
      let prices = list<{ date: string; price: number }>("observations").filter(
        (row) => row.date >= from && row.date <= to,
      );
      if (process.env.GOLD_API_KEY) {
        const url = `https://api.gold-api.com/history?symbol=XAU&startTimestamp=${Math.floor(start.getTime() / 1000)}&endTimestamp=${Math.floor(Date.now() / 1000)}&groupBy=day&aggregation=avg&orderBy=asc`;
        prices = historySchema
          .parse(
            await fetchJson(url, { "x-api-key": process.env.GOLD_API_KEY }),
          )
          .map((row) => ({ date: row.day, price: row.avg_price }));
      }
      prices = prices.filter((row) => row.date >= from && row.date <= to);
      if (!prices.length)
        return { value: [], observedAt: new Date().toISOString() };
      const fxStart = new Date(start);
      fxStart.setUTCDate(fxStart.getUTCDate() - 7);
      const fx = fxSchema.parse(
        await fetchJson(
          `https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,INR&from=${fxStart.toISOString().slice(0, 10)}&to=${to}`,
        ),
      );
      const points: HistoryPoint[] = [];
      for (const price of prices.sort((first, second) =>
        first.date.localeCompare(second.date),
      )) {
        const observations = fx
          .filter((row) => row.date <= price.date)
          .sort((first, second) => second.date.localeCompare(first.date));
        const eur = observations.find((row) => row.quote === "EUR");
        const inr = observations.find((row) => row.quote === "INR");
        if (
          eur &&
          inr &&
          Date.parse(price.date) - Date.parse(eur.date) <= 7 * 86400000 &&
          eur.date === inr.date
        )
          points.push({
            date: price.date,
            usd: price.price,
            EUR: price.price * eur.rate,
            INR: price.price * inr.rate,
            fxDate: eur.date,
          });
      }
      return {
        value: points,
        observedAt: points.length
          ? `${points.at(-1)!.date}T00:00:00Z`
          : new Date().toISOString(),
      };
    },
  );
  return {
    ...entry,
    authenticated: !!process.env.GOLD_API_KEY,
    method: process.env.GOLD_API_KEY
      ? "Daily average (not closing price)"
      : "Last fresh observation collected each UTC day; no backfill without GOLD_API_KEY",
    stale:
      !!entry.error ||
      !entry.retrievedAt ||
      Date.now() - Date.parse(entry.retrievedAt) > 86400000,
  };
}

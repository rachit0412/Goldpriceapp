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
const standardHistorySchema = z.object({
  source: z.literal("Standard Bullion"),
  unit: z.literal("USD per troy ounce"),
  grain: z.string().min(1),
  points: z.array(z.object({ t: z.iso.datetime(), price: z.number().positive() })),
});
const standardBullionSchema = z.object({
  source: z.literal("Standard Bullion"),
  url: z.url(),
  unit: z.literal("USD per troy ounce"),
  updated: z.iso.datetime(),
  attribution: z.string().min(1),
  disclaimer: z.string().min(1),
  metals: z.array(z.object({
    symbol: z.string(),
    page: z.url(),
    ask: z.number().positive(),
    bid: z.number().positive(),
    open: z.number().positive(),
    changeToday: z.object({ amount: z.number(), percent: z.number() }),
    changes: z.object({ "1w": z.number(), "1m": z.number(), "1y": z.number() }),
  })).min(1),
});
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
export type StandardBullionQuote = {
  source: string;
  url: string;
  unit: "USD per troy ounce";
  updated: string;
  attribution: string;
  disclaimer: string;
  gold: {
    symbol: "XAU";
    ask: number;
    bid: number;
    open: number;
    changeToday: { amount: number; percent: number };
    changes: { "1w": number; "1m": number; "1y": number };
    page: string;
  };
};
export type StandardBullionFeed = Cached<StandardBullionQuote> & { stale: boolean };
export function parseStandardBullion(raw: unknown): StandardBullionQuote {
  const feed = standardBullionSchema.parse(raw);
  const gold = feed.metals.find((metal) => metal.symbol === "XAU");
  if (!gold) throw new Error("Standard Bullion response has no XAU quote");
  if (gold.bid > gold.ask) throw new Error("Standard Bullion bid exceeds ask");
  return { ...feed, gold: { ...gold, symbol: "XAU" } };
}
export async function standardBullion(): Promise<StandardBullionFeed> {
  const entry = await cached<StandardBullionQuote>(
    "standard-bullion-spot",
    "Standard Bullion · live USD dealer bid/ask",
    30,
    async () => {
      const quote = parseStandardBullion(
        await fetchJson("https://standardbullion.com/spot-prices.json"),
      );
      return { value: quote, observedAt: quote.updated };
    },
  );
  return { ...entry, stale: stale(entry, Math.min(config.staleSeconds, 120)) };
}
export async function cached<T>(
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
export type StandardHistoryPrice = { t: string; price: number };
export function normalizeStandardHistory(
  prices: StandardHistoryPrice[],
  fxRaw: unknown,
  fromTime: number,
  toTime: number,
  liveMid?: StandardHistoryPrice,
): HistoryPoint[] {
  const candidates = prices.filter((point) => {
    const observed = Date.parse(point.t);
    return Number.isFinite(observed) && observed >= fromTime && observed <= toTime;
  });
  if (
    liveMid &&
    Date.parse(liveMid.t) >= fromTime &&
    Date.parse(liveMid.t) <= toTime
  ) {
    const last = candidates.reduce<StandardHistoryPrice | null>(
      (latest, point) =>
        !latest || Date.parse(point.t) > Date.parse(latest.t) ? point : latest,
      null,
    );
    if (!last || Date.parse(liveMid.t) > Date.parse(last.t))
      candidates.push(liveMid);
  }
  candidates.sort((first, second) => Date.parse(first.t) - Date.parse(second.t));
  const fx = fxSchema.parse(fxRaw);
  const output: HistoryPoint[] = [];
  for (const point of candidates) {
    const date = point.t.slice(0, 10);
    const eligible = fx
      .filter((row) => row.date <= date)
      .sort((first, second) => second.date.localeCompare(first.date));
    const eur = eligible.find((row) => row.quote === "EUR");
    const inr = eligible.find((row) => row.quote === "INR");
    if (!eur || !inr || eur.date !== inr.date) continue;
    const fxAge =
      Date.parse(`${date}T00:00:00Z`) - Date.parse(`${eur.date}T00:00:00Z`);
    if (fxAge < 0 || fxAge > 7 * 86400000) continue;
    output.push({
      date: point.t,
      usd: point.price,
      EUR: point.price * eur.rate,
      INR: point.price * inr.rate,
      fxDate: eur.date,
    });
  }
  return output;
}
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
  const ranges: Record<number, string> = {
    7: "7d",
    30: "1m",
    90: "3m",
    365: "1y",
  };
  const range = ranges[days];
  if (!range) throw new Error("Unsupported history range");
  const now = Date.now();
  const fromTime = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`) - (days - 1) * 86400000;
  const from = new Date(fromTime).toISOString().slice(0, 10);
  const to = new Date(now).toISOString().slice(0, 10);
  const fxStart = new Date(`${from}T00:00:00Z`);
  fxStart.setUTCDate(fxStart.getUTCDate() - 7);
  const entry = await cached<HistoryPoint[]>(
    `standard-history-calendar-${days}-${to}`,
    "Standard Bullion captured XAU history + Frankfurter historical FX",
    60,
    async () => {
      const [rawHistory, current, fxRaw] = await Promise.all([
        fetchJson(
          `https://standardbullion.com/api/v1/market/history?metal=XAU&range=${range}`,
        ),
          standardBullion(),
        fetchJson(
          `https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,INR&from=${fxStart.toISOString().slice(0, 10)}&to=${to}`,
        ),
      ]);
      const source = standardHistorySchema.parse(rawHistory);
      const points = normalizeStandardHistory(
        source.points,
        fxRaw,
        fromTime,
        now,
        current.value && !current.stale
          ? {
              t: current.value.updated,
              price:
                (current.value.gold.ask + current.value.gold.bid) / 2,
            }
          : undefined,
      );
      if (!points.length)
        throw new Error("No gold observations have matching historical FX in this range");
      return { value: points, observedAt: points.at(-1)!.date };
    },
  );
  const staleHistory =
    !!entry.error ||
    !entry.value?.length ||
    !entry.retrievedAt ||
    !entry.observedAt ||
    isStale(
      entry.observedAt,
      entry.retrievedAt,
      Math.min(config.staleSeconds, 3600) * 1000,
    );
  return {
    ...entry,
    method:
      "Standard Bullion captured XAU history; live bid/ask midpoint appended when newer. Frankfurter dated daily FX.",
    stale: staleHistory,
  };
}

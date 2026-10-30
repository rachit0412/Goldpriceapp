import Papa from "papaparse";
import { z } from "zod";
import { db, get, list, put } from "./store";
import { config, historicalFx, standardBullion, type HistoryPoint } from "./market";
import { convert, TROY_OUNCE, type Rates } from "./finance";
export { parseStandardBullion } from "./market";
export type { StandardBullionQuote } from "./market";

export const RAKSHA_URL = "https://rakshabullion.com/liverates.html";
export const RAKSHA_FEED =
  "https://bcast.rakshabullion.com:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/raksha";
export const dealerQuoteSchema = z.object({
  country: z.enum(["India", "Netherlands"]),
  dealer: z.string().trim().min(1).max(100),
  sourceUrl: z
    .url()
    .refine((value) => ["https:", "http:"].includes(new URL(value).protocol)),
  product: z.enum(["Bullion", "Jewellery"]),
  description: z.string().trim().min(1).max(160),
  fineness: z.coerce
    .number()
    .refine((value) => [750, 916, 916.7, 995, 999, 999.9].includes(value)),
  weight: z.coerce.number().positive().max(1000000),
  currency: z.enum(["INR", "EUR"]),
  total: z.coerce.number().positive().max(1e12),
  taxStatus: z.enum([
    "Included",
    "Excluded",
    "Exempt (dealer stated)",
    "Unknown",
  ]),
  observedAt: z.iso
    .datetime()
    .refine(
      (value) => Date.parse(value) <= Date.now() + 300000,
      "Observation cannot be in the future",
    ),
});
export type DealerQuote = z.infer<typeof dealerQuoteSchema> & { id: string };
export type RakshaRow = {
  id: string;
  label: string;
  fineness: 995 | 999;
  buy: number | null;
  sell: number | null;
  gst: "Included (source label)" | "Not stated";
  sourceNote: string;
};
export type DealerFeed = {
  rows: RakshaRow[];
  observedAt: null;
  retrievedAt: string | null;
  attemptedAt: string;
  error: string | null;
  unitGrams: number | null;
};
export function rakshaUnitGrams(value = process.env.RAKSHA_QUOTE_GRAMS) {
  if (value === undefined || value.trim() === "") return 10;
  const grams = Number(value);
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}
export function parseRaksha(text: string): RakshaRow[] {
  const parsed = Papa.parse<string[]>(text, {
    delimiter: "\t",
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length)
    throw new Error("Raksha returned an invalid tab-separated response");
  const positive = (value: string | undefined) =>
    value && /^\d+(?:\.\d+)?$/.test(value.trim()) && Number(value) > 0
      ? Number(value)
      : null;
  const rows: RakshaRow[] = [];
  for (const cells of parsed.data) {
    const label = cells[2]?.trim();
    const match = label?.match(/^GOLD\s+(995|999)(?:\s|\()/i);
    if (!match || !cells[1]?.trim()) continue;
    const buy = positive(cells[3]);
    const sell = positive(cells[4]);
    if (buy === null && sell === null) continue;
    rows.push({
      id: cells[1].trim(),
      label: label!,
      fineness: Number(match[1]) as 995 | 999,
      buy,
      sell,
      gst: /WITH\s*GST/i.test(label!)
        ? "Included (source label)"
        : "Not stated",
      sourceNote: cells[7]?.trim() || "Not supplied",
    });
  }
  if (!rows.length)
    throw new Error("Raksha feed contained no verified 995/999 price rows");
  return rows;
}
let pending: Promise<DealerFeed> | undefined;
export async function rakshaRates(): Promise<DealerFeed> {
  const previous = get<DealerFeed>("cache", "raksha-dealer");
  const unitGrams = rakshaUnitGrams();
  if (previous && Date.now() - Date.parse(previous.attemptedAt) < 60000)
    return { ...previous, unitGrams };
  if (pending) return pending;
  pending = (async () => {
    const attemptedAt = new Date().toISOString();
    let result: DealerFeed;
    try {
      const response = await fetch(RAKSHA_FEED, {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        headers: { Accept: "text/plain" },
      });
      if (!response.ok)
        throw new Error(`Raksha feed returned HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > 200000)
        throw new Error("Unexpected Raksha response size");
      result = {
        rows: parseRaksha(text),
        observedAt: null,
        retrievedAt: new Date().toISOString(),
        attemptedAt,
        error: null,
        unitGrams,
      };
    } catch (error) {
      result = {
        rows: previous?.rows || [],
        observedAt: null,
        retrievedAt: previous?.retrievedAt || null,
        attemptedAt,
        error:
          error instanceof Error ? error.message : "Raksha feed unavailable",
        unitGrams,
      };
    }
    put("cache", "raksha-dealer", result);
    return result;
  })();
  try {
    return await pending;
  } finally {
    pending = undefined;
  }
}
export type RakshaObservation = {
  date: string;
  product: RakshaRow;
  unitGrams: number;
  rates: Rates;
  fxDate: string;
};
export function normalizeRakshaObservation(observation: RakshaObservation): HistoryPoint | null {
  if (!observation.product.sell || observation.unitGrams <= 0) return null;
  const inrOunce = observation.product.sell / observation.unitGrams / (observation.product.fineness / 1000) * TROY_OUNCE;
  return {
    date: observation.date,
    INR: inrOunce,
    EUR: convert(inrOunce, "INR", "EUR", observation.rates),
    usd: convert(inrOunce, "INR", "USD", observation.rates),
    fxDate: observation.fxDate,
  };
}
export async function collectIndianHistory() {
  const feed = await rakshaRates();
  if (feed.error || !feed.retrievedAt || !feed.unitGrams) return feed;
  const fx = await historicalFx(feed.retrievedAt.slice(0, 10));
  if (!fx) return feed;
  for (const product of feed.rows) {
    if (!product.sell) continue;
    const observation: RakshaObservation = {
      date: feed.retrievedAt, product, unitGrams: feed.unitGrams,
      rates: fx.rates, fxDate: fx.date,
    };
    put("raksha-history", `${feed.retrievedAt.slice(0, 13)}:${product.id}`, observation);
  }
  return feed;
}
export async function indianHistory(days: number, requestedProduct?: string | null) {
  const feed = await collectIndianHistory();
  const from = new Date(Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) - (days - 1) * 86400000).toISOString();
  const stored = (db().prepare("SELECT body FROM records WHERE collection=? AND id>=? ORDER BY id").all("raksha-history", from.slice(0, 13)) as { body: string }[])
    .map(row => JSON.parse(row.body) as RakshaObservation)
    .filter(row => row.date >= from && row.date <= new Date().toISOString());
  const products = [...new Map([...feed.rows, ...stored.map(row => row.product)].map(product => [product.id, product])).values()];
  const product = requestedProduct
    ? products.find(row => row.id === requestedProduct)
    : products.find(row => row.fineness === 999 && row.sell !== null) || products.find(row => row.sell !== null);
  const points = stored.filter(row => row.product.id === product?.id)
    .map(normalizeRakshaObservation).filter((point): point is HistoryPoint => point !== null)
    .sort((first, second) => Date.parse(first.date) - Date.parse(second.date));
  const latest = points.at(-1)?.date || null;
  return {
    value: points,
    country: "India",
    products: products.map(row => ({ id: row.id, label: row.label })),
    productId: product?.id || "",
    observedAt: null,
    retrievedAt: latest,
    attemptedAt: feed.attemptedAt,
    source: "Raksha Bullion · India",
    error: feed.error || (!feed.unitGrams ? "Indian source weight is unknown." : requestedProduct && !product ? "Selected Indian product is unavailable." : !latest ? "No recorded Indian SELL observations with dated FX yet." : null),
    stale: !!feed.error || !latest || Date.now() - Date.parse(latest) > Math.min(config.staleSeconds, 120) * 1000,
    method: `Raksha ${product?.label || "source"} SELL; GST: ${product?.gst || "not available"}. Hourly retained snapshots, latest refreshed every minute. Times are app retrieval, not provider observation. Source weight assumed ${feed.unitGrams || "unknown"}g; purity-normalized with dated FX. Collection starts locally; no global or fabricated backfill.`,
  };
}
export async function dealers() {
  const [raksha, standard] = await Promise.all([collectIndianHistory(), standardBullion()]);
  return {
    raksha,
    standardBullion: standard,
    quotes: list<DealerQuote>("dealer-quotes"),
  };
}

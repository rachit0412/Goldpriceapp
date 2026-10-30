import Papa from "papaparse";
import { z } from "zod";
import { get, list, put } from "./store";

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
export function parseRaksha(text: string): RakshaRow[] {
  const parsed = Papa.parse<string[]>(text, {
    delimiter: "\t",
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length)
    throw new Error("Raksha returned an invalid tab-separated response");
  const positive = (text: string | undefined) =>
    text && /^\d+(?:\.\d+)?$/.test(text.trim()) && Number(text) > 0
      ? Number(text)
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
  const configuredGrams = Number(process.env.RAKSHA_QUOTE_GRAMS);
  const unitGrams =
    configuredGrams > 0 && Number.isFinite(configuredGrams)
      ? configuredGrams
      : null;
  if (previous && Date.now() - Date.parse(previous.attemptedAt) < 600000)
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
export async function dealers() {
  return {
    raksha: await rakshaRates(),
    quotes: list<DealerQuote>("dealer-quotes"),
    netherlands: {
      source: "GoldByPost",
      url: "https://www.goldbypost.nl/goud-prijs/actuele-goudprijs-eur/",
      productsUrl: "https://www.goldbypost.nl/goudbaren/1-ounce-goudbaren/",
      status:
        "Automated retrieval unavailable: access challenge and restrictive site-use policy. No bypass or scraped prices used.",
    },
  };
}

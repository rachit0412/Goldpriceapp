import { load } from "cheerio";
import { z } from "zod";
import { cached, fetchJson, type HistoryPoint } from "./market";
import { convert, TROY_OUNCE } from "./finance";

export const IBJA_URL = "https://ibjarates.com/";
export type IndianDailyPrice = { date: string; inrPer10g: number };
const chartSchema = z.object({
  labels: z.array(z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/)).min(1),
  purity999: z.array(z.number().positive()).min(1),
}).refine(value => value.labels.length === value.purity999.length, "IBJA dates/prices length mismatch");
const fxSchema = z.array(z.object({
  date: z.iso.date(), base: z.literal("USD"),
  quote: z.enum(["EUR", "INR"]), rate: z.number().positive(),
}));

export function parseIndianDailyHistory(html: string): IndianDailyPrice[] {
  const document = load(html);
  const text = document("body").text().replace(/\s+/g, " ");
  if (!/Gold rates per 10gm\b/i.test(text) || !/without\s+3%\s+GST/i.test(text)
    || !document("script").text().includes("999 Purity Gold Rates (PM)"))
    throw new Error("IBJA price unit, tax treatment or PM series could not be verified");
  const raw = document("input#HdnGold").attr("value");
  if (!raw) throw new Error("IBJA published chart data is unavailable");
  const chart = chartSchema.parse(JSON.parse(raw));
  const points = chart.labels.map((label, index) => {
    const [day, month, year] = label.split("/");
    const date = z.iso.date().parse(`${year}-${month}-${day}`);
    if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
      throw new Error("Invalid IBJA publication date");
    return { date, inrPer10g: chart.purity999[index] };
  });
  if (new Set(points.map(point => point.date)).size !== points.length)
    throw new Error("Duplicate IBJA publication dates");
  return points.sort((first, second) => first.date.localeCompare(second.date));
}

export function normalizeIndianDailyHistory(prices: IndianDailyPrice[], rawFx: unknown): HistoryPoint[] {
  const fx = fxSchema.parse(rawFx);
  return prices.map(point => {
    const eligible = fx.filter(row => row.date <= point.date)
      .sort((first, second) => second.date.localeCompare(first.date));
    const eur = eligible.find(row => row.quote === "EUR");
    const inr = eligible.find(row => row.quote === "INR");
    if (!eur || !inr || eur.date !== inr.date
      || Date.parse(point.date) - Date.parse(eur.date) > 7 * 86400000)
      throw new Error(`Dated FX is unavailable for IBJA publication ${point.date}`);
    const rates = { USD: 1, EUR: eur.rate, INR: inr.rate };
    const inrOunce = point.inrPer10g / 10 / 0.999 * TROY_OUNCE;
    return {
      date: point.date, INR: inrOunce,
      EUR: convert(inrOunce, "INR", "EUR", rates),
      usd: convert(inrOunce, "INR", "USD", rates), fxDate: inr.date,
    };
  });
}

export async function indianDailyHistory(days: number) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = await cached<HistoryPoint[]>(
    `ibja-published-${days}-${today}`,
    "IBJA published 999 gold PM benchmark + Frankfurter dated FX",
    300,
    async () => {
      const response = await fetch(IBJA_URL, {
        cache: "no-store", signal: AbortSignal.timeout(15000), headers: { Accept: "text/html" },
      });
      if (!response.ok) throw new Error(`IBJA returned HTTP ${response.status}`);
      const html = await response.text();
      if (html.length > 2000000) throw new Error("Unexpected IBJA response size");
      const prices = parseIndianDailyHistory(html).filter(point => point.date <= today).slice(-days);
      if (!prices.length) throw new Error("No published Indian prices in the source archive");
      const from = new Date(`${prices[0].date}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 7);
      const rawFx = await fetchJson(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,INR&from=${from.toISOString().slice(0, 10)}&to=${today}`);
      const points = normalizeIndianDailyHistory(prices, rawFx);
      return { value: points, observedAt: points.at(-1)!.date };
    },
  );
  const latest = entry.value?.at(-1)?.date;
  return {
    ...entry, country: "India", grain: "daily", sourceUrl: IBJA_URL,
    stale: !!entry.error || !latest || Date.now() - Date.parse(latest) > 7 * 86400000
      || !entry.retrievedAt || Date.now() - Date.parse(entry.retrievedAt) > 600000,
    method: `IBJA official published 999 PM benchmark: ${entry.value?.length || 0} most recent published trading days (requested ${days}). INR per 10g, excluding GST and making charges; converted to selected purity with dated FX. Weekends/holidays without publication are not fabricated. Daily benchmark, not Raksha dealer or streaming tick prices. Source checked every five minutes; chart refreshes every minute.`,
  };
}
import { z } from "zod";

export const TROY_OUNCE = 31.1034768;
export type Currency = "INR" | "EUR";
export type Rates = { INR: number; EUR: number; USD: number };
export const currencySchema = z.enum(["INR", "EUR"]);
export const purityValues = [24, 22, 18, 995, 999, 999.9];
const puritySchema = z.coerce
  .number()
  .refine((value) => purityValues.includes(value));
export function purityFraction(purity: number) {
  if (!purityValues.includes(purity))
    throw new Error("Unsupported gold purity");
  return purity >= 995 ? purity / 1000 : purity / 24;
}
export function purityLabel(purity: number) {
  return purity >= 995 ? `${purity} fine` : `${purity}K`;
}
export const purchaseSchema = z.object({
  date: z.iso
    .date()
    .refine(
      (value) => value <= new Date().toISOString().slice(0, 10),
      "Date cannot be in the future",
    ),
  country: z.enum(["India", "Netherlands"]),
  product: z.enum(["Bullion", "Jewellery"]),
  purity: puritySchema,
  weight: z.coerce.number().positive().max(1000000),
  currency: currencySchema,
  cost: z.coerce.number().positive().max(1e12),
  charges: z.coerce.number().min(0).max(1e12).default(0),
  label: z.string().max(120).default(""),
});
export type Purchase = z.infer<typeof purchaseSchema> & { id: string };
export const alertSchema = z.object({
  country: z.enum(["India", "Netherlands"]),
  priceType: z.literal("Spot estimate"),
  purity: puritySchema,
  currency: currencySchema,
  unit: z.enum(["gram", "10 grams", "troy ounce"]),
  direction: z.enum(["above", "below"]),
  threshold: z.coerce.number().positive().max(1e12),
});
export type Alert = z.infer<typeof alertSchema> & {
  id: string;
  triggeredAt?: string;
  notified?: string;
};
export function convert(
  amount: number,
  from: keyof Rates,
  to: keyof Rates,
  rates: Rates,
) {
  if (!(rates[from] > 0) || !(rates[to] > 0)) throw new Error("FX unavailable");
  return (amount / rates[from]) * rates[to];
}
export function metalPrice(
  usdOunce: number,
  purity: number,
  grams: number,
  currency: Currency,
  rates: Rates,
) {
  return convert(
    (usdOunce / TROY_OUNCE) * purityFraction(purity) * grams,
    "USD",
    currency,
    rates,
  );
}
export function valuation(
  purchase: Purchase,
  spot: number,
  current: Rates,
  historical: Rates | null,
  base: Currency,
  historicalSpot: number | null = null,
) {
  const value = metalPrice(
    spot,
    purchase.purity,
    purchase.weight,
    base,
    current,
  );
  const basis = historical
    ? convert(
        purchase.cost + purchase.charges,
        purchase.currency,
        base,
        historical,
      )
    : purchase.currency === base
      ? purchase.cost + purchase.charges
      : null;
  const constantFx = historical
    ? metalPrice(spot, purchase.purity, purchase.weight, base, historical)
    : null;
  return {
    value,
    basis,
    gain: basis === null ? null : value - basis,
    returnPct: basis === null ? null : ((value - basis) / basis) * 100,
    fxEffect: constantFx === null ? null : value - constantFx,
    goldEffect:
      constantFx === null || basis === null ? null : constantFx - basis,
    goldBenchmarkReturnPct:
      historicalSpot !== null && historicalSpot > 0
        ? (spot / historicalSpot - 1) * 100
        : null,
  };
}
export type Quote = {
  country: string;
  product: string;
  purity: number;
  weight: number;
  currency: Currency;
  total: number;
  making: number;
  premium: number;
  tax: number;
  complete: boolean;
  priceType: string;
};
export function compareQuotes(
  left: Quote,
  right: Quote,
  rates: Rates,
  base: Currency,
  targetPurity: number,
  weight: number,
) {
  if (left.product !== right.product)
    throw new Error(
      "Product mismatch: bullion and jewellery cannot be compared.",
    );
  if (!left.complete || !right.complete)
    throw new Error(
      "Incomplete quote: confirm all charges are included or explicitly zero.",
    );
  if (left.priceType !== right.priceType)
    throw new Error("Price-type mismatch: compare like sources.");
  const normalized = (quote: Quote) => {
    if (
      !(quote.weight > 0) ||
      !(quote.total > 0) ||
      !purityValues.includes(quote.purity) ||
      [quote.making, quote.premium, quote.tax].some(
        (value) => !Number.isFinite(value) || value < 0,
      )
    )
      throw new Error(
        "Enter a valid weight, purity, price and nonnegative charges.",
      );
    return convert(
      (((quote.total + quote.making + quote.premium + quote.tax) /
        quote.weight) *
        purityFraction(targetPurity)) /
        purityFraction(quote.purity),
      quote.currency,
      base,
      rates,
    );
  };
  const first = normalized(left);
  const baseline = normalized(right);
  return {
    first,
    baseline,
    perGram: first - baseline,
    total: (first - baseline) * weight,
    percent: ((first - baseline) / baseline) * 100,
    higher:
      first === baseline
        ? "Equal"
        : first > baseline
          ? left.country
          : right.country,
  };
}
export function isStale(
  observed: string,
  retrieved: string,
  maxAgeMs: number,
  now = Date.now(),
) {
  return [observed, retrieved].some(
    (value) =>
      !Number.isFinite(Date.parse(value)) ||
      now - Date.parse(value) > maxAgeMs ||
      Date.parse(value) > now + 300000,
  );
}
export function shouldTrigger(alert: Alert, price: number, stale: boolean) {
  return (
    !stale &&
    !alert.triggeredAt &&
    Number.isFinite(price) &&
    (alert.direction === "above"
      ? price >= alert.threshold
      : price <= alert.threshold)
  );
}
export function unitGrams(unit: Alert["unit"]) {
  return unit === "gram" ? 1 : unit === "10 grams" ? 10 : TROY_OUNCE;
}

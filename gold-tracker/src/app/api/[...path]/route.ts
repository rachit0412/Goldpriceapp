import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  alertSchema,
  purchaseSchema,
  valuation,
  type Purchase,
} from "@/lib/finance";
import {
  config,
  historicalFx,
  historicalGold,
  history,
  market,
} from "@/lib/market";
import { atomic, db, get, list, put, remove } from "@/lib/store";
import { z } from "zod";
import { sameOrigin } from "@/lib/security";
import { dealerQuoteSchema, dealers } from "@/lib/dealers";

export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: NextRequest, context: Context) {
  try {
    const { path } = await context.params;
    if (path[0] === "health") {
      db().prepare("SELECT 1").get();
      return json({ status: "ok" });
    }
    if (path[0] === "dealers") return json(await dealers());
    if (path[0] === "history") {
      const days = Number(request.nextUrl.searchParams.get("days") || 30);
      if (![7, 30, 90, 365].includes(days))
        return json({ error: "Invalid history range" }, 400);
      return json(await history(days));
    }
    if (path[0] === "fx") {
      const date = request.nextUrl.searchParams.get("date");
      if (
        !date ||
        !z.iso.date().safeParse(date).success ||
        date > new Date().toISOString().slice(0, 10)
      )
        return json({ error: "Invalid FX date" }, 400);
      const result = await historicalFx(date);
      return result
        ? json(result)
        : json({ error: "Historical FX unavailable" }, 503);
    }
    if (path[0] === "state") {
      const prices = await market();
      const base =
        request.nextUrl.searchParams.get("base") === "INR" ? "INR" : "EUR";
      const purchases = list<Purchase>("purchases");
      const dates = [...new Set(purchases.map((row) => row.date))];
      const historical = new Map<
        string,
        Awaited<ReturnType<typeof historicalFx>>
      >();
      const historicalMetal = new Map<
        string,
        Awaited<ReturnType<typeof historicalGold>>
      >();
      for (const date of dates) {
        historical.set(date, await historicalFx(date));
        historicalMetal.set(date, await historicalGold(date));
      }
      const holdings = purchases.map((purchase) => ({
        ...purchase,
        fxDate: historical.get(purchase.date)?.date ?? null,
        goldDate: historicalMetal.get(purchase.date)?.date ?? null,
        goldMethod: historicalMetal.get(purchase.date)?.method ?? null,
        valuation:
          prices.gold.value && prices.fx.value
            ? valuation(
                purchase,
                prices.gold.value.price,
                prices.fx.value.rates,
                historical.get(purchase.date)?.rates ?? null,
                base,
                historicalMetal.get(purchase.date)?.price ?? null,
              )
            : null,
      }));
      return json({
        market: prices,
        holdings,
        alerts: list("alerts"),
        notifications: list("notifications").slice(0, 100),
        config: {
          ...config,
          historyEnabled: !!process.env.GOLD_API_KEY,
          webhookEnabled: !!process.env.ALERT_WEBHOOK_URL,
        },
        base,
      });
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: "Unable to read local data" }, 500);
  }
}
async function mutate(request: NextRequest, context: Context) {
  if (
    !sameOrigin(
      request.headers.get("origin"),
      request.headers.get("host"),
      request.nextUrl.protocol,
    )
  )
    return json({ error: "Same-origin requests required" }, 403);
  try {
    const { path } = await context.params;
    const collection = path[0];
    if (!["purchases", "alerts", "dealer-quotes"].includes(collection))
      return json({ error: "Not found" }, 404);
    if (request.method === "DELETE") {
      if (!path[1]) return json({ error: "Missing id" }, 400);
      return remove(collection, path[1])
        ? json({ ok: true })
        : json({ error: "Not found" }, 404);
    }
    if (Number(request.headers.get("content-length")) > 524288)
      return json({ error: "Import too large" }, 413);
    const text = await request.text();
    if (Buffer.byteLength(text) > 524288)
      return json({ error: "Import too large" }, 413);
    const raw: unknown = JSON.parse(text);
    if (collection === "purchases" && path[1] === "import") {
      const rows = z.array(purchaseSchema).min(1).max(500).parse(raw);
      atomic(() => {
        for (const row of rows) {
          const id = randomUUID();
          put(collection, id, { ...row, id });
        }
      });
      return json({ imported: rows.length });
    }
    const row =
      collection === "dealer-quotes"
        ? dealerQuoteSchema.parse(raw)
        : collection === "purchases"
          ? purchaseSchema.parse(raw)
          : alertSchema.parse(raw);
    if (request.method === "PUT" && (!path[1] || !get(collection, path[1])))
      return json({ error: "Not found" }, 404);
    const id = request.method === "PUT" ? path[1] : randomUUID();
    put(collection, id, { ...row, id });
    return json({ ...row, id }, request.method === "POST" ? 201 : 200);
  } catch (error) {
    return json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues
                .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
                .join("; ")
            : "Invalid request",
      },
      400,
    );
  }
}
export const POST = mutate;
export const PUT = mutate;
export const DELETE = mutate;

import { randomUUID } from "node:crypto";
import {
  metalPrice,
  purityLabel,
  shouldTrigger,
  unitGrams,
  type Alert,
} from "./finance";
import { market } from "./market";
import { atomic, get, list, put } from "./store";

export async function evaluateAlerts() {
  const prices = await market();
  if (
    !prices.gold.value ||
    !prices.fx.value ||
    prices.gold.stale ||
    prices.fx.stale
  )
    return;
  for (const alert of list<Alert>("alerts")) {
    const price = metalPrice(
      prices.gold.value.price,
      alert.purity,
      unitGrams(alert.unit),
      alert.currency,
      prices.fx.value.rates,
    );
    let eventId: string | null = null;
    atomic(() => {
      const latest = get<Alert>("alerts", alert.id);
      if (!latest || !shouldTrigger(latest, price, false)) return;
      const now = new Date().toISOString();
      eventId = randomUUID();
      put("alerts", latest.id, { ...latest, triggeredAt: now });
      put("notifications", eventId, {
        id: eventId,
        at: now,
        alertId: latest.id,
        message: `${latest.country} ${purityLabel(latest.purity)} spot estimate reached ${price.toFixed(2)} ${latest.currency}/${latest.unit} (${latest.direction} ${latest.threshold}).`,
        webhook: process.env.ALERT_WEBHOOK_URL ? "pending" : "disabled",
      });
    });
    if (eventId && process.env.ALERT_WEBHOOK_URL) {
      const event = get<Record<string, unknown>>("notifications", eventId)!;
      try {
        const url = new URL(process.env.ALERT_WEBHOOK_URL);
        if (url.protocol !== "https:")
          throw new Error("Webhook requires HTTPS");
        const response = await fetch(url, {
          method: "POST",
          redirect: "error",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.ALERT_WEBHOOK_TOKEN
              ? { Authorization: `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}` }
              : {}),
            "Idempotency-Key": eventId,
          },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        put("notifications", eventId, { ...event, webhook: "sent" });
      } catch {
        put("notifications", eventId, {
          ...event,
          webhook: "failed; no automatic retry to avoid duplicate delivery",
        });
      }
    }
  }
}

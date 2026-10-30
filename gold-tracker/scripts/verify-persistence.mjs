import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const origin = process.env.TEST_URL || "http://127.0.0.1:3081";
const call = async (path, method = "GET", body) => {
  const response = await fetch(`${origin}${path}`, { method, headers: { Origin: origin, "Content-Type": "application/json", Connection: "close" }, body: body && JSON.stringify(body) });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
};
const holding = await call("/api/purchases", "POST", { date: new Date().toISOString().slice(0, 10), country: "Netherlands", product: "Bullion", purity: 24, weight: 1, currency: "EUR", cost: 100, charges: 5, label: "PERSISTENCE_CHECK" });
const alert = await call("/api/alerts", "POST", { country: "India", priceType: "Spot estimate", purity: 24, currency: "INR", unit: "gram", direction: "above", threshold: 1 });
const compose = (...args) => execFileSync("docker", ["compose", "-p", "aurum-verify", ...args], { stdio: "inherit", env: { ...process.env, HOST_PORT: "3081" } });
compose("up", "-d", "--force-recreate", "--wait");
let state = await call("/api/state");
assert.ok(state.holdings.some(row => row.id === holding.id && row.cost === 100));
assert.ok(state.alerts.some(row => row.id === alert.id));
assert.ok(state.market.gold.retrievedAt, "Cache survived recreation");
assert.ok(state.alerts.find(row => row.id === alert.id).triggeredAt, "Startup monitoring evaluated target");
assert.equal(state.notifications.filter(row => row.alertId === alert.id).length, 1);
compose("up", "-d", "--force-recreate", "--wait");
state = await call("/api/state");
assert.equal(state.notifications.filter(row => row.alertId === alert.id).length, 1, "No duplicate after recreation");
await call(`/api/purchases/${holding.id}`, "DELETE");
await call(`/api/alerts/${alert.id}`, "DELETE");
console.log("PASS: purchase, cache, target and notification persisted across two container recreations; no duplicate notification.");
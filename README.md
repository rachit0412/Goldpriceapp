# Aurum Ledger

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-07405e?logo=sqlite)](https://nodejs.org/api/sqlite.html)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](https://www.docker.com)
[![Tests](https://img.shields.io/badge/tests-unit%20%2B%20e2e-brightgreen)](gold-tracker/tests)

A self-hosted, single-user gold price tracker and portfolio ledger for **India** and the **Netherlands** — real dealer/benchmark feeds, a statistically transparent price outlook, a jewelry price estimator, and a private SQLite-backed portfolio. No account, hosted database, or AI service required.

The full application lives in **[`gold-tracker/`](gold-tracker)**.

## Features

- **Live India reference** — Raksha Bullion dealer products (995/999/999.9 fineness), exact BUY/SELL with no purity rescaling.
- **Live Netherlands reference** — a global USD/troy-ounce benchmark, purity-adjusted, converted with daily reference FX.
- **Real price history** — IBJA's published daily India benchmark and Standard Bullion's captured history for the Netherlands; no fabricated or interpolated data points.
- **Price Outlook** — an honest ordinary-least-squares trend projection (not an AI model), anchored to today's real price, with R², a confidence band, and a "how we got this number" walkthrough.
- **Jewelry price estimator** — gross/stone weight, making charges, and tax, on top of the real reference rate.
- **Portfolio ledger** — purchases, indicative valuation, CSV import/export, and price alerts, all stored locally in SQLite.
- **Light/dark themes**, mobile-responsive layout, and Docker Compose deployment.

## Quick start

```sh
cd gold-tracker
docker compose up -d --build --wait
```

Open http://127.0.0.1:3080.

See **[gold-tracker/README.md](gold-tracker/README.md)** for full setup, configuration, data-source documentation, and development commands (`npm test`, `npm run test:e2e`, `npm run typecheck`, `npm run lint`).

## Tech stack

Next.js (App Router) · TypeScript · React · Recharts · SQLite (`node:sqlite`) · Vitest · Playwright · Docker

## Disclaimer

Prices are indicative estimates, not executable offers or financial advice. Verify with your dealer before transacting.

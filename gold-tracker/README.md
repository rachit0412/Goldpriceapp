# Aurum Ledger

Single-user gold tracker for India and the Netherlands. Next.js, TypeScript, React, Recharts and SQLite (Node 24 `node:sqlite`). No account, hosted database or AI service required. The dashboard opens to local dealer sources; the international spot benchmark is separate and collapsed by default.

## Regular Use

Run these commands from this directory with Docker Desktop running:

```sh
docker compose up -d --build --wait
docker compose ps
```

Open http://127.0.0.1:3080. The image runs as non-root UID 1000, has a database health check, drops capabilities, and restarts unless stopped. The published port binds only to localhost. SQLite, provider caches, manual product quotes, holdings, alerts and notifications persist in the Compose `gold-data` volume. Do not remove that volume when updating.

```sh
HOST_PORT=3090 docker compose up -d --wait
docker compose logs --tail=80
docker compose stop
docker compose start
```

Use the same Compose project name and host-port environment consistently. A `.env` file can hold the variables listed in `.env.example`; it is ignored by Git and excluded from the image. Never put credentials in `NEXT_PUBLIC_*` variables, source files or build arguments. Images contain no data-provider credentials. Building needs npm, Docker registry and Google font access; fonts are self-hosted at runtime.

## Price Types

- **Local dealer quotes:** exact products and fineness, with source-labelled tax treatment. No country-wide or guaranteed executable price is implied.
- **International spot:** one USD/troy-ounce gold benchmark, converted using daily reference FX and purity-adjusted. Equal shared-currency values are expected for this benchmark, not evidence that local purchasing prices match.
- **Manual quotes:** user-entered price observations saved locally with source URL, product, gross weight, fineness, currency, declared tax status and observation time. They are not independently verified or automatically refreshed.

### India: Raksha Bullion

Verified source: https://rakshabullion.com/liverates.html. Its public `js/LiveRates3.js` and page configuration reference this feed:

```text
https://bcast.rakshabullion.com:7768/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/raksha
```

The adapter parses the published tab-separated rows, preserving source BUY/SELL columns, delivery labels, 995/999 fineness and `WITH GST` wording. Other rows have **unspecified** GST treatment, not assumed GST-exclusive pricing. No tax percentage is inferred or added. The feed is cached for 10 minutes, including failed attempts. It is a website-internal public feed, not a documented licensed API or an availability guarantee; confirm permitted use with the provider before redistribution or public deployment.

**Important limitations:** the verified payload supplies no reliable observation timestamp and no price-unit field. Strings such as `TODAY` or `20 jan` are shown verbatim as source notes, not interpreted as timestamps. The app shows raw INR source amounts with unknown units and unverified observation freshness. A `500GM` product label does not prove that the quoted price is per 500g. Source retrieval time is shown separately. No dealer row can trigger alerts.

Only after confirming the price unit with the dealer, set `RAKSHA_QUOTE_GRAMS` to that number of grams and recreate the container. This is an explicitly operator-confirmed assumption, not source verification. The default is unset. No per-gram or per-10g normalization is made from raw feed prices without it.

### Netherlands: GoldByPost

Reference spot page: https://www.goldbypost.nl/goud-prijs/actuele-goudprijs-eur/

Retail bars: https://www.goldbypost.nl/goudbaren/1-ounce-goudbaren/

The referenced chart describes an LBMA spot benchmark; product listings add product/quantity premiums. Direct app requests returned a Cloudflare 403. The site's acceptable-use policy also restricts copying: https://www.goldbypost.nl/info/acceptabel-gebruik/. The app does not bypass access controls or automatically scrape these pages. Dutch automated retail prices remain unavailable; source links and saved manual product quotes are provided instead. No retrieved website values are hardcoded as live prices.

Other API options were checked. goldprice.dev documents `/v1/physical/{country}` for dealer quotes, but its live `/v1/physical/NL` response is `404 unknown_country`, and its country index omits NL. The endpoint requires Basic ($19/month on the published plan page), so paying for it would not currently provide Dutch prices. Gold Feed documents global spot/history and a store-owner-configured pricing engine, not a dataset of Dutch dealers. Goudzaken, Holland Gold and KNM publish local pages/products, but no public developer endpoint for dealer checkout prices was documented in the sources checked. Their EUR spot prices are not retail checkout quotes.

GoldByPost's VAT page discusses **qualifying investment gold**, not a blanket exemption for all gold or jewellery: https://www.goldbypost.nl/info/geen-btw-over-beleggingsgoud/. The app records the dealer-stated tax status and never applies a statutory rate or exemption automatically. Verify the product and invoice with the dealer or a qualified adviser. Delivery, duties and cross-border rules are not calculated.

## Gold and FX APIs

Documented contracts and policies checked during implementation:

- https://gold-api.com/llms.txt and https://gold-api.com/terms
- https://frankfurter.dev/

Current gold: `GET https://api.gold-api.com/price/XAU`, USD per troy ounce, no key. The provider documents 30-second source updates and at least 30-second caching. Default app refresh is 300 seconds, never below 30. `updatedAt` is the provider's source-fetch timestamp, not necessarily an exchange transaction timestamp; app retrieval is stored independently. Provider error, invalid payload, future/old timestamp or missing FX never produces mock data. Prior values are retained and clearly marked stale; with no cache, values are unavailable.

FX: `GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,INR`, no key. Blended daily reference rates, not live cash/dealer exchange rates. Cache: 6 hours. Storing daily observations is permitted and encouraged by the provider. Public service has abuse protection, not an unlimited-throughput guarantee. Daily FX observation date and app retrieval timestamp are shown separately.

Historical gold: optional `GOLD_API_KEY` from **gold-api.com** (not goldapi.io, a different service). Uses its documented `/history?symbol=XAU&startTimestamp=...&endTimestamp=...&groupBy=day&aggregation=avg&orderBy=asc` with the server-side `x-api-key` header. The documented free history quota is 10 requests/hour; this app reserves at most 8 in a rolling hour across history charts and purchase benchmarks. Quota attempts persist across restarts. Chart results cache for 6 hours; immutable purchase-date benchmarks cache for 30 days, failures retry after a 1-hour cooldown. Other clients using the same API key may consume its remaining quota.

Without a history key, the app collects the last fresh observation each UTC day. It does not invent past prices. Charts support 7/30/90/365-day ranges when at least two real observations exist. Provider history is daily **average**, not closing price; collected snapshots have a different, explicitly labelled method. Daily change is relative to the prior available displayed observation and names its baseline date/method. Historical gold integration has fixture-based contract tests; authenticated live history cannot be verified without a credential.

Historical FX uses the same day or the most recent preceding daily observation within 7 days, never today's rate as a silent substitute. Comparisons have an explicit date selector. No history is interpolated into fabricated observations. Forecasts are intentionally unavailable without a verified dataset and evaluated method.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST_PORT` | `3080` | Localhost host port |
| `GOLD_API_KEY` | unset | Optional gold-api.com history key |
| `REFRESH_SECONDS` | `300` | Spot refresh and server alert interval; minimum 30 |
| `STALE_SECONDS` | `3600` | Maximum gold observation/retrieval age; minimum 60 |
| `FX_STALE_SECONDS` | `345600` | Maximum daily FX age (4 days); minimum 86400 |
| `RAKSHA_QUOTE_GRAMS` | unset | Operator-confirmed quote unit, never guessed |
| `ALERT_WEBHOOK_URL` | unset | Optional server-configured HTTPS notification destination |
| `ALERT_WEBHOOK_TOKEN` | unset | Optional bearer token |
| `APP_ORIGIN` | unset | Explicit HTTPS origin when behind an authenticated reverse proxy |
| `DATABASE_PATH` | `data/gold.sqlite` locally | Compose fixes it at `/app/data/gold.sqlite` |

Apply environment changes with `docker compose up -d --force-recreate --wait`. Keep the persistent volume. Invalid numeric settings use conservative defaults; lowering refresh does not override provider caching. Refresh controls check caches and do not bypass rate limits. The browser checks server state every minute; monitoring runs server-side even without an open browser.

## Financial Assumptions

One troy ounce is 31.1034768 grams. Karats use `K/24`; bullion fineness uses parts per 1000: 995 = 99.5%, 999 = 99.9%, 999.9 = 99.99%. A 24K benchmark is modelled as 100% pure, not a specific 999 retail bar.

Compare normalizes gross weight, fineness, currency and product type. Bullion/jewellery, price-type mismatches and unconfirmed charges block the result. Enter making charges, premiums and taxes as explicit currency amounts, without double-counting an already-inclusive total. Percentage baseline is the Netherlands quote and is named in the result. Purity-normalized product prices are mathematical equivalents, not real quotations for differently manufactured products. This is **not a cross-border landed-cost calculator**.

Portfolio cost basis = product cost + separately entered charges, converted using purchase-date FX. Indicative value is current metal value, not buyback/resale value. Charges are never assumed recoverable. Unknown historical conversion makes affected totals unavailable. Gold benchmark return is shown only when a completed historical observation exists. Constant-FX holding gain is net of purchase costs/charges; FX effect is the residual from current versus purchase-date FX. These sum to holding gain but do not imply a pure gold-index return. The what-if simulator is hypothetical and holds FX fixed.

CSV import/export is on Portfolio. Required fields: `date,country,product,purity,weight,currency,cost`; optional `charges,label`. Dates use YYYY-MM-DD. Purity accepts 18/22/24 karats or 995/999/999.9 fineness. Imports append atomically, at most 500 rows / 512 KB. Re-importing creates duplicates. Export before importing; spreadsheet formulas are escaped in exports. Browser preferences and unsent Compare drafts live in localStorage; database backup does not include them.

## Alerts

Persisted one-shot targets are evaluated at startup and every configured refresh interval while the container runs. They apply **only to purity-adjusted international spot**, not GST-inclusive dealer checkout prices. Both gold and FX must be fresh. No instant or offline monitoring is claimed. Restarting cannot re-trigger a persisted alert; create a new alert to re-arm it.

In-app notifications persist in SQLite. Optional webhooks send JSON with an `Idempotency-Key` and optional bearer token, over HTTPS with a timeout and no redirects. A failed/ambiguous delivery is recorded and not automatically retried, to avoid duplicate delivery. A crash between saving the notification and delivery can leave a pending webhook; in-app history remains the record. Webhook URLs are operator configuration only; never let untrusted users set them.

## Updates and Backups

Back up before upgrades. A stopped-container copy includes SQLite's database and WAL files consistently:

```sh
mkdir -p backups
docker compose stop
docker compose cp gold-tracker:/app/data ./backups/gold-data-$(date +%Y%m%d-%H%M%S)
docker compose start
```

To restore, stop the container, copy the backed-up data directory contents into `/app/data` with `docker compose cp`, ensure ownership UID/GID 1000, then start and check health. Keep database and any WAL/SHM companions together. Test restores on a separate verification volume first. Encrypt backups and restrict their permissions; purchases and quotes are personal financial data.

Update code/dependencies deliberately, run verification, then:

```sh
docker compose up -d --build --wait
docker compose ps
```

`docker compose down` preserves the named volume; **`down -v` deletes it**. Never use `down -v` on the personal-use project. Code can live in OneDrive, but the live SQLite database should stay in the local Docker volume rather than a cloud-synchronized directory.

## Verification

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
docker compose build
HOST_PORT=3081 docker compose -p aurum-verify up -d --wait
npx playwright install chromium
npm run test:e2e
node scripts/verify-persistence.mjs
```

The verification project uses its own volume. Browser tests create and remove test-labelled purchases/quotes; the persistence script recreates **only** the `aurum-verify` container twice and checks saved holdings, cache and one-shot notification deduplication. Never point write-oriented tests at your personal database. Screenshots are saved in ignored `artifacts/`. History/stale UI tests use explicitly labelled test-only route fixtures; these are never application data. Live current gold/FX and the Raksha raw feed are separate network checks. No external webhook delivery or authenticated gold history is claimed verified without configuration.

For local development use Node 24.13+ (Node SQLite API), `npm ci`, then `npm run dev -- --hostname 127.0.0.1`. Local data defaults to ignored `data/`.

## Public Exposure

This is a local single-user app **without built-in authentication or multi-user isolation**. Do not publish port 3000/3080 to the Internet or untrusted LAN. Public use requires an authenticated HTTPS reverse proxy, firewalling, request-size/rate limits, a deliberate content-security policy, secure backup handling, and `APP_ORIGIN=https://your-host` with the proxy preserving Host. Origin checks protect writes but are not authentication. Review provider permissions before redistributing data. Rotate compromised API/webhook credentials. Do not expose Docker's socket to the app.

All prices are indicative, may be delayed or wrong, and are not executable offers or financial, investment or tax advice. Confirm prices, purity, charges, availability and taxes directly with the dealer before purchasing.

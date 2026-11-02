# Aurum Ledger

Single-user gold tracker for India and the Netherlands. Next.js, TypeScript, React, Recharts and SQLite (Node 24 `node:sqlite`). No account, hosted database or AI service required. The dashboard opens to India dealer rates and a live EUR gold reference for the Netherlands view; the shared-currency benchmark is separate and collapsed by default.

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

The adapter parses the published tab-separated rows, preserving source BUY/SELL columns, delivery labels, 995/999 fineness and `WITH GST` wording. Other rows have **unspecified** GST treatment, not assumed GST-exclusive pricing. No tax percentage is inferred or added. The feed is cached for one minute, including failed attempts, and the dashboard polls once a minute. It is a website-internal public feed, not a documented licensed API or an availability guarantee; confirm permitted use with the provider before redistribution or public deployment.

**Important limitations:** the verified payload supplies no reliable observation timestamp and no price-unit field. Strings such as `TODAY` or `20 jan` are shown verbatim as source notes, not interpreted as timestamps. The card shows the app's fetch time, which is not the dealer's observation time and does not prove a quote is current. A `500GM` product label does not prove that the quoted price is per 500g. No dealer row can trigger alerts.

India's primary card has one **Source product** dropdown populated with Raksha's exact published product labels, including delivery variants, 995/999 fineness and GST-labelled rows. This replaces the synthetic karat selector on the India card; Netherlands and chart purity controls are unchanged. Displayed BUY/SELL uses the selected row directly, scaled only for weight and currency: **no purity adjustment and no additional GST**. At the configured source weight in INR, totals match the original row exactly. The tax wording is preserved; unspecified tax is not assumed excluded. Source selection persists in browser storage, and a disappearing selected product shows unavailable rather than silently switching to a different price. Missing BUY/SELL values remain unavailable. Per-gram amounts still depend on the source-weight assumption below. Original unadjusted rows remain under **Original Raksha dealer quotes**; global spot never replaces an unavailable Indian quote.

Source amounts are assumed per 10g by default (`RAKSHA_QUOTE_GRAMS=10`). **Raksha itself does not publish the unit in the feed**, so this remains an explicit display assumption, not verified source metadata. Change the setting if the dealer confirms a different unit; set it to `0` to disable normalization. Currency changes use Frankfurter's dated reference FX. Product GST labels are retained, and no additional tax is added to the calculated reference.

### Netherlands global reference: Standard Bullion

The dashboard uses the public `GET https://standardbullion.com/spot-prices.json` endpoint. It requires no API key, documents a 120-request/minute per-IP limit without a key, and asks clients to respect its 15-second cache. This app caches the response for 30 seconds, refreshes the UI once a minute, and applies a 120-second freshness cutoff. Provider observation and app retrieval timestamps are separate. The feed carries a provider attribution, which is displayed in the dashboard.

The endpoint returns USD per troy ounce. The Netherlands card converts this global ask/bid reference to its selected INR/EUR currency and karat choice (24K/22K/18K/14K). India has separate bullion-fineness options and uses Raksha only; there is no global comparison inside the India card. Like India, the Netherlands card displays **per gram** first and a separately labelled total for the shared selected weight. These sources are intentionally distinct; same-currency amounts need not match. Ask and bid retain Standard Bullion's meanings (price to buy from / sell to that source). No GST, VAT, product premium or making charge is automatically applied to the global reference, which is not a Netherlands-specific dealer offer. Old unsupported Netherlands dropdown preferences reset to 24K without resetting India's choice.

Historical chart: `GET https://standardbullion.com/api/v1/market/history?metal=XAU&range=7d` (or `1m`, `3m`, `1y`). No key required. The documented 7-day range returns captured hourly observations; this app uses the provider timestamps, not interpolated points, and appends the current live bid/ask midpoint only if its provider timestamp is newer. Gold observations convert with Frankfurter's same-day or latest preceding daily FX, at most seven days old. The chart defaults to 7 days and includes today's observations when returned by the provider. Results are SQLite-cached for 60 seconds; the source documents 60-second history caching and 120 requests/minute per IP without a key. Provider/app timestamps and the FX observation date are visible in the chart/table. The chart only displays if at least two valid observations exist.

The chart has a **country selector**, 24K/22K/18K purity (plus 14K for Netherlands), INR/EUR currency and 7D/30D/90D/1Y controls. Local chart currency defaults to EUR for Netherlands and INR for India; an explicit currency override is preserved. The chart reloads every 60 seconds and when its tab becomes visible, including across day changes. The observation table defaults to the last actual observation per day; **All observations** retains the full intraday series. Equal prices during market closures are not artificially changed. Netherlands ranges cover calendar dates including today. India ranges use the latest requested number of **published trading-day** observations, so seven published days can span more than seven calendar dates. The first observation is the explicit return baseline. Country/display choices and light/dark mode persist in browser storage.

**Indian daily chart:** `/api/history?country=India&days=7` now uses IBJA's publicly published **999 gold PM benchmark**, read from the chart JSON on https://ibjarates.com/. The parser checks the declared INR-per-10g unit, GST exclusion and PM series before accepting dates/prices. This provides genuine historical Indian prices immediately rather than only locally collected Raksha points. Each point is normalized from 999 fineness to the selected purity with dated Frankfurter FX. Source prices exclude GST and making charges; no tax is added. Source publication dates are displayed without invented intraday timestamps. Weekends/holidays without a publication are omitted, not filled. The public archive currently covers several months; longer requested ranges show only the real available records, with the count disclosed. IBJA is a daily benchmark, not Raksha's dealer product or streaming tick data. The public page is not a guaranteed or licensed API; confirm permission/licensing before redistribution or public deployment.

IBJA history is SQLite-cached for five minutes and refreshed by the server monitor while Docker runs, even with no browser open. Provider failures retain cached records and mark them stale. The UI polls each minute. Original Raksha intraday collection remains separate at `/api/history?country=India&source=Raksha&days=7` (`product` optionally selects a product ID): genuine hourly retained retrievals, no historical backfill or source mixing. The live India card still uses Raksha. Netherlands continues using `/api/history?country=Netherlands&days=7`, the Standard Bullion global reference series above.

**Refresh is not tick-by-tick verification:** cards and charts poll once a minute, subject to provider caches and failures. IBJA publishes daily benchmarks and is checked every five minutes; it is not minute-by-minute pricing. Raksha supplies no reliable quote timestamp, so a recent fetch does not prove its quote changed or is current. FX is a dated daily reference, not streaming FX. Keep Docker running for ongoing monitoring; gaps in Raksha retrievals cannot be reconstructed, while IBJA's published daily archive can be loaded on demand.

GoldByPost reference pages: https://www.goldbypost.nl/goud-prijs/actuele-goudprijs-eur/ and https://www.goldbypost.nl/goudbaren/1-ounce-goudbaren/

These are informational links only. The GoldByPost chart is a spot benchmark; product listings have their own premiums and terms. Direct app requests returned a Cloudflare 403, and its acceptable-use policy restricts copying. The app does not scrape or bypass the challenge. Optional saved product quotes remain user-entered and distinct from the live EUR reference.

Other API options were checked. goldprice.dev documents `/v1/physical/{country}` for dealer quotes, but its live `/v1/physical/NL` response is `404 unknown_country`, and its country index omits NL. The endpoint requires Basic ($19/month on the published plan page), so paying for it would not currently provide Dutch prices. Gold Feed documents global spot/history and a store-owner-configured pricing engine, not a dataset of Dutch dealers. Goudzaken, Holland Gold and KNM publish local pages/products, but no public developer endpoint for dealer checkout prices was documented in the sources checked. Their EUR spot prices are not retail checkout quotes.

GoldByPost's VAT page discusses **qualifying investment gold**, not a blanket exemption for all gold or jewellery: https://www.goldbypost.nl/info/geen-btw-over-beleggingsgoud/. The app records the dealer-stated tax status and never applies a statutory rate or exemption automatically. Verify the product and invoice with the dealer or a qualified adviser. Delivery, duties and cross-border rules are not calculated.

## Gold and FX APIs

Documented contracts and policies checked during implementation:

- https://gold-api.com/llms.txt and https://gold-api.com/terms
- https://frankfurter.dev/

Current benchmark: `GET https://api.gold-api.com/price/XAU`, USD per troy ounce, no key. The provider documents 30-second source updates and at least 30-second caching. Default app refresh is 300 seconds, never below 30. `updatedAt` is the provider's source-fetch timestamp, not necessarily an exchange transaction timestamp; app retrieval is stored independently. Provider error, invalid payload, future/old timestamp or missing FX never produces mock data. Prior values are retained and clearly marked stale; with no cache, values are unavailable.

FX: `GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,INR`, no key. Blended daily reference rates, not live cash/dealer exchange rates. Cache: 6 hours. Storing daily observations is permitted and encouraged by the provider. Public service has abuse protection, not an unlimited-throughput guarantee. Daily FX observation date and app retrieval timestamp are shown separately.

Historical portfolio benchmark: optional `GOLD_API_KEY` from **gold-api.com** (not goldapi.io, a different service). Uses its documented daily history endpoint with the server-side `x-api-key` header to estimate purchase-date metal-value performance where available. The documented free history quota is 10 requests/hour; this app reserves at most 8 in a rolling hour across purchase-date lookups. Quota attempts persist across restarts. Purchase-date benchmarks cache for 30 days; failures retry after a 1-hour cooldown. The 7D/30D/90D/1Y chart no longer depends on this key; it uses Standard Bullion's captured history above.

Historical FX uses the same day or the most recent preceding daily observation within 7 days, never today's rate as a silent substitute. Comparisons have an explicit date selector. No history is interpolated into fabricated observations.

### Price outlook: honest statistical projection, not AI

A dedicated **Outlook** page (its own sidebar nav item, independent of the Dashboard) with its own India/Netherlands selector. `GET /api/forecast?country=India|Netherlands&currency=INR|EUR&days=30|90|365` fits an **ordinary least squares linear regression** over the real daily observations already shown in that country's Dashboard chart (no external model, sentiment score or geopolitical index). It returns the fitted slope/R², a 7-day projected price, and an approximate 90% band computed from the regression's own residual error — refusing to project (`error` set, no points) with fewer than 5 real daily observations. R² is reported candidly and is often low, since linear trend-following is a weak predictor for gold; the UI states this is not a prediction service or financial advice.

The page also shows the **daily trend** (regression slope per day), a plain-language fit label (Low/Medium/High from R²), a lower/expected/upper range for the final projected day, a dashed-line projection-only chart (clearly separate from the real history chart on the Dashboard, with its own accessible label), and a day-by-day table of all 7 projected dates. An expanded **"How we got this number"** section spells out the exact arithmetic: the day-index assignment (day 0 = oldest observation used), the fitted `expected(day) = intercept + slope × day` formula with the real intercept/slope plugged in for the final projected day, and the confidence-band formula with the actual standard error and observation count substituted in — so the displayed numbers are traceable, not asserted. Unlike sites that advertise multi-factor models with USD-index, interest-rate, news-sentiment or geopolitical inputs, this app is explicit that it only ever has the price history it retrieves, so that is the only input to the trend line — no fabricated sentiment or risk scores are shown.

### Jewelry price estimator

A dedicated **Estimator** page (its own sidebar nav item) estimates a jewelry checkout price. Pick a region (sets INR/EUR), enter gross weight and stone weight (net gold weight = gross − stone), then your own making-charge and tax/VAT percentages. For **India** the rate basis is a **Source product** selector — the same Raksha dealer rows shown on the Dashboard, sharing the same persisted selection — using that product's exact SELL price with no purity scaling, consistent with the Dashboard's India card. For **Netherlands** it keeps a **Purity** (karat) selector against the international reference rate. It multiplies the chosen rate by the net weight, adds making charges, then computes tax on the gold-plus-making subtotal — mirroring how a jewelry invoice is normally built. A "Print estimate" button opens the browser print dialog with a print stylesheet that hides navigation chrome. The percentages are **whatever you type in**, not an assumed store or statutory rate; the disclaimer says so explicitly.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST_PORT` | `3080` | Localhost host port |
| `GOLD_API_KEY` | unset | Optional gold-api.com history key |
| `REFRESH_SECONDS` | `300` | Spot refresh and server alert interval; minimum 30 |
| `STALE_SECONDS` | `3600` | Maximum gold observation/retrieval age; minimum 60 |
| `FX_STALE_SECONDS` | `345600` | Maximum daily FX age (4 days); minimum 86400 |
| `RAKSHA_QUOTE_GRAMS` | `10` | Requested India display unit; Raksha does not state its unit, so confirm/adjust this assumption |
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

Theme preference, market-card currencies and chart choices persist in browser localStorage. The theme toggle supports light and dark mode and initially follows the operating-system preference when no saved choice exists.

For local development use Node 24.13+ (Node SQLite API), `npm ci`, then `npm run dev -- --hostname 127.0.0.1`. Local data defaults to ignored `data/`.

## Public Exposure

This is a local single-user app **without built-in authentication or multi-user isolation**. Do not publish port 3000/3080 to the Internet or untrusted LAN. Public use requires an authenticated HTTPS reverse proxy, firewalling, request-size/rate limits, a deliberate content-security policy, secure backup handling, and `APP_ORIGIN=https://your-host` with the proxy preserving Host. Origin checks protect writes but are not authentication. Review provider permissions before redistributing data. Rotate compromised API/webhook credentials. Do not expose Docker's socket to the app.

All prices are indicative, may be delayed or wrong, and are not executable offers or financial, investment or tax advice. Confirm prices, purity, charges, availability and taxes directly with the dealer before purchasing.

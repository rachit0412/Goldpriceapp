"use client";

import {
  cloneElement,
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import Image from "next/image";
import {
  ArrowUpRight,
  Check,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { convert, countryPurities, metalPrice, purityLabel, type Currency, type Rates } from "@/lib/finance";
import type { DealerFeed, DealerQuote, RakshaRow, dealers } from "@/lib/dealers";
import type { StandardBullionFeed } from "@/lib/market";

type DealerState = Awaited<ReturnType<typeof dealers>>;
const price = (amount: number | null, currency: Currency) =>
  amount === null
    ? "Unavailable"
    : new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-NL", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(amount);
const timestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not supplied";
function InputField({
  label,
  displayLabel,
  children,
}: {
  label: string;
  displayLabel?: string;
  children: ReactElement<{ "aria-labelledby"?: string; "aria-label"?: string }>;
}) {
  const id = useId();
  return (
    <label className="field">
      <span id={id}>{displayLabel || label}</span>
      {cloneElement(children, displayLabel ? { "aria-labelledby": undefined, "aria-label": label } : { "aria-labelledby": id })}
    </label>
  );
}
export default function LocalMarkets({
  revision,
  rates,
  fxObservedAt,
  fxStale,
  weight,
  changeWeight,
}: {
  revision: number;
  rates?: Rates;
  fxObservedAt: string | null;
  fxStale: boolean;
  weight: number;
  changeWeight: (grams: number) => void;
}) {
  const [data, setData] = useState<DealerState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState<"India" | "Netherlands" | null>(null);
  const [version, setVersion] = useState(0);
  const [indiaProductId, setIndiaProductId] = useState("");
  const [purities, setPurities] = useState<Record<"India" | "Netherlands", number>>({ India: 24, Netherlands: 24 });
  const [currencies, setCurrencies] = useState<Record<"India" | "Netherlands", Currency>>({
    India: "INR",
    Netherlands: "EUR",
  });
  const [preferencesReady, setPreferencesReady] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      try {
        const savedProduct = localStorage.getItem("aurum-india-source-product");
        if (active && savedProduct) setIndiaProductId(savedProduct);
        const saved = JSON.parse(localStorage.getItem("aurum-market-currencies") || "null");
        if (active && saved && ["INR", "EUR"].includes(saved.India) && ["INR", "EUR"].includes(saved.Netherlands)) {
          setCurrencies({ India: saved.India, Netherlands: saved.Netherlands });
        }
        const savedPurities = JSON.parse(localStorage.getItem("aurum-market-purities") || "null");
        if (active && savedPurities) {
          setPurities({
            India: countryPurities.India.includes(savedPurities.India) ? savedPurities.India : 24,
            Netherlands: countryPurities.Netherlands.includes(savedPurities.Netherlands) ? savedPurities.Netherlands : 24,
          });
        }
      } catch {
        localStorage.removeItem("aurum-market-currencies");
      }
      if (active) setPreferencesReady(true);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (preferencesReady) {
      localStorage.setItem("aurum-market-currencies", JSON.stringify(currencies));
      localStorage.setItem("aurum-market-purities", JSON.stringify(purities));
      localStorage.setItem("aurum-india-source-product", indiaProductId);
    }
  }, [currencies, purities, indiaProductId, preferencesReady]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setBusy(true);
      try {
        const response = await fetch("/api/dealers");
        if (!response.ok)
          throw new Error("Unable to retrieve local dealer prices");
        const result: DealerState = await response.json();
        if (active) {
          setData(result);
          setError("");
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Dealer data unavailable",
          );
      } finally {
        if (active) setBusy(false);
      }
    };
    void load();
    const interval = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [revision, version]);
  const removeQuote = async (quote: DealerQuote) => {
    if (!window.confirm("Delete this saved dealer quote?")) return;
    try {
      const response = await fetch(`/api/dealer-quotes/${quote.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Could not delete quote");
      setVersion((current) => current + 1);
    } catch (failure) {
      setError(String(failure));
    }
  };
  return (
    <section className="local-markets" aria-label="Country gold price views">
      <div className="section-heading">
        <div>
          <h2>Gold prices by market view</h2>
          <p>Choose INR or EUR independently for each market</p>
        </div>
        <InputField label="Shared reference weight (g)">
          <input type="number" min="0.001" max="1000000" step="any" value={weight} onChange={(event) => {
            const grams = Number(event.target.value);
            if (grams > 0 && grams <= 1000000) changeWeight(grams);
          }} />
        </InputField>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}. Any previously retrieved dealer data is stale.
        </div>
      )}
      {busy && !data && (
        <p role="status" className="dealer-loading">
          <LoaderCircle className="spin" size={16} />
          Loading dealer sources
        </p>
      )}
      <div className="country-grid dealer-grid">
        {(["India", "Netherlands"] as const).map((country) => {
          const displayed = currencies[country];
          const saved =
            data?.quotes.filter((quote) => quote.country === country) || [];
          const standard = data?.standardBullion;
          const rows = data?.raksha.rows || [];
          const matching = rows.filter(row => row.fineness === (purities.India === 995 ? 995 : 999));
          const indianProduct = indiaProductId
            ? rows.find(row => row.id === indiaProductId)
            : matching.find(row => row.gst === "Not stated") || matching[0] || rows[0];
          const sourceAmount = (inrAmount: number | null) =>
            inrAmount === null
              ? null
              : displayed === "INR"
                ? inrAmount
                : rates
                  ? convert(inrAmount, "INR", displayed, rates)
                  : null;
          return (
            <section
              className="dealer-country"
              key={country}
              aria-label={
                country === "India"
                  ? "India dealer prices"
                  : "Netherlands live gold reference"
              }
            >
              <div className="country-header">
                <div className="country-name">
                  <Image
                    src={
                      country === "India" ? "/india.png" : "/netherlands.png"
                    }
                    width={30}
                    height={21}
                    alt=""
                  />
                  <h2>{country}</h2>
                </div>
                <div className="market-card-controls">
                  <InputField label={`${country} quote currency`} displayLabel="Currency">
                    <select
                      value={displayed}
                      onChange={(event) =>
                        setCurrencies((current) => ({
                          ...current,
                          [country]: event.target.value as Currency,
                        }))
                      }
                    >
                      <option value="INR">INR</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </InputField>
                  {country === "India" ? (
                    <InputField label="India source product" displayLabel="Source product">
                      <select value={indianProduct?.id || indiaProductId} disabled={!rows.length} onChange={event => setIndiaProductId(event.target.value)}>
                        {!indianProduct && <option value={indiaProductId}>{indiaProductId ? "Selected product unavailable" : "No source products"}</option>}
                        {rows.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
                      </select>
                    </InputField>
                  ) : <InputField label={`${country} reference purity`} displayLabel="Purity">
                    <select value={purities[country]} onChange={(event) => setPurities((current) => ({ ...current, [country]: Number(event.target.value) }))}>
                      {countryPurities[country].map(value => <option key={value} value={value}>{purityLabel(value)}</option>)}
                    </select>
                  </InputField>}
                  <span className="text-badge">
                    {country === "India" ? "INDIAN REFERENCE" : "GLOBAL REFERENCE"}
                  </span>
                </div>
              </div>
              {country === "India" ? (
                <IndianReference feed={data?.raksha} product={indianProduct} currency={displayed} rates={rates} weight={weight} fxObservedAt={fxObservedAt} fxStale={fxStale} />
              ) : (
                <LiveReference feed={standard} country={country} currency={displayed} rates={rates} purity={purities[country]} weight={weight} fxObservedAt={fxObservedAt} fxStale={fxStale} />
              )}
              {country === "India" ? (
                <details className="dealer-assumptions">
                  <summary>Original Raksha dealer quotes</summary>
                  <div className="dealer-source">
                    <a
                      href="https://rakshabullion.com/liverates.html"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Raksha Bullion · Mumbai <ArrowUpRight size={13} />
                    </a>
                  </div>
                  {data?.raksha.error && (
                    <p className="notice warning">
                      {data.raksha.error}.{" "}
                      {data.raksha.rows.length
                        ? "Cached source quotes are stale."
                        : "No dealer quotes available."}
                    </p>
                  )}
                  <div className="table-scroll">
                    <table className="dealer-rates">
                      <thead>
                        <tr>
                          <th>Source product</th>
                          <th>Source BUY ({displayed} / {data?.raksha.unitGrams ? `${data.raksha.unitGrams}g` : "source unit"})</th>
                          <th>Source SELL ({displayed} / {data?.raksha.unitGrams ? `${data.raksha.unitGrams}g` : "source unit"})</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data?.raksha.rows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <strong>{row.label}</strong>
                              <small>
                                {row.fineness} / 1000 · GST: {row.gst}
                              </small>
                              <small>Source note: {row.sourceNote}</small>
                            </td>
                            <td className="numeric">
                              {price(sourceAmount(row.buy), displayed)}
                              {row.buy && data.raksha.unitGrams && sourceAmount(row.buy) !== null && (
                                <small>
                                  {price(sourceAmount(row.buy)! / data.raksha.unitGrams, displayed)} / g
                                </small>
                              )}
                            </td>
                            <td className="numeric">
                              {price(sourceAmount(row.sell), displayed)}
                              {data.raksha.unitGrams && row.sell && sourceAmount(row.sell) !== null && (
                                <small>
                                  {price(
                                    sourceAmount(row.sell)! / data.raksha.unitGrams,
                                    displayed,
                                  )}{" "}
                                  / g*
                                </small>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!data?.raksha.rows.length && !busy && (
                    <p className="dealer-empty">
                      Local dealer prices unavailable. No spot-price
                      substitution.
                    </p>
                  )}
                  <div className="dealer-assumptions">
                    <p>
                      <strong>Quote unit:</strong>{" "}
                      {data?.raksha.unitGrams
                        ? `Displayed as ${data.raksha.unitGrams}g source quotes by user preference; Raksha does not state the unit in its feed. Per-gram values are calculated only from that assumption.`
                        : "Raksha does not state the price unit in its feed; amounts are raw source quotes and cannot be normalized."}
                    </p>
                    <p>
                      <strong>Provider observation:</strong> not supplied as a
                      reliable timestamp. <strong>App retrieval:</strong>{" "}
                      {timestamp(data?.raksha.retrievedAt || null)}.
                    </p>
                    {displayed !== "INR" && (
                      <p>
                        Raw INR feed amounts converted to EUR using Frankfurter reference FX observed {fxObservedAt?.slice(0, 10) || "not available"}{fxStale ? " (stale)" : ""}. The configured weight unit remains an app display assumption.
                      </p>
                    )}
                    <p>
                      BUY / SELL and delivery labels are preserved from the
                      source. “WITH GST” means source-labelled inclusive; other
                      rows have unspecified tax treatment. No GST percentage is
                      inferred, and these quotes never trigger alerts.
                    </p>
                  </div>
                </details>
              ) : null}
              <div className="saved-dealer-quotes">
                <div className="section-heading">
                  <h3>Saved product quotes</h3>
                  <button
                    className="secondary"
                    onClick={() => setEditing(country)}
                  >
                    <Plus size={14} />
                    Add quote
                  </button>
                </div>
                {saved.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Product / source</th>
                          <th>Total / gross gram</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {saved.map((quote) => {
                          const converted =
                            quote.currency === displayed
                              ? quote.total
                              : rates
                                ? convert(
                                    quote.total,
                                    quote.currency,
                                    displayed,
                                    rates,
                                  )
                                : null;
                          return (
                            <tr key={quote.id}>
                              <td>
                                <a
                                  href={quote.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <strong>{quote.dealer}</strong>
                                </a>
                                <small>
                                  {quote.description} · {quote.product}
                                </small>
                                <small>
                                  {quote.fineness} fine · {quote.weight}g · Tax:{" "}
                                  {quote.taxStatus}
                                </small>
                                <small>
                                  User-entered · {timestamp(quote.observedAt)}
                                  {Date.now() - Date.parse(quote.observedAt) >
                                  3600000
                                    ? " · aged quote"
                                    : ""}
                                </small>
                              </td>
                              <td className="numeric">
                                {price(converted, displayed)}
                                <small>
                                  {price(
                                    converted === null
                                      ? null
                                      : converted / quote.weight,
                                    displayed,
                                  )}{" "}
                                  / g
                                </small>
                                <small>
                                  Original: {price(quote.total, quote.currency)}
                                </small>
                              </td>
                              <td>
                                <button
                                  className="icon-button"
                                  title="Delete saved quote"
                                  aria-label={`Delete ${quote.dealer} product quote`}
                                  onClick={() => void removeQuote(quote)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="subtle">
                    No saved quotes. Manual entries are labelled separately from
                    provider feeds.
                  </p>
                )}
                <p className="fine-print">
                  Gross-weight price, not purity-normalized. Quoted totals only;
                  no extra tax, making charges or delivery assumed. Converted
                  display uses current reference FX, not a historical buying
                  advantage.
                </p>
              </div>
            </section>
          );
        })}
      </div>
      {editing && (
        <QuoteForm
          country={editing}
          close={() => setEditing(null)}
          saved={() => {
            setEditing(null);
            setVersion((current) => current + 1);
          }}
        />
      )}
    </section>
  );
}
function IndianReference({ feed, product, currency, rates, weight, fxObservedAt, fxStale }: {
  feed?: DealerFeed;
  product?: RakshaRow;
  currency: Currency;
  rates?: Rates;
  weight: number;
  fxObservedAt: string | null;
  fxStale: boolean;
}) {
  const converted = (amount: number | null, grams = 1) => {
    if (amount === null || !product || !feed?.unitGrams) return null;
    const inr = amount * grams / feed.unitGrams;
    return currency === "INR" ? inr : rates ? convert(inr, "INR", currency, rates) : null;
  };
  return (
    <section className="indian-reference" aria-label="India Raksha price reference">
      <div className="dealer-source">
        <a href="https://rakshabullion.com/liverates.html" target="_blank" rel="noreferrer">Raksha Bullion · Mumbai <ArrowUpRight size={13} /></a>
        <span className="source-caution">{!feed ? "Loading Indian reference" : feed.error ? "Stale / unavailable" : `Auto-refresh · fetched ${timestamp(feed.retrievedAt)}`}</span>
      </div>
      {product ? (
        <>
          <div className="spot-quote-grid">
            <div className="spot-quote-value"><span>Raksha source BUY · {currency} / g</span><strong>{price(converted(product.buy), currency)}</strong><small>per 1g · {product.fineness} fine · source quote</small><small>{price(converted(product.buy, weight), currency)} total for {weight}g</small></div>
            <div className="spot-quote-value"><span>Raksha source SELL · {currency} / g</span><strong>{price(converted(product.sell), currency)}</strong><small>per 1g · {product.fineness} fine · source quote</small><small>{price(converted(product.sell, weight), currency)} total for {weight}g</small></div>
          </div>
          <div className="dealer-assumptions">
            <p>Based on {product.label} ({product.fineness} fine). GST: {product.gst}. No additional tax added. Source note: {product.sourceNote}.</p>
            <p>Original BUY/SELL for the selected product, scaled only for weight and currency. No purity adjustment or extra GST. {feed?.unitGrams ? `Source weight assumed ${feed.unitGrams}g; not verified by Raksha.` : "Source weight is unknown; normalized reference unavailable."}</p>
            <p>Provider observation: not supplied as a reliable timestamp. App retrieval: {timestamp(feed?.retrievedAt || null)}.{feed?.error ? ` Cached quote is stale: ${feed.error}.` : ""}</p>
            {currency !== "INR" && <p>INR converted using Frankfurter daily FX observed {fxObservedAt?.slice(0, 10) || "unavailable"}{fxStale ? " (stale)" : ""}.</p>}
          </div>
        </>
      ) : <p className="dealer-empty">{feed ? "Indian reference unavailable. No global-price substitution." : "Loading Indian dealer reference."}</p>}
    </section>
  );
}
function LiveReference({ feed, country, currency, rates, purity, weight, fxObservedAt, fxStale }: {
  feed?: StandardBullionFeed;
  country: "India" | "Netherlands";
  currency: Currency;
  rates?: Rates;
  purity: number;
  weight: number;
  fxObservedAt: string | null;
  fxStale: boolean;
}) {
  const quote = feed?.value;
  const converted = (amount: number, grams = 1) => rates ? metalPrice(amount, purity, grams, currency, rates) : null;
  const status = !feed ? "Loading reference" : !quote || !rates ? "Reference unavailable" : feed.stale || fxStale ? "Stale reference" : "Live reference";
  return <section className="live-reference" aria-label={`${country} global spot reference`}>
    <div className="dealer-source">
      <a href="https://standardbullion.com/spot-gold-price" target="_blank" rel="noreferrer">Standard Bullion · global gold quote <ArrowUpRight size={13} /></a>
      <span className="source-caution">{status}</span>
    </div>
    {feed?.error && <p className="notice warning">{feed.error}. {quote ? "Cached reference is stale." : "No current quote available."}</p>}
    {quote ? <>
      <div className="spot-quote-grid">
        <div className="spot-quote-value"><span>Source ask · buy · {currency} / g</span><strong>{price(converted(quote.gold.ask), currency)}</strong><small>per 1g · {purityLabel(purity)} equivalent</small><small>{price(converted(quote.gold.ask, weight), currency)} total for {weight}g</small></div>
        <div className="spot-quote-value"><span>Source bid · sell to source · {currency} / g</span><strong>{price(converted(quote.gold.bid), currency)}</strong><small>per 1g · {purityLabel(purity)} equivalent</small><small>{price(converted(quote.gold.bid, weight), currency)} total for {weight}g</small></div>
      </div>
      <div className="dealer-assumptions">
        <p><strong>Provider observation:</strong> {timestamp(quote.updated)}. <strong>App retrieval:</strong> {timestamp(feed.retrievedAt)}.</p>
        <p>Calculated purity-adjusted reference from {quote.unit}. Frankfurter daily FX observed {fxObservedAt?.slice(0, 10) || "unavailable"}{fxStale ? " (stale)" : ""}. No GST, VAT, product premium or making charge added. This is not a {country}-specific product price or local dealer offer.</p>
        <p>{quote.disclaimer} <a href="https://standardbullion.com" target="_blank" rel="noreferrer">{quote.attribution}</a></p>
      </div>
    </> : <p className="dealer-empty">{feed ? "Global reference unavailable. No sample prices are used." : "Loading global reference."}</p>}
  </section>;
}
function QuoteForm({
  country,
  close,
  saved,
}: {
  country: "India" | "Netherlands";
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localNow] = useState(() =>
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16),
  );
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch("/api/dealer-quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          country,
          observedAt: new Date(String(values.observedAt)).toISOString(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Save failed");
      saved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="entry-form">
      <div className="section-heading">
        <h2>{country} · user-entered product quote</h2>
        <button
          className="icon-button"
          onClick={close}
          aria-label="Close dealer quote form"
        >
          <X size={17} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid purchase-fields">
          <InputField label="Dealer">
            <input
              name="dealer"
              maxLength={100}
              defaultValue={
                country === "India" ? "Raksha Bullion" : "GoldByPost"
              }
              required
            />
          </InputField>
          <InputField label="Source product URL">
            <input
              name="sourceUrl"
              type="url"
              defaultValue={
                country === "India"
                  ? "https://rakshabullion.com/liverates.html"
                  : "https://www.goldbypost.nl/goudbaren/1-ounce-goudbaren/"
              }
              required
            />
          </InputField>
          <InputField label="Product description">
            <input
              name="description"
              maxLength={160}
              placeholder="Specific bar / dealer quote"
              required
            />
          </InputField>
          <InputField label="Product type">
            <select name="product">
              <option>Bullion</option>
              <option>Jewellery</option>
            </select>
          </InputField>
          <InputField label="Fineness (parts per 1000)">
            <select
              name="fineness"
              defaultValue={country === "India" ? 995 : 999.9}
            >
              {[995, 999, 999.9, 916.7, 916, 750].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </InputField>
          <InputField label="Quoted weight (grams)">
            <input
              name="weight"
              type="number"
              min="0.001"
              max="1000000"
              step="any"
              required
            />
          </InputField>
          <InputField label="Quoted currency">
            <select
              name="currency"
              defaultValue={country === "India" ? "INR" : "EUR"}
            >
              <option>INR</option>
              <option>EUR</option>
            </select>
          </InputField>
          <InputField label="Quoted total (as stated)">
            <input
              name="total"
              type="number"
              min="0.01"
              max="1000000000000"
              step="any"
              required
            />
          </InputField>
          <InputField label="Tax treatment (dealer stated)">
            <select name="taxStatus" defaultValue="Unknown">
              <option>Unknown</option>
              <option>Included</option>
              <option>Excluded</option>
              <option>Exempt (dealer stated)</option>
            </select>
          </InputField>
          <InputField label="Observed at (your local time)">
            <input
              name="observedAt"
              type="datetime-local"
              max={localNow}
              defaultValue={localNow}
              required
            />
          </InputField>
        </div>
        {error && (
          <p role="alert" className="negative">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            Save product quote
          </button>
        </div>
      </form>
    </section>
  );
}

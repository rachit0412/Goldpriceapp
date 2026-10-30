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
import { convert, type Currency, type Rates } from "@/lib/finance";
import type { DealerQuote, dealers } from "@/lib/dealers";

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
  children,
}: {
  label: string;
  children: ReactElement<{ "aria-labelledby"?: string }>;
}) {
  const id = useId();
  return (
    <label className="field">
      <span id={id}>{label}</span>
      {cloneElement(children, { "aria-labelledby": id })}
    </label>
  );
}
export default function LocalMarkets({
  revision,
  rates,
  currency,
  changeCurrency,
}: {
  revision: number;
  rates?: Rates;
  currency: "Local" | Currency;
  changeCurrency: (value: "Local" | Currency) => void;
}) {
  const [data, setData] = useState<DealerState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState<"India" | "Netherlands" | null>(null);
  const [version, setVersion] = useState(0);
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
    <section className="local-markets" aria-label="Local dealer prices">
      <div className="section-heading">
        <div>
          <h2>Local bullion & retail quotes</h2>
          <p>Dealer products, exact fineness and declared tax treatment</p>
        </div>
        <InputField label="Product quote currency">
          <select
            value={currency}
            onChange={(event) =>
              changeCurrency(event.target.value as "Local" | Currency)
            }
          >
            <option>Local</option>
            <option>INR</option>
            <option>EUR</option>
          </select>
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
          const local: Currency = country === "India" ? "INR" : "EUR";
          const displayed = currency === "Local" ? local : currency;
          const saved =
            data?.quotes.filter((quote) => quote.country === country) || [];
          return (
            <section
              className="dealer-country"
              key={country}
              aria-label={`${country} dealer prices`}
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
                <span className="text-badge">LOCAL DEALER</span>
              </div>
              {country === "India" ? (
                <>
                  <div className="dealer-source">
                    <a
                      href="https://rakshabullion.com/liverates.html"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Raksha Bullion · Mumbai <ArrowUpRight size={13} />
                    </a>
                    <span className="source-caution">
                      Observation time unverified
                    </span>
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
                          <th>Source BUY</th>
                          <th>Source SELL</th>
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
                            <td className="numeric">{price(row.buy, "INR")}</td>
                            <td className="numeric">
                              {price(row.sell, "INR")}
                              {data.raksha.unitGrams && row.sell && (
                                <small>
                                  {price(
                                    row.sell / data.raksha.unitGrams,
                                    "INR",
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
                        ? `${data.raksha.unitGrams}g (operator-confirmed configuration). *Calculated per gram.`
                        : "Not supplied by the feed; amounts are raw source quotes, not per gram or per 10g."}
                    </p>
                    <p>
                      <strong>Provider observation:</strong> not supplied as a
                      reliable timestamp. <strong>App retrieval:</strong>{" "}
                      {timestamp(data?.raksha.retrievedAt || null)}.
                    </p>
                    <p>
                      BUY / SELL and delivery labels are preserved from the
                      source. “WITH GST” means source-labelled inclusive; other
                      rows have unspecified tax treatment. No GST percentage is
                      inferred, and these quotes never trigger alerts.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="dealer-source">
                    <a
                      href="https://www.goldbypost.nl/goudbaren/1-ounce-goudbaren/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      GoldByPost · bullion products <ArrowUpRight size={13} />
                    </a>
                    <span className="source-caution">
                      Automated feed unavailable
                    </span>
                  </div>
                  <div className="dealer-unavailable">
                    <h3>No verified automated retail quote</h3>
                    <p>
                      GoldByPost blocks direct app retrieval, and its site-use
                      policy restricts copying. I verified the documented
                      goldprice.dev physical API too: <code>GET
                      /v1/physical/NL</code> returns <code>404 unknown_country</code>;
                      NL is absent from its covered-country list. No country
                      substitution, access-challenge bypass or scraped prices
                      are used.
                    </p>
                    <p className="api-source-links">
                      <a href="https://goldprice.dev/docs/physical" target="_blank" rel="noreferrer">Physical API coverage and schema <ArrowUpRight size={12} /></a>
                      <a href="https://goldprice.dev/pricing" target="_blank" rel="noreferrer">Plans: dealer endpoint requires Basic ($19/month) <ArrowUpRight size={12} /></a>
                    </p>
                    <a
                      className="secondary"
                      href="https://www.goldbypost.nl/goudbaren/1-ounce-goudbaren/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open 999.9 bar listings <ArrowUpRight size={14} />
                    </a>
                  </div>
                  <div className="dealer-assumptions">
                    <p>
                      <a
                        href="https://www.goldbypost.nl/goud-prijs/actuele-goudprijs-eur/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        The linked EUR gold chart
                      </a>{" "}
                      is a spot benchmark, not a bar&apos;s checkout price. Bar
                      premiums, quantity tiers and delivery costs differ.
                    </p>
                    <p>
                      <a
                        href="https://www.goldbypost.nl/info/geen-btw-over-beleggingsgoud/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Dealer VAT guidance
                      </a>{" "}
                      describes qualifying investment gold, not a blanket
                      jewellery exemption. Tax treatment must be verified for
                      the quoted product.
                    </p>
                  </div>
                </>
              )}
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

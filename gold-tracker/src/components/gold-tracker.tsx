"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  cloneElement,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import LocalMarkets from "./local-markets";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownUp,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Download,
  Gem,
  LayoutDashboard,
  LoaderCircle,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import Papa from "papaparse";
import {
  compareQuotes,
  convert,
  metalPrice,
  purityLabel,
  purityValues,
  TROY_OUNCE,
  type Alert,
  type Currency,
  type Purchase,
  type Quote,
  type Rates,
  type valuation,
} from "@/lib/finance";
import type { Cached, HistoryPoint } from "@/lib/market";

type View = "Dashboard" | "Compare" | "Portfolio" | "Alerts" | "Settings";
type Holding = Purchase & {
  fxDate: string | null;
  goldDate: string | null;
  goldMethod: string | null;
  valuation: ReturnType<typeof valuation> | null;
};
type State = {
  market: {
    gold: Cached<{ price: number }> & { stale: boolean };
    fx: Cached<{ rates: Rates }> & { stale: boolean };
  };
  holdings: Holding[];
  alerts: Alert[];
  notifications: { id: string; at: string; message: string; webhook: string }[];
  config: {
    refreshSeconds: number;
    staleSeconds: number;
    fxStaleSeconds: number;
    historyEnabled: boolean;
    webhookEnabled: boolean;
  };
};
type History = Cached<HistoryPoint[]> & {
  method: string;
  stale: boolean;
  country?: "India" | "Netherlands";
  grain?: "daily";
  sourceUrl?: string;
};
type Preferences = {
  currency: "Local" | Currency;
  purity: number;
  weight: number;
  days: number;
  base: Currency;
  chartCountry: "India" | "Netherlands";
};
const defaults: Preferences = {
  currency: "Local",
  purity: 24,
  weight: 10,
  days: 7,
  base: "EUR",
  chartCountry: "Netherlands",
};
const icons = {
  Dashboard: LayoutDashboard,
  Compare: ArrowDownUp,
  Portfolio: Wallet,
  Alerts: Bell,
  Settings: Settings2,
};
const money = (value: number | null | undefined, currency: Currency) =>
  value == null || !Number.isFinite(value)
    ? "Unavailable"
    : new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-NL", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }).format(value);
const number = (value: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
const time = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unavailable";
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result as T;
}
function Field({
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
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <Gem size={28} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Segments<T extends string | number>({
  values,
  value,
  onChange,
  label,
}: {
  values: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segments" role="group" aria-label={label}>
      {values.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
export default function GoldTracker() {
  const [view, setView] = useState<View>("Dashboard");
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [themeReady, setThemeReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<State | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(true);
  const [chartBusy, setChartBusy] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState("");
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("aurum-preferences") || "null",
        );
        if (
          saved &&
          ["Local", "EUR", "INR"].includes(saved.currency) &&
          [14, 18, 22, 24].includes(saved.purity) &&
          [7, 30, 90, 365].includes(saved.days) &&
          ["EUR", "INR"].includes(saved.base) &&
          saved.weight > 0 &&
          saved.weight <= 1000000
        ) {
          setPreferences({
            ...saved,
            days: saved.version === 2 ? saved.days : 7,
            chartCountry: saved.chartCountry === "India" ? "India" : "Netherlands",
            purity: saved.purity === 14 && saved.chartCountry === "India" ? 24 : saved.purity,
          });
        }
      } catch {
        localStorage.removeItem("aurum-preferences");
      }
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (ready)
      localStorage.setItem(
        "aurum-preferences",
        JSON.stringify({ ...preferences, version: 2 }),
      );
  }, [preferences, ready]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      const saved = localStorage.getItem("aurum-theme");
      const selected =
        saved === "dark" || saved === "light"
          ? saved
          : window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
      if (active) {
        setTheme(selected);
        document.documentElement.dataset.theme = selected;
        setThemeReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("aurum-theme", theme);
  }, [theme, themeReady]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const load = async () => {
      setBusy(true);
      try {
        const state = await api<State>(`/api/state?base=${preferences.base}`);
        if (active) {
          setData(state);
          setError("");
        }
      } catch (failure) {
        if (active)
          setError(
            failure instanceof Error ? failure.message : "Unable to connect",
          );
      } finally {
        if (active) setBusy(false);
      }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, preferences.base, revision]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const load = async (background = false) => {
      if (!background) setChartBusy(true);
      try {
        const result = await api<History>(
          `/api/history?days=${preferences.days}&country=${preferences.chartCountry}`,
        );
        if (active) setHistory(result);
      } catch (failure) {
        if (active)
          setHistory({
            value: null,
            error:
              failure instanceof Error
                ? failure.message
                : "History unavailable",
            attemptedAt: "",
            retrievedAt: null,
            observedAt: null,
            source: "History",
            method: "Unavailable",
            stale: true,
          });
      } finally {
        if (active) setChartBusy(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(true), 60000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, preferences.days, preferences.chartCountry, revision]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const change = (patch: Partial<Preferences>) =>
    setPreferences((current) => ({ ...current, ...patch }));
  const reload = () => setRevision((current) => current + 1);
  const fresh =
    !!data?.market.gold.value &&
    !!data?.market.fx.value &&
    !data.market.gold.stale &&
    !data.market.fx.stale &&
    !error;
  const spot = data?.market.gold.value?.price;
  const rates = data?.market.fx.value?.rates;
  const price = (purity: number, weight: number, currency: Currency) =>
    spot && rates ? metalPrice(spot, purity, weight, currency, rates) : null;
  const update = async (url: string, method: string, body?: unknown) => {
    await api(url, method, body);
    reload();
    setToast("Saved to your local ledger");
  };
  const title = {
    Dashboard: "Market overview",
    Compare: "Compare like for like",
    Portfolio: "Your gold ledger",
    Alerts: "Price alerts",
    Settings: "Data & preferences",
  }[view];
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Aurum Ledger dashboard">
          <span className="brand-icon">
            <Gem size={23} />
          </span>
          <span>
            AURUM<span className="brand-sub">PERSONAL GOLD LEDGER</span>
          </span>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(Object.keys(icons) as View[]).map((item) => {
            const Icon = icons[item];
            return (
              <button
                key={item}
                aria-label={item}
                onClick={() => setView(item)}
                aria-current={view === item ? "page" : undefined}
              >
                <Icon size={18} />
                <span>{item}</span>
                {item === "Alerts" &&
                  !!data?.alerts.filter((alert) => !alert.triggeredAt)
                    .length && (
                    <span className="count">
                      {data.alerts.filter((alert) => !alert.triggeredAt).length}
                    </span>
                  )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={18} />
          <div>
            Private by default<small>Stored on your device</small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-right">
            <button
              className="icon-button theme-toggle"
              type="button"
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <span className={`status ${fresh ? "fresh" : ""}`}>
              <i />
              {busy && !data
                ? "Connecting"
                : fresh
                  ? "Feed current"
                  : spot
                    ? "Stale / partial data"
                    : "Feed unavailable"}
            </span>
            <span className="private-badge">PERSONAL</span>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">INDIA / NETHERLANDS</div>
              <h1>{title}</h1>
              <p>
                {view === "Dashboard"
                  ? "India dealer rates and a live EUR gold reference for the Netherlands view."
                  : view === "Compare"
                    ? "Normalized quotes, with every assumption in view."
                    : view === "Portfolio"
                      ? "Your purchases and indicative metal value, in one place."
                      : view === "Alerts"
                        ? "A measured watch on your target prices."
                        : "Know where every number comes from."}
              </p>
            </div>
            <button
              className="secondary"
              onClick={reload}
              disabled={busy}
              title="Check cached feeds; provider refresh limits still apply"
            >
              <RefreshCw size={16} className={busy ? "spin" : ""} />
              Refresh
            </button>
          </div>
          {error && (
            <div className="notice error" role="alert">
              {error}.{" "}
              {data
                ? "Previously retrieved values remain visible; treat them as stale."
                : "Refresh to reconnect."}
            </div>
          )}
          {data && !fresh && (
            <div className="notice warning" role="status">
              {!spot || !rates
                ? "Partial data: gold or FX is unavailable. Calculated prices need both feeds."
                : "Stale data: cached values are for reference only. Alert evaluation is paused."}{" "}
              {data.market.gold.error} {data.market.fx.error}
            </div>
          )}
          {view === "Dashboard" && (
            <>
              <LocalMarkets
                revision={revision}
                rates={rates}
                fxObservedAt={data?.market.fx.observedAt || null}
                fxStale={data?.market.fx.stale ?? true}
                weight={preferences.weight}
                changeWeight={(weight) => change({ weight })}
              />
              <details className="benchmark-section">
                <summary>
                  International spot benchmark (not dealer buying prices)
                </summary>
                <h2>International spot benchmark</h2>
                <p className="fine-print">
                  The values below use the same global gold price, converted
                  with reference FX. They are not Indian or Dutch retail buying
                  prices. GST, dealer premiums and product-specific fineness
                  such as 995 or 999 are not included.
                </p>
                <div className="control-bar">
                  <div className="control-group">
                    <span className="control-label">Purity</span>
                    <Segments
                      label="Gold purity"
                      value={preferences.purity}
                      onChange={(value) => change({ purity: value })}
                      values={[24, 22, 18].map((value) => ({
                        value,
                        label: `${value}K`,
                      }))}
                    />
                  </div>
                  <div className="control-group">
                    <span className="control-label">Display currency</span>
                    <Segments
                      label="Display currency"
                      value={preferences.currency}
                      onChange={(value) => change({ currency: value })}
                      values={[
                        { value: "Local", label: "Local" },
                        { value: "INR", label: "INR" },
                        { value: "EUR", label: "EUR" },
                      ]}
                    />
                  </div>
                  <span className="estimate-label">
                    <CircleHelp size={14} />
                    Calculated spot estimates
                  </span>
                </div>
                <div className="country-grid">
                  {(["India", "Netherlands"] as const).map((country) => {
                    const local: Currency = country === "India" ? "INR" : "EUR";
                    const currency =
                      preferences.currency === "Local"
                        ? local
                        : preferences.currency;
                    const current = price(preferences.purity, 1, currency);
                    const previous = history?.value
                      ?.filter(
                        (point) =>
                          point.date < new Date().toISOString().slice(0, 10),
                      )
                      .at(-1);
                    const previousValue = previous
                      ? ((previous[currency] / TROY_OUNCE) *
                          preferences.purity) /
                        24
                      : null;
                    const daily =
                      current !== null && previousValue !== null
                        ? current - previousValue
                        : null;
                    return (
                      <section
                        className="country-panel"
                        key={country}
                        aria-label={`${country} prices`}
                      >
                        <div className="country-header">
                          <div className="country-name">
                            <Image
                              src={
                                country === "India"
                                  ? "/india.png"
                                  : "/netherlands.png"
                              }
                              width={30}
                              height={21}
                              alt=""
                            />
                            <h2>{country}</h2>
                          </div>
                          <span className="tiny-label">
                            {local} SPOT BENCHMARK
                          </span>
                        </div>
                        <div className="headline-price">
                          {busy && !data ? (
                            <span className="skeleton">Loading</span>
                          ) : (
                            money(current, currency)
                          )}
                          <span>/ gram</span>
                        </div>
                        <div
                          className={`daily-change ${daily === null ? "subtle" : daily >= 0 ? "positive" : "negative"}`}
                        >
                          {daily === null
                            ? "Daily change unavailable"
                            : `${daily >= 0 ? "+" : ""}${money(daily, currency)} (${signed((daily / previousValue!) * 100)})`}
                          <span>
                            {daily === null
                              ? "Needs a prior daily observation"
                              : `vs ${new Date(previous!.date).toLocaleString()} Standard Bullion observation`}
                          </span>
                        </div>
                        <div className="country-total">
                          <span>
                            {number(preferences.weight)}g · {preferences.purity}
                            K
                          </span>
                          <strong>
                            {money(
                              price(
                                preferences.purity,
                                preferences.weight,
                                currency,
                              ),
                              currency,
                            )}
                          </strong>
                        </div>
                        <div className="table-scroll">
                          <table className="rate-table">
                            <thead>
                              <tr>
                                <th>Purity</th>
                                <th>{currency} / g</th>
                                {country === "India" && (
                                  <th>{currency} / 10g</th>
                                )}
                              </tr>
                            </thead>
                            <tbody>
                              {[24, 22, 18].map((purity) => (
                                <tr
                                  key={purity}
                                  className={
                                    purity === preferences.purity
                                      ? "selected-row"
                                      : ""
                                  }
                                >
                                  <th>
                                    {purity}K{" "}
                                    <span>
                                      {((purity / 24) * 100).toFixed(1)}%
                                    </span>
                                  </th>
                                  <td>
                                    {money(
                                      price(purity, 1, currency),
                                      currency,
                                    )}
                                  </td>
                                  {country === "India" && (
                                    <td>
                                      {money(
                                        price(purity, 10, currency),
                                        currency,
                                      )}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="panel-foot">
                          International spot, purity-adjusted. Not an observed
                          retail price.
                        </div>
                      </section>
                    );
                  })}
                </div>
                <div className="benchmark-note">
                  <ArrowDownUp size={16} />
                  <span>
                    Shared currency shows the same global metal value, not a
                    country-specific buying advantage.
                  </span>
                </div>
              </details>
              <div className="analysis-grid">
                <section className="chart-section">
                  <div className="section-heading">
                    <div>
                      <h2>{preferences.chartCountry} gold price · last {preferences.days} {preferences.chartCountry === "India" ? "published days" : "days"}</h2>
                      <p>
                        {purityLabel(preferences.purity)} ·{" "}
                        {preferences.currency === "Local"
                          ? preferences.chartCountry === "India" ? "INR" : "EUR"
                          : preferences.currency}{" "}
                        per gram · historical FX{preferences.chartCountry === "India" ? " · IBJA daily PM benchmark" : " · global reference"}
                      </p>
                    </div>
                    <div className="chart-controls">
                      <Segments
                        label="Chart country"
                        value={preferences.chartCountry}
                        onChange={(chartCountry) => change({ chartCountry, purity: chartCountry === "India" && preferences.purity === 14 ? 24 : preferences.purity })}
                        values={[{ value: "India", label: "India" }, { value: "Netherlands", label: "Netherlands" }]}
                      />
                      <Segments
                        label="Chart currency"
                        value={preferences.currency === "Local" ? preferences.chartCountry === "India" ? "INR" : "EUR" : preferences.currency}
                        onChange={(currency) => change({ currency })}
                        values={[{ value: "INR", label: "INR" }, { value: "EUR", label: "EUR" }]}
                      />
                      <Segments
                        label="Chart purity"
                        value={preferences.purity}
                        onChange={(value) => change({ purity: value })}
                        values={(preferences.chartCountry === "India" ? [24, 22, 18] : [24, 22, 18, 14]).map((value) => ({
                          value,
                          label: `${value}K`,
                        }))}
                      />
                      <Segments
                        label="History range"
                        value={preferences.days}
                        onChange={(value) => change({ days: value })}
                        values={[
                          { value: 7, label: "7D" },
                          { value: 30, label: "30D" },
                          { value: 90, label: "90D" },
                          { value: 365, label: "1Y" },
                        ]}
                      />
                    </div>
                  </div>
                  {chartBusy ? (
                    <div className="chart-placeholder" role="status">
                      <LoaderCircle className="spin" size={22} />
                      Loading observations
                    </div>
                  ) : !(history?.value?.length) ? (
                    <Empty title="History is still taking shape">
                      {history?.error ||
                        (preferences.chartCountry === "India"
                          ? "Published Indian daily history is unavailable from IBJA. No global or invented prices are substituted."
                          : "No provider observations in this range. No sample prices are shown.")}
                    </Empty>
                  ) : (
                    <HistoryChart
                      history={history!}
                      purity={preferences.purity}
                      currency={
                        preferences.currency === "Local"
                          ? preferences.chartCountry === "India" ? "INR" : "EUR"
                          : preferences.currency
                      }
                    />
                  )}
                  <div className="history-caption">
                    <span>Auto-refresh: every 60 seconds. Latest retrieval: {time(history?.retrievedAt)}. </span>
                    {history?.value?.length === 1 && <span>One collected observation; no trend yet. </span>}
                    {history?.stale && (
                      <span className="negative">Stale history. </span>
                    )}
                    {history?.method || "No history yet"}
                    {history?.sourceUrl && <> <a href={history.sourceUrl} target="_blank" rel="noreferrer">Published source</a></>}
                    {history?.error && ` · ${history.error}`}
                  </div>
                </section>
                <section className="calculator-section">
                  <div className="section-heading">
                    <div>
                      <h2>Metal calculator</h2>
                      <p>Indicative value, not a dealer quote</p>
                    </div>
                    <Gem size={20} />
                  </div>
                  <Field label="Weight in grams">
                    <input
                      type="number"
                      min="0.001"
                      max="1000000"
                      step="any"
                      value={preferences.weight}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (value > 0 && value <= 1000000)
                          change({ weight: value });
                      }}
                    />
                  </Field>
                  <div className="weight-presets">
                    {[1, 5, 10, TROY_OUNCE].map((value) => (
                      <button
                        key={value}
                        aria-pressed={preferences.weight === value}
                        onClick={() => change({ weight: value })}
                      >
                        {value === TROY_OUNCE ? "1 troy oz" : `${value}g`}
                      </button>
                    ))}
                  </div>
                  <Calculator
                    purity={preferences.purity}
                    weight={preferences.weight}
                    price={price}
                  />
                </section>
              </div>
              <div className="bottom-grid">
                <SourcePanel data={data} />
                <section className="outlook">
                  <span className="eyebrow">OUTLOOK</span>
                  <h2>History, without the crystal ball.</h2>
                  <p>
                    Forecasts are unavailable. A verified long-term dataset and
                    an out-of-sample evaluated method are not configured. No
                    predicted prices or confidence scores are generated.
                  </p>
                  <span className="text-badge">No forecast model</span>
                </section>
              </div>
            </>
          )}
          {view === "Compare" && (
            <Compare
              rates={rates}
              stale={!fresh}
              weight={preferences.weight}
              purity={preferences.purity}
              base={preferences.base}
              data={data}
            />
          )}
          {view === "Portfolio" && (
            <Portfolio
              data={data}
              base={preferences.base}
              setBase={(base) => change({ base })}
              update={update}
              notify={setToast}
              stale={!fresh}
            />
          )}
          {view === "Alerts" && <Alerts data={data} update={update} />}
          {view === "Settings" && (
            <Settings data={data} preferences={preferences} change={change} />
          )}
          <footer>
            <span>
              <ShieldCheck size={14} />
              Personal ledger · SQLite storage
            </span>
            <p>
              Prices are indicative estimates, not executable offers or
              financial advice. Verify with your dealer. This is not a
              cross-border landed-cost calculator.
            </p>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function HistoryChart({
  history,
  purity,
  currency,
}: {
  history: History;
  purity: number;
  currency: Currency;
}) {
  const observationTime = (value: string | number) =>
    new Date(typeof value === "number" ? value : value.length === 10 ? `${value}T00:00:00Z` : value);
  const points = history.value!.map((point) => ({
    ...point,
    timestamp: observationTime(point.date).getTime(),
    value: ((point[currency] / TROY_OUNCE) * purity) / 24,
  }));
  const first = points[0];
  const latest = points.at(-1)!;
  const [tableDetail, setTableDetail] = useState<"Daily" | "All observations">("Daily");
  const dailyPoints = [...new Map(points.map(point => [point.date.slice(0, 10), point])).values()];
  const tablePoints = tableDetail === "Daily" ? dailyPoints : points;
  const dayTicks = [...new Set(points.map(point => point.date.slice(0, 10)))].map(date => Date.parse(`${date}T00:00:00Z`)).filter(tick => tick >= first.timestamp && tick <= latest.timestamp);
  const ticks = dayTicks.length ? dayTicks : [...new Set([first.timestamp, latest.timestamp])];
  const rangeChange = latest.value - first.value;
  return (
    <>
      <div className="history-summary" aria-label="Selected range price change">
        <Metric label="First observation / g" value={money(first.value, currency)} />
        <Metric label="Latest observation / g" value={money(latest.value, currency)} />
        <Metric label="Change from first observation" value={points.length > 1 ? `${money(rangeChange, currency)} (${signed(rangeChange / first.value * 100)})` : "Needs two observations"} className={points.length === 1 ? undefined : rangeChange < 0 ? "negative" : "positive"} />
      </div>
      <div
        className="chart"
        role="img"
        aria-label={`${purityLabel(purity)} gold observations over the selected range in ${currency} per gram. Data table below.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ left: 10, right: 28, top: 20, bottom: 8 }}
            accessibilityLayer
          >
            <defs>
              <linearGradient id="gold-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-fill)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-fill)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={points.length === 1 ? [first.timestamp - 1800000, first.timestamp + 1800000] : ["dataMin", "dataMax"]}
              ticks={ticks}
              tickFormatter={(value) =>
                observationTime(Number(value)).toLocaleDateString("en", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                })
              }
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tick={{ fontSize: 11, fill: "var(--subtle)" }}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(value) => number(value)}
              width={65}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--subtle)" }}
            />
            <Tooltip
              formatter={(value) => [
                money(Number(value), currency),
                `${purity}K / gram`,
              ]}
              labelFormatter={(value) =>
                history.grain === "daily"
                  ? `Published day: ${observationTime(Number(value)).toLocaleDateString("en", { timeZone: "UTC", dateStyle: "medium" })}`
                  : `${history.country === "India" ? "App retrieval" : "Observed"}: ${observationTime(Number(value)).toLocaleString("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC`
              }
              contentStyle={{ borderRadius: 4, borderColor: "var(--line)", backgroundColor: "var(--surface)", color: "var(--ink)" }}
            />
            <Area
              type="linear"
              dataKey="value"
              stroke="var(--chart-line)"
              strokeWidth={2}
              fill="url(#gold-fill)"
              isAnimationActive={false}
              connectNulls={false}
              dot={points.length === 1 ? { r: 4, fill: "var(--chart-line)" } : false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="chart-table">
        <summary>View observations ({tablePoints.length})</summary>
        <Segments label="Observation table detail" value={tableDetail} onChange={setTableDetail} values={[{ value: "Daily", label: "Daily" }, { value: "All observations", label: "All observations" }]} />
        <p>{history.grain === "daily" ? "Published Indian PM benchmarks. Dates without a publication are omitted, not filled with invented prices." : "Daily rows retain the last real observation for each UTC date. Unchanged source prices are preserved."}</p>
        <div className="table-scroll history-table">
          <table>
            <thead>
              <tr>
                <th>{history.grain === "daily" ? "Publication date (India)" : history.country === "India" ? "App retrieval (UTC)" : "Gold observation (UTC)"}</th>
                <th>{currency}/g</th>
                <th>FX observation date</th>
              </tr>
            </thead>
            <tbody>
              {tablePoints.map((point) => (
                <tr key={point.date}>
                  <td>{history.grain === "daily" ? observationTime(point.date).toLocaleDateString("en", { timeZone: "UTC", dateStyle: "medium" }) : observationTime(point.date).toLocaleString("en", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })}</td>
                  <td>{money(point.value, currency)}</td>
                  <td>{point.fxDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
function Calculator({
  purity,
  weight,
  price,
}: {
  purity: number;
  weight: number;
  price: (purity: number, weight: number, currency: Currency) => number | null;
}) {
  const [currency, setCurrency] = useState<Currency>("EUR");
  const [charges, setCharges] = useState({ making: 0, premium: 0, tax: 0 });
  const value = price(purity, weight, currency);
  const extras = charges.making + charges.premium + charges.tax;
  return (
    <>
      <Field label="Currency">
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value as Currency)}
        >
          <option>EUR</option>
          <option>INR</option>
        </select>
      </Field>
      <details className="charges">
        <summary>Optional charges & taxes</summary>
        <div className="form-grid">
          {(["making", "premium", "tax"] as const).map((key) => (
            <Field
              label={`${key[0].toUpperCase()}${key.slice(1)} (${currency}, total)`}
              key={key}
            >
              <input
                type="number"
                min="0"
                max="1000000000"
                step="any"
                value={charges[key]}
                onChange={(event) =>
                  setCharges((current) => ({
                    ...current,
                    [key]: Math.max(0, Number(event.target.value)),
                  }))
                }
              />
            </Field>
          ))}
        </div>
      </details>
      <div className="calc-result">
        <span>
          {number(weight)}g · {purity}K · metal only
        </span>
        <strong>{money(value, currency)}</strong>
        {extras > 0 && (
          <p>
            With entered charges:{" "}
            <b>{money(value === null ? null : value + extras, currency)}</b>
          </p>
        )}
      </div>
      <p className="fine-print">
        {extras
          ? "Only entered charges are included."
          : "Making charges, premiums and taxes excluded."}{" "}
        No tax rate or exemption assumed.
      </p>
    </>
  );
}
function SourcePanel({ data }: { data: State | null }) {
  return (
    <section className="source-section">
      <div className="section-heading">
        <h2>Data provenance</h2>
        <ShieldCheck size={18} />
      </div>
      <dl className="provenance">
        <div>
          <dt>Gold source</dt>
          <dd>
            <a
              href="https://gold-api.com/llms.txt"
              target="_blank"
              rel="noreferrer"
            >
              gold-api.com <ArrowUpRight size={12} />
            </a>
          </dd>
        </div>
        <div>
          <dt>Provider observation</dt>
          <dd>{time(data?.market.gold.observedAt)}</dd>
        </div>
        <div>
          <dt>App retrieval</dt>
          <dd>{time(data?.market.gold.retrievedAt)}</dd>
        </div>
        <div>
          <dt>FX source</dt>
          <dd>
            <a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">
              Frankfurter · daily blended
            </a>
          </dd>
        </div>
        <div>
          <dt>FX observation (UTC date)</dt>
          <dd>{data?.market.fx.observedAt?.slice(0, 10) || "Unavailable"}</dd>
        </div>
        <div>
          <dt>FX retrieval</dt>
          <dd>{time(data?.market.fx.retrievedAt)}</dd>
        </div>
        <div>
          <dt>1 EUR in INR</dt>
          <dd>
            {data?.market.fx.value
              ? number(convert(1, "EUR", "INR", data.market.fx.value.rates))
              : "Unavailable"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

const blankQuote = (country: string): Quote & { source: string } => ({
  country,
  product: "Bullion",
  purity: 24,
  weight: 10,
  currency: country === "India" ? "INR" : "EUR",
  total: 0,
  making: 0,
  premium: 0,
  tax: 0,
  complete: false,
  priceType: "Manual dealer quote",
  source: "",
});
function Compare({
  rates,
  stale,
  weight,
  purity,
  base,
  data,
}: {
  rates?: Rates;
  stale: boolean;
  weight: number;
  purity: number;
  base: Currency;
  data: State | null;
}) {
  const [quotes, setQuotes] = useState([
    blankQuote("India"),
    blankQuote("Netherlands"),
  ]);
  const [ready, setReady] = useState(false);
  const [currency, setCurrency] = useState<Currency>(base);
  const [grams, setGrams] = useState(weight);
  const [karat, setKarat] = useState(purity);
  const today = new Date().toISOString().slice(0, 10);
  const [comparisonDate, setComparisonDate] = useState(today);
  const [datedFx, setDatedFx] = useState<{
    requestedDate: string;
    rates?: Rates;
    date?: string;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!comparisonDate || comparisonDate >= today) return;
    let active = true;
    const load = async () => {
      try {
        const result = await api<{ rates: Rates; date: string }>(
          `/api/fx?date=${comparisonDate}`,
        );
        if (active) setDatedFx({ ...result, requestedDate: comparisonDate });
      } catch (error) {
        if (active)
          setDatedFx({
            requestedDate: comparisonDate,
            error:
              error instanceof Error
                ? error.message
                : "Historical FX unavailable",
          });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [comparisonDate, today]);
  const comparisonRates =
    comparisonDate === today
      ? rates
      : datedFx?.requestedDate === comparisonDate
        ? datedFx.rates
        : undefined;
  const comparisonFxDate =
    comparisonDate === today
      ? data?.market.fx.observedAt?.slice(0, 10)
      : datedFx?.requestedDate === comparisonDate
        ? datedFx.date
        : null;
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("aurum-quotes") || "null",
        );
        if (Array.isArray(saved) && saved.length === 2) setQuotes(saved);
      } catch {
        localStorage.removeItem("aurum-quotes");
      }
      setReady(true);
    });
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem("aurum-quotes", JSON.stringify(quotes));
  }, [quotes, ready]);
  const patch = (index: number, change: Partial<Quote & { source: string }>) =>
    setQuotes((current) =>
      current.map((quote, position) =>
        position === index ? { ...quote, ...change } : quote,
      ),
    );
  let result: ReturnType<typeof compareQuotes> | null = null;
  let issue = "Enter both quotes and confirm charge completeness.";
  if (comparisonRates && comparisonDate && comparisonDate <= today) {
    try {
      if (
        quotes.some(
          (quote) =>
            quote.priceType.startsWith("Observed") && !quote.source.trim(),
        )
      )
        throw new Error(
          "Observed retail quotes require a source and observation time.",
        );
      result = compareQuotes(
        quotes[0],
        quotes[1],
        comparisonRates,
        currency,
        karat,
        grams,
      );
    } catch (error) {
      issue = error instanceof Error ? error.message : issue;
    }
  } else
    issue =
      datedFx?.requestedDate === comparisonDate && datedFx.error
        ? datedFx.error
        : "FX for the selected date is loading or unavailable; comparison cannot be calculated.";
  return (
    <>
      <div className="notice neutral">
        Spot benchmarks are on Dashboard. These are manually entered quotes, not
        independently verified retail observations. Do not mix bullion and
        jewellery or infer a buying advantage from currency conversion alone.
      </div>
      <div className="control-bar">
        <Field label="Both quotes as of (date)">
          <input
            type="date"
            value={comparisonDate}
            max={today}
            onChange={(event) => setComparisonDate(event.target.value)}
          />
        </Field>
        <Field label="Comparison currency">
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as Currency)}
          >
            <option>EUR</option>
            <option>INR</option>
          </select>
        </Field>
        <Field label="Normalized purity">
          <select
            value={karat}
            onChange={(event) => setKarat(Number(event.target.value))}
          >
            {purityValues.map((value) => (
              <option key={value} value={value}>
                {purityLabel(value)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Selected grams">
          <input
            type="number"
            min="0.001"
            max="1000000"
            step="any"
            value={grams}
            onChange={(event) =>
              setGrams(Math.max(0.001, Number(event.target.value)))
            }
          />
        </Field>
      </div>
      <div className="country-grid">
        {quotes.map((quote, index) => (
          <section className="quote-section" key={quote.country}>
            <h2>{quote.country} quote</h2>
            <div className="form-grid">
              <Field label="Price type">
                <select
                  value={quote.priceType}
                  onChange={(event) =>
                    patch(index, { priceType: event.target.value })
                  }
                >
                  <option>Manual dealer quote</option>
                  <option>Observed retail (user-sourced)</option>
                </select>
              </Field>
              <Field label="Dealer / source and observation time">
                <input
                  maxLength={200}
                  placeholder="Name, URL and quote date/time"
                  value={quote.source}
                  onChange={(event) =>
                    patch(index, { source: event.target.value })
                  }
                />
              </Field>
              <Field label="Product">
                <select
                  value={quote.product}
                  onChange={(event) =>
                    patch(index, { product: event.target.value })
                  }
                >
                  <option>Bullion</option>
                  <option>Jewellery</option>
                </select>
              </Field>
              <Field label="Purity">
                <select
                  value={quote.purity}
                  onChange={(event) =>
                    patch(index, { purity: Number(event.target.value) })
                  }
                >
                  {purityValues.map((value) => (
                    <option key={value} value={value}>
                      {purityLabel(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Weight (g)">
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={quote.weight}
                  onChange={(event) =>
                    patch(index, { weight: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="Currency">
                <select
                  value={quote.currency}
                  onChange={(event) =>
                    patch(index, { currency: event.target.value as Currency })
                  }
                >
                  <option>INR</option>
                  <option>EUR</option>
                </select>
              </Field>
              {(["total", "making", "premium", "tax"] as const).map((key) => (
                <Field
                  key={key}
                  label={`${key === "total" ? "Product price (before extras)" : key === "tax" ? "Tax (explicit amount)" : `${key[0].toUpperCase()}${key.slice(1)} charge`} (${quote.currency})`}
                >
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={quote[key]}
                    onChange={(event) =>
                      patch(index, { [key]: Number(event.target.value) })
                    }
                  />
                </Field>
              ))}
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={quote.complete}
                onChange={(event) =>
                  patch(index, { complete: event.target.checked })
                }
              />
              All charges entered, or explicitly zero. No double-counting.
            </label>
          </section>
        ))}
      </div>
      <section className="comparison-result">
        <h2>Normalized result</h2>
        {result ? (
          <>
            <div className="summary-grid">
              <Metric label="Higher-priced quote" value={result.higher} />
              <Metric
                label={`${purityLabel(karat)} · difference / gram`}
                value={money(Math.abs(result.perGram), currency)}
              />
              <Metric
                label={`Difference for ${number(grams)}g`}
                value={money(Math.abs(result.total), currency)}
              />
              <Metric
                label="India relative to Netherlands"
                value={signed(result.percent)}
              />
            </div>
            <p>
              Baseline: Netherlands at {money(result.baseline, currency)}/g.
              India: {money(result.first, currency)}/g. All entered extras
              included. Purity normalization is a mathematical equivalent, not
              actual product pricing.
            </p>
            {stale && comparisonDate === today && (
              <p className="negative">
                Stale feed: comparison is indicative only.
              </p>
            )}
          </>
        ) : (
          <p role="status">{issue}</p>
        )}
        <p className="fine-print">
          FX: Frankfurter · {comparisonFxDate || "unavailable"} (UTC daily
          reference). Transport, duties, insurance and cross-border rules are
          not calculated. Not a landed-cost calculator.
        </p>
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`metric ${className}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
type Update = (url: string, method: string, body?: unknown) => Promise<void>;
function Portfolio({
  data,
  base,
  setBase,
  update,
  notify,
  stale,
}: {
  data: State | null;
  base: Currency;
  setBase: (base: Currency) => void;
  update: Update;
  notify: (message: string) => void;
  stale: boolean;
}) {
  const [editing, setEditing] = useState<Purchase | "new" | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scenario, setScenario] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const holdings = data?.holdings || [];
  const complete =
    holdings.length > 0 &&
    holdings.every(
      (row) =>
        row.valuation?.basis !== null && row.valuation?.basis !== undefined,
    );
  const metalComplete =
    holdings.length > 0 && holdings.every((row) => row.valuation !== null);
  const value = metalComplete
    ? holdings.reduce((sum, row) => sum + row.valuation!.value, 0)
    : null;
  const basis = complete
    ? holdings.reduce((sum, row) => sum + row.valuation!.basis!, 0)
    : null;
  const gain = value !== null && basis !== null ? value - basis : null;
  const exportCsv = () => {
    const fields = [
      "date",
      "country",
      "product",
      "purity",
      "weight",
      "currency",
      "cost",
      "charges",
      "label",
    ] as const;
    const csv = Papa.unparse(
      {
        fields: [...fields],
        data: holdings.map((row) => fields.map((key) => row[key])),
      },
      { escapeFormulae: true },
    );
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `aurum-holdings-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const importCsv = async (selected: File) => {
    setError("");
    setSaving(true);
    try {
      if (selected.size > 524288) throw new Error("CSV must be under 512 KB");
      const parsed = Papa.parse<Record<string, string>>(await selected.text(), {
        header: true,
        skipEmptyLines: "greedy",
      });
      if (parsed.errors.length) throw new Error(parsed.errors[0].message);
      await update("/api/purchases/import", "POST", parsed.data);
      notify(
        `Imported ${parsed.data.length} purchases. Imports append; repeated imports create duplicates.`,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Import failed");
    } finally {
      setSaving(false);
      if (file.current) file.current.value = "";
    }
  };
  const destroy = async (id: string) => {
    if (!window.confirm("Delete this purchase permanently?")) return;
    try {
      await update(`/api/purchases/${id}`, "DELETE");
    } catch (failure) {
      setError(String(failure));
    }
  };
  return (
    <>
      <div className="toolbar">
        <Segments
          label="Portfolio base currency"
          value={base}
          onChange={setBase}
          values={[
            { value: "EUR", label: "EUR base" },
            { value: "INR", label: "INR base" },
          ]}
        />
        <div className="toolbar-actions">
          <input
            ref={file}
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            aria-label="Import purchases CSV"
            onChange={(event) => {
              if (event.target.files?.[0])
                void importCsv(event.target.files[0]);
            }}
          />
          <button
            className="secondary"
            disabled={saving}
            onClick={() => file.current?.click()}
          >
            <Upload size={15} />
            Import CSV
          </button>
          <button className="secondary" onClick={exportCsv}>
            <Download size={15} />
            Export CSV
          </button>
          <button className="primary" onClick={() => setEditing("new")}>
            <Plus size={16} />
            Add purchase
          </button>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {editing && (
        <PurchaseForm
          key={typeof editing === "string" ? editing : editing.id}
          purchase={editing === "new" ? null : editing}
          close={() => setEditing(null)}
          update={update}
        />
      )}
      <div className="summary-grid portfolio-summary">
        <Metric
          label="Cost basis · purchase-date FX"
          value={money(basis, base)}
        />
        <Metric
          label={`Indicative metal value${stale ? " · stale" : ""}`}
          value={money(value, base)}
        />
        <Metric
          label="Unrealized gain / loss"
          value={money(gain, base)}
          className={gain === null ? "" : gain >= 0 ? "positive" : "negative"}
        />
        <Metric
          label="Return on total cost"
          value={
            gain !== null && basis
              ? signed((gain / basis) * 100)
              : "Unavailable"
          }
        />
      </div>
      {!complete && holdings.length > 0 && (
        <div className="notice warning">
          Portfolio totals are incomplete: current gold/FX or purchase-date FX
          is unavailable. Missing historical conversion is never replaced with
          current FX.
        </div>
      )}
      <div className="notice neutral">
        Metal value is not a dealer buyback or resale quote. Jewellery charges,
        premiums and taxes are part of your cost, not assumed recoverable value.
      </div>
      {holdings.length ? (
        <section className="ledger-section">
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Purchase</th>
                  <th>Product / purity</th>
                  <th>Weight</th>
                  <th>Total original cost</th>
                  <th>Metal value ({base})</th>
                  <th>Gain / return</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.label || row.country}</strong>
                      <small>
                        {row.date} · {row.country}
                      </small>
                      <small>Cost FX: {row.fxDate || "unavailable"}</small>
                    </td>
                    <td>
                      {row.product}
                      <small>{purityLabel(row.purity)}</small>
                    </td>
                    <td className="numeric">{number(row.weight)}g</td>
                    <td className="numeric">
                      {money(row.cost + row.charges, row.currency)}
                      <small>
                        incl. {money(row.charges, row.currency)} extras
                      </small>
                    </td>
                    <td className="numeric">
                      {money(row.valuation?.value, base)}
                    </td>
                    <td
                      className={`numeric ${(row.valuation?.gain || 0) < 0 ? "negative" : ""}`}
                    >
                      {money(row.valuation?.gain, base)}
                      <small>
                        {row.valuation?.returnPct == null
                          ? "No historical basis"
                          : signed(row.valuation.returnPct)}
                      </small>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          aria-label={`Edit ${row.label || row.country} purchase`}
                          title="Edit purchase"
                          onClick={() => setEditing(row)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${row.label || row.country} purchase`}
                          title="Delete purchase"
                          onClick={() => void destroy(row.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <Empty title={data ? "Your ledger is empty" : "Loading your ledger"}>
          Add your first gold purchase or import a CSV. No sample holdings have
          been added.
        </Empty>
      )}
      <div className="bottom-grid">
        <section className="breakdown-section">
          <h2>Holdings breakdown</h2>
          {!holdings.length ? (
            <p className="subtle">No holdings yet.</p>
          ) : (
            <div className="breakdown-grid">
              {["India", "Netherlands", ...purityValues.map(purityLabel)].map(
                (label) => {
                  const grams = holdings
                    .filter(
                      (row) =>
                        row.country === label ||
                        purityLabel(row.purity) === label,
                    )
                    .reduce((sum, row) => sum + row.weight, 0);
                  const total = holdings.reduce(
                    (sum, row) => sum + row.weight,
                    0,
                  );
                  return (
                    <div className="breakdown" key={label}>
                      <div>
                        <span>{label}</span>
                        <strong>{number(grams)}g</strong>
                      </div>
                      <meter
                        min={0}
                        max={total}
                        value={grams}
                        aria-label={`${label} share by gross weight`}
                      />
                    </div>
                  );
                },
              )}
            </div>
          )}
          <p className="fine-print">By gross weight, not fine-gold content.</p>
        </section>
        <section className="simulator">
          <h2>What-if simulator</h2>
          <p>
            Hypothetical metal-price change. FX held constant; charges are not
            recovered.
          </p>
          <Field
            label={`Gold-price change: ${scenario > 0 ? "+" : ""}${scenario}%`}
          >
            <input
              type="range"
              min="-50"
              max="50"
              value={scenario}
              onChange={(event) => setScenario(Number(event.target.value))}
            />
          </Field>
          <div className="summary-grid">
            <Metric
              label="Hypothetical value"
              value={money(
                value === null ? null : value * (1 + scenario / 100),
                base,
              )}
            />
            <Metric
              label="Hypothetical gain / loss"
              value={money(
                value === null || basis === null
                  ? null
                  : value * (1 + scenario / 100) - basis,
                base,
              )}
            />
          </div>
        </section>
      </div>
      <section className="decomposition">
        <h2>Price & FX attribution</h2>
        <p>
          Constant-FX gain = current metal value at purchase-date FX minus total
          cost. This includes purchase premiums and charges; it is not a pure
          gold-index return. FX effect is the remaining change from
          purchase-date to current FX.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Purchase</th>
                <th>Gold benchmark return (USD)</th>
                <th>Constant-FX gain, net of costs</th>
                <th>FX effect</th>
                <th>Total gain</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((row) => (
                <tr key={row.id}>
                  <td>{row.label || `${row.country} ${row.date}`}</td>
                  <td>
                    {row.valuation?.goldBenchmarkReturnPct == null
                      ? "Unavailable"
                      : signed(row.valuation.goldBenchmarkReturnPct)}
                    <small>
                      {row.goldDate
                        ? `${row.goldDate} · ${row.goldMethod}`
                        : "No completed historical gold observation"}
                    </small>
                  </td>
                  <td>{money(row.valuation?.goldEffect, base)}</td>
                  <td>{money(row.valuation?.fxEffect, base)}</td>
                  <td>{money(row.valuation?.gain, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <details className="csv-help">
        <summary>CSV format & cost assumptions</summary>
        <p>
          Columns: date (YYYY-MM-DD), country (India/Netherlands), product
          (Bullion/Jewellery), purity (24/22/18), weight (grams), currency
          (INR/EUR), cost (product price excluding separate charges), charges
          (optional extra costs, default 0), label. Cost basis = cost + charges.
          Imports are atomic and append up to 500 records. Export before
          importing; repeated imports create duplicates.
        </p>
      </details>
    </>
  );
}
function PurchaseForm({
  purchase,
  close,
  update,
}: {
  purchase: Purchase | null;
  close: () => void;
  update: Update;
}) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await update(
        purchase ? `/api/purchases/${purchase.id}` : "/api/purchases",
        purchase ? "PUT" : "POST",
        values,
      );
      close();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="entry-form">
      <div className="section-heading">
        <h2>{purchase ? "Edit purchase" : "New purchase"}</h2>
        <button
          className="icon-button"
          aria-label="Close purchase form"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <form onSubmit={submit}>
        <div className="form-grid purchase-fields">
          <Field label="Purchase date">
            <input
              autoFocus
              name="date"
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              defaultValue={
                purchase?.date || new Date().toISOString().slice(0, 10)
              }
              required
            />
          </Field>
          <Field label="Country">
            <select name="country" defaultValue={purchase?.country || "India"}>
              <option>India</option>
              <option>Netherlands</option>
            </select>
          </Field>
          <Field label="Product">
            <select
              name="product"
              defaultValue={purchase?.product || "Bullion"}
            >
              <option>Bullion</option>
              <option>Jewellery</option>
            </select>
          </Field>
          <Field label="Purity">
            <select name="purity" defaultValue={purchase?.purity || 24}>
              {purityValues.map((value) => (
                <option key={value} value={value}>
                  {purityLabel(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Weight (grams)">
            <input
              name="weight"
              type="number"
              min="0.001"
              max="1000000"
              step="any"
              defaultValue={purchase?.weight}
              required
            />
          </Field>
          <Field label="Currency">
            <select name="currency" defaultValue={purchase?.currency || "INR"}>
              <option>INR</option>
              <option>EUR</option>
            </select>
          </Field>
          <Field label="Product price (excluding extras)">
            <input
              name="cost"
              type="number"
              min="0.01"
              max="1000000000000"
              step="any"
              defaultValue={purchase?.cost}
              required
            />
          </Field>
          <Field label="Optional extras (making, premium, tax)">
            <input
              name="charges"
              type="number"
              min="0"
              max="1000000000000"
              step="any"
              defaultValue={purchase?.charges || 0}
              required
            />
          </Field>
          <Field label="Label (optional)">
            <input
              name="label"
              maxLength={120}
              defaultValue={purchase?.label || ""}
              placeholder="e.g. savings bar"
            />
          </Field>
        </div>
        <p className="fine-print">
          Total cost = product price + extras. If your invoice already includes
          charges, enter its total as product price and leave extras at zero.
        </p>
        {error && (
          <p className="negative" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            Save purchase
          </button>
        </div>
      </form>
    </section>
  );
}
function Alerts({ data, update }: { data: State | null; update: Update }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setError("");
    try {
      await update(
        "/api/alerts",
        "POST",
        Object.fromEntries(new FormData(form)),
      );
      form.reset();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const destroy = async (id: string) => {
    try {
      await update(`/api/alerts/${id}`, "DELETE");
    } catch (failure) {
      setError(String(failure));
    }
  };
  return (
    <>
      <div className="notice neutral">
        <Bell size={17} />
        <span>
          Evaluated every {data?.config.refreshSeconds || 300} seconds while the
          server/container is running, using fresh gold and FX only. Each alert
          fires once; create a new alert to re-arm it. Not instant monitoring.
        </span>
      </div>
      <section className="entry-form">
        <h2>New price target</h2>
        <form onSubmit={submit}>
          <div className="form-grid purchase-fields">
            <Field label="Country view">
              <select name="country">
                <option>India</option>
                <option>Netherlands</option>
              </select>
            </Field>
            <Field label="Price type">
              <select name="priceType">
                <option>Spot estimate</option>
              </select>
            </Field>
            <Field label="Purity">
              <select name="purity">
                {purityValues.map((value) => (
                  <option key={value} value={value}>
                    {purityLabel(value)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Currency">
              <select name="currency">
                <option>INR</option>
                <option>EUR</option>
              </select>
            </Field>
            <Field label="Unit">
              <select name="unit">
                <option value="gram">Per gram</option>
                <option value="10 grams">Per 10 grams</option>
                <option value="troy ounce">Per troy ounce</option>
              </select>
            </Field>
            <Field label="Condition">
              <select name="direction">
                <option value="below">At or below</option>
                <option value="above">At or above</option>
              </select>
            </Field>
            <Field label="Target price">
              <input
                name="threshold"
                type="number"
                min="0.01"
                max="1000000000000"
                step="any"
                required
              />
            </Field>
          </div>
          <p className="fine-print">
            Country selects the market view, not a local retail feed. Dealer and
            retail alerts need an automated observed-price provider and are not
            currently available.
          </p>
          <div className="form-actions">
            <button className="primary" disabled={saving}>
              <Plus size={16} />
              Save alert
            </button>
          </div>
        </form>
      </section>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      <section className="ledger-section">
        <h2>Saved targets</h2>
        {data?.alerts.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Market / purity</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {data.alerts.map((alert) => (
                  <tr key={alert.id}>
                    <td>
                      {alert.country} · {purityLabel(alert.purity)}
                      <small>{alert.priceType}</small>
                    </td>
                    <td>
                      {alert.direction === "above"
                        ? "At or above"
                        : "At or below"}{" "}
                      {money(alert.threshold, alert.currency)} / {alert.unit}
                    </td>
                    <td>
                      <span
                        className={`text-badge ${alert.triggeredAt ? "triggered" : ""}`}
                      >
                        {alert.triggeredAt ? "Triggered" : "Watching"}
                      </span>
                      {alert.triggeredAt && (
                        <small>{time(alert.triggeredAt)}</small>
                      )}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${alert.country} alert`}
                        title="Delete alert"
                        onClick={() => void destroy(alert.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No price targets yet">
            Your saved targets will appear here.
          </Empty>
        )}
      </section>
      <section className="notifications">
        <div className="section-heading">
          <h2>In-app notifications</h2>
          <span className="text-badge">
            Webhook{" "}
            {data?.config.webhookEnabled ? "configured" : "not configured"}
          </span>
        </div>
        {data?.notifications.length ? (
          data.notifications.map((note) => (
            <div className="notification" key={note.id}>
              <Bell size={17} />
              <div>
                <p>{note.message}</p>
                <small>
                  {time(note.at)} · Webhook: {note.webhook}
                </small>
              </div>
            </div>
          ))
        ) : (
          <p className="subtle">No alerts have fired.</p>
        )}
      </section>
    </>
  );
}
function Settings({
  data,
  preferences,
  change,
}: {
  data: State | null;
  preferences: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  return (
    <>
      <div className="bottom-grid">
        <section className="settings-section">
          <h2>Display preferences</h2>
          <div className="form-grid">
            <Field label="Portfolio base currency">
              <select
                value={preferences.base}
                onChange={(event) =>
                  change({ base: event.target.value as Currency })
                }
              >
                <option>EUR</option>
                <option>INR</option>
              </select>
            </Field>
            <Field label="Dashboard currency">
              <select
                value={preferences.currency}
                onChange={(event) =>
                  change({
                    currency: event.target.value as Preferences["currency"],
                  })
                }
              >
                <option>Local</option>
                <option>EUR</option>
                <option>INR</option>
              </select>
            </Field>
            <Field label="Default purity">
              <select
                value={preferences.purity}
                onChange={(event) =>
                  change({ purity: Number(event.target.value) })
                }
              >
                {[24, 22, 18].map((value) => (
                  <option key={value} value={value}>
                    {value}K
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="fine-print">
            Display preferences and unsent quotes are in this browser.
            Purchases, alerts, notifications and cache are stored in SQLite.
          </p>
        </section>
        <SourcePanel data={data} />
      </div>
      <section className="settings-section">
        <h2>Server configuration</h2>
        <dl className="provenance">
          <div>
            <dt>Gold refresh / alert interval</dt>
            <dd>{data?.config.refreshSeconds ?? "--"} seconds</dd>
          </div>
          <div>
            <dt>Gold maximum age</dt>
            <dd>{data?.config.staleSeconds ?? "--"} seconds</dd>
          </div>
          <div>
            <dt>FX maximum age</dt>
            <dd>{data?.config.fxStaleSeconds ?? "--"} seconds</dd>
          </div>
          <div>
            <dt>Historical API key</dt>
            <dd>
              {data?.config.historyEnabled
                ? "Configured (never exposed)"
                : "Not configured; collected history only"}
            </dd>
          </div>
          <div>
            <dt>Webhook</dt>
            <dd>
              {data?.config.webhookEnabled
                ? "Configured server-side"
                : "Disabled"}
            </dd>
          </div>
          <div>
            <dt>FX cadence</dt>
            <dd>Daily reference · cached for 6 hours</dd>
          </div>
        </dl>
        <p>
          Change server environment variables and restart the container to apply
          settings. Credentials are never accepted or exposed in the browser.
        </p>
        <p className="fine-print">
          History: GOLD_API_KEY from gold-api.com, free quota documented as 10
          requests/hour. App caches by range for 6 hours. No key required for
          current gold or FX. See README for setup, limits and backups.
        </p>
      </section>
      <section className="settings-section">
        <h2>Price assumptions & security</h2>
        <p>
          24K is modelled as pure gold; 22K = 22/24 and 18K = 18/24. One troy
          ounce = 31.1034768 grams. FX uses daily mid/reference rates, not bank
          transfer or cash rates. Historical conversions use same-day or latest
          preceding FX, up to 7 days prior.
        </p>
        <p>
          Observed local retail and manual quotes remain distinct from
          international spot estimates. No local retail data is scraped or
          fabricated. No tax rates or exemptions assumed. Indicative prices
          only, not financial advice.
        </p>
        <p>
          Single-user application without built-in authentication. Keep the
          default localhost binding. Public exposure requires an authenticated
          HTTPS reverse proxy, firewall controls and secure backups.
        </p>
      </section>
    </>
  );
}

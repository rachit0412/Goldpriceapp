// Ordinary least squares linear regression and a naive prediction interval.
// No external model, sentiment or geopolitical data: purely a statistical fit
// over real historical observations already retrieved by this app.
export const MIN_FORECAST_POINTS = 5;
export const CONFIDENCE_Z = 1.645; // ~90% under a normal-residual assumption

export type Regression = {
  slope: number;
  intercept: number;
  rSquared: number;
  standardError: number;
  n: number;
  xMean: number;
  sxx: number;
};

export function linearRegression(xs: number[], ys: number[]): Regression {
  const n = xs.length;
  const xMean = xs.reduce((sum, x) => sum + x, 0) / n;
  const yMean = ys.reduce((sum, y) => sum + y, 0) / n;
  const sxx = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const sxy = xs.reduce((sum, x, index) => sum + (x - xMean) * (ys[index] - yMean), 0);
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = yMean - slope * xMean;
  const sst = ys.reduce((sum, y) => sum + (y - yMean) ** 2, 0);
  const sse = ys.reduce((sum, y, index) => sum + (y - (intercept + slope * xs[index])) ** 2, 0);
  const rSquared = sst > 0 ? Math.max(0, 1 - sse / sst) : 0;
  const standardError = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  return { slope, intercept, rSquared, standardError, n, xMean, sxx };
}

export function predictionSpread(regression: Regression, x0: number) {
  const { standardError, n, xMean, sxx } = regression;
  return sxx > 0
    ? standardError * Math.sqrt(1 + 1 / n + (x0 - xMean) ** 2 / sxx)
    : standardError;
}
export function predictionInterval(regression: Regression, x0: number) {
  const { slope, intercept } = regression;
  const expected = intercept + slope * x0;
  const spread = predictionSpread(regression, x0);
  return {
    expected: Math.max(0, expected),
    lower: Math.max(0, expected - CONFIDENCE_Z * spread),
    upper: Math.max(0, expected + CONFIDENCE_Z * spread),
  };
}

export type DailyObservation = { date: string; value: number };
export type DescriptiveStats = { min: number; max: number; mean: number; stdevPercent: number };
export function descriptiveStats(values: number[]): DescriptiveStats {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { min, max, mean, stdevPercent: mean > 0 ? (Math.sqrt(variance) / mean) * 100 : 0 };
}
export type ForecastPoint = { date: string; expected: number; lower: number; upper: number };
export type Forecast = {
  error: string | null;
  regression: Regression | null;
  basis: { count: number; firstDate: string; lastDate: string } | null;
  current: DailyObservation | null;
  projected: ForecastPoint[];
  changePercent: number | null;
  direction: "Bullish" | "Bearish" | "Neutral" | null;
};

export function buildForecast(daily: DailyObservation[], horizonDays: number): Forecast {
  const sorted = [...daily].sort((first, second) => first.date.localeCompare(second.date));
  if (sorted.length < MIN_FORECAST_POINTS)
    return {
      error: `Not enough historical daily observations for a statistical projection (need at least ${MIN_FORECAST_POINTS}, have ${sorted.length}).`,
      regression: null, basis: null, current: null, projected: [], changePercent: null, direction: null,
    };
  const firstTime = Date.parse(`${sorted[0].date.slice(0, 10)}T00:00:00Z`);
  const dayOffset = (date: string) => Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - firstTime) / 86400000);
  const xs = sorted.map((point) => dayOffset(point.date));
  const ys = sorted.map((point) => point.value);
  const regression = linearRegression(xs, ys);
  const current = sorted.at(-1)!;
  const lastX = xs.at(-1)!;
  const projected: ForecastPoint[] = Array.from({ length: horizonDays }, (_, index) => {
    const stepsAhead = index + 1;
    const x0 = lastX + stepsAhead;
    const date = new Date(firstTime + x0 * 86400000).toISOString().slice(0, 10);
    // Anchored to the last real price (drift forward by the fitted slope), not the
    // regression line's own value at x0 — keeps direction/chart consistent with today's price.
    const expected = Math.max(0, current.value + regression.slope * stepsAhead);
    const spread = predictionSpread(regression, x0);
    return {
      date, expected,
      lower: Math.max(0, expected - CONFIDENCE_Z * spread),
      upper: Math.max(0, expected + CONFIDENCE_Z * spread),
    };
  });
  const final = projected.at(-1)!;
  const changePercent = current.value > 0 ? ((final.expected - current.value) / current.value) * 100 : null;
  const direction: Forecast["direction"] =
    changePercent === null ? null : changePercent > 1 ? "Bullish" : changePercent < -1 ? "Bearish" : "Neutral";
  return {
    error: null, regression,
    basis: { count: sorted.length, firstDate: sorted[0].date, lastDate: current.date },
    current, projected, changePercent, direction,
  };
}

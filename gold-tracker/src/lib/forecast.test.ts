import { describe, expect, it } from "vitest";
import { buildForecast, descriptiveStats, linearRegression } from "./forecast";

describe("descriptive statistics", () => {
  it("computes real min, max, mean and coefficient of variation from historical prices", () => {
    const stats = descriptiveStats([100, 100, 100, 100]);
    expect(stats).toMatchObject({ min: 100, max: 100, mean: 100, stdevPercent: 0 });
  });
  it("reports non-zero volatility for genuinely varying prices", () => {
    const stats = descriptiveStats([90, 100, 110]);
    expect(stats.min).toBe(90);
    expect(stats.max).toBe(110);
    expect(stats.mean).toBeCloseTo(100);
    expect(stats.stdevPercent).toBeGreaterThan(0);
  });
});

describe("linear regression", () => {
  it("fits a perfect line exactly with R squared of 1 and zero standard error", () => {
    const xs = [0, 1, 2, 3, 4];
    const ys = xs.map((x) => 2 * x + 1);
    const result = linearRegression(xs, ys);
    expect(result.slope).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(1);
    expect(result.rSquared).toBeCloseTo(1);
    expect(result.standardError).toBeCloseTo(0);
  });
  it("reports zero slope and zero R squared for flat, unchanging prices", () => {
    const result = linearRegression([0, 1, 2, 3], [100, 100, 100, 100]);
    expect(result.slope).toBeCloseTo(0);
    expect(result.rSquared).toBe(0);
  });
});

describe("statistical price forecast", () => {
  it("refuses to project with fewer than the minimum real observations", () => {
    const forecast = buildForecast(
      [{ date: "2026-10-01", value: 100 }, { date: "2026-10-02", value: 101 }],
      7,
    );
    expect(forecast.error).toContain("Not enough historical daily observations");
    expect(forecast.projected).toHaveLength(0);
    expect(forecast.direction).toBeNull();
  });
  it("projects an upward trend as Bullish with a tight, ordered confidence band on clean data", () => {
    const daily = Array.from({ length: 10 }, (_, index) => ({
      date: new Date(Date.parse("2026-10-01T00:00:00Z") + index * 86400000).toISOString().slice(0, 10),
      value: 1000 + index * 10,
    }));
    const forecast = buildForecast(daily, 7);
    expect(forecast.error).toBeNull();
    expect(forecast.basis).toMatchObject({ count: 10, firstDate: "2026-10-01", lastDate: "2026-10-10" });
    expect(forecast.direction).toBe("Bullish");
    expect(forecast.changePercent).toBeGreaterThan(0);
    expect(forecast.projected).toHaveLength(7);
    for (const point of forecast.projected)
      expect(point.lower).toBeLessThanOrEqual(point.expected);
    for (const point of forecast.projected)
      expect(point.expected).toBeLessThanOrEqual(point.upper);
    expect(forecast.projected.at(-1)!.date).toBe("2026-10-17");
  });
  it("projects a downward trend as Bearish and never predicts a negative price", () => {
    const daily = Array.from({ length: 8 }, (_, index) => ({
      date: new Date(Date.parse("2026-10-01T00:00:00Z") + index * 86400000).toISOString().slice(0, 10),
      value: Math.max(1, 50 - index * 20),
    }));
    const forecast = buildForecast(daily, 7);
    expect(forecast.direction).toBe("Bearish");
    for (const point of forecast.projected) {
      expect(point.lower).toBeGreaterThanOrEqual(0);
      expect(point.expected).toBeGreaterThanOrEqual(0);
    }
  });
  it("classifies a nearly flat trend as Neutral", () => {
    const daily = Array.from({ length: 6 }, (_, index) => ({
      date: new Date(Date.parse("2026-10-01T00:00:00Z") + index * 86400000).toISOString().slice(0, 10),
      value: 1000 + (index % 2),
    }));
    const forecast = buildForecast(daily, 7);
    expect(forecast.direction).toBe("Neutral");
  });
  it("anchors the projection to the last real price, not the regression line's own value, so direction never contradicts a declining trend", () => {
    const daily = Array.from({ length: 10 }, (_, index) => ({
      date: new Date(Date.parse("2026-10-01T00:00:00Z") + index * 86400000).toISOString().slice(0, 10),
      value: 1000 - index * 5,
    }));
    daily[daily.length - 1].value = 970; // last real price dips well below the fitted line
    const forecast = buildForecast(daily, 7);
    expect(forecast.regression!.slope).toBeLessThan(0);
    expect(forecast.projected[0].expected).toBeLessThan(forecast.current!.value);
    expect(forecast.projected.at(-1)!.expected).toBeLessThan(forecast.projected[0].expected);
    expect(forecast.direction).toBe("Bearish");
  });
});

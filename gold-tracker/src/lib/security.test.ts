import { describe, expect, it } from "vitest";
import { sameOrigin } from "./security";

describe("local and proxy origin checks", () => {
  it("accepts the browser's published container port", () => {
    expect(sameOrigin("http://127.0.0.1:3081", "127.0.0.1:3081", "http:")).toBe(
      true,
    );
  });
  it("rejects cross-origin and missing origin writes", () => {
    expect(
      sameOrigin("https://untrusted.example", "127.0.0.1:3081", "http:"),
    ).toBe(false);
    expect(sameOrigin(null, "localhost:3080", "http:")).toBe(false);
  });
  it("rejects nonlocal DNS hosts without explicit configuration", () => {
    expect(
      sameOrigin("http://untrusted.example", "untrusted.example", "http:"),
    ).toBe(false);
  });
  it("supports an explicit authenticated reverse proxy origin", () => {
    expect(
      sameOrigin(
        "https://gold.example",
        "gold.example",
        "http:",
        "https://gold.example",
      ),
    ).toBe(true);
    expect(
      sameOrigin(
        "https://gold.example",
        "evil.example",
        "http:",
        "https://gold.example",
      ),
    ).toBe(false);
  });
});

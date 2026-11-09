import { describe, expect, it } from "vitest";
import { getDomain, isScriptableUrl, normalizeUrl, urlsMatch } from "../../src/domain/url";

describe("URL normalization", () => {
  it("removes tracking data while preserving meaningful parameters", () => {
    expect(
      normalizeUrl("HTTPS://Example.COM:443/article/?utm_source=email&chapter=2#quote")
    ).toBe("https://example.com/article?chapter=2");
  });

  it("matches equivalent saved URLs without discarding meaningful query values", () => {
    expect(urlsMatch("https://example.com/a?utm_campaign=x&id=3", "https://example.com/a?id=3")).toBe(true);
    expect(urlsMatch("https://example.com/a?id=3", "https://example.com/a?id=4")).toBe(false);
  });

  it("identifies domains and unsupported browser pages", () => {
    expect(getDomain("https://www.example.com/a")).toBe("example.com");
    expect(isScriptableUrl("edge://favorites")).toBe(false);
    expect(isScriptableUrl("https://example.com")).toBe(true);
  });
});

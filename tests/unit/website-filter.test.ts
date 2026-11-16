import { describe, expect, it } from "vitest";
import { matchesWebsite, reconcileWebsiteFilter, websiteFamilies } from "../../src/domain/website-filter";

describe("website families", () => {
  it("nests sibling hosts under a registrable domain, including multi-part suffixes", () => {
    expect(websiteFamilies(["developers.cloudflare.com", "blog.cloudflare.com", "cloudflare.com", "cloudflare.com"]))
      .toEqual([{ domain: "cloudflare.com", value: "family:cloudflare.com",
        members: ["blog.cloudflare.com", "cloudflare.com", "developers.cloudflare.com"] }]);
    expect(websiteFamilies(["news.example.co.uk", "example.co.uk", "another.co.uk"]).map((family) => family.domain))
      .toEqual(["another.co.uk", "example.co.uk"]);
  });

  it("keeps private hosting tenants, IP addresses, and local hosts separate", () => {
    const families = websiteFamilies(["one.github.io", "two.github.io", "blog.one.github.io", "127.0.0.1", "localhost"]);
    expect(families.find((family) => family.domain === "one.github.io")?.members)
      .toEqual(["blog.one.github.io", "one.github.io"]);
    expect(families.map((family) => family.domain)).toEqual(["127.0.0.1", "localhost", "one.github.io", "two.github.io"]);
  });

  it("matches the whole family or an exact host without including lookalike domains", () => {
    expect(matchesWebsite("blog.cloudflare.com", "family:cloudflare.com")).toBe(true);
    expect(matchesWebsite("cloudflare.com", "family:cloudflare.com")).toBe(true);
    expect(matchesWebsite("notcloudflare.com", "family:cloudflare.com")).toBe(false);
    expect(matchesWebsite("cloudflare.com.evil.example", "family:cloudflare.com")).toBe(false);
    expect(matchesWebsite("blog.cloudflare.com", "cloudflare.com")).toBe(false);
    expect(matchesWebsite("two.github.io", "family:one.github.io")).toBe(false);
    expect(matchesWebsite("anything.example", "all")).toBe(true);
  });

  it("keeps family filters until their last host disappears and clears removed exact hosts", () => {
    expect(reconcileWebsiteFilter(["blog.cloudflare.com"], "family:cloudflare.com")).toBe("family:cloudflare.com");
    expect(reconcileWebsiteFilter(["blog.cloudflare.com"], "cloudflare.com")).toBe("all");
    expect(reconcileWebsiteFilter(["example.com"], "family:cloudflare.com")).toBe("all");
    expect(reconcileWebsiteFilter([], "all")).toBe("all");
  });
});

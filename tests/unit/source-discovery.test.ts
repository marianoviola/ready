import { describe, expect, it } from "vitest";
import { discoverSources } from "../../src/domain/source-discovery";
import type { Article, Source } from "../../src/domain/types";

function article(id: string, originalUrl: string, tags: string[] = [], date = 1): Article {
  return {
    id, originalUrl, normalizedUrl: originalUrl, title: id, domain: "stale.example",
    bookmarkState: "orphaned", tags, originalSavedAt: date, status: "unread", progress: 0,
    createdAt: date, updatedAt: date
  };
}

function source(url: string): Source {
  return {
    id: url, name: url, url, normalizedUrl: url, domain: "stale.example",
    subscribed: false, createdAt: 1, updatedAt: 1
  };
}

describe("source discovery", () => {
  it("groups valid article URLs by normalized domain and collects independent suggested tags", () => {
    const articles = [
      article("a", "https://WWW.Example.com/article?a=1", [" Tech ", "News"], 1),
      article("b", "https://example.com/other", ["tech", "Science"], 3),
      article("c", "http://other.example:8080/path", [], 2),
      article("bad", "file:///example.com"), article("broken", "not a url"),
      article("script", "javascript:alert(1)")
    ];
    const result = discoverSources(articles, []);
    expect(result).toEqual([
      { domain: "example.com", url: "https://www.example.com/", articleCount: 2,
        suggestedTags: ["Tech", "News", "Science"], createdAt: 3, updatedAt: 3 },
      { domain: "other.example", url: "http://other.example:8080/", articleCount: 1,
        suggestedTags: [], createdAt: 2, updatedAt: 2 }
    ]);
    expect(articles[0].tags).toEqual([" Tech ", "News"]);
  });

  it("excludes domains represented by any saved source regardless of path, www, or case", () => {
    expect(discoverSources([
      article("a", "https://example.com/a"),
      article("b", "https://www.other.example/b"),
      article("c", "https://new.example/c")
    ], [source("http://WWW.Example.com/archive"), source("https://other.example/section")])
      .map((candidate) => candidate.domain)).toEqual(["new.example"]);
  });

  it("removes credentials and article paths from suggested URLs", () => {
    expect(discoverSources([article("a", "https://user:pass@example.com/private?q=secret")], [])[0].url)
      .toBe("https://example.com/");
  });

  it("accepts empty input and ignores malformed saved URLs without failing", () => {
    expect(discoverSources([], [])).toEqual([]);
    expect(discoverSources([article("a", "https://example.com/a")],
      [{ ...source("bad"), domain: "WWW.Example.com" }])).toEqual([]);
  });
});

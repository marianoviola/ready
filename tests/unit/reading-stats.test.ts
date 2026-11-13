import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { calculateReadingStats } from "../../src/domain/reading-stats";
import type { Article, ReadingSession } from "../../src/domain/types";
import { ReadingStats } from "../../src/sidebar/ReadingStats";

const now = new Date(2026, 2, 14, 12).getTime();

function article(id: string, values: Partial<Article> = {}): Article {
  return {
    id, bookmarkState: "orphaned", originalUrl: "https://example.com/",
    normalizedUrl: "https://example.com/", title: id, domain: "example.com",
    originalSavedAt: 0, status: "unread", progress: 0, createdAt: 0, updatedAt: 0,
    ...values
  };
}

function session(id: string, articleId: string, endedAt: number, activeSeconds: number, startedAt = endedAt - 1000): ReadingSession {
  return { id, articleId, startedAt, endedAt, activeSeconds, startProgress: 0, endProgress: 0 };
}

describe("reading statistics", () => {
  it("uses seven local calendar days, including midnight boundaries and attributing spanning sessions to their end", () => {
    const midnight = new Date(2026, 2, 8).getTime();
    const todayMidnight = new Date(2026, 2, 14).getTime();
    const stats = calculateReadingStats([article("a")], [
      session("old", "a", midnight - 1, 10),
      session("first", "a", midnight, 20, midnight - 1000),
      session("last", "a", todayMidnight, 30, todayMidnight - 1000),
      session("now", "a", now, 40),
      session("future", "a", now + 1, 100)
    ], now);

    expect(stats.dailyActivity.map((day) => day.date.getDate())).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(stats.dailyActivity.map((day) => day.activeSeconds)).toEqual([20, 0, 0, 0, 0, 0, 70]);
    expect(stats.totalActiveSeconds).toBe(100);
  });

  it("counts current articles and aggregates sessions once while allowing tag overlap", () => {
    const articles = [
      article("a", { status: "read", domain: "Example.com", tags: [" Tech ", "tech", "News"] }),
      article("b", { status: "in_progress", domain: "example.com", tags: ["TECH"] }),
      article("c", { status: "unread", domain: "other.example" }),
      article("d", { status: "unread", tags: ["No tags"] })
    ];
    const one = session("1", "a", now, 60);
    const stats = calculateReadingStats(articles, [
      one, one, session("2", "b", now, 30), session("3", "c", now, 10),
      session("4", "d", now, 5), session("orphan", "missing", now, 999)
    ], now);
    expect(stats.currentCounts).toEqual({ read: 1, in_progress: 1, unread: 2 });
    expect(stats.totalActiveSeconds).toBe(105);
    expect(stats.domains.map(({ label, activeSeconds }) => [label, activeSeconds])).toEqual([
      ["Example.com", 95], ["other.example", 10]
    ]);
    expect(stats.tags.map(({ label, activeSeconds }) => [label, activeSeconds])).toEqual([
      ["Tech", 90], ["News", 60], ["No tags (untagged)", 10], ["No tags", 5]
    ]);
    expect(new Set(stats.tags.map((group) => group.key)).size).toBe(4);
  });

  it("ignores malformed and zero-length activity, and returns complete empty results", () => {
    const valid = session("valid", "a", now, 5);
    const stats = calculateReadingStats([article("a")], [
      valid,
      { ...valid, id: "nan", activeSeconds: NaN },
      { ...valid, id: "infinity", activeSeconds: Infinity },
      { ...valid, id: "negative", activeSeconds: -2 },
      { ...valid, id: "zero", activeSeconds: 0 },
      { ...valid, id: "bad-start", startedAt: NaN },
      { ...valid, id: "bad-end", endedAt: Infinity },
      { ...valid, id: "out-of-range", startedAt: -9e15 },
      { ...valid, id: "backwards", startedAt: now + 1 }
    ], now);
    expect(stats.totalActiveSeconds).toBe(5);
    expect(stats.dailyActivity[6].activeSeconds).toBe(5);
    const empty = calculateReadingStats([], [], now);
    expect(empty).toMatchObject({
      totalActiveSeconds: 0,
      currentCounts: { read: 0, in_progress: 0, unread: 0 },
      domains: [], tags: []
    });
    expect(empty.dailyActivity).toHaveLength(7);
    expect(empty.dailyActivity.every((day) => day.activeSeconds === 0)).toBe(true);
  });

  it("includes archived sessions but counts only current articles, preferring current metadata on duplicate IDs", () => {
    const active = article("a", { status: "unread", domain: "current.example", tags: ["Current"] });
    const archived = [
      article("a", { status: "read", domain: "old.example", tags: ["Old"] }),
      article("b", { status: "read", domain: "archive.example", tags: ["Archive"] }),
      article("b", { status: "read", domain: "archive.example", tags: ["Archive"] })
    ];
    const stats = calculateReadingStats([active], [
      session("1", "a", now, 10), session("2", "b", now, 20)
    ], now, archived);
    expect(stats.currentCounts).toEqual({ unread: 1, in_progress: 0, read: 0 });
    expect(stats.totalActiveSeconds).toBe(30);
    expect(stats.recordedReads).toBe(1);
    expect(stats.archivedReadCount).toBe(1);
    expect(stats.archivedArticles.map((item) => item.id)).toEqual(["b"]);
    expect(stats.domains.map(({ label }) => label)).toEqual(["archive.example", "current.example"]);
    expect(stats.tags.map(({ label }) => label)).toEqual(["Archive", "Current"]);
  });

  it("renders a labeled panel with empty states, seven meters and privacy disclosures", () => {
    const html = renderToStaticMarkup(createElement(ReadingStats, { articles: [], sessions: [] }));
    expect(html).toContain("Reading statistics");
    expect(html).toContain("Recorded active time:");
    expect(html).toContain("No telemetry is sent.");
    expect(html).toContain("No recorded activity yet.");
    expect(html.match(/<meter /g)).toHaveLength(7);
    expect(html).toContain("aria-label=\"Recorded active time on ");
    expect(html).toContain("tag totals can overlap");
    expect(html).toContain("Archived history stays on this device.");
  });

  it("renders recorded activity and current status from supplied props", () => {
    const currentTime = Date.now();
    const html = renderToStaticMarkup(createElement(ReadingStats, {
      articles: [article("a", { status: "read", domain: "news.example", tags: ["Science"] })],
      sessions: [session("1", "a", currentTime, 3661)]
    }));
    expect(html).toContain("1h 1m 1s");
    expect(html).toContain("Read: 1");
    expect(html).toContain("news.example");
    expect(html).toContain("Science");
  });

  it("renders archived history links and favorite references without duplicating active entries", () => {
    const html = renderToStaticMarkup(createElement(ReadingStats, {
      articles: [article("active", { status: "read" })],
      sessions: [],
      history: [
        article("active", { status: "read" }),
        article("archived", { status: "read", title: "Archived title", originalUrl: "https://example.com/story", bookmarkId: "123" }),
        article("unsafe", { originalUrl: "javascript:alert(1)" })
      ]
    }));
    expect(html).toContain("Recorded reads: 2 (1 archived)");
    expect(html).toContain("Archived articles (2)");
    expect(html).toContain('href="https://example.com/story"');
    expect(html).toContain("Archived title");
    expect(html).toContain("Favorite reference: 123");
    expect(html).not.toContain('href="javascript:');
  });
});

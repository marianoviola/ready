import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/database";
import { enforceReadingRetention, getReadingRetention, saveReadingRetention, validateReadingRetention } from "../../src/browser/reading-retention";
import type { Article } from "../../src/domain/types";

let stored: Record<string, unknown>;
function article(id: string, status: Article["status"], completedAt: number): Article {
  return {
    id, status, completedAt, bookmarkId: `favorite-${id}`, bookmarkState: "linked",
    originalUrl: `https://example.com/${id}`, normalizedUrl: `https://example.com/${id}`,
    title: id, domain: "example.com", tags: ["Reading"], progress: 0.8,
    originalSavedAt: 1, createdAt: 1, updatedAt: completedAt
  };
}

beforeEach(async () => {
  await Promise.all([db.articles.clear(), db.readingHistory.clear(), db.sessions.clear(), db.annotations.clear(), db.ignoredRecommendations.clear()]);
  stored = {};
  vi.stubGlobal("chrome", {
    storage: { local: {
      get: vi.fn(async () => stored),
      set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(stored, value); })
    } },
    bookmarks: { remove: vi.fn(), getTree: vi.fn() }
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("optional read-list cleanup", () => {
  it("defaults to disabled with a limit of 100 and changes no data", async () => {
    await db.articles.add(article("old", "read", 1));
    expect(await getReadingRetention()).toEqual({ enabled: false, maxReadArticles: 100 });
    expect(await enforceReadingRetention()).toBe(0);
    expect(await db.articles.count()).toBe(1);
  });

  it.each([0, -1, 1.5, NaN, Infinity, "100"])("rejects invalid limits: %s", async (limit) => {
    expect(() => validateReadingRetention({ enabled: true, maxReadArticles: limit })).toThrow();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it("archives only the oldest excess read articles, keeping sessions and every Favorite", async () => {
    await db.articles.bulkAdd([
      article("old", "read", 1), article("new", "read", 2),
      article("unread", "unread", 0), article("progress", "in_progress", 0)
    ]);
    await db.sessions.add({ id: "session", articleId: "old", startedAt: 1, endedAt: 2, activeSeconds: 1, startProgress: 0, endProgress: 0.8 });
    expect(await saveReadingRetention({ enabled: true, maxReadArticles: 1 })).toBe(1);
    expect((await db.articles.toArray()).map((item) => item.id).sort()).toEqual(["new", "progress", "unread"]);
    expect(await db.readingHistory.get("old")).toMatchObject({ bookmarkId: "favorite-old", status: "read", progress: 0.8 });
    expect(await db.sessions.count()).toBe(1);
    expect(chrome.bookmarks.remove).not.toHaveBeenCalled();
    expect(chrome.bookmarks.getTree).not.toHaveBeenCalled();
    expect(await enforceReadingRetention()).toBe(0);
    expect(await db.readingHistory.count()).toBe(1);
  });

  it("serializes concurrent cleanup without duplicate archives or failed removals", async () => {
    await db.articles.bulkAdd([article("old", "read", 1), article("new", "read", 2)]);
    stored.readingRetention = { enabled: true, maxReadArticles: 1 };
    expect(await Promise.all([enforceReadingRetention(), enforceReadingRetention()])).toEqual([1, 0]);
    expect(await db.readingHistory.count()).toBe(1);
  });

  it("reports invalid stored settings instead of silently enabling or disabling cleanup", async () => {
    stored.readingRetention = { enabled: true, maxReadArticles: 0 };
    await expect(enforceReadingRetention()).rejects.toThrow("whole number");
    expect(await db.readingHistory.count()).toBe(0);
  });
});

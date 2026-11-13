import { afterEach, describe, expect, it } from "vitest";
import { ReadyDatabase } from "../../src/db/database";
import {
  archiveReadingHistory,
  findReadingHistoryMatch,
  getReadRetentionCandidates,
  restoreReadingHistory
} from "../../src/domain/reading-history";
import type { Article } from "../../src/domain/types";

const article: Article = {
  id: "article", bookmarkId: "edge-42", bookmarkState: "linked",
  originalUrl: "https://example.com/story", normalizedUrl: "https://example.com/story",
  title: "Story", domain: "example.com", tags: ["Science"],
  originalSavedAt: 10, createdAt: 10, updatedAt: 30,
  completedAt: 20, lastReadAt: 25, status: "read", progress: 1
};
const databases: ReadyDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe("durable reading history", () => {
  it("archives the full snapshot idempotently and retains sessions after removal and reopening", async () => {
    const name = `ready-history-${crypto.randomUUID()}`;
    const database = new ReadyDatabase(name);
    databases.push(database);
    await database.articles.put(article);
    const session = {
      id: "session", articleId: article.id, startedAt: 10, endedAt: 30,
      activeSeconds: 20, startProgress: 0, endProgress: 1
    };
    await database.sessions.put(session);
    await archiveReadingHistory(article, database);
    const first = await database.readingHistory.get(article.id);
    expect(await database.articles.get(article.id)).toEqual(article);
    await archiveReadingHistory(article, database);
    const again = await database.readingHistory.get(article.id);
    expect(again).toEqual(first);
    expect(await database.readingHistory.count()).toBe(1);
    await database.articles.delete(article.id);
    database.close();
    await database.open();
    expect(await database.readingHistory.get(article.id)).toEqual({ ...article, archivedAt: first!.archivedAt });
    expect(await database.sessions.get(session.id)).toEqual(session);
    await database.articles.put(article);
    await restoreReadingHistory(article.id, database);
    expect(await database.readingHistory.count()).toBe(0);
    expect(await database.sessions.count()).toBe(1);
  });

  it("selects only oldest read excess using completion time with legacy fallback", () => {
    const articles: Article[] = [
      { ...article, id: "recent", completedAt: 90, updatedAt: 1 },
      { ...article, id: "old", completedAt: 10, updatedAt: 100 },
      { ...article, id: "legacy", completedAt: undefined, updatedAt: 20 },
      { ...article, id: "unread", status: "unread", completedAt: undefined, updatedAt: 0 },
      { ...article, id: "reading", status: "in_progress", updatedAt: 0 }
    ];
    expect(getReadRetentionCandidates(articles, 1).map((item) => item.id)).toEqual(["old", "legacy"]);
    expect(articles[0].id).toBe("recent");
    expect(getReadRetentionCandidates(articles, 2)).toHaveLength(1);
    expect(getReadRetentionCandidates(articles, 3)).toEqual([]);
    expect(getReadRetentionCandidates(articles, 5)).toEqual([]);
    expect(getReadRetentionCandidates(Array.from({ length: 101 }, (_, index) => ({ ...article, id: String(index) })))).toHaveLength(1);
  });

  it("counts only read articles toward the retention threshold", () => {
    const unread: Article[] = Array.from({ length: 900 }, (_, index) => ({
      ...article, id: `unread-${index}`,
      status: index % 2 ? "unread" : "in_progress"
    }));
    const read: Article[] = Array.from({ length: 100 }, (_, index) => ({
      ...article, id: `read-${index}`, completedAt: index
    }));
    expect(getReadRetentionCandidates([...read, ...unread], 100)).toEqual([]);
    expect(getReadRetentionCandidates([
      ...read, ...unread, { ...article, id: "read-101", completedAt: 101 }
    ], 100).map((entry) => entry.id)).toEqual(["read-0"]);
  });

  it("rejects unsafe retention limits and orders completion ties deterministically", () => {
    for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => getReadRetentionCandidates([article], limit)).toThrow(RangeError);
    }
    expect(getReadRetentionCandidates([{ ...article, id: "b" }, { ...article, id: "a" }], 1)[0].id).toBe("a");
  });

  it("falls back to the original save date for legacy snapshots missing updatedAt", () => {
    const legacy = { ...article, completedAt: undefined, updatedAt: undefined, originalSavedAt: 5 } as unknown as Article;
    expect(getReadRetentionCandidates([article, legacy], 1)).toEqual([legacy]);
  });

  it("matches exact identities first and normalized/canonical URLs for re-linking", () => {
    const history = [
      { ...article, archivedAt: 10 },
      { ...article, id: "recent", archivedAt: 20, canonicalUrl: "https://example.com/canonical" }
    ];
    expect(findReadingHistoryMatch(article, history)?.id).toBe(article.id);
    expect(findReadingHistoryMatch({ id: "new", normalizedUrl: `${article.normalizedUrl}?utm_source=test` }, history)?.id).toBe("recent");
    expect(findReadingHistoryMatch({ id: "new", normalizedUrl: "https://example.com/canonical" }, history)?.id).toBe("recent");
    expect(findReadingHistoryMatch({ id: "new", normalizedUrl: "https://example.com/other" }, history)).toBeUndefined();
  });
});

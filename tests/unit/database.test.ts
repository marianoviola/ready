import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ReadyDatabase } from "../../src/db/database";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => indexedDB.deleteDatabase(name)));
});

describe("database schema", () => {
  it("opens version 3 with all recoverable data stores", async () => {
    const name = `ready-test-${crypto.randomUUID()}`;
    names.push(name);
    const database = new ReadyDatabase(name);
    await database.open();
    expect(database.verno).toBe(3);
    expect(database.tables.map((table) => table.name).sort()).toEqual([
      "annotations",
      "articles",
      "ignoredRecommendations",
      "readingHistory",
      "sessions",
      "sources"
    ]);
    database.close();
  });

  it("adds history without losing version 2 articles, sources or sessions", async () => {
    const name = `ready-history-migration-${crypto.randomUUID()}`;
    names.push(name);
    const legacy = new Dexie(name);
    legacy.version(2).stores({
      articles: "id, bookmarkId, bookmarkState, normalizedUrl, canonicalUrl, status, domain, originalSavedAt, lastReadAt, updatedAt",
      annotations: "id, articleId, unresolved, updatedAt",
      sessions: "id, articleId, startedAt, endedAt",
      ignoredRecommendations: "[articleId+category], articleId, category, ignoredAt",
      sources: "id, &normalizedUrl, domain, subscribed, updatedAt"
    });
    await legacy.table("articles").add({ id: "article", status: "read", updatedAt: 123 });
    await legacy.table("sessions").add({ id: "session", articleId: "article", activeSeconds: 100 });
    await legacy.table("sources").add({ id: "source", normalizedUrl: "https://example.com/" });
    legacy.close();
    const database = new ReadyDatabase(name);
    await database.open();
    expect(await database.articles.get("article")).toMatchObject({ status: "read", updatedAt: 123 });
    expect(await database.sessions.get("session")).toMatchObject({ activeSeconds: 100 });
    expect(await database.sources.count()).toBe(1);
    expect(await database.readingHistory.count()).toBe(0);
    expect(database.articles.schema.indexes.some((index) => index.name === "completedAt")).toBe(true);
    database.close();
  });

  it("adds Sources without losing version 1 article data", async () => {
    const name = `ready-migration-${crypto.randomUUID()}`;
    names.push(name);
    const legacy = new Dexie(name);
    legacy.version(1).stores({
      articles:
        "id, bookmarkId, bookmarkState, normalizedUrl, canonicalUrl, status, domain, originalSavedAt, lastReadAt, updatedAt",
      annotations: "id, articleId, unresolved, updatedAt",
      sessions: "id, articleId, startedAt, endedAt",
      ignoredRecommendations: "[articleId+category], articleId, category, ignoredAt"
    });
    await legacy.open();
    await legacy.table("articles").add({
      id: "legacy-article",
      bookmarkState: "orphaned",
      originalUrl: "https://example.com/legacy",
      normalizedUrl: "https://example.com/legacy",
      title: "Legacy",
      domain: "example.com",
      originalSavedAt: 100,
      status: "unread",
      progress: 0,
      createdAt: 100,
      updatedAt: 100
    });
    legacy.close();

    const database = new ReadyDatabase(name);
    await database.open();
    expect(await database.articles.get("legacy-article")).toBeDefined();
    expect(database.sources).toBeDefined();
    database.close();
  });
});

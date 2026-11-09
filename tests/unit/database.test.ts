import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { ReadyDatabase } from "../../src/db/database";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => indexedDB.deleteDatabase(name)));
});

describe("database schema", () => {
  it("opens version 2 with all recoverable data stores", async () => {
    const name = `ready-test-${crypto.randomUUID()}`;
    names.push(name);
    const database = new ReadyDatabase(name);
    await database.open();
    expect(database.verno).toBe(2);
    expect(database.tables.map((table) => table.name).sort()).toEqual([
      "annotations",
      "articles",
      "ignoredRecommendations",
      "sessions",
      "sources"
    ]);
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

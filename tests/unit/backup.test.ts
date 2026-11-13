import { describe, expect, it } from "vitest";
import {
  createBackup,
  mergeImportedArticle,
  mergeImportedReadingHistory,
  mergeImportedSource,
  previewImport
} from "../../src/domain/backup";
import type { Article, Source } from "../../src/domain/types";

const local: Article = {
  id: "local-id",
  bookmarkId: "edge-42",
  bookmarkState: "linked",
  originalUrl: "https://example.com/story",
  normalizedUrl: "https://example.com/story",
  title: "Story",
  domain: "example.com",
  originalSavedAt: 100,
  status: "in_progress",
  progress: 0.5,
  createdAt: 100,
  updatedAt: 500
};

const source: Source = {
  id: "source-id",
  name: "Example",
  url: "https://example.com/",
  normalizedUrl: "https://example.com/",
  domain: "example.com",
  subscribed: true,
  createdAt: 100,
  updatedAt: 200
};

describe("backup and import", () => {
  it("exports a browser-independent versioned document", () => {
    const backup = createBackup([local], [], [], [source]);
    expect(backup.schemaVersion).toBe(2);
    expect(backup.articles[0]).not.toHaveProperty("bookmarkId");
    expect(backup.articles[0]).not.toHaveProperty("bookmarkState");
    expect(backup.sources).toEqual([source]);
  });

  it("round-trips archived history and sessions without browser bookmark references", () => {
    const archived = { ...local, id: "archived", archivedAt: 900, completedAt: 400 };
    const session = {
      id: "session", articleId: archived.id, startedAt: 100, endedAt: 200,
      activeSeconds: 100, startProgress: 0, endProgress: 1
    };
    const backup = createBackup([local], [], [
      session, { ...session, id: "active", articleId: local.id },
      { ...session, id: "dangling", articleId: "missing" }
    ], [], [archived]);
    expect(backup.readingHistory?.[0]).not.toHaveProperty("bookmarkId");
    expect(backup.readingHistory?.[0]).not.toHaveProperty("bookmarkState");
    const preview = previewImport(JSON.parse(JSON.stringify(backup)), []);
    expect(preview.valid).toBe(true);
    expect(preview.backup?.readingHistory?.[0]).toMatchObject({
      id: "archived", archivedAt: 900, completedAt: 400
    });
    expect(preview.backup?.sessions.map((item) => item.id)).toEqual(["session", "active"]);
  });

  it("accepts old schema 2 backups without history", () => {
    const { readingHistory: _history, ...backup } = createBackup([local], [], []);
    expect(previewImport(backup, []).backup?.readingHistory).toEqual([]);
  });

  it("deduplicates history IDs and prefers active articles on export and import", () => {
    const entry = { ...local, id: "archived", archivedAt: 600 };
    const backup = createBackup([local], [], [], [], [
      { ...local, archivedAt: 600 }, entry, { ...entry, archivedAt: 700 }
    ]);
    expect(backup.readingHistory).toHaveLength(1);
    expect(backup.readingHistory?.[0].archivedAt).toBe(700);
    const preview = previewImport({
      ...backup,
      readingHistory: [
        ...backup.readingHistory!,
        { ...entry, archivedAt: 500 },
        { ...local, archivedAt: 800 }
      ]
    }, []);
    expect(preview.backup?.readingHistory).toHaveLength(1);
  });

  it("sanitizes archive metadata and filters imported dangling sessions", () => {
    const archived = { ...local, id: "archive", archivedAt: 700 };
    const backup = createBackup([], [], [], [], [archived]);
    const preview = previewImport({
      ...backup,
      readingHistory: [{
        ...archived, bookmarkId: "foreign", bookmarkState: "linked",
        normalizedUrl: "https://incorrect.test/", domain: "incorrect.test",
        tags: [" Science ", "science"], unexpected: "discard"
      }],
      sessions: [{ id: "dangling", articleId: "unknown", startedAt: 1, endedAt: 2, activeSeconds: 1 }]
    }, []);
    expect(preview.valid).toBe(true);
    expect(preview.backup?.readingHistory?.[0]).toMatchObject({
      normalizedUrl: local.normalizedUrl, domain: local.domain, tags: ["Science"]
    });
    expect(preview.backup?.readingHistory?.[0]).not.toHaveProperty("bookmarkId");
    expect(preview.backup?.readingHistory?.[0]).not.toHaveProperty("unexpected");
    expect(preview.backup?.sessions).toEqual([]);
  });

  it("rejects malformed archives before import", () => {
    const archived = { ...local, archivedAt: 700 };
    const backup = createBackup([], [], [], [], [archived]);
    expect(previewImport({ ...backup, readingHistory: {} }, []).valid).toBe(false);
    for (const patch of [
      { archivedAt: undefined }, { archivedAt: Infinity }, { completedAt: "bad" },
      { progress: NaN }, { originalUrl: "invalid" }, { tags: [3] },
      { updatedAt: undefined }, { title: null }, { status: "invalid" },
      { position: { progress: 5 } }
    ]) {
      expect(previewImport({ ...backup, readingHistory: [{ ...archived, ...patch }] }, []).valid).toBe(false);
    }
  });

  it("restores portable history as orphaned and preserves local history identity on merge", () => {
    const incoming = { ...createBackup([local], [], []).articles[0], archivedAt: 600 };
    expect(mergeImportedReadingHistory(incoming)).toMatchObject({
      id: local.id, bookmarkState: "orphaned", archivedAt: 600
    });
    const existing = { ...local, id: "local-history", archivedAt: 400 };
    expect(mergeImportedReadingHistory({ ...incoming, updatedAt: 900, progress: 1 }, existing)).toMatchObject({
      id: "local-history", bookmarkId: "edge-42", bookmarkState: "linked",
      archivedAt: 600, updatedAt: 900, progress: 1
    });
  });

  it("rejects malformed data before applying changes", () => {
    const preview = previewImport({ schemaVersion: 99, articles: [] }, [local]);
    expect(preview.valid).toBe(false);
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it("previews duplicates by normalized URL", () => {
    const backup = createBackup(
      [{ ...local, bookmarkId: undefined }],
      [],
      [],
      [source]
    );
    const preview = previewImport(backup, [local], [source]);
    expect(preview).toMatchObject({
      valid: true,
      newArticles: 0,
      mergedArticles: 1,
      newSources: 0,
      mergedSources: 1
    });
  });

  it("upgrades version 1 backups without sources", () => {
    const current = createBackup([local], [], []);
    const legacy = {
      ...current,
      schemaVersion: 1,
      sources: undefined
    };
    const preview = previewImport(legacy, []);
    expect(preview.valid).toBe(true);
    expect(preview.backup?.schemaVersion).toBe(2);
    expect(preview.backup?.sources).toEqual([]);
  });

  it("keeps newer local metadata while preserving the local identity", () => {
    const incoming = createBackup(
      [{ ...local, id: "portable-id", bookmarkId: undefined, updatedAt: 200, progress: 0.1 }],
      [],
      []
    ).articles[0];
    const merged = mergeImportedArticle(incoming, local);
    expect(merged.id).toBe("local-id");
    expect(merged.progress).toBe(0.5);
    expect(merged.bookmarkId).toBe("edge-42");
  });

  it("keeps the local source identity while merging newer metadata", () => {
    const merged = mergeImportedSource(
      {
        ...source,
        id: "portable-source",
        name: "Updated Example",
        updatedAt: 500
      },
      source
    );
    expect(merged.id).toBe("source-id");
    expect(merged.name).toBe("Updated Example");
  });

  it("round-trips source tags and rejects malformed tag fields", () => {
    const tagged = { ...source, tags: ["Tech", "Weekly"] };
    const backup = createBackup([], [], [], [tagged]);
    expect(previewImport(JSON.parse(JSON.stringify(backup)), []).backup?.sources[0].tags).toEqual(tagged.tags);
    for (const tags of ["Tech", [42], null]) {
      expect(previewImport({ ...backup, sources: [{ ...source, tags }] }, []).errors).toContain("Source 1 has invalid tags.");
    }
    expect(previewImport(createBackup([], [], [], [source]), []).valid).toBe(true);
  });

  it("preserves local tags when importing a newer legacy source without tags", () => {
    const tagged = { ...source, tags: ["Tech"] };
    expect(mergeImportedSource({ ...source, updatedAt: 500 }, tagged).tags).toEqual(["Tech"]);
    expect(mergeImportedSource({ ...source, updatedAt: 500, tags: [] }, tagged).tags).toEqual([]);
    expect(mergeImportedSource({ ...source, tags: [" Tech ", "tech"] }).tags).toEqual(["Tech"]);
    expect(mergeImportedSource({ ...source, updatedAt: 100, tags: ["Old"] }, tagged).tags).toEqual(["Tech"]);
  });
});

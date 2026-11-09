import { describe, expect, it } from "vitest";
import {
  createBackup,
  mergeImportedArticle,
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
});

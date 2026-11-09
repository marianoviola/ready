import { describe, expect, it } from "vitest";
import {
  createBackup,
  mergeImportedArticle,
  previewImport
} from "../../src/domain/backup";
import type { Article } from "../../src/domain/types";

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

describe("backup and import", () => {
  it("exports a browser-independent versioned document", () => {
    const backup = createBackup([local], [], []);
    expect(backup.schemaVersion).toBe(1);
    expect(backup.articles[0]).not.toHaveProperty("bookmarkId");
    expect(backup.articles[0]).not.toHaveProperty("bookmarkState");
  });

  it("rejects malformed data before applying changes", () => {
    const preview = previewImport({ schemaVersion: 99, articles: [] }, [local]);
    expect(preview.valid).toBe(false);
    expect(preview.errors.length).toBeGreaterThan(0);
  });

  it("previews duplicates by normalized URL", () => {
    const backup = createBackup([{ ...local, bookmarkId: undefined }], [], []);
    const preview = previewImport(backup, [local]);
    expect(preview).toMatchObject({
      valid: true,
      newArticles: 0,
      mergedArticles: 1
    });
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
});

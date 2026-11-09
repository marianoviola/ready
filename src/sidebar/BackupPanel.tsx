import { useRef, useState } from "react";
import { getBookmarkTree } from "../browser/bookmarks";
import { db } from "../db/database";
import {
  createBackup,
  mergeImportedArticle,
  mergeImportedSource,
  previewImport
} from "../domain/backup";
import type {
  Article,
  BookmarkNode,
  ImportPreview,
  Source
} from "../domain/types";
import { normalizeUrl } from "../domain/url";

interface BackupPanelProps {
  articles: Article[];
  sources: Source[];
  selectedIds: Set<string>;
  onChanged: () => Promise<void>;
}

export function BackupPanel({
  articles,
  sources,
  selectedIds,
  onChanged
}: BackupPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview>();
  const [message, setMessage] = useState("");

  async function exportData(selectedOnly: boolean) {
    const chosen = selectedOnly
      ? articles.filter((article) => selectedIds.has(article.id))
      : articles;
    const ids = new Set(chosen.map((article) => article.id));
    const [annotations, sessions] = await Promise.all([
      db.annotations.filter((item) => ids.has(item.articleId)).toArray(),
      db.sessions.filter((item) => ids.has(item.articleId)).toArray()
    ]);
    const backup = createBackup(
      chosen,
      annotations,
      sessions,
      selectedOnly ? [] : sources
    );
    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ready-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Exported ${chosen.length} article${chosen.length === 1 ? "" : "s"}.`);
  }

  async function chooseFile(file?: File) {
    setMessage("");
    setPreview(undefined);
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setPreview(previewImport(parsed, articles, sources));
    } catch {
      setPreview({
        valid: false,
        errors: ["The selected file is not valid JSON."],
        newArticles: 0,
        mergedArticles: 0,
        orphanedArticles: 0,
        newSources: 0,
        mergedSources: 0
      });
    }
  }

  async function applyImport() {
    if (!preview?.valid || !preview.backup) return;
    const backup = preview.backup;
    const bookmarkTree = await getBookmarkTree();
    const bookmarks = flatten(bookmarkTree).filter((node) => node.url);
    const local = await db.articles.toArray();
    const localSources = await db.sources.toArray();
    const articleIdMap = new Map<string, string>();

    await db.transaction(
      "rw",
      [db.articles, db.annotations, db.sessions, db.sources],
      async () => {
        for (const incoming of backup.articles) {
          const localMatch = local.find(
            (article) => article.normalizedUrl === normalizeUrl(incoming.originalUrl)
          );
          const bookmarkId = bookmarks.find(
            (bookmark) =>
              bookmark.url &&
              normalizedUrlsMatch(bookmark.url, incoming.originalUrl)
          )?.id;
          const merged = mergeImportedArticle(incoming, localMatch, bookmarkId);
          articleIdMap.set(incoming.id, merged.id);
          await db.articles.put(merged);
        }
        for (const annotation of backup.annotations) {
          const mapped = {
            ...annotation,
            articleId: articleIdMap.get(annotation.articleId) ?? annotation.articleId
          };
          const existing = await db.annotations.get(mapped.id);
          if (!existing || mapped.updatedAt > existing.updatedAt) {
            await db.annotations.put(mapped);
          }
        }
        for (const session of backup.sessions) {
          const mapped = {
            ...session,
            articleId: articleIdMap.get(session.articleId) ?? session.articleId
          };
          if (!(await db.sessions.get(mapped.id))) await db.sessions.put(mapped);
        }
        for (const source of backup.sources) {
          const localMatch = localSources.find(
            (item) => item.normalizedUrl === source.normalizedUrl
          );
          await db.sources.put(mergeImportedSource(source, localMatch));
        }
      }
    );
    setMessage(
      `Imported ${preview.newArticles} new articles and ${preview.newSources} new sources.`
    );
    setPreview(undefined);
    if (inputRef.current) inputRef.current.value = "";
    await onChanged();
  }

  return (
    <section className="panel-page" aria-labelledby="backup-heading">
      <div className="section-heading">
        <p className="eyebrow">Portable and local</p>
        <h2 id="backup-heading">Backup & restore</h2>
        <p className="muted">
          Ready exports reading data only. Edge continues to manage and sync your Favorites.
        </p>
      </div>

      <div className="settings-card">
        <h3>Export JSON</h3>
        <p className="muted">
          Includes reading progress, positions, sessions, highlights, sources, and private notes.
        </p>
        <div className="button-row">
          <button className="button primary" onClick={() => void exportData(false)}>
            Export all
          </button>
          <button
            className="button secondary"
            disabled={selectedIds.size === 0}
            onClick={() => void exportData(true)}
          >
            Export selected ({selectedIds.size})
          </button>
        </div>
      </div>

      <div className="settings-card">
        <h3>Import JSON</h3>
        <p className="muted">
          Ready validates and previews the file before changing local data.
        </p>
        <input
          ref={inputRef}
          className="file-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        {preview && (
          <div className={preview.valid ? "import-preview" : "error"} role="status">
            {preview.valid ? (
              <>
                <strong>Import preview</strong>
                <span>{preview.newArticles} new articles</span>
                <span>{preview.mergedArticles} matched local articles</span>
                <span>{preview.orphanedArticles} checked against current Favorites</span>
                <span>{preview.newSources} new sources</span>
                <span>{preview.mergedSources} matched local sources</span>
                <button className="button primary" onClick={() => void applyImport()}>
                  Apply import
                </button>
              </>
            ) : (
              preview.errors.map((error) => <span key={error}>{error}</span>)
            )}
          </div>
        )}
      </div>
      {message && <p className="success" role="status">{message}</p>}
    </section>
  );
}

function flatten(nodes: BookmarkNode[]): BookmarkNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.children ? flatten(node.children) : [])
  ]);
}

function normalizedUrlsMatch(left: string, right: string): boolean {
  try {
    return normalizeUrl(left) === normalizeUrl(right);
  } catch {
    return false;
  }
}

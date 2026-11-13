import { useRef, useState } from "react";
import { getBookmarkTree } from "../browser/bookmarks";
import { sendReadyMessage } from "../browser/messages";
import { db } from "../db/database";
import {
  createBackup,
  mergeImportedArticle,
  mergeImportedReadingHistory,
  mergeImportedSource,
  previewImport
} from "../domain/backup";
import { findReadingHistoryMatch } from "../domain/reading-history";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function exportData(selectedOnly: boolean) {
    setError("");
    setBusy(true);
    try {
      const chosen = selectedOnly
        ? articles.filter((article) => selectedIds.has(article.id))
        : articles;
      const history = selectedOnly ? [] : await db.readingHistory.toArray();
      const ids = new Set([...chosen, ...history].map((article) => article.id));
      const [annotations, sessions] = await Promise.all([
        db.annotations.filter((item) => ids.has(item.articleId)).toArray(),
        db.sessions.filter((item) => ids.has(item.articleId)).toArray()
      ]);
      const backup = createBackup(
        chosen,
        annotations,
        sessions,
        selectedOnly ? [] : sources,
        history
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
      setMessage(`Exported ${chosen.length} active articles and ${history.length} archived articles.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The backup could not be exported.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseFile(file?: File) {
    setMessage("");
    setError("");
    setPreview(undefined);
    if (!file) return;
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setPreview(previewImport(parsed, articles, sources));
    } catch (reason) {
      setError(reason instanceof SyntaxError
        ? "The selected file is not valid JSON."
        : reason instanceof Error ? reason.message : "The selected file could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!preview?.valid || !preview.backup) return;
    setError("");
    setBusy(true);
    try {
      const backup = preview.backup;
      const bookmarkTree = await getBookmarkTree();
      const bookmarks = flatten(bookmarkTree).filter((node) => node.url);
      const articleIdMap = new Map<string, string>();

      await db.transaction(
        "rw",
        [db.articles, db.readingHistory, db.annotations, db.sessions, db.sources],
        async () => {
          for (const incoming of backup.articles) {
            const archivedMatch = findReadingHistoryMatch(incoming, await db.readingHistory.toArray());
            const localMatch = await db.articles.where("normalizedUrl").equals(normalizeUrl(incoming.originalUrl)).first();
            const bookmarkId = bookmarks.find(
              (bookmark) =>
                bookmark.url &&
                normalizedUrlsMatch(bookmark.url, incoming.originalUrl)
            )?.id;
            let archivedArticle: Article | undefined;
            if (archivedMatch) {
              const { archivedAt: _archivedAt, ...article } = archivedMatch;
              archivedArticle = article;
            }
            const merged = mergeImportedArticle(incoming, localMatch ?? archivedArticle, bookmarkId);
            articleIdMap.set(incoming.id, merged.id);
            await db.articles.put(merged);
            await db.readingHistory.delete(merged.id);
          }
          for (const incoming of backup.readingHistory ?? []) {
            const active = await db.articles.where("normalizedUrl").equals(normalizeUrl(incoming.originalUrl)).first();
            if (active) {
              articleIdMap.set(incoming.id, active.id);
              await db.articles.put(mergeImportedArticle(incoming, active, active.bookmarkId));
              continue;
            }
            const match = findReadingHistoryMatch(incoming, await db.readingHistory.toArray());
            const merged = mergeImportedReadingHistory(incoming, match);
            articleIdMap.set(incoming.id, merged.id);
            await db.readingHistory.put(merged);
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
            const localMatch = await db.sources.where("normalizedUrl").equals(source.normalizedUrl).first();
            await db.sources.put(mergeImportedSource(source, localMatch));
          }
        }
      );
      const cleanup = await sendReadyMessage({ type: "APPLY_READING_RETENTION" });
      if (!cleanup.ok) throw new Error(`Backup imported, but cleanup failed: ${cleanup.error}`);
      setMessage(
        `Imported ${preview.newArticles} new articles, ${preview.newSources} new sources, and ${backup.readingHistory?.length ?? 0} archived articles.`
      );
      setPreview(undefined);
      if (inputRef.current) inputRef.current.value = "";
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The backup could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-page settings-backup" aria-labelledby="backup-heading" aria-busy={busy}>
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
          Includes reading progress, positions, sessions, archived reading history, highlights, sources, and private notes.
        </p>
        <div className="button-row">
          <button className="button primary" disabled={busy} onClick={() => void exportData(false)}>
            Export all
          </button>
          <button
            className="button secondary"
            disabled={busy || selectedIds.size === 0}
            onClick={() => void exportData(true)}
          >
            Export selected ({selectedIds.size})
          </button>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="settings-card">
        <h3>Import JSON</h3>
        <p className="muted">
          Ready validates and previews the file before changing local data.
        </p>
        <input
          ref={inputRef}
          hidden
          aria-label="Import JSON file"
          type="file"
          disabled={busy}
          accept="application/json,.json"
          onChange={(event) => void chooseFile(event.target.files?.[0])}
        />
        <div className="button-row">
          <button type="button" className="button secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
            Choose JSON file
          </button>
        </div>
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
                <span>{preview.backup?.readingHistory?.length ?? 0} archived articles</span>
                <button className="button primary" disabled={busy} onClick={() => void applyImport()}>
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

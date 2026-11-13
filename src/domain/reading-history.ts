import { db, type ReadyDatabase } from "../db/database";
import type { Article, ReadingHistoryEntry } from "./types";
import { urlsMatch } from "./url";

export const DEFAULT_READ_RETENTION_LIMIT = 100;

export async function archiveReadingHistory(
  article: Article,
  database: ReadyDatabase = db
): Promise<void> {
  await database.transaction("rw", database.readingHistory, async () => {
    const existing = await database.readingHistory.get(article.id);
    const entry: ReadingHistoryEntry = {
      ...article,
      archivedAt: existing?.archivedAt ?? Date.now()
    };
    await database.readingHistory.put(entry);
  });
}

// Call only after restoring the active article, ideally in the same transaction.
export async function restoreReadingHistory(
  articleId: string,
  database: ReadyDatabase = db
): Promise<void> {
  await database.readingHistory.delete(articleId);
}

export function getReadRetentionCandidates(
  articles: Article[],
  limit = DEFAULT_READ_RETENTION_LIMIT
): Article[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("Reading retention limit must be a positive integer.");
  }
  const readArticles = articles.filter((article) => article.status === "read");
  const excess = Math.max(0, readArticles.length - limit);
  return readArticles
    .sort((left, right) =>
      (left.completedAt ?? left.updatedAt ?? left.originalSavedAt) -
        (right.completedAt ?? right.updatedAt ?? right.originalSavedAt) ||
      left.id.localeCompare(right.id)
    )
    .slice(0, excess);
}

export function findReadingHistoryMatch(
  article: Pick<Article, "id" | "normalizedUrl" | "canonicalUrl">,
  history: ReadingHistoryEntry[]
): ReadingHistoryEntry | undefined {
  return history.find((entry) => entry.id === article.id) ??
    history
      .filter((entry) =>
        [article.normalizedUrl, article.canonicalUrl].some((url) =>
          url && [entry.normalizedUrl, entry.canonicalUrl].some((candidate) =>
            candidate && urlsMatch(url, candidate)
          )
        )
      )
      .sort((left, right) => right.archivedAt - left.archivedAt || left.id.localeCompare(right.id))[0];
}

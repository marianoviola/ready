import { db } from "../db/database";
import { getReadRetentionCandidates } from "../domain/reading-history";
import { removeArticle } from "./bookmarks";

export interface ReadingRetention {
  enabled: boolean;
  maxReadArticles: number;
}

export const DEFAULT_READING_RETENTION: ReadingRetention = {
  enabled: false,
  maxReadArticles: 100
};

export function validateReadingRetention(value: unknown): ReadingRetention {
  if (!value || typeof value !== "object") throw new Error("Reading-list automation settings are invalid.");
  const enabled: unknown = Reflect.get(value, "enabled");
  const maxReadArticles: unknown = Reflect.get(value, "maxReadArticles");
  if (typeof enabled !== "boolean" || typeof maxReadArticles !== "number" || !Number.isSafeInteger(maxReadArticles) || maxReadArticles < 1) {
    throw new Error("Choose a whole number of read articles greater than zero.");
  }
  return { enabled, maxReadArticles };
}

export async function getReadingRetention(): Promise<ReadingRetention> {
  const stored = await chrome.storage.local.get("readingRetention");
  return stored.readingRetention === undefined
    ? { ...DEFAULT_READING_RETENTION }
    : validateReadingRetention(stored.readingRetention);
}

let pendingCleanup: Promise<number> | undefined;

export async function enforceReadingRetention(): Promise<number> {
  const previous = pendingCleanup;
  const cleanup = (async () => {
    if (previous) {
      // Its caller reports any failure; a later request must still be able to retry.
      try { await previous; } catch { /* Retry from the current database state. */ }
    }
    const settings = await getReadingRetention();
    if (!settings.enabled) return 0;
    const candidates = getReadRetentionCandidates(await db.articles.toArray(), settings.maxReadArticles);
    let removed = 0;
    for (const article of candidates) {
      const didRemove = await db.transaction(
        "rw", [db.articles, db.readingHistory, db.annotations, db.sessions, db.ignoredRecommendations],
        async () => {
          const current = await db.articles.get(article.id);
          if (current?.status !== "read") return false;
          await removeArticle(article.id, false);
          return true;
        }
      );
      if (didRemove) removed++;
    }
    return removed;
  })();
  pendingCleanup = cleanup;
  try {
    return await cleanup;
  } finally {
    if (pendingCleanup === cleanup) pendingCleanup = undefined;
  }
}

export async function saveReadingRetention(value: unknown): Promise<number> {
  const settings = validateReadingRetention(value);
  await chrome.storage.local.set({ readingRetention: settings });
  try {
    return await enforceReadingRetention();
  } catch (error) {
    throw new Error(`Automation settings were saved, but cleanup failed: ${error instanceof Error ? error.message : "Unexpected cleanup error."}`);
  }
}

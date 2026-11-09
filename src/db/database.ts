import Dexie, { type EntityTable } from "dexie";
import type {
  Annotation,
  Article,
  IgnoredRecommendation,
  ReadingSession,
  Source
} from "../domain/types";

export class ReadyDatabase extends Dexie {
  articles!: EntityTable<Article, "id">;
  annotations!: EntityTable<Annotation, "id">;
  sessions!: EntityTable<ReadingSession, "id">;
  ignoredRecommendations!: EntityTable<IgnoredRecommendation, "articleId">;
  sources!: EntityTable<Source, "id">;

  constructor(name = "ready-reading-list") {
    super(name);

    this.version(1).stores({
      articles:
        "id, bookmarkId, bookmarkState, normalizedUrl, canonicalUrl, status, domain, originalSavedAt, lastReadAt, updatedAt",
      annotations: "id, articleId, unresolved, updatedAt",
      sessions: "id, articleId, startedAt, endedAt",
      ignoredRecommendations: "[articleId+category], articleId, category, ignoredAt"
    });

    this.version(2).stores({
      articles:
        "id, bookmarkId, bookmarkState, normalizedUrl, canonicalUrl, status, domain, originalSavedAt, lastReadAt, updatedAt",
      annotations: "id, articleId, unresolved, updatedAt",
      sessions: "id, articleId, startedAt, endedAt",
      ignoredRecommendations: "[articleId+category], articleId, category, ignoredAt",
      sources: "id, &normalizedUrl, domain, subscribed, updatedAt"
    });
  }
}

export const db = new ReadyDatabase();

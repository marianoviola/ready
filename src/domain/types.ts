export type ReadingStatus = "unread" | "in_progress" | "read";
export type BookmarkState = "linked" | "orphaned";

export interface TextAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  domHint?: string;
}

export interface ReadingPosition {
  anchor: TextAnchor;
  progress: number;
  savedAt: number;
}

export interface Article {
  id: string;
  bookmarkId?: string;
  bookmarkState: BookmarkState;
  originalUrl: string;
  normalizedUrl: string;
  canonicalUrl?: string;
  title: string;
  domain: string;
  tags?: string[];
  originalSavedAt: number;
  status: ReadingStatus;
  progress: number;
  position?: ReadingPosition;
  createdAt: number;
  updatedAt: number;
  lastReadAt?: number;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  subscribed: boolean;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Annotation {
  id: string;
  articleId: string;
  anchor: TextAnchor;
  color: "yellow" | "green" | "blue" | "pink";
  note?: string;
  unresolved: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ReadingSession {
  id: string;
  articleId: string;
  startedAt: number;
  endedAt: number;
  activeSeconds: number;
  startProgress: number;
  endProgress: number;
}

export interface IgnoredRecommendation {
  articleId: string;
  category: RecommendationCategory;
  ignoredAt: number;
}

export type RecommendationCategory =
  | "forgotten"
  | "continue"
  | "related";

export interface Recommendation {
  articleId: string;
  category: RecommendationCategory;
  score: number;
  reason: string;
}

export interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  dateAdded?: number;
  linked?: boolean;
  children?: BookmarkNode[];
}

export interface ReadyBackup {
  schemaVersion: 2;
  exportedAt: string;
  articles: Array<Omit<Article, "bookmarkId" | "bookmarkState">>;
  annotations: Annotation[];
  sessions: ReadingSession[];
  sources: Source[];
}

export interface ImportPreview {
  valid: boolean;
  errors: string[];
  newArticles: number;
  mergedArticles: number;
  orphanedArticles: number;
  newSources: number;
  mergedSources: number;
  backup?: ReadyBackup;
}

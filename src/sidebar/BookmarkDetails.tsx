import { bookmarkMetadataForArticle, type BookmarkMetadata } from "../browser/bookmarks";
import type { Article, BookmarkNode } from "../domain/types";

export interface BookmarkDetailsProps {
  article: Article;
  tree?: BookmarkNode[];
  metadata?: BookmarkMetadata;
  pending?: boolean;
  error?: string;
}

export function BookmarkDetails({
  article, tree, metadata, pending = false, error
}: BookmarkDetailsProps) {
  const live = metadata ?? (tree ? bookmarkMetadataForArticle(article, tree) : undefined);
  const linked = live ? live.state === "linked" : article.bookmarkState === "linked" && Boolean(article.bookmarkId);
  const path = live?.folderPath.join(" / ");
  return (
    <div className="bookmark-details" aria-busy={pending}>
      <div className={`bookmark-state ${linked ? "linked" : "orphaned"}`}>
        <span aria-hidden="true">{linked ? "↗" : "⚠"}</span>{" "}
        <span>{linked ? "Linked to Edge Favorites" : "Not linked to Edge Favorites"}</span>
      </div>
      {linked ? (
        <p className="bookmark-folder-path muted" title={path}>
          <span className="sr-only">Favorite folder: </span>{path || "Folder unavailable"}
        </p>
      ) : (
        <p className="muted">Your reading progress, tags, highlights, and notes are safe in Ready.</p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

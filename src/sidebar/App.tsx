import { useCallback, useEffect, useMemo, useState } from "react";
import { sendReadyMessage } from "../browser/messages";
import { db } from "../db/database";
import { rankRecommendations } from "../domain/discovery";
import type {
  Annotation,
  Article,
  ReadingStatus,
  Recommendation
} from "../domain/types";
import { BackupPanel } from "./BackupPanel";
import { BookmarkPicker } from "./BookmarkPicker";

type View = "library" | "discover" | "backup";
type Grouping = "date" | "domain" | "status";
type Sort = "added" | "activity";

export function App() {
  const [view, setView] = useState<View>("library");
  const [articles, setArticles] = useState<Article[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | "all">("all");
  const [orphanedOnly, setOrphanedOnly] = useState(false);
  const [domainFilter, setDomainFilter] = useState("all");
  const [grouping, setGrouping] = useState<Grouping>("status");
  const [sort, setSort] = useState<Sort>("activity");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<"import" | "restore">();
  const [restoreArticleId, setRestoreArticleId] = useState<string>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const [nextArticles, nextAnnotations, ignored] = await Promise.all([
        db.articles.toArray(),
        db.annotations.toArray(),
        db.ignoredRecommendations.toArray()
      ]);
      setArticles(nextArticles);
      setAnnotations(nextAnnotations);
      setRecommendations(
        rankRecommendations(nextArticles, nextAnnotations, ignored)
      );
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ready could not load your library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const domains = useMemo(
    () => [...new Set(articles.map((article) => article.domain))].sort(),
    [articles]
  );
  const notesByArticle = useMemo(() => {
    const map = new Map<string, string>();
    for (const annotation of annotations) {
      if (annotation.note) {
        map.set(
          annotation.articleId,
          `${map.get(annotation.articleId) ?? ""} ${annotation.note}`.toLowerCase()
        );
      }
    }
    return map;
  }, [annotations]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return articles
      .filter((article) => statusFilter === "all" || article.status === statusFilter)
      .filter((article) => !orphanedOnly || article.bookmarkState === "orphaned")
      .filter((article) => domainFilter === "all" || article.domain === domainFilter)
      .filter(
        (article) =>
          !query ||
          article.title.toLowerCase().includes(query) ||
          article.domain.toLowerCase().includes(query) ||
          notesByArticle.get(article.id)?.includes(query)
      )
      .sort((left, right) =>
        sort === "added"
          ? right.originalSavedAt - left.originalSavedAt
          : (right.lastReadAt ?? 0) - (left.lastReadAt ?? 0) ||
            right.originalSavedAt - left.originalSavedAt
      );
  }, [
    articles,
    domainFilter,
    notesByArticle,
    orphanedOnly,
    search,
    sort,
    statusFilter
  ]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Article[]>();
    for (const article of filtered) {
      const key =
        grouping === "status"
          ? statusLabel(article.status)
          : grouping === "domain"
            ? article.domain
            : dateGroup(article.originalSavedAt);
      groups.set(key, [...(groups.get(key) ?? []), article]);
    }
    return [...groups.entries()];
  }, [filtered, grouping]);

  async function saveCurrentPage() {
    clearFeedback();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !/^https?:/.test(tab.url)) {
        throw new Error("Ready can save standard http and https pages.");
      }
      await requestSiteAccess(tab.url);
      const response = await sendReadyMessage({ type: "SAVE_ACTIVE_PAGE" });
      if (!response.ok) throw new Error(response.error);
      if (!("createdBookmark" in response)) {
        throw new Error("Ready received an unexpected save response.");
      }
      setMessage(
        response.createdBookmark
          ? "Saved to Edge Favorites and Ready."
          : "Added the existing Favorite to Ready."
      );
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The page could not be saved.");
    }
  }

  async function openArticle(article: Article, resume: boolean) {
    clearFeedback();
    try {
      await requestSiteAccess(article.originalUrl);
      const response = await sendReadyMessage({
        type: "OPEN_ARTICLE",
        articleId: article.id,
        resume
      });
      if (!response.ok) throw new Error(response.error);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The article could not be opened.");
    }
  }

  async function setStatus(articleId: string, status: ReadingStatus) {
    const response = await sendReadyMessage({ type: "SET_STATUS", articleId, status });
    if (!response.ok) setError(response.error);
    else await loadData();
  }

  async function removeArticle(article: Article) {
    const remove = window.confirm(
      `Remove “${article.title}” from Ready? Your progress, highlights, and notes for it will be deleted.`
    );
    if (!remove) return;
    const deleteBookmark =
      article.bookmarkState === "linked" &&
      window.confirm("Also delete the linked Edge Favorite?");
    const response = await sendReadyMessage({
      type: "REMOVE_ARTICLE",
      articleId: article.id,
      deleteBookmark
    });
    if (!response.ok) setError(response.error);
    else {
      setMessage("Article removed from Ready.");
      await loadData();
    }
  }

  async function restore(folderId?: string) {
    if (!restoreArticleId) return;
    const response = await sendReadyMessage({
      type: "RESTORE_BOOKMARK",
      articleId: restoreArticleId,
      folderId
    });
    if (!response.ok) throw new Error(response.error);
    setMessage("Favorite restored without changing reading data.");
    setRestoreArticleId(undefined);
    await loadData();
  }

  async function editAnnotation(annotation: Annotation) {
    const note = window.prompt("Edit private note:", annotation.note ?? "");
    if (note === null) return;
    const response = await sendReadyMessage({
      type: "UPDATE_ANNOTATION",
      annotationId: annotation.id,
      note
    });
    if (!response.ok) setError(response.error);
    else await loadData();
  }

  async function deleteAnnotation(annotation: Annotation) {
    if (!window.confirm("Remove this highlight and its note?")) return;
    const response = await sendReadyMessage({
      type: "DELETE_ANNOTATION",
      annotationId: annotation.id
    });
    if (!response.ok) setError(response.error);
    else await loadData();
  }

  async function ignoreRecommendation(recommendation: Recommendation) {
    await db.ignoredRecommendations.put({
      articleId: recommendation.articleId,
      category: recommendation.category,
      ignoredAt: Date.now()
    });
    await loadData();
  }

  function clearFeedback() {
    setMessage("");
    setError("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">R</span>
          <div>
            <h1>Ready</h1>
            <span>Your reading, kept local</span>
          </div>
        </div>
        <button className="button primary compact" onClick={() => void saveCurrentPage()}>
          <span aria-hidden="true">＋</span> Save page
        </button>
      </header>

      <nav className="tabs" aria-label="Ready sections">
        {(["library", "discover", "backup"] as View[]).map((item) => (
          <button
            key={item}
            className={view === item ? "tab active" : "tab"}
            aria-current={view === item ? "page" : undefined}
            onClick={() => setView(item)}
          >
            {item === "library" ? "Library" : item === "discover" ? "Discover" : "Backup"}
            {item === "library" && <span className="count">{articles.length}</span>}
          </button>
        ))}
      </nav>

      {error && <div className="feedback error" role="alert">{error}</div>}
      {message && <div className="feedback success" role="status">{message}</div>}

      {view === "library" && (
        <main className="library">
          <div className="search-row">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search articles and notes</span>
              <input
                type="search"
                placeholder="Search articles and notes"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button className="button secondary compact" onClick={() => setPicker("import")}>
              Import
            </button>
          </div>

          <div className="filters" aria-label="Library filters">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as ReadingStatus | "all")} aria-label="Reading status">
              <option value="all">All statuses</option>
              <option value="unread">Unread</option>
              <option value="in_progress">In progress</option>
              <option value="read">Read</option>
            </select>
            <select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)} aria-label="Website">
              <option value="all">All websites</option>
              {domains.map((domain) => <option key={domain}>{domain}</option>)}
            </select>
            <label className="check-filter">
              <input type="checkbox" checked={orphanedOnly} onChange={(event) => setOrphanedOnly(event.target.checked)} />
              Orphaned
            </label>
          </div>

          <div className="organize-row">
            <label>Group
              <select value={grouping} onChange={(event) => setGrouping(event.target.value as Grouping)}>
                <option value="status">Status</option>
                <option value="date">Date added</option>
                <option value="domain">Website</option>
              </select>
            </label>
            <label>Sort
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                <option value="activity">Last activity</option>
                <option value="added">Date added</option>
              </select>
            </label>
          </div>

          {loading ? (
            <EmptyState title="Opening your library…" detail="Ready is loading local reading data." />
          ) : grouped.length === 0 ? (
            <EmptyState
              title={articles.length === 0 ? "Your library is ready" : "No articles match"}
              detail={articles.length === 0 ? "Save this page or import existing Edge Favorites to begin." : "Try changing the filters or search."}
            />
          ) : (
            grouped.map(([group, items]) => (
              <section className="article-group" key={group}>
                <div className="group-heading"><h2>{group}</h2><span>{items.length}</span></div>
                <div className="article-list">
                  {items.map((article) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      annotations={annotations.filter((item) => item.articleId === article.id)}
                      selected={selectedIds.has(article.id)}
                      onSelected={(selected) => {
                        const next = new Set(selectedIds);
                        if (selected) next.add(article.id); else next.delete(article.id);
                        setSelectedIds(next);
                      }}
                      onOpen={openArticle}
                      onStatus={setStatus}
                      onRestore={() => {
                        setRestoreArticleId(article.id);
                        setPicker("restore");
                      }}
                      onRemove={removeArticle}
                      onEditAnnotation={editAnnotation}
                      onDeleteAnnotation={deleteAnnotation}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </main>
      )}

      {view === "discover" && (
        <main className="panel-page">
          <div className="section-heading">
            <p className="eyebrow">From your library</p>
            <h2>Rediscover something worth reading</h2>
            <p className="muted">Private recommendations calculated on this device.</p>
          </div>
          {recommendations.length === 0 ? (
            <EmptyState title="Nothing to surface yet" detail="Recommendations appear as your local library and reading history grow." />
          ) : (
            <div className="recommendations">
              {recommendations.map((recommendation) => {
                const article = articles.find((item) => item.id === recommendation.articleId);
                if (!article) return null;
                return (
                  <article className="recommendation-card" key={`${recommendation.articleId}:${recommendation.category}`}>
                    <span className={`category category-${recommendation.category}`}>
                      {categoryLabel(recommendation.category)}
                    </span>
                    <h3>{article.title}</h3>
                    <p className="muted">{recommendation.reason}</p>
                    <div className="button-row">
                      <button className="button primary" onClick={() => void openArticle(article, article.status === "in_progress")}>Open</button>
                      <button className="button ghost" onClick={() => void ignoreRecommendation(recommendation)}>Not now</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </main>
      )}

      {view === "backup" && (
        <BackupPanel articles={articles} selectedIds={selectedIds} onChanged={loadData} />
      )}

      {picker && (
        <BookmarkPicker
          mode={picker === "import" ? "import" : "folder"}
          onClose={() => {
            setPicker(undefined);
            setRestoreArticleId(undefined);
          }}
          onComplete={picker === "import" ? loadData : restore}
        />
      )}
    </div>
  );
}

interface ArticleCardProps {
  article: Article;
  annotations: Annotation[];
  selected: boolean;
  onSelected: (selected: boolean) => void;
  onOpen: (article: Article, resume: boolean) => Promise<void>;
  onStatus: (id: string, status: ReadingStatus) => Promise<void>;
  onRestore: () => void;
  onRemove: (article: Article) => Promise<void>;
  onEditAnnotation: (annotation: Annotation) => Promise<void>;
  onDeleteAnnotation: (annotation: Annotation) => Promise<void>;
}

function ArticleCard(props: ArticleCardProps) {
  const { article, annotations } = props;
  return (
    <article className="article-card">
      <div className="article-select">
        <input type="checkbox" checked={props.selected} onChange={(event) => props.onSelected(event.target.checked)} aria-label={`Select ${article.title}`} />
      </div>
      <div className="article-body">
        <div className="article-topline">
          <span className={`status-dot status-${article.status}`} aria-hidden="true" />
          <span>{article.domain}</span>
          <span>·</span>
          <time dateTime={new Date(article.originalSavedAt).toISOString()}>{relativeDate(article.originalSavedAt)}</time>
          {article.bookmarkState === "orphaned" && <span className="orphan-badge">Favorite removed</span>}
        </div>
        <button className="article-title" onClick={() => void props.onOpen(article, false)}>{article.title}</button>
        {article.progress > 0 && (
          <div className="progress-row">
            <div className="progress-track" role="progressbar" aria-valuenow={Math.round(article.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.round(article.progress * 100)}%` }} />
            </div>
            <span>{Math.round(article.progress * 100)}%</span>
          </div>
        )}
        <div className="card-actions">
          {article.position && <button className="text-button" onClick={() => void props.onOpen(article, true)}>Resume</button>}
          <select value={article.status} onChange={(event) => void props.onStatus(article.id, event.target.value as ReadingStatus)} aria-label={`Status for ${article.title}`}>
            <option value="unread">Unread</option>
            <option value="in_progress">In progress</option>
            <option value="read">Read</option>
          </select>
          {article.bookmarkState === "orphaned" && <button className="text-button" onClick={props.onRestore}>Restore Favorite</button>}
          <button className="text-button danger-text" onClick={() => void props.onRemove(article)}>Remove</button>
        </div>
        {annotations.length > 0 && (
          <details className="notes">
            <summary>{annotations.length} highlight{annotations.length === 1 ? "" : "s"} & notes</summary>
            {annotations.map((annotation) => (
              <div className="note" key={annotation.id}>
                <blockquote>{annotation.anchor.exact}</blockquote>
                {annotation.note && <p>{annotation.note}</p>}
                {annotation.unresolved && <span className="unresolved">Source text changed — unresolved</span>}
                <div>
                  <button className="text-button" onClick={() => void props.onEditAnnotation(annotation)}>{annotation.note ? "Edit note" : "Add note"}</button>
                  <button className="text-button danger-text" onClick={() => void props.onDeleteAnnotation(annotation)}>Delete</button>
                </div>
              </div>
            ))}
          </details>
        )}
      </div>
    </article>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><span className="empty-icon" aria-hidden="true">R</span><h2>{title}</h2><p>{detail}</p></div>;
}

async function requestSiteAccess(url: string): Promise<void> {
  const origin = `${new URL(url).origin}/*`;
  const hasAccess = await chrome.permissions.contains({ origins: [origin] });
  if (!hasAccess) {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      throw new Error("Site access is required to track progress and restore highlights on this page.");
    }
  }
}

function statusLabel(status: ReadingStatus): string {
  return status === "in_progress" ? "In progress" : status === "unread" ? "Unread" : "Read";
}

function categoryLabel(category: Recommendation["category"]): string {
  return category === "continue" ? "Continue reading" : category === "forgotten" ? "Forgotten favorite" : "Related";
}

function dateGroup(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) return "This month";
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString(undefined, { month: "long" });
  return String(date.getFullYear());
}

function relativeDate(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: days > 365 ? "numeric" : undefined });
}

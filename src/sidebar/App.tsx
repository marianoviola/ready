import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendReadyMessage } from "../browser/messages";
import { db } from "../db/database";
import {
  compareArticles,
  type ArticleSort
} from "../domain/article-sort";
import { rankRecommendations } from "../domain/discovery";
import { moveGroup, reconcileGroupOrder } from "../domain/group-order";
import { mergeTags, normalizeTags } from "../domain/tags";
import { urlsMatch } from "../domain/url";
import type {
  Annotation,
  Article,
  ReadingStatus,
  Recommendation,
  Source
} from "../domain/types";
import { BackupPanel } from "./BackupPanel";
import { BookmarkPicker } from "./BookmarkPicker";
import { BookmarkSettings } from "./BookmarkSettings";
import { SourceEditor, SourcesPanel } from "./SourcesPanel";
import { TagEditor } from "./TagEditor";

type View = "library" | "tags" | "sources" | "discover" | "backup";
type Grouping = "date" | "domain" | "status" | "tag";
type GroupOrders = Record<Grouping, string[]>;

export function App() {
  const headerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("library");
  const [articles, setArticles] = useState<Article[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReadingStatus | "all">("all");
  const [orphanedOnly, setOrphanedOnly] = useState(false);
  const [domainFilter, setDomainFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("status");
  const [layout, setLayout] = useState<"list" | "kanban">("list");
  const [groupOrders, setGroupOrders] = useState<GroupOrders>({ date: [], domain: [], status: [], tag: [] });
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const [activeUrl, setActiveUrl] = useState("");
  const [sort, setSort] = useState<ArticleSort>("activity");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<"link" | "restore">();
  const [restoreArticleId, setRestoreArticleId] = useState<string>();
  const [sourceArticle, setSourceArticle] = useState<Article>();
  const [tagEditor, setTagEditor] = useState<{ ids: string[]; initial: string[]; additive: boolean }>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const updateHeight = () => {
      header.parentElement?.style.setProperty("--app-header-height", `${header.getBoundingClientRect().height}px`);
    };
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    updateHeight();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  const loadData = useCallback(async () => {
    try {
      const [nextArticles, nextAnnotations, nextSources, ignored] = await Promise.all([
        db.articles.toArray(),
        db.annotations.toArray(),
        db.sources.toArray(),
        db.ignoredRecommendations.toArray()
      ]);
      setArticles(nextArticles);
      setSelectedIds((current) => new Set([...current].filter((id) => nextArticles.some((article) => article.id === id))));
      setAnnotations(nextAnnotations);
      setSources(nextSources);
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

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
    let disposed = false;
    void chrome.storage.local.get("groupOrders").then((stored) => {
      const value: unknown = stored.groupOrders;
      if (value !== undefined) {
        if (!value || typeof value !== "object") throw new Error("Saved group order is invalid.");
        const next: GroupOrders = { date: [], domain: [], status: [], tag: [] };
        for (const key of Object.keys(next) as Grouping[]) {
          const order: unknown = Reflect.get(value, key);
          if (order !== undefined) {
            if (!Array.isArray(order) || !order.every((item: unknown) => typeof item === "string")) {
              throw new Error("Saved group order is invalid.");
            }
            next[key] = order;
          }
        }
        if (!disposed) setGroupOrders(next);
      }
      if (!disposed) setOrderLoaded(true);
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Group order could not be loaded.");
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
    let disposed = false;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!disposed && current === revision) setActiveUrl(tab?.url ?? "");
      }).catch((reason: unknown) => {
        if (!disposed && current === revision) {
          setActiveUrl("");
          setError(reason instanceof Error ? reason.message : "The current page could not be identified.");
        }
      });
    };
    const updated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (_id, change, tab) => {
      if (tab.active && (change.url !== undefined || change.status === "complete")) refresh();
    };
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(refresh);
    refresh();
    return () => {
      disposed = true;
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(refresh);
    };
  }, []);

  useEffect(() => {
    setCollapsedGroups(new Set());
  }, [grouping]);

  const domains = useMemo(
    () => [...new Set(articles.map((article) => article.domain))].sort(),
    [articles]
  );
  const tags = useMemo(
    () =>
      normalizeTags(articles.flatMap((article) => article.tags ?? [])).sort((left, right) =>
        left.localeCompare(right)
      ),
    [articles]
  );

  useEffect(() => {
    setTagFilter((current) =>
      current === "" || tags.includes(current) ? current : ""
    );
    if (tags.length === 0) {
      setGrouping((current) => current === "tag" ? "status" : current);
    }
  }, [tags]);

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
        (article) => tagFilter === "" || (article.tags ?? []).some((tag) => tag.toLocaleLowerCase() === tagFilter.toLocaleLowerCase())
      )
      .filter(
        (article) =>
          !query ||
          article.title.toLowerCase().includes(query) ||
          article.domain.toLowerCase().includes(query) ||
          (article.tags ?? []).some((tag) => tag.toLowerCase().includes(query)) ||
          notesByArticle.get(article.id)?.includes(query)
      )
      .sort((left, right) => compareArticles(left, right, sort));
  }, [
    articles,
    domainFilter,
    notesByArticle,
    orphanedOnly,
    search,
    sort,
    statusFilter,
    tagFilter
  ]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Article[]>();
    for (const article of filtered) {
      const groupKeys =
        grouping === "status"
          ? [statusLabel(article.status)]
          : grouping === "domain"
            ? [article.domain]
            : grouping === "tag"
              ? (article.tags && article.tags.length > 0
                ? normalizeTags(article.tags).map((tag) => tags.find((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase()) ?? tag)
                : [""])
              : [dateGroup(article.originalSavedAt)];

      for (const key of groupKeys) {
        groups.set(key, [...(groups.get(key) ?? []), article]);
      }
    }
    return reconcileGroupOrder(groupOrders[grouping], [...groups.keys()])
      .filter((key) => groups.has(key))
      .map((key): [string, Article[]] => [key, groups.get(key)!]);
  }, [filtered, grouping, tags, groupOrders]);

  async function reorderGroup(group: string, direction: -1 | 1) {
    setOrderBusy(true);
    try {
      const next = {
        ...groupOrders,
        [grouping]: moveGroup(groupOrders[grouping], grouped.map(([key]) => key), group, direction)
      };
      await chrome.storage.local.set({ groupOrders: next });
      setGroupOrders(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Group order could not be saved.");
    } finally {
      setOrderBusy(false);
    }
  }

  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => filtered.some((article) => article.id === id))));
  }, [filtered]);

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

  async function saveTags(tags: string[]) {
    if (!tagEditor) throw new Error("No articles selected for tag editing.");
    clearFeedback();
    await db.transaction("rw", db.articles, async () => {
      for (const id of tagEditor.ids) {
        const article = await db.articles.get(id);
        if (!article) throw new Error("An article no longer exists. Reload the library and try again.");
        await db.articles.update(id, {
          tags: tagEditor.additive ? mergeTags(article.tags, tags) : normalizeTags(tags),
          updatedAt: Date.now()
        });
      }
    });
    setTagEditor(undefined);
    await loadData();
    setMessage("Tags updated.");
  }

  async function bulkAction(action: "remove" | ReadingStatus) {
    const selected = filtered.filter((article) => selectedIds.has(article.id));
    if (selected.length === 0) return;
    let deleteBookmark = false;
    if (action === "remove") {
      if (!window.confirm(`Remove ${selected.length} articles from Ready? Their progress, highlights, and notes will be deleted.`)) return;
      if (selected.some((article) => article.bookmarkState === "linked")) {
        deleteBookmark = window.confirm("Also delete the linked Edge Favorites?");
      }
    }
    clearFeedback();
    setBulkBusy(true);
    let completed = 0;
    try {
      for (const article of selected) {
        const response = await sendReadyMessage(action === "remove"
          ? { type: "REMOVE_ARTICLE", articleId: article.id, deleteBookmark }
          : { type: "SET_STATUS", articleId: article.id, status: action });
        if (!response.ok) throw new Error(response.error);
        completed++;
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(article.id);
          return next;
        });
      }
      await loadData();
      setMessage(`${completed} articles ${action === "remove" ? "removed" : "updated"}.`);
    } catch (reason) {
      await loadData();
      setError(`${completed} of ${selected.length} articles ${action === "remove" ? "removed" : "updated"}. ${reason instanceof Error ? reason.message : "The bulk action failed."}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function saveSourceFromArticle(source: Source) {
    clearFeedback();
    const duplicate = await db.sources
      .where("normalizedUrl")
      .equals(source.normalizedUrl)
      .first();
    if (duplicate) {
      throw new Error("This source is already saved.");
    }
    await db.sources.add(source);
    setSourceArticle(undefined);
    setMessage("Source added.");
    await loadData();
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

  function toggleGroup(group: string) {
    const key = `${grouping}:${group}`;
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function completeLink(linked: number) {
    setMessage(
      linked === 0
        ? "All selected Favorites were already linked."
        : `Linked ${linked} ${linked === 1 ? "Favorite" : "Favorites"} to Ready.`
    );
    await loadData();
  }

  return (
    <div className="app-shell">
      <div className="app-header" ref={headerRef}>
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/icons/ready-48.png" alt="" />
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
        {(["library", "tags", "sources", "discover", "backup"] as View[]).map((item) => (
          <button
            key={item}
            className={view === item ? "tab active" : "tab"}
            aria-current={view === item ? "page" : undefined}
            onClick={() => setView(item)}
          >
            {item === "library"
              ? "Library"
              : item === "tags"
                ? "Tags"
              : item === "sources"
                ? "Sources"
                : item === "discover"
                  ? "Discover"
                  : "Settings"}
            {item === "library" && <span className="count">{articles.length}</span>}
            {item === "sources" && <span className="count">{sources.length}</span>}
          </button>
        ))}
      </nav>
      </div>

      {error && (
        <div className="feedback error" role="alert">
          <span>{error}</span>
          <button type="button" className="feedback-dismiss" aria-label="Dismiss error" onClick={() => setError("")}>×</button>
        </div>
      )}
      {message && (
        <div className="feedback success" role="status">
          <span>{message}</span>
          <button type="button" className="feedback-dismiss" aria-label="Dismiss notification" onClick={() => setMessage("")}>×</button>
        </div>
      )}

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
            <button className="button secondary compact" onClick={() => setPicker("link")}>
              Link
            </button>
          </div>

          <div
            className={`filters${tags.length > 0 ? " has-tags" : ""}`}
            role="group"
            aria-label="Filter articles"
          >
            <label className="select-field">
              <span className="sr-only">Filter by reading status</span>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as ReadingStatus | "all")}
                aria-label="Reading status"
              >
                <option value="all">All statuses</option>
                <option value="unread">Unread</option>
                <option value="in_progress">In progress</option>
                <option value="read">Read</option>
              </select>
            </label>
            <label className="select-field">
              <span className="sr-only">Filter by website</span>
              <select
                value={domainFilter}
                onChange={(event) => setDomainFilter(event.target.value)}
                aria-label="Website"
              >
                <option value="all">All websites</option>
                {domains.map((domain) => <option key={domain}>{domain}</option>)}
              </select>
            </label>
            {tags.length > 0 && (
              <label className="select-field">
                <span className="sr-only">Filter by tag</span>
                <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} aria-label="Tag">
                  <option value="">All tags</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="check-filter">
              <input type="checkbox" checked={orphanedOnly} onChange={(event) => setOrphanedOnly(event.target.checked)} />
              <span>Orphaned</span>
            </label>
          </div>

          <div className="organize-row" aria-label="Organize articles">
            <div className="organize-control">
              <span>Group</span>
              <label className="select-field compact-select-field">
                <select
                  value={grouping}
                  onChange={(event) => setGrouping(event.target.value as Grouping)}
                  aria-label="Group by"
                >
                  <option value="status">Status</option>
                  <option value="date">Date added</option>
                  <option value="domain">Website</option>
                  {tags.length > 0 && <option value="tag">Tag</option>}
                </select>
              </label>
            </div>
            <div className="organize-control">
              <span>Sort</span>
              <label className="select-field compact-select-field">
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as ArticleSort)}
                  aria-label="Sort by"
                >
                  <option value="activity">Last activity</option>
                  <option value="added">Date added</option>
                </select>
              </label>
            </div>
          </div>

          <div className="library-tools">
            <label className="selection-toggle">
              <input
                type="checkbox"
                aria-label="Select all visible articles"
                checked={filtered.length > 0 && filtered.every((article) => selectedIds.has(article.id))}
                disabled={bulkBusy || filtered.length === 0}
                onChange={(event) => setSelectedIds(event.target.checked ? new Set(filtered.map((article) => article.id)) : new Set())}
              />
              Select all
            </label>
            <div className="layout-toggle" role="group" aria-label="Group layout">
              <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")}>List</button>
              <button type="button" aria-pressed={layout === "kanban"} onClick={() => setLayout("kanban")}>Kanban</button>
            </div>
          </div>
          {selectedIds.size > 0 && (
            <div className="bulk-toolbar" role="group" aria-label="Bulk actions" aria-busy={bulkBusy}>
              <strong>{selectedIds.size} selected</strong>
              <button className="text-button" disabled={bulkBusy} onClick={() => setSelectedIds(new Set())}>Clear selection</button>
              <button className="button secondary compact" disabled={bulkBusy} onClick={() => setTagEditor({ ids: [...selectedIds], initial: [], additive: true })}>Add tags</button>
              <label className="select-field">
                <select aria-label="Set selected status" value="" disabled={bulkBusy} onChange={(event) => { if (event.target.value) void bulkAction(event.target.value as ReadingStatus); }}>
                  <option value="" disabled>Change status</option>
                  <option value="unread">Unread</option>
                  <option value="in_progress">In progress</option>
                  <option value="read">Read</option>
                </select>
              </label>
              <button className="button secondary compact danger-text" disabled={bulkBusy} onClick={() => void bulkAction("remove")}>Remove selected</button>
            </div>
          )}

          {loading ? (
            <EmptyState title="Opening your library…" detail="Ready is loading local reading data." />
          ) : grouped.length === 0 ? (
            <EmptyState
              title={articles.length === 0 ? "Your library is ready" : "No articles match"}
              detail={articles.length === 0 ? "Save this page or link existing Edge Favorites to begin." : "Try changing the filters or search."}
            />
          ) : (
            <div className={`article-groups ${layout}`} tabIndex={layout === "kanban" ? 0 : undefined} role="region" aria-label="Article groups">
            {grouped.map(([group, items], groupIndex) => {
              const collapsed = collapsedGroups.has(`${grouping}:${group}`);
              return (
              <section className="article-group" key={group}>
                <div className="group-header">
                <button
                  className="group-heading"
                  type="button"
                  aria-expanded={!collapsed}
                  onClick={() => toggleGroup(group)}
                >
                  <svg className="group-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d={collapsed ? "m6 3 5 5-5 5" : "m3 6 5 5 5-5"} /></svg>
                  <h2>{group || "Unlabeled"}</h2>
                  <span>{items.length}</span>
                </button>
                <div className="group-order" role="group" aria-label={`Order ${group || "Unlabeled"}`}>
                  {([-1, 1] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      aria-label={`Move ${group || "Unlabeled"} ${direction === -1 ? "earlier" : "later"}`}
                      title={`Move ${direction === -1 ? "earlier" : "later"}`}
                      disabled={!orderLoaded || orderBusy || (direction === -1 ? groupIndex === 0 : groupIndex === grouped.length - 1)}
                      onClick={() => void reorderGroup(group, direction)}
                    >
                      <svg aria-hidden="true" viewBox="0 0 16 16" className={layout === "kanban" ? "horizontal-arrow" : undefined}>
                        <path d={direction === -1 ? "m4 9 4-4 4 4" : "m4 7 4 4 4-4"} />
                      </svg>
                    </button>
                  ))}
                </div>
                </div>
                {!collapsed && <div className="article-list">
                  {items.map((article) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      currentPage={!!activeUrl && [article.originalUrl, article.normalizedUrl, article.canonicalUrl].some((url) => !!url && urlsMatch(url, activeUrl))}
                      annotations={annotations.filter((item) => item.articleId === article.id)}
                      selected={selectedIds.has(article.id)}
                      selectionDisabled={bulkBusy}
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
                      onEditTags={(article) => setTagEditor({ ids: [article.id], initial: article.tags ?? [], additive: false })}
                      sourceSaved={sources.some((source) => source.domain === article.domain)}
                      onSource={() => {
                        if (sources.some((source) => source.domain === article.domain)) {
                          setView("sources");
                        } else {
                          setSourceArticle(article);
                        }
                      }}
                      onEditAnnotation={editAnnotation}
                      onDeleteAnnotation={deleteAnnotation}
                    />
                  ))}
                </div>}
              </section>
              );
            })}
            </div>
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

      {view === "tags" && (
        <main className="panel-page">
          <div className="section-heading">
            <p className="eyebrow">Your library</p>
            <h2>Tags</h2>
            <p className="muted">Browse all tags. Add or create tags from an article or a selection.</p>
          </div>
          <label className="search-box">
            <span className="sr-only">Search tags</span>
            <input type="search" placeholder="Search tags" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} />
          </label>
          {tags.length === 0 ? <EmptyState title="No tags yet" detail="Use Add tags on an article to create your first tag." /> : (
            <div className="tag-directory">
              {tags.filter((tag) => tag.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase())).map((tag) => (
                <button className="tag-directory-item" key={tag} onClick={() => {
                  setSearch("");
                  setStatusFilter("all");
                  setDomainFilter("all");
                  setOrphanedOnly(false);
                  setTagFilter(tag);
                  setView("library");
                }}>
                  <span>{tag}</span>
                  <span className="count">{articles.filter((article) => article.tags?.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())).length} articles</span>
                </button>
              ))}
              {!tags.some((tag) => tag.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase())) && <EmptyState title="No tags match" detail="Try a different search." />}
            </div>
          )}
        </main>
      )}

      {view === "sources" && (
        <SourcesPanel
          sources={sources}
          articles={articles}
          onChanged={loadData}
          onViewArticles={(domain) => {
            setSearch("");
            setStatusFilter("all");
            setOrphanedOnly(false);
            setDomainFilter(domain);
            setTagFilter("");
            setView("library");
          }}
        />
      )}

      {view === "backup" && (
        <>
          <div className="settings-preferences"><BookmarkSettings /></div>
          <BackupPanel
            articles={articles}
            sources={sources}
            selectedIds={selectedIds}
            onChanged={loadData}
          />
          <div className="settings-preferences">
            <section className="settings-card" aria-label="About Ready">
              <h3>Ready {chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version}</h3>
              <p className="muted">A local-first reading library. No account, analytics, or Ready server.</p>
              <p className="muted">Beta software: export a backup before updating or uninstalling.</p>
              <div className="button-row">
                <a href="https://marianoviola.com/privacy/#ready" target="_blank" rel="noopener noreferrer">Privacy</a>
                <a href="https://marianoviola.com/contact/" target="_blank" rel="noopener noreferrer">Contact &amp; support</a>
              </div>
            </section>
          </div>
        </>
      )}

      {picker && (
        <BookmarkPicker
          mode={picker === "link" ? "link" : "folder"}
          onClose={() => {
            setPicker(undefined);
            setRestoreArticleId(undefined);
          }}
          onLinked={completeLink}
          onFolderSelected={restore}
        />
      )}

      {sourceArticle && (
        <SourceEditor
          source={null}
          initial={{
            name: sourceArticle.domain,
            url: new URL(sourceArticle.originalUrl).origin
          }}
          onClose={() => setSourceArticle(undefined)}
          onSave={saveSourceFromArticle}
        />
      )}
      {tagEditor && (
        <TagEditor initial={tagEditor.initial} available={tags} additive={tagEditor.additive} onClose={() => setTagEditor(undefined)} onSave={saveTags} />
      )}
    </div>
  );
}

interface ArticleCardProps {
  article: Article;
  currentPage: boolean;
  annotations: Annotation[];
  selected: boolean;
  selectionDisabled: boolean;
  onSelected: (selected: boolean) => void;
  onOpen: (article: Article, resume: boolean) => Promise<void>;
  onStatus: (id: string, status: ReadingStatus) => Promise<void>;
  onRestore: () => void;
  onRemove: (article: Article) => Promise<void>;
  onEditTags: (article: Article) => void;
  sourceSaved: boolean;
  onSource: () => void;
  onEditAnnotation: (annotation: Annotation) => Promise<void>;
  onDeleteAnnotation: (annotation: Annotation) => Promise<void>;
}

function ArticleCard(props: ArticleCardProps) {
  const { article, annotations } = props;
  return (
    <article className={`article-card${props.currentPage ? " current-page" : ""}`}>
      <div className="article-select">
        <input type="checkbox" checked={props.selected} disabled={props.selectionDisabled} onChange={(event) => props.onSelected(event.target.checked)} aria-label={`Select ${article.title}`} />
      </div>
      <div className="article-body">
        <div className="article-topline">
          <span className={`status-dot status-${article.status}`} aria-hidden="true" />
          <span>{article.domain}</span>
          <span>·</span>
          <time dateTime={new Date(article.originalSavedAt).toISOString()}>{relativeDate(article.originalSavedAt)}</time>
          {article.bookmarkState === "orphaned" && <span className="orphan-badge">Favorite removed</span>}
          {props.currentPage && <span className="current-page-badge" aria-current="page">Current page</span>}
        </div>
        <button className="article-title" onClick={() => void props.onOpen(article, false)}>{article.title}</button>
        {(article.tags?.length ?? 0) > 0 && (
          <div className="article-tags" aria-label="Tags">
            {article.tags?.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
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
          <button className="text-button" onClick={() => void props.onEditTags(article)}>
            {article.tags?.length ? "Edit tags" : "Add tags"}
          </button>
          <button className="text-button" onClick={props.onSource}>
            {props.sourceSaved ? "View source" : "Add source"}
          </button>
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
  return (
    <div className="empty-state">
      <span className="library-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="10.8" cy="10.8" r="6.3" />
          <path d="m15.4 15.4 4.1 4.1" />
        </svg>
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  );
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

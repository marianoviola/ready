import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { liveQuery } from "dexie";
import type { BookmarkMetadata } from "../browser/bookmarks";
import { sendReadyMessage } from "../browser/messages";
import { db } from "../db/database";
import {
  compareArticles,
  type ArticleSort
} from "../domain/article-sort";
import { rankRecommendations } from "../domain/discovery";
import { sourceFromInput } from "../domain/source";
import { sourceDomain } from "../domain/source-discovery";
import { moveGroup, reconcileGroupOrder } from "../domain/group-order";
import { mergeTags, normalizeTags } from "../domain/tags";
import { getDomain, isScriptableUrl, urlsMatch } from "../domain/url";
import { matchesWebsite, reconcileWebsiteFilter, websiteFamilies } from "../domain/website-filter";
import type {
  Annotation,
  Article,
  ReadingSession,
  ReadingHistoryEntry,
  ReadingStatus,
  Recommendation,
  Source
} from "../domain/types";
import { BackupPanel } from "./BackupPanel";
import { BookmarkPicker } from "./BookmarkPicker";
import { BookmarkSettings } from "./BookmarkSettings";
import { SourceEditor, SourcesPanel } from "./SourcesPanel";
import { TagEditor } from "./TagEditor";
import { ReadingStats } from "./ReadingStats";
import { TagDirectory } from "./TagDirectory";
import { SourceDiscover } from "./SourceDiscover";
import { BookmarkDetails } from "./BookmarkDetails";
import { RemoveArticlesDialog } from "./RemoveArticlesDialog";
import { ReadingRetentionSettings } from "./ReadingRetentionSettings";
import { CardActionsMenu } from "./CardActionsMenu";
import { FeedbackMessages, FeedbackProvider, useFeedback } from "./Feedback";

type View = "library" | "tags" | "sources" | "discover" | "backup" | "stats";
type Workspace = "library" | "sources";
type Grouping = "date" | "domain" | "status" | "tag";
type GroupOrders = Record<Grouping, string[]>;

function readLibrarySnapshot() {
  return Promise.all([
    db.articles.toArray(), db.annotations.toArray(), db.sources.toArray(),
    db.ignoredRecommendations.toArray(), db.sessions.toArray(), db.readingHistory.toArray()
  ]);
}

export function App() {
  return <FeedbackProvider><ReadyApp /></FeedbackProvider>;
}

function ReadyApp() {
  const headerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("library");
  const [workspace, setWorkspace] = useState<Workspace>("library");
  const [articles, setArticles] = useState<Article[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [history, setHistory] = useState<ReadingHistoryEntry[]>([]);
  const [bookmarkMetadata, setBookmarkMetadata] = useState<BookmarkMetadata[]>([]);
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
  const [picker, setPicker] = useState<"link" | "restore" | "move">();
  const [restoreArticleId, setRestoreArticleId] = useState<string>();
  const [sourceArticle, setSourceArticle] = useState<Article>();
  const [tagEditor, setTagEditor] = useState<{ ids: string[]; initial: string[]; additive: boolean }>();
  const [bulkBusy, setBulkBusy] = useState(false);
  const [removeTargets, setRemoveTargets] = useState<Article[]>([]);
  const [removalError, setRemovalError] = useState("");
  const [readArticle, setReadArticle] = useState<Article>();
  const [sourceTagFilter, setSourceTagFilter] = useState("");
  const { setMessage, setError } = useFeedback();
  const savePendingRef = useRef(false);
  const [saving, setSaving] = useState<Workspace>();
  const [loading, setLoading] = useState(true);
  const savingSource = workspace === "sources";
  const currentPageSaved = isScriptableUrl(activeUrl) && (savingSource
    ? sources.some((source) => sourceDomain(source) === getDomain(activeUrl))
    : articles.some((article) => urlsMatch(article.originalUrl, activeUrl)));
  const saveLabel = saving
    ? saving === "sources" ? "Saving source…" : "Saving page…"
    : currentPageSaved
      ? savingSource ? "Source saved" : "Page saved"
      : savingSource ? "Save source" : "Save page";

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

  const applySnapshot = useCallback((
    [nextArticles, nextAnnotations, nextSources, ignored, nextSessions, nextHistory]:
      Awaited<ReturnType<typeof readLibrarySnapshot>>
  ) => {
      setArticles(nextArticles);
      setSelectedIds((current) => new Set([...current].filter((id) => nextArticles.some((article) => article.id === id))));
      setAnnotations(nextAnnotations);
      setSources(nextSources);
      setSessions(nextSessions);
      setHistory(nextHistory);
      setRecommendations(
        rankRecommendations(nextArticles, nextAnnotations, ignored)
      );
      setLoading(false);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const response = await sendReadyMessage({ type: "GET_BOOKMARK_METADATA" });
      if (!response.ok) throw new Error(response.error);
      if (!("bookmarks" in response)) throw new Error("Favorite details could not be loaded.");
      setBookmarkMetadata(response.bookmarks);
      applySnapshot(await readLibrarySnapshot());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ready could not load your library.");
    } finally {
      setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void loadData();
    const subscription = liveQuery(readLibrarySnapshot).subscribe({
      next: applySnapshot,
      error: (reason: unknown) => setError(reason instanceof Error ? reason.message : "Ready could not refresh your library.")
    });
    const refresh = () => { void loadData(); };
    chrome.bookmarks.onCreated.addListener(refresh);
    chrome.bookmarks.onChanged.addListener(refresh);
    chrome.bookmarks.onMoved.addListener(refresh);
    chrome.bookmarks.onRemoved.addListener(refresh);
    return () => {
      subscription.unsubscribe();
      chrome.bookmarks.onCreated.removeListener(refresh);
      chrome.bookmarks.onChanged.removeListener(refresh);
      chrome.bookmarks.onMoved.removeListener(refresh);
      chrome.bookmarks.onRemoved.removeListener(refresh);
    };
  }, [applySnapshot, loadData]);

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
  const domainFamilies = useMemo(() => websiteFamilies(domains), [domains]);
  const tags = useMemo(
    () =>
      normalizeTags(articles.flatMap((article) => article.tags ?? [])).sort((left, right) =>
        left.localeCompare(right)
      ),
    [articles]
  );
  const allTags = useMemo(() => normalizeTags([
    ...tags, ...sources.flatMap((source) => source.tags ?? [])
  ]).sort((left, right) => left.localeCompare(right)), [tags, sources]);

  useEffect(() => {
    setDomainFilter((current) => reconcileWebsiteFilter(domains, current));
  }, [domains]);

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
      .filter((article) => view !== "discover" || workspace !== "library" || recommendations.some((item) => item.articleId === article.id))
      .filter((article) => statusFilter === "all" || article.status === statusFilter)
      .filter((article) => !orphanedOnly || article.bookmarkState === "orphaned")
      .filter((article) => matchesWebsite(article.domain, domainFilter))
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
    tagFilter,
    view,
    workspace,
    recommendations
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
    if (savePendingRef.current) return;
    savePendingRef.current = true;
    const target = savingSource ? "sources" : "library";
    setSaving(target);
    clearFeedback();
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url || !isScriptableUrl(tab.url)) {
        throw new Error("Ready can save standard http and https pages.");
      }
      if (target === "sources") {
        const domain = getDomain(tab.url);
        const saved = await db.sources.toArray();
        if (saved.some((source) => sourceDomain(source) === domain)) {
          setMessage("This source is already saved.");
        } else {
          await db.sources.add(sourceFromInput({
            name: domain, url: new URL(tab.url).origin, subscribed: false
          }));
          setMessage("Source added.");
        }
        await loadData();
        return;
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
      setError(reason instanceof Error ? reason.message : `The ${target === "sources" ? "source" : "page"} could not be saved.`);
    } finally {
      savePendingRef.current = false;
      setSaving(undefined);
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
    clearFeedback();
    try {
      const response = await sendReadyMessage({ type: "SET_STATUS", articleId, status });
      if (!response.ok) throw new Error(response.error);
      await loadData();
      if (status === "read") setReadArticle(articles.find((article) => article.id === articleId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reading status could not be updated.");
    }
  }

  async function removeArticle(article: Article) {
    setRemovalError("");
    setRemoveTargets([article]);
  }

  async function confirmRemoval(deleteBookmarks: boolean) {
    clearFeedback();
    setRemovalError("");
    setBulkBusy(true);
    let completed = 0;
    try {
      for (const article of removeTargets) {
        const response = await sendReadyMessage({
          type: "REMOVE_ARTICLE",
          articleId: article.id,
          deleteBookmark: deleteBookmarks
        });
        if (!response.ok) throw new Error(response.error);
        completed++;
        setRemoveTargets((current) => current.filter((item) => item.id !== article.id));
      }
      await loadData();
      setMessage(`${completed} article${completed === 1 ? "" : "s"} removed from Ready. Reading history preserved.`);
      setReadArticle(undefined);
    } catch (reason) {
      await loadData();
      setRemovalError(`${completed} of ${removeTargets.length} articles removed. ${reason instanceof Error ? reason.message : "Removal failed."}`);
    } finally {
      setBulkBusy(false);
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
    if (action === "remove") {
      setRemovalError("");
      setRemoveTargets(selected);
      return;
    }
    clearFeedback();
    setBulkBusy(true);
    let completed = 0;
    try {
      for (const article of selected) {
        const response = await sendReadyMessage({ type: "SET_STATUS", articleId: article.id, status: action });
        if (!response.ok) throw new Error(response.error);
        completed++;
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(article.id);
          return next;
        });
      }
      await loadData();
      setMessage(`${completed} articles updated.`);
    } catch (reason) {
      await loadData();
      setError(`${completed} of ${selected.length} articles updated. ${reason instanceof Error ? reason.message : "The bulk action failed."}`);
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
        <button className="button primary compact save-current-page"
          disabled={loading || Boolean(saving) || currentPageSaved || !isScriptableUrl(activeUrl)}
          data-saved={currentPageSaved}
          aria-busy={Boolean(saving)}
          onClick={() => void saveCurrentPage()}>
          <svg className="save-icon" data-state={saving ? "saving" : currentPageSaved ? "saved" : "idle"}
            aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {saving ? (
              <><path d="M7 3h10M7 21h10M8 3v4l8 10v4M16 3v4L8 17v4" /></>
            ) : currentPageSaved ? (
              <><path d="M19 11v10l-7-4-7 4V5a2 2 0 0 1 2-2h6" /><path d="m14 6 3 3 5-6" /></>
            ) : (
              <><path d="M19 11v10l-7-4-7 4V5a2 2 0 0 1 2-2h6" /><path d="M18 2v6m-3-3h6" /></>
            )}
          </svg> {saveLabel}
        </button>
      </header>

      <nav className="tabs" aria-label="Ready sections">
        {(["library", "sources", "backup"] as const).map((item) => (
          <button
            key={item}
            className={(item === "backup" ? view === "backup" : view !== "backup" && workspace === item) ? "tab active" : "tab"}
            aria-current={(item === "backup" ? view === "backup" : view !== "backup" && workspace === item) ? "page" : undefined}
            onClick={() => {
              if (item !== "backup") setWorkspace(item);
              if (item === "sources") setSourceTagFilter("");
              setView(item);
            }}
          >
            {item === "library"
              ? "Library"
              : item === "sources"
                ? "Sources"
                  : "Settings"}
            {item === "library" && <span className="count">{articles.length}</span>}
            {item === "sources" && <span className="count">{sources.length}</span>}
          </button>
        ))}
      </nav>
      {view !== "backup" && (
        <nav className="tabs subnav" aria-label={`${workspace === "library" ? "Library" : "Sources"} views`}>
          {([workspace, "tags", "discover", ...(workspace === "library" ? ["stats" as const] : [])] as View[]).map((item) => (
            <button key={item} type="button" className={view === item ? "tab active" : "tab"} aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>
              {item === "library" ? "Articles" : item === "sources" ? "All sources" : item === "tags" ? "Tags" : item === "stats" ? "Statistics" : "Discover"}
            </button>
          ))}
        </nav>
      )}
      <div className="header-feedback">
        <FeedbackMessages />
        {readArticle && articles.some((article) => article.id === readArticle.id) && (
          <div className="feedback read-complete" role="status">
            <span>Finished reading "{readArticle.title}"? You can remove it from Ready and keep its reading history and Edge Favorite.</span>
            <div className="button-row">
              <button type="button" className="button secondary compact" onClick={() => void removeArticle(readArticle)}>Remove from list</button>
              <button type="button" className="button ghost compact" onClick={() => setReadArticle(undefined)}>Keep in list</button>
            </div>
          </div>
        )}
      </div>
      </div>

      {(view === "library" || (view === "discover" && workspace === "library")) && (
        <main className="library" aria-label={view === "discover" ? "Discover articles" : "Articles"}>
          {view === "discover" && (
            <div className="section-heading">
              <p className="eyebrow">From your library</p>
              <h2>Rediscover something worth reading</h2>
              <p className="muted">Private recommendations calculated on this device. Use the same filters and organization as your library.</p>
            </div>
          )}
          <div className="search-row">
            <label className="search-box">
              <svg className="search-icon" aria-hidden="true" viewBox="0 0 24 24">
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 5 5" />
              </svg>
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
                {domainFamilies.map((family) => family.members.length > 1 || family.value === domainFilter ? (
                  <optgroup key={family.domain} label={family.domain}>
                    <option value={family.value}>All {family.domain} sites</option>
                    {family.members.map((domain) => <option key={domain} value={domain}>{domain}</option>)}
                  </optgroup>
                ) : <option key={family.domain} value={family.members[0]}>{family.members[0]}</option>)}
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
                      bookmarkMetadata={bookmarkMetadata.find((item) => item.articleId === article.id)}
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
                      onMove={() => {
                        setRestoreArticleId(article.id);
                        setPicker("move");
                      }}
                      onRemove={removeArticle}
                      onEditTags={(article) => setTagEditor({ ids: [article.id], initial: article.tags ?? [], additive: false })}
                      sourceSaved={sources.some((source) => source.domain === article.domain)}
                      onSource={() => {
                        if (sources.some((source) => source.domain === article.domain)) {
                          setSourceTagFilter("");
                          setWorkspace("sources");
                          setView("sources");
                        } else {
                          setSourceArticle(article);
                        }
                      }}
                      onEditAnnotation={editAnnotation}
                      onDeleteAnnotation={deleteAnnotation}
                      recommendation={view === "discover" ? recommendations.find((item) => item.articleId === article.id) : undefined}
                      onIgnoreRecommendation={ignoreRecommendation}
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

      {view === "tags" && (
        <TagDirectory
          key={workspace}
          scope={workspace}
          articles={articles}
          sources={sources}
          onSelectTag={(tag) => {
            if (workspace === "library") {
              setSearch("");
              setStatusFilter("all");
              setDomainFilter("all");
              setOrphanedOnly(false);
              setTagFilter(tags.find((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase()) ?? "");
              setView("library");
            } else {
              setSourceTagFilter(tag);
              setView("sources");
            }
          }}
        />
      )}
      {view === "stats" && <ReadingStats articles={articles} sessions={sessions} history={history} />}
      {view === "discover" && workspace === "sources" && (
        <SourceDiscover articles={articles} sources={sources} availableTags={allTags} onChanged={loadData} onViewArticles={(domain) => {
          setWorkspace("library");
          setView("library");
          setSearch("");
          setStatusFilter("all");
          setOrphanedOnly(false);
          setDomainFilter(domain);
          setTagFilter("");
        }} />
      )}

      {view === "sources" && (
        <SourcesPanel
          key={sourceTagFilter}
          sources={sources}
          articles={articles}
          availableTags={allTags}
          initialTag={sourceTagFilter}
          onChanged={loadData}
          onViewArticles={(domain) => {
            setSearch("");
            setStatusFilter("all");
            setOrphanedOnly(false);
            setDomainFilter(domain);
            setTagFilter("");
            setWorkspace("library");
            setView("library");
          }}
        />
      )}

      {view === "backup" && (
        <>
          <div className="settings-preferences">
            <BookmarkSettings />
            <ReadingRetentionSettings onChanged={loadData} />
          </div>
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
              <p className="muted">Reading data stays in this browser profile. Export a backup before updating, switching installations, or uninstalling.</p>
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
          title={picker === "move" ? "Move Favorite" : picker === "restore" ? "Restore or relink Favorite" : undefined}
          confirmLabel={picker === "move" ? "Move here" : undefined}
          onClose={() => {
            setPicker(undefined);
            setRestoreArticleId(undefined);
          }}
          onLinked={completeLink}
          onFolderSelected={async (folderId) => {
            if (picker !== "move") return restore(folderId);
            if (!restoreArticleId || !folderId) throw new Error("Choose a destination folder.");
            const response = await sendReadyMessage({ type: "MOVE_BOOKMARK", articleId: restoreArticleId, folderId });
            if (!response.ok) throw new Error(response.error);
            await loadData();
            setMessage("Favorite moved. Reading data and tags are unchanged.");
          }}
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
          availableTags={allTags}
          suggestedTags={sourceArticle.tags}
        />
      )}
      {tagEditor && (
        <TagEditor initial={tagEditor.initial} available={allTags} additive={tagEditor.additive} onClose={() => setTagEditor(undefined)} onSave={saveTags} />
      )}
      {removeTargets.length > 0 && (
        <RemoveArticlesDialog
          selectedCount={removeTargets.length}
          bookmarkCount={removeTargets.filter((article) => article.bookmarkState === "linked" && article.bookmarkId).length}
          pending={bulkBusy}
          error={removalError}
          onCancel={() => { setRemoveTargets([]); setRemovalError(""); }}
          onConfirm={confirmRemoval}
        />
      )}
    </div>
  );
}

interface ArticleCardProps {
  article: Article;
  bookmarkMetadata?: BookmarkMetadata;
  currentPage: boolean;
  annotations: Annotation[];
  selected: boolean;
  selectionDisabled: boolean;
  onSelected: (selected: boolean) => void;
  onOpen: (article: Article, resume: boolean) => Promise<void>;
  onStatus: (id: string, status: ReadingStatus) => Promise<void>;
  onRestore: () => void;
  onMove: () => void;
  onRemove: (article: Article) => Promise<void>;
  onEditTags: (article: Article) => void;
  sourceSaved: boolean;
  onSource: () => void;
  onEditAnnotation: (annotation: Annotation) => Promise<void>;
  onDeleteAnnotation: (annotation: Annotation) => Promise<void>;
  recommendation?: Recommendation;
  onIgnoreRecommendation: (recommendation: Recommendation) => Promise<void>;
}

function ArticleCard(props: ArticleCardProps) {
  const { article, annotations, recommendation } = props;
  const linked = props.bookmarkMetadata
    ? props.bookmarkMetadata.state === "linked"
    : article.bookmarkState === "linked" && Boolean(article.bookmarkId);
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
          {props.currentPage && <span className="current-page-badge" aria-current="page">Current page</span>}
        </div>
        <button className="article-title" onClick={() => void props.onOpen(article, false)}>{article.title}</button>
        <BookmarkDetails article={article} metadata={props.bookmarkMetadata} />
        {recommendation && (
          <div className="recommendation-detail">
            <span className={`category category-${recommendation.category}`}>{categoryLabel(recommendation.category)}</span>
            <p className="muted">{recommendation.reason}</p>
          </div>
        )}
        {(article.tags?.length ?? 0) > 0 && (
          <div className="article-tags" aria-label="Tags">
            {article.tags?.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
        {article.progress > 0 && (
          <div className="progress-row">
            <div className="progress-track" role="progressbar" aria-label={`Reading progress for ${article.title}`} aria-valuenow={Math.round(article.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.round(article.progress * 100)}%` }} />
            </div>
            <span>{Math.round(article.progress * 100)}%</span>
          </div>
        )}
        <div className="card-actions">
          <button className="button secondary compact" onClick={() => void props.onOpen(article, Boolean(article.position))}>
            {article.position ? "Resume" : "Open"}
          </button>
          <select value={article.status} onChange={(event) => void props.onStatus(article.id, event.target.value as ReadingStatus)} aria-label={`Status for ${article.title}`}>
            <option value="unread">Unread</option>
            <option value="in_progress">In progress</option>
            <option value="read">Read</option>
          </select>
          <CardActionsMenu label={`Actions for article ${article.title}`} actions={[
            { label: article.tags?.length ? "Edit tags" : "Add tags", onSelect: () => props.onEditTags(article) },
            { label: props.sourceSaved ? "View source" : "Add source", onSelect: props.onSource },
            { label: linked ? "Move Favorite" : "Restore or relink Favorite", onSelect: linked ? props.onMove : props.onRestore },
            ...(recommendation ? [{ label: "Not now", onSelect: () => void props.onIgnoreRecommendation(recommendation) }] : []),
            { label: "Remove", danger: true, onSelect: () => void props.onRemove(article) }
          ]} />
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
  if (date.getFullYear() === now.getFullYear()) return date.toLocaleDateString("en-US", { month: "long" });
  return String(date.getFullYear());
}

function relativeDate(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: days > 365 ? "numeric" : undefined });
}

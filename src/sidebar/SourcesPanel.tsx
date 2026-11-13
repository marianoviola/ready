import { useEffect, useMemo, useState } from "react";
import { db } from "../db/database";
import { groupSources, selectSources, sourceFromInput, type SourceGrouping, type SourceSort, type SubscriptionFilter } from "../domain/source";
import { discoverSources, sourceDomain, type SourceCandidate } from "../domain/source-discovery";
import { moveGroup, reconcileGroupOrder } from "../domain/group-order";
import { normalizeTags } from "../domain/tags";
import type { Article, Source } from "../domain/types";
import { TagPicker, tagsWithQuery } from "./TagPicker";
import { CardActionsMenu } from "./CardActionsMenu";

export interface SourcesPanelProps {
  sources: Source[];
  articles: Article[];
  onChanged: () => Promise<void>;
  onViewArticles: (domain: string) => void;
  availableTags: string[];
  initialTag: string;
  mode?: "saved" | "discover";
}

export function SourcesPanel({
  sources,
  articles,
  onChanged,
  onViewArticles,
  availableTags,
  initialTag,
  mode = "saved"
}: SourcesPanelProps) {
  const discovering = mode === "discover";
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Source | null>();
  const [addingCandidate, setAddingCandidate] = useState<SourceCandidate>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tagFilter, setTagFilter] = useState(initialTag);
  const [subscription, setSubscription] = useState<SubscriptionFilter>("all");
  const [sort, setSort] = useState<SourceSort>("default");
  const [grouping, setGrouping] = useState<SourceGrouping>("none");
  const [layout, setLayout] = useState<"list" | "kanban">("list");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [orders, setOrders] = useState<Record<SourceGrouping, string[]>>({ none: [], tag: [], subscription: [] });
  const [orderLoaded, setOrderLoaded] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const candidates = useMemo(() => discoverSources(articles, sources), [articles, sources]);
  const displayedSources = useMemo(() => discovering ? candidates.map((candidate): Source => ({
    id: candidate.domain, name: candidate.domain, url: candidate.url,
    normalizedUrl: candidate.url, domain: candidate.domain, subscribed: false,
    tags: candidate.suggestedTags, createdAt: candidate.createdAt, updatedAt: candidate.updatedAt
  })) : sources, [candidates, discovering, sources]);
  const tags = useMemo(() => normalizeTags(displayedSources.flatMap((source) => source.tags ?? []))
    .sort((left, right) => left.localeCompare(right)), [displayedSources]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  useEffect(() => {
    setTagFilter((current) => tags.find((tag) =>
      tag.toLocaleLowerCase() === current.toLocaleLowerCase()) ?? "");
  }, [tags]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
    let disposed = false;
    const storageKey = discovering ? "sourceDiscoverGroupOrders" : "sourceGroupOrders";
    void chrome.storage.local.get(storageKey).then((stored) => {
      const value: unknown = stored[storageKey];
      if (value !== undefined) {
        if (!value || typeof value !== "object") throw new Error("Saved source group order is invalid.");
        const next: Record<SourceGrouping, string[]> = { none: [], tag: [], subscription: [] };
        for (const key of Object.keys(next) as SourceGrouping[]) {
          const order: unknown = Reflect.get(value, key);
          if (order !== undefined) {
            if (!Array.isArray(order) || !order.every((item: unknown) => typeof item === "string")) {
              throw new Error("Saved source group order is invalid.");
            }
            next[key] = order;
          }
        }
        if (!disposed) setOrders(next);
      }
      if (!disposed) setOrderLoaded(true);
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Source group order could not be loaded.");
    });
    return () => { disposed = true; };
  }, [discovering]);

  const articleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (discovering) {
      for (const candidate of candidates) counts.set(candidate.domain, candidate.articleCount);
    } else {
      for (const article of articles) {
        counts.set(article.domain, (counts.get(article.domain) ?? 0) + 1);
      }
    }
    return counts;
  }, [articles, candidates, discovering]);

  const filtered = useMemo(() => selectSources(displayedSources, query, tagFilter,
    discovering ? "all" : subscription, sort, articleCounts),
    [displayedSources, query, tagFilter, subscription, sort, articleCounts, discovering]);
  const groups = useMemo(() => {
    const grouped = groupSources(filtered, grouping);
    return reconcileGroupOrder(orders[grouping], grouped.map((group) => group.key))
      .flatMap((key) => grouped.filter((group) => group.key === key));
  }, [filtered, grouping, orders]);

  async function reorderGroup(key: string, direction: -1 | 1) {
    setOrderBusy(true);
    setError("");
    try {
      const next = { ...orders, [grouping]: moveGroup(orders[grouping], groups.map((group) => group.key), key, direction) };
      await chrome.storage.local.set({ [discovering ? "sourceDiscoverGroupOrders" : "sourceGroupOrders"]: next });
      setOrders(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Source group order could not be saved.");
    } finally {
      setOrderBusy(false);
    }
  }

  async function saveSource(source: Source) {
    setError("");
    const duplicate = await db.sources
      .where("normalizedUrl")
      .equals(source.normalizedUrl)
      .first();
    if (duplicate && duplicate.id !== source.id) {
      throw new Error("This source is already saved.");
    }
    if (addingCandidate) {
      const saved = await db.sources.toArray();
      if (saved.some((item) => sourceDomain(item) === sourceDomain(source))) {
        throw new Error("A source for this domain is already saved.");
      }
    }
    await db.sources.put(source);
    setEditing(undefined);
    setAddingCandidate(undefined);
    setMessage(editing ? "Source updated." : "Source added.");
    await onChanged();
  }

  async function removeSource(source: Source) {
    if (!window.confirm(`Remove “${source.name}” from Sources?`)) return;
    setError("");
    try {
      await db.sources.delete(source.id);
      setMessage("Source removed.");
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The source could not be removed.");
    }
  }

  async function openSource(source: Source) {
    setError("");
    try {
      await chrome.tabs.create({ url: source.url });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The source could not be opened.");
    }
  }

  return (
    <main className="panel-page" aria-label={discovering ? "Discover sources" : "Sources"}>
      {discovering && <div className="section-heading">
        <p className="eyebrow">From your library</p>
        <h2>Discover sources</h2>
        <p className="muted">Websites from your saved articles, suggested on this device.</p>
      </div>}

      {error && <p className="feedback error" role="alert">{error}</p>}
      {message && <p className="feedback success" role="status">{message}</p>}

      <div className="search-row">
        <label className="search-box">
          <svg className="search-icon" aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
          <span className="sr-only">{discovering ? "Search suggested sources" : "Search sources"}</span>
          <input
            type="search"
            placeholder={discovering ? "Search suggested sources" : "Search sources"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {!discovering && <button className="button secondary compact" onClick={() => setEditing(null)}>
          Add source
        </button>}
      </div>

      {displayedSources.length > 0 && (<>
        <div className="source-filters" role="group" aria-label="Filter sources">
          <label className="select-field">
            <select aria-label="Source tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
              <option value="">All tags</option>
              {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </label>
          {!discovering && <label className="select-field">
            <select aria-label="Subscription" value={subscription} onChange={(event) => setSubscription(event.target.value as SubscriptionFilter)}>
              <option value="all">All subscriptions</option>
              <option value="subscribed">Subscribed</option>
              <option value="not-subscribed">Not subscribed</option>
            </select>
          </label>}
        </div>
        <div className="organize-row source-organize" aria-label="Organize sources">
          <div className="organize-control">
            <span>Group</span>
            <label className="select-field compact-select-field">
              <select aria-label="Group by" value={grouping} onChange={(event) => {
                setGrouping(event.target.value as SourceGrouping);
                setCollapsed(new Set());
              }}>
                <option value="none">None</option>
                <option value="tag">Tag</option>
                {!discovering && <option value="subscription">Subscription</option>}
              </select>
            </label>
          </div>
          <div className="organize-control">
            <span>Sort</span>
            <label className="select-field compact-select-field">
              <select aria-label="Sort by" value={sort} onChange={(event) => setSort(event.target.value as SourceSort)}>
                <option value="default">{discovering ? "Name A–Z" : "Subscribed"}</option>
                {!discovering && <option value="name">Name A–Z</option>}
                <option value="added">{discovering ? "Latest saved" : "Date added"}</option>
                <option value="updated">{discovering ? "Latest updated" : "Updated"}</option>
                <option value="articles">Articles</option>
              </select>
            </label>
          </div>
        </div>
        {grouping !== "none" && <div className="library-tools source-tools">
          <div className="layout-toggle" role="group" aria-label="Group layout">
            <button type="button" aria-pressed={layout === "list"} onClick={() => setLayout("list")}>List</button>
            <button type="button" aria-pressed={layout === "kanban"} onClick={() => setLayout("kanban")}>Kanban</button>
          </div>
        </div>}
      </>)}

      {filtered.length === 0 ? (
        <div className="empty-state source-empty">
          <span className="empty-icon" aria-hidden="true">⌂</span>
          <h2>{displayedSources.length === 0 ? (discovering ? "No suggestions yet" : "No sources yet") : "No sources match"}</h2>
          <p>
            {displayedSources.length === 0
              ? (discovering ? "Suggestions appear when your library contains websites not already saved as sources." : "Save a site you want to visit independently from individual articles.")
              : "Try changing your filters or search."}
          </p>
        </div>
      ) : (
        <div className={`article-groups ${grouping === "none" ? "list" : layout}`}
          role="region" aria-label="Source groups" tabIndex={grouping !== "none" && layout === "kanban" ? 0 : undefined}>
          {groups.map((group, index) => (
            <section className="article-group" key={group.key}>
              {grouping !== "none" && <div className="group-header">
                <button className="group-heading" type="button" aria-expanded={!collapsed.has(group.key)} onClick={() => {
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
                    return next;
                  });
                }}>
                  <svg className="group-chevron" aria-hidden="true" viewBox="0 0 16 16"><path d={collapsed.has(group.key) ? "m6 3 5 5-5 5" : "m3 6 5 5 5-5"} /></svg>
                  <h2>{group.label}</h2><span>{group.sources.length}</span>
                </button>
                <div className="group-order" role="group" aria-label={`Order ${group.label}`}>
                  {([-1, 1] as const).map((direction) => <button key={direction} type="button"
                    aria-label={`Move ${group.label} ${direction === -1 ? "earlier" : "later"}`}
                    disabled={!orderLoaded || orderBusy || (direction === -1 ? index === 0 : index === groups.length - 1)}
                    onClick={() => void reorderGroup(group.key, direction)}>
                    <svg aria-hidden="true" viewBox="0 0 16 16" className={layout === "kanban" ? "horizontal-arrow" : undefined}>
                      <path d={direction === -1 ? "m4 9 4-4 4 4" : "m4 7 4 4 4-4"} />
                    </svg>
                  </button>)}
                </div>
              </div>}
              {!collapsed.has(group.key) && <div className="source-list">
          {group.sources.map((source) => {
            const articleCount = articleCounts.get(source.domain) ?? 0;
            return (
              <article className="source-card" key={source.id}>
                <div className="source-card-header">
                  {!discovering && <SourceIcon key={source.url} url={source.url} />}
                  <div className="source-identity">
                    <h3 title={source.name}>{source.name}</h3>
                    {!discovering && <span>{source.domain}</span>}
                  </div>
                  {source.subscribed && (
                    <span className="subscription-badge">Subscribed</span>
                  )}
                </div>
                {source.note && <p className="source-note">{source.note}</p>}
                {discovering && !!source.tags?.length && <p className="muted">Suggested tags</p>}
                {!!source.tags?.length && <div className="article-tags" aria-label={discovering ? "Suggested tags" : "Tags"}>
                  {source.tags.map((tag) => <span key={tag}>{tag}</span>)}
                </div>}
                <div className="source-meta">
                  {articleCount} saved {articleCount === 1 ? "article" : "articles"}
                </div>
                <div className="card-actions">
                  {discovering ? <button className="button primary compact" onClick={() => {
                    setAddingCandidate(candidates.find((candidate) => candidate.domain === source.domain));
                  }}>Add source</button> : <button
                    className="button secondary compact"
                    onClick={() => void openSource(source)}
                  >
                    Open
                  </button>}
                  <CardActionsMenu label={`Actions for source ${source.name}`} actions={[
                    ...(discovering ? [{ label: "Open", onSelect: () => void openSource(source) }] : []),
                    { label: "View saved", disabled: articleCount === 0, onSelect: () => onViewArticles(source.domain) },
                    ...(!discovering ? [
                      { label: "Edit", onSelect: () => setEditing(source) },
                      { label: "Remove", danger: true, onSelect: () => void removeSource(source) }
                    ] : [])
                  ]} />
                </div>
              </article>
            );
          })}
              </div>}
            </section>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <SourceEditor
          source={editing}
          onClose={() => setEditing(undefined)}
          onSave={saveSource}
          availableTags={availableTags}
        />
      )}
      {addingCandidate && (
        <SourceEditor
          source={null}
          initial={{ name: addingCandidate.domain, url: addingCandidate.url }}
          suggestedTags={addingCandidate.suggestedTags}
          onClose={() => setAddingCandidate(undefined)}
          onSave={saveSource}
          availableTags={availableTags}
        />
      )}
    </main>
  );
}

function SourceIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  const faviconUrl = typeof chrome !== "undefined" && chrome.runtime?.id
    ? `${chrome.runtime.getURL("_favicon/")}?${new URLSearchParams({ pageUrl: url, size: "32" })}`
    : undefined;

  return (
    <span className="source-icon" aria-hidden="true">
      {faviconUrl && !failed ? (
        <img src={faviconUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <path d="M3 12h18M5 6.5h14M5 17.5h14" />
        </svg>
      )}
    </span>
  );
}

interface SourceEditorProps {
  source: Source | null;
  initial?: {
    name: string;
    url: string;
  };
  onClose: () => void;
  onSave: (source: Source) => Promise<void>;
  availableTags: string[];
  suggestedTags?: string[];
}

export function SourceEditor({ source, initial, onClose, onSave, availableTags, suggestedTags = [] }: SourceEditorProps) {
  const [name, setName] = useState(source?.name ?? initial?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? initial?.url ?? "");
  const [note, setNote] = useState(source?.note ?? "");
  const [subscribed, setSubscribed] = useState(source?.subscribed ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tags, setTags] = useState(source?.tags ?? []);
  const [tagQuery, setTagQuery] = useState("");
  const suggestions = normalizeTags([...suggestedTags, ...availableTags]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(
        sourceFromInput({ name, url, note, subscribed, tags: tagsWithQuery(tags, suggestions, tagQuery) }, source ?? undefined)
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The source could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal source-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-editor-title"
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Source</p>
            <h2 id="source-editor-title">{source ? "Edit source" : "Add source"}</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="source-fields">
          <label>
            Website URL
            <input
              type="text"
              inputMode="url"
              placeholder="example.com"
              value={url}
              required
              autoFocus
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label>
            Name <span className="optional">(optional)</span>
            <input
              type="text"
              placeholder="Defaults to the domain"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Note <span className="optional">(optional)</span>
            <textarea
              rows={3}
              placeholder="Why you want to keep this source"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <label className="subscription-field">
            <input
              type="checkbox"
              checked={subscribed}
              onChange={(event) => setSubscribed(event.target.checked)}
            />
            I have a subscription
          </label>
          <fieldset className="source-tag-fields" disabled={saving}>
            <legend>Tags</legend>
            <p className="muted">{suggestedTags.length ? "Article tags are suggested below, not added automatically." : "Choose existing tags or create a new one."}</p>
            <TagPicker selected={tags} available={suggestions} query={tagQuery} onQuery={setTagQuery} onChange={setTags} disabled={saving} />
          </fieldset>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={saving}>
            {source ? "Save changes" : "Add source"}
          </button>
        </div>
      </form>
    </div>
  );
}

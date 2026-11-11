import { useMemo, useState } from "react";
import { db } from "../db/database";
import { sourceFromInput } from "../domain/source";
import type { Article, Source } from "../domain/types";

interface SourcesPanelProps {
  sources: Source[];
  articles: Article[];
  onChanged: () => Promise<void>;
  onViewArticles: (domain: string) => void;
}

export function SourcesPanel({
  sources,
  articles,
  onChanged,
  onViewArticles
}: SourcesPanelProps) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Source | null>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const articleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const article of articles) {
      counts.set(article.domain, (counts.get(article.domain) ?? 0) + 1);
    }
    return counts;
  }, [articles]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...sources]
      .filter(
        (source) =>
          !normalizedQuery ||
          source.name.toLowerCase().includes(normalizedQuery) ||
          source.domain.toLowerCase().includes(normalizedQuery) ||
          source.note?.toLowerCase().includes(normalizedQuery)
      )
      .sort(
        (left, right) =>
          Number(right.subscribed) - Number(left.subscribed) ||
          left.name.localeCompare(right.name)
      );
  }, [query, sources]);

  async function saveSource(source: Source) {
    setError("");
    const duplicate = await db.sources
      .where("normalizedUrl")
      .equals(source.normalizedUrl)
      .first();
    if (duplicate && duplicate.id !== source.id) {
      throw new Error("This source is already saved.");
    }
    await db.sources.put(source);
    setEditing(undefined);
    setMessage(editing ? "Source updated." : "Source added.");
    await onChanged();
  }

  async function removeSource(source: Source) {
    if (!window.confirm(`Remove “${source.name}” from Sources?`)) return;
    await db.sources.delete(source.id);
    setMessage("Source removed.");
    setError("");
    await onChanged();
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
    <main className="panel-page">
      <div className="section-heading source-heading">
        <div>
          <p className="eyebrow">Sites worth returning to</p>
          <h2>Sources</h2>
          <p className="muted">
            Keep publications and websites you want to browse manually.
          </p>
        </div>
        <button className="button primary compact" onClick={() => setEditing(null)}>
          Add source
        </button>
      </div>

      {error && <p className="feedback error" role="alert">{error}</p>}
      {message && <p className="feedback success" role="status">{message}</p>}

      {sources.length > 0 && (
        <label className="search-box source-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search sources</span>
          <input
            type="search"
            placeholder="Search sources"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state source-empty">
          <span className="empty-icon" aria-hidden="true">⌂</span>
          <h2>{sources.length === 0 ? "No sources yet" : "No sources match"}</h2>
          <p>
            {sources.length === 0
              ? "Save a site you want to visit independently from individual articles."
              : "Try changing your search."}
          </p>
        </div>
      ) : (
        <div className="source-list">
          {filtered.map((source) => {
            const articleCount = articleCounts.get(source.domain) ?? 0;
            return (
              <article className="source-card" key={source.id}>
                <div className="source-card-header">
                  <span className="source-monogram" aria-hidden="true">
                    {source.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="source-identity">
                    <h3>{source.name}</h3>
                    <span>{source.domain}</span>
                  </div>
                  {source.subscribed && (
                    <span className="subscription-badge">Subscribed</span>
                  )}
                </div>
                {source.note && <p className="source-note">{source.note}</p>}
                <div className="source-meta">
                  {articleCount} saved {articleCount === 1 ? "article" : "articles"}
                </div>
                <div className="card-actions">
                  <button
                    className="button primary compact"
                    onClick={() => void openSource(source)}
                  >
                    Open
                  </button>
                  <button
                    className="button secondary compact"
                    disabled={articleCount === 0}
                    onClick={() => onViewArticles(source.domain)}
                  >
                    View saved
                  </button>
                  <button className="text-button" onClick={() => setEditing(source)}>
                    Edit
                  </button>
                  <button
                    className="text-button danger-text"
                    onClick={() => void removeSource(source)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing !== undefined && (
        <SourceEditor
          source={editing}
          onClose={() => setEditing(undefined)}
          onSave={saveSource}
        />
      )}
    </main>
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
}

export function SourceEditor({ source, initial, onClose, onSave }: SourceEditorProps) {
  const [name, setName] = useState(source?.name ?? initial?.name ?? "");
  const [url, setUrl] = useState(source?.url ?? initial?.url ?? "");
  const [note, setNote] = useState(source?.note ?? "");
  const [subscribed, setSubscribed] = useState(source?.subscribed ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave(
        sourceFromInput({ name, url, note, subscribed }, source ?? undefined)
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

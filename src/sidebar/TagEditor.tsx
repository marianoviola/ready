import { useEffect, useRef, useState } from "react";
import { normalizeTags } from "../domain/tags";

interface TagEditorProps {
  initial: string[];
  available: string[];
  additive: boolean;
  onClose: () => void;
  onSave: (tags: string[]) => Promise<void>;
}

export function TagEditor({ initial, available, additive, onClose, onSave }: TagEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(initial);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const suggestions = available.filter(
    (tag) => tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
      !selected.some((value) => value.toLocaleLowerCase() === tag.toLocaleLowerCase())
  );

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function add(tag: string) {
    setSelected((current) => normalizeTags([...current, tag]));
    setQuery("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const value = query.trim();
      const existing = available.find((tag) => tag.toLocaleLowerCase() === value.toLocaleLowerCase());
      await onSave(normalizeTags([...selected, existing ?? value]));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Tags could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="tag-editor"
      aria-labelledby="tag-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="modal-header">
          <h2 id="tag-editor-title">{additive ? "Add tags to selection" : "Edit tags"}</h2>
          <button type="button" className="icon-button" aria-label="Close tag editor" disabled={saving} onClick={onClose}>×</button>
        </div>
        <p className="muted">{additive ? "Existing article tags will be kept." : "Choose existing tags or create a new one."}</p>
        <div className="tag-choices" aria-label="Selected tags">
          {selected.map((tag) => (
            <button type="button" className="tag-chip" key={tag} disabled={saving} aria-label={`Remove tag ${tag}`} onClick={() => setSelected(selected.filter((value) => value !== tag))}>
              {tag} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        <label className="search-box">
          <span className="sr-only">Find or create tag</span>
          <input
            autoFocus
            value={query}
            disabled={saving}
            placeholder="Find or create tag"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && query.trim()) {
                event.preventDefault();
                add(available.find((tag) => tag.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) ?? query);
              }
            }}
          />
        </label>
        <div className="tag-suggestions">
          <div className="tag-choices" aria-label="Existing tags">
            {suggestions.map((tag) => <button type="button" className="tag-chip" key={tag} disabled={saving} onClick={() => add(tag)}>{tag}</button>)}
          </div>
          {query.trim() && !available.some((tag) => tag.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) &&
            !selected.some((tag) => tag.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) && (
            <button type="button" className="text-button" disabled={saving} onClick={() => add(query)}>Create tag "{query.trim()}"</button>
          )}
        </div>
        {error && <p className="feedback error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary" disabled={saving || (additive && selected.length === 0 && !query.trim())}>{saving ? "Saving..." : "Save tags"}</button>
        </div>
      </form>
    </dialog>
  );
}

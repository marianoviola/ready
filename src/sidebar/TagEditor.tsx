import { useEffect, useRef, useState } from "react";
import { TagPicker, tagsWithQuery } from "./TagPicker";

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

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(tagsWithQuery(selected, available, query));
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
        <TagPicker selected={selected} available={available} query={query} onQuery={setQuery}
          onChange={setSelected} disabled={saving} autoFocus />
        {error && <p className="feedback error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary" disabled={saving || (additive && selected.length === 0 && !query.trim())}>{saving ? "Saving..." : "Save tags"}</button>
        </div>
      </form>
    </dialog>
  );
}

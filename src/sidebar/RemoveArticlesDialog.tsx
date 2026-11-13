import { useEffect, useId, useRef, useState } from "react";

export interface RemoveArticlesDialogProps {
  selectedCount: number;
  bookmarkCount: number;
  pending?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (deleteBookmarks: boolean) => void;
}

export function RemoveArticlesDialog({
  selectedCount, bookmarkCount, pending = false, error, onCancel, onConfirm
}: RemoveArticlesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittedRef = useRef(false);
  const [deleteBookmarks, setDeleteBookmarks] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!pending) submittedRef.current = false;
  }, [pending, error]);

  return (
    <dialog ref={dialogRef} className="modal remove-articles-dialog"
      aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}>
      <div className="modal-header">
        <h2 id={titleId}>Remove from Ready?</h2>
        <button type="button" className="icon-button" aria-label="Close removal dialog"
          disabled={pending} onClick={onCancel}>×</button>
      </div>
      <p id={descriptionId}>
        Remove {selectedCount} {selectedCount === 1 ? "article" : "articles"} from your Ready list.
        Their highlights and notes will be deleted. Reading statistics and history are kept.
      </p>
      <p className="muted">
        {bookmarkCount} linked {bookmarkCount === 1 ? "Favorite" : "Favorites"}.
        {" "}Edge Favorites are kept unless you choose to delete them too.
      </p>
      <label className="remove-bookmarks-option">
        <input type="checkbox" checked={deleteBookmarks} disabled={pending || bookmarkCount === 0}
          onChange={(event) => setDeleteBookmarks(event.target.checked)} />
        Also delete {bookmarkCount} linked {bookmarkCount === 1 ? "Favorite" : "Favorites"} from Edge Favorites
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="button secondary" disabled={pending}
          autoFocus onClick={onCancel}>Cancel</button>
        <button type="button" className="button danger" disabled={pending || selectedCount < 1}
          onClick={() => {
            if (submittedRef.current) return;
            submittedRef.current = true;
            onConfirm(deleteBookmarks && bookmarkCount > 0);
          }}>
          {pending ? "Removing…" : "Remove from Ready"}
        </button>
      </div>
    </dialog>
  );
}

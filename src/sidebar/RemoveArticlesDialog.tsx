import { useState } from "react";
import { RemovalDialog } from "./RemovalDialog";

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
  const [deleteBookmarks, setDeleteBookmarks] = useState(false);

  return (
    <RemovalDialog title="Remove from Ready?" confirmLabel="Remove from Ready"
      pending={pending} error={error} disabled={selectedCount < 1} onCancel={onCancel}
      onConfirm={() => onConfirm(deleteBookmarks && bookmarkCount > 0)}
      description={<>
        Remove {selectedCount} {selectedCount === 1 ? "article" : "articles"} from your Ready list.
        Their highlights and notes will be deleted. Reading statistics and history are kept.
      </>}>
      <p className="muted">
        {bookmarkCount} linked {bookmarkCount === 1 ? "Favorite" : "Favorites"}.
        {" "}Edge Favorites are kept unless you choose to delete them too.
      </p>
      <label className="remove-bookmarks-option">
        <input type="checkbox" checked={deleteBookmarks} disabled={pending || bookmarkCount === 0}
          onChange={(event) => setDeleteBookmarks(event.target.checked)} />
        <span>Also delete {bookmarkCount} linked {bookmarkCount === 1 ? "Favorite" : "Favorites"} from Edge Favorites</span>
      </label>
    </RemovalDialog>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { sendReadyMessage } from "../browser/messages";
import {
  hasMatchingBookmarks,
  selectableBookmarkIds,
  type BookmarkLinkFilter
} from "../domain/bookmark-tree";
import type { BookmarkNode } from "../domain/types";

interface BookmarkPickerProps {
  mode: "link" | "folder";
  onClose: () => void;
  onLinked: (linked: number) => Promise<void>;
  onFolderSelected: (folderId?: string) => Promise<void>;
}

export function BookmarkPicker({
  mode,
  onClose,
  onLinked,
  onFolderSelected
}: BookmarkPickerProps) {
  const [tree, setTree] = useState<BookmarkNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<BookmarkLinkFilter>("unlinked");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void sendReadyMessage({ type: "GET_BOOKMARK_TREE" }).then((response) => {
      if (response.ok && "bookmarkTree" in response) {
        setTree(response.bookmarkTree);
      } else {
        setError(response.ok ? "Favorites could not be loaded." : response.error);
      }
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Favorites could not be loaded.");
    }).finally(() => setLoading(false));
  }, []);

  const roots = useMemo(
    () => tree.flatMap((node) => node.children ?? [node]),
    [tree]
  );
  const visibleRoots = useMemo(
    () =>
      mode === "link"
        ? roots.filter((node) => hasMatchingBookmarks(node, filter))
        : roots,
    [filter, mode, roots]
  );

  async function submit() {
    setLoading(true);
    setError("");
    try {
      if (mode === "link") {
        const response = await sendReadyMessage({
          type: "LINK_BOOKMARKS",
          bookmarkIds: [...selected]
        });
        if (!response.ok) throw new Error(response.error);
        if (!("linked" in response)) {
          throw new Error("Ready received an unexpected link response.");
        }
        await onLinked(response.linked);
      } else {
        await onFolderSelected([...selected][0]);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action failed.");
    } finally {
      setLoading(false);
    }
  }

  function changeFilter(nextFilter: BookmarkLinkFilter) {
    setFilter(nextFilter);
    setSelected(new Set());
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmark-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Edge Favorites</p>
            <h2 id="bookmark-picker-title">
              {mode === "link" ? "Link Favorites" : "Choose destination"}
            </h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {mode === "link" && (
          <div className="link-filter">
            <label htmlFor="favorite-link-filter">Show</label>
            <select
              id="favorite-link-filter"
              value={filter}
              onChange={(event) =>
                changeFilter(event.target.value as BookmarkLinkFilter)
              }
            >
              <option value="unlinked">Not linked</option>
              <option value="linked">Already linked</option>
              <option value="all">All Favorites</option>
            </select>
          </div>
        )}

        <div className="tree" aria-busy={loading}>
          {loading && tree.length === 0 ? (
            <p className="muted">Loading Favorites…</p>
          ) : visibleRoots.length === 0 ? (
            <p className="muted">No Favorites match this filter.</p>
          ) : (
            visibleRoots.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                mode={mode}
                filter={filter}
                selected={selected}
                setSelected={setSelected}
              />
            ))
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          {mode === "link" && (
            <span className="selection-count" aria-live="polite">
              {selected.size} selected
            </span>
          )}
          <button className="button secondary" onClick={onClose}>Cancel</button>
          <button
            className="button primary"
            disabled={selected.size === 0 || loading}
            onClick={() => void submit()}
          >
            {mode === "link" ? "Link selected" : "Use folder"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface TreeNodeProps {
  node: BookmarkNode;
  mode: "link" | "folder";
  filter: BookmarkLinkFilter;
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
}

function TreeNode({
  node,
  mode,
  filter,
  selected,
  setSelected
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const checkboxRef = useRef<HTMLInputElement>(null);
  const isFolder = !node.url;
  const visibleChildren =
    node.children?.filter(
      (child) => mode === "folder" || hasMatchingBookmarks(child, filter)
    ) ?? [];
  const selectableIds =
    mode === "link"
      ? selectableBookmarkIds(node, filter)
      : isFolder
        ? [node.id]
        : [];
  const checked =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const partiallyChecked =
    !checked && selectableIds.some((id) => selected.has(id));
  const selectable = mode === "link" ? selectableIds.length > 0 : isFolder;

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = partiallyChecked;
    }
  }, [partiallyChecked]);

  function toggle() {
    const next = new Set(mode === "folder" ? [] : selected);
    for (const id of selectableIds) {
      if (checked) next.delete(id);
      else next.add(id);
    }
    setSelected(next);
  }

  return (
    <div className="tree-node">
      <div className={`tree-row${node.linked ? " linked" : ""}`}>
        {isFolder ? (
          <button
            className="tree-toggle"
            aria-label={expanded ? "Collapse folder" : "Expand folder"}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "⌄" : "›"}
          </button>
        ) : (
          <span className="tree-spacer" />
        )}
        {(mode === "link" || isFolder) && (
          <input
            ref={checkboxRef}
            type={mode === "folder" ? "radio" : "checkbox"}
            name={mode === "folder" ? "destination-folder" : undefined}
            checked={checked}
            disabled={!selectable}
            onChange={toggle}
            aria-label={`Select ${node.title || "Favorite"}`}
          />
        )}
        <span className={isFolder ? "folder-label" : "bookmark-label"}>
          <span aria-hidden="true">{isFolder ? "▰" : "↗"}</span>
          <span className="tree-title">
            {node.title || (isFolder ? "Favorites" : node.url)}
          </span>
          {node.linked && <span className="linked-badge">Linked</span>}
        </span>
      </div>
      {isFolder && expanded && visibleChildren.length > 0 && (
        <div className="tree-children">
          {visibleChildren.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              mode={mode}
              filter={filter}
              selected={selected}
              setSelected={setSelected}
            />
          ))}
        </div>
      )}
    </div>
  );
}

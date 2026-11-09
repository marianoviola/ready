import { useEffect, useMemo, useState } from "react";
import { sendReadyMessage } from "../browser/messages";
import type { BookmarkNode } from "../domain/types";

interface BookmarkPickerProps {
  mode: "import" | "folder";
  onClose: () => void;
  onComplete: (folderId?: string) => Promise<void>;
}

export function BookmarkPicker({
  mode,
  onClose,
  onComplete
}: BookmarkPickerProps) {
  const [tree, setTree] = useState<BookmarkNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void sendReadyMessage({ type: "GET_BOOKMARK_TREE" }).then((response) => {
      if (response.ok && "bookmarkTree" in response) {
        setTree(response.bookmarkTree);
      } else {
        setError(response.ok ? "Favorites could not be loaded." : response.error);
      }
      setLoading(false);
    });
  }, []);

  const roots = useMemo(
    () => tree.flatMap((node) => node.children ?? [node]),
    [tree]
  );

  async function submit() {
    setLoading(true);
    setError("");
    try {
      if (mode === "import") {
        const response = await sendReadyMessage({
          type: "IMPORT_BOOKMARKS",
          bookmarkIds: [...selected]
        });
        if (!response.ok) throw new Error(response.error);
        await onComplete();
      } else {
        await onComplete([...selected][0]);
      }
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action failed.");
    } finally {
      setLoading(false);
    }
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
              {mode === "import" ? "Choose Favorites" : "Choose destination"}
            </h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="tree" aria-busy={loading}>
          {loading && tree.length === 0 ? (
            <p className="muted">Loading Favorites…</p>
          ) : (
            roots.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                mode={mode}
                selected={selected}
                setSelected={setSelected}
              />
            ))
          )}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>Cancel</button>
          <button
            className="button primary"
            disabled={selected.size === 0 || loading}
            onClick={() => void submit()}
          >
            {mode === "import" ? "Import selected" : "Use folder"}
          </button>
        </div>
      </section>
    </div>
  );
}

interface TreeNodeProps {
  node: BookmarkNode;
  mode: "import" | "folder";
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
}

function TreeNode({ node, mode, selected, setSelected }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = !node.url;
  const selectable = mode === "import" || isFolder;
  const checked = selected.has(node.id);

  function toggle() {
    const next = new Set(mode === "folder" ? [] : selected);
    if (checked) next.delete(node.id);
    else next.add(node.id);
    setSelected(next);
  }

  return (
    <div className="tree-node">
      <div className="tree-row">
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
        {selectable && (
          <input
            type={mode === "folder" ? "radio" : "checkbox"}
            name={mode === "folder" ? "destination-folder" : undefined}
            checked={checked}
            onChange={toggle}
            aria-label={`Select ${node.title || "Favorite"}`}
          />
        )}
        <span className={isFolder ? "folder-label" : "bookmark-label"}>
          <span aria-hidden="true">{isFolder ? "▰" : "↗"}</span>
          {node.title || (isFolder ? "Favorites" : node.url)}
        </span>
      </div>
      {isFolder && expanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              mode={mode}
              selected={selected}
              setSelected={setSelected}
            />
          ))}
        </div>
      )}
    </div>
  );
}

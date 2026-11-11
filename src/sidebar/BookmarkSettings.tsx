import { useEffect, useState } from "react";
import { getBookmarkDestination, setBookmarkDestination } from "../browser/bookmark-destination";
import { BookmarkPicker } from "./BookmarkPicker";

export function BookmarkSettings() {
  const [destination, setDestination] = useState("Loading...");
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    const [settings, tree] = await Promise.all([
      getBookmarkDestination(),
      chrome.bookmarks.getTree()
    ]);
    function path(nodes: chrome.bookmarks.BookmarkTreeNode[], id: string, parents: string[] = []): string | undefined {
      for (const node of nodes) {
        const names = node.title ? [...parents, node.title] : parents;
        if (node.id === id && !node.url) return names.join(" / ");
        const found = node.children && path(node.children, id, names);
        if (found) return found;
      }
    }
    if (settings.folderId !== undefined) {
      const name = path(tree, settings.folderId);
      setDestination(name ?? "Folder unavailable");
      if (!name) throw new Error("Your destination folder was deleted. Choose another folder or use Ready.");
    } else {
      setDestination(settings.readyFolderId ? path(tree, settings.readyFolderId) ?? "Ready (created on next save)" : "Ready (created on first save)");
    }
  }

  useEffect(() => {
    void load().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Bookmark destination could not be loaded.");
      setDestination("Unavailable");
    }).finally(() => setBusy(false));
  }, []);

  async function save(folderId?: string) {
    setBusy(true);
    setError("");
    try {
      await setBookmarkDestination(folderId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card" aria-label="Bookmark destination">
      <h3>Bookmark destination</h3>
      <p className="muted">New Favorites are saved here. Existing Favorites are never moved or duplicated.</p>
      <p className="destination-path">{destination}</p>
      <div className="button-row">
        <button className="button secondary compact" disabled={busy} onClick={() => setChoosing(true)}>Choose folder</button>
        <button className="button secondary compact" disabled={busy} onClick={() => {
          void save().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Bookmark destination could not be saved."));
        }}>Use Ready folder</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {choosing && (
        <BookmarkPicker mode="folder" onClose={() => setChoosing(false)} onLinked={async () => {}} onFolderSelected={save} />
      )}
    </section>
  );
}

export interface BookmarkDestination {
  folderId?: string;
  readyFolderId?: string;
}

export async function getBookmarkDestination(): Promise<BookmarkDestination> {
  const stored = await chrome.storage.local.get(["bookmarkFolderId", "readyFolderId"]);
  function folderId(value: unknown): string | undefined {
    if (value !== undefined && (typeof value !== "string" || !value)) {
      throw new Error("Saved bookmark destination is invalid. Choose a folder in Settings.");
    }
    return value;
  }
  return { folderId: folderId(stored.bookmarkFolderId), readyFolderId: folderId(stored.readyFolderId) };
}

export async function setBookmarkDestination(folderId?: string): Promise<void> {
  if (folderId !== undefined) {
    const tree = await chrome.bookmarks.getTree();
    if (!findFolder(tree, folderId)) throw new Error("The selected folder no longer exists.");
    await chrome.storage.local.set({ bookmarkFolderId: folderId });
  } else {
    await chrome.storage.local.remove("bookmarkFolderId");
  }
}

let resolving: Promise<string> | undefined;

export async function resolveBookmarkDestination(explicitFolderId?: string): Promise<string> {
  if (explicitFolderId !== undefined) {
    const tree = await chrome.bookmarks.getTree();
    if (!findFolder(tree, explicitFolderId)) throw new Error("The selected folder no longer exists.");
    return explicitFolderId;
  }
  if (resolving) return resolving;
  resolving = resolveSavedDestination();
  try {
    return await resolving;
  } finally {
    resolving = undefined;
  }
}

async function resolveSavedDestination(): Promise<string> {
  const settings = await getBookmarkDestination();
  const tree = await chrome.bookmarks.getTree();
  if (settings.folderId !== undefined) {
    if (!findFolder(tree, settings.folderId)) {
      throw new Error("Your bookmark destination no longer exists. Choose a folder or reset to Ready in Settings.");
    }
    return settings.folderId;
  }
  if (settings.readyFolderId && findFolder(tree, settings.readyFolderId)) return settings.readyFolderId;
  const folder = await chrome.bookmarks.create({ title: "Ready" });
  await chrome.storage.local.set({ readyFolderId: folder.id });
  return folder.id;
}

function findFolder(nodes: chrome.bookmarks.BookmarkTreeNode[], id: string): boolean {
  return nodes.some((node) =>
    (node.id === id && !node.url && node.parentId !== undefined) ||
    (node.children ? findFolder(node.children, id) : false)
  );
}

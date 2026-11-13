import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookmarkDetails } from "../../src/sidebar/BookmarkDetails";
import { RemoveArticlesDialog } from "../../src/sidebar/RemoveArticlesDialog";
import type { Article } from "../../src/domain/types";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true; }) },
    close: { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false; }) }
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  vi.unstubAllGlobals();
});

describe("Favorite controls", () => {
  const article: Article = {
    id: "article", title: "Test", domain: "example.com", originalUrl: "https://example.com/",
    normalizedUrl: "https://example.com/", bookmarkState: "orphaned", tags: [], status: "read",
    progress: 1, originalSavedAt: 1, createdAt: 1, updatedAt: 1
  };
  it("shows orphan state and the live folder path without duplicating card actions", () => {
    act(() => root.render(h(BookmarkDetails, { article })));
    expect(container.textContent).toContain("Not linked to Edge Favorites");
    expect(container.querySelector("button")).toBeNull();
    act(() => root.render(h(BookmarkDetails, { article,
      metadata: { articleId: article.id, state: "linked", bookmarkId: "4", folderId: "2", folderPath: ["Favorites bar", "Reading"] } })));
    expect(container.textContent).toContain("Favorites bar / Reading");
    expect(container.textContent).not.toContain("Not linked");
    expect(container.querySelector("button")).toBeNull();
  });

  it("opens a named native dialog and keeps optional Favorite deletion unchecked", () => {
    const onConfirm = vi.fn();
    act(() => root.render(h(RemoveArticlesDialog, { selectedCount: 2, bookmarkCount: 1, onCancel: vi.fn(), onConfirm })));
    expect(container.querySelector("dialog")?.open).toBe(true);
    expect(container.textContent).toContain("Remove 2 articles");
    expect(container.querySelector("input")?.checked).toBe(false);
    act(() => container.querySelector<HTMLButtonElement>(".danger")!.click());
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it("requires explicit opt-in and blocks duplicate or pending confirmation and cancellation", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    act(() => root.render(h(RemoveArticlesDialog, { selectedCount: 1, bookmarkCount: 1, onCancel, onConfirm })));
    act(() => container.querySelector("input")!.click());
    act(() => {
      container.querySelector<HTMLButtonElement>(".danger")!.click();
      container.querySelector<HTMLButtonElement>(".danger")!.click();
    });
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true);
    act(() => root.render(h(RemoveArticlesDialog, { selectedCount: 1, bookmarkCount: 1, pending: true, onCancel, onConfirm })));
    expect([...container.querySelectorAll("button,input")].every((item) => (item as HTMLButtonElement).disabled)).toBe(true);
    const event = new Event("cancel", { bubbles: false, cancelable: true });
    act(() => container.querySelector("dialog")!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows removal errors and allows retry after pending completes", () => {
    const onConfirm = vi.fn();
    const props = { selectedCount: 1, bookmarkCount: 0, onCancel: vi.fn(), onConfirm };
    act(() => root.render(h(RemoveArticlesDialog, props)));
    act(() => container.querySelector<HTMLButtonElement>(".danger")!.click());
    act(() => root.render(h(RemoveArticlesDialog, { ...props, pending: true })));
    act(() => root.render(h(RemoveArticlesDialog, { ...props, error: "Please try again" })));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Please try again");
    act(() => container.querySelector<HTMLButtonElement>(".danger")!.click());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

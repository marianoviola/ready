import { ExtensionContextInvalidatedError, requireExtensionContext, sendReadyMessage } from "../browser/messages";
import type { Annotation, Article, ReadingPosition } from "../domain/types";
import { AnchorResolver } from "./anchor-resolver";
import { AnnotationRenderer } from "./annotation-renderer";
import { DocumentAdapter } from "./document-adapter";
import { ReadingTracker } from "./reading-tracker";
import { ReadingUi } from "./reading-ui";

declare global {
  interface Window {
    __readyReadingLayer?: boolean;
  }
}

if (!window.__readyReadingLayer) {
  document.dispatchEvent(new Event("ready:dispose-reading-layer"));
  window.__readyReadingLayer = true;
  void initialize().catch((error: unknown) => {
    window.__readyReadingLayer = false;
    console.error("Ready could not initialize the reading layer.", error);
    const recoveryUi = new ReadingUi();
    recoveryUi.showError(
      error instanceof Error ? error.message : "Ready could not initialize the reading layer.",
      error instanceof ExtensionContextInvalidatedError
    );
    document.addEventListener("ready:dispose-reading-layer", () => recoveryUi.destroy(), { once: true });
  });
}

async function initialize(): Promise<void> {
  const response = await sendReadyMessage({
    type: "GET_PAGE_DATA",
    url: location.href
  });
  if (
    !response.ok ||
    !("annotations" in response) ||
    !response.article
  ) {
    window.__readyReadingLayer = false;
    if (!response.ok) throw new Error(response.error);
    return;
  }

  const article = response.article;
  let annotations = response.annotations;
  const ui = new ReadingUi();
  let resolver: AnchorResolver;
  let renderer: AnnotationRenderer;
  let renderTimer: number | undefined;
  let selectionTimer: number | undefined;
  let disposed = false;
  let savingAnnotation = false;

  const adapter = new DocumentAdapter(() => {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
      if (disposed) return;
      renderer.destroy();
      resolver = new AnchorResolver(adapter.articleRoot);
      renderer = createRenderer(resolver);
      renderer.render(annotations);
    }, 500);
  });
  resolver = new AnchorResolver(adapter.articleRoot);
  renderer = createRenderer(resolver);
  renderer.render(annotations);
  adapter.start();

  const tracker = new ReadingTracker(
    article.id,
    adapter.articleRoot,
    article.progress,
    () => capturePosition(article, resolver),
    async (update) => {
      if (disposed) return;
      try {
        const result = await sendReadyMessage({
          type: "SAVE_READING_UPDATE",
          articleId: article.id,
          ...update
        });
        if (!result.ok) throw new Error(result.error);
      } catch (error) {
        reportError(error);
      }
    }
  );
  tracker.start();

  const onSelectionChange = () => {
    window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      if (disposed) return;
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        ui.hideToolbar();
        return;
      }
      const range = selection.getRangeAt(0);
      if (!adapter.articleRoot.contains(range.commonAncestorContainer)) {
        ui.hideToolbar();
        return;
      }
      ui.showSelectionToolbar(
        range.getBoundingClientRect(),
        () => void createAnnotation(range.cloneRange()),
        () => void createAnnotation(range.cloneRange(), true)
      );
    });
  };
  document.addEventListener("selectionchange", onSelectionChange);

  if (article.position && response.shouldResume) {
    ui.showResume(() => {
      const range = resolver.resolve(article.position!.anchor);
      if (!range) {
        window.alert("Ready could not recover the original reading position because the page changed.");
        return;
      }
      range.startContainer.parentElement?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      renderer.showPosition(range);
    });
  }

  const onMessage = (message: { type?: string }) => {
    if (message?.type === "READY_HIGHLIGHT_SELECTION") {
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        void createAnnotation(selection.getRangeAt(0).cloneRange());
      }
    }
  };
  chrome.runtime.onMessage.addListener(onMessage);
  document.addEventListener("ready:dispose-reading-layer", dispose);

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    window.__readyReadingLayer = false;
    tracker.stop();
    adapter.stop();
    window.clearTimeout(renderTimer);
    window.clearTimeout(selectionTimer);
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("ready:dispose-reading-layer", dispose);
    if (chrome.runtime.id) chrome.runtime.onMessage.removeListener(onMessage);
    renderer.destroy();
    ui.destroy();
  }

  function reportError(error: unknown): void {
    if (disposed) return;
    console.error("Ready reading layer failed.", error);
    if (error instanceof ExtensionContextInvalidatedError) {
      dispose();
      const recoveryUi = new ReadingUi();
      recoveryUi.showError(error.message, true);
      document.addEventListener("ready:dispose-reading-layer", () => recoveryUi.destroy(), { once: true });
    } else {
      ui.showError(error instanceof Error ? error.message : "Ready could not save your reading data.");
    }
  }

  async function createAnnotation(range: Range, withNote = false): Promise<void> {
    if (disposed || savingAnnotation) return;
    savingAnnotation = true;
    try {
      requireExtensionContext();
      const anchor = resolver.create(range);
      const note = withNote
        ? window.prompt("Add a private note to this highlight:") ?? undefined
        : undefined;
      if (withNote && note === undefined) return;
      const result = await sendReadyMessage({
        type: "CREATE_ANNOTATION",
        articleId: article.id,
        anchor,
        note
      });
      if (disposed) return;
      if (!result.ok || !("annotation" in result)) {
        throw new Error(result.ok ? "Annotation was not created." : result.error);
      }
      annotations = [...annotations, result.annotation];
      renderer.render(annotations);
      document.getSelection()?.removeAllRanges();
      ui.hideToolbar();
    } catch (error) {
      reportError(error);
    } finally {
      savingAnnotation = false;
    }
  }

  function createRenderer(currentResolver: AnchorResolver): AnnotationRenderer {
    return new AnnotationRenderer(currentResolver, (annotationId) => {
      const annotation = annotations.find((item) => item.id === annotationId);
      if (!annotation) return;
      annotations = annotations.map((item) =>
        item.id === annotationId ? { ...item, unresolved: true } : item
      );
      void sendReadyMessage({
        type: "UPDATE_ANNOTATION",
        annotationId,
        note: annotation.note,
        unresolved: true
      }).then((result) => {
        if (!result.ok) throw new Error(result.error);
      }).catch(reportError);
    });
  }
}

function capturePosition(
  article: Article,
  resolver: AnchorResolver
): ReadingPosition | undefined {
  const x = Math.round(window.innerWidth / 2);
  const y = Math.round(window.innerHeight * 0.4);
  const documentWithCaret = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = documentWithCaret.caretRangeFromPoint?.(x, y);
  if (!range) return article.position;

  const node = range.startContainer;
  if (!(node instanceof Text) || !node.textContent?.trim()) return article.position;
  const word = wordRange(node, range.startOffset);
  try {
    const progress = Math.min(
      1,
      Math.max(0, (window.scrollY + y) / Math.max(1, document.documentElement.scrollHeight))
    );
    return {
      anchor: resolver.create(word),
      progress,
      savedAt: Date.now()
    };
  } catch {
    return article.position;
  }
}

function wordRange(node: Text, offset: number): Range {
  const text = node.textContent ?? "";
  let start = Math.min(offset, text.length);
  let end = start;
  while (start > 0 && /\S/.test(text[start - 1])) start -= 1;
  while (end < text.length && /\S/.test(text[end])) end += 1;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, Math.max(start + 1, end));
  return range;
}

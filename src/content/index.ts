import { sendReadyMessage } from "../browser/messages";
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
  window.__readyReadingLayer = true;
  void initialize();
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
    return;
  }

  const article = response.article;
  let annotations = response.annotations;
  const ui = new ReadingUi();
  let resolver: AnchorResolver;
  let renderer: AnnotationRenderer;
  let renderTimer: number | undefined;

  const adapter = new DocumentAdapter(() => {
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(() => {
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
      await sendReadyMessage({
        type: "SAVE_READING_UPDATE",
        articleId: article.id,
        ...update
      });
    }
  );
  tracker.start();

  document.addEventListener("selectionchange", () => {
    window.setTimeout(() => {
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        ui.hideToolbar();
        return;
      }
      const range = selection.getRangeAt(0);
      if (!adapter.articleRoot.contains(range.commonAncestorContainer)) return;
      ui.showSelectionToolbar(
        range.getBoundingClientRect(),
        () => void createAnnotation(range.cloneRange()),
        () => void createAnnotation(range.cloneRange(), true)
      );
    });
  });

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

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "READY_HIGHLIGHT_SELECTION") {
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        void createAnnotation(selection.getRangeAt(0).cloneRange());
      }
    }
  });

  async function createAnnotation(range: Range, withNote = false): Promise<void> {
    try {
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
      if (!result.ok || !("annotation" in result)) {
        throw new Error(result.ok ? "Annotation was not created." : result.error);
      }
      annotations = [...annotations, result.annotation];
      renderer.render(annotations);
      document.getSelection()?.removeAllRanges();
      ui.hideToolbar();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Ready could not save the highlight.");
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
      });
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

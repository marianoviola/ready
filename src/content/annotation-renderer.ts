import type { Annotation } from "../domain/types";
import { AnchorResolver } from "./anchor-resolver";

interface HighlightRegistry {
  set(name: string, highlight: Highlight): void;
  delete(name: string): void;
}

export class AnnotationRenderer {
  private readonly highlightName = "ready-annotations";
  private style?: HTMLStyleElement;
  private marker?: HTMLElement;

  constructor(
    private readonly resolver: AnchorResolver,
    private readonly onUnresolved: (annotationId: string) => void
  ) {}

  render(annotations: Annotation[]): void {
    const registry = CSS.highlights as unknown as HighlightRegistry | undefined;
    if (!registry || typeof Highlight === "undefined") return;

    const ranges: Range[] = [];
    for (const annotation of annotations) {
      const range = this.resolver.resolve(annotation.anchor);
      if (range) ranges.push(range);
      else if (!annotation.unresolved) this.onUnresolved(annotation.id);
    }

    registry.delete(this.highlightName);
    if (ranges.length > 0) {
      registry.set(this.highlightName, new Highlight(...ranges));
      this.ensureStyle();
    }
  }

  showPosition(range: Range): void {
    this.marker?.remove();
    const rect = range.getBoundingClientRect();
    const marker = document.createElement("div");
    marker.setAttribute("aria-hidden", "true");
    marker.style.cssText = `
      position: absolute;
      z-index: 2147483645;
      left: ${Math.max(4, rect.left + window.scrollX - 10)}px;
      top: ${rect.top + window.scrollY}px;
      width: 4px;
      height: ${Math.max(28, rect.height)}px;
      border-radius: 999px;
      background: #5b5fc7;
      box-shadow: 0 0 0 3px rgba(91,95,199,.18);
      pointer-events: none;
    `;
    document.documentElement.append(marker);
    this.marker = marker;
    window.setTimeout(() => marker.remove(), 6000);
  }

  private ensureStyle(): void {
    if (this.style?.isConnected) return;
    this.style = document.createElement("style");
    this.style.textContent = `
      ::highlight(${this.highlightName}) {
        background-color: color-mix(in srgb, #f8d22a 48%, transparent);
        text-decoration: underline;
        text-decoration-color: #b28a00;
        text-underline-offset: 2px;
      }
    `;
    document.head.append(this.style);
  }
}

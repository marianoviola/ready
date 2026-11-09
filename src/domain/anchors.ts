import type { TextAnchor } from "./types";

const CONTEXT_LENGTH = 32;

export interface ResolvedTextAnchor {
  start: number;
  end: number;
  confidence: number;
  strategy: "quote" | "position";
}

export function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function createTextAnchor(
  documentText: string,
  start: number,
  end: number,
  domHint?: string
): TextAnchor {
  const text = normalizeText(documentText);
  if (start < 0 || end <= start || end > text.length) {
    throw new Error("Selection offsets are outside the article text.");
  }

  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
    start,
    end,
    domHint
  };
}

export function resolveTextAnchor(
  documentText: string,
  anchor: TextAnchor,
  minimumConfidence = 0.65
): ResolvedTextAnchor | undefined {
  const text = normalizeText(documentText);
  const candidates: number[] = [];
  let index = text.indexOf(anchor.exact);

  while (index >= 0) {
    candidates.push(index);
    index = text.indexOf(anchor.exact, index + 1);
  }

  const ranked = candidates
    .map((start) => {
      const prefix = text.slice(Math.max(0, start - anchor.prefix.length), start);
      const suffix = text.slice(
        start + anchor.exact.length,
        start + anchor.exact.length + anchor.suffix.length
      );
      const prefixScore = similarity(prefix, anchor.prefix);
      const suffixScore = similarity(suffix, anchor.suffix);
      const proximityScore =
        1 - Math.min(1, Math.abs(start - anchor.start) / Math.max(1, text.length));
      return {
        start,
        end: start + anchor.exact.length,
        confidence: 0.45 + prefixScore * 0.2 + suffixScore * 0.2 + proximityScore * 0.15,
        strategy: "quote" as const
      };
    })
    .sort((left, right) => right.confidence - left.confidence);

  if (ranked[0] && ranked[0].confidence >= minimumConfidence) {
    return ranked[0];
  }

  if (
    anchor.start >= 0 &&
    anchor.end <= text.length &&
    similarity(text.slice(anchor.start, anchor.end), anchor.exact) >= 0.8
  ) {
    return {
      start: anchor.start,
      end: anchor.end,
      confidence: 0.7,
      strategy: "position"
    };
  }

  return undefined;
}

function similarity(left: string, right: string): number {
  if (!left && !right) return 1;
  if (!left || !right) return 0;
  const length = Math.max(left.length, right.length);
  let matching = 0;
  for (let offset = 0; offset < Math.min(left.length, right.length); offset += 1) {
    if (left[offset] === right[offset]) matching += 1;
  }
  return matching / length;
}

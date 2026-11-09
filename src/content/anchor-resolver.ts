import {
  createTextAnchor,
  normalizeText,
  resolveTextAnchor
} from "../domain/anchors";
import type { TextAnchor } from "../domain/types";

interface CharacterPoint {
  node: Text;
  offset: number;
}

interface TextMap {
  text: string;
  points: Array<CharacterPoint | undefined>;
}

export class AnchorResolver {
  constructor(private readonly root: HTMLElement) {}

  create(range: Range): TextAnchor {
    if (!this.root.contains(range.commonAncestorContainer)) {
      throw new Error("Select text inside the main article.");
    }

    const map = buildTextMap(this.root);
    const exact = normalizeText(range.toString());
    if (!exact) throw new Error("Select some text first.");

    const candidates = allIndexes(map.text, exact);
    if (candidates.length === 0) {
      throw new Error("Ready could not anchor this selection.");
    }

    const rangeStart = findRangeStart(map, range);
    const start = candidates.sort(
      (left, right) => Math.abs(left - rangeStart) - Math.abs(right - rangeStart)
    )[0];
    return createTextAnchor(
      map.text,
      start,
      start + exact.length,
      elementHint(range.commonAncestorContainer)
    );
  }

  resolve(anchor: TextAnchor): Range | undefined {
    const map = buildTextMap(this.root);
    const resolved = resolveTextAnchor(map.text, anchor);
    if (!resolved) return undefined;

    const start = nearestPoint(map.points, resolved.start, 1);
    const end = nearestPoint(map.points, resolved.end - 1, -1);
    if (!start || !end) return undefined;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
  }
}

function buildTextMap(root: HTMLElement): TextMap {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (
        !parent ||
        parent.closest(
          "script, style, nav, aside, footer, [aria-hidden='true'], [hidden]"
        ) ||
        !node.textContent?.trim()
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let text = "";
  const points: Array<CharacterPoint | undefined> = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (text) {
      text += " ";
      points.push(undefined);
    }
    const raw = node.textContent ?? "";
    let pendingSpace = false;
    for (let offset = 0; offset < raw.length; offset += 1) {
      const character = raw[offset];
      if (/\s/.test(character)) {
        pendingSpace = text.length > 0;
        continue;
      }
      if (pendingSpace && !text.endsWith(" ")) {
        text += " ";
        points.push({ node, offset });
      }
      text += character;
      points.push({ node, offset });
      pendingSpace = false;
    }
  }
  return { text: normalizeText(text), points };
}

function findRangeStart(map: TextMap, range: Range): number {
  const index = map.points.findIndex(
    (point) =>
      point?.node === range.startContainer && point.offset >= range.startOffset
  );
  return index >= 0 ? index : 0;
}

function nearestPoint(
  points: Array<CharacterPoint | undefined>,
  start: number,
  direction: 1 | -1
): CharacterPoint | undefined {
  for (
    let index = start;
    index >= 0 && index < points.length;
    index += direction
  ) {
    if (points[index]) return points[index];
  }
  return undefined;
}

function allIndexes(text: string, search: string): number[] {
  const indexes: number[] = [];
  let index = text.indexOf(search);
  while (index >= 0) {
    indexes.push(index);
    index = text.indexOf(search, index + 1);
  }
  return indexes;
}

function elementHint(node: Node): string | undefined {
  const element =
    node instanceof Element ? node : node.parentElement;
  if (!element) return undefined;
  return [element.tagName.toLowerCase(), ...element.classList].slice(0, 3).join(".");
}

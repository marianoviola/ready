import { describe, expect, it } from "vitest";
import {
  createTextAnchor,
  normalizeText,
  resolveTextAnchor
} from "../../src/domain/anchors";

describe("text anchors", () => {
  const text =
    "Opening context. The stable passage is important for readers. Closing context.";

  it("creates quote and position selectors", () => {
    const start = text.indexOf("stable passage");
    const anchor = createTextAnchor(text, start, start + "stable passage".length);
    expect(anchor.exact).toBe("stable passage");
    expect(anchor.prefix).toContain("The ");
    expect(anchor.start).toBe(start);
  });

  it("restores a quote after content is inserted before it", () => {
    const start = text.indexOf("stable passage");
    const anchor = createTextAnchor(text, start, start + "stable passage".length);
    const changed = `New introduction. ${text}`;
    const resolved = resolveTextAnchor(changed, anchor);
    expect(resolved?.start).toBe(changed.indexOf("stable passage"));
    expect(resolved?.strategy).toBe("quote");
  });

  it("uses context to disambiguate repeated passages", () => {
    const repeated = "First context quote here end. Second context quote here finish.";
    const start = repeated.lastIndexOf("quote here");
    const anchor = createTextAnchor(repeated, start, start + "quote here".length);
    const resolved = resolveTextAnchor(repeated, anchor);
    expect(resolved?.start).toBe(start);
  });

  it("refuses unrelated text and normalizes whitespace", () => {
    const anchor = createTextAnchor(text, text.indexOf("stable"), text.indexOf("stable") + 6);
    expect(resolveTextAnchor("A completely unrelated article.", anchor)).toBeUndefined();
    expect(normalizeText("  a\n  b \t c ")).toBe("a b c");
  });
});

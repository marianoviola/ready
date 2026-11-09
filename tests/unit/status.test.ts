import { describe, expect, it } from "vitest";
import { statusAfterActivity, transitionStatus } from "../../src/domain/status";

describe("reading status", () => {
  it("allows explicit transitions between all supported states", () => {
    expect(transitionStatus("unread", "read")).toBe("read");
    expect(transitionStatus("read", "in_progress")).toBe("in_progress");
    expect(transitionStatus("in_progress", "unread")).toBe("unread");
  });

  it("only starts reading after meaningful active time", () => {
    expect(statusAfterActivity("unread", 14)).toBe("unread");
    expect(statusAfterActivity("unread", 15)).toBe("in_progress");
    expect(statusAfterActivity("read", 100)).toBe("read");
  });
});

import { describe, expect, it } from "vitest";
import { moveGroup, reconcileGroupOrder } from "../../src/domain/group-order";

describe("group order", () => {
  it("preserves saved positions and appends new groups only once", () => {
    expect(reconcileGroupOrder(["Read", "Unread"], ["Unread", "New", "New"]))
      .toEqual(["Read", "Unread", "New"]);
  });

  it("moves visible groups without dropping filtered-out groups", () => {
    const saved = ["A", "Hidden", "B", "C"];
    expect(moveGroup(saved, ["A", "B", "C"], "B", -1))
      .toEqual(["B", "Hidden", "A", "C"]);
    expect(saved).toEqual(["A", "Hidden", "B", "C"]);
    expect(moveGroup(saved, ["A", "B", "C"], "B", 1))
      .toEqual(["A", "Hidden", "C", "B"]);
  });

  it("handles boundaries, missing groups, and the unlabeled group", () => {
    expect(moveGroup([], ["", "A"], "", 1)).toEqual(["A", ""]);
    expect(moveGroup([], ["A", "B"], "A", -1)).toEqual(["A", "B"]);
    expect(moveGroup([], ["A", "B"], "B", 1)).toEqual(["A", "B"]);
    expect(moveGroup([], ["A"], "Missing", 1)).toEqual(["A"]);
  });
});

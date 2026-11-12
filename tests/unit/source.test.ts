import { describe, expect, it } from "vitest";
import { groupSources, normalizeSourceUrl, selectSources, sourceFromInput } from "../../src/domain/source";

describe("sources", () => {
  it("accepts a domain without a protocol", () => {
    expect(normalizeSourceUrl("Example.com")).toBe("https://example.com/");
  });

  it("derives the source name and domain when no name is provided", () => {
    const source = sourceFromInput(
      {
        name: "",
        url: "https://www.example.com/",
        subscribed: true,
        note: "  Weekly reading  "
      },
      undefined,
      100
    );

    expect(source).toMatchObject({
      name: "example.com",
      domain: "example.com",
      normalizedUrl: "https://www.example.com/",
      subscribed: true,
      note: "Weekly reading",
      createdAt: 100,
      updatedAt: 100
    });
  });

  it("rejects unsupported URL schemes", () => {
    expect(() => normalizeSourceUrl("file:///private/source")).toThrow(
      "http or https"
    );
  });

  it("normalizes tags, preserves them on ordinary edits, and allows explicit removal", () => {
    const source = sourceFromInput({ name: "Site", url: "example.com", subscribed: false, tags: [" Tech ", "tech", ""] }, undefined, 100);
    expect(source.tags).toEqual(["Tech"]);
    expect(sourceFromInput({ ...source, tags: undefined }, source, 200).tags).toEqual(["Tech"]);
    expect(sourceFromInput({ ...source, tags: [] }, source, 200).tags).toEqual([]);
    expect(sourceFromInput(source, source, 200)).toMatchObject({ id: source.id, createdAt: 100, updatedAt: 200 });
  });

  const alpha = { ...sourceFromInput({ name: "Alpha", url: "alpha.com", subscribed: false, tags: ["Tech", "News"], note: "Weekend" }, undefined, 100), id: "a" };
  const beta = { ...sourceFromInput({ name: "Beta", url: "beta.com", subscribed: true, tags: ["tech"] }, undefined, 200), id: "b", updatedAt: 500 };
  const untagged = { ...sourceFromInput({ name: "Gamma", url: "gamma.com", subscribed: false }, undefined, 300), id: "c" };
  const sources = [untagged, beta, alpha];
  const counts = new Map([["alpha.com", 5], ["beta.com", 2]]);

  it("searches all source metadata and combines tag and subscription filters", () => {
    for (const search of ["ALPHA", "alpha.com", "weekend", "NEWS"]) {
      expect(selectSources(sources, search, "", "all", "name", counts)).toEqual([alpha]);
    }
    expect(selectSources(sources, "", "TECH", "subscribed", "name", counts)).toEqual([beta]);
    expect(selectSources(sources, "", "tech", "not-subscribed", "name", counts)).toEqual([alpha]);
    expect(selectSources(sources, "missing", "", "all", "default", counts)).toEqual([]);
  });

  it("sorts without mutating sources and uses stable tie breakers", () => {
    const ids = (sort: Parameters<typeof selectSources>[4]) => selectSources(sources, "", "", "all", sort, counts).map((source) => source.id);
    expect(ids("default")).toEqual(["b", "a", "c"]);
    expect(ids("name")).toEqual(["a", "b", "c"]);
    expect(ids("added")).toEqual(["c", "b", "a"]);
    expect(ids("updated")).toEqual(["b", "c", "a"]);
    expect(ids("articles")).toEqual(["a", "b", "c"]);
    expect(sources).toEqual([untagged, beta, alpha]);
    const sameName = [{ ...alpha, id: "z" }, alpha];
    expect(selectSources(sameName, "", "", "all", "name", counts).map((source) => source.id)).toEqual(["a", "z"]);
  });

  it("groups tags case-insensitively, includes untagged sources, and keeps sorted item order", () => {
    const groups = groupSources([alpha, beta, untagged], "tag");
    expect(groups.map((group) => [group.label, group.sources.map((source) => source.id)])).toEqual([
      ["News", ["a"]], ["Tech", ["a", "b"]], ["Untagged", ["c"]]
    ]);
    expect(groupSources(sources, "none")[0].sources).toEqual(sources);
    expect(groupSources(sources, "subscription").map((group) => [group.label, group.sources.length])).toEqual([
      ["Not subscribed", 2], ["Subscribed", 1]
    ]);
    expect(groupSources([], "tag")).toEqual([]);
    expect(groupSources([untagged, { ...alpha, tags: ["Untagged", "untagged"] }], "tag")).toHaveLength(2);
  });
});

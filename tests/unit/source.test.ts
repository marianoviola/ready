import { describe, expect, it } from "vitest";
import { normalizeSourceUrl, sourceFromInput } from "../../src/domain/source";

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
});

import { afterEach, describe, expect, it } from "vitest";
import { ReadyDatabase } from "../../src/db/database";

const names: string[] = [];

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => indexedDB.deleteDatabase(name)));
});

describe("database schema", () => {
  it("opens version 1 with all recoverable data stores", async () => {
    const name = `ready-test-${crypto.randomUUID()}`;
    names.push(name);
    const database = new ReadyDatabase(name);
    await database.open();
    expect(database.verno).toBe(1);
    expect(database.tables.map((table) => table.name).sort()).toEqual([
      "annotations",
      "articles",
      "ignoredRecommendations",
      "sessions"
    ]);
    database.close();
  });
});

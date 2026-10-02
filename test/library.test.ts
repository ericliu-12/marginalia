import { describe, expect, it } from "vitest";
import { readLibrary } from "../src/domain/library";
import { useTestDb } from "./harness";

describe("read the library", () => {
  const ctx = useTestDb();

  it("is empty for the seeded user", async () => {
    expect(await readLibrary(ctx.db, ctx.userId)).toEqual([]);
  });
});

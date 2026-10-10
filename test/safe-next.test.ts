import { describe, expect, it } from "vitest";
import { safeNext } from "../src/lib/safe-next";

describe("safeNext", () => {
  it("returns only to a path on this site", () => {
    expect(safeNext("/graph?x=1")).toBe("/graph?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

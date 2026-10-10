import { describe, expect, it } from "vitest";
import { safeNext, signInPath } from "../src/lib/signed-out";

describe("safeNext", () => {
  it("returns only to a path on this site", () => {
    expect(safeNext("/graph?x=1")).toBe("/graph?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("signInPath", () => {
  it("comes back to the page after, and needs no next for the library", () => {
    expect(signInPath("/")).toBe("/sign-in");
    expect(signInPath("/graph?book=1")).toBe("/sign-in?next=%2Fgraph%3Fbook%3D1");
    expect(signInPath("/?add")).toBe("/sign-in?next=%2F%3Fadd");
  });
});

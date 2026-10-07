import { describe, expect, it } from "vitest";
import { follow, rewind } from "@/app/graph/trail";

describe("the Follow trail", () => {
  it("adds a followed Book to the end", () => {
    expect(follow(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("starts from nothing when followed from a Connection", () => {
    expect(follow([], "a")).toEqual(["a"]);
  });

  it("rewinds to a Book already on it rather than holding it twice", () => {
    expect(follow(["a", "b", "c"], "a")).toEqual(["a"]);
    expect(follow(["a", "b", "c"], "c")).toEqual(["a", "b", "c"]);
  });

  it("jumps back to a crumb, dropping everything after it", () => {
    expect(rewind(["a", "b", "c", "d"], 1)).toEqual(["a", "b"]);
    expect(rewind(["a", "b"], 1)).toEqual(["a", "b"]);
  });
});

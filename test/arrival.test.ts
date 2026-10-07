import { describe, expect, it } from "vitest";
import { arriving, drawOrder, justFinished } from "@/app/graph/arrival";
import type { GraphConnection } from "@/domain/graph";

const book = (bookId: string, finishedAt: number) => ({ bookId, finishedAt });
const connection = (id: string, a: string, b: string, strength: GraphConnection["strength"]): GraphConnection => ({ id, a, b, strength, type: "thematic", featured: true });

describe("which Books arrive", () => {
  it("is every Book the graph has not shown before, the most recently finished first", () => {
    expect(arriving(["a"], [book("a", 1), book("b", 2), book("c", 3)])).toEqual(["c", "b"]);
  });

  it("is none when the graph remembers nothing it has shown", () => {
    expect(arriving(null, [book("a", 1)])).toEqual([]);
  });

  it("is none in a burst: more than three new at once simply appear", () => {
    const books = [book("a", 1), book("b", 2), book("c", 3), book("d", 4), book("e", 5)];
    expect(arriving(["a"], books)).toEqual([]);
    expect(arriving(["a", "b"], books)).toEqual(["e", "d", "c"]);
  });
});

describe("the order Connections draw in", () => {
  it("is the arriving Books' Connections not drawn yet, the latest Book's first, strongest first", () => {
    const connections = [
      connection("weak-c", "c", "x", "weak"),
      connection("strong-c", "y", "c", "strong"),
      connection("moderate-b", "b", "z", "moderate"),
      connection("other", "x", "y", "strong"),
      connection("drawn", "c", "z", "strong"),
    ];
    expect(drawOrder(connections, ["c", "b"], new Set(["drawn"]))).toEqual(["strong-c", "weak-c", "moderate-b"]);
  });

  it("draws a Connection between two arriving Books once", () => {
    expect(drawOrder([connection("bc", "b", "c", "strong")], ["c", "b"], new Set())).toEqual(["bc"]);
  });
});

describe("whether an arriving Book was just finished", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 9, 7);

  it("is when its latest Read-through came from Reading, however long ago", () => {
    expect(justFinished({ startedAt: now - 90 * DAY, finishedAt: now - 60 * DAY }, now)).toBe(true);
  });

  it("is when it was finished within the last 14 days", () => {
    expect(justFinished({ startedAt: null, finishedAt: now - 14 * DAY }, now)).toBe(true);
  });

  it("is not when it was finished longer ago than that", () => {
    expect(justFinished({ startedAt: null, finishedAt: now - 15 * DAY }, now)).toBe(false);
  });

  it("is not for an Already-read add, which has no dates", () => {
    expect(justFinished({ startedAt: null, finishedAt: null }, now)).toBe(false);
  });
});

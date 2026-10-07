import { describe, expect, it } from "vitest";
import { CLOSED, panelState, type PanelEvent, type PanelState } from "@/app/graph/panel-state";

const run = (...events: PanelEvent[]) => events.reduce<PanelState>(panelState, CLOSED);
const book = (bookId: string) => ({ kind: "book" as const, bookId });

describe("the graph's panel state", () => {
  it("starts a trail at a Book chosen on the canvas", () => {
    expect(run({ kind: "select", selection: book("a") })).toEqual({ selection: book("a"), trail: ["a"], fresh: null });
  });

  it("has no trail on a Connection or a Cluster", () => {
    expect(run({ kind: "select", selection: book("a") }, { kind: "select", selection: { kind: "cluster", id: "k" } }).trail).toEqual([]);
  });

  it("follows Books onto the trail, the chosen Book always last", () => {
    const s = run({ kind: "select", selection: book("a") }, { kind: "follow", bookId: "b" }, { kind: "follow", bookId: "c" });
    expect(s).toMatchObject({ selection: book("c"), trail: ["a", "b", "c"] });
    expect(panelState(s, { kind: "follow", bookId: "a" })).toMatchObject({ selection: book("a"), trail: ["a"] });
    expect(panelState(s, { kind: "rewind", index: 1 })).toMatchObject({ selection: book("b"), trail: ["a", "b"] });
  });

  it("starts the trail at a Connection's other Book when following from it", () => {
    const s = run({ kind: "select", selection: { kind: "connection", id: "c1" } }, { kind: "follow", bookId: "b", via: "a" });
    expect(s).toMatchObject({ selection: book("b"), trail: ["a", "b"] });
  });

  it("clears the trail but stays on the Book", () => {
    const s = run({ kind: "select", selection: book("a") }, { kind: "follow", bookId: "b" }, { kind: "clear" });
    expect(s).toMatchObject({ selection: book("b"), trail: ["b"] });
  });

  it("keeps an arrived Book fresh until the panel closes", () => {
    const s = run({ kind: "arrive", bookId: "n" }, { kind: "follow", bookId: "a" });
    expect(s).toEqual({ selection: book("a"), trail: ["n", "a"], fresh: "n" });
    expect(panelState(s, { kind: "close" })).toEqual(CLOSED);
    expect(panelState(s, { kind: "select", selection: null })).toEqual(CLOSED);
  });
});

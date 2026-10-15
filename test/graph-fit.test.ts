import { describe, expect, it } from "vitest";
import { DESKTOP, FIT_MARGIN, LABEL_SIZE, MAX_FIT_ZOOM, TYPICAL_EDGE_LENGTH, WASH_RADIUS } from "../src/domain/graph-drawing";
import { fitDrawn, readDrawn, textWidth, type Drawn } from "../src/domain/graph-fit";

const VIEW = { width: 1440, height: 900 };
// Books in typical Connection lengths: drawn TYPICAL_EDGE_LENGTH pixels apart at zoom 1.
const book = (id: string, x: number, y: number, label = id) => ({ id, x, y, label, degree: 2 });
const drawn = (books: Drawn["books"], clusters: Drawn["clusters"] = []): Drawn => ({ books, clusters, unit: 1 });

describe("Text widths", () => {
  it("measures a title as Newsreader sets it", () => {
    // Chromium sets "The Remains of the Day" 144.4 pixels wide at 13px, kerned.
    expect(Math.abs(textWidth("The Remains of the Day", LABEL_SIZE) / 144.4 - 1)).toBeLessThan(0.01);
  });
});

describe("Fitting a graph to the canvas", () => {
  it("zooms a few Books in no further than MAX_FIT_ZOOM", () => {
    const fit = fitDrawn(drawn([book("A", 0, 0), book("B", 1, 0)]), VIEW);
    expect(fit).toMatchObject({ zoom: MAX_FIT_ZOOM, limit: "max" });
  });

  it("fits a wide graph by its width, its last label inside the margin", () => {
    const books = Array.from({ length: 12 }, (_, i) => book(`B${i}`, i, i % 2, i === 11 ? "The Unbearable Lightness of Being" : `B${i}`));
    const fit = fitDrawn(drawn(books), VIEW);
    expect(fit.limit).toBe("width");
    // The rightmost label's far end sits at the margin.
    const last = fit.zoom * (11 * TYPICAL_EDGE_LENGTH - fit.x) + VIEW.width / 2;
    const end = last + 3.5 + 1.7 * Math.sqrt(2) + 4 + textWidth("The Unbearable Lightness of Being", LABEL_SIZE) + 2;
    expect(end).toBeCloseTo(VIEW.width - FIT_MARGIN.side, 0);
    const first = fit.zoom * (0 - fit.x) + VIEW.width / 2;
    expect(first).toBeCloseTo(FIT_MARGIN.side + 3.5 + 1.7 * Math.sqrt(2), 0);
  });

  it("fits a tall graph by its height, with room above its top Cluster for that Cluster's name", () => {
    const books = Array.from({ length: 8 }, (_, i) => book(`B${i}`, i % 2, i));
    const fit = fitDrawn(drawn(books, [{ id: "c", bookIds: ["B0", "B1", "B2"], name: "Quiet lives" }]), VIEW);
    expect(fit.limit).toBe("height");
    const r = readDrawn(drawn(books, [{ id: "c", bookIds: ["B0", "B1", "B2"], name: "Quiet lives" }]), VIEW, fit);
    expect(r.namesOnWash).toBe(0);
  });
});

describe("How a fitted graph reads", () => {
  it("reports the share of the canvas the Books' dots fill", () => {
    const books = [book("A", 0, 0), book("B", 4, 0), book("C", 0, 2), book("D", 4, 2)];
    const r = readDrawn(drawn(books), VIEW);
    const px = r.zoom * TYPICAL_EDGE_LENGTH;
    expect(r.filled).toBeCloseTo((4 * px * 2 * px) / (VIEW.width * VIEW.height), 6);
  });

  it("puts a label on the first side clear of dots, labels and Connections, right when it is free", () => {
    // Far apart, so the graph is fitted small: A's long label, on the right, would reach B's dot.
    const books = [book("A", 0, 0, "The Unbearable Lightness of Being"), book("B", 1, 0), book("Far", 30, 20)];
    const r = readDrawn(drawn(books), VIEW);
    expect(r.zoom).toBeLessThan(1);
    expect(r).toMatchObject({ labelOverlaps: 0, dotOverlaps: 0, labelEdgeCrossings: 0 });
  });

  it("counts labels over labels and dots, at their real size, where no side of a label is clear", () => {
    // A long label ringed close by eight Books: every side of it is over one of their dots.
    const ring = Array.from({ length: 8 }, (_, i) => book(`R${i}`, 0.12 * Math.cos((i * Math.PI) / 4), 0.12 * Math.sin((i * Math.PI) / 4)));
    const r = readDrawn(drawn([book("A", 0, 0, "The Unbearable Lightness of Being"), ...ring, book("Far", 3, 2)]), VIEW);
    expect(r.dotOverlaps).toBeGreaterThan(0);
    expect(r.labelOverlaps).toBeGreaterThanOrEqual(r.dotOverlaps);
    expect(r.clashes).toHaveLength(r.labelOverlaps);
  });

  it("keeps labels off a Cluster's name, and counts names over each other", () => {
    // A label right where the first Cluster's name goes above it: the label takes another side.
    const name = "Inheritance and silence in small towns";
    const one = [book("A", 0, 1), book("B", 1, 1), book("C", 0.5, 1.3), book("Over", 0.2, 0.15, "A label right where the name goes")];
    const r = readDrawn(drawn([...one, book("Far", 12, 1)], [{ id: "c", bookIds: ["A", "B", "C"], name }]), VIEW);
    expect(r.nameOverlaps).toBe(0);
    // A second Cluster just beside it: their names, both above, meet.
    const two = [book("D", 0.8, 1), book("E", 1.8, 1), book("F", 1.3, 1.3)];
    const clusters = [{ id: "c", bookIds: ["A", "B", "C"], name }, { id: "d", bookIds: ["D", "E", "F"], name }];
    const both = readDrawn(drawn([...one.slice(0, 3), ...two], clusters), VIEW);
    expect(both.nameOverlaps).toBe(1);
    expect(both.clashes.some((c) => "cluster" in c.a && "cluster" in c.b)).toBe(true);
  });

  it("counts Connections past Books not at either end, along each other, and through labels, each with a push to ease it", () => {
    const linked = (books: Drawn["books"], pairs: [string, string][]) => ({ ...drawn(books), connections: pairs.map(([a, b]) => ({ a, b })) });
    // A to B runs right past C.
    const past = readDrawn(linked([book("A", 0, 0), book("B", 2, 0), book("C", 1, 0.02), book("D", 1, 2)], [["A", "B"], ["C", "D"]]), VIEW);
    expect(past).toMatchObject({ edgesNearBooks: 1, parallelEdges: 0 });
    expect(past.pushes.some((p) => p.ids.includes("C"))).toBe(true);
    // From S, to P and to Q, under PARALLEL_MIN apart.
    const along = readDrawn(linked([book("S", 0, 0), book("P", 2, 0), book("Q", 1, 0.15)], [["S", "P"], ["S", "Q"]]), VIEW);
    expect(along).toMatchObject({ edgesNearBooks: 0, parallelEdges: 1 });
    // A hub with a Connection out of each side: wherever its label goes, a line crosses it.
    const hub = readDrawn(linked([book("H", 0, 0), book("R", 2, 0), book("L", -2, 0), book("U", 0, -2), book("D", 0, 2)], [["H", "R"], ["H", "L"], ["H", "U"], ["H", "D"]]), VIEW);
    expect(hub.labelEdgeCrossings).toBe(1);
  });

  it("counts the halo's Books on a wash, on a name, or too near the connected Books, on every canvas size", () => {
    // A Cluster of three, connected, and Books with no Connections: one far off, one on its wash, and one
    // right of it, its label leading away.
    const linked = [book("A", 0, 0), book("B", 1, 0), book("C", 0.5, 0.8)];
    const clusters = [{ id: "c", bookIds: ["A", "B", "C"], name: "Inheritance and silence" }];
    const lone = (id: string, x: number, y: number) => ({ ...book(id, x, y), degree: 0 });
    for (const view of Object.values(DESKTOP)) {
      expect(readDrawn(drawn([...linked, lone("Far", 5, 3)], clusters), view).halo).toEqual({ onWash: 0, onName: 0, near: 0 });
      expect(readDrawn(drawn([...linked, lone("Far", 5, 3), lone("Wash", -0.5, 0.4)], clusters), view).halo).toEqual({ onWash: 1, onName: 0, near: 1 });
      // Just past the wash, but nearer it than HALO_GAP pixels.
      const r = readDrawn(drawn([...linked, lone("Far", 5, 3), lone("Close", 1 + WASH_RADIUS + 0.12, 0)], clusters), view);
      expect(r.halo).toEqual({ onWash: 0, onName: 0, near: 1 });
    }
  });
});

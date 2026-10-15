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

  it("counts labels over labels and dots at their real size, at the fitted zoom", () => {
    // Far apart, so the graph is fitted small: a long label reaches the next Book along its row.
    const books = [book("A", 0, 0, "The Unbearable Lightness of Being"), book("B", 1, 0), book("C", 0, 0.05), book("Far", 30, 20)];
    const r = readDrawn(drawn(books), VIEW);
    expect(r.zoom).toBeLessThan(1);
    // A's label covers B's dot and C's label (C sits just below A).
    expect(r.labelOverlaps).toBe(2);
    expect(r.dotOverlaps).toBe(1);
    expect(r.clashes).toHaveLength(2);
  });

  it("counts a Cluster's name over another Book's label", () => {
    // Labels where the name would go above the Cluster and below it: it goes above, on a tie.
    const books = [book("A", 0, 1), book("B", 1, 1), book("C", 0.5, 1.3), book("Over", 0.2, 0.15, "A label right where the name goes"), book("Under", 0.2, 2.15, "A label right where the name goes")];
    const clusters = [{ id: "c", bookIds: ["A", "B", "C"], name: "Inheritance and silence" }];
    const r = readDrawn(drawn([...books, book("Far", 12, 1)], clusters), VIEW);
    expect(r.nameOverlaps).toBe(1);
    expect(r.clashes.some((c) => "cluster" in c.a && "book" in c.b && c.b.book === "Over")).toBe(true);
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

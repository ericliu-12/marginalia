import { describe, expect, it } from "vitest";
import { overlaps, placeLabels, placeNames, type Box, type Dot, type LabelRequest, type NameRequest } from "../src/app/graph/placement";

// Screen boxes only: no canvas. A 1000 by 800 view, labels 60 wide and 16 tall, 12 from their dot, their
// plates reaching 2 back toward it beside the dot.
const VIEW = { width: 1000, height: 800 };
const dot = (id: string, x: number, y: number, radius = 4): Dot => ({ id, x, y, radius });
const ask = (d: Dot, must = false, w = 60): LabelRequest => ({ id: d.id, x: d.x, y: d.y, gap: 12, plate: 2, w, h: 16, must });
const at = (placed: { id: string; box: Box }[], id: string) => placed.find((p) => p.id === id)?.box;
const sideOf = (box: Box | undefined, d: Dot) =>
  !box ? "off" : box.x0 > d.x ? "right" : box.x1 < d.x ? "left" : box.y1 < d.y ? "above" : "below";

describe("Label placement", () => {
  it("puts a label to the right of its dot, centred on it, where there is room", () => {
    const a = dot("a", 500, 400);
    const placed = placeLabels({ view: VIEW, dots: [a], requests: [ask(a)] });
    expect(at(placed, "a")).toEqual({ x0: 510, y0: 392, x1: 570, y1: 408 });
  });

  it("keeps the whole gap above or below its dot", () => {
    const a = dot("a", 500, 400);
    const placed = placeLabels({ view: VIEW, dots: [a, dot("r", 540, 400), dot("l", 460, 400)], requests: [ask(a)] });
    expect(at(placed, "a")).toEqual({ x0: 470, y0: 372, x1: 530, y1: 388 });
  });

  it("falls back to the left, then above, then below, as each side is taken by another dot", () => {
    const a = dot("a", 500, 400);
    const right = dot("r", 540, 400);
    const left = dot("l", 460, 400);
    const above = dot("u", 500, 380);
    expect(sideOf(at(placeLabels({ view: VIEW, dots: [a, right], requests: [ask(a)] }), "a"), a)).toBe("left");
    expect(sideOf(at(placeLabels({ view: VIEW, dots: [a, right, left], requests: [ask(a)] }), "a"), a)).toBe("above");
    expect(sideOf(at(placeLabels({ view: VIEW, dots: [a, right, left, above], requests: [ask(a)] }), "a"), a)).toBe("below");
  });

  it("leaves a label off where no side is free, unless it must show, when it goes right regardless", () => {
    const a = dot("a", 500, 400);
    const crowd = [dot("r", 540, 400), dot("l", 460, 400), dot("u", 500, 380), dot("d", 500, 420)];
    expect(at(placeLabels({ view: VIEW, dots: [a, ...crowd], requests: [ask(a)] }), "a")).toBeUndefined();
    expect(sideOf(at(placeLabels({ view: VIEW, dots: [a, ...crowd], requests: [ask(a, true)] }), "a"), a)).toBe("right");
  });

  it("gives earlier requests first pick, so later ones move aside or are left off", () => {
    const a = dot("a", 500, 400);
    const b = dot("b", 500, 410);
    const placed = placeLabels({ view: VIEW, dots: [a, b], requests: [ask(b), ask(a)] });
    expect(sideOf(at(placed, "b"), b)).toBe("right");
    expect(sideOf(at(placed, "a"), a)).toBe("left");
  });

  it("never overlaps two labels, nor a label and a dot, however crowded", () => {
    const dots = Array.from({ length: 400 }, (_, i) => dot(`n${i}`, 100 + ((i * 37) % 800), 100 + ((i * 53) % 600)));
    const placed = placeLabels({ view: VIEW, dots, requests: dots.map((d) => ask(d)) });
    expect(placed.length).toBeGreaterThan(20);
    for (const p of placed) {
      for (const q of placed) if (p !== q) expect(overlaps(p.box, q.box)).toBe(false);
      for (const d of dots) if (d.id !== p.id) expect(overlaps(p.box, { x0: d.x - d.radius, y0: d.y - d.radius, x1: d.x + d.radius, y1: d.y + d.radius })).toBe(false);
    }
  });

  it("keeps clear of other boxes it is given, such as Cluster names", () => {
    const a = dot("a", 500, 400);
    const name = { x0: 505, y0: 390, x1: 600, y1: 410 };
    expect(sideOf(at(placeLabels({ view: VIEW, dots: [a], requests: [ask(a)], obstacles: [name] }), "a"), a)).toBe("left");
  });

  it("leaves off labels that could not reach the view, but keeps one that must show", () => {
    const far = dot("far", 1300, 400);
    const edge = dot("edge", 1020, 400);
    const placed = placeLabels({ view: VIEW, dots: [far, edge], requests: [ask(far), ask(edge)] });
    expect(at(placed, "far")).toBeUndefined();
    expect(at(placed, "edge")).toBeDefined();
    expect(at(placeLabels({ view: VIEW, dots: [far], requests: [ask(far, true)] }), "far")).toBeDefined();
  });
});

describe("Cluster name placement", () => {
  // Wash radius 40, names 100 by 20 sitting 0.75 of a radius past the Cluster's outermost Book.
  const name = (id: string, members: string[], chosen = false): NameRequest => ({ id, members: new Set(members), w: 100, h: 20, chosen });
  const place = (dots: Dot[], names: NameRequest[], labels: Box[] = [], uncovered = VIEW.width) =>
    placeNames({ view: VIEW, clear: { top: 50, bottom: 50, side: 10 }, uncovered, washRadius: 40, offset: 0.75, dots, labels, names });
  const cluster = [dot("a", 400, 400), dot("b", 500, 380), dot("c", 600, 420)];

  it("centres a name over its Books on screen, above them, clear of their washes", () => {
    const placed = place(cluster, [name("q", ["a", "b", "c"])]);
    // Centre x 500; above the highest Book (380) by 30 and half its own height.
    expect(placed.get("q")).toEqual({ x0: 450, y0: 330, x1: 550, y1: 350 });
  });

  it("goes below instead where above would cross more labels", () => {
    const placed = place(cluster, [name("q", ["a", "b", "c"])], [{ x0: 480, y0: 335, x1: 520, y1: 345 }]);
    expect(placed.get("q")!.y0).toBeGreaterThan(420);
  });

  it("on a tie in labels, takes the side clear of other Clusters' Books, then the one over fewer dots", () => {
    const other = dot("x", 500, 320);
    const placed = place([...cluster, other], [name("q", ["a", "b", "c"])]);
    expect(placed.get("q")!.y0).toBeGreaterThan(420);
    // Held at the top edge, above would sit on the Cluster's own Book there.
    const pinned = place([dot("a", 500, 60), dot("b", 520, 400)], [name("q", ["a", "b"])]);
    expect(pinned.get("q")!.y0).toBeGreaterThan(400);
  });

  it("is placed by the Books on screen alone, and left off with none of them showing", () => {
    const placed = place([dot("a", 400, 400), dot("b", 3000, 400)], [name("q", ["a", "b"]), name("gone", ["b"])]);
    expect(placed.get("q")!.x0).toBe(350);
    expect(placed.get("gone")).toBeNull();
  });

  it("keeps clear of the canvas edges", () => {
    const placed = place([dot("a", 990, 400), dot("b", 995, 410)], [name("q", ["a", "b"])]);
    expect(placed.get("q")!.x1).toBe(990);
    expect(place([dot("a", 400, 70), dot("b", 420, 760)], [name("q", ["a", "b"])]).get("q")!.y0).toBeGreaterThanOrEqual(50);
  });

  it("is left off on top of an earlier name, or under the panel, unless chosen", () => {
    const twin = [dot("d", 410, 400), dot("e", 510, 380), dot("f", 590, 420)];
    // Two labels below both Clusters, so each name would rather go above.
    const below = [{ x0: 480, y0: 455, x1: 490, y1: 465 }, { x0: 500, y0: 455, x1: 510, y1: 465 }];
    const two = place([...cluster, ...twin], [name("q", ["a", "b", "c"]), name("r", ["d", "e", "f"])], below);
    expect(two.get("q")).not.toBeNull();
    expect(two.get("r")).toBeNull();
    expect(place([...cluster, ...twin], [name("q", ["a", "b", "c"]), name("r", ["d", "e", "f"], true)], below).get("r")).not.toBeNull();
    expect(place(cluster, [name("q", ["a", "b", "c"])], [], 520).get("q")).toBeNull();
    expect(place(cluster, [name("q", ["a", "b", "c"], true)], [], 520).get("q")).not.toBeNull();
  });
});

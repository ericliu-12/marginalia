import { describe, expect, it } from "vitest";
import { CLUSTER_NAME_COLOR, layoutScale, TYPICAL_EDGE_LENGTH, WASH, WASH_ALPHA } from "../src/app/graph/graph-style";
import { WASH_COUNT } from "../src/domain/clusters";

const PAPER = "#f3ecdd";
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (c: number[]) => {
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (p: number[], q: number[]) => {
  const [lo, hi] = [luminance(p), luminance(q)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (base: number[], tint: number[], alpha: number) => base.map((v, i) => v * (1 - alpha) + tint[i] * alpha);

describe("Graph style", () => {
  it("has a wash for each of the Clusters' wash indices", () => {
    expect(WASH).toHaveLength(WASH_COUNT);
  });

  it("keeps Cluster names at 4.5:1 or more where two washes overlap at rest", () => {
    for (const tint of WASH) {
      const twice = over(over(rgb(PAPER), rgb(tint), WASH_ALPHA.rest), rgb(tint), WASH_ALPHA.rest);
      expect(contrast(rgb(CLUSTER_NAME_COLOR), twice), tint).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("scales the layout so the median Connection is a typical length", () => {
    const books = [{ bookId: "a", x: 0, y: 0 }, { bookId: "b", x: 2, y: 0 }, { bookId: "c", x: 2, y: 4 }];
    const links = [{ a: "a", b: "b" }, { a: "b", b: "c" }, { a: "a", b: "c" }];
    // Lengths 2, 4 and about 4.47: the median is 4.
    expect(layoutScale(books, links)).toBeCloseTo(TYPICAL_EDGE_LENGTH / 4);
  });

  it("without Connections, scales by the median distance from each Book to its nearest other", () => {
    const books = [{ bookId: "a", x: 0, y: 0 }, { bookId: "b", x: 0.5, y: 0 }, { bookId: "c", x: 0.5, y: 3 }];
    // Nearest: a 0.5, b 0.5, c 3.
    expect(layoutScale(books, [])).toBeCloseTo(TYPICAL_EDGE_LENGTH / 0.5);
  });

  it("leaves a lone Book, or Books all in one place, unscaled", () => {
    expect(layoutScale([{ bookId: "a", x: 3, y: 1 }], [])).toBe(1);
    expect(layoutScale([{ bookId: "a", x: 3, y: 1 }, { bookId: "b", x: 3, y: 1 }], [])).toBe(1);
  });
});

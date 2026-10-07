import { describe, expect, it } from "vitest";
import { CLUSTER_NAME_COLOR, WASH, WASH_ALPHA } from "../src/app/graph/graph-style";
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
});

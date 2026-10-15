import { describe, expect, it } from "vitest";
import { CLUSTER_TINTS, clusterTint } from "../src/app/cluster-tint";
import { WASH_COUNT } from "../src/domain/clusters";

const GROUNDS = { ground: "#fbf8f1", raised: "#fffdf8", selected: "#f3ede1" };
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (p: string, q: string) => {
  const [lo, hi] = [luminance(p), luminance(q)].sort((x, y) => x - y);
  return (hi + 0.05) / (lo + 0.05);
};

describe("Cluster tints", () => {
  it("has a tint for every wash a Cluster can be handed", () => {
    expect(CLUSTER_TINTS.length).toBeGreaterThanOrEqual(WASH_COUNT);
  });

  it("sets every Cluster name at 4.5:1 or more on ground, raised and selected", () => {
    for (const { name } of CLUSTER_TINTS) for (const [where, ground] of Object.entries(GROUNDS)) expect(contrast(name, ground), `${name} on ${where}`).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps a Cluster's tint with its wash", () => {
    expect(clusterTint(2)).toBe(CLUSTER_TINTS[2]);
    expect(clusterTint(CLUSTER_TINTS.length + 1)).toBe(CLUSTER_TINTS[1]);
  });
});

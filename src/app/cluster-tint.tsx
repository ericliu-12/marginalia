// The Cluster tints: a muted tint for a Cluster's mark, and a darker name colour that holds 4.5:1 on
// ground, raised and selected. A Cluster keeps its stored `wash`, so it keeps its tint. The library's
// dots use them now; the graph's washes move onto the same table in #138.
export const CLUSTER_TINTS = [
  { tint: "#9fb39a", name: "#4d6349" }, // sage
  { tint: "#d3a189", name: "#8a4a30" }, // terracotta
  { tint: "#b9a1b4", name: "#6a4c63" }, // mauve
  { tint: "#cdb27a", name: "#6e5a24" }, // ochre
  { tint: "#8fb5ae", name: "#3d635d" }, // teal
  { tint: "#d6a6aa", name: "#8a434b" }, // rose
  { tint: "#a9a6c8", name: "#544f7a" }, // heather
  { tint: "#c4ad96", name: "#6b543e" }, // umber
] as const;

export const clusterTint = (wash: number) => CLUSTER_TINTS[wash % CLUSTER_TINTS.length];

// A Finished Book's Cluster, beside its row: the tint, ringed in the name colour so the mark holds 3:1.
export function ClusterDot({ wash }: { wash: number }) {
  const { tint, name } = clusterTint(wash);
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: tint, boxShadow: `inset 0 0 0 1px ${name}` }} />;
}

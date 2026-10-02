# Graph scale benchmark (ticket: "Does force-graph stay smooth at several hundred Books?")

Throwaway. `bench.html` is the `prototype/graph-view` prototype with two additions:
`?n=N` swaps the sample library for N synthetic Books (about N/20 Clusters, 3-5 Connections
per Book at 80% intra-Cluster with preferential attachment, 40% strong) and `?fix=` toggles
mitigations (`deg,focus,pos,lod,nowash`). `?variant=D` is force-graph, `A` is Sigma; `?top=7` is the
real hub-display value from the density decision.

Run: `npm i playwright-core; node bench.mjs "$PWD" bench.html '[{"v":"D","n":600,"top":7,"fix":"deg,focus,pos"}]'`
(drives installed Chrome, headed, via requestAnimationFrame interval sampling).

Machine: Apple-silicon Mac, 120 Hz display (8.3 ms = a perfect frame), Chrome headed, 1440x900.

## force-graph (D), as prototyped

| Books | Edges | pan | zoom | drag a Book | pan with hub selected |
|---|---|---|---|---|---|
| 26 | 33 | 125 fps, p95 9 ms | 124 | 125 | 125 |
| 300 | ~1000 | 125, p95 9 | 124, p95 9 | 127, p95 9 | 125, p95 9 |
| 600 | ~2100 | 100, p95 25 | 111, p95 17 | 106, p95 17 | 115, p95 17 |
| 1000 | ~3500 | 43, p95 75 | 51, p95 58 | 100, p95 13 (max 100) | 27, p95 150 |

## force-graph with hot-path fixes

`deg` = cache per-Book degree, `focus` = cache focus set and trail edges per selection, `pos` = id-to-node map.
`lod` = labels only for Books with degree >= 4 (>= 8 when zoomed far out). `nowash` = Cluster washes off (ablation).

| Books | fixes | pan | zoom | drag a Book | pan, hub selected |
|---|---|---|---|---|---|
| 600 | deg,focus,pos | 123, p95 9 | 123, p95 9 | 114, p95 17 | 123, p95 9 |
| 600 | + lod | 125, p95 9 | 123, p95 9 | 115, p95 17 | 124, p95 9 |
| 1000 | deg,focus,pos | 115, p95 17 | 114, p95 17 | 56, p95 26 | 106, p95 17 |
| 1000 | + lod | 117, p95 9 | 114, p95 17 | 62, p95 25 | 116, p95 17 |
| 1000 | + lod + nowash | 117, p95 9 | 115, p95 17 | 121, p95 9 | 120, p95 9 |

## Sigma (A) with the same washes, for reference

1000 Books: pan 125 fps / p95 9 ms, zoom 122 fps / p95 9 ms. Held 120 fps at 300, 600 and 1000 with no changes.
(Its zoomed-in pan row did not redraw and is discounted.)

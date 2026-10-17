---
target: "graph fog and zoom detail (#156)"
total_score: 24
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/graph/graph-canvas.tsx"
target_fingerprint: "sha256:c612c7bb590ce0b28bc3d1a48c634c48f10ef4956dc13dab6541457b085a0826"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/graph/graph-canvas.tsx
timestamp: 2026-10-16T23-44-43Z
slug: src-app-graph-graph-canvas-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 2 | Fitted view draws no connections at all; nothing says they exist |
| 2 | Match System / Real World | 4 | Map metaphor: names at the edge, mist, detail by zoom |
| 3 | User Control and Freedom | 3 | Hint glide works but keeps a deep zoom |
| 4 | Consistency and Standards | 2 | Ink hub dots carry grey half-faded labels; hints echo on-canvas names |
| 5 | Error Prevention | 3 | Misted dots can't be hit, so no accidental picks |
| 6 | Recognition Rather Than Recall | 3 | Hints help find the way back |
| 7 | Flexibility and Efficiency | 2 | Glide never adjusts zoom |
| 8 | Aesthetic and Minimalist Design | 3 | Big step from main's hairball; near zoom still dense |
| 9 | Error Recovery | n/a | No error states in this change |
| 10 | Help and Documentation | 2 | Desktop legend never says zooming reveals more |
| **Total** | | **24/36** | Good |

## Priority Issues
- [P1] Fitted view shows no connections (LINE_FROM.strong 44 sits above fitted spacing). Fix: strong lines faintly present at fit.
- [P1] Grey half-alpha labels at rest beside ink hub dots (wide label ramp; LABEL_SEEN 0.12 lets ghost labels take room). Fix: narrow the label ramp so a label at rest is in or out and only fades over the ease; raise LABEL_SEEN.
- [P2] Hint text 3.2-3.5:1 at rest (name colour at 70%). Fix: full name colour, quiet via size/weight. (Fixed in source.)
- [P2] Hint glide keeps the zoom; lands inside a mist with one book. Fix: frame the Cluster's Books, never zooming in further.
- [P3] Phone fitted view: hub dots at full radius crowd; hint arrow barely visible.

## Detector
CLI: clean on changed files; one pre-existing advisory (graph-workspace.tsx:187 font size). Browser: cream-palette only (the deliberate paper ground; false positive). Canvas content is invisible to the DOM detector.

## Minor
Labels under the header at near zoom (pre-existing). Pre-existing label overlaps in placement (also on main). Two Clusters can share a tint.

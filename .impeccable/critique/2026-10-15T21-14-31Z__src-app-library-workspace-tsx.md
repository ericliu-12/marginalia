---
target: "#140 motion and delight"
total_score: 23
max_score: 28
na_heuristics: 5,9,10
p0_count: 0
p1_count: 1
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/library-workspace.tsx"
target_fingerprint: "sha256:fcad5fc1836d113fc25e46bff464f2245d410b09bb574c36a8bd405c095c8110"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/library-workspace.tsx
timestamp: 2026-10-15T21-14-31Z
slug: src-app-library-workspace-tsx
---
Method: dual-agent (A: design review · B: detector; B's browser steps blocked by sign-in on the dev server, runtime evidence from test/e2e/motion.spec.ts instead)

Target: #140 motion and delight across library, Book panel and graph.

| # | Heuristic | Score |
|---|---|---|
| 1 | Visibility of system status | 3 |
| 2 | Match with real world | 4 |
| 3 | User control & freedom | 3 |
| 4 | Consistency & standards | 3 |
| 5 | Error prevention | n/a |
| 6 | Recognition over recall | 3 |
| 7 | Flexibility & efficiency | 3 |
| 8 | Aesthetic & minimalist | 4 |
| 9 | Error recovery | n/a |
| 10 | Help & docs | n/a |
| Total | | 23/28 |

Specificity: authored (ink-in, write-in, canvas colour blend, FLIP between shelves). Detector: 1 advisory, pre-existing (graph-workspace.tsx 1.75rem wordmark).

Priority issues (all addressed in polish):
- [P1] Pre-existing arrival motion over the brief (900/700ms, 5s arrivals) -> compressed to 400/300ms, steps 600/500ms; draw-in, sheet-up, wash fade 300ms.
- [P2] Interrupted selection fade snapped back -> a change mid-fade switches at once.
- [P2] First-Connection flag spent before seen; read as status -> counted after 1.5s up; ink with accent full stop; role=status.
- [P3] Long row moves swoosh -> beyond 400px the row fades in place.
- [P3] write-in clipped the keyboard outline; refetch cut it short -> clip on inner span; writing set accumulates.

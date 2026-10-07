---
target: graph view Follow trail
total_score: 24
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/graph/graph-workspace.tsx"
target_fingerprint: "sha256:d3caea89a5e7aab83d9b390c18e8f57884d55415807082bd98a254beb1bf7335"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/graph/graph-workspace.tsx
timestamp: 2026-10-07T00-14-47Z
slug: src-app-graph-graph-workspace-tsx
closed: true
---
# Critique: Follow trail (graph view), 24/36 (9 scored; #9 n/a)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility | 3 | Crumbs clear; canvas path hard to tell from current Book's neighbours |
| 2 | Real world | 3 | "Clear" doesn't say what it clears |
| 3 | Control | 2 | Escape/Back drop the whole walk; no one-step back |
| 4 | Consistency | 2 | Trail +width collides with strength encoding |
| 5 | Error prevention | 3 | Rewind-on-revisit silent |
| 6 | Recognition | 3 | Crumb labels match canvas |
| 7 | Flexibility | 2 | Connection-panel follow loses origin |
| 8 | Minimalism | 3 | Long trails wrap 3 lines |
| 9 | Error recovery | n/a | Nothing in the feature fails visibly |
| 10 | Help | 3 | Underline only cue |

Priority issues:
1. [P1] Trail emphasis uses width (= strength). Fix: ink casing under trail edges + rings on trail Books. /impeccable clarify
2. [P1] Long trails crowd the header. Fix: collapse middle crumbs past 4 into an expandable "…"; keep chevron with following crumb. /impeccable distill
3. [P2] Crumb/Clear targets 18.7px (< 24px WCAG 2.5.8). /impeccable polish
4. [P2] Following from Connection panel drops origin. Fix: seed trail with the other Book. /impeccable clarify
5. [P3] Follow affordance faint on hover. Fix: title darkens to ink on hover. /impeccable polish

Persona flags: Sam — Clear inside the trail <ol>, rewind not announced. Alex — no step-back key. Evening reader — Escape erases the walk.
Detector: trail code clean; pre-existing cream-palette / clipped-overflow / thin-border-wide-shadow false positives; book-panel.tsx:199 font-size advisory (unrelated).

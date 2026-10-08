---
target: label and Cluster-name placement on /graph
total_score: 17
max_score: 28
na_heuristics: 5,9,10
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/graph/graph-canvas.tsx"
target_fingerprint: "sha256:4d087ebb5d692639775d4d028591e61b7287865a48486cda2911064b1a1f7494"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/graph/graph-canvas.tsx
timestamp: 2026-10-08T09-44-31Z
slug: src-app-graph-graph-canvas-tsx
closed: true
---
# Critique: Book label and Cluster-name placement, /graph (13 and 300 Books)

Method: dual-agent (A design review, B detector + browser evidence).

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | Pointed Book in a crowd has no stronger plate |
| 2 | Match real world | 3 | Edge-held names side by side read as one phrase |
| 3 | User control | 3 | Labels run under wordmark, nav, legend |
| 4 | Consistency | 2 | Faded name loses plate, faded label keeps it |
| 5 | Error prevention | n/a | |
| 6 | Recognition | 2 | Hubs unlabelled at 300; outer ring labelled |
| 7 | Flexibility | 2 | Zoom is the only lever |
| 8 | Aesthetic | 2 | 300: labels hang off the ring, names on dense ink |
| 9 | Error recovery | n/a | |
| 10 | Help | n/a | |
| Total | | 17/28 | Acceptable |

Detector: 0 CLI findings; browser `cream-palette` only (false positive). No name/name, name/chrome overlaps measured. Name 8.5:1 on plate; faded name 2.3:1 without plate.

## Priority issues
1. [P1] Chosen Book/Cluster neighbours unlabelled: faded dots and faded names take the room. Fix: lit dots only as obstacles while something is chosen; faded names yield to lit labels. (polish)
2. [P1] Labels ignore page chrome (nav, legend, panel). Fix: chrome boxes as obstacles. (harden)
3. [P2] Free space, not priority, decides labels at 300: hubs unlabelled. Fix: top few priority labels may cover other Books' dots. (shape)
4. [P2] Names held side by side read as one phrase. Fix: a line's gap between names. (polish)
5. [P3] Truncation mid-word. Fix: labelOf cuts at a word. (clarify)

## Persona red flags
Alex: zoom only lever. Sam: faded name 2.3:1, no plate. Reflective reader: hover-hunting unnamed neighbours at 300.

## Minor
No off-screen hint for Clusters; chosen name plate barely distinct; dots draw under nav text.

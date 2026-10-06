---
target: graph view
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/graph/graph-workspace.tsx"
target_fingerprint: "sha256:b072a2d1fc6f5b619431b0c9ef3201daedeb8083bd5879c9e1f73e8f2189cd96"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/graph/graph-workspace.tsx
timestamp: 2026-10-06T23-31-59Z
slug: src-app-graph-graph-workspace-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score: 25/40 (Acceptable)
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Edge hover only changes the cursor; truncated labels stay truncated on hover |
| 2 | Match system / real world | 4 | The reader's own language throughout |
| 3 | User control and freedom | 1 | Camera stays shoved aside after closing a panel; no fit/recentre |
| 4 | Consistency and standards | 2 | Book selection recentres, Connection selection doesn't; square vs line type swatches |
| 5 | Error prevention | 3 | Drag cleanly separated from click; always settles home |
| 6 | Recognition rather than recall | 3 | Legend always visible; truncated titles unrecoverable in place |
| 7 | Flexibility and efficiency | 2 | Escape only inside the panel; no keyboard path on the canvas |
| 8 | Aesthetic and minimalist design | 4 | Restrained, full-bleed, good fade state |
| 9 | Error recovery | 3 | Panel errors recover; canvas has no "get me back" |
| 10 | Help and documentation | 2 | Nothing says edges are clickable or Books draggable |

## Design specificity
Authored, not interchangeable (ink on paper, serif haloed labels, the "X and Y" Connection heading). Detector: CLI clean except advisory design-system-font-size (connection-panel.tsx:62, 1.6rem). Browser: cream-palette (waived by DESIGN.md), clipped-overflow-container x2 (false positive: only sr-only children), gpt-thin-border-wide-shadow on the floating panel (judgement call).

## Priority issues
1. [P1] Camera never returns after a selection; nothing recentres it. Fix: restore the pre-selection camera when the selection clears. Command: /impeccable polish
2. [P1] Selecting a Connection doesn't bring it into view (one Book sits under the panel). Fix: centre the edge midpoint offset by the panel inset. Command: /impeccable polish
3. [P1] Keyboard: the sr-only Book list takes Tab focus invisibly (WCAG 2.4.7); focus falls to body on close; Context legend label is 3.95:1 (fails AA). Fix: visible on focus / mirror focus on the canvas node, return focus on close, darken the Context label text. Command: /impeccable audit, /impeccable harden
4. [P2] Labels struck through by edges; truncated titles unrecoverable; selection ring touches the label. Fix: paper plate behind labels, full title for hovered/chosen, offset past the ring. Command: /impeccable polish
5. [P2] A blue focus box appears around the panel title on every mouse selection (unlayered :focus-visible in globals.css beats Tailwind's outline-none; library panel has it too). Fix: move the global focus rule into @layer base. Command: /impeccable polish

## Persona red flags
- Keyboard-only reader: invisible tab stops, focus lost on Escape, no route to Connections.
- First-time reader: nothing says edges are clickable; one select-and-close leaves a displaced graph.
- Reader with ~300 Books: ~1,000 visible edges at rest; label culling will hide most titles; hundreds of hidden tab stops.

## Minor observations
- Book panel Connection titles aren't clickable while the Connection panel's are (following is #32's territory).
- Edge hover has no visual emphasis.
- Header floats with no plate; labels can run under the wordmark.
- 1.6rem heading isn't a DESIGN.md size.

## Questions to consider
- Should closing return the reader to where they were, or to the whole map?
- Should the canvas show which edges quote the reader's Notes?
- At 300 Books, is 7 per Book a place to wander or a hairball?

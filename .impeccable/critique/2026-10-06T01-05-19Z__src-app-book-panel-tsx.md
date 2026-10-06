---
target: Remove from library in the Book panel
total_score: 25
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/book-panel.tsx"
target_fingerprint: "sha256:76aa68567d02039c8bc56df222d08df35b13749f540e74b5692196bbacd3373f"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/book-panel.tsx
timestamp: 2026-10-06T01-05-19Z
slug: src-app-book-panel-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser)
Target: RemoveEntry ("Remove from library") in src/app/book-panel.tsx, plus return-to-search.

Heuristics (8 scored, 7 and 10 n/a): 1 Status 2 · 2 Real world 3 · 3 Control 2 · 4 Consistency 4 · 5 Error prevention 3 · 6 Recognition 4 · 8 Minimalist 4 · 9 Recovery 3 = 25/32.

Specificity: authored, mirrors Note deletion exactly. Detector: CLI clean; browser only cream-palette (waived in DESIGN.md) and line-length on panel prose (not this component).

Priority issues
- [P1] "Yes, remove" renders ink-3, not rust: quietLink's text-ink-3 beats text-contrast in the stylesheet. Same bug in Note deletion. Fix: per-use colour.
- [P1] Focus dropped to body on entering confirm and on Keep; Escape stops working. Fix: focus Keep on confirm; return focus to the trigger on Keep.
- [P2] Copy understates the loss (reading history) and doesn't name the book. Fix: "Remove {title} from your library? Its notes, reading history and Connections go with it."
- [P2] No success confirmation after landing in search. Fix: polite live line in search pane.
- [P3] "Keep" is 31px wide on touch. Fix: horizontal padding.

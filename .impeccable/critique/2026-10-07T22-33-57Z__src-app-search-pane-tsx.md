---
target: "#25 manual add, lookalike, edit"
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/search-pane.tsx"
target_fingerprint: "sha256:58ee95cd8dd24f75bbb5fb80877bd38e27e12415dc9cc3682f9e9117dc73b26b"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/search-pane.tsx
timestamp: 2026-10-07T22-33-57Z
slug: src-app-search-pane-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser)

Target: src/app/search-pane.tsx (Add it by hand, ManualBookForm, LookalikeNote) and EditBookForm in src/app/book-panel.tsx (ticket #25).

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | "Added X" sits above a stale "No match… Add it by hand"; saving an edit announces nothing |
| 2 | Match System / Real World | 3 | "Start a new read-through from there" names an action the Book panel doesn't have |
| 3 | User Control and Freedom | 2 | Typing in search or pressing Escape discards the manual draft silently |
| 4 | Consistency and Standards | 2 | Title/Author inputs serif, cover/search sans; overrides don't reach About/Connections copy |
| 5 | Error Prevention | 3 | Live lookalike check is good; missing field not focused |
| 6 | Recognition Rather Than Recall | 2 | "Clear a field to go back to the original" without showing the original |
| 7 | Flexibility and Efficiency | 3 | Enter adds as Want to read, unstated; whole query lands in Title |
| 8 | Aesthetic and Minimalist Design | 2 | Same 3-line lookalike note repeated on every edition in results |
| 9 | Error Recovery | 3 | Browser "Please enter a URL." bubble pre-empts the authored error |
| 10 | Help and Documentation | 3 | Inline explanations right-sized |
| **Total** | | **26/40** | **Acceptable** |

Design specificity: mostly authored (copy, quiet reveals, reused Status buttons); generic edges are the browser validation bubble, plain stacked form, and caption-weight warning.
Detector: CLI exit 0, 2 advisory design-system-font-size (text-[0.9rem]) at search-pane.tsx:264 (new) and book-panel.tsx:194 (pre-existing). Browser overlay: nothing in the new UI; cream-palette (waived), cramped-padding (wrapper false positive), tight-leading in cover.tsx (pre-existing).

Priority issues
- [P1] Lookalike note promises "start a new read-through from there", but the Book panel has no Read again control. Fix: offer "Read it again" in the note, or add it to the Book panel.
- [P1] EditBookForm renders inside the non-scrolling Book panel header; long titles push it past the viewport and add a page scrollbar. Fix: render it in the scrolling body.
- [P2] Stale no-match block stays after adding by hand. Fix: hide it after add; make the notice title open the new Book.
- [P2] Lookalike note repeats under every edition and reads as caption text. Fix: full note once per lookalike; stronger on-palette treatment.
- [P2] type=url bubble replaces authored error; errors not tied to fields. Fix: noValidate, aria-invalid/aria-describedby, focus first missing field.
- [P3] Typing in search drops the manual draft.

Personas: Jordan (dead-end "from there"; quiet "Add it by hand"), Sam (silent save; errors unlinked; focus lost on Back to search), Casey (pane stacks below library; Cancel wraps).
Minor: serif vs sans inputs; Open Library footer under manual form; "Only you will see it" odd in single-user app; Manual description never shown.

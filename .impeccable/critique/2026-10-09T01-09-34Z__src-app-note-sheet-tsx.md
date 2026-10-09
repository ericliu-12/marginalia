---
target: phone Note sheet
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/note-sheet.tsx"
target_fingerprint: "sha256:1ff2c94526813283b6a0965886c94e6a8bdd8c7da4d3e7704b89007263ff7b02"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/note-sheet.tsx
timestamp: 2026-10-09T01-09-34Z
slug: src-app-note-sheet-tsx
closed: true
---
Method: dual-agent. Score 30/40 (Good). Detector: CLI clean apart from 2 advisories (design-system-font-size, book-panel.tsx:652 text-[1.125rem] in the sheet; :298 out of target). Browser: only cream-palette (waived in DESIGN.md). Contrast is at least 4.92:1 everywhere, and every touch target is at least 46px.

Priority issues:
1. [P1] The saved line never clears, and is set while the shelf is still inert, so it is likely unannounced. Set it after the sheet closes; clear it on the next navigation or after a timeout.
2. [P1] The failure state has two submit buttons; the copy doesn't promise the text is kept; Save is pushed under the fold with the keyboard up. In the sheet, the full-width button becomes "Try again", the copy says the note is kept, and the message is scrolled into view.
3. [P2] A quote-only note is refused late with "Write something first." Use contextual copy.
4. [P2] Revealed quote/page fields can't be removed; the empty Page row looks bare. Add a quiet Remove and a Page placeholder.
5. [P3] The fixed 5-row textarea scrolls inside a scrolling sheet. Use field-sizing: content.

Minor: no exit motion; the draft tag is missing behind a sheet restored by refresh; "New note" is announced twice (form + textbox); 1.125rem is off the ramp; DESIGN.md lacks a Note sheet entry.

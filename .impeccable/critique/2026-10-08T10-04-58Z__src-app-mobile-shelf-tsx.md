---
target: "mobile shelf and Book screen (#39)"
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/mobile-shelf.tsx"
target_fingerprint: "sha256:85bdc242366401c4b09c8b6aebbe0fc1038eaada4e35b9c77cf0ef13eaf808f3"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/mobile-shelf.tsx
timestamp: 2026-10-08T10-04-58Z
slug: src-app-mobile-shelf-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser at 390x844)

## Design specificity
Unmistakably Marginalia on the shelf (Newsreader titles, italic wordmark, paper tones, hairline section headers, one ink primary). The Book screen is the desktop panel transplanted, so the phone's main job competes with Edit, About, Connection upkeep and Remove.

## Heuristics (27/40)
| # | Heuristic | Score |
|---|---|---|
| 1 | Visibility of system status | 3 |
| 2 | Match system / real world | 3 |
| 3 | User control and freedom | 3 |
| 4 | Consistency and standards | 2 |
| 5 | Error prevention | 3 |
| 6 | Recognition rather than recall | 3 |
| 7 | Flexibility and efficiency | 2 |
| 8 | Aesthetic and minimalist | 3 |
| 9 | Error recovery | 3 |
| 10 | Help and documentation | 2 |

## Detector
CLI: 5 advisory design-system-font-size (mobile-shelf 1.5rem, 2rem, 1.1rem; book-panel 0.875rem, 0.9rem pre-existing). Browser: cream-palette only (waived in DESIGN.md). No horizontal overflow at 390px. ink-2 on paper-3 is 5.80:1.

## Priority issues
- [P1] Connection title button is a 25px tap target on the phone (connections.tsx).
- [P1] Back label hard-coded "Back to Reading" for Books opened from Want to read / Read (mobile-shelf.tsx).
- [P1] Returning after a Status move: the Book's row sits in a collapsed section, focus drops to body (mobile-shelf.tsx).
- [P2] "Edit title or author" sits above the Status control on the phone (book-panel.tsx).
- [P2] Finish line defers the payoff to "a larger screen" while Connections also list below (copy dictated by the ticket; kept).
- [P3] Add stand-in is headed "Search" with a lone close (until #40).
- [P3] Note field below About and Connections on the phone (until #41's sheet).

## Minor
Add button gutter px-4 vs content px-5; shelf 20px vs Book screen 24px gutters; placeholder covers clip titles; the Book screen has no h1 inside its aside.

## Questions
Should the first finish on a phone show a real Connection the moment it lands? Does the phone Book screen need About and Remove?

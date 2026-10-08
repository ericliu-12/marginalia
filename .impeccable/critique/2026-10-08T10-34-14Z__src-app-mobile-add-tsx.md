---
target: phone Add a Book screen
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/mobile-add.tsx"
target_fingerprint: "sha256:6a22cf7d74b80ec38a864d46964fd3731bbeaebe125f833d0bbead8f078896cb"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/mobile-add.tsx
timestamp: 2026-10-08T10-34-14Z
slug: src-app-mobile-add-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Adding…, Added line, finding line good; session tally hidden while typing |
| 2 | Match System / Real World | 3 | "N Books finding Connections" unexplained to a first-timer |
| 3 | User Control and Freedom | 3 | Lookalike title leaves Add by replaceState, losing Added so far and its Undos |
| 4 | Consistency and Standards | 3 | "Added" and "In your library" rows look the same; AddedLine placement differs between results and Added so far |
| 5 | Error Prevention | 3 | Enter/Go in the hand-add form silently adds as Want to read |
| 6 | Recognition Rather Than Recall | 3 | Added so far only visible with an empty search |
| 7 | Flexibility and Efficiency | 3 | Selected search is a strong accelerator; Enter blurs the field, risking the keyboard on iOS |
| 8 | Aesthetic and Minimalist Design | 3 | Clean at 375; choices wrap to two lines at 320 |
| 9 | Error Recovery | 3 | Duplicate error leaves the choices live |
| 10 | Help and Documentation | 3 | Good hint; nothing says Already read starts Connections |
| **Total** | | **30/40** | Good |

## Design Specificity
Authored for this product in copy, type split and lookalike/re-read logic; conventional Operate structure, which is right. Detector: CLI 0 findings; browser 1 finding, cream-palette, a false positive (deliberate DESIGN.md palette). Touch targets ≥44px except the "Open Library" credit link (17px tall). ink-3 on paper 4.92:1, on paper-2 5.33:1.

## Priority Issues
1. [P1] Keyboard may not come back on iOS: Enter blurs the search (mobile-add.tsx onKeyDown), and ready() refocuses only after the awaited add, outside the gesture. Fix: focus+select synchronously in the choice and Undo onClick; keep the post-success select; drop the Enter blur.
2. [P1] Opening a lookalike from Add throws away Added so far and every Undo, and back goes to the shelf. Fix: lift the session's added list into MobileShelf so it survives, and push the Book from Add so back returns to Add.
3. [P2] At 320px the choices wrap to two lines. Fix: weight the phone grid by label length and trim padding.
4. [P2] Enter in the hand-add form adds as Want to read. Fix on phone: enterKeyHint next, Enter moves to the next field rather than submitting.
5. [P3] Row states blur: Added and In your library share ink-2; a duplicate leaves choices tappable; the Open Library credit link is 17px tall. Fix: Added text in ink; duplicate turns the row into In your library; pad the credit link.

## Persona Red Flags
- Power user batch-adding 20 read Books: keyboard drop after Enter; tally hidden while typing; Done buries adds in collapsed sections.
- First-timer: "1 Book finding Connections" has no context.
- Screen-reader/keyboard: Escape closes the whole sheet; lookalike link exits with no way back.

## Minor Observations
- In your library rows can't open the Book.
- Search error set entirely in rust serif; Try again wraps alone.
- Prototype's "· Manual Book" tag in Added so far dropped.
- iOS select() may show the selection callout after each add (device check).

## Questions
- Should the last-chosen Status be primed for a batch?
- Should Done carry a quiet receipt of what was added?

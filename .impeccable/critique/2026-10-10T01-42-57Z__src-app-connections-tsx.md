---
target: first-month paused line
total_score: 20
max_score: 32
na_heuristics: 3,7
p0_count: 0
p1_count: 1
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/connections.tsx"
target_fingerprint: "sha256:a2240de49a10f24abaf9722b5b99815078dc8d25eaaab25af187add63734def6"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/connections.tsx
timestamp: 2026-10-10T01-42-57Z
slug: src-app-connections-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + screenshot evidence; no signed-in live server, so no overlay)

Target: FindingIndicator (src/app/connections.tsx), first-month paused line (#66)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Says a limit was hit, not what is waiting |
| 2 | Match system / real world | 2 | "limit" with no object can read as a trial or paywall |
| 3 | User control | n/a | Passive status line |
| 4 | Consistency | 2 | "lifts" vs "resumes"; DESIGN.md documents only the spending-limit variant |
| 5 | Error prevention | 3 | No error styling |
| 6 | Recognition | 3 | Date given inline |
| 7 | Flexibility | n/a | Status line |
| 8 | Aesthetic / minimalist | 4 | One quiet line, no layout cost |
| 9 | Error recovery | 2 | Doesn't say the waiting work catches up on its own |
| 10 | Help | 1 | Nothing explains the allowance |
| Total | | 20/32 | Acceptable |

Specificity: specific to the product (serif italic, ink tertiary, middle dot, the existing slot). Detector: 0 findings across 5 files. Contrast 4.92:1 on paper. Fits on one line at 375px; 320px is untested.

Priority issues:
- [P1] The line doesn't name what is paused (Connections), so a new Reader may think adding Books is blocked. Fix: name Connections. Suggested command: /impeccable clarify.
- [P2] The verb drifts between "lifts" and "resumes"; in the month-spanning case "lifts 1 November" slightly overpromises. Suggested command: /impeccable clarify.
- [P2] DESIGN.md's Quiet line entry lacks the first-month variant. Suggested command: /impeccable document.
- [P3] The finish line and the header word the same pause differently (the owner chose to leave the finish line as is).
- [P3] The UTC day can differ from local by one. Accept.

Personas: Jordan reads it as a trial or paywall. Sam hears the middle dot read aloud, an existing pattern. Casey is at risk of a wrap at 320px.

---
target: sign-in page
total_score: 30
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/sign-in/code-sign-in.tsx"
target_fingerprint: "sha256:1c70281c28e082781a0b2cafb09f8de7fd130243ce057e664e9f50f0be58c010"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/sign-in/code-sign-in.tsx
timestamp: 2026-10-09T06-59-07Z
slug: src-app-sign-in-code-sign-in-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + browser evidence)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Disabled "Sign in" looks enabled |
| 2 | Match with real world | 3 | Conditional reply is right but sounds doubtful |
| 3 | User control & freedom | 3 | Step lost if iOS reloads the app while in Mail |
| 4 | Consistency & standards | 3 | Native validation bubbles break the voice |
| 5 | Error prevention | 3 | Solid: digit stripping, trim/lowercase, cooldown |
| 6 | Recognition over recall | 3 | Code field doesn't say 6 digits |
| 7 | Flexibility & efficiency | 3 | Autofill + auto-submit good |
| 8 | Aesthetic & minimalist | 4 | Spare, on-system |
| 9 | Error recovery | 3 | Error points at a resend link that may be disabled |
| 10 | Help & documentation | 2 | Nothing for "no email arrived" |
| Total | | 30/40 | Good |

Priority issues:
- [P1] Step-2 sentence not announced; code field has no description (aria-describedby).
- [P1] Disabled "Sign in" looks identical to enabled; dead tap at <6 digits.
- [P2] Native browser validation instead of rust copy (noValidate + own messages).
- [P2] iPhone hand-off to Mail: state only in memory; persist step/email/sentAt in sessionStorage.
- [P3] Resend line: action fainter than its countdown; chatty aria-live every second; "Use a different email" crowds the sentence; code field 1.1rem off ramp (detector advisory).

Detector: CLI exit 0, 1 advisory (design-system-font-size, code-sign-in.tsx:180, 1.1rem). Browser: cream-palette on both steps, waived by DESIGN.md.

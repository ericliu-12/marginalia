---
target: "sign-in code form (#65)"
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/sign-in/code-sign-in.tsx"
target_fingerprint: "sha256:c5f0989502309f04c3e321a8ae25c55caf802b7504261366585df5f0b8d69566"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/sign-in/code-sign-in.tsx
timestamp: 2026-10-10T02-39-47Z
slug: src-app-sign-in-code-sign-in-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence)

## Design Health Score: 25/40
1 Status 2 (resend shows "Signing in…" on main button) · 2 Real world 3 · 3 Control 2 (same email after "Use a different email" is refused) · 4 Consistency 2 (refusal marks a correct email invalid) · 5 Prevention 3 · 6 Recognition 3 · 7 Efficiency 3 · 8 Minimalism 4 · 9 Recovery 1 ("Reload the page" impossible in home-screen app) · 10 Help 2

## Design Specificity
Authored for the product; the Turnstile addition is invisible (interaction-only, 0px container). New copy is the generic-sounding part. Detector: CLI clean; overlay only cream-palette (false positive, waived in DESIGN.md).

## Priority Issues
- [P1] A refusal strands a reader who already has a code (same address again after "Use a different email"). Fix: return to the code step for an address this device sent a code to that is still valid, without sending.
- [P1] Turnstile failure tells home-screen-app readers to reload. Fix: "Try again, or continue with Google above", and retry the check on the next send.
- [P1] Resend borrows the Sign in button's pending label. Fix: separate resending state shown in the resend row.
- [P2] Refusal styled as the reader's mistake (aria-invalid, select); "60 minutes" not "an hour". Fix: invalid only for a malformed email; clamp the wait.
- [P3] Two-line alert shifts the button ~21px; widget's 300px minimum overflows on 320px phones.

## Persona red flags
Home-screen-app reader: reload instruction, content-blocker dead end. Invited non-technical reader: "too many" after two tries reads as blocked. Screen-reader user: "invalid entry" on a correct email; resend silent for ~1s.

---
target: Delete your account section
total_score: 30
max_score: 36
na_heuristics: 7
p0_count: 0
p1_count: 1
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/account/page.tsx"
target_fingerprint: "sha256:a010c851f25a4e3ea8424fead75c89602615e8fd0a2f264d70e3edb1d6b69b69"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/account/page.tsx
timestamp: 2026-10-10T08-19-09Z
slug: src-app-account-page-tsx
closed: true
---
Method: dual-agent (A: design review · B: detector + screenshot evidence; no signed-in live server, so no overlay)

Target: Delete your account (#68): src/app/account/page.tsx, delete-account.tsx, sign-in deleted line, privacy wording

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | "Deleting…" not announced |
| 2 | Match real world | 4 | Product nouns; typed delete |
| 3 | User control | 3 | "Sign in again" signs out without saying so |
| 4 | Consistency | 3 | Desktop field 48px vs button 36px |
| 5 | Error prevention | 4 | Typed gate + stale-session gate |
| 6 | Recognition | 3 | "download your export" not a link back |
| 7 | Flexibility | n/a | One-off flow |
| 8 | Aesthetic | 4 | Hairline set-apart, rust used once |
| 9 | Error recovery | 3 | Mid-flow SESSION_EXPIRED drops focus, unannounced |
| 10 | Help | 3 | Re-signup / backups not said here |
| Total | | 30/36 | Good |

Detector: 0 findings in 4 files. Contrast: rust 5.09, ink-2 6.47, ink-3 4.92; disabled border 1.34 (exempt).

Priority issues:
- [P1] Ending: "Your account has been deleted." is a role=alert line 12px above an inviting sign-in form. Fix: role=status, more space, calmer farewell. /impeccable clarify.
- [P2] Export pointer is plain text far below the button. Fix: link "download your export" to #your-data. /impeccable clarify.
- [P2] Copy reads as already done ("are deleted"); stale state hides that it signs out here. Fix: "Deleting your account removes…"; stale line says it signs you out and brings you back. /impeccable clarify.
- [P2] SESSION_EXPIRED mid-flow swaps the form out: focus to body, unannounced; pending unannounced. Fix: focus the Sign in again button on swap; pending text in the status region. /impeccable harden.
- [P3] Desktop field/button height mismatch; disabled button's border invisible. Fix: lg:min-h-9 field height; disabled border contrast/40. /impeccable polish.

Not issues: washed hover = mid-transition capture; solid rust on phone = emulated sticky hover (Tailwind v4 hover is gated on hover:hover).

Persona red flags: leaving Reader can't tell if email can sign up again; iPhone home-screen user isn't warned Sign in again signs them out; screen-reader user hears the deleted notice as an alert.

Questions: offer export inline beside the button? Grace period instead of immediate deletion?

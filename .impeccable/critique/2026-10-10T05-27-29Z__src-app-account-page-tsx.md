---
target: /account page
total_score: 26
max_score: 36
na_heuristics: 5
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/account/page.tsx"
target_fingerprint: "sha256:6c7c5125184da8bd02b7ca76289622a7ab48f3d7b73edea90ddd2f5227315f46"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/account/page.tsx
timestamp: 2026-10-10T05-27-29Z
slug: src-app-account-page-tsx
---
Method: dual-agent (A: design review · B: detector + screenshot evidence; no signed-in live server, so no overlay)

Target: /account page (#67): src/app/account/page.tsx, sign-out.tsx, legal.tsx PaperColumn, reader-link.tsx

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Download export silent; 401/500 fails silently |
| 2 | Match system / real world | 3 | "JSON" in lead sentence |
| 3 | User control | 3 | Back link clear |
| 4 | Consistency | 3 | Two different actions share one button style |
| 5 | Error prevention | n/a | Nothing destructive until #68 |
| 6 | Recognition | 4 | Two labelled actions |
| 7 | Flexibility | 3 | Sections linkable |
| 8 | Aesthetic / minimalist | 3 | 50-word export sentence |
| 9 | Error recovery | 2 | "Couldn't sign out." no next step; failed download unrecoverable |
| 10 | Help | 3 | Footer email |
| Total | | 26/36 | Good |

Specificity: authored for Marginalia (legal-page column, product nouns). Detector: 0 findings in 4 files. Contrast on paper: ink-3 4.92, ink-2 6.47, rust 5.09.

Priority issues:
- [P1] Download export has no feedback or failure path (bare <a download>; 401 on expired session; iOS standalone untested). Fix: client fetch + "Preparing export…", blob save, rust failure + Try again, 401 to sign-in. /impeccable harden.
- [P1] Download export and Sign out are identical outlined buttons. Fix: Sign out as quiet text link. /impeccable distill.
- [P2] Export copy heavy, silent on what's excluded. Fix: lead + Ruled list; note covers/descriptions/summaries excluded. /impeccable clarify.
- [P2] "Couldn't sign out." dead end; role=status region display:none while empty. Fix: next step in copy, keep region in layout. /impeccable clarify.
- [P3] Phone footer gap uneven (min-w-11 on short links); pre-existing on legal pages.

Persona red flags: leaving privacy-minded Reader can't tell export completeness or that it saved; home-screen-app user's riskiest flow is the download.

Questions: readable Markdown of Notes alongside JSON? Export as first step of #68 deletion?

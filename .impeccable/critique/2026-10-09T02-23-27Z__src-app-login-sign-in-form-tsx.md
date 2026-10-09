---
target: sign-in screen and paused quiet line
total_score: 28
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 1
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/login/sign-in-form.tsx"
target_fingerprint: "sha256:133553bc02dcd60491154ca77bcf89f660da5fbc35690cf129dfe92e0099edc0"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/login/sign-in-form.tsx
timestamp: 2026-10-09T02-23-27Z
slug: src-app-login-sign-in-form-tsx
---
Method: dual-agent (A: design review · B: detector + browser)

Heuristics: 1:3 2:2 3:3 4:3 5:3 6:4 7:3 8:4 9:3 10:n/a (single-owner gate) = 28/36.
Detector: CLI clean; browser overlay flagged only cream-palette (deliberate, DESIGN.md). Contrast: paused line 4.92:1, sign-in error 5.09:1, input 16.15px.

Priority issues
- [P1] Paused line names the cause, not the effect; the Finish line still says "Connections are being found" while paused. (Open: copy was chosen by the user; asked.)
- [P2] Paused line wrapped to two lines beside the wordmark on the phone shelf. (Fixed: drops under the wordmark whole.)
- [P2] On phone Add the paused line sits under the search field and may read as search paused. (Open.)
- [P2] Field rest border (rule on paper) is 1.34:1, below 3:1 non-text contrast; affects every `field`. (Open: design-token change.)
- [P3] Pending "Opening…" button faded to 60% and looked disabled. (Fixed: only the unconfigured state fades.)
Minor: unconfigured message now names APP_PASSWORD/SESSION_SECRET (fixed); no favicon/apple-touch-icon/manifest, no viewport-fit=cover so safe-area insets resolve to 0 (pre-existing, app-wide).

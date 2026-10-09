---
target: sign-in page with Continue with Google
total_score: 30
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/sign-in/code-sign-in.tsx"
target_fingerprint: "sha256:5b0d5b5acdee08f9b5f11dd8a8e5b525ffe5c7e9f50ae840a92ad00a4710c5a8"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/sign-in/code-sign-in.tsx
timestamp: 2026-10-09T10-04-55Z
slug: src-app-sign-in-code-sign-in-tsx
---
Method: dual-agent. Score 30/36 (h10 n/a).
P1 failure line not announced at load (role=alert in initial HTML; focus on Email). Fix: set message after mount.
P1 "Opening Google…" stuck after sheet dismissed (bfcache). Fix: reset on pageshow.
P2 bg-paper-raised / bg-paper-sunk aren't tokens (paper-2 / paper-3); button fill transparent, hover dead.
P2 Error persists after moving to email; ?error= survives reload. Fix: clear on send, drop param.
P3 Pending Google button doesn't look disabled.
Detector: clean; cream-palette false positive (brand paper). Contrast: rust 5.09, or-label 4.92, border 3.23.
Personas: screen-reader user misses failure; PWA user stuck button; invited friend with two Google accounts.

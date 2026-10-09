---
target: Sign in / Sign out link
total_score: 25
max_score: 32
na_heuristics: 7,10
p0_count: 0
p1_count: 1
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/reader-link.tsx"
target_fingerprint: "sha256:3b79392f34d4173ddb25f4dc9259d4e9b91f4e6a01f6350e487e5f69427bee8d"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/reader-link.tsx
timestamp: 2026-10-09T10-31-59Z
slug: src-app-reader-link-tsx
---
Method: dual-agent. Score 25/32 (h7, h10 n/a).
P1 Failed sign-out is silent. Fix: "Couldn't sign out." status + "Try again".
P2 No pending label. Fix: "Signing out…".
P2 Reads as a third nav tab on desktop, splits Quiet line from views; on phone a long Quiet line can carry it to row 2. Fix: far end of header; keep it on the wordmark's row.
P3 No sign-out guard (skipped by owner: temporary until #67).
Detector: clean in all four files; cream-palette false positive; graph Cluster labels 2.3:1 pre-existing.

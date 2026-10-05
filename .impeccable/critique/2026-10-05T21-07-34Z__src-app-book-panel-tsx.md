---
target: Book panel
total_score: 19
max_score: 32
na_heuristics: 5,10
p0_count: 0
p1_count: 2
target_identity: "file:/Users/ericliu/Documents/projects/marginalia/src/app/book-panel.tsx"
target_fingerprint: "sha256:2656a90589db3effd8ea2ed84a15e3f3daddb2da6a5cd947bbaafe77235d9c24"
target_path: /Users/ericliu/Documents/projects/marginalia/src/app/book-panel.tsx
timestamp: 2026-10-05T21-07-34Z
slug: src-app-book-panel-tsx
---
Method: dual-agent (A: design review · B: detector + browser evidence)

Design Health Score: 19/32 (heuristics 5 and 10 n/a: read-only surface; no help surface). Rating: fair, honest.
Deterministic scan: 0 findings (impeccable detect, src/app). All measured text contrast passes (lowest: header indicator 4.92:1).

Priority issues
- [P1] Hierarchy inverted: type/strength metadata sits between the Book title and the explanation. Fix: title, explanation, then one quiet meta line.
- [P2] "Not drawn from your notes" is 12.75px ink-3 italic on its own line, the weakest text on the surface. Fix: fold into the meta line at ink-2.
- [P2] Failed state hidden when the Book has Connections from another Book's run (browser evidence, The Stranger). Fix: show the failure line whenever status is failed.
- [P1, out of scope] Titles are not links: "Follow this Connection" is #32.
- [P3, out of scope] No retry on the failed state: #28.

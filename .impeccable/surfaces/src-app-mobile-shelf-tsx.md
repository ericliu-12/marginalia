---
version: 1
slug: "src-app-mobile-shelf-tsx"
primary_target: "src/app/mobile-shelf.tsx"
related_targets: []
---

# Phone shelf and Book screen

**Mode:** Operate, one-handed, short sessions.

**Reference:** `docs/design/reference/phone-library.html` (#97, #136).

## Direction
- 20px gutter. Italic 24px wordmark with "account" in small caps on one row. The full-width Shelf / Graph segmented switch (1px ink border, current segment filled ink) waits for the phone's graph (#136 decision).
- The same three numbered sections as desktop, at phone sizes: 20px italic Reading titles, 17px rows, Read rows with the Cluster dot and date.
- No covers in rows. Read shows its latest 8, Want to read too once longer than 8; "and N more" shows the rest, remembered per shelf on the device. Reading shows everything.
- "Add a Book" pinned full width at the bottom (48px, ink, italic) over a hairline.
- The Book screen is the Book panel at full width.

## Constraints
44px targets, safe-area insets, the existing Note pen on Reading rows. Cross-fade between Shelf and Graph, no slide.

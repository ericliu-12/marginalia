---
version: 1
slug: "src-app-library-workspace-tsx"
primary_target: "src/app/library-workspace.tsx"
related_targets: ["src/app/library-list.tsx","src/app/book-panel.tsx","src/app/connections.tsx"]
---

# Desktop library and Book panel

**Mode:** Operate. The reader files Books, opens one, reads its Notes and Connections.

**Reference:** `docs/design/reference/desktop-library.html` (#97, #136).

## Direction
- Header: italic 30px wordmark; small-caps nav "library · graph" (current in ink with an accent underline); a solid italic "Add a Book"; "account" in small caps at the far end.
- Left column: "i. reading" as a two-column block (22px italic title, small-caps author, a red "Draft note" line when one is waiting). "ii. want to read" and "iii. read · N" as hairline rows; Read rows lead with the Cluster dot and end with the finished date. "and N more" in italic ink secondary.
- Selected row: selected ground, 2px accent left edge.
- Book panel on the right behind a hairline: 30px italic title, small-caps "author · finished 3 october", Cluster name in its darker tint, then accent small-caps "notes" (numbered sidenotes, "Write a Note" in accent italic) and "connections" (type label, italic Book, reason).
- No covers in rows; one larger cover at the top of the Book panel. Read shows its latest 8, Want to read too once longer than 8; "and N more" shows the rest, remembered per shelf on the device.
- Empty library: "Your shelves are waiting."

## Memorable moment
A Book slides from "i. reading" into "iii. read" and the count ticks up (#140).

## Constraints
Row actions keep the existing hover/focus reveal. 44px targets on touch. AA contrast.

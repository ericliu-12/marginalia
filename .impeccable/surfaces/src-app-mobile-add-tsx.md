---
version: 1
slug: "src-app-mobile-add-tsx"
primary_target: "src/app/mobile-add.tsx"
related_targets: ["src/app/search-pane.tsx"]
---

# Add a Book (phone screen and desktop search pane)

**Mode:** Operate. Find a Book, add it with one tap, keep going.

**Reference:** `docs/design/reference/phone-add-book.html` (#97, #137).

## Direction
- Header: quiet "Cancel", small-caps "add a book", accent "Done".
- Search: small-caps "title or author" label, 19px serif query, 1.5px ink underline, no box.
- Results: cover, italic title, small-caps "author · year", hairline rows.
- The chosen result expands in place on the selected ground with a 2px accent edge: a small-caps "add to" legend and three choice buttons, Want to read / Reading / Read (named as the shelf names them).
- "Can’t find it? Add it by hand" at the bottom.
- Desktop: the same language in the right-hand pane.

## Constraints
Keep every existing behaviour: Undo, Added so far, lookalikes, focus kept in search with text selected, Escape order.

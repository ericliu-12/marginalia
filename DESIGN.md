---
name: Marginalia
description: A private reading room: warm paper, dark ink, serif voice.
colors:
  paper: "#f3ecdd"
  paper-raised: "#faf5ea"
  paper-sunk: "#e9e0cd"
  ink: "#231d17"
  ink-secondary: "#5d5245"
  ink-tertiary: "#6f6454"
  rule: "#d8cdb7"
  edge: "#8f816c"
  thematic: "#3e5f8a"
  contrast: "#a8432f"
  context: "#6f7a3a"
typography:
  wordmark:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.01em"
  shelf-title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 500
    lineHeight: 1.25
  heading:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.35rem"
    fontWeight: 500
    lineHeight: 1.2
  body:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.5
  input:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
  cover-title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.15
  label:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 500
rounded:
  sm: "2px"
  md: "3px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 10px"
  button-quiet-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: Marginalia

## Overview

A private, contemplative reading room. Warm paper, dark ink, a serif voice with a quiet sans for small functional text. The cream palette is deliberate: it is the chosen visual world ("warm paper and ink"), not a default, and the detector's cream-palette rule is waived for it. The interface should feel like a well-kept notebook, never a dashboard: no counters-as-pressure, no streaks, no badges.

## Colors

- **Paper** (`#f3ecdd`) is the page. **Paper raised** (`#faf5ea`) is a surface lifted from it (the search pane). **Paper sunk** (`#e9e0cd`) is a pressed or placeholder surface (cover placeholders, hover wash).
- **Ink** (`#231d17`) is text and the primary action fill. **Ink secondary** and **tertiary** carry authors, counts and captions. Ink tertiary is only for text on paper or paper raised (it falls below 4.5:1 on paper sunk).
- **Rule** (`#d8cdb7`) is the hairline for dividers and pane edges.
- **Edge** (`#8f816c`) is a field's border at rest, 3.2:1 on paper and 3.5:1 on paper raised, so an empty input is findable before it is focused. Hairlines stay in rule; the Note sheet's fields stay boxless.
- **Thematic** (blue), **Contrast** (rust) and **Context** (olive) are the three Connection Type hues, reserved for graph and Connection UI. Outside it, thematic is the focus ring, contrast is the error text and caret, context is the "added" check.
- **Cluster washes** are six pale tints (`#c4ae82`, `#d0a1bb`, `#81bfb6`, `#d6a492`, `#b0abd8`, `#d1a888`), equal in OKLCH lightness and chroma and kept apart from the three Connection Type hues, so no Connection's line sinks into a wash. A Cluster is given its tint when it forms and keeps it for as long as it keeps its identity. They appear only on the graph, as soft pools behind a Cluster's Books, never over text.
- **Cluster name ink** (`#4a4137`, between ink and ink secondary) holds 4.5:1 even where two washes overlap.

## Typography

Newsreader carries the wordmark (italic), headings, titles and empty-state voice. Hanken Grotesk carries authors, metadata, buttons and inputs: anything the reader operates or scans rather than reads. Sentence case everywhere; no eyebrows or kickers.

## Layout

Operate-mode two-pane desktop layout. The library fills the left, left-aligned to the wordmark, content capped at 42rem. The search pane is 27rem on the right, separated by a 1px rule, and collapses fully; "Add a book" in the header reopens it. Library rows are cover (44x66) plus title and author, separated by faint rules, never boxed.

Below 1024px, where the graph does not fit, the library is the phone's shelf: one column capped at 40rem, no Graph link. The Reading shelf is home under a 2rem serif "Reading" title. Want to read and Read sit below as collapsed sections, and "Add a Book" is pinned to the bottom edge over a paper fade. A whole row is the tap target: cover, title and author, and a chevron. A row opens the Book screen (`/?book=<id>`, so the back gesture returns to the shelf), which is the Book panel at full width, on paper rather than raised paper.

## Elevation & Depth

Flat. Depth comes from the paper tones (raised, sunk) and hairline rules. Covers carry a small soft shadow (`0 1px 2px rgb(35 29 23 / .25)`) so they read as objects.

One deliberate exception: an element floating over the graph canvas (the Book, Connection and Cluster panels) has no page edge or rule to separate it from what is behind, so it carries a soft lifted shadow (`0 12px 32px -8px rgb(35 29 23 / .18), 0 2px 6px rgb(35 29 23 / .06)`) with its hairline border. Nothing docked or in the page flow does.

## Shapes

Near-square: 2px for covers, 3px for buttons and inputs. No pills, no circles.

## Components

- **Primary button:** ink fill, paper text. One per surface ("Add a book").
- **Quiet button:** 1px ink outline, fills with ink on hover. Used for the one-click Want to read / Reading / Already read choices in the search pane.
- **Row actions:** the per-row Status moves in the library (Start reading, Mark finished, Want to read, Read again). On touch devices they stay visible as quiet buttons with 44px targets. On pointer devices they rest as invisible, quiet text links in ink tertiary (underlined, hairline underline), revealed on row hover or keyboard focus within the row; hovering a link darkens it to ink. Rows stay titles-first: actions never compete with the title at rest.
- **Status control:** the Book screen's three-way Want to read / Reading / Read. It is a paper-sunk track with the chosen segment raised on paper raised with the cover shadow, at 3px and 2px corners and 44px targets. The selection moves at once.
- **Add screen:** the phone's Add a Book (`/?add`, so back closes it), rising full screen over the shelf on paper: a serif "Add a Book" with a quiet "Done", the search, and the quiet "N Books finding Connections" line under it. Each result's three quiet choices share the full width under the Book in one row of 44px targets. One tap adds; the choices give way to "✓ Added · Reading" with an Undo, and the search keeps focus with its text selected, so the next title is typed over it. A Book already in the library reads "✓ In your library · Want to read" with a quiet Open; "Added" is set in ink so this visit's adds stand apart. An empty search lists "Added so far", each with its Undo (a hand-added one tagged "Manual Book"), until Done. A Book opened from Add (a lookalike, or Open) is a new screen whose back returns to Add as it was, showing what was done there (a new Status; a removed Book gone from Added so far). Escape clears a search before it closes Add, and closing opens the shelf sections that were added to.
- **Sign-in:** `/login`, the private deploy's gate. A narrow column set high on the paper: the italic wordmark, a "Password" label, one field and a full-width ink "Open" ("Opening…" while it checks). A wrong password reads "That’s not the password." in rust, with the text kept and selected; too many reads "Too many tries. Try again in N minutes." No card, no forgotten-password link.
- **Quiet line:** serif italic in ink tertiary beside the wordmark (under the search on the phone's Add): "N Books finding Connections" while any are. While background work is paused at the month's spending limit it says "Spending limit reached · resumes 1 November" instead, calmly, with no warning colour, and clears itself when the month turns. On the phone's shelf, a line too long for the wordmark's row drops under it whole.
- **Finish line:** the one moment on the phone. The first time a Book becomes Read, a paper-sunk block rises in under the Status control: "**Finished.** Connections are being found; they'll gather below, and in the graph on a larger screen." A later Read-through never shows it. While background work is paused at the spending limit it reads "**Finished.** Connections paused until 1 November; then they’ll gather below, and in the graph on a larger screen."
- **Note sheet:** the phone's Note on one Book (`/?note=<id>`, so back closes it). The pen on a Reading row opens it; a Reading row carries the pen where other rows have the chevron. It rises over a soft ink shade on paper raised, 3px top corners, a hairline top edge and the lifted shadow turned upward, and goes back down the same way when closed or saved. Its bottom edge follows the visual viewport, so it rides on top of the on-screen keyboard, and the tap that opens it focuses the text, so the keyboard comes up at once. "Note on *Title*" with a quiet Close heads it; then the Note's text in serif body size with no field box, growing as it is written; "Add a quote" and "Add a page" reveal hairline-ruled rows, each with a quiet Remove; and a full-width ink "Save note". Saving lowers the sheet and says "Note saved on *Title*" with Open, quietly above Add a Book, until the next move or a few seconds pass. A failed or hung save keeps everything: "Couldn't save. Your note is kept here." and the button reads Try again. The draft is per Book, shared with the Book screen's form, survives closing, back and a refresh, and its row reads "· *Draft note*" in italic tertiary ink.
- **App icon:** the wordmark's italic M in ink, centred on paper; the maskable one smaller, inside the safe zone. Installed, the app opens standalone on paper, and the status bar takes the paper's colour. `scripts/render-icons.mjs` renders them.
- **Cover:** the image, or a typeset placeholder on a paper-sunk tone (title in serif, author in small caps-style sans) when there is no cover or it fails to load.
- **Section header:** serif heading with a hairline below and a quiet count; collapsible sections show a chevron.
- **Cluster name:** italic serif in Cluster name ink on a soft paper plate, centred above or below its wash, whichever crosses fewer Book labels. It is sized with the zoom (13–18px), turns to ink with a hairline underline on hover, and fades with the rest of the graph behind a selection. Choosing it opens the Cluster panel.

## Do's and Don'ts

- Do keep actions one click and let search stay open after adding.
- Do give every state words in the product's voice (empty, no match, unavailable).
- Don't add streaks, goals, ratings, badges or progress counters.
- Don't use side-stripe borders, gradient text, or nested cards.
- Don't hide demoted search results; they stay reachable, just lower.

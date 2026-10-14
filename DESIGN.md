---
name: Marginalia
description: A literary book face: warm ground, near-black ink, one deep red, Newsreader throughout.
colors:
  ground: "#fbf8f1"
  raised: "#fffdf8"
  selected: "#f3ede1"
  ink: "#1a1a1a"
  ink-secondary: "#55504a"
  ink-tertiary: "#6e675d"
  rule-section: "#1a1a1a"
  hairline: "#d9d2c4"
  hairline-soft: "#e3dccd"
  hairline-faint: "#ece6d9"
  edge: "#8a8275"
  accent: "#8c1c13"
  accent-deep: "#5e120c"
  thematic: "#3e5a80"
  contrast: "#9a3b2e"
  context: "#6b7a3a"
  context-text: "#66753a"
typography:
  wordmark:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "30px"
    fontWeight: 400
    lineHeight: 1
  panel-title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "30px"
    fontWeight: 500
    lineHeight: 1.1
  book-title:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.25
  book-title-reading:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.2
  body:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "15px"
    fontWeight: 500
    letterSpacing: "2px"
    fontFeature: "all-small-caps"
  meta:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "14px"
    fontWeight: 400
    letterSpacing: "1px"
    fontFeature: "all-small-caps"
rounded:
  cover: "2px"
  control: "4px"
  surface: "6px"
  sheet: "12px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    padding: "10px 18px"
    height: "44px"
  button-choice:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "44px"
  button-choice-chosen:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
  row-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 2px"
---

# Design System: Marginalia

## Overview

**Creative North Star: "The Literary Book Face"**

Marginalia reads like a well-made book that notices you: a warm ground, near-black ink, one face (Newsreader) carrying everything from the wordmark to the smallest label, and one deep red used the way a printer uses a second colour, sparingly and on purpose. Character comes from typography, not decoration. Titles are italic, authors and labels are letter-spaced small caps, library sections are numbered in lowercase roman, and Notes sit as numbered sidenotes. It stays calm and private: no counters-as-pressure, no streaks, no badges.

The cream ground is the chosen world, not a default; the detector's cream-palette rule is waived for it. Reference mockups live in `docs/design/reference/` (match the look, not the markup).

**Key Characteristics:**
- One typeface, Newsreader with optical sizes, in roman, italic and small caps.
- Ink rules under section labels; hairlines everywhere else; no boxes, no cards.
- One accent, deep red, on under a tenth of any screen.
- Softly rounded corners on what you press and what is lifted; rules stay square. Flat paper, with depth only where something floats over the graph.
- Quiet motion: short, ease-out, never bouncy, never blocking.

## Colors

A printer's palette: ink on warm paper, three muted Connection hues, and a single red.

### Primary
- **Book Red** (accent, hover accent-deep): the one accent. It marks a draft Note's status, Note numerals, the current nav item's underline, a selected row's left edge and the "Write a Note" link. Nothing else.

### Neutral
- **Ground** is the page. **Raised** is a surface lifted from it (the desktop search pane, the Note sheet). **Selected** is a chosen row, a pressed control's track and a cover placeholder.
- **Ink** is text, section rules and the primary action fill. **Ink secondary** carries authors, dates, captions and the inactive nav. **Ink tertiary** (5:1 on ground, 4.8:1 on selected) is reserved for the quietest text: a count, a hint, the muted label of a Book with no Connections.
- **Hairline**, **hairline soft** and **hairline faint**, from strongest to faintest: a pane's edge (the Book panel's left rule, the graph legend's top rule), a divider inside a panel, and the rule between rows.
- **Edge** is a boxed field's border at rest, 3:1 on every ground, so an empty field can be found before it is focused.

### Connection Types
- **Thematic** (blue), **Contrast** (rust) and **Context** (olive) are the three Connection Type hues: lines on the graph, and the small-caps type label in the Book panel. A line's strength is its thickness, never its colour. Context's text label uses **context-text**, a hair darker than the line, to hold 4.5:1. Outside Connection UI, thematic is the focus ring and contrast is error text and the caret.

### Cluster Tints
- Each Cluster has a muted tint and a darker name colour that holds 4.5:1 on the ground: sage (`#9fb39a` / `#4d6349`), terracotta (`#d3a189` / `#8a4a30`), mauve (`#b9a1b4` / `#6a4c63`), extended to eight in the same family (#138 sets the full table). A Cluster keeps its tint for as long as it keeps its identity. The tint is the Cluster's wash on the graph and a small dot beside each finished Book of that Cluster in the library; the name colour sets its italic name.

**The One Red Rule.** Deep red appears only in its listed roles. If a new element wants it, it is asking for emphasis that typography should give instead.

## Typography

**Font:** Newsreader (Google Fonts, `opsz` axis on, so display sizes draw finer and small sizes sturdier), with Georgia as the fallback.

**Character:** a literary book face. Italic for anything that is a work, small caps for anything that names, files or navigates, roman for what the reader wrote.

### Hierarchy
- **Wordmark** (400 italic, 30px desktop, 24px phone): "Marginalia".
- **Panel title** (500 italic, 30px, 1.1): a Book's title in the Book panel.
- **Reading title** (400 italic, 22px desktop, 20px phone): Books in "i. reading".
- **Book title** (400 italic, 18px desktop, 17px phone): every other row.
- **Body** (400, 17px, 1.5): Notes, Connection reasons, prose. Measure under 70ch.
- **Section label** (500 small caps, 15px desktop / 14px phone, 2px tracking): "i. reading", "ii. want to read", "iii. read · 11", over an ink rule.
- **Panel label** (500 small caps, 13px, 1.8px tracking, accent): "notes", "connections" inside the Book panel.
- **Meta** (400 small caps, 13–14px, 1px tracking, ink secondary): authors, "finished 3 october", nav ("library", "graph", "account" at 16px, 1.4px tracking).
- **Type label** (small caps, 12px, 1.2px tracking, in the type's hue): "thematic · strong".

**The Small Caps Rule.** Small caps are set with `all-small-caps` on the text as written (the `caps` utility), so "Gabriel García Márquez" and "i. reading" share one cap height; never uppercase the text itself.

**The Italic Title Rule.** A Book's title is always italic, in rows, panels, Connection reasons and sentences ("Note saved on *Stoner*").

## Layout

Operate mode. Desktop (1024px and up): a header row with the wordmark, the small-caps nav, a solid "Add a Book" and "account"; below it, the library sections on the left and the Book panel on the right (up to 460px), separated by a hairline and a 48px gap. Side padding 56px.

The sections stack 28px apart. "i. reading" is a two-column block of titles, each with its author and, for a draft Note, a red status line. "ii. want to read" and "iii. read" are hairline rows: italic title, small-caps author, and for Read a date and a Cluster dot. A long Read section shows its latest Books and "and N more".

Below 1024px the library is the phone's shelf: a 20px gutter, the wordmark and "account" on one row, a full-width Shelf/Graph segmented switch under it, the same three sections, and "Add a Book" pinned full width at the bottom over a hairline. A row opens the Book screen (`/?book=<id>`), which is the Book panel at full width.

## Elevation & Depth

Flat. Depth comes from the ground tones (raised, selected) and from rules. Covers carry a small soft shadow (`0 1px 2px rgb(26 26 26 / .25)`) so they read as objects.

One deliberate exception: an element floating over the graph canvas (the Book, Connection and Cluster panels, and the phone's Note sheet over its shade) has no page edge to separate it from what is behind, so it carries a soft lifted shadow (`0 12px 32px -8px rgb(26 26 26 / .18), 0 2px 6px rgb(26 26 26 / .06)`) with its hairline border.

## Motion

Quiet, short and ease-out: 150–400ms, never bouncy, never blocking input. Motion marks a moment the reader caused (a Note saved, a Book finished, a Connection arriving, a Cluster named, a selection, a view change), never decoration. Under `prefers-reduced-motion` every movement is removed and only a short fade, or nothing, remains.

## Shapes

Gently rounded, never pill-shaped. Three radii, as the `rounded-control`, `rounded-surface` and `rounded-t-sheet` utilities:

- **Control** (4px): buttons, fields, the selected row, the Status control's track, and small surfaces such as the finish line's block.
- **Surface** (6px): larger raised surfaces: the panels floating over the graph, the raised areas of the Book panel, and the chosen result card in Add a Book.
- **Sheet** (12px, top corners only): a bottom sheet rising from the phone's edge (the Note sheet; later the phone graph's sheet).

Covers keep their 2px corner. Rules, dividers, section lines and hairlines stay square. Dots (Books on the graph, Cluster dots in the library) are the only circles.

**The Ruled Edge Rule.** A line is never rounded. Radius belongs to things you press or things that are lifted, never to the rules that structure the page.

## Components

- **Primary button:** ink fill, ground text, italic serif ("Add a Book", "Save note", "Send code"), 44px tall, 4px corners. Hover lifts it to ink secondary. One per surface.
- **Choice buttons:** the Want to read / Reading / Finished choices in Add. Three equal buttons in a row, 44px or taller, 4px corners, ground fill with a hairline border; the chosen one fills with ink.
- **Section label:** lowercase roman numeral and name in small caps over a 1px ink rule ("iii. read · 11"); the count is part of the label, never a badge.
- **Book row:** italic title, small-caps author, and for Read the finished date in ink secondary and a Cluster dot (8px, the Cluster's tint) at the start. A hairline faint rule between rows. Selected, it takes the selected ground with 4px corners and a 2px accent left edge, bleeding 10px past the column.
- **Nav:** small-caps links; the current one is ink with an accent underline 6px below, the others ink secondary. On the phone, a full-width two-segment switch (Shelf / Graph) with a 1px ink border; the current segment fills with ink.
- **Sidenote:** a Note in the Book panel. A narrow 18px column holds its numeral (13px, accent), beside the Note in body text. A quote under it is italic in ink secondary; a page is small-caps meta.
- **Connection entry:** in the Book panel, a small-caps type label in its hue ("thematic · strong", "contrast"), then the other Book in italic, a colon, and the one-line reason in body text.
- **Search field:** no box. A small-caps label above, the query in 19px serif, a 1.5px ink underline (a rule, so square); the focus ring is the thematic outline.
- **Row actions:** the per-row Status moves in the library (Start reading, Mark finished, Want to read, Read again). On touch devices they stay visible as quiet buttons with 44px targets. On pointer devices they rest as invisible, quiet text links in ink tertiary (underlined, hairline underline), revealed on row hover or keyboard focus within the row; hovering a link darkens it to ink. Rows stay titles-first: actions never compete with the title at rest.
- **Status control:** the Book screen's three-way Want to read / Reading / Read. It is a selected track with the chosen segment raised on raised with the cover shadow, at 4px and 2px corners and 44px targets. The selection moves at once.
- **Add screen:** the phone's Add a Book (`/?add`, so back closes it), rising full screen over the shelf on the ground: a small-caps "add a book" between a quiet "Cancel" and an accent "Done", the search, and the quiet "N Books finding Connections" line under it. The chosen result expands in place on the selected ground with an accent edge, showing three choice buttons (Want to read / Reading / Finished) across the full width; "Can’t find it? Add it by hand" sits at the bottom. One tap adds; the choices give way to "✓ Added · Reading" with an Undo, and the search keeps focus with its text selected, so the next title is typed over it. A Book already in the library reads "✓ In your library · Want to read" with a quiet Open; "Added" is set in ink so this visit's adds stand apart. An empty search lists "Added so far", each with its Undo (a hand-added one tagged "Manual Book"), until Done. A Book opened from Add (a lookalike, or Open) is a new screen whose back returns to Add as it was, showing what was done there (a new Status; a removed Book gone from Added so far). Escape clears a search before it closes Add, and closing opens the shelf sections that were added to.
- **Sign-in with an email code:** `/sign-in` (#60), where every signed-out page goes (#69). A narrow column set high on the paper under the italic wordmark, with no card. Step 1 opens with "Continue with Google" (#63): Google's own multicolour G, unaltered, on a full-width paper-raised button with an edge hairline ("Opening Google…"; Google always asks which account), then a hairline "or" rule in tertiary small caps. A Google sign-in that fails, for any reason, comes back to one rust line above the button, "That didn’t sign you in. Try again, or sign in with an email code below.", the same whatever the email; it is announced once and leaves the address. Then "Email" and a full-width ink "Send code" ("Sending…"). Step 2 swaps in place: a serif line in ink secondary, "If *email* can sign in here, a code is on its way. It lasts 5 minutes." (the same reply whatever the email, so it never reveals who may sign in; with signup open, where every email is sent one, "A code is on its way to *email*. It lasts 5 minutes."), a quiet "Use a different email", a "6-digit code" field that fills from the keyboard's suggestion and signs in by itself at six digits, and "Sign in" ("Signing in…"). Under it, in small tertiary small caps, "No email? Check spam, or send a new code." and then "Send a new code", which rests for a minute after each send as "You can send a new code in 42s". Every problem is one rust line in the product's voice, never a browser bubble: "Enter your email.", "The code is 6 digits.", "That code didn’t work. Check it, or send a new one." (or "wait to send a new one" while resend rests). When no code could be sent (Resend refused or was unreachable, #70), "Couldn’t send a code just now. Continue with Google instead, or try again later." and the form stays at the email. The email and send time, never the code, survive a reload for 5 minutes, so the home-screen app comes back to the code after a trip to Mail.
- **Account link:** at the far end of the wordmark's row (library and graph headers, the phone's shelf), a quiet "Account" link to `/account`, the home-screen app's only way to sign out.
- **Account page:** `/account` (#67), in the Privacy and Terms column: the wordmark with "Back to Marginalia", a serif "Account", and "Signed in as *email*" in small tertiary small caps. Then sections under serif headings. "Your data": one lead line, a hairline-ruled list of what the file holds (Library, Notes, Books added by hand, Connections), a small tertiary line on what it leaves out, and the page's one quiet button, "Download export" ("Preparing export…"; a failure reads "Couldn’t prepare your export. Check your connection and try again." in rust and the button becomes "Try again"). It saves `marginalia-export-YYYY-MM-DD.json`; in the home-screen app it opens the share sheet instead (Save to Files), as "Save export" if the sheet needs a second tap. "Sign out" is a quiet link ("Signing out…"; a failure reads "Couldn’t sign out. Check your connection and try again." and the link becomes "Try again"). Last, set apart under a hairline, "Delete your account" (#68): one paragraph naming what goes and that it can’t be undone, its "download your export" a link back to Your data, and that coming back later starts an empty library; then "Type delete to confirm" (a short field) beside a rust hairline "Delete account", resting with a faint rust border and tertiary text until the word is typed, filling with rust on hover ("Deleting…"; a failure is one rust line and the button becomes "Try again"). A session signed in more than a day ago shows, in place of the field, "To delete your account, sign in again first…" with a quiet "Sign in again" that signs out and returns to the section. Afterwards sign-in opens with "Your account has been deleted." in serif ink secondary, once. A hairline footer links Privacy, Terms and the email.
- **Privacy and Terms:** `/privacy` and `/terms` (#62), public. One serif column of 36rem set high on the ground: the italic wordmark with a quiet "Back to Marginalia" at the row's far end, a 2rem serif title, "Updated …" in small tertiary small caps, then short sections under serif headings, each with an id to link to (`/privacy#services`); a heading is a link to its own section, taking a rule-coloured underline on hover and when it is the linked-to section. The services are a hairline-ruled list, the name in small caps beside one serif sentence in ink secondary (stacked on the phone). A hairline footer links the other page and the email. The Reader sign-in page carries quiet "Privacy" and "Terms" links under its form.
- **Quiet line:** serif italic in ink tertiary beside the wordmark (under the search on the phone's Add): "N Books finding Connections" while any are. While background work is paused at the month's spending limit it says "Spending limit reached · resumes 1 November" instead, calmly, with no warning colour, and clears itself when the month turns. A Reader in their first 30 days who reaches their own first-month limit sees "First-month limit · Connections back 30 October" (30 days after they signed up, or the 1st if sooner), naming the limit as the first month's so it reads as expected, and naming Connections so it can't read as a block on adding Books. Only that Reader sees it. The finish line keeps its plain "Connections paused until…". On the phone's shelf, a line too long for the wordmark's row drops under it whole.
- **Finish line:** the one moment on the phone. The first time a Book becomes Read, a selected block rises in under the Status control: "**Finished.** Connections are being found; they'll gather below, and in the graph on a larger screen." A later Read-through never shows it. While background work is paused at the spending limit it reads "**Finished.** Connections paused until 1 November; then they’ll gather below, and in the graph on a larger screen."
- **Note sheet:** the phone's Note on one Book (`/?note=<id>`, so back closes it). The pen on a Reading row opens it; a Reading row carries the pen where other rows have the chevron. It rises over a soft ink shade on raised, 12px top corners, a hairline top edge and the lifted shadow turned upward, and goes back down the same way when closed or saved. Its bottom edge follows the visual viewport, so it rides on top of the on-screen keyboard, and the tap that opens it focuses the text, so the keyboard comes up at once. "Note on *Title*" with a quiet Close heads it; then the Note's text in serif body size with no field box, growing as it is written; "Add a quote" and "Add a page" reveal hairline-ruled rows, each with a quiet Remove; and a full-width ink "Save note". Saving lowers the sheet and says "Note saved on *Title*" with Open, quietly above Add a Book, until the next move or a few seconds pass. A failed or hung save keeps everything: "Couldn't save. Your note is kept here." and the button reads Try again. The draft is per Book, shared with the Book screen's form, survives closing, back and a refresh, and its row reads "· *Draft note*" in italic tertiary ink.
- **App icon:** the wordmark's italic M in ink, centred on paper; the maskable one smaller, inside the safe zone. Installed, the app opens standalone on paper, and the status bar takes the paper's colour. `scripts/render-icons.mjs` renders them.
- **Cover:** the image, or a typeset placeholder on a selected tone (title in serif, author in small caps) when there is no cover or it fails to load.
- **Cluster name:** italic serif in its Cluster's name colour on a soft ground plate, centred above or below its wash, whichever crosses fewer Book labels. It is sized with the zoom (13–18px), takes a hairline underline on hover, and fades with the rest of the graph behind a selection. Choosing it, or the wash itself, opens the Cluster panel.
- **Cluster wash:** one continuous soft shape per Cluster: a thick, round-capped stroke along its internal Connections plus a disc for each Book, blurred, in the Cluster's tint. Books are ink dots; a Book with no Connections is a hollow dot with a muted italic label.
- **Graph legend:** a footer under a hairline: a short bar of each type hue beside its small-caps name, and on the right, in italic, "Thicker lines are stronger Connections."

## Do's and Don'ts

- Do keep actions one click and let search stay open after adding.
- Do give every state words in the product's voice (empty, no match, unavailable).
- Don't add streaks, goals, ratings, badges or progress counters.
- Don't use side-stripe borders (the selected row's 2px accent edge is the one exception), gradient text, or cards.
- Don't hide demoted search results; they stay reachable, just lower.

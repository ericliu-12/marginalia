# Marginalia

A private, contemplative web app where a reader keeps a personal library, captures notes while reading, and sees their reading as a connected body of thought.

## Language

**Book**:
A single work, independent of any reader. Editions (hardcover, paperback, translation printings) are ignored.
_Avoid_: Edition, title, volume

**Library Entry**:
A reader's relationship to a Book: its Status and its Read-throughs. Notes attach here, not to the Book.
_Avoid_: Shelf item, reading record

**Status**:
Where a Book stands in a reader's life: want to read, reading, or read.
_Avoid_: Shelf, list, state

**Read-through**:
One pass through a Book by a reader, with an optional start date and finish date. A Library Entry has one per time the Book was read, and an open one while the Book is being read.
_Avoid_: Reading, read, session, re-read

**Note**:
A piece of the reader's own writing attached to a Library Entry. It may optionally contain a quoted passage and a page number.
_Avoid_: Annotation, highlight, comment, quote

**Connection**:
A typed, explained link between two Finished Books, created when a Book is first marked read. A reader has at most one per pair of Books, with a single Connection Type (the strongest, if several apply) and a Strength. Its explanation may quote the reader's Notes.
_Avoid_: Link, edge, relation

**Finished Book**:
A Book with at least one completed Read-through in the reader's Library Entry, regardless of its current Status. Only Finished Books take part in Connections and appear in the graph; a Book being re-read, or moved back to want, stays Finished.
_Avoid_: Read Book (Status `read` is only the current Status)

**Refresh**:
Regenerating a Finished Book's Connections from its current Notes and Enrichment. It updates the non-dismissed Connections it finds again, adds new ones within the cap, and never deletes a Connection or revives a dismissed one. The reader asks for it, or it happens once on its own when a Book judged without Enrichment gets a recognised one.
_Avoid_: Regenerate, recompute, rerun

**Strength**:
How strong a Connection is: strong, moderate or weak. A weak link is stored only when its explanation quotes Notes from both Books; otherwise it is dropped. Strength orders a Book's Connections and weights Clusters (strong 2, moderate 1, weak 0.5).
_Avoid_: Score, weight, confidence

**Connection Type**:
The kind of relationship a Connection expresses: thematic, contrast, or context.
_Avoid_: Link type, category

**Cluster**:
A group of at least three related Finished Books that emerges from Connections rather than being filed by hand. It has a generated name and a short generated description, and keeps its identity as Books are added. Smaller groups and Books with no Connections are not Clusters.
_Avoid_: Shelf, collection, folder

**Follow trail**:
The Books a reader has followed in the graph, one Connection at a time, oldest first, ending at the Book they are on. Following a Book already on it rewinds to that Book, so it never holds a Book twice. It lasts only while the panel is open, and choosing a Book or Connection on the graph starts a new one.
_Avoid_: Breadcrumbs, history, path, thread

**Enrichment**:
LLM-generated summary and themes attached to a Book. When the model does not recognise the Book, the Enrichment is empty (recognised or unrecognised); an unrecognised Book connects through its Notes only.
_Avoid_: Metadata, annotation

**Manual Book**:
A Book the reader created by hand because search found no match. It is private to its creator and never treated as shared data.
_Avoid_: Custom book, user-added book

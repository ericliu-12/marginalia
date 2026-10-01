# Marginalia

A private, contemplative web app where a reader keeps a personal library, captures notes while reading, and sees their reading as a connected body of thought.

## Language

**Book**:
A single work, independent of any reader. Editions (hardcover, paperback, translation printings) are ignored.
_Avoid_: Edition, title, volume

**Library Entry**:
A reader's relationship to a Book: its Status, dates, and rating. Notes attach here, not to the Book.
_Avoid_: Shelf item, reading record

**Status**:
Where a Book stands in a reader's life: want to read, reading, or read.
_Avoid_: Shelf, list, state

**Note**:
A piece of the reader's own writing attached to a Library Entry. It may optionally contain a quoted passage and a page number.
_Avoid_: Annotation, highlight, comment, quote

**Connection**:
A typed, explained link between two Books, created when a Book is marked read. Its explanation may quote the reader's Notes.
_Avoid_: Link, edge, relation

**Connection Type**:
The kind of relationship a Connection expresses: thematic, contrast, or context.
_Avoid_: Link type, category

**Cluster**:
A group of related Books that emerges from Connections rather than being filed by hand.
_Avoid_: Shelf, collection, folder

**Enrichment**:
LLM-generated summary and themes attached to a Book.
_Avoid_: Metadata, annotation

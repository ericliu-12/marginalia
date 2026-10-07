import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, libraryEntry } from "@/db/schema";
import { manualBookFields, type ManualBookInput } from "./add-book";
import { NotInLibraryError, findEntry } from "./library-entry";
import type { Pipeline } from "./pipeline";

// Domain seam: the reader edits a Book in their library. A Manual Book of theirs is changed itself,
// and a changed title, author or description re-runs its Enrichment. A shared Book is never touched:
// the title and author are kept as overrides on the reader's Library Entry, cleared when blank or the
// same as the shared value, and nothing is re-enriched; a cover or description sent for it is ignored.
export async function editBook(db: Db, pipeline: Pipeline, userId: string, bookId: string, input: ManualBookInput) {
  const entry = await findEntry(db, userId, bookId);
  if (!entry) throw new NotInLibraryError(bookId);
  const [b] = await db.select().from(book).where(eq(book.id, bookId));

  if (b.createdByUserId === null) {
    const title = input.title.trim();
    const author = input.author.trim();
    await db
      .update(libraryEntry)
      .set({
        titleOverride: title && title !== b.title ? title : null,
        authorOverride: author && author !== b.authors.join(", ") ? author : null,
      })
      .where(eq(libraryEntry.id, entry.id));
    return;
  }

  // Only its creator has a Library Entry for a Manual Book; this guards that.
  if (b.createdByUserId !== userId) throw new NotInLibraryError(bookId);
  const fields = manualBookFields(input);
  await db.update(book).set(fields).where(eq(book.id, bookId));
  const changed =
    fields.title !== b.title || fields.authors.join() !== b.authors.join() || fields.description !== b.description;
  if (changed) await pipeline.manualBookEdited(bookId);
}

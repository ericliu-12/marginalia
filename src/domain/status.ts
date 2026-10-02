import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { libraryEntry, readThrough } from "@/db/schema";
import type { Status } from "./search";

export class NotInLibraryError extends Error {
  constructor(public bookId: string) {
    super(`Book ${bookId} is not in the library`);
  }
}

// Domain seam: the one place a Status changes, keeping Read-throughs consistent with it.
//   -> reading: open a Read-through (start date) unless one is already open
//   -> read:    close the open one, or record a closed one with unknown dates
//   -> want:    drop any open one; completed Read-throughs stay, so the Book stays Finished
// `firstCompletion` is true only when this change completes the Book's first Read-through.
export async function changeStatus(db: Db, userId: string, bookId: string, status: Status) {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(libraryEntry)
      .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.bookId, bookId)))
      .for("update");
    if (!entry) throw new NotInLibraryError(bookId);
    if (entry.status === status) return { firstCompletion: false };

    const [open] = await tx
      .select()
      .from(readThrough)
      .where(and(eq(readThrough.libraryEntryId, entry.id), isNull(readThrough.completedAt)));
    const now = new Date();
    let firstCompletion = false;

    if (status === "reading") {
      if (!open) await tx.insert(readThrough).values({ libraryEntryId: entry.id, userId, startedAt: now });
    } else if (status === "read") {
      const completed = await tx
        .select({ id: readThrough.id })
        .from(readThrough)
        .where(and(eq(readThrough.libraryEntryId, entry.id), isNotNull(readThrough.completedAt)));
      firstCompletion = completed.length === 0;
      if (open) {
        await tx.update(readThrough).set({ finishedAt: now, completedAt: now }).where(eq(readThrough.id, open.id));
      } else {
        await tx.insert(readThrough).values({ libraryEntryId: entry.id, userId, completedAt: now });
      }
    } else if (open) {
      await tx.delete(readThrough).where(eq(readThrough.id, open.id));
    }

    await tx.update(libraryEntry).set({ status }).where(eq(libraryEntry.id, entry.id));
    return { firstCompletion };
  });
}

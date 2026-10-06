import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { libraryEntry, note } from "@/db/schema";
import { NotInLibraryError, findEntry } from "./library-entry";
import type { Pipeline } from "./pipeline";

export type Note = {
  id: string;
  body: string;
  quote: string | null;
  page: number | null;
  createdAt: Date;
};

export class NoteNotFoundError extends Error {
  constructor(public noteId: string) {
    super(`Note ${noteId} not found`);
  }
}

export class EmptyNoteError extends Error {
  constructor() {
    super("A Note needs some text");
  }
}

export type NoteInput = { body: string; quote?: string | null; page?: number | null };

// A Note belongs to the reader when its Library Entry does.
const ownedBy = (db: Db, userId: string) =>
  inArray(note.libraryEntryId, db.select({ id: libraryEntry.id }).from(libraryEntry).where(eq(libraryEntry.userId, userId)));

const columns = { id: note.id, body: note.body, quote: note.quote, page: note.page, createdAt: note.createdAt };

function clean(input: NoteInput) {
  const body = input.body.trim();
  if (!body) throw new EmptyNoteError();
  return { body, quote: input.quote?.trim() || null, page: input.page ?? null };
}

// Domain seam: Notes attach to the reader's Library Entry for a Book, never to the shared Book.
export async function addNote(db: Db, pipeline: Pipeline, userId: string, bookId: string, input: NoteInput): Promise<Note> {
  const values = clean(input);
  const entry = await findEntry(db, userId, bookId);
  if (!entry) throw new NotInLibraryError(bookId);
  const [created] = await db
    .insert(note)
    .values({ libraryEntryId: entry.id, userId, ...values })
    .returning(columns);
  await pipeline.noteSaved(created.id);
  return created;
}

// Newest first.
export async function listNotes(db: Db, userId: string, bookId: string): Promise<Note[]> {
  return db
    .select(columns)
    .from(note)
    .innerJoin(libraryEntry, eq(libraryEntry.id, note.libraryEntryId))
    .where(and(eq(libraryEntry.userId, userId), eq(libraryEntry.bookId, bookId)))
    .orderBy(desc(note.createdAt), desc(note.id));
}

// Editing a Note leaves Connections alone: they hold their explanation text and Note ids as written.
export async function updateNote(db: Db, pipeline: Pipeline, userId: string, noteId: string, input: NoteInput): Promise<Note> {
  const [updated] = await db
    .update(note)
    .set({ ...clean(input), embedding: null, embeddingModel: null, embedFailedAt: null, updatedAt: new Date() })
    .where(and(eq(note.id, noteId), ownedBy(db, userId)))
    .returning(columns);
  if (!updated) throw new NoteNotFoundError(noteId);
  await pipeline.noteSaved(updated.id);
  return updated;
}

// Idempotent: a Note that is already gone, or isn't the reader's, is left alone without error.
export async function deleteNote(db: Db, userId: string, noteId: string): Promise<void> {
  await db.delete(note).where(and(eq(note.id, noteId), ownedBy(db, userId)));
}

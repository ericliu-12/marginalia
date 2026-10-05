"use server";

import { revalidatePath } from "next/cache";
import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { addBook, DuplicateBookError } from "@/domain/add-book";
import { descriptionGateway } from "@/lib/book-search";
import { readEnrichment, tryAgain, type EnrichmentView } from "@/domain/enrichment";
import { changeStatus } from "@/domain/library-entry";
import { appQueue } from "@/lib/jobs";
import { addNote, deleteNote, listNotes, updateNote, type Note, type NoteInput } from "@/domain/notes";
import type { OpenLibraryWork, Status } from "@/domain/search";

export type AddResult = { ok: true } | { ok: false; reason: "duplicate" | "failed" };

// TODO(before multi-user): `work` comes from the browser and is stored as sent. Re-fetch the work
// from Open Library by `work.workKey` here and ignore the client-supplied fields (see #17).
export async function addBookAction(work: OpenLibraryWork, status: Status): Promise<AddResult> {
  try {
    const db = appDb();
    // A queue that is down must not stop a Book being added; Enrichment is picked up on "Try again".
    const queue = await appQueue().catch((err): null => {
      console.error(err);
      return null;
    });
    await addBook(db, await getSeededUserId(db), work, status, descriptionGateway(), queue);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    if (err instanceof DuplicateBookError) return { ok: false, reason: "duplicate" };
    console.error(err);
    return { ok: false, reason: "failed" };
  }
}

export async function changeStatusAction(bookId: string, status: Status): Promise<{ ok: boolean }> {
  try {
    const db = appDb();
    // A queue that is down must not stop a Status change; the Book is left for the backfill.
    const queue = await appQueue().catch((err): null => {
      console.error(err);
      return null;
    });
    await changeStatus(db, await getSeededUserId(db), bookId, status, queue);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export type NoteResult = { ok: true; note: Note } | { ok: false };

export async function listNotesAction(bookId: string): Promise<Note[] | null> {
  try {
    const db = appDb();
    return await listNotes(db, await getSeededUserId(db), bookId);
  } catch (err) {
    console.error(err);
    return null;
  }
}

// A queue that is down must not stop a Note being saved.
const embeddingQueue = () =>
  appQueue().catch((err): null => {
    console.error(err);
    return null;
  });

export async function addNoteAction(bookId: string, input: NoteInput): Promise<NoteResult> {
  try {
    const db = appDb();
    return { ok: true, note: await addNote(db, await getSeededUserId(db), bookId, input, await embeddingQueue()) };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function updateNoteAction(noteId: string, input: NoteInput): Promise<NoteResult> {
  try {
    const db = appDb();
    return { ok: true, note: await updateNote(db, await getSeededUserId(db), noteId, input, await embeddingQueue()) };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function deleteNoteAction(noteId: string): Promise<{ ok: boolean }> {
  try {
    const db = appDb();
    await deleteNote(db, await getSeededUserId(db), noteId);
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

// Null when it could not be read (not the same as a Book with no Enrichment yet).
export async function getEnrichmentAction(bookId: string): Promise<{ enrichment: EnrichmentView | null } | null> {
  try {
    return { enrichment: await readEnrichment(appDb(), bookId) };
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function tryAgainAction(bookId: string): Promise<{ ok: boolean }> {
  try {
    await tryAgain(appDb(), await appQueue(), bookId);
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

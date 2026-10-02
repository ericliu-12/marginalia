"use server";

import { revalidatePath } from "next/cache";
import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { addBook, DuplicateBookError } from "@/domain/add-book";
import { descriptionGateway } from "@/lib/book-search";
import { changeStatus } from "@/domain/status";
import { addNote, deleteNote, listNotes, updateNote, type Note, type NoteInput } from "@/domain/notes";
import type { OpenLibraryWork, Status } from "@/domain/search";

// Google Books answers an occasional transient 503; one quick retry fits inside the add-time cap.
const ADD_TIME_RETRY = { maxAttempts: 2, retryDelayMs: 300 };

export type AddResult = { ok: true } | { ok: false; reason: "duplicate" | "failed" };

// TODO(before multi-user): `work` comes from the browser and is stored as sent. Re-fetch the work
// from Open Library by `work.workKey` here and ignore the client-supplied fields (see #17).
export async function addBookAction(work: OpenLibraryWork, status: Status): Promise<AddResult> {
  try {
    const db = appDb();
    await addBook(db, await getSeededUserId(db), work, status, descriptionGateway(ADD_TIME_RETRY));
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
    await changeStatus(db, await getSeededUserId(db), bookId, status);
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

export async function addNoteAction(bookId: string, input: NoteInput): Promise<NoteResult> {
  try {
    const db = appDb();
    return { ok: true, note: await addNote(db, await getSeededUserId(db), bookId, input) };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function updateNoteAction(noteId: string, input: NoteInput): Promise<NoteResult> {
  try {
    const db = appDb();
    return { ok: true, note: await updateNote(db, await getSeededUserId(db), noteId, input) };
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

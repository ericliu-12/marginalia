"use server";

import { revalidatePath } from "next/cache";
import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { addBook, addManualBook, DuplicateBookError, InvalidBookError, type ManualBookInput } from "@/domain/add-book";
import { editBook } from "@/domain/edit-book";
import { findLookalike, type Lookalike } from "@/domain/lookalike";
import { descriptionGateway } from "@/lib/book-search";
import { readEntryEnrichment, tryAgain, type EnrichmentView } from "@/domain/enrichment";
import { countFindingConnections, dismissConnection, readConnection, readConnections, type ConnectionDetail, type ConnectionsView } from "@/domain/connections";
import { readGraphStatus, type GraphStatus } from "@/domain/graph-job";
import { changeStatus, removeFromLibrary } from "@/domain/library-entry";
import { appPipeline } from "@/lib/jobs";
import { addNote, deleteNote, listNotes, updateNote, type Note, type NoteInput } from "@/domain/notes";
import type { OpenLibraryWork, Status } from "@/domain/search";

export type AddResult = { ok: true; bookId: string } | { ok: false; reason: "duplicate" | "failed" };

// TODO(before multi-user): `work` comes from the browser and is stored as sent. Re-fetch the work
// from Open Library by `work.workKey` here and ignore the client-supplied fields (see #17).
export async function addBookAction(work: OpenLibraryWork, status: Status): Promise<AddResult> {
  try {
    const db = appDb();
    const { bookId } = await addBook(db, appPipeline(db), await getSeededUserId(db), work, status, descriptionGateway());
    revalidatePath("/");
    return { ok: true, bookId };
  } catch (err) {
    if (err instanceof DuplicateBookError) return { ok: false, reason: "duplicate" };
    console.error(err);
    return { ok: false, reason: "failed" };
  }
}

export type ManualAddResult = { ok: true; bookId: string } | { ok: false; reason: "invalid" | "failed" };

export async function addManualBookAction(input: ManualBookInput, status: Status): Promise<ManualAddResult> {
  try {
    const db = appDb();
    const { bookId } = await addManualBook(db, appPipeline(db), await getSeededUserId(db), input, status);
    revalidatePath("/");
    return { ok: true, bookId };
  } catch (err) {
    if (err instanceof InvalidBookError) return { ok: false, reason: "invalid" };
    console.error(err);
    return { ok: false, reason: "failed" };
  }
}

// Null when there is no lookalike, or it could not be checked: the warning is advisory.
export async function findLookalikeAction(title: string, author: string): Promise<Lookalike | null> {
  try {
    const db = appDb();
    return await findLookalike(db, await getSeededUserId(db), { title, author });
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function editBookAction(bookId: string, input: ManualBookInput): Promise<{ ok: true } | { ok: false; reason: "invalid" | "failed" }> {
  try {
    const db = appDb();
    await editBook(db, appPipeline(db), await getSeededUserId(db), bookId, input);
    revalidatePath("/");
    revalidatePath("/graph");
    return { ok: true };
  } catch (err) {
    if (err instanceof InvalidBookError) return { ok: false, reason: "invalid" };
    console.error(err);
    return { ok: false, reason: "failed" };
  }
}

// `firstCompletion` when the move completed the Book's first Read-through, so its Connections are being found.
export async function changeStatusAction(bookId: string, status: Status): Promise<{ ok: true; firstCompletion: boolean } | { ok: false }> {
  try {
    const db = appDb();
    const { firstCompletion } = await changeStatus(db, appPipeline(db), await getSeededUserId(db), bookId, status);
    revalidatePath("/");
    revalidatePath("/graph");
    return { ok: true, firstCompletion };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function removeFromLibraryAction(bookId: string): Promise<{ ok: boolean }> {
  try {
    const db = appDb();
    await removeFromLibrary(db, appPipeline(db), await getSeededUserId(db), bookId);
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
    return { ok: true, note: await addNote(db, appPipeline(db), await getSeededUserId(db), bookId, input) };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function updateNoteAction(noteId: string, input: NoteInput): Promise<NoteResult> {
  try {
    const db = appDb();
    return { ok: true, note: await updateNote(db, appPipeline(db), await getSeededUserId(db), noteId, input) };
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
    const db = appDb();
    return { enrichment: await readEntryEnrichment(db, await getSeededUserId(db), bookId) };
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function tryAgainAction(bookId: string): Promise<{ ok: boolean }> {
  try {
    const db = appDb();
    return { ok: await tryAgain(db, appPipeline(db), await getSeededUserId(db), bookId) };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

// Null when it could not be read.
export async function getConnectionsAction(bookId: string): Promise<ConnectionsView | null> {
  try {
    const db = appDb();
    return await readConnections(db, await getSeededUserId(db), bookId);
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Null when it could not be read; `connection` is null when it is gone (dismissed, or its Book removed).
export async function getConnectionAction(connectionId: string): Promise<{ connection: ConnectionDetail | null } | null> {
  try {
    const db = appDb();
    return { connection: await readConnection(db, await getSeededUserId(db), connectionId) };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Whether the reader's graph is about to change; null when it can't be told.
export async function graphStatusAction(): Promise<GraphStatus | null> {
  try {
    const db = appDb();
    return await readGraphStatus(db, await getSeededUserId(db));
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function countFindingConnectionsAction(): Promise<number | null> {
  try {
    const db = appDb();
    return await countFindingConnections(db, await getSeededUserId(db));
  } catch (err) {
    console.error(err);
    return null;
  }
}

// The graph loses the Connection now. The worker recomputes its Clusters, which the graph fetches
// once it settles.
export async function dismissConnectionAction(connectionId: string): Promise<{ ok: boolean }> {
  try {
    const db = appDb();
    await dismissConnection(db, appPipeline(db), await getSeededUserId(db), connectionId);
    revalidatePath("/graph");
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function refreshConnectionsAction(bookId: string): Promise<{ ok: boolean }> {
  try {
    const db = appDb();
    await appPipeline(db).refreshRequested(await getSeededUserId(db), bookId);
    // The graph sees the run, and checks back until it settles.
    revalidatePath("/graph");
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

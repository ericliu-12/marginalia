"use server";

import { revalidatePath } from "next/cache";
import { appDb } from "@/db/client";
import { addBookByWorkKey, addManualBook, DuplicateBookError, InvalidBookError, type ManualBookInput } from "@/domain/add-book";
import { editBook } from "@/domain/edit-book";
import { findLookalike, type Lookalike } from "@/domain/lookalike";
import { bookSearchGateway, descriptionGateway } from "@/lib/book-search";
import { readEntryEnrichment, tryAgain, type EnrichmentView } from "@/domain/enrichment";
import { countFindingConnections, dismissConnection, readConnection, readConnections, type ConnectionDetail, type ConnectionsView } from "@/domain/connections";
import { readGraphStatus, type GraphStatus } from "@/domain/graph-job";
import { changeStatus, removeFromLibrary } from "@/domain/library-entry";
import { readPause, type Pause } from "@/domain/spend";
import { appPipeline } from "@/lib/jobs";
import { requireReader } from "@/lib/signed-in";
import { addNote, deleteNote, listNotes, updateNote, type Note, type NoteInput } from "@/domain/notes";
import type { Status } from "@/domain/search";

export type AddResult = { ok: true; bookId: string } | { ok: false; reason: "duplicate" | "failed" };

// Only the work's key comes from the browser; the work is looked up again on the server.
export async function addBookAction(workKey: string, status: Status): Promise<AddResult> {
  try {
    const userId = await requireReader();
    const db = appDb();
    const { bookId } = await addBookByWorkKey(db, appPipeline(db), userId, workKey, status, { works: bookSearchGateway(), descriptions: descriptionGateway() });
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
    const userId = await requireReader();
    const db = appDb();
    const { bookId } = await addManualBook(db, appPipeline(db), userId, input, status);
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
    const userId = await requireReader();
    const db = appDb();
    return await findLookalike(db, userId, { title, author });
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function editBookAction(bookId: string, input: ManualBookInput): Promise<{ ok: true } | { ok: false; reason: "invalid" | "failed" }> {
  try {
    const userId = await requireReader();
    const db = appDb();
    await editBook(db, appPipeline(db), userId, bookId, input);
    revalidatePath("/");
    revalidatePath("/graph");
    return { ok: true };
  } catch (err) {
    if (err instanceof InvalidBookError) return { ok: false, reason: "invalid" };
    console.error(err);
    return { ok: false, reason: "failed" };
  }
}

// `firstCompletion` when the move completed the Book's first Read-through, so its Connections are being
// found; `paused` (the day it resumes) when they wait for the month's spending limit.
export async function changeStatusAction(
  bookId: string,
  status: Status,
): Promise<{ ok: true; firstCompletion: boolean; paused: string | null } | { ok: false }> {
  try {
    const userId = await requireReader();
    const db = appDb();
    const { firstCompletion } = await changeStatus(db, appPipeline(db), userId, bookId, status);
    const pause = firstCompletion ? await readPause(db, userId) : null;
    revalidatePath("/");
    revalidatePath("/graph");
    return { ok: true, firstCompletion, paused: pause?.resumesOn ?? null };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function removeFromLibraryAction(bookId: string): Promise<{ ok: boolean }> {
  try {
    const userId = await requireReader();
    const db = appDb();
    await removeFromLibrary(db, appPipeline(db), userId, bookId);
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
    const userId = await requireReader();
    const db = appDb();
    return await listNotes(db, userId, bookId);
  } catch (err) {
    console.error(err);
    return null;
  }
}

// `id` names a new Note from the browser, so a save sent again lands once.
export async function addNoteAction(bookId: string, input: NoteInput, id?: string): Promise<NoteResult> {
  try {
    const userId = await requireReader();
    const db = appDb();
    return { ok: true, note: await addNote(db, appPipeline(db), userId, bookId, input, id) };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function updateNoteAction(noteId: string, input: NoteInput): Promise<NoteResult> {
  try {
    const userId = await requireReader();
    const db = appDb();
    return { ok: true, note: await updateNote(db, appPipeline(db), userId, noteId, input) };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function deleteNoteAction(noteId: string): Promise<{ ok: boolean }> {
  try {
    const userId = await requireReader();
    const db = appDb();
    await deleteNote(db, userId, noteId);
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

// Null when it could not be read (not the same as a Book with no Enrichment yet).
export async function getEnrichmentAction(bookId: string): Promise<{ enrichment: EnrichmentView | null } | null> {
  try {
    const userId = await requireReader();
    const db = appDb();
    return { enrichment: await readEntryEnrichment(db, userId, bookId) };
  } catch (err) {
    console.error(err);
    return null;
  }
}

export async function tryAgainAction(bookId: string): Promise<{ ok: boolean }> {
  try {
    const userId = await requireReader();
    const db = appDb();
    return { ok: await tryAgain(db, appPipeline(db), userId, bookId) };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

// Null when it could not be read.
export async function getConnectionsAction(bookId: string): Promise<ConnectionsView | null> {
  try {
    const userId = await requireReader();
    const db = appDb();
    return await readConnections(db, userId, bookId);
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Null when it could not be read; `connection` is null when it is gone (dismissed, or its Book removed).
export async function getConnectionAction(connectionId: string): Promise<{ connection: ConnectionDetail | null } | null> {
  try {
    const userId = await requireReader();
    const db = appDb();
    return { connection: await readConnection(db, userId, connectionId) };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// Whether the reader's graph is about to change; null when it can't be told.
export async function graphStatusAction(): Promise<GraphStatus | null> {
  try {
    const userId = await requireReader();
    const db = appDb();
    return await readGraphStatus(db, userId);
  } catch (err) {
    console.error(err);
    return null;
  }
}

// The quiet line by the wordmark: Books finding Connections, and whether the Reader's background work is
// paused at this month's spending limit, or their own.
export async function backgroundStatusAction(): Promise<{ finding: number; paused: Pause | null } | null> {
  try {
    const userId = await requireReader();
    const db = appDb();
    const [finding, pause] = await Promise.all([countFindingConnections(db, userId), readPause(db, userId)]);
    return { finding, paused: pause };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// The graph loses the Connection now. The worker recomputes its Clusters, which the graph fetches
// once it settles.
export async function dismissConnectionAction(connectionId: string): Promise<{ ok: boolean }> {
  try {
    const userId = await requireReader();
    const db = appDb();
    await dismissConnection(db, appPipeline(db), userId, connectionId);
    revalidatePath("/graph");
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

export async function refreshConnectionsAction(bookId: string): Promise<{ ok: boolean }> {
  try {
    const userId = await requireReader();
    const db = appDb();
    await appPipeline(db).refreshRequested(userId, bookId);
    // The graph sees the run, and checks back until it settles.
    revalidatePath("/graph");
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false };
  }
}

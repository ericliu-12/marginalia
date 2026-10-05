import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { enrichment, note } from "@/db/schema";
import { completedPasses } from "./library-entry";

// Seam to the embeddings provider (Voyage); tests supply a fake. `document` when storing, `query`
// when searching. Returns one vector per text, in order. Throws on a failed answer.
export interface Embedder {
  readonly model: string;
  embed(texts: string[], inputType: "document" | "query"): Promise<number[][]>;
}

export type EmbeddingTarget = { kind: "enrichment" | "note"; id: string };

// Seam to the job queue: `id` is a Book id for an Enrichment and a Note id for a Note.
export interface EmbeddingQueue {
  enqueueEmbedding(target: EmbeddingTarget): Promise<void>;
}

// Domain seam, run by the worker: embed a Book's Enrichment (summary and themes). Unrecognised
// Enrichment is never embedded; a vector already made by this model is kept.
export async function embedEnrichment(db: Db, embedder: Embedder, bookId: string): Promise<void> {
  const [row] = await db.select().from(enrichment).where(eq(enrichment.bookId, bookId));
  if (!row?.recognised || row.status !== "ready" || !row.summary) return;
  if (row.embedding && row.embeddingModel === embedder.model) return;
  const [vector] = await embedder.embed([`${row.summary}\n${(row.themes ?? []).join("; ")}`], "document");
  // Not written if the Enrichment was regenerated while embedding; its own job embeds the new one.
  await db
    .update(enrichment)
    .set({ embedding: vector, embeddingModel: embedder.model })
    .where(and(eq(enrichment.bookId, bookId), eq(enrichment.summary, row.summary), eq(enrichment.themes, row.themes ?? [])));
}

// Domain seam, run by the worker: embed one Note (its text and quoted passage) on its own. A Note
// that is gone is a no-op.
export async function embedNote(db: Db, embedder: Embedder, noteId: string): Promise<void> {
  const [row] = await db.select().from(note).where(eq(note.id, noteId));
  if (!row) return;
  if (row.embedding && row.embeddingModel === embedder.model) return;
  const [vector] = await embedder.embed([[row.body, row.quote].filter(Boolean).join("\n")], "document");
  // Not written if the Note was edited while embedding; the edit queued its own job.
  await db
    .update(note)
    .set({ embedding: vector, embeddingModel: embedder.model })
    .where(and(eq(note.id, noteId), eq(note.body, row.body), sql`${note.quote} IS NOT DISTINCT FROM ${row.quote}`));
}

export type NearestBook = { bookId: string; similarity: number };

// Domain seam: the reader's Finished Books nearest to a Book, most similar first. Only the reader's
// Finished Books (a completed Read-through, whatever the Status) are candidates: an embedded Book that
// is in nobody's library, or only in another reader's, or that the reader has not finished, never
// appears. A Book is represented by its Enrichment and the reader's Notes on it, each its own vector;
// a Book's score is its best vector pair (cosine similarity). Only vectors from `model` are compared.
export async function nearestBooks(db: Db, userId: string, bookId: string, model: string, limit = 10): Promise<NearestBook[]> {
  const { rows } = await db.execute<{ book_id: string; similarity: number }>(sql`
    WITH finished AS (
      SELECT DISTINCT book_id FROM (${completedPasses(db, userId)}) passes
    ),
    vectors AS (
      SELECT e.book_id, e.embedding
      FROM enrichment e JOIN finished f ON f.book_id = e.book_id
      WHERE e.embedding IS NOT NULL AND e.embedding_model = ${model}
      UNION ALL
      SELECT le.book_id, n.embedding
      FROM note n
      JOIN library_entry le ON le.id = n.library_entry_id
      JOIN finished f ON f.book_id = le.book_id
      WHERE le.user_id = ${userId} AND n.embedding IS NOT NULL AND n.embedding_model = ${model}
    )
    SELECT other.book_id, max(1 - (other.embedding <=> mine.embedding))::float8 AS similarity
    FROM vectors mine JOIN vectors other ON other.book_id <> mine.book_id
    WHERE mine.book_id = ${bookId}
    GROUP BY other.book_id
    ORDER BY similarity DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({ bookId: r.book_id, similarity: r.similarity }));
}

// Queues an embed job for every recognised Enrichment and every Note with no vector, or one from
// another model. Returns how many were queued; jobs for the same target coalesce, so re-running is safe.
export async function backfillEmbeddings(db: Db, queue: EmbeddingQueue, model: string): Promise<number> {
  const stale = (embedding: AnyPgColumn, embeddingModel: AnyPgColumn) =>
    or(isNull(embedding), isNull(embeddingModel), ne(embeddingModel, model));
  const enrichments = await db
    .select({ id: enrichment.bookId })
    .from(enrichment)
    .where(and(eq(enrichment.recognised, true), eq(enrichment.status, "ready"), stale(enrichment.embedding, enrichment.embeddingModel)));
  const notes = await db.select({ id: note.id }).from(note).where(stale(note.embedding, note.embeddingModel));
  for (const { id } of enrichments) await queue.enqueueEmbedding({ kind: "enrichment", id });
  for (const { id } of notes) await queue.enqueueEmbedding({ kind: "note", id });
  return enrichments.length + notes.length;
}

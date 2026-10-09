import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, enrichment } from "@/db/schema";
import { BACKGROUND_BUDGET, describeBook, type DescriptionGateway } from "./description";
import { NotInLibraryError, findEntry } from "./library-entry";
import type { JobQueue, Pipeline } from "./pipeline";

export type EnrichmentInput = { title: string; authors: string[]; description: string; subjects: string[] };

export type EnrichmentResult = {
  recognised: boolean;
  summary: string;
  themes: string[];
  // The author and approximate first-publication year the model believes the Book has.
  author: string | null;
  firstPublishedYear: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

// Seam to the Haiku-class model; tests supply a fake. Throws on a failed or malformed answer.
export interface EnrichmentModel {
  readonly model: string;
  readonly promptVersion: string;
  enrich(input: EnrichmentInput): Promise<EnrichmentResult>;
}

export type EnrichmentView = {
  status: "pending" | "ready" | "failed";
  recognised: boolean;
  summary: string | null;
  themes: string[] | null;
  // The Google Books volume whose description grounded the summary; null when none did.
  googleBooksVolumeId: string | null;
};

// Ready and recognised: the only Enrichment that is embedded or shown to the judge.
export const isRecognised = <T extends { status: EnrichmentView["status"]; recognised: boolean }>(e: T | undefined): e is T =>
  e?.status === "ready" && e.recognised;
// The same, as a condition on the enrichment table.
export const recognisedEnrichment = and(eq(enrichment.status, "ready"), eq(enrichment.recognised, true));

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// Two surnames are the same name within a small edit distance (Dostoevsky/Dostoyevsky); short
// surnames must match exactly.
function surnamesClose(a: string, b: string) {
  const allowed = Math.min(a.length, b.length) < 5 ? 0 : 1 + Number(a.length >= 10);
  return editDistance(a, b) <= allowed;
}

// The model's stated author against the Book's: surnames after normalisation, within a small edit
// distance. Surname-only keeps "J.R.R. Tolkien" matching "John Ronald Reuel Tolkien"; a wrong author
// is what the check exists to catch. A missing author on either side is skipped.
export function authorsMatch(believed: string | null, authors: string[]): boolean {
  const believedSurname = normName(believed ?? "").at(-1);
  if (!believedSurname || authors.length === 0) return true;
  return authors.some((a) => {
    const surname = normName(a).at(-1);
    return !!surname && surnamesClose(surname, believedSurname);
  });
}

// Whether two names are one person's, in either order ("Murata Sayaka", "Sayaka Murata"): either
// name's surname is among the other's words.
export function namesMatch(a: string, b: string): boolean {
  const wordsA = normName(a);
  const wordsB = normName(b);
  const surnameA = wordsA.at(-1);
  const surnameB = wordsB.at(-1);
  if (!surnameA || !surnameB) return false;
  return wordsB.some((w) => surnamesClose(surnameA, w)) || wordsA.some((w) => surnamesClose(surnameB, w));
}

export type EnrichDeps = {
  model: EnrichmentModel;
  // Looks up a missing description; without it a description-less Book is enriched conservatively.
  descriptions?: DescriptionGateway | null;
};

// This module is the only writer of an Enrichment's status:
//   pending: a job is coming (queued, running, or retrying)
//   ready:   the last run succeeded
//   failed:  no job is coming; the reader can "Try again"

// Domain seam, run by the worker: enrich one Book if its description or author/year metadata changed
// since the last Enrichment, or "Try again" asked for a run. Throws on model failure so the queue
// retries; a failure leaves the status as it was (see enrichmentGaveUp). A Book that no longer
// exists is a no-op.
export async function enrichBook(db: Db, deps: EnrichDeps, bookId: string): Promise<void> {
  let [b] = await db.select().from(book).where(eq(book.id, bookId));
  if (!b) return;
  const [current] = await db.select().from(enrichment).where(eq(enrichment.bookId, bookId));

  const requested = current?.requestedAt ?? null;
  // A Book added without a description gets one fetched here, with full retries. Only until a run has
  // succeeded, or on a "Try again", so a Book nothing describes is not looked up on every run.
  if (!b.description && b.openLibraryWorkKey && deps.descriptions && (!current?.descriptionHash || requested)) {
    const found = await describeBook(
      deps.descriptions,
      { title: b.title, authors: b.authors, workKey: b.openLibraryWorkKey },
      BACKGROUND_BUDGET,
    );
    if (found.description) {
      [b] = await db
        .update(book)
        .set({ description: found.description, googleBooksVolumeId: found.googleBooksVolumeId })
        .where(eq(book.id, bookId))
        .returning();
    }
  }

  const descriptionHash = hash(b.description ?? "");
  const metadataHash = hash(JSON.stringify([b.authors, b.firstPublishedYear]));
  if (current?.status === "ready" && !requested && current.descriptionHash === descriptionHash && current.metadataHash === metadataHash) return;

  const { model } = deps;
  const subjects = (b.snapshot as { subjects?: string[] } | null)?.subjects ?? [];
  try {
    const r = await model.enrich({ title: b.title, authors: b.authors, description: b.description ?? "", subjects });
    // Unrecognised stays empty: no summary or themes are kept for it.
    // Alternate names cover transliteration: "Murakami Haruki" is "Haruki Murakami".
    const aliases = (b.snapshot as { authorAliases?: string[] } | null)?.authorAliases ?? [];
    const recognised = r.recognised && authorsMatch(r.author, [...b.authors, ...aliases]);
    if (r.firstPublishedYear && b.firstPublishedYear && r.firstPublishedYear !== b.firstPublishedYear) {
      console.warn(`Enrichment year mismatch for "${b.title}": model ${r.firstPublishedYear}, Book ${b.firstPublishedYear}`);
    }
    const values = {
      bookId,
      recognised,
      summary: recognised ? r.summary : null,
      themes: recognised ? r.themes : null,
      // Any vector was made from the previous summary; it is re-embedded.
      embedding: null,
      embeddingModel: null,
      descriptionHash,
      metadataHash,
      believedAuthor: r.author,
      believedFirstPublishedYear: r.firstPublishedYear,
      model: model.model,
      promptVersion: model.promptVersion,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd,
      status: "ready" as const,
      attempts: 0,
      lastError: null,
    };
    await db
      .insert(enrichment)
      .values(values)
      .onConflictDoUpdate({
        target: enrichment.bookId,
        // A "Try again" that arrived while this run was in flight stays requested, so the job it
        // queued still does its work.
        set: { ...values, requestedAt: sql`case when ${enrichment.requestedAt} is not distinct from ${requested} then null else ${enrichment.requestedAt} end` },
      });
  } catch (err) {
    const failure = {
      attempts: (current?.attempts ?? 0) + 1,
      lastError: err instanceof Error ? err.message : String(err),
    };
    await db
      .insert(enrichment)
      .values({ bookId, status: "pending", ...failure })
      .onConflictDoUpdate({ target: enrichment.bookId, set: failure });
    throw err;
  }
}

// The Book's enrich job will not be attempted again: an Enrichment still pending is `failed`, and the
// reader can "Try again".
export async function enrichmentGaveUp(db: Db, bookId: string): Promise<void> {
  await db.update(enrichment).set({ status: "failed" }).where(and(eq(enrichment.bookId, bookId), eq(enrichment.status, "pending")));
}

// Asks for the Book's Enrichment: pending until a job runs, or failed when none could be queued. A
// `retry` runs whatever the hashes say; otherwise an Enrichment that is already there is left alone.
// False when no job is coming.
export async function requestEnrichment(db: Db, queue: JobQueue, bookId: string, retry: boolean): Promise<boolean> {
  const values = { bookId, status: "pending" as const, ...(retry && { requestedAt: new Date() }) };
  const insert = db.insert(enrichment).values(values);
  await (retry ? insert.onConflictDoUpdate({ target: enrichment.bookId, set: values }) : insert.onConflictDoNothing());
  try {
    await queue.send({ kind: "enrich", bookId });
    return true;
  } catch (err) {
    console.error(err);
    // No job is coming, so don't leave the reader waiting on one.
    await db.update(enrichment).set({ status: "failed" }).where(and(eq(enrichment.bookId, bookId), eq(enrichment.status, "pending")));
    return false;
  }
}

// Domain seam: what the Book panel shows. Null for a Book added before Enrichment existed.
export async function readEnrichment(db: Db, bookId: string): Promise<EnrichmentView | null> {
  const [row] = await db
    .select({
      status: enrichment.status,
      recognised: enrichment.recognised,
      summary: enrichment.summary,
      themes: enrichment.themes,
      googleBooksVolumeId: book.googleBooksVolumeId,
    })
    .from(enrichment)
    .innerJoin(book, eq(book.id, enrichment.bookId))
    .where(eq(enrichment.bookId, bookId));
  return row ?? null;
}

// Domain seam: the Enrichment of a Book in the reader's library, as their Book panel shows it.
export async function readEntryEnrichment(db: Db, userId: string, bookId: string): Promise<EnrichmentView | null> {
  if (!(await findEntry(db, userId, bookId))) throw new NotInLibraryError(bookId);
  return readEnrichment(db, bookId);
}

// Domain seam: the reader's "Try again", for a Book in their library. The next run does the work
// whatever changed. False when no job could be queued.
export async function tryAgain(db: Db, pipeline: Pipeline, userId: string, bookId: string): Promise<boolean> {
  if (!(await findEntry(db, userId, bookId))) throw new NotInLibraryError(bookId);
  return pipeline.enrichmentRetried(bookId);
}

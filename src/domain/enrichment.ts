import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, enrichment } from "@/db/schema";
import { BACKGROUND_BUDGET, describeBook, googleBooksDescription, type DescriptionGateway } from "./description";
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
  // Fetches Google's description and looks up a missing one; without it a Book with no stored
  // description is enriched conservatively.
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
  // Clears the "Try again" this run handles. One that arrived while it was in flight stays requested,
  // so the job it queued still does its work.
  const handled = sql`case when ${enrichment.requestedAt} is not distinct from ${requested} then null else ${enrichment.requestedAt} end`;
  // Google's description is never stored (#44); a description stored beside a volume predates that and
  // is Google's, so it is never read.
  let stored = b.googleBooksVolumeId ? null : b.description;
  // Google's description for this run only, once it has been fetched.
  let fetched = "";
  // A Book added without a description gets one looked up here, with full retries. Only until a run has
  // succeeded, or on a "Try again", so a Book nothing describes is not looked up on every run.
  if (!stored && !b.googleBooksVolumeId && b.openLibraryWorkKey && deps.descriptions && (!current?.descriptionHash || requested)) {
    const found = await describeBook(
      deps.descriptions,
      { title: b.title, authors: b.authors, workKey: b.openLibraryWorkKey },
      BACKGROUND_BUDGET,
    );
    if (found.googleBooksVolumeId) {
      fetched = found.description;
      [b] = await db.update(book).set({ googleBooksVolumeId: found.googleBooksVolumeId }).where(eq(book.id, bookId)).returning();
    } else if (found.description) {
      stored = found.description;
      [b] = await db.update(book).set({ description: stored }).where(eq(book.id, bookId)).returning();
    }
  }

  const descriptionHash = hash(stored ?? "");
  const metadataHash = hash(JSON.stringify([b.authors, b.firstPublishedYear]));
  if (current?.status === "ready" && !requested && current.descriptionHash === descriptionHash && current.metadataHash === metadataHash) return;

  if (b.googleBooksVolumeId && !fetched && deps.descriptions) fetched = await googleBooksDescription(deps.descriptions, b.googleBooksVolumeId);
  if (b.googleBooksVolumeId && !fetched) {
    // Google is down, over quota or no longer describes the Book. An Enrichment a run has made is left
    // as it was, and reads as ready again; the reader can "Try again" later.
    if (current?.descriptionHash) {
      console.warn(`Enrichment kept for "${b.title}": no Google Books description`);
      await db
        .update(enrichment)
        .set({ status: "ready", attempts: 0, lastError: null, requestedAt: handled })
        .where(eq(enrichment.bookId, bookId));
      return;
    }
    // A first run goes ahead on Open Library's description, if it has one.
    if (b.openLibraryWorkKey && deps.descriptions) {
      stored = await deps.descriptions
        .openLibraryDescription(b.openLibraryWorkKey, { retry: BACKGROUND_BUDGET.retry })
        .then((d) => d.trim())
        .catch((err) => {
          console.error(err);
          return "";
        });
    }
  }

  const { model } = deps;
  const subjects = (b.snapshot as { subjects?: string[] } | null)?.subjects ?? [];
  try {
    const r = await model.enrich({ title: b.title, authors: b.authors, description: fetched || stored || "", subjects });
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
      googleBooksVolumeId: fetched ? b.googleBooksVolumeId : null,
      // Without Google's description the run is not up to date, so the Book's next job tries again.
      descriptionHash: b.googleBooksVolumeId && !fetched ? null : descriptionHash,
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
        set: { ...values, requestedAt: handled },
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
      googleBooksVolumeId: enrichment.googleBooksVolumeId,
    })
    .from(enrichment)
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

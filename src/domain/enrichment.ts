import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { book, enrichment } from "@/db/schema";
import { BACKGROUND_BUDGET, describeBook, type DescriptionGateway } from "./description";

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

// Seam to the job queue; the worker runs `enrichBook` for each queued Book.
export interface EnrichmentQueue {
  enqueueEnrichment(bookId: string): Promise<void>;
}

export type EnrichmentView = {
  status: "pending" | "ready" | "failed";
  recognised: boolean;
  summary: string | null;
  themes: string[] | null;
};

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

// The model's stated author against the Book's: surnames after normalisation, within a small edit
// distance (Dostoevsky/Dostoyevsky). Surname-only keeps "J.R.R. Tolkien" matching "John Ronald Reuel
// Tolkien"; a wrong author is what the check exists to catch. A missing author on either side is skipped.
export function authorsMatch(believed: string | null, authors: string[]): boolean {
  const believedSurname = normName(believed ?? "").at(-1);
  if (!believedSurname || authors.length === 0) return true;
  return authors.some((a) => {
    const surname = normName(a).at(-1);
    if (!surname) return false;
    const allowed = Math.min(surname.length, believedSurname.length) < 5 ? 0 : 1 + Number(surname.length >= 10);
    return editDistance(surname, believedSurname) <= allowed;
  });
}

export type EnrichDeps = {
  model: EnrichmentModel;
  // Looks up a missing description; without it a description-less Book is enriched conservatively.
  descriptions?: DescriptionGateway | null;
  // The queue will not retry after this run, so a failure now is the reader-visible `failed`.
  finalAttempt?: boolean;
};

// Domain seam, run by the worker: enrich one Book if its description or author/year metadata changed
// since the last Enrichment (or "Try again" cleared the hashes). Throws on model failure so the queue
// retries; a Book that no longer exists is a no-op.
export async function enrichBook(db: Db, deps: EnrichDeps, bookId: string): Promise<void> {
  let [b] = await db.select().from(book).where(eq(book.id, bookId));
  if (!b) return;
  const [current] = await db.select().from(enrichment).where(eq(enrichment.bookId, bookId));

  // A Book added without a description gets one fetched here, with full retries. Only on the first run
  // or a "Try again", so a Book nothing describes is not looked up on every run.
  if (!b.description && b.openLibraryWorkKey && deps.descriptions && (!current || current.descriptionHash === null)) {
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
  if (current?.status === "ready" && current.descriptionHash === descriptionHash && current.metadataHash === metadataHash) return;

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
    // A "Try again" that arrived while this run was in flight cleared the hashes; keep them cleared so
    // the job it queued still does its work.
    const [latest] = await db.select({ hash: enrichment.descriptionHash }).from(enrichment).where(eq(enrichment.bookId, bookId));
    const retryRequested = !!current?.descriptionHash && latest?.hash === null;
    const values = {
      bookId,
      recognised,
      summary: recognised ? r.summary : null,
      themes: recognised ? r.themes : null,
      // Any vector was made from the previous summary; it is re-embedded.
      embedding: null,
      embeddingModel: null,
      descriptionHash: retryRequested ? null : descriptionHash,
      metadataHash: retryRequested ? null : metadataHash,
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
    await db.insert(enrichment).values(values).onConflictDoUpdate({ target: enrichment.bookId, set: values });
  } catch (err) {
    const failure = {
      status: deps.finalAttempt ? ("failed" as const) : ("pending" as const),
      attempts: (current?.attempts ?? 0) + 1,
      lastError: err instanceof Error ? err.message : String(err),
    };
    await db
      .insert(enrichment)
      .values({ bookId, model: model.model, promptVersion: model.promptVersion, ...failure })
      .onConflictDoUpdate({ target: enrichment.bookId, set: failure });
    throw err;
  }
}

// Domain seam: what the Book panel shows. Null when no Enrichment has been started for the Book.
export async function readEnrichment(db: Db, bookId: string): Promise<EnrichmentView | null> {
  const [row] = await db.select().from(enrichment).where(eq(enrichment.bookId, bookId));
  if (!row) return null;
  return { status: row.status, recognised: row.recognised, summary: row.summary, themes: row.themes };
}

// Domain seam: the reader's "Try again". Marks the Enrichment stale so the next run does the work.
export async function tryAgain(db: Db, queue: EnrichmentQueue, bookId: string): Promise<void> {
  await db
    .update(enrichment)
    .set({ descriptionHash: null, metadataHash: null, status: "pending" })
    .where(eq(enrichment.bookId, bookId));
  try {
    await queue.enqueueEnrichment(bookId);
  } catch (err) {
    // No job is coming, so don't leave the reader waiting on one.
    await db.update(enrichment).set({ status: "failed" }).where(eq(enrichment.bookId, bookId));
    throw err;
  }
}

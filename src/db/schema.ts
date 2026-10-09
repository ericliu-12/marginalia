import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  boolean,
  check,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { EMBEDDING_DIMENSIONS } from "@/lib/models";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const embedding = (name: string) => vector(name, { dimensions: EMBEDDING_DIMENSIONS });

export const statusEnum = pgEnum("status", ["want", "reading", "read"]);
export const connectionsStatusEnum = pgEnum("connections_status", ["idle", "running", "failed"]);
export const connectionTypeEnum = pgEnum("connection_type", ["thematic", "contrast", "context"]);
export const strengthEnum = pgEnum("strength", ["strong", "moderate", "weak"]);
export const groundingEnum = pgEnum("grounding", ["notes", "enrichment"]);
export const enrichmentStatusEnum = pgEnum("enrichment_status", ["pending", "ready", "failed"]);

// --- Identity (auth comes later; the MVP seeds one row) ---

export const user = pgTable("user", {
  id: id(),
  email: text("email").notNull().unique(),
  createdAt: createdAt(),
});

// --- Shared (no user_id) ---

export const book = pgTable(
  "book",
  {
    id: id(),
    title: text("title").notNull(),
    // Open Library's own title when `title` is the English edition's; null when they are the same.
    originalTitle: text("original_title"),
    authors: text("authors").array().notNull().default(sql`'{}'::text[]`),
    firstPublishedYear: integer("first_published_year"),
    coverUrl: text("cover_url"),
    openLibraryWorkKey: text("open_library_work_key").unique(),
    // The Google Books volume whose description describes the Book. That description is never stored
    // (Google's terms, #44): Enrichment fetches it for each run.
    googleBooksVolumeId: text("google_books_volume_id"),
    // Open Library's description, fetched once, or what the reader wrote for a Manual Book; null when
    // neither had one or Google's describes the Book. One stored for a Book with a Google Books volume
    // is Google's, from before #44, and is never read.
    description: text("description"),
    // Set only for Manual Books, which are private to their creator.
    createdByUserId: uuid("created_by_user_id").references(() => user.id),
    // Add-time snapshot (filtered subjects etc.).
    snapshot: jsonb("snapshot"),
    createdAt: createdAt(),
  },
  (t) => [index("book_created_by_idx").on(t.createdByUserId)],
);

export const enrichment = pgTable(
  "enrichment",
  {
    id: id(),
    bookId: uuid("book_id").notNull().unique().references(() => book.id, { onDelete: "cascade" }),
    recognised: boolean("recognised").notNull().default(false),
    summary: text("summary"),
    themes: text("themes").array(),
    embedding: embedding("embedding"),
    // Which model made `embedding`; vectors from different models are never compared.
    embeddingModel: text("embedding_model"),
    // Set when embedding gave up (the embed job's retries were used up); a Refresh of a reader's
    // Connections for the Book tries again. Cleared once it has a vector.
    embedFailedAt: timestamp("embed_failed_at", { withTimezone: true }),
    // Inputs the last successful run saw; null until one has run.
    // `descriptionHash` covers the stored description only; Google's is fetched, so a change on
    // Google's side is picked up only by a run that happens anyway.
    descriptionHash: text("description_hash"),
    metadataHash: text("metadata_hash"),
    // Set by "Try again": the next run does the work whatever the hashes say. Cleared by the run
    // that handled it, so one that lands mid-run survives it.
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    // The Google Books volume whose description grounded the last run; null when none did.
    googleBooksVolumeId: text("google_books_volume_id"),
    believedAuthor: text("believed_author"),
    believedFirstPublishedYear: integer("believed_first_published_year"),
    // Of the last run; null until one has run.
    model: text("model"),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    status: enrichmentStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [index("enrichment_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

// --- Personal (user_id throughout) ---

export const libraryEntry = pgTable(
  "library_entry",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => user.id),
    bookId: uuid("book_id").notNull().references(() => book.id),
    status: statusEnum("status").notNull(),
    connectionsStatus: connectionsStatusEnum("connections_status").notNull().default("idle"),
    connectionsGeneratedAt: timestamp("connections_generated_at", { withTimezone: true }),
    titleOverride: text("title_override"),
    authorOverride: text("author_override"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("library_entry_user_book_idx").on(t.userId, t.bookId)],
);

export const readThrough = pgTable("read_through", {
  id: id(),
  libraryEntryId: uuid("library_entry_id")
    .notNull()
    .references(() => libraryEntry.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => user.id),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  // Marks a completed pass; null while the read-through is open.
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const note = pgTable(
  "note",
  {
    id: id(),
    libraryEntryId: uuid("library_entry_id")
      .notNull()
      .references(() => libraryEntry.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => user.id),
    body: text("body").notNull(),
    quote: text("quote"),
    page: integer("page"),
    embedding: embedding("embedding"),
    embeddingModel: text("embedding_model"),
    // Set when embedding gave up (retries used up, or the job could not be queued); the backfill tries
    // again. A Note with neither a vector nor this is still being embedded.
    embedFailedAt: timestamp("embed_failed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("note_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops"))],
);

export const connection = pgTable(
  "connection",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => user.id),
    bookAId: uuid("book_a_id").notNull().references(() => book.id),
    bookBId: uuid("book_b_id").notNull().references(() => book.id),
    type: connectionTypeEnum("type").notNull(),
    strength: strengthEnum("strength").notNull(),
    similarity: doublePrecision("similarity").notNull(),
    similarityModel: text("similarity_model").notNull(),
    explanation: text("explanation").notNull(),
    grounding: groundingEnum("grounding").notNull(),
    quotedNoteIds: uuid("quoted_note_ids").array().notNull().default(sql`'{}'::uuid[]`),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("connection_user_pair_idx").on(t.userId, t.bookAId, t.bookBId),
    check("connection_ordered_pair", sql`${t.bookAId} < ${t.bookBId}`),
  ],
);

// One row per finished Connections job, so spend is visible: the judge model, prompt version, tokens
// and cost, even when the run found nothing.
export const connectionRun = pgTable("connection_run", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => user.id),
  libraryEntryId: uuid("library_entry_id")
    .notNull()
    .references(() => libraryEntry.id, { onDelete: "cascade" }),
  candidateCount: integer("candidate_count").notNull(),
  connectionCount: integer("connection_count").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  // The Book had no ready Enrichment, so it was judged on its Notes; a recognised Enrichment arriving
  // later Refreshes it.
  withoutEnrichment: boolean("without_enrichment").notNull().default(false),
  createdAt: createdAt(),
});

export const clusterLabel = pgTable("cluster_label", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => user.id),
  name: text("name"),
  description: text("description"),
  memberBookIds: uuid("member_book_ids").array().notNull(),
  // Of the naming call that set `name`; null until one has succeeded.
  model: text("model"),
  promptVersion: text("prompt_version"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  // Membership at naming time, for the 30% rename rule.
  namedMemberBookIds: uuid("named_member_book_ids").array(),
  // Which of the graph's wash colours it is drawn in, given when it forms and kept with its identity.
  wash: integer("wash").notNull().default(0),
  createdAt: createdAt(),
});

// Where a Finished Book sits in the reader's graph: its ForceAtlas2 position, computed by the worker
// and kept so the layout is the same from one session to the next. Goes with the Library Entry.
export const bookPosition = pgTable("book_position", {
  libraryEntryId: uuid("library_entry_id")
    .primaryKey()
    .references(() => libraryEntry.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => user.id),
  x: doublePrecision("x").notNull(),
  y: doublePrecision("y").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Present while the reader's graph job (their Clusters and Book positions) is queued or running, so the
// graph can tell when what it shows has caught up. `request` counts the requests since the row
// appeared; a job clears the row only when no request came in while it ran.
export const graphJob = pgTable("graph_job", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  request: integer("request").notNull().default(1),
  // The job has recomputed the Clusters and laid the graph out for the latest request; only naming is left.
  laidOut: boolean("laid_out").notNull().default(false),
});

// --- Spend (not per reader) ---

// One row per paid model call, Claude or Voyage, at list price, so the month's spend can be held to
// MONTHLY_AI_BUDGET_USD. Voyage reports tokens, not cost; its cost is the tokens at its list price.
export const paidCall = pgTable(
  "paid_call",
  {
    id: id(),
    provider: text("provider", { enum: ["anthropic", "voyage"] }).notNull(),
    model: text("model").notNull(),
    purpose: text("purpose", { enum: ["enrichment", "judge", "cluster-naming", "embedding"] }).notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: doublePrecision("cost_usd").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("paid_call_created_at_idx").on(t.createdAt)],
);

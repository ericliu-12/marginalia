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
export const strengthEnum = pgEnum("strength", ["strong", "moderate"]);
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
    authors: text("authors").array().notNull().default(sql`'{}'::text[]`),
    firstPublishedYear: integer("first_published_year"),
    coverUrl: text("cover_url"),
    openLibraryWorkKey: text("open_library_work_key").unique(),
    googleBooksVolumeId: text("google_books_volume_id"),
    // Fetched once at add-time; null when no source had one.
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
    descriptionHash: text("description_hash"),
    believedAuthor: text("believed_author"),
    believedFirstPublishedYear: integer("believed_first_published_year"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
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

export const clusterLabel = pgTable("cluster_label", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => user.id),
  name: text("name"),
  description: text("description"),
  memberBookIds: uuid("member_book_ids").array().notNull(),
  promptVersion: text("prompt_version"),
  // Membership at naming time, for the 30% rename rule.
  namedMemberBookIds: uuid("named_member_book_ids").array(),
  createdAt: createdAt(),
});

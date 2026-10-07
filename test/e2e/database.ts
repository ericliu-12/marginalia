import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { createDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { getSeededUserId, seedUser } from "../../src/db/seed";
import { book, bookPosition, clusterLabel, connection, enrichment, graphJob, libraryEntry, note, readThrough } from "../../src/db/schema";

// The browser tests' own database on the docker-compose Postgres, apart from the app's and the unit tests'.
// The web server is handed this database as DATABASE_URL, so creating it goes through Postgres's own
// maintenance database rather than whichever one DATABASE_URL names.
const BASE_URL = process.env.DATABASE_URL ?? "postgres://marginalia:marginalia@localhost:5433/marginalia";
const E2E_DB_NAME = "marginalia_e2e";

const onDatabase = (name: string) => {
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
};
export const e2eDatabaseUrl = () => onDatabase(E2E_DB_NAME);

// Fresh, migrated and holding the reader, once per run; the app answers nothing without the reader.
export async function createE2eDatabase() {
  const { hostname } = new URL(BASE_URL);
  if (!["localhost", "127.0.0.1"].includes(hostname)) {
    throw new Error(`Refusing to drop and recreate ${E2E_DB_NAME} on non-local host ${hostname}`);
  }
  const admin = new Pool({ connectionString: onDatabase("postgres") });
  await admin.query(`DROP DATABASE IF EXISTS ${E2E_DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${E2E_DB_NAME}`);
  await admin.end();
  const { db, pool } = createDb(e2eDatabaseUrl());
  await runMigrations(db);
  await seedUser(db);
  await pool.end();
}

// A small finished library, laid out left to right as a chain of Connections: each Book links to the
// next. One Connection, The Plague and Candide, is the only Contrast, so a test can find it by colour.
// Enrichment is ready and nothing is left for the worker, so no page reaches an outside API.
export const LIBRARY = [
  { title: "Stoner", author: "John Williams", x: 0, y: 0 },
  { title: "The Remains of the Day", author: "Kazuo Ishiguro", x: 1, y: -0.6 },
  { title: "Never Let Me Go", author: "Kazuo Ishiguro", x: 2, y: 0 },
  { title: "Beloved", author: "Toni Morrison", x: 3, y: -0.6 },
  { title: "The Plague", author: "Albert Camus", x: 4, y: 0 },
  { title: "Candide", author: "Voltaire", x: 5, y: -0.6 },
] as const;
export type Title = (typeof LIBRARY)[number]["title"];

const CHAIN = [
  { type: "thematic", strength: "strong" },
  { type: "thematic", strength: "strong" },
  { type: "context", strength: "moderate" },
  { type: "thematic", strength: "moderate" },
  { type: "contrast", strength: "strong" },
] as const;

// Back to just this library, before each test.
export async function seedLibrary() {
  const { db, pool } = createDb(e2eDatabaseUrl());
  await db.execute(sql`TRUNCATE "user" CASCADE`);
  const userId = (await seedUser(db)).id;
  const ids: string[] = [];
  for (const [i, b] of LIBRARY.entries()) {
    const [row] = await db.insert(book).values({ title: b.title, authors: [b.author] }).returning();
    ids.push(row.id);
    const [entry] = await db
      .insert(libraryEntry)
      .values({ userId, bookId: row.id, status: "read", connectionsGeneratedAt: new Date() })
      .returning();
    const finished = new Date(Date.UTC(2026, 0, 1 + i));
    await db.insert(readThrough).values({ libraryEntryId: entry.id, userId, finishedAt: finished, completedAt: finished });
    await db.insert(bookPosition).values({ libraryEntryId: entry.id, userId, x: b.x, y: b.y });
    await db.insert(enrichment).values({
      bookId: row.id,
      status: "ready",
      recognised: true,
      summary: `${b.title}, by ${b.author}.`,
      themes: ["memory", "duty"],
    });
  }
  for (const [i, c] of CHAIN.entries()) {
    const [a, b] = [ids[i], ids[i + 1]].sort();
    await db.insert(connection).values({
      userId,
      bookAId: a,
      bookBId: b,
      ...c,
      similarity: 0.5,
      similarityModel: "e2e",
      explanation: `Why ${LIBRARY[i].title} meets ${LIBRARY[i + 1].title}.`,
      grounding: "enrichment",
      model: "e2e",
      promptVersion: "e2e",
    });
  }
  await pool.end();
}

// A Note on the Book that gave up on its vector, so Connections leave it out.
export async function addNoteThatGaveUp(title: Title, body: string) {
  const { db, pool } = createDb(e2eDatabaseUrl());
  const [entry] = await db.select({ id: libraryEntry.id, userId: libraryEntry.userId }).from(libraryEntry).innerJoin(book, eq(book.id, libraryEntry.bookId)).where(eq(book.title, title));
  await db.insert(note).values({ libraryEntryId: entry.id, userId: entry.userId, body, embedFailedAt: new Date() });
  await pool.end();
}

// A Cluster of these Books, as the graph job would leave it: named, or not yet (`name` null).
export async function addCluster(titles: Title[], name: { name: string; description: string } | null) {
  const { db, pool } = createDb(e2eDatabaseUrl());
  const rows = await db.select({ id: book.id, title: book.title, userId: libraryEntry.userId }).from(book).innerJoin(libraryEntry, eq(libraryEntry.bookId, book.id));
  const ids = titles.map((t) => rows.find((r) => r.title === t)!.id);
  const [row] = await db.insert(clusterLabel).values({ userId: rows[0].userId, memberBookIds: ids, name: name?.name, description: name?.description }).returning();
  await pool.end();
  return row.id;
}

// The graph job has recomputed the Clusters and laid the graph out; only naming is left.
export async function layOutGraph() {
  const { db, pool } = createDb(e2eDatabaseUrl());
  await db.update(graphJob).set({ laidOut: true });
  await pool.end();
}

// Naming catches up with a Cluster.
export async function nameCluster(id: string, name: { name: string; description: string }) {
  const { db, pool } = createDb(e2eDatabaseUrl());
  await db.update(clusterLabel).set(name).where(eq(clusterLabel.id, id));
  await pool.end();
}

// The graph job settles, as the worker would after it has recomputed and named the Clusters.
export async function settleGraph() {
  const { db, pool } = createDb(e2eDatabaseUrl());
  await db.delete(graphJob);
  await pool.end();
}

// A Book finished since the graph last showed, with its Connections already found: a strong one to each
// Book in `connectTo`. Placed below the chain unless `at` says otherwise. Read through from Reading over
// the last week, or `alreadyRead`: added from search as already read, with no dates.
export async function finishBook(title: string, connectTo: Title[] = [], at = { x: 2.5, y: 0.8 }, alreadyRead = false) {
  const { db, pool } = createDb(e2eDatabaseUrl());
  const rows = await db.select({ id: book.id, title: book.title, userId: libraryEntry.userId }).from(book).innerJoin(libraryEntry, eq(libraryEntry.bookId, book.id));
  const userId = rows[0].userId;
  const [row] = await db.insert(book).values({ title, authors: ["A. Writer"] }).returning();
  const [entry] = await db.insert(libraryEntry).values({ userId, bookId: row.id, status: "read", connectionsGeneratedAt: new Date() }).returning();
  const now = new Date();
  const dates = alreadyRead ? {} : { startedAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), finishedAt: now };
  await db.insert(readThrough).values({ libraryEntryId: entry.id, userId, ...dates, completedAt: now });
  await db.insert(bookPosition).values({ libraryEntryId: entry.id, userId, ...at });
  await db.insert(enrichment).values({ bookId: row.id, status: "ready", recognised: true, summary: `${title}.`, themes: ["memory"] });
  for (const other of connectTo) {
    const [a, b] = [row.id, rows.find((r) => r.title === other)!.id].sort();
    await db.insert(connection).values({
      userId,
      bookAId: a,
      bookBId: b,
      type: "thematic",
      strength: "strong",
      similarity: 0.5,
      similarityModel: "e2e",
      explanation: `Why ${title} meets ${other}.`,
      grounding: "notes",
      model: "e2e",
      promptVersion: "e2e",
    });
  }
  await pool.end();
}

// The reader the app serves.
export async function readerId() {
  const { db, pool } = createDb(e2eDatabaseUrl());
  const id = await getSeededUserId(db);
  await pool.end();
  return id;
}

// A Book the reader wants to read: in the library, not Finished, so not in the graph.
export async function wantBook(title: string) {
  const { db, pool } = createDb(e2eDatabaseUrl());
  const userId = await getSeededUserId(db);
  const [row] = await db.insert(book).values({ title, authors: ["A. Writer"] }).returning();
  await db.insert(libraryEntry).values({ userId, bookId: row.id, status: "want" });
  await db.insert(enrichment).values({ bookId: row.id, status: "ready", recognised: true, summary: `${title}.`, themes: ["memory"] });
  await pool.end();
}

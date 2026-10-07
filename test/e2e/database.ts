import { eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { createDb } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { seedUser } from "../../src/db/seed";
import { book, bookPosition, connection, enrichment, libraryEntry, note, readThrough } from "../../src/db/schema";

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

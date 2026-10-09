import { eq } from "drizzle-orm";
import { appDb } from "@/db/client";
import { user } from "@/db/schema";
import { normaliseEmail } from "@/domain/allowlist";
import { addBook, DuplicateBookError } from "@/domain/add-book";
import { searchBooks } from "@/domain/search";
import { bookSearchGateway, descriptionGateway } from "@/lib/book-search";
import { appPipeline } from "@/lib/jobs";

// Dev only: `pnpm dev:seed-library <email>` fills that Reader's library with Books marked Already read, through the real add path, so
// Enrichment and embeddings are queued for the worker (`pnpm worker`) to run.
const url = process.env.DATABASE_URL;
if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
  throw new Error("dev:seed-library only runs against a local DATABASE_URL.");
}

// The query is what is searched; the top result is added. "The Stranger" alone finds other books
// of that name first, so it carries the author.
const QUERIES = [
  "Beloved",
  "The Stranger Camus",
  "One Hundred Years of Solitude",
  "Set My Heart on Fire",
  "Kafka on the Shore",
  "Norwegian Wood",
  "The Plague",
  "Normal People",
  "My Year of Rest and Relaxation",
  "Convenience Store Woman",
  "The Unbearable Lightness of Being",
  "Candide",
];

const db = appDb();
const [reader] = await db.select({ id: user.id }).from(user).where(eq(user.email, normaliseEmail(process.argv[2] ?? "")));
if (!reader) throw new Error("Usage: pnpm dev:seed-library <email of a Reader who has signed in>");
const userId = reader.id;
const gateway = bookSearchGateway();
const descriptions = descriptionGateway();
const pipeline = appPipeline(db);

for (const query of QUERIES) {
  const [top] = await searchBooks(db, userId, gateway, query);
  if (!top) {
    console.log(`${query}\n  no result`);
    continue;
  }
  let outcome = "added as Already read";
  try {
    await addBook(db, pipeline, userId, top, "read", descriptions);
  } catch (err) {
    if (!(err instanceof DuplicateBookError)) throw err;
    outcome = "already in the library";
  }
  const was = top.originalTitle ? ` (was ${top.originalTitle})` : "";
  console.log(`${query}\n  ${outcome}: ${top.title}${was} | ${top.authors.join(", ") || "no author"} | ${top.firstPublishedYear ?? "?"} | ${top.editionCount} editions | ${top.workKey}`);
  // Open Library allows a few requests a second.
  await new Promise((r) => setTimeout(r, 500));
}
process.exit(0);

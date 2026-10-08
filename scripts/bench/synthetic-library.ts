// A synthetic library for the graph benchmark: about one Cluster per 20 Books, 3 to 5 Connections each,
// 80% inside their Cluster with preferential attachment, 40% strong. The same for every run of a size.
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { seedUser } from "@/db/seed";
import { book, bookPosition, clusterLabel, connection, enrichment, libraryEntry, readThrough } from "@/db/schema";
import { recomputeClusters } from "@/domain/clusters";
import { layoutGraph } from "@/domain/graph";

// Mulberry32, so every run seeds the same library.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS =
  "river night house garden letter winter season stone memory silence harbour mirror empire island daughter stranger orchard fire light shadow city mountain glass salt bread ash rain field ghost book voyage".split(
    " ",
  );
const ADJECTIVES = "quiet long last hidden broken golden distant small bright silent lost old new white black".split(" ");

// A synthetic library: titles of one to six words, some with subtitles, in Clusters as described above.
function library(n: number) {
  const rand = seeded(n);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const title = (i: number) => {
    const words = Array.from({ length: 1 + Math.floor(rand() * 5) }, () => (rand() < 0.3 ? pick(ADJECTIVES) : pick(WORDS)));
    const main = ["The", ...words].join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
    return `${main} ${i}${rand() < 0.25 ? `: A ${pick(WORDS)} of ${pick(WORDS)}s` : ""}`;
  };
  const groups = Math.max(1, Math.round(n / 20));
  const group = Array.from({ length: n }, (_, i) => i % groups);
  const degree = new Array(n).fill(0);
  const pairs = new Map<string, { a: number; b: number; strong: boolean }>();
  for (let i = 0; i < n; i++) {
    const want = 3 + Math.floor(rand() * 3);
    for (let tries = 0; degree[i] < want && tries < 50; tries++) {
      const inside = rand() < 0.8;
      const pool = Array.from({ length: n }, (_, j) => j).filter((j) => j !== i && (group[j] === group[i]) === inside);
      // Preferential attachment: the better connected are likelier picks.
      const weights = pool.map((j) => 1 + degree[j]);
      let r = rand() * weights.reduce((s, w) => s + w, 0);
      const j = pool[weights.findIndex((w) => (r -= w) < 0)] ?? pool[0];
      const key = [i, j].sort((p, q) => p - q).join(":");
      if (j === undefined || pairs.has(key)) continue;
      pairs.set(key, { a: i, b: j, strong: rand() < 0.4 });
      degree[i]++;
      degree[j]++;
    }
  }
  return { titles: Array.from({ length: n }, (_, i) => title(i)), pairs: [...pairs.values()], degree };
}

// Replaces everything in `db` with a synthetic library of `n` Finished Books, laid out and clustered as
// the worker would, every Cluster named.
export async function seedSyntheticLibrary(db: Db, n: number) {
  await db.execute(sql`TRUNCATE "user" CASCADE`);
  const userId = (await seedUser(db)).id;
  const { titles, pairs, degree } = library(n);
  const books = await db.insert(book).values(titles.map((title) => ({ title, authors: ["A. Writer"] }))).returning({ id: book.id });
  const entries = await db
    .insert(libraryEntry)
    .values(books.map((b) => ({ userId, bookId: b.id, status: "read" as const, connectionsGeneratedAt: new Date() })))
    .returning({ id: libraryEntry.id });
  await db.insert(readThrough).values(
    entries.map((e, i) => {
      const at = new Date(Date.UTC(2020, 0, 1 + i));
      return { libraryEntryId: e.id, userId, finishedAt: at, completedAt: at };
    }),
  );
  await db.insert(enrichment).values(books.map((b) => ({ bookId: b.id, status: "ready" as const, recognised: true, summary: "A book.", themes: ["memory"] })));
  const types = ["thematic", "contrast", "context"] as const;
  await db.insert(connection).values(
    pairs.map(({ a, b, strong }, i) => {
      const [x, y] = [books[a].id, books[b].id].sort();
      return {
        userId,
        bookAId: x,
        bookBId: y,
        type: types[i % 3],
        strength: strong ? ("strong" as const) : ("moderate" as const),
        similarity: 0.5,
        similarityModel: "bench",
        explanation: "Why these two meet.",
        grounding: "enrichment" as const,
        model: "bench",
        promptVersion: "bench",
      };
    }),
  );
  await recomputeClusters(db, userId);
  await layoutGraph(db, userId);
  // Names as long as real ones run: two to five words.
  const rand = seeded(n + 1);
  const clusters = await db.select({ id: clusterLabel.id }).from(clusterLabel);
  for (const c of clusters) {
    const words = Array.from({ length: 2 + Math.floor(rand() * 4) }, () => WORDS[Math.floor(rand() * WORDS.length)]);
    const name = words.join(" ").replace(/^\w/, (ch) => ch.toUpperCase());
    await db.update(clusterLabel).set({ name, description: "Synthetic.", namedMemberBookIds: sql`member_book_ids` }).where(sql`id = ${c.id}`);
  }
  const hub = degree.indexOf(Math.max(...degree));
  const placed = await db.select({ n: sql<number>`count(*)::int` }).from(bookPosition);
  return { books: n, connections: pairs.length, clusters: clusters.length, hub: titles[hub], placed: placed[0].n };
}

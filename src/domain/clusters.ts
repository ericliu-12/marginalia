import { and, asc, eq, inArray, sql } from "drizzle-orm";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { Db } from "@/db/client";
import { book, clusterLabel, enrichment, libraryEntry } from "@/db/schema";
import { byStrength } from "./connection-pair";
import { CLUSTER_WEIGHT, readLiveConnections } from "./connections";
import { displayed } from "./library";
import { completedPasses } from "./library-entry";

// Fewer Books than this are not a Cluster.
export const MIN_CLUSTER_SIZE = 3;
// How many wash colours the graph has (WASH in src/app/graph/graph-style.ts).
export const WASH_COUNT = 6;
// A new Cluster continues an old one when their Books overlap at least this much (Jaccard), or when it
// holds at least this share of the old one's Books (so a Cluster can grow fast and keep its identity).
const MATCH_JACCARD = 0.5;
const MATCH_CONTAINMENT = 0.7;
const RESOLUTION = 1.0;
const SEED = 17;

// Mulberry32: Louvain's random choices, the same on every run.
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

// Louvain over the reader's non-dismissed Connections between Finished Books, weighted by Strength,
// with nodes and Connections in id order so a fixed input always gives the same groups. Groups of at
// least MIN_CLUSTER_SIZE, each sorted, largest first.
async function findClusters(db: Db | Tx, userId: string): Promise<string[][]> {
  const finished = new Set((await completedPasses(db, userId)).map((p) => p.bookId));
  const connections = await readLiveConnections(db, userId);

  const g = new Graph({ type: "undirected" });
  for (const id of [...finished].sort()) g.addNode(id);
  for (const c of connections) g.addEdge(c.a, c.b, { weight: CLUSTER_WEIGHT[c.strength] });
  const community = louvain(g, { getEdgeWeight: "weight", resolution: RESOLUTION, rng: seeded(SEED) });

  const groups = new Map<number, string[]>();
  for (const id of g.nodes()) groups.set(community[id], [...(groups.get(community[id]) ?? []), id]);
  return [...groups.values()]
    .filter((m) => m.length >= MIN_CLUSTER_SIZE)
    .map((m) => m.sort())
    .sort((p, q) => q.length - p.length || (p[0] < q[0] ? -1 : 1));
}

type Previous = { id: string; members: string[] };
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const overlap = (p: string[], q: string[]) => {
  const s = new Set(q);
  return p.filter((x) => s.has(x)).length;
};
const jaccard = (p: Set<string>, q: Set<string>) => {
  const shared = overlap([...p], [...q]);
  return shared / (p.size + q.size - shared || 1);
};

// The previous Cluster id each new Cluster keeps, or null for a new one. Pairs are matched one to one,
// those sharing the most Books first (the larger previous Cluster, then the larger new one, on a tie):
// so a merge keeps the larger Cluster's identity and a split gives it to the largest part. A pair must
// still overlap by MATCH_JACCARD, counting with the previous Cluster every other that mostly went into
// the new one (a merge), and with the new Cluster every other that mostly came from the previous (a
// split); or the new Cluster must hold MATCH_CONTAINMENT of the previous one's Books. A previous
// Cluster left unmatched is dissolved.
function inherit(previous: Previous[], next: string[][]): (string | null)[] {
  const pairs = previous
    .flatMap((p) => next.map((c, i) => ({ p, c, i, shared: overlap(p.members, c) })))
    .filter((x) => x.shared > 0)
    .sort((x, y) => y.shared - x.shared || y.p.members.length - x.p.members.length || y.c.length - x.c.length);
  const kept: (string | null)[] = next.map(() => null);
  const taken = new Set<string>();
  for (const { p, c, i, shared } of pairs) {
    if (taken.has(p.id) || kept[i]) continue;
    const contained = shared >= MATCH_CONTAINMENT * p.members.length;
    const merged = previous.filter((q) => q === p || overlap(q.members, c) * 2 >= q.members.length);
    const parts = next.filter((d) => d === c || overlap(p.members, d) * 2 >= d.length);
    if (!contained && jaccard(new Set(merged.flatMap((q) => q.members)), new Set(parts.flat())) < MATCH_JACCARD) continue;
    kept[i] = p.id;
    taken.add(p.id);
  }
  return kept;
}

// Recomputes and removals of one reader take turns, so a removed Book is never written back.
const lockClusters = (tx: Tx, userId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clusters:${userId}`}))`);

// Domain seam, run by the worker: recomputes the reader's Clusters from their Connections and stores
// them in the snapshot, keeping each Cluster's identity (and so its name) where it continues an old one.
export async function recomputeClusters(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockClusters(tx, userId);
    const next = await findClusters(tx, userId);
    const previous = await tx
      .select({ id: clusterLabel.id, members: clusterLabel.memberBookIds, wash: clusterLabel.wash })
      .from(clusterLabel)
      .where(eq(clusterLabel.userId, userId))
      .orderBy(asc(clusterLabel.createdAt), asc(clusterLabel.id));
    const kept = inherit(previous, next);
    const gone = previous.filter((p) => !kept.includes(p.id)).map((p) => p.id);
    if (gone.length) await tx.delete(clusterLabel).where(inArray(clusterLabel.id, gone));
    // A new Cluster takes the wash fewest live Clusters have, the first such on a tie.
    const inUse = previous.filter((p) => kept.includes(p.id)).map((p) => p.wash);
    for (const [i, members] of next.entries()) {
      const id = kept[i];
      if (id) await tx.update(clusterLabel).set({ memberBookIds: members }).where(eq(clusterLabel.id, id));
      else {
        const uses = (w: number) => inUse.filter((x) => x === w).length;
        const wash = Array.from({ length: WASH_COUNT }, (_, w) => w).reduce((best, w) => (uses(w) < uses(best) ? w : best));
        inUse.push(wash);
        await tx.insert(clusterLabel).values({ userId, memberBookIds: members, wash });
      }
    }
  });
}

// A removed Book leaves the reader's Clusters at once, inside the removal's transaction, so it never
// counts toward a Cluster's membership while the recompute is on its way. It stays in the membership
// at naming time, where it counts as removed toward a rename.
export async function leaveClusters(tx: Tx, userId: string, bookId: string) {
  await lockClusters(tx, userId);
  await tx
    .update(clusterLabel)
    .set({ memberBookIds: sql`array_remove(${clusterLabel.memberBookIds}, ${bookId}::uuid)` })
    .where(eq(clusterLabel.userId, userId));
}

// The reader's Clusters as last computed, oldest first, with members limited to `books` (the graph's).
// One not yet named (its naming failed) shows as "Cluster of N Books".
export async function readClusters(db: Db, userId: string, books: Set<string>) {
  const rows = await db
    .select({ id: clusterLabel.id, members: clusterLabel.memberBookIds, name: clusterLabel.name, description: clusterLabel.description, wash: clusterLabel.wash })
    .from(clusterLabel)
    .where(eq(clusterLabel.userId, userId))
    .orderBy(asc(clusterLabel.createdAt), asc(clusterLabel.id));
  return rows
    .map((r) => {
      const bookIds = r.members.filter((b) => books.has(b));
      return { id: r.id, bookIds, name: r.name ?? `Cluster of ${bookIds.length} Books`, description: r.description, named: r.name !== null, wash: r.wash };
    })
    .filter((c) => c.bookIds.length >= MIN_CLUSTER_SIZE);
}

export type NamingBook = { title: string; authors: string[]; themes: string[] };
export type NamingInput = {
  // The Cluster's current name, which the call may keep; null for a new Cluster. Its description is
  // not passed, so facts it stated are never carried into the next one.
  previousName: string | null;
  books: NamingBook[];
  // Between two of `books`, by title.
  connections: { a: string; b: string; explanation: string }[];
};
export type NamingResult = { name: string; description: string; inputTokens: number; outputTokens: number; costUsd: number };

// Seam to Claude: a name and description for one Cluster.
export interface ClusterNamer {
  model: string;
  promptVersion: string;
  name(input: NamingInput): Promise<NamingResult>;
}

// A named Cluster is named again only once its membership has changed by both this share of its
// membership at naming time and this many Books, added and removed counted together.
const RENAME_SHARE = 0.3;
const RENAME_MIN_BOOKS = 2;
export const NAME_MAX_WORDS = 4;
// Attempts per Cluster per graph job; after the last, it keeps what it had until the next job.
export const NAMING_ATTEMPTS = 3;
// The strongest Connections among a Cluster's Books that the call sees.
const NAMING_CONNECTIONS = 40;

function needsName(c: { name: string | null; members: string[]; named: string[] | null }) {
  if (c.name === null || c.named === null) return true;
  const [now, then] = [new Set(c.members), new Set(c.named)];
  const changed = c.members.filter((b) => !then.has(b)).length + c.named.filter((b) => !now.has(b)).length;
  return changed >= RENAME_MIN_BOOKS && changed >= RENAME_SHARE * c.named.length;
}

// The reader's titles and authors for `members`, their Enrichment themes, and the strongest
// non-dismissed Connections among them.
async function namingInput(db: Db, userId: string, members: string[], previousName: string | null): Promise<NamingInput> {
  const rows = await db
    .select({ id: book.id, title: book.title, authors: book.authors, entry: libraryEntry, themes: enrichment.themes, recognised: enrichment.recognised })
    .from(book)
    .innerJoin(libraryEntry, and(eq(libraryEntry.bookId, book.id), eq(libraryEntry.userId, userId)))
    .leftJoin(enrichment, eq(enrichment.bookId, book.id))
    .where(inArray(book.id, members))
    .orderBy(asc(book.id));
  const title = new Map(rows.map((r) => [r.id, displayed(r, r.entry).title]));
  const among = new Set(members);
  const connections = (await readLiveConnections(db, userId))
    .filter((c) => among.has(c.a) && among.has(c.b))
    .sort(byStrength)
    .slice(0, NAMING_CONNECTIONS);
  return {
    previousName,
    books: rows.map((r) => ({ ...displayed(r, r.entry), themes: r.recognised ? (r.themes ?? []) : [] })),
    connections: connections.map((c) => ({ a: title.get(c.a)!, b: title.get(c.b)!, explanation: c.explanation })),
  };
}

// One Cluster's name, trying up to NAMING_ATTEMPTS times; a reply that is not a name of at most
// NAME_MAX_WORDS words with a description counts as a failure. Null when every attempt failed.
async function nameOne(namer: ClusterNamer, input: NamingInput): Promise<NamingResult | null> {
  for (let attempt = 1; attempt <= NAMING_ATTEMPTS; attempt++) {
    try {
      const r = await namer.name(input);
      const [name, description] = [r.name.trim(), r.description.trim()];
      const words = name.split(/\s+/).filter(Boolean).length;
      if (words === 0 || words > NAME_MAX_WORDS || !description) throw new Error(`Not a Cluster name: ${JSON.stringify(r.name)}`);
      return { ...r, name, description };
    } catch (err) {
      if (attempt === NAMING_ATTEMPTS) console.error(err);
    }
  }
  return null;
}

// Domain seam, run by the worker after a recompute: names each of the reader's Clusters that is new,
// or unnamed, or has changed enough since it was named. Never throws for a failed name: that Cluster
// keeps what it had (a new one shows unnamed) and is tried again after the next recompute. A name is
// stored only while the Cluster still has the membership it was given for; one that changed meanwhile
// is named by the job that change queued.
export async function nameClusters(db: Db, namer: ClusterNamer, userId: string): Promise<void> {
  const rows = await db
    .select({ id: clusterLabel.id, members: clusterLabel.memberBookIds, named: clusterLabel.namedMemberBookIds, name: clusterLabel.name })
    .from(clusterLabel)
    .where(eq(clusterLabel.userId, userId))
    .orderBy(asc(clusterLabel.createdAt), asc(clusterLabel.id));
  for (const c of rows.filter(needsName)) {
    const r = await nameOne(namer, await namingInput(db, userId, c.members, c.name));
    if (!r) continue;
    await db
      .update(clusterLabel)
      .set({
        name: r.name,
        description: r.description,
        namedMemberBookIds: c.members,
        model: namer.model,
        promptVersion: namer.promptVersion,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
      })
      .where(and(eq(clusterLabel.id, c.id), eq(clusterLabel.memberBookIds, c.members)));
  }
}

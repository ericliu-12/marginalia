import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import type { Db } from "@/db/client";
import { clusterLabel, connection } from "@/db/schema";
import { CLUSTER_WEIGHT } from "./connections";
import { completedPasses } from "./library-entry";

// Fewer Books than this are not a Cluster.
export const MIN_CLUSTER_SIZE = 3;
// A new Cluster continues an old one when their Books overlap at least this much (Jaccard).
const MATCH_JACCARD = 0.5;
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
  const connections = (
    await db
      .select({ a: connection.bookAId, b: connection.bookBId, strength: connection.strength })
      .from(connection)
      .where(and(eq(connection.userId, userId), isNull(connection.dismissedAt)))
      .orderBy(asc(connection.bookAId), asc(connection.bookBId))
  ).filter((c) => finished.has(c.a) && finished.has(c.b));

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
// split). A previous Cluster left unmatched is dissolved.
function inherit(previous: Previous[], next: string[][]): (string | null)[] {
  const pairs = previous
    .flatMap((p) => next.map((c, i) => ({ p, c, i, shared: overlap(p.members, c) })))
    .filter((x) => x.shared > 0)
    .sort((x, y) => y.shared - x.shared || y.p.members.length - x.p.members.length || y.c.length - x.c.length);
  const kept: (string | null)[] = next.map(() => null);
  const taken = new Set<string>();
  for (const { p, c, i } of pairs) {
    if (taken.has(p.id) || kept[i]) continue;
    const merged = previous.filter((q) => q === p || overlap(q.members, c) * 2 >= q.members.length);
    const parts = next.filter((d) => d === c || overlap(p.members, d) * 2 >= d.length);
    if (jaccard(new Set(merged.flatMap((q) => q.members)), new Set(parts.flat())) < MATCH_JACCARD) continue;
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
      .select({ id: clusterLabel.id, members: clusterLabel.memberBookIds })
      .from(clusterLabel)
      .where(eq(clusterLabel.userId, userId))
      .orderBy(asc(clusterLabel.createdAt), asc(clusterLabel.id));
    const kept = inherit(previous, next);
    const gone = previous.filter((p) => !kept.includes(p.id)).map((p) => p.id);
    if (gone.length) await tx.delete(clusterLabel).where(inArray(clusterLabel.id, gone));
    for (const [i, members] of next.entries()) {
      const id = kept[i];
      if (id) await tx.update(clusterLabel).set({ memberBookIds: members }).where(eq(clusterLabel.id, id));
      else await tx.insert(clusterLabel).values({ userId, memberBookIds: members });
    }
  });
}

// A removed Book leaves the reader's Clusters at once, inside the removal's transaction, so it never
// counts toward a Cluster's membership (or a rename) while the recompute is on its way.
export async function leaveClusters(tx: Tx, userId: string, bookId: string) {
  await lockClusters(tx, userId);
  await tx
    .update(clusterLabel)
    .set({
      memberBookIds: sql`array_remove(${clusterLabel.memberBookIds}, ${bookId}::uuid)`,
      namedMemberBookIds: sql`array_remove(${clusterLabel.namedMemberBookIds}, ${bookId}::uuid)`,
    })
    .where(eq(clusterLabel.userId, userId));
}

// The reader's Clusters as last computed, oldest first, with members limited to `books` (the graph's).
export async function readClusters(db: Db, userId: string, books: Set<string>) {
  const rows = await db
    .select({ id: clusterLabel.id, members: clusterLabel.memberBookIds })
    .from(clusterLabel)
    .where(eq(clusterLabel.userId, userId))
    .orderBy(asc(clusterLabel.createdAt), asc(clusterLabel.id));
  return rows
    .map((r) => ({ id: r.id, bookIds: r.members.filter((b) => books.has(b)) }))
    .filter((c) => c.bookIds.length >= MIN_CLUSTER_SIZE);
}

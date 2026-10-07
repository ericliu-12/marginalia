import { STRENGTH_RANK } from "@/domain/connections";
import type { GraphBook, GraphConnection } from "@/domain/graph";

// The arrival: a Book the graph has not shown before lands, and its Connections draw in one by one.

// More than this many new at once (a backfill, a long absence) and they simply appear.
export const ARRIVAL_MAX = 3;
// An arriving Book finished within this many days, or read through from Reading, was just finished.
export const JUST_FINISHED_DAYS = 14;

// The Books arriving: those not among the ones the graph last showed, the most recently finished first.
// None when the graph remembers nothing it has shown, or in a burst.
export function arriving(shown: string[] | null, books: Pick<GraphBook, "bookId" | "finishedAt">[]): string[] {
  if (shown === null) return [];
  const before = new Set(shown);
  const fresh = books.filter((b) => !before.has(b.bookId)).sort((p, q) => q.finishedAt - p.finishedAt);
  return fresh.length > ARRIVAL_MAX ? [] : fresh.map((b) => b.bookId);
}

// The arriving Books' Connections still to draw in, in order: the latest Book's first, each Book's
// strongest first, then by id so the order holds still.
export function drawOrder(connections: GraphConnection[], books: string[], drawn: Set<string>): string[] {
  const owner = (c: GraphConnection) => Math.min(...[c.a, c.b].map((id) => books.indexOf(id)).filter((i) => i >= 0));
  return connections
    .filter((c) => !drawn.has(c.id) && (books.includes(c.a) || books.includes(c.b)))
    .sort((p, q) => owner(p) - owner(q) || STRENGTH_RANK[p.strength] - STRENGTH_RANK[q.strength] || (p.id < q.id ? -1 : 1))
    .map((c) => c.id);
}

// Whether an arriving Book was just finished, going by its latest completed Read-through: one that came
// from Reading (it has a start date), or was finished within JUST_FINISHED_DAYS. A Book added as already
// read has neither, and is only new in the graph.
export function justFinished(pass: GraphBook["latestPass"], now: number): boolean {
  return pass.startedAt !== null || (pass.finishedAt !== null && now - pass.finishedAt <= JUST_FINISHED_DAYS * 24 * 60 * 60 * 1000);
}

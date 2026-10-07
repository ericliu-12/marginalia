import { STRENGTH_RANK, type Strength } from "./connections";

// A Connection joins two Books, stored once per pair with the lower id as `a`.
export type Pair = { a: string; b: string };

// The pair's Book that is not `bookId`.
export const otherBook = (c: Pair, bookId: string) => (c.a === bookId ? c.b : c.a);

// Whether `bookId` is one of the pair's Books.
export const touches = (c: Pair, bookId: string) => c.a === bookId || c.b === bookId;

// Whether the pair joins these two Books, in either order.
export const joins = (c: Pair, x: string, y: string) => (c.a === x && c.b === y) || (c.a === y && c.b === x);

// Two Books as a stored pair.
export const pairOf = (x: string, y: string): Pair => (x < y ? { a: x, b: y } : { a: y, b: x });

// Strongest first, then most similar (where the similarity is at hand), then by id so ties hold still.
export function byStrength(p: { id: string; strength: Strength; similarity?: number }, q: { id: string; strength: Strength; similarity?: number }) {
  return STRENGTH_RANK[p.strength] - STRENGTH_RANK[q.strength] || (q.similarity ?? 0) - (p.similarity ?? 0) || (p.id < q.id ? -1 : 1);
}

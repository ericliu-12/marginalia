import { STRENGTH_RANK, type ConnectionType, type JudgeBook, type JudgeInput, type JudgedConnection, type JudgeNote, type Strength } from "./connections";

// One judge round of a Connections run, without the database: what the judge is shown, and which of
// its answers become Connections.

// Starting defaults from the pipeline-tuning prototype.
export const PER_RUN_CAP = 5;
// Approximate tokens of Notes shown to the judge per Book; the finished Book's own Notes get more room.
const CANDIDATE_NOTES_BUDGET = 600;
const OWN_NOTES_BUDGET = 3000;

const approxTokens = (s: string) => Math.ceil(s.length / 4);

// Notes in the order written, as many as fit the budget.
function withinBudget<T extends { body: string }>(notes: T[], budget: number): T[] {
  let used = 0;
  return notes.filter((n) => {
    used += approxTokens(n.body);
    return used <= budget;
  });
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const QUOTED = /["“]([^"”]{8,})["”]/g;

// A Book as the reader titles it. `enrichment` is its recognised Enrichment, or null when it has none.
export type RoundBook = {
  id: string;
  title: string;
  authors: string[];
  enrichment: { summary: string | null; themes: string[] | null } | null;
};
// The reader's Notes on the round's Books, in the order written.
export type RoundNote = { id: string; bookId: string; body: string };
export type Nearest = { bookId: string; similarity: number };

type Handle = { noteId: string; bookId: string; body: string };
export type JudgeRound = { bookId: string; nearest: Nearest[]; input: JudgeInput; handles: Map<string, Handle> };

// What the judge is shown: the finished Book and its nearest Books as candidates C1, C2, ..., in
// order. Notes get short ids for this call (n1, n2, ...) that map back to the real Note.
export function judgeRound(bookId: string, nearest: Nearest[], books: RoundBook[], notes: RoundNote[]): JudgeRound {
  const handles = new Map<string, Handle>();
  const present = (id: string, budget: number): JudgeNote[] =>
    withinBudget(
      notes.filter((n) => n.bookId === id),
      budget,
    ).map((n) => {
      const handle = `n${handles.size + 1}`;
      handles.set(handle, { noteId: n.id, bookId: id, body: n.body });
      return { id: handle, body: n.body };
    });
  const describe = (id: string, budget: number): JudgeBook => {
    const { title, authors, enrichment: e } = books.find((x) => x.id === id)!;
    return {
      title,
      authors,
      // An unrecognised Book's Enrichment is empty: the judge is told it has none.
      enrichment: e?.summary ? `${e.summary} Themes: ${(e.themes ?? []).join("; ")}` : null,
      notes: present(id, budget),
    };
  };
  const book = describe(bookId, OWN_NOTES_BUDGET);
  const candidates = nearest.map((n, i) => ({ id: `C${i + 1}`, ...describe(n.bookId, CANDIDATE_NOTES_BUDGET) }));
  return { bookId, nearest, input: { book, candidates }, handles };
}

export type AcceptedConnection = {
  otherBookId: string;
  type: ConnectionType;
  strength: Strength;
  similarity: number;
  explanation: string;
  grounding: "notes" | "enrichment";
  quotedNoteIds: string[];
};

// The judge's answers that become Connections, strongest first, ties by similarity, at most
// PER_RUN_CAP. `notesOnly` holds the unrecognised Books, which connect through their Notes only.
export function acceptJudged(round: JudgeRound, judged: JudgedConnection[], notesOnly: Set<string>): AcceptedConnection[] {
  const { bookId, nearest, input, handles } = round;
  const accepted: AcceptedConnection[] = [];
  const seen = new Set<string>();
  for (const c of judged) {
    const index = input.candidates.findIndex((x) => x.id === c.candidateId);
    if (index < 0 || seen.has(c.candidateId)) continue;
    const other = nearest[index];
    const pair = new Set([bookId, other.bookId]);
    const pool = [...handles.values()].filter((h) => pair.has(h.bookId));

    // Every quoted span must be verbatim in a Note of the pair; otherwise the Connection is dropped
    // rather than shown with a misquote.
    const quoted = new Map<string, Handle>();
    let misquoted = false;
    for (const [, span] of c.explanation.matchAll(QUOTED)) {
      const text = normalise(span);
      if (!text) continue;
      const matches = pool.filter((h) => normalise(h.body).includes(text));
      if (matches.length === 0) misquoted = true;
      for (const m of matches) quoted.set(m.noteId, m);
    }
    if (misquoted) continue;

    // Weak links survive only when they quote Notes from both Books, and stay weak.
    const quotedFrom = (id: string) => [...quoted.values()].some((h) => h.bookId === id);
    if (c.strength === "weak" && !(quotedFrom(bookId) && quotedFrom(other.bookId))) continue;
    if ([bookId, other.bookId].some((id) => notesOnly.has(id) && !quotedFrom(id))) continue;

    seen.add(c.candidateId);
    accepted.push({
      otherBookId: other.bookId,
      type: c.type,
      strength: c.strength,
      similarity: other.similarity,
      explanation: c.explanation,
      grounding: quoted.size > 0 ? "notes" : "enrichment",
      quotedNoteIds: [...quoted.keys()],
    });
  }
  // Strongest first, ties by similarity; the cap keeps the best.
  return accepted.sort((x, y) => STRENGTH_RANK[x.strength] - STRENGTH_RANK[y.strength] || y.similarity - x.similarity).slice(0, PER_RUN_CAP);
}

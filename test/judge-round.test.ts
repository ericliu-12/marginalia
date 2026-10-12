import { describe, expect, it } from "vitest";
import type { JudgedConnection } from "../src/domain/connections";
import { acceptJudged, judgeRound, PER_RUN_CAP, type RoundBook, type RoundNote } from "../src/domain/judge-round";

const enriched = (id: string, title: string): RoundBook => ({
  id,
  title,
  authors: ["An Author"],
  enrichment: { summary: `About ${title}.`, themes: ["grief", "love"] },
});
const books = [enriched("own", "Own Book"), enriched("x", "Book X"), enriched("y", "Book Y"), { ...enriched("u", "Unknown"), enrichment: null }];
const notes: RoundNote[] = [
  { id: "note-own", bookId: "own", body: "a meditation on grief, pursue living" },
  { id: "note-x", bookId: "x", body: "growth through love, slowly" },
  { id: "note-u", bookId: "u", body: "the letters were the best part" },
];
const nearest = [
  { bookId: "x", similarity: 0.8 },
  { bookId: "y", similarity: 0.7 },
  { bookId: "u", similarity: 0.6 },
];
const round = judgeRound("own", nearest, books, notes);
const judged = (c: Partial<JudgedConnection> & { candidateId: string }): JudgedConnection => ({
  type: "thematic",
  strength: "moderate",
  explanation: "They share a concern.",
  quotedNoteIds: [],
  ...c,
});

describe("Judge round", () => {
  it("shows the judge the Book and its nearest Books as candidates, with short Note ids and the Enrichment's themes", () => {
    expect(round.input).toEqual({
      book: { title: "Own Book", authors: ["An Author"], enrichment: "About Own Book. Themes: grief; love", notes: [{ id: "n1", body: notes[0].body }] },
      candidates: [
        { id: "C1", title: "Book X", authors: ["An Author"], enrichment: "About Book X. Themes: grief; love", notes: [{ id: "n2", body: notes[1].body }] },
        { id: "C2", title: "Book Y", authors: ["An Author"], enrichment: "About Book Y. Themes: grief; love", notes: [] },
        { id: "C3", title: "Unknown", authors: ["An Author"], enrichment: null, notes: [{ id: "n3", body: notes[2].body }] },
      ],
    });
  });

  it("shows a candidate's Notes in the order written, as many as fit its budget", () => {
    const long = (i: number): RoundNote => ({ id: `l${i}`, bookId: "x", body: "w".repeat(1000) });
    const r = judgeRound("own", nearest.slice(0, 1), books, [long(1), long(2), long(3)]);
    expect(r.input.candidates[0].notes.map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("keeps a quote verbatim in a Note of the pair, ignoring case and punctuation, and marks it note-grounded", () => {
    const [c] = acceptJudged(round, [judged({ candidateId: "C1", explanation: 'Your note on Book X, "Growth through love", fits.' })], new Set());
    expect(c).toMatchObject({ otherBookId: "x", grounding: "notes", quotedNoteIds: ["note-x"], similarity: 0.8 });
  });

  it("drops a Connection that misquotes, or quotes a Note from outside the pair", () => {
    const accepted = acceptJudged(
      round,
      [
        judged({ candidateId: "C1", explanation: 'Your note says "growth through hate".' }),
        judged({ candidateId: "C2", explanation: 'Your note says "growth through love".' }),
      ],
      new Set(),
    );
    expect(accepted).toEqual([]);
  });

  it("marks a Connection without quotes as enrichment-grounded", () => {
    expect(acceptJudged(round, [judged({ candidateId: "C2" })], new Set())).toMatchObject([{ otherBookId: "y", grounding: "enrichment", quotedNoteIds: [] }]);
  });

  it("keeps a weak link only when it quotes Notes from both Books, and keeps it weak", () => {
    const one = 'Your note on Own Book, "a meditation on grief", fits.';
    const both = `${one} Your note on Book X, "growth through love", too.`;
    expect(acceptJudged(round, [judged({ candidateId: "C1", strength: "weak", explanation: one })], new Set())).toEqual([]);
    expect(acceptJudged(round, [judged({ candidateId: "C1", strength: "weak", explanation: both })], new Set())).toMatchObject([
      { strength: "weak", quotedNoteIds: ["note-own", "note-x"] },
    ]);
  });

  it("keeps a link with an unrecognised Book only when it quotes that Book's Notes", () => {
    const notesOnly = new Set(["u"]);
    expect(acceptJudged(round, [judged({ candidateId: "C3" })], notesOnly)).toEqual([]);
    expect(acceptJudged(round, [judged({ candidateId: "C3", explanation: 'Your note on Unknown, "the letters were the best part".' })], notesOnly)).toHaveLength(1);
  });

  it("ignores unknown candidates and repeats of one", () => {
    const accepted = acceptJudged(round, [judged({ candidateId: "C9" }), judged({ candidateId: "C2" }), judged({ candidateId: "C2", strength: "strong" })], new Set());
    expect(accepted).toMatchObject([{ otherBookId: "y", strength: "moderate" }]);
  });

  it("ranks strongest first, then by similarity, and keeps at most the cap", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ bookId: `b${i}`, similarity: i / 10 }));
    const r = judgeRound("own", many, [books[0], ...many.map((n) => enriched(n.bookId, n.bookId))], []);
    const strengths = ["moderate", "strong", "moderate", "moderate", "strong", "moderate", "moderate", "moderate"] as const;
    const accepted = acceptJudged(r, strengths.map((strength, i) => judged({ candidateId: `C${i + 1}`, strength })), new Set());
    expect(accepted.map((c) => c.otherBookId)).toEqual(["b4", "b1", "b7", "b6", "b5"]);
    expect(accepted).toHaveLength(PER_RUN_CAP);
  });
});

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { backfillConnections, countFindingConnections, generateConnections, readConnections, type ConnectionDeps, type JudgeInput, type JudgedConnection } from "../src/domain/connections";
import { embedEnrichment, embedNote } from "../src/domain/embeddings";
import { enrichBook, readEnrichment } from "../src/domain/enrichment";
import { changeStatus } from "../src/domain/library-entry";
import { addNote } from "../src/domain/notes";
import { book, connection, connectionRun, enrichment, libraryEntry, note, readThrough } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, work, type FakeJudgeReply } from "./fakes";
import { useTestDb } from "./harness";

const AXES = ["solitude", "war", "sea"];

describe("Connections on first finish", () => {
  const ctx = useTestDb();
  const embedder = fakeEmbedder(AXES);

  // A Finished Book, enriched and embedded; `theme` decides which Books are near each other.
  async function finished(title: string, theme = "solitude", opts: { notes?: string[]; recognised?: boolean } = {}) {
    const entry = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${title}`, title, authors: ["A"] }), "read");
    await enrichBook(ctx.db, { model: fakeEnricher({ summary: `About ${title}.`, themes: [theme], recognised: opts.recognised ?? true }) }, entry.bookId);
    await embedEnrichment(ctx.db, embedder, entry.bookId);
    for (const body of opts.notes ?? []) {
      const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, entry.bookId, { body });
      await embedNote(ctx.db, embedder, n.id);
    }
    return entry.bookId;
  }

  // The judge answers for candidates by Book title.
  const byTitle = (input: JudgeInput, title: string) => input.candidates.find((c) => c.title === title)!;
  function deps(reply?: FakeJudgeReply, extra: Partial<ConnectionDeps> = {}) {
    const judge = fakeJudge(reply);
    return { judge, deps: { judge, embedder, enrichment: fakeEnricher(), ...extra } satisfies ConnectionDeps };
  }
  const run = (d: ConnectionDeps, bookId: string) => generateConnections(ctx.db, d, { userId: ctx.userId, bookId });
  const link = (c: Partial<JudgedConnection> & { candidateId: string }): JudgedConnection => ({
    type: "thematic", strength: "strong", explanation: "Both turn on solitude.", quotedNoteIds: [], ...c,
  });
  const stored = () => ctx.db.select().from(connection);
  const entryOf = async (bookId: string) => (await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, bookId)))[0];

  it("judges a Book against the reader's other Finished Books and stores what it finds", async () => {
    const a = await finished("Stoner");
    const b = await finished("Lonely");
    const { judge, deps: d } = deps((input) => ({
      connections: [link({ candidateId: byTitle(input, "Lonely").id, type: "contrast", explanation: "Stoner and Lonely both sit with solitude." })],
    }));
    await run(d, a);

    expect(judge.inputs).toHaveLength(1);
    expect(judge.inputs[0].book).toMatchObject({ title: "Stoner", enrichment: expect.stringContaining("About Stoner.") });
    expect(judge.inputs[0].candidates.map((c) => c.title)).toEqual(["Lonely"]);
    const [row] = await stored();
    expect(row).toMatchObject({
      userId: ctx.userId,
      bookAId: [a, b].sort()[0],
      bookBId: [a, b].sort()[1],
      type: "contrast",
      strength: "strong",
      explanation: "Stoner and Lonely both sit with solitude.",
      grounding: "enrichment",
      similarity: expect.closeTo(1),
      similarityModel: "fake-voyage",
      model: "fake-sonnet",
      promptVersion: "judge-test-1",
    });
    const entry = await entryOf(a);
    expect(entry.connectionsStatus).toBe("idle");
    expect(entry.connectionsGeneratedAt).toBeInstanceOf(Date);
    const [record] = await ctx.db.select().from(connectionRun);
    expect(record).toMatchObject({ model: "fake-sonnet", promptVersion: "judge-test-1", inputTokens: 1000, outputTokens: 200, costUsd: 0.004, candidateCount: 1, connectionCount: 1 });
  });

  it("only offers Finished Books as candidates, not orphaned or unfinished Books", async () => {
    const a = await finished("Stoner");
    await finished("Lonely");
    const [orphan] = await ctx.db.insert(book).values({ title: "Orphan", authors: ["O"] }).returning();
    await ctx.db.insert(enrichment).values({ bookId: orphan.id, recognised: true, summary: "x", themes: ["solitude"], model: "m", promptVersion: "p", status: "ready" });
    await embedEnrichment(ctx.db, embedder, orphan.id);
    const wanted = (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/w", title: "Wanted", authors: ["A"] }), "want")).bookId;
    await enrichBook(ctx.db, { model: fakeEnricher({ themes: ["solitude"] }) }, wanted);
    await embedEnrichment(ctx.db, embedder, wanted);

    const { judge, deps: d } = deps();
    await run(d, a);
    expect(judge.inputs[0].candidates.map((c) => c.title)).toEqual(["Lonely"]);
  });

  it("succeeds with zero Connections, without calling the judge when there are no candidates", async () => {
    const a = await finished("Stoner");
    const { judge, deps: d } = deps();
    await run(d, a);
    expect(judge.inputs).toEqual([]);
    expect(await stored()).toEqual([]);
    expect((await entryOf(a)).connectionsGeneratedAt).toBeInstanceOf(Date);
    expect((await entryOf(a)).connectionsStatus).toBe("idle");
    expect(await ctx.db.select().from(connectionRun)).toMatchObject([{ candidateCount: 0, connectionCount: 0, costUsd: 0 }]);
  });

  it("treats a judge answer of no Connections as success", async () => {
    const a = await finished("Stoner");
    await finished("Lonely");
    const { deps: d } = deps();
    await run(d, a);
    expect(await stored()).toEqual([]);
    expect((await entryOf(a)).connectionsGeneratedAt).toBeInstanceOf(Date);
  });

  it("copies a quote only when it is verbatim in a real Note, and marks the Connection note-grounded", async () => {
    const a = await finished("Stoner", "solitude", { notes: ["He kept the book on his desk and never opened it again."] });
    await finished("Lonely", "solitude", { notes: ["A house with every light off."] });
    const { deps: d } = deps((input) => {
      const own = input.book.notes[0];
      const theirs = byTitle(input, "Lonely").notes[0];
      return {
        connections: [
          link({ candidateId: byTitle(input, "Lonely").id, explanation: `Your note on Stoner, "${own.body}", answers your note on Lonely, "${theirs.body}".`, quotedNoteIds: [own.id, theirs.id] }),
        ],
      };
    });
    await run(d, a);
    const [row] = await stored();
    expect(row.grounding).toBe("notes");
    expect(row.explanation).toContain("He kept the book on his desk and never opened it again.");
    expect(row.quotedNoteIds).toHaveLength(2);
    const notes = await ctx.db.select().from(note);
    expect(row.quotedNoteIds.sort()).toEqual(notes.map((n) => n.id).sort());
  });

  it("drops a Connection whose quoted text is not in the Notes it quotes from", async () => {
    const a = await finished("Stoner", "solitude", { notes: ["He kept the book on his desk."] });
    await finished("Lonely");
    const { deps: d } = deps((input) => ({
      connections: [
        link({ candidateId: byTitle(input, "Lonely").id, explanation: 'Your note on Stoner, "he never kept anything on his desk", disagrees.', quotedNoteIds: [input.book.notes[0].id] }),
      ],
    }));
    await run(d, a);
    expect(await stored()).toEqual([]);
    expect((await entryOf(a)).connectionsGeneratedAt).toBeInstanceOf(Date);
  });

  it("keeps a weak link only when it quotes Notes from both Books, and stores it as weak", async () => {
    const a = await finished("Stoner", "solitude", { notes: ["Alone in a crowded room."] });
    await finished("Lonely", "solitude", { notes: ["Crowded and alone."] });
    await finished("Warlike", "solitude");
    await finished("Seafarer", "solitude");
    const { deps: d } = deps((input) => {
      const lonely = byTitle(input, "Lonely");
      return {
        connections: [
          link({ candidateId: lonely.id, strength: "weak", explanation: `Your note on Stoner, "${input.book.notes[0].body}", echoes your note on Lonely, "${lonely.notes[0].body}".` }),
          link({ candidateId: byTitle(input, "Warlike").id, strength: "weak", explanation: "Faint echo." }),
          link({ candidateId: byTitle(input, "Seafarer").id, strength: "moderate", explanation: "A narrower echo." }),
        ],
      };
    });
    await run(d, a);
    const rows = await stored();
    expect(rows.map((r) => r.explanation).sort()).toEqual([expect.stringContaining("echoes your note"), "A narrower echo."].sort());
    expect(Object.fromEntries(rows.map((r) => [r.explanation.slice(0, 10), r.strength]))).toEqual({ "Your note ": "weak", "A narrower": "moderate" });
  });

  it("ranks a weak link below every moderate one when the cap bites, and shows it last", async () => {
    const a = await finished("Hub", "solitude", { notes: ["Alone in a crowded room."] });
    const weakBook = await finished("W0", "solitude", { notes: ["Crowded and alone."] });
    for (const t of ["M1", "M2", "M3", "M4", "M5"]) await finished(t, "solitude");
    const { deps: d } = deps((input) => ({
      connections: input.candidates.map((c) =>
        c.title === "W0"
          ? link({ candidateId: c.id, strength: "weak", explanation: `Your note on Hub, "${input.book.notes[0].body}", echoes your note on W0, "${c.notes[0].body}".` })
          : link({ candidateId: c.id, strength: "moderate", explanation: `Link to ${c.title}.` }),
      ),
    }));
    await run(d, a);
    expect((await stored()).map((r) => r.strength)).toEqual(["moderate", "moderate", "moderate", "moderate", "moderate"]);
    expect((await readConnections(ctx.db, ctx.userId, weakBook)).cards).toEqual([]);

    // With room to spare, the weak link is kept and listed after the moderate ones.
    await ctx.db.delete(connection);
    await ctx.db.update(libraryEntry).set({ connectionsGeneratedAt: null }).where(eq(libraryEntry.bookId, a));
    const roomy = deps((input) => ({
      connections: input.candidates.filter((c) => ["W0", "M1"].includes(c.title)).map((c) =>
        c.title === "W0"
          ? link({ candidateId: c.id, strength: "weak", explanation: `Your note on Hub, "${input.book.notes[0].body}", echoes your note on W0, "${c.notes[0].body}".` })
          : link({ candidateId: c.id, strength: "moderate", explanation: `Link to ${c.title}.` }),
      ),
    }));
    await run(roomy.deps, a);
    expect((await readConnections(ctx.db, ctx.userId, a)).cards.map((c) => c.strength)).toEqual(["moderate", "weak"]);
  });

  it("stores at most five per run, strongest first and then by similarity", async () => {
    const a = await finished("Hub", "solitude");
    for (const t of ["P1", "P2", "P3"]) await finished(t, "solitude");
    for (const t of ["Q1", "Q2", "Q3"]) await finished(t, "war");
    const { deps: d } = deps((input) => ({
      // The Q Books are less similar to the hub than the P Books; Q1 is strong, the rest moderate.
      connections: input.candidates.map((c) => link({ candidateId: c.id, strength: c.title === "Q1" ? "strong" : "moderate", explanation: `Link to ${c.title}.` })),
    }));
    await run(d, a);
    const rows = await stored();
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.strength === "strong")).toHaveLength(1);
    expect(rows.map((r) => r.explanation)).toContain("Link to Q1.");
  });

  it("marks a Connection between Books with no Notes as not note-grounded", async () => {
    const a = await finished("Stoner");
    await finished("Lonely");
    const { deps: d } = deps((input) => ({ connections: [link({ candidateId: input.candidates[0].id })] }));
    await run(d, a);
    expect((await stored())[0].grounding).toBe("enrichment");
  });

  it("shows the judge each Book's stored title and authors when the reader has overridden neither", async () => {
    const a = await finished("Stoner");
    const b = await finished("Lonely");
    const { judge, deps: d } = deps();
    await run(d, a);
    const stored = async (id: string) => (await ctx.db.select({ title: book.title, authors: book.authors }).from(book).where(eq(book.id, id)))[0];
    expect(judge.inputs[0].book).toMatchObject(await stored(a));
    expect(judge.inputs[0].candidates).toEqual([expect.objectContaining(await stored(b))]);
  });

  it("shows the judge and the Connection card the reader's own title and author", async () => {
    const a = await finished("Stoner");
    const b = await finished("Lonely");
    const override = (id: string, titleOverride: string, authorOverride: string) =>
      ctx.db.update(libraryEntry).set({ titleOverride, authorOverride }).where(eq(libraryEntry.bookId, id));
    await override(a, "Stoner (NYRB)", "John Williams");
    await override(b, "The Lonely City", "Olivia Laing");
    const { judge, deps: d } = deps((input) => ({ connections: [link({ candidateId: input.candidates[0].id })] }));
    await run(d, a);
    expect(judge.inputs[0].book).toMatchObject({ title: "Stoner (NYRB)", authors: ["John Williams"] });
    expect(judge.inputs[0].candidates[0]).toMatchObject({ title: "The Lonely City", authors: ["Olivia Laing"] });
    expect((await readConnections(ctx.db, ctx.userId, a)).cards[0].otherTitle).toBe("The Lonely City");
  });

  it("passes an unrecognised Book's Enrichment as unavailable", async () => {
    const a = await finished("Obscure", "solitude", { notes: ["Strange and quiet."], recognised: false });
    await finished("Lonely");
    const { judge, deps: d } = deps();
    await run(d, a);
    expect(judge.inputs[0].book.enrichment).toBeNull();
  });

  it("does not judge a pair that already has a Connection, so later runs leave it as it was", async () => {
    const a = await finished("Stoner");
    const b = await finished("Lonely");
    const first = deps((input) => ({ connections: [link({ candidateId: input.candidates[0].id, explanation: "First." })] }));
    await run(first.deps, a);
    const second = deps((input) => ({ connections: input.candidates.map((c) => link({ candidateId: c.id, explanation: "Second." })) }));
    await run(second.deps, b);
    expect(second.judge.inputs).toEqual([]);
    expect((await stored()).map((r) => r.explanation)).toEqual(["First."]);
  });

  it("finishes the work the Book still needs first: its Enrichment and its Notes' embeddings", async () => {
    const entry = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/new", title: "Fresh", authors: ["A"] }), "read");
    await finished("Lonely");
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, entry.bookId, { body: "war" });
    const enricher = fakeEnricher({ summary: "Fresh.", themes: ["solitude"] });
    const { judge, deps: d } = deps(undefined, { enrichment: enricher });
    await run(d, entry.bookId);
    expect(enricher.inputs.map((i) => i.title)).toEqual(["Fresh"]);
    expect((await ctx.db.select().from(note).where(eq(note.id, n.id)))[0].embeddingModel).toBe("fake-voyage");
    expect(judge.inputs[0].candidates.map((c) => c.title)).toEqual(["Lonely"]);
  });

  it("does nothing when the Library Entry is gone or the Book is not Finished", async () => {
    const wanted = (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/w", title: "Wanted", authors: ["A"] }), "want")).bookId;
    const { judge, deps: d } = deps();
    await run(d, wanted);
    await run(d, "00000000-0000-0000-0000-000000000000");
    expect(judge.inputs).toEqual([]);
    expect((await entryOf(wanted)).connectionsGeneratedAt).toBeNull();
    expect(await ctx.db.select().from(connectionRun)).toEqual([]);
  });

  it("leaves a failed run retryable: still running until the final attempt, then failed, never generated", async () => {
    const a = await finished("Stoner");
    await finished("Lonely");
    const broken = { ...deps().deps, judge: { ...fakeJudge(), judge: () => Promise.reject(new Error("overloaded")) } };
    await expect(run(broken, a)).rejects.toThrow("overloaded");
    expect((await entryOf(a)).connectionsStatus).toBe("running");
    await expect(run({ ...broken, finalAttempt: true }, a)).rejects.toThrow("overloaded");
    expect(await entryOf(a)).toMatchObject({ connectionsStatus: "failed", connectionsGeneratedAt: null });
    expect(await stored()).toEqual([]);
  });

  // Known bug: the job's Enrichment attempt has no `finalAttempt`, so it writes `pending` back.
  // Becomes a plain `it` once one module owns the Enrichment status.
  it.fails("leaves an Enrichment that failed for good failed when the job's own Enrichment attempt fails", async () => {
    const { bookId } = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/stuck", title: "Stuck", authors: ["A"] }), "read");
    const down = fakeEnricher(() => Promise.reject(new Error("model down")));
    await expect(enrichBook(ctx.db, { model: down, finalAttempt: true }, bookId)).rejects.toThrow("model down");
    expect(await readEnrichment(ctx.db, bookId)).toMatchObject({ status: "failed" });

    await expect(run({ ...deps().deps, enrichment: down, finalAttempt: true }, bookId)).rejects.toThrow("model down");
    // Pending would leave the Book panel waiting with no Try again.
    expect(await readEnrichment(ctx.db, bookId)).toMatchObject({ status: "failed" });
  });

  it("shows a Book's Connections from either side, strongest first, with the other Book's title", async () => {
    const a = await finished("Stoner");
    const b = await finished("Lonely");
    await finished("Warlike", "war");
    const { deps: d } = deps((input) => ({
      connections: [
        link({ candidateId: byTitle(input, "Lonely").id, strength: "moderate", explanation: "Narrower." }),
        link({ candidateId: byTitle(input, "Warlike").id, strength: "strong", explanation: "Wider." }),
      ],
    }));
    await run(d, a);
    const fromLonely = await readConnections(ctx.db, ctx.userId, b);
    // Lonely's own job is queued but not yet run.
    expect(fromLonely).toMatchObject({ cards: [{ otherBookId: a, otherTitle: "Stoner", explanation: "Narrower.", grounding: "enrichment" }], status: "running", generated: false, finished: true });
    const fromStoner = await readConnections(ctx.db, ctx.userId, a);
    expect(fromStoner.generated).toBe(true);
    const wanted = (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/w", title: "Wanted", authors: ["A"] }), "want")).bookId;
    expect(await readConnections(ctx.db, ctx.userId, wanted)).toMatchObject({ cards: [], finished: false });
    expect(fromStoner.cards.map((x) => x.explanation)).toEqual(["Wider.", "Narrower."]);
  });
});

describe("Queueing Connections", () => {
  const ctx = useTestDb();
  const queued = () => ctx.jobs.sent.flatMap((j) => (j.kind === "connections" ? [{ userId: j.userId, bookId: j.bookId }] : []));
  const entryOf = async (bookId: string) => (await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, bookId)))[0];
  const add = (key: string, status: "want" | "reading" | "read") =>
    addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${key}`, title: key, authors: ["A"] }), status);

  it("queues Connections on the first completed Read-through, and marks the Book as finding them", async () => {
    const { bookId } = await add("a", "reading");
    expect(queued()).toEqual([]);
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
    expect(queued()).toEqual([{ userId: ctx.userId, bookId }]);
    expect((await entryOf(bookId)).connectionsStatus).toBe("running");
  });

  it("queues nothing for later completions, a Book added as want, or one moved back to want", async () => {
    const { bookId } = await add("a", "reading");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
    ctx.jobs.sent.length = 0;
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "reading");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "want");
    await add("b", "want");
    expect(queued()).toEqual([]);
  });

  it("does not queue again once Connections were generated", async () => {
    const { bookId } = await add("a", "read");
    await ctx.db.update(libraryEntry).set({ connectionsGeneratedAt: new Date() }).where(eq(libraryEntry.bookId, bookId));
    await ctx.pipeline.bookFinished(ctx.userId, bookId);
    expect(queued()).toHaveLength(1);
  });

  it("queues a Book added directly as read", async () => {
    const { bookId } = await add("a", "read");
    expect(queued()).toEqual([{ userId: ctx.userId, bookId }]);
  });

  it("still changes Status when the queue is down, leaving the Book failed rather than waiting", async () => {
    const { bookId } = await add("a", "reading");
    ctx.jobs.down = true;
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
    expect(await entryOf(bookId)).toMatchObject({ status: "read", connectionsStatus: "failed" });
  });

  it("backfills Finished Books with no Connections yet in finish-date order, unknown dates last", async () => {
    const undated1 = (await add("undated1", "read")).bookId;
    const undated2 = (await add("undated2", "read")).bookId;
    const later = (await add("later", "read")).bookId;
    const earlier = (await add("earlier", "read")).bookId;
    const done = (await add("done", "read")).bookId;
    const unfinished = (await add("unfinished", "want")).bookId;
    const finishedAt = (bookId: string, at: string) =>
      ctx.db.update(readThrough).set({ finishedAt: new Date(at) }).where(eq(readThrough.libraryEntryId, sql`(select id from library_entry where book_id = ${bookId})`));
    await finishedAt(later, "2024-06-01");
    await finishedAt(earlier, "2020-01-01");
    await ctx.db.update(libraryEntry).set({ connectionsGeneratedAt: new Date(), connectionsStatus: "idle" }).where(eq(libraryEntry.bookId, done));
    ctx.jobs.sent.length = 0;

    const count = await backfillConnections(ctx.db, ctx.pipeline, ctx.userId);
    expect(queued().map((j) => j.bookId)).toEqual([earlier, later, undated1, undated2]);
    expect(count).toBe(4);
    expect((await entryOf(unfinished)).connectionsStatus).toBe("idle");
    expect(await countFindingConnections(ctx.db, ctx.userId)).toBe(4);
  });
});

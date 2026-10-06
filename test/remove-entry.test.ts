import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { generateConnections, readConnections, type ConnectionDeps, type JudgeInput } from "../src/domain/connections";
import { embedEnrichment, embedNote } from "../src/domain/embeddings";
import { enrichBook } from "../src/domain/enrichment";
import { readLibrary } from "../src/domain/library";
import { changeStatus, removeFromLibrary } from "../src/domain/library-entry";
import { addNote } from "../src/domain/notes";
import { book, connection, connectionRun, enrichment, libraryEntry, note, readThrough } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, work } from "./fakes";
import { useTestDb } from "./harness";

describe("Removing a Library Entry", () => {
  const ctx = useTestDb();
  const embedder = fakeEmbedder(["solitude"]);
  const queued = () => ctx.jobs.sent.flatMap((j) => (j.kind === "connections" ? [{ userId: j.userId, bookId: j.bookId }] : []));

  const add = (title: string, status: "want" | "reading" | "read") =>
    addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${title}`, title, authors: ["A"] }), status);

  // A Finished Book, enriched and embedded, with Notes; every one of these is near the others.
  async function finished(title: string, notes: string[] = []) {
    const { bookId } = await add(title, "read");
    await enrichBook(ctx.db, { model: fakeEnricher({ summary: `About ${title}.`, themes: ["solitude"] }) }, bookId);
    await embedEnrichment(ctx.db, embedder, bookId);
    for (const body of notes) await embedNote(ctx.db, embedder, (await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body })).id);
    return bookId;
  }

  const remove = (bookId: string) => removeFromLibrary(ctx.db, ctx.userId, bookId);
  const deps = (judge = fakeJudge()): ConnectionDeps => ({ judge, embedder, enrichment: fakeEnricher() });
  const run = (d: ConnectionDeps, bookId: string) => generateConnections(ctx.db, d, { userId: ctx.userId, bookId });
  const linkTo = (title: string) => (input: JudgeInput) => ({
    connections: [
      {
        candidateId: input.candidates.find((c) => c.title === title)!.id,
        type: "thematic" as const,
        strength: "strong" as const,
        explanation: "Both sit with solitude.",
        quotedNoteIds: [],
      },
    ],
  });
  // A judge that removes `bookId` from the library while it is thinking, as the reader might mid-run.
  const removingJudge = (bookId: string, reply: ReturnType<typeof linkTo>) => {
    const inner = fakeJudge(reply);
    return { ...inner, judge: async (input: JudgeInput) => (await remove(bookId), inner.judge(input)) };
  };
  const pairs = async () =>
    (await ctx.db.select().from(connection)).map((c) => [c.bookAId, c.bookBId].sort().join("+")).sort();
  const pair = (x: string, y: string) => [x, y].sort().join("+");

  it("deletes its Notes, Read-throughs and every Connection involving the Book, keeping the shared Book and Enrichment", async () => {
    const stoner = await finished("Stoner", ["A quiet life of work."]);
    const lonely = await finished("Lonely");
    const solitary = await finished("Solitary");
    await run(deps(fakeJudge(linkTo("Lonely"))), stoner);
    await run(deps(fakeJudge(linkTo("Stoner"))), solitary);
    await run(deps(fakeJudge(linkTo("Solitary"))), lonely);
    expect(await pairs()).toEqual([pair(stoner, lonely), pair(stoner, solitary), pair(lonely, solitary)].sort());

    await remove(stoner);

    expect(await pairs()).toEqual([pair(lonely, solitary)]);
    expect(await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, stoner))).toEqual([]);
    expect(await ctx.db.select().from(note)).toEqual([]);
    expect(await ctx.db.select().from(readThrough)).toHaveLength(2);
    expect(await ctx.db.select().from(connectionRun)).toHaveLength(2);
    expect(await ctx.db.select().from(book).where(eq(book.id, stoner))).toHaveLength(1);
    expect((await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, stoner)))[0]).toMatchObject({ summary: "About Stoner." });
    expect((await readLibrary(ctx.db, ctx.userId)).map((i) => i.title).sort()).toEqual(["Lonely", "Solitary"]);
  });

  it("takes the removed Book out of other Books' Connection lists", async () => {
    const stoner = await finished("Stoner");
    const lonely = await finished("Lonely");
    await run(deps(fakeJudge(linkTo("Lonely"))), stoner);
    expect((await readConnections(ctx.db, ctx.userId, lonely)).cards).toHaveLength(1);
    await remove(stoner);
    expect((await readConnections(ctx.db, ctx.userId, lonely)).cards).toEqual([]);
  });

  it("is a no-op for a Book that is not in the library", async () => {
    const lonely = await finished("Lonely");
    await remove(lonely);
    await expect(remove(lonely)).resolves.toBeUndefined();
  });

  it("lets the same Book be added again, as a fresh Entry whose first completion queues Connections", async () => {
    const { bookId } = await add("Stoner", "reading");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
    await ctx.db.update(libraryEntry).set({ connectionsStatus: "idle", connectionsGeneratedAt: new Date() }).where(eq(libraryEntry.bookId, bookId));
    await remove(bookId);
    ctx.jobs.sent.length = 0;

    const again = await add("Stoner", "reading");
    expect(again.bookId).toBe(bookId);
    expect(await ctx.db.select().from(book)).toHaveLength(1);
    expect(await readLibrary(ctx.db, ctx.userId)).toMatchObject([{ bookId, status: "reading", finished: false }]);

    const { firstCompletion } = await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
    expect(firstCompletion).toBe(true);
    expect(queued()).toEqual([{ userId: ctx.userId, bookId }]);
  });

  it("leaves a Connections job queued for a removed Book with nothing to do", async () => {
    const stoner = await finished("Stoner");
    await finished("Lonely");
    await remove(stoner);
    const judge = fakeJudge(linkTo("Lonely"));
    await run(deps(judge), stoner);
    expect(judge.inputs).toEqual([]);
    expect(await pairs()).toEqual([]);
  });

  it("stores nothing when the Book is removed while its Connections job is running", async () => {
    const stoner = await finished("Stoner", ["A quiet life of work."]);
    await finished("Lonely");
    await run(deps(removingJudge(stoner, linkTo("Lonely"))), stoner);
    expect(await pairs()).toEqual([]);
    expect(await ctx.db.select().from(connectionRun)).toEqual([]);
  });

  it("stores nothing, quietly, when the Book is removed and added again while its job is running", async () => {
    const stoner = await finished("Stoner");
    await finished("Lonely");
    const inner = fakeJudge(linkTo("Lonely"));
    const judge = { ...inner, judge: async (input: JudgeInput) => (await remove(stoner), await add("Stoner", "want"), inner.judge(input)) };
    await run(deps(judge), stoner);
    expect(await pairs()).toEqual([]);
    expect(await ctx.db.select().from(connectionRun)).toEqual([]);
  });

  it("drops a Connection to a Book removed while another Book's job is running", async () => {
    const stoner = await finished("Stoner");
    const lonely = await finished("Lonely");
    await run(deps(removingJudge(lonely, linkTo("Lonely"))), stoner);
    expect(await pairs()).toEqual([]);
    const [entry] = await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, stoner));
    expect(entry.connectionsGeneratedAt).toBeInstanceOf(Date);
  });

  it("leaves an embed job for a removed Book's Note with nothing to do", async () => {
    const { bookId } = await add("Stoner", "reading");
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "On solitude." });
    await remove(bookId);
    const calls = embedder.calls.length;
    await embedNote(ctx.db, embedder, n.id);
    expect(embedder.calls).toHaveLength(calls);
  });
});

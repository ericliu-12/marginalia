import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { pairOf } from "../src/domain/connection-pair";
import {
  AlreadyConnectedError,
  createManualConnection,
  deleteManualConnection,
  dropNotesOnlyBreaches,
  editManualConnection,
  generateConnections,
  InvalidConnectionError,
  notesOnlyBreaches,
  readConnectCandidates,
  readConnection,
  readConnections,
  REASON_MAX,
  type ConnectionDeps,
  type ConnectionJudge,
  type ManualConnectionInput,
} from "../src/domain/connections";
import { embedEnrichment } from "../src/domain/embeddings";
import { enrichBook } from "../src/domain/enrichment";
import { DISPLAY_CAP, readGraph } from "../src/domain/graph";
import { changeStatus, NotInLibraryError, removeFromLibrary } from "../src/domain/library-entry";
import type { JobDeps } from "../src/domain/pipeline";
import { connection, paidCall } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work, type FakeJudgeReply } from "./fakes";
import { addReader, useTestDb } from "./harness";

describe("Manual Connections", () => {
  const ctx = useTestDb();
  const embedder = fakeEmbedder(["solitude"]);

  // A Finished Book, enriched and embedded, all near each other.
  async function finished(title: string, opts: { recognised?: boolean; userId?: string } = {}) {
    const entry = await addBook(ctx.db, ctx.pipeline, opts.userId ?? ctx.userId, work({ workKey: `/works/${title}`, title, authors: ["A"] }), "read");
    await enrichBook(ctx.db, { model: fakeEnricher({ summary: `About ${title}.`, themes: ["solitude"], recognised: opts.recognised ?? true }) }, entry.bookId);
    await embedEnrichment(ctx.db, embedder, entry.bookId);
    return entry.bookId;
  }

  const connect = (bookId: string, otherBookId: string, rest: Partial<ManualConnectionInput> = {}) =>
    createManualConnection(ctx.db, ctx.pipeline, ctx.userId, { bookId, otherBookId, reason: "Read the same winter.", ...rest });
  const stored = () => ctx.db.select().from(connection);
  const pairRow = async (x: string, y: string) => {
    const [a, b] = [x, y].sort();
    return (await ctx.db.select().from(connection).where(and(eq(connection.bookAId, a), eq(connection.bookBId, b))))[0];
  };

  // The judge links the Book to every candidate it is shown.
  const linkAll: FakeJudgeReply = (input) => ({
    connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic", strength: "moderate", explanation: "The judge's reason.", quotedNoteIds: [] })),
  });
  const judgeDeps = (judge: ConnectionJudge): ConnectionDeps => ({ judge, embedder });
  const judgeRun = (judge: ConnectionJudge, bookId: string) => generateConnections(ctx.db, judgeDeps(judge), { userId: ctx.userId, bookId });
  const refresh = async (judge: ConnectionJudge, bookId: string) => {
    await ctx.pipeline.refreshRequested(ctx.userId, bookId);
    await judgeRun(judge, bookId);
  };

  describe("making one", () => {
    it("stores a strong Connection with the reader's reason and type, no judge fields, and asks for the graph job without a paid call", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      ctx.jobs.sent.length = 0;
      const { id } = await connect(a, b, { type: "contrast" });

      expect(await stored()).toEqual([
        expect.objectContaining({
          id,
          userId: ctx.userId,
          bookAId: [a, b].sort()[0],
          bookBId: [a, b].sort()[1],
          madeBy: "reader",
          type: "contrast",
          strength: "strong",
          explanation: "Read the same winter.",
          similarity: null,
          similarityModel: null,
          grounding: null,
          quotedNoteIds: [],
          model: null,
          promptVersion: null,
          dismissedAt: null,
        }),
      ]);
      expect(ctx.jobs.sent).toEqual([{ kind: "graph", userId: ctx.userId }]);
      expect(await ctx.db.select().from(paidCall)).toEqual([]);
    });

    it("leaves the type out when the reader gives none", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      await connect(a, b);
      expect(await pairRow(a, b)).toMatchObject({ type: null, strength: "strong" });
    });

    it("keeps the reason on one line, trimmed, and holds it to 1–200 characters", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      const c = await finished("Warlike");
      await expect(connect(a, b, { reason: "  \n " })).rejects.toThrow(InvalidConnectionError);
      await expect(connect(a, b, { reason: "x".repeat(REASON_MAX + 1) })).rejects.toThrow(InvalidConnectionError);
      // Newlines and their spaces count as one space.
      await expect(connect(a, b, { reason: `${"x".repeat(100)}\n\n   ${"y".repeat(100)}` })).rejects.toThrow(InvalidConnectionError);
      expect(await stored()).toEqual([]);

      await connect(a, b, { reason: "  Both, in the end,\r\n  about   staying.\n" });
      expect((await pairRow(a, b)).explanation).toBe("Both, in the end, about   staying.");
      // Exactly 200, counted in characters, not UTF-16 units.
      const longest = "é".repeat(REASON_MAX - 1) + "📚";
      await connect(a, c, { reason: longest });
      expect((await pairRow(a, c)).explanation).toBe(longest);
    });

    it("connects only Finished Books: a Book being re-read counts, one never finished does not", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      const reading = (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/r", title: "Reading", authors: ["A"] }), "reading")).bookId;
      await expect(connect(a, reading)).rejects.toThrow(InvalidConnectionError);
      await expect(connect(reading, a)).rejects.toThrow(InvalidConnectionError);

      await changeStatus(ctx.db, ctx.pipeline, ctx.userId, b, "reading");
      await connect(a, b);
      expect(await pairRow(a, b)).toMatchObject({ madeBy: "reader", dismissedAt: null });
    });

    it("connects only the reader's own Books, and never a Book to itself", async () => {
      const a = await finished("Stoner");
      const second = (await addReader(ctx.db, "second@marginalia.local")).id;
      const theirs = await finished("Theirs", { userId: second });
      await expect(connect(a, theirs)).rejects.toThrow(NotInLibraryError);
      await expect(connect(a, a)).rejects.toThrow(InvalidConnectionError);
      expect(await stored()).toEqual([]);
    });
  });

  describe("one per pair", () => {
    async function judged() {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      await judgeRun(fakeJudge(linkAll), a);
      expect(await pairRow(a, b)).toMatchObject({ madeBy: "judge", explanation: "The judge's reason." });
      return { a, b };
    }

    it("replaces the judge's Connection of the pair", async () => {
      const { a, b } = await judged();
      const before = await pairRow(a, b);
      await connect(b, a, { type: "context" });
      expect(await stored()).toEqual([
        expect.objectContaining({ id: before.id, madeBy: "reader", type: "context", strength: "strong", explanation: "Read the same winter.", similarity: null, grounding: null, model: null }),
      ]);
    });

    it("replaces a dismissed judge Connection, so a dismissed pair can still be connected by hand", async () => {
      const { a, b } = await judged();
      await ctx.db.update(connection).set({ dismissedAt: new Date() });
      await connect(a, b);
      expect(await stored()).toEqual([expect.objectContaining({ madeBy: "reader", dismissedAt: null, explanation: "Read the same winter." })]);
      expect((await readConnections(ctx.db, ctx.userId, a)).cards).toHaveLength(1);
    });

    it("refuses a second Manual Connection of the pair, from either side, and leaves the first", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      await connect(a, b, { reason: "First." });
      await expect(connect(a, b, { reason: "Second." })).rejects.toThrow(AlreadyConnectedError);
      await expect(connect(b, a, { reason: "Third." })).rejects.toThrow(AlreadyConnectedError);
      expect((await stored()).map((r) => r.explanation)).toEqual(["First."]);
    });

    it("lets the reader connect again a pair whose Manual Connection they deleted", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      await connect(a, b, { reason: "First." });
      await ctx.db.update(connection).set({ dismissedAt: new Date(), explanation: "", type: null });
      await connect(a, b, { reason: "Again." });
      expect(await stored()).toEqual([expect.objectContaining({ madeBy: "reader", dismissedAt: null, explanation: "Again." })]);
    });
  });

  describe("choosing the other Book", () => {
    const candidates = (bookId: string) => readConnectCandidates(ctx.db, ctx.userId, bookId);

    it("offers the reader's other Finished Books, most recently finished first, less this one and those already connected by hand", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      const c = await finished("Warlike");
      await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/r", title: "Reading", authors: ["A"] }), "reading");
      await finished("Theirs", { userId: (await addReader(ctx.db, "other@example.com")).id });
      await connect(a, c);
      expect(await candidates(a)).toEqual([{ bookId: b, title: "Lonely", authors: ["A"], replaces: null }]);
      expect((await candidates(b)).map((x) => x.title)).toEqual(["Warlike", "Stoner"]);
    });

    it("says which judge Connection of the pair it would replace; a dismissed one is not mentioned", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      const c = await finished("Warlike");
      await judgeRun(fakeJudge(linkAll), a);
      await ctx.db.update(connection).set({ dismissedAt: new Date() }).where(eq(connection.id, (await pairRow(a, c)).id));
      expect(await candidates(a)).toEqual([
        { bookId: c, title: "Warlike", authors: ["A"], replaces: null },
        { bookId: b, title: "Lonely", authors: ["A"], replaces: { type: "thematic", strength: "moderate", explanation: "The judge's reason." } },
      ]);
    });

    it("offers nothing, and the panel no way to connect, until there are two Finished Books", async () => {
      const a = await finished("Stoner");
      const reading = (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/r", title: "Reading", authors: ["A"] }), "reading")).bookId;
      expect(await candidates(a)).toEqual([]);
      expect((await readConnections(ctx.db, ctx.userId, a)).canConnect).toBe(false);
      const b = await finished("Lonely");
      expect((await readConnections(ctx.db, ctx.userId, a)).canConnect).toBe(true);
      expect((await readConnections(ctx.db, ctx.userId, reading)).canConnect).toBe(false);
      expect(await candidates(reading)).toEqual([]);
      await connect(a, b);
      expect((await readConnections(ctx.db, ctx.userId, a)).cards).toEqual([expect.objectContaining({ otherBookId: b, madeBy: "reader" })]);
    });
  });

  describe("the judge leaves it alone", () => {
    it("never judges a pair the reader has connected on a first run", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      await finished("Warlike");
      await connect(a, b);
      const judge = fakeJudge(linkAll);
      await judgeRun(judge, a);
      expect(judge.inputs[0].candidates.map((x) => x.title)).toEqual(["Warlike"]);
      expect(await pairRow(a, b)).toMatchObject({ madeBy: "reader", explanation: "Read the same winter." });
    });

    it("never judges or changes it on a Refresh", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      await finished("Warlike");
      await judgeRun(fakeJudge(linkAll), a);
      await connect(a, b);
      const judge = fakeJudge(linkAll);
      await refresh(judge, a);
      expect(judge.inputs[0].candidates.map((x) => x.title)).toEqual(["Warlike"]);
      expect(await pairRow(a, b)).toMatchObject({ madeBy: "reader", type: null, strength: "strong", explanation: "Read the same winter." });
    });

    it("keeps one made while a Refresh is judging the pair", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      await judgeRun(fakeJudge(linkAll), a);
      const inner = fakeJudge(linkAll);
      const racing: ConnectionJudge = {
        ...inner,
        async judge(input) {
          await connect(a, b);
          return inner.judge(input);
        },
      };
      await refresh(racing, a);
      expect(inner.inputs[0].candidates.map((x) => x.title)).toEqual(["Lonely"]);
      expect(await pairRow(a, b)).toMatchObject({ madeBy: "reader", explanation: "Read the same winter." });
    });

    it("is never deleted by the rule for an unrecognised Book", async () => {
      const a = await finished("Stoner");
      const unknown = await finished("Unknown", { recognised: false });
      const c = await finished("Warlike");
      await connect(a, unknown);
      // A judge Connection of the same Book that quotes no Notes is what the rule removes.
      await ctx.db.insert(connection).values({
        userId: ctx.userId, bookAId: pairOf(unknown, c).a, bookBId: pairOf(unknown, c).b,
        type: "thematic", strength: "moderate", similarity: 0.5, similarityModel: "m", explanation: "Unquoted.", grounding: "enrichment", model: "m", promptVersion: "p",
      });
      expect(await notesOnlyBreaches(ctx.db, unknown)).toEqual([ctx.userId]);
      await dropNotesOnlyBreaches(ctx.db, ctx.userId, unknown);
      expect(await stored()).toEqual([expect.objectContaining({ madeBy: "reader", explanation: "Read the same winter." })]);
      expect(await notesOnlyBreaches(ctx.db, unknown)).toEqual([]);
    });
  });

  it("comes first in the Book panel, newest first, before the judge's strongest", async () => {
    const a = await finished("Hub");
    await finished("Judged");
    const [older, newer] = [await finished("Older"), await finished("Newer")];
    const toJudged: FakeJudgeReply = (input) => ({
      connections: [{ candidateId: input.candidates.find((c) => c.title === "Judged")!.id, type: "thematic", strength: "strong", explanation: "Judged.", quotedNoteIds: [] }],
    });
    await judgeRun(fakeJudge(toJudged), a);
    await connect(a, older, { reason: "Older." });
    await connect(newer, a, { reason: "Newer." });
    const cards = (await readConnections(ctx.db, ctx.userId, a)).cards;
    expect(cards.map((c) => c.explanation)).toEqual(["Newer.", "Older.", "Judged."]);
    expect(cards[0]).toMatchObject({ otherBookId: newer, type: null, strength: "strong", grounding: null });
  });

  it("is the reader's on the graph, shown at rest ahead of a Book's strongest judge Connections, and when chosen", async () => {
    const hub = await finished("Hub");
    for (let i = 0; i < DISPLAY_CAP; i++) await finished(`Judged ${i}`);
    const linkStrong: FakeJudgeReply = (input) => ({
      connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic", strength: "strong", explanation: "Judged.", quotedNoteIds: [] })),
    });
    await judgeRun(fakeJudge(linkStrong), hub);
    const { id } = await connect(hub, await finished("Mine"), { reason: "Mine." });

    const shown = (await readGraph(ctx.db, ctx.userId)).connections;
    expect(shown.find((c) => c.id === id)).toMatchObject({ madeBy: "reader", strength: "strong", type: null, featured: true });
    expect(shown.filter((c) => c.id !== id).every((c) => c.madeBy === "judge")).toBe(true);
    expect(await readConnection(ctx.db, ctx.userId, id)).toMatchObject({ madeBy: "reader", explanation: "Mine.", type: null });
  });

  describe("editing and deleting", () => {
    const edit = (id: string, change: { type?: "thematic" | "contrast" | "context" | null; reason: string }, userId = ctx.userId) =>
      editManualConnection(ctx.db, ctx.pipeline, userId, id, change);
    const del = (id: string, userId = ctx.userId) => deleteManualConnection(ctx.db, ctx.pipeline, userId, id);

    it("changes the reason, validated as when made, and asks for no graph job when only the reason changes", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      const { id } = await connect(a, b, { type: "context" });
      ctx.jobs.sent.length = 0;
      await expect(edit(id, { type: "context", reason: " \n " })).rejects.toThrow(InvalidConnectionError);
      await expect(edit(id, { type: "context", reason: "x".repeat(REASON_MAX + 1) })).rejects.toThrow(InvalidConnectionError);
      await edit(id, { type: "context", reason: "  Both,\n  in the end.\n" });
      expect(await pairRow(a, b)).toMatchObject({ id, madeBy: "reader", type: "context", strength: "strong", explanation: "Both, in the end.", dismissedAt: null });
      expect(ctx.jobs.sent).toEqual([]);
    });

    it("changes the type, or clears it, and the reader's Clusters are recomputed", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      const { id } = await connect(a, b);
      ctx.jobs.sent.length = 0;
      await edit(id, { type: "thematic", reason: "Read the same winter." });
      expect(await pairRow(a, b)).toMatchObject({ type: "thematic", explanation: "Read the same winter." });
      expect(ctx.jobs.sent).toEqual([{ kind: "graph", userId: ctx.userId }]);
      await edit(id, { reason: "Read the same winter." });
      expect(await pairRow(a, b)).toMatchObject({ type: null });
    });

    it("can't touch a judge's Connection, a deleted one, or another reader's", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      const c = await finished("Warlike");
      await connect(a, b);
      await judgeRun(fakeJudge(linkAll), a);
      const judged = await pairRow(a, c);
      await expect(edit(judged.id, { reason: "Mine now." })).rejects.toThrow(InvalidConnectionError);
      await del(judged.id);
      expect(await pairRow(a, c)).toEqual(judged);

      const mine = await pairRow(a, b);
      const second = (await addReader(ctx.db, "second@marginalia.local")).id;
      await expect(edit(mine.id, { reason: "Theirs." }, second)).rejects.toThrow(InvalidConnectionError);
      await del(mine.id, second);
      expect(await pairRow(a, b)).toEqual(mine);

      await del(mine.id);
      await expect(edit(mine.id, { reason: "Back." })).rejects.toThrow(InvalidConnectionError);
    });

    it("deletes it as a dismissal that keeps none of the reader's words, and the graph job is asked for", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      const { id } = await connect(a, b, { type: "contrast" });
      ctx.jobs.sent.length = 0;
      await del(id);
      expect(await stored()).toEqual([
        expect.objectContaining({ id, madeBy: "reader", type: null, explanation: "", dismissedAt: expect.any(Date) }),
      ]);
      expect(ctx.jobs.sent).toEqual([{ kind: "graph", userId: ctx.userId }]);
      expect((await readConnections(ctx.db, ctx.userId, a)).cards).toEqual([]);
      expect(await readConnection(ctx.db, ctx.userId, id)).toBeNull();
      // Deleting it again changes nothing.
      ctx.jobs.sent.length = 0;
      await del(id);
      expect(ctx.jobs.sent).toEqual([]);
    });

    it("leaves the pair unjudged on the first run and every Refresh, and lets the reader connect it again", async () => {
      const a = await finished("Stoner");
      const b = await finished("Lonely");
      await finished("Warlike");
      const { id } = await connect(a, b);
      await del(id);
      const judge = fakeJudge(linkAll);
      await judgeRun(judge, b);
      await refresh(judge, a);
      expect(judge.inputs.map((i) => i.candidates.map((x) => x.title))).toEqual([["Warlike"], ["Warlike"]]);
      expect(await pairRow(a, b)).toMatchObject({ id, madeBy: "reader", explanation: "", dismissedAt: expect.any(Date) });

      expect((await readConnectCandidates(ctx.db, ctx.userId, a)).map((x) => x.title)).toContain("Lonely");
      await connect(b, a, { reason: "Again." });
      expect(await pairRow(a, b)).toMatchObject({ id, madeBy: "reader", explanation: "Again.", dismissedAt: null });
    });
  });

  describe("in Clusters", () => {
    // Background work whose judge finds nothing: only the Manual Connections count.
    const deps = (namer = fakeNamer()): JobDeps => ({
      model: fakeEnricher({ themes: ["quiet"] }),
      judge: fakeJudge(),
      embedder: fakeEmbedder(["quiet"]),
      descriptions: null,
      namer,
    });

    it("forms a Cluster from Manual Connections alone, and its reasons are what the name is drawn from", async () => {
      const [a, b, c] = [await finished("A"), await finished("B"), await finished("C")];
      await ctx.jobs.drain(deps());
      await connect(a, b, { reason: "Both kept bees." });
      await connect(b, c, { reason: "Both left home late." });
      const namer = fakeNamer();
      await ctx.jobs.drain(deps(namer));

      const [cluster] = (await readGraph(ctx.db, ctx.userId)).clusters;
      expect([...cluster.bookIds].sort()).toEqual([a, b, c].sort());
      expect(namer.inputs.at(-1)!.connections.map((x) => x.explanation).sort()).toEqual(["Both kept bees.", "Both left home late."]);
      expect((await readGraph(ctx.db, ctx.userId)).connections).toEqual(
        expect.arrayContaining([expect.objectContaining({ strength: "strong", type: null, featured: true })]),
      );
    });

    it("dissolves the Cluster it held together on the next graph job once deleted", async () => {
      const [a, b, c] = [await finished("A"), await finished("B"), await finished("C")];
      await ctx.jobs.drain(deps());
      await connect(a, b);
      const { id } = await connect(b, c);
      await ctx.jobs.drain(deps());
      expect((await readGraph(ctx.db, ctx.userId)).clusters).toHaveLength(1);

      await deleteManualConnection(ctx.db, ctx.pipeline, ctx.userId, id);
      await ctx.jobs.drain(deps());
      const graph = await readGraph(ctx.db, ctx.userId);
      expect(graph.clusters).toEqual([]);
      expect(graph.connections.map((x) => x.id)).not.toContain(id);
    });

    it("goes with either Book when it leaves the library", async () => {
      const [a, b] = [await finished("A"), await finished("B")];
      await connect(a, b);
      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, b);
      expect(await stored()).toEqual([]);
    });
  });
});

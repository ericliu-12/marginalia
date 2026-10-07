import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { dismissConnection, readConnections, type JudgeInput } from "../src/domain/connections";
import { backfillEmbeddings } from "../src/domain/embeddings";
import { readEnrichment, tryAgain } from "../src/domain/enrichment";
import { clearGraphMark, readGraph, readGraphMark } from "../src/domain/graph";
import { changeStatus, removeFromLibrary } from "../src/domain/library-entry";
import { addNote, updateNote } from "../src/domain/notes";
import { RETRIES, jobGaveUp, type JobDeps } from "../src/domain/pipeline";
import { connection, connectionRun, enrichment, libraryEntry, note } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { useTestDb } from "./harness";

// The background work as the Pipeline runs it, over the in-memory queue.
describe("Pipeline", () => {
  const ctx = useTestDb();
  const deps = (over: Partial<JobDeps> = {}): JobDeps => ({
    model: fakeEnricher({ themes: ["quiet"] }),
    judge: fakeJudge((input) => ({
      connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic", strength: "strong", explanation: "Both are quiet.", quotedNoteIds: [] })),
    })),
    embedder: fakeEmbedder(["quiet"]),
    descriptions: null,
    namer: fakeNamer(),
    ...over,
  });
  const add = (key: string, status: "want" | "reading" | "read" = "want") =>
    addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${key}`, title: key, authors: ["A"] }), status);
  const enrichmentRow = async (bookId: string) => (await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, bookId)))[0];

  it("enriches an added Book, then embeds its Enrichment", async () => {
    const { bookId } = await add("a");
    await ctx.jobs.drain(deps());
    expect(await enrichmentRow(bookId)).toMatchObject({ status: "ready", embeddingModel: "fake-voyage" });
  });

  it("embeds a saved Note", async () => {
    const { bookId } = await add("a");
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "Very quiet." });
    await ctx.jobs.drain(deps());
    expect((await ctx.db.select().from(note).where(eq(note.id, n.id)))[0].embeddingModel).toBe("fake-voyage");
  });

  it("enriches a Book once when it is queued twice before running", async () => {
    const { bookId } = await add("a");
    await ctx.pipeline.bookAdded(bookId);
    const model = fakeEnricher();
    await ctx.jobs.drain(deps({ model }));
    expect(model.inputs).toHaveLength(1);
  });

  it("retries a failing Enrichment, and reads it as failed only after the last attempt", async () => {
    const { bookId } = await add("a");
    let attempts = 0;
    const flaky = fakeEnricher(() => (attempts++ < 2 ? Promise.reject(new Error("overloaded")) : {}));
    await ctx.jobs.drain(deps({ model: flaky }));
    expect(await readEnrichment(ctx.db, bookId)).toMatchObject({ status: "ready" });

    const other = await add("b");
    const down = fakeEnricher(() => Promise.reject(new Error("down")));
    await ctx.jobs.drain(deps({ model: down }));
    expect(down.inputs).toHaveLength(RETRIES.enrich + 1);
    expect(await readEnrichment(ctx.db, other.bookId)).toMatchObject({ status: "failed" });
  });

  it("finds Connections for a Book once it is first finished", async () => {
    const first = await add("first", "read");
    const second = await add("second", "reading");
    await ctx.jobs.drain(deps());
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, second.bookId, "read");
    await ctx.jobs.drain(deps());
    expect((await readConnections(ctx.db, ctx.userId, second.bookId)).cards.map((c) => c.otherBookId)).toEqual([first.bookId]);
  });

  it("runs a requested Refresh after Connections were generated, judging existing pairs again", async () => {
    const first = await add("first", "read");
    const second = await add("second", "read");
    await ctx.jobs.drain(deps());
    const judge = fakeJudge();
    await ctx.pipeline.refreshRequested(ctx.userId, first.bookId);
    expect(await readConnections(ctx.db, ctx.userId, first.bookId)).toMatchObject({ status: "running" });
    await ctx.jobs.drain(deps({ judge }));
    expect(judge.inputs.map((i) => i.candidates.map((c) => c.title))).toEqual([["second"]]);
    expect(await readConnections(ctx.db, ctx.userId, first.bookId)).toMatchObject({ status: "idle", cards: [{ otherBookId: second.bookId }] });
  });

  it("merges a Refresh requested while the Book's Connections job runs into that job", async () => {
    const first = await add("first", "read");
    await add("second", "read");
    await ctx.jobs.drain(deps());
    await ctx.pipeline.refreshRequested(ctx.userId, first.bookId);
    ctx.jobs.sent.length = 0;
    const judge = fakeJudge((input) => ({
      connections: input.candidates.map((c) => ({ candidateId: c.id, type: "contrast", strength: "strong", explanation: "Again.", quotedNoteIds: [] })),
    }));
    // The reader asks again while the judge is still answering.
    const midRun = { ...judge, judge: async (input: JudgeInput) => (await ctx.pipeline.refreshRequested(ctx.userId, first.bookId), judge.judge(input)) };
    await ctx.jobs.drain(deps({ judge: midRun }));
    expect(ctx.jobs.sent.filter((j) => j.kind === "connections")).toHaveLength(1);
    expect(judge.inputs).toHaveLength(1);
    expect(await readConnections(ctx.db, ctx.userId, first.bookId)).toMatchObject({ status: "idle", cards: [{ explanation: "Again." }] });
  });

  it("ignores a Refresh for a Book that is not Finished", async () => {
    const { bookId } = await add("wanted");
    await ctx.pipeline.refreshRequested(ctx.userId, bookId);
    expect(ctx.jobs.sent.filter((j) => j.kind === "connections")).toEqual([]);
  });

  it("adds a Book and saves a Note while the queue is down, and the Note stops holding Connections back", async () => {
    ctx.jobs.down = true;
    const { bookId } = await add("a", "read");
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "Kept." });
    expect(n).toMatchObject({ body: "Kept." });
    expect((await ctx.db.select().from(note).where(eq(note.id, n.id)))[0].embedFailedAt).toBeInstanceOf(Date);
  });

  describe("Connections behind settled Enrichment and Note vectors", () => {
    const link = (explanation: (title: string) => string) =>
      fakeJudge((input) => ({
        connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic" as const, strength: "strong" as const, explanation: explanation(c.title), quotedNoteIds: [] })),
      }));
    const finishWithNote = async (key: string, body: string, d: JobDeps) => {
      const { bookId } = await add(key, "reading");
      await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body });
      await ctx.jobs.drain(d);
      await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
      return bookId;
    };
    const runs = () => ctx.db.select().from(connectionRun).orderBy(connectionRun.createdAt);
    const dismiss = (x: string, y: string) => {
      const [a, b] = [x, y].sort();
      return ctx.db.update(connection).set({ dismissedAt: new Date() }).where(and(eq(connection.bookAId, a), eq(connection.bookBId, b)));
    };

    it("waits for the Book's Enrichment and Note vectors, then judges with both", async () => {
      await add("other", "read");
      await ctx.jobs.drain(deps());
      const { bookId } = await add("fresh", "read");
      await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "A quiet note." });
      const judge = link((t) => `Like ${t}.`);
      await ctx.jobs.drain(deps({ judge }));
      expect(judge.inputs).toHaveLength(1);
      expect(judge.inputs[0].book).toMatchObject({ enrichment: expect.any(String), notes: [{ body: "A quiet note." }] });
    });

    it("still runs when a Note's embedding fails for good, leaving that Note out", async () => {
      await add("other", "read");
      await ctx.jobs.drain(deps());
      const { bookId } = await add("mixed", "reading");
      await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "A quiet note." });
      await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "A broken note." });
      const base = fakeEmbedder(["quiet"]);
      const embedder = { ...base, embed: (texts: string[], t: "document" | "query") => (texts.some((x) => x.includes("broken")) ? Promise.reject(new Error("429")) : base.embed(texts, t)) };
      await ctx.jobs.drain(deps({ embedder }));
      await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
      const judge = link((t) => `Like ${t}.`);
      await ctx.jobs.drain(deps({ judge, embedder }));
      expect(judge.inputs[0].book.notes.map((n) => n.body)).toEqual(["A quiet note."]);
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "idle", generated: true, cards: [{ explanation: "Like other." }] });
    });

    it("judges a Book whose Enrichment failed on its Notes, then Refreshes it once a recognised Enrichment arrives", async () => {
      const other = await finishWithNote("other", "Another quiet note.", deps());
      const gone = await finishWithNote("gone", "A third quiet note.", deps());
      await ctx.jobs.drain(deps());
      const failing = fakeEnricher(() => Promise.reject(new Error("model down")));
      const stuck = await finishWithNote("stuck", "A quiet note.", deps({ model: failing }));
      await ctx.jobs.drain(deps({ model: failing, judge: link((t) => `First take on ${t}.`) }));
      expect(await readEnrichment(ctx.db, stuck)).toMatchObject({ status: "failed" });
      expect((await readConnections(ctx.db, ctx.userId, stuck)).cards.map((c) => c.explanation).sort()).toEqual(["First take on gone.", "First take on other."]);
      expect((await runs()).at(-1)).toMatchObject({ withoutEnrichment: true });

      await dismiss(stuck, gone);
      expect(await tryAgain(ctx.db, ctx.pipeline, ctx.userId, stuck)).toBe(true);
      const judge = link((t) => `Second take on ${t}.`);
      await ctx.jobs.drain(deps({ judge }));
      expect(judge.inputs).toHaveLength(1);
      expect(judge.inputs[0].book.enrichment).toEqual(expect.any(String));
      expect(judge.inputs[0].candidates.map((c) => c.title)).toEqual(["other"]);
      const rows = (await ctx.db.select().from(connection)).filter((r) => [r.bookAId, r.bookBId].includes(stuck));
      expect(rows.map((r) => [r.explanation, !!r.dismissedAt]).sort()).toEqual([
        ["First take on gone.", true],
        ["Second take on other.", false],
      ]);
      expect((await runs()).at(-1)).toMatchObject({ withoutEnrichment: false });

      // Once only: nothing more runs.
      await ctx.pipeline.bookAdded(stuck);
      await ctx.jobs.drain(deps({ judge }));
      expect(judge.inputs).toHaveLength(1);
      expect((await readConnections(ctx.db, ctx.userId, other)).status).toBe("idle");
    });

    describe("a Note that gave up on its vector", () => {
      const failingEmbedder = () => {
        const base = fakeEmbedder(["quiet"]);
        return { ...base, embed: (texts: string[], t: "document" | "query") => (texts.some((x) => x.includes("late")) ? Promise.reject(new Error("429")) : base.embed(texts, t)) };
      };
      const noteRow = async (id: string) => (await ctx.db.select().from(note).where(eq(note.id, id)))[0];
      async function gaveUp() {
        const { bookId } = await add("book", "reading");
        const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "A late quiet note." });
        await ctx.jobs.drain(deps({ embedder: failingEmbedder() }));
        expect(await noteRow(n.id)).toMatchObject({ embedding: null, embedFailedAt: expect.any(Date) });
        return { bookId, noteId: n.id };
      }

      it("is queued again by the embed backfill, which clears the give-up once it has a vector", async () => {
        const { noteId } = await gaveUp();
        ctx.jobs.sent.length = 0;
        await backfillEmbeddings(ctx.db, ctx.jobs, "fake-voyage");
        expect(ctx.jobs.sent).toContainEqual({ kind: "embed", target: { kind: "note", id: noteId } });
        await ctx.jobs.drain(deps());
        expect(await noteRow(noteId)).toMatchObject({ embeddingModel: "fake-voyage", embedFailedAt: null });
      });

      it("is no longer given up once edited", async () => {
        const { noteId } = await gaveUp();
        await updateNote(ctx.db, ctx.pipeline, ctx.userId, noteId, { body: "A quiet note, rewritten." });
        expect(await noteRow(noteId)).toMatchObject({ embedFailedAt: null });
      });

      it("is shown to the judge in the next Refresh once it has a vector", async () => {
        await finishWithNote("other", "Another quiet note.", deps());
        const { bookId, noteId } = await gaveUp();
        await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
        const first = link((t) => `Like ${t}.`);
        await ctx.jobs.drain(deps({ judge: first, embedder: failingEmbedder() }));
        expect(first.inputs[0].book.notes).toEqual([]);

        await backfillEmbeddings(ctx.db, ctx.jobs, "fake-voyage");
        await ctx.jobs.drain(deps());
        await ctx.pipeline.refreshRequested(ctx.userId, bookId);
        const second = link((t) => `Like ${t}.`);
        await ctx.jobs.drain(deps({ judge: second }));
        expect(second.inputs[0].book.notes.map((n) => n.body)).toEqual(["A late quiet note."]);
        expect((await noteRow(noteId)).embedFailedAt).toBeNull();
      });
    });

    it("does not Refresh when the Enrichment that arrives is unrecognised", async () => {
      await finishWithNote("other", "Another quiet note.", deps());
      const failing = fakeEnricher(() => Promise.reject(new Error("model down")));
      const stuck = await finishWithNote("stuck", "A quiet note.", deps({ model: failing }));
      await ctx.jobs.drain(deps({ model: failing }));
      await tryAgain(ctx.db, ctx.pipeline, ctx.userId, stuck);
      const judge = link((t) => `Again ${t}.`);
      await ctx.jobs.drain(deps({ judge, model: fakeEnricher({ recognised: false }) }));
      expect(judge.inputs).toEqual([]);
    });

    it("does nothing with a duplicate job left over after a run finished", async () => {
      await add("other", "read");
      const { bookId } = await add("fresh", "read");
      const judge = link((t) => `Like ${t}.`);
      await ctx.jobs.drain(deps({ judge }));
      const calls = judge.inputs.length;
      await ctx.jobs.send({ kind: "connections", userId: ctx.userId, bookId });
      await ctx.jobs.drain(deps({ judge }));
      expect(judge.inputs).toHaveLength(calls);
    });
  });

  describe("a job that gives up", () => {
    const broken = fakeJudge();
    broken.judge = () => Promise.reject(new Error("overloaded"));
    const status = async (bookId: string) => (await readConnections(ctx.db, ctx.userId, bookId)).status;

    it("leaves the Book's Connections failed after every attempt, still laid out, and a Refresh runs them again", async () => {
      await add("other", "read");
      await ctx.jobs.drain(deps());
      const { bookId } = await add("fresh", "read");
      const attempts = { n: 0 };
      await ctx.jobs.drain(deps({ judge: { ...broken, judge: (i) => (attempts.n++, broken.judge(i)) } }));
      expect(attempts.n).toBe(RETRIES.connections + 1);
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "failed", generated: false, cards: [] });
      expect((await readGraph(ctx.db, ctx.userId)).books.map((b) => b.title).sort()).toEqual(["fresh", "other"]);

      await ctx.pipeline.refreshRequested(ctx.userId, bookId);
      expect(await status(bookId)).toBe("running");
      await ctx.jobs.drain(deps());
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "idle", generated: true, cards: [{ otherTitle: "other" }] });
    });

    // A worker that dies mid-run never finishes its attempt; the queue gives up on the job for it.
    it("settles what a job that never finished left waiting", async () => {
      await add("other", "read");
      await ctx.jobs.drain(deps());
      const { bookId } = await add("crashed", "reading");
      const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "A quiet note." });
      await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
      expect(await readEnrichment(ctx.db, bookId)).toMatchObject({ status: "pending" });

      await jobGaveUp(ctx.db, ctx.jobs, { kind: "enrich", bookId });
      await jobGaveUp(ctx.db, ctx.jobs, { kind: "embed", target: { kind: "note", id: n.id } });
      expect(await readEnrichment(ctx.db, bookId)).toMatchObject({ status: "failed" });
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "running", leftOut: { notes: 1, enrichment: false } });

      await jobGaveUp(ctx.db, ctx.jobs, { kind: "connections", userId: ctx.userId, bookId });
      expect(await status(bookId)).toBe("failed");
      expect((await readGraph(ctx.db, ctx.userId)).pending).toBe(true);
      await jobGaveUp(ctx.db, ctx.jobs, { kind: "graph", userId: ctx.userId });
      expect((await readGraph(ctx.db, ctx.userId)).pending).toBe(false);
    });

    it("leaves a Note that gave up on its vector out, says so, and a Refresh embeds it again before judging", async () => {
      await add("other", "read");
      await ctx.jobs.drain(deps());
      const { bookId } = await add("noted", "reading");
      await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "A late quiet note." });
      const base = fakeEmbedder(["quiet"]);
      const failing = { ...base, embed: (texts: string[], t: "document" | "query") => (texts.some((x) => x.includes("late")) ? Promise.reject(new Error("429")) : base.embed(texts, t)) };
      await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
      await ctx.jobs.drain(deps({ embedder: failing }));
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "idle", leftOut: { notes: 1, enrichment: false } });

      await ctx.pipeline.refreshRequested(ctx.userId, bookId);
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "running", leftOut: { notes: 0 } });
      const judge = fakeJudge();
      await ctx.jobs.drain(deps({ judge }));
      expect(judge.inputs.map((i) => i.book.notes.map((x) => x.body))).toEqual([["A late quiet note."]]);
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "idle", leftOut: { notes: 0 } });
    });

    it("leaves an Enrichment that gave up on its vector marked, and a Refresh embeds it again", async () => {
      const { bookId } = await add("about", "read");
      const down = { ...fakeEmbedder(["quiet"]), embed: () => Promise.reject(new Error("429")) };
      await ctx.jobs.drain(deps({ embedder: down }));
      expect(await enrichmentRow(bookId)).toMatchObject({ embedding: null, embedFailedAt: expect.any(Date) });
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "failed", leftOut: { notes: 0, enrichment: true } });

      await ctx.pipeline.refreshRequested(ctx.userId, bookId);
      expect(ctx.jobs.sent.at(-2)).toEqual({ kind: "embed", target: { kind: "enrichment", id: bookId } });
      await ctx.jobs.drain(deps());
      expect(await enrichmentRow(bookId)).toMatchObject({ embeddingModel: "fake-voyage", embedFailedAt: null });
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "idle", leftOut: { enrichment: false } });
    });

    it("leaves a Note given up on when the queue is down for its Refresh", async () => {
      const { bookId } = await add("noted", "reading");
      const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "A quiet note." });
      await jobGaveUp(ctx.db, ctx.jobs, { kind: "embed", target: { kind: "note", id: n.id } });
      await changeStatus(ctx.db, ctx.pipeline, ctx.userId, bookId, "read");
      ctx.jobs.down = true;
      await ctx.pipeline.refreshRequested(ctx.userId, bookId);
      expect(await readConnections(ctx.db, ctx.userId, bookId)).toMatchObject({ status: "failed", leftOut: { notes: 1 } });
    });
  });

  describe("removing a Library Entry", () => {
    it("cancels its waiting Connections job, so the judge never sees it", async () => {
      await add("other", "read");
      await ctx.jobs.drain(deps());
      const { bookId } = await add("gone", "read");
      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, bookId);
      expect(ctx.jobs.cancelled).toEqual([{ kind: "connections", userId: ctx.userId, bookId }]);
      const judge = fakeJudge();
      await ctx.jobs.drain(deps({ judge }));
      expect(judge.inputs).toEqual([]);
    });

    it("cancels its running Connections job: a failure then is never retried or given up on", async () => {
      await add("other", "read");
      await ctx.jobs.drain(deps());
      const { bookId } = await add("gone", "read");
      const judge = fakeJudge();
      judge.judge = async () => {
        await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, bookId);
        throw new Error("overloaded");
      };
      ctx.jobs.sent.length = 0;
      await ctx.jobs.drain(deps({ judge }));
      // Only the removal's graph job: no retry ran, and nothing gave up.
      expect(ctx.jobs.sent.filter((j) => j.kind === "graph")).toHaveLength(1);
      expect(await ctx.db.select().from(libraryEntry).where(eq(libraryEntry.bookId, bookId))).toEqual([]);
    });

    it("still removes the Book when the queue is down", async () => {
      const { bookId } = await add("gone", "read");
      ctx.jobs.down = true;
      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, bookId);
      expect(await ctx.db.select().from(libraryEntry)).toEqual([]);
    });
  });

  describe("the graph job", () => {
    const pending = async () => (await readGraph(ctx.db, ctx.userId)).pending;

    it("keeps the graph pending from a Connections run until the graph job that follows it settles", async () => {
      await add("other", "read");
      await add("fresh", "read");
      // Finding its Connections, before the graph job is even queued.
      expect(await pending()).toBe(true);
      await ctx.jobs.drain(deps());
      expect(ctx.jobs.sent.filter((j) => j.kind === "graph")).not.toHaveLength(0);
      expect(await pending()).toBe(false);
    });

    it("is pending through the end of a Connections run, before the graph job that follows it is queued", async () => {
      await add("other", "read");
      await ctx.jobs.drain(deps());
      expect(await readGraphMark(ctx.db, ctx.userId)).toBeNull();
      await add("fresh", "read");
      // The run leaves `running` as it ends; by then the graph must already be marked.
      const marks: (number | null)[] = [];
      const judge = { ...fakeJudge(), judge: async () => (marks.push(await readGraphMark(ctx.db, ctx.userId)), { connections: [], inputTokens: 0, outputTokens: 0, costUsd: 0 }) };
      await ctx.jobs.drain({ ...deps(), judge });
      expect(marks.length).toBeGreaterThan(0);
      expect(marks.every((m) => m !== null)).toBe(true);
    });

    it("is pending after a dismissal or a removal until the graph job runs, which a Refresh's run also queues", async () => {
      const first = await add("first", "read");
      const second = await add("second", "read");
      await add("third", "read");
      await ctx.jobs.drain(deps());

      const [c] = (await readConnections(ctx.db, ctx.userId, first.bookId)).cards;
      await dismissConnection(ctx.db, ctx.pipeline, ctx.userId, c.id);
      expect(await pending()).toBe(true);
      await ctx.jobs.drain(deps());
      expect(await pending()).toBe(false);

      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, second.bookId);
      expect(await pending()).toBe(true);
      await ctx.jobs.drain(deps());
      expect(await pending()).toBe(false);

      await ctx.pipeline.refreshRequested(ctx.userId, first.bookId);
      ctx.jobs.sent.length = 0;
      await ctx.jobs.drain(deps());
      expect(ctx.jobs.sent).toEqual([{ kind: "graph", userId: ctx.userId }]);
      expect(await pending()).toBe(false);
    });

    it("stays pending when it is asked for again while it runs, until the job queued for that runs", async () => {
      // A job starts with the latest request; another arrives before it settles.
      await ctx.pipeline.connectionsChanged(ctx.userId);
      const started = (await readGraphMark(ctx.db, ctx.userId))!;
      await ctx.pipeline.connectionsChanged(ctx.userId);
      await clearGraphMark(ctx.db, ctx.userId, started);
      expect(await pending()).toBe(true);
      await ctx.jobs.drain(deps());
      expect(await pending()).toBe(false);
    });

    it("is not pending when its job could not be queued", async () => {
      await ctx.jobs.drain(deps());
      ctx.jobs.down = true;
      await ctx.pipeline.connectionsChanged(ctx.userId);
      expect(await pending()).toBe(false);
    });
  });
});

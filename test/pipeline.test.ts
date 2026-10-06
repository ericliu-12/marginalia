import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { readConnections } from "../src/domain/connections";
import { readEnrichment } from "../src/domain/enrichment";
import { changeStatus } from "../src/domain/library-entry";
import { addNote } from "../src/domain/notes";
import { RETRIES, type JobDeps } from "../src/domain/pipeline";
import { enrichment, note } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, work } from "./fakes";
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

  it("adds a Book and saves a Note while the queue is down", async () => {
    ctx.jobs.down = true;
    const { bookId } = await add("a", "read");
    expect(await addNote(ctx.db, ctx.pipeline, ctx.userId, bookId, { body: "Kept." })).toMatchObject({ body: "Kept." });
  });
});

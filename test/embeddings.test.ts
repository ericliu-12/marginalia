import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { backfillEmbeddings, embedEnrichment, embedNote, nearestBooks } from "../src/domain/embeddings";
import { enrichBook } from "../src/domain/enrichment";
import { addNote, updateNote } from "../src/domain/notes";
import { book, enrichment, note, user } from "../src/db/schema";
import { changeStatus } from "../src/domain/library-entry";
import { fakeEmbedder, fakeEnricher, work } from "./fakes";
import { useTestDb } from "./harness";

const AXES = ["solitude", "war", "sea"];

describe("Embeddings", () => {
  const ctx = useTestDb();

  async function enriched(workKey: string, title: string, reply: Parameters<typeof fakeEnricher>[0] = {}) {
    const entry = await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey, title, authors: ["A"] }), "read");
    await enrichBook(ctx.db, { model: fakeEnricher(reply) }, entry.bookId);
    return entry.bookId;
  }
  const enrichmentRow = async (bookId: string) => (await ctx.db.select().from(enrichment).where(eq(enrichment.bookId, bookId)))[0];
  const noteRow = async (id: string) => (await ctx.db.select().from(note).where(eq(note.id, id)))[0];

  it("embeds a recognised Enrichment (summary and themes) as a document, recording the model", async () => {
    const id = await enriched("/works/a", "Stoner", { summary: "A life of quiet.", themes: ["solitude", "work"] });
    const embedder = fakeEmbedder(AXES);
    await embedEnrichment(ctx.db, embedder, id);
    expect(embedder.calls).toEqual([{ texts: ["A life of quiet.\nsolitude; work"], inputType: "document" }]);
    expect(await enrichmentRow(id)).toMatchObject({ embeddingModel: "fake-voyage" });
    expect((await enrichmentRow(id)).embedding).toHaveLength(1024);
  });

  it("never embeds an unrecognised Enrichment", async () => {
    const id = await enriched("/works/b", "Obscure", { recognised: false });
    const embedder = fakeEmbedder(AXES);
    await embedEnrichment(ctx.db, embedder, id);
    expect(embedder.calls).toEqual([]);
    expect(await enrichmentRow(id)).toMatchObject({ embedding: null, embeddingModel: null });
  });

  it("does nothing for a Book with no Enrichment, and skips work already embedded by the same model", async () => {
    const bare = (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/c", title: "C" }), "want")).bookId;
    const id = await enriched("/works/d", "D");
    const embedder = fakeEmbedder(AXES);
    await embedEnrichment(ctx.db, embedder, bare);
    await embedEnrichment(ctx.db, embedder, id);
    await embedEnrichment(ctx.db, embedder, id);
    expect(embedder.calls).toHaveLength(1);
  });

  it("re-embeds with a new model instead of mixing models", async () => {
    const id = await enriched("/works/e", "E");
    await embedEnrichment(ctx.db, fakeEmbedder(AXES, "old"), id);
    await embedEnrichment(ctx.db, fakeEmbedder(AXES, "new"), id);
    expect(await enrichmentRow(id)).toMatchObject({ embeddingModel: "new" });
  });

  it("drops a stale vector when the Enrichment is regenerated", async () => {
    const id = await enriched("/works/f", "F");
    await embedEnrichment(ctx.db, fakeEmbedder(AXES), id);
    await ctx.db.update(enrichment).set({ descriptionHash: null }).where(eq(enrichment.bookId, id));
    await enrichBook(ctx.db, { model: fakeEnricher({ summary: "Different." }) }, id);
    expect(await enrichmentRow(id)).toMatchObject({ embedding: null, embeddingModel: null });
  });

  it("embeds a Note's text and quote; saving a Note queues a re-embed and clears the old vector", async () => {
    const id = await enriched("/works/g", "G");
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "Lonely.", quote: "He was alone." });
    expect(ctx.jobs.sent.filter((j) => j.kind === "embed")).toEqual([{ kind: "embed", target: { kind: "note", id: n.id }, userId: ctx.userId }]);

    const embedder = fakeEmbedder(AXES);
    await embedNote(ctx.db, embedder, n.id);
    expect(embedder.calls).toEqual([{ texts: ["Lonely.\nHe was alone."], inputType: "document" }]);
    expect(await noteRow(n.id)).toMatchObject({ embeddingModel: "fake-voyage" });

    await updateNote(ctx.db, ctx.pipeline, ctx.userId, n.id, { body: "Revised." });
    expect(ctx.jobs.sent.filter((j) => j.kind === "embed")).toHaveLength(2);
    expect(await noteRow(n.id)).toMatchObject({ embedding: null, embeddingModel: null });
  });

  it("embedding a deleted Note is a no-op, and a failed queue does not fail saving the Note", async () => {
    const id = await enriched("/works/h", "H");
    ctx.jobs.down = true;
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "Kept" });
    expect(n.body).toBe("Kept");
    await ctx.db.delete(note).where(eq(note.id, n.id));
    await embedNote(ctx.db, fakeEmbedder(AXES), n.id);
  });

  it("finds nearest Books at Book level, from Enrichment and Notes, best match per Book", async () => {
    const embedder = fakeEmbedder(AXES);
    const stoner = await enriched("/works/s", "Stoner", { summary: "A professor.", themes: ["solitude"] });
    const lonely = await enriched("/works/l", "Lonely Book", { summary: "Alone.", themes: ["solitude"] });
    const battle = await enriched("/works/w", "Battle Book", { summary: "Fighting.", themes: ["war"] });
    const sea = await enriched("/works/z", "Sea Book", { summary: "Waves.", themes: ["sea"] });
    // A Note on the sea Book that is about war: the Book should now also be near the war Book.
    const seaNote = await addNote(ctx.db, ctx.pipeline, ctx.userId, sea, { body: "This is really about war." });
    for (const b of [stoner, lonely, battle, sea]) await embedEnrichment(ctx.db, embedder, b);
    await embedNote(ctx.db, embedder, seaNote.id);

    const fromStoner = await nearestBooks(ctx.db, ctx.userId, stoner, embedder.model);
    expect(fromStoner[0]).toEqual({ bookId: lonely, similarity: expect.closeTo(1) });
    expect(fromStoner.map((r) => r.bookId)).not.toContain(stoner);

    const fromBattle = await nearestBooks(ctx.db, ctx.userId, battle, embedder.model);
    expect(fromBattle.map((r) => r.bookId)).toEqual(expect.arrayContaining([sea]));
    expect(fromBattle.find((r) => r.bookId === sea)?.similarity).toBeCloseTo(1);
    expect(fromBattle.filter((r) => r.bookId === sea)).toHaveLength(1);
  });

  it("only offers the reader's own Finished Books, never an embedded Book from the shared tables", async () => {
    const embedder = fakeEmbedder(AXES);
    const me = await enriched("/works/f0", "Mine", { themes: ["solitude"] });
    const finished = await enriched("/works/f1", "Finished", { themes: ["solitude"] });
    const backToWant = await enriched("/works/f2", "Moved back to want", { themes: ["solitude"] });
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, backToWant, "want");
    const reading = (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/f3", title: "Reading", authors: ["A"] }), "reading")).bookId;
    await enrichBook(ctx.db, { model: fakeEnricher() }, reading);
    // Embedded Books in the shared tables that are in nobody's library.
    const [orphan] = await ctx.db.insert(book).values({ title: "Orphan", authors: ["O"] }).returning();
    await ctx.db.insert(enrichment).values({
      bookId: orphan.id, recognised: true, summary: "Orphaned.", themes: ["solitude"], model: "m", promptVersion: "p", status: "ready",
    });
    // Another reader's Finished Book.
    const [other] = await ctx.db.insert(user).values({ email: "other@example.com" }).returning();
    const theirs = await addBook(ctx.db, ctx.pipeline, other.id, work({ workKey: "/works/f4", title: "Theirs", authors: ["A"] }), "read");
    await enrichBook(ctx.db, { model: fakeEnricher({ themes: ["solitude"] }) }, theirs.bookId);
    for (const b of [me, finished, backToWant, reading, orphan.id, theirs.bookId]) await embedEnrichment(ctx.db, embedder, b);

    const near = await nearestBooks(ctx.db, ctx.userId, me, embedder.model);
    expect(near.map((r) => r.bookId).sort()).toEqual([finished, backToWant].sort());
  });

  it("never compares vectors from different models, or another reader's Notes", async () => {
    const a = await enriched("/works/m1", "A", { themes: ["solitude"] });
    const b = await enriched("/works/m2", "B", { themes: ["solitude"] });
    await embedEnrichment(ctx.db, fakeEmbedder(AXES, "old"), a);
    await embedEnrichment(ctx.db, fakeEmbedder(AXES, "new"), b);
    expect(await nearestBooks(ctx.db, ctx.userId, a, "old")).toEqual([]);

    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, b, { body: "war" });
    await embedNote(ctx.db, fakeEmbedder(AXES, "old"), n.id);
    const other = "00000000-0000-0000-0000-000000000000";
    expect(await nearestBooks(ctx.db, other, a, "old")).toEqual([]);
  });

  it("does not store a vector made from themes that changed while embedding", async () => {
    const id = await enriched("/works/t", "T", { summary: "Same.", themes: ["solitude"] });
    const embedder = fakeEmbedder(AXES);
    const slow = {
      ...embedder,
      async embed(texts: string[], inputType: "document" | "query") {
        await ctx.db.update(enrichment).set({ themes: ["war"] }).where(eq(enrichment.bookId, id));
        return embedder.embed(texts, inputType);
      },
    };
    await embedEnrichment(ctx.db, slow, id);
    expect(await enrichmentRow(id)).toMatchObject({ embedding: null });
  });

  it("backfill queues every recognised Enrichment and Note lacking a vector from the current model", async () => {
    const done = await enriched("/works/b1", "Done");
    const fresh = await enriched("/works/b2", "Fresh");
    const old = await enriched("/works/b3", "Old");
    await enriched("/works/b4", "Unrecognised", { recognised: false });
    await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/b5", title: "Not enriched" }), "want");
    await embedEnrichment(ctx.db, fakeEmbedder(AXES, "current"), done);
    await embedEnrichment(ctx.db, fakeEmbedder(AXES, "retired"), old);
    const doneNote = await addNote(ctx.db, ctx.pipeline, ctx.userId, done, { body: "embedded" });
    const oldNote = await addNote(ctx.db, ctx.pipeline, ctx.userId, done, { body: "retired" });
    const freshNote = await addNote(ctx.db, ctx.pipeline, ctx.userId, fresh, { body: "none" });
    await embedNote(ctx.db, fakeEmbedder(AXES, "current"), doneNote.id);
    await embedNote(ctx.db, fakeEmbedder(AXES, "retired"), oldNote.id);

    ctx.jobs.sent.length = 0;
    const count = await backfillEmbeddings(ctx.db, ctx.jobs, "current");
    const queued = ctx.jobs.sent.flatMap((j) => (j.kind === "embed" ? [j.target] : []));
    const key = (t: { kind: string; id: string }) => `${t.kind}:${t.id}`;
    expect(queued.map(key).sort()).toEqual(
      [`enrichment:${fresh}`, `enrichment:${old}`, `note:${oldNote.id}`, `note:${freshNote.id}`].sort(),
    );
    expect(count).toBe(4);
  });
});

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addBook, addManualBook } from "../src/domain/add-book";
import { recomputeClusters } from "../src/domain/clusters";
import { dismissConnection, readConnection, readConnections } from "../src/domain/connections";
import { editBook } from "../src/domain/edit-book";
import { embedEnrichment, embedNote } from "../src/domain/embeddings";
import { enrichBook, readEntryEnrichment, tryAgain } from "../src/domain/enrichment";
import { layoutGraph, readGraph } from "../src/domain/graph";
import { readLibrary } from "../src/domain/library";
import { changeStatus, removeFromLibrary } from "../src/domain/library-entry";
import { findLookalike } from "../src/domain/lookalike";
import { addNote, deleteNote, listNotes, NoteNotFoundError, updateNote } from "../src/domain/notes";
import { runJob, type JobDeps } from "../src/domain/pipeline";
import { searchBooks } from "../src/domain/search";
import { book, bookPosition, clusterLabel, connection, connectionRun, enrichment, graphJob, libraryEntry, note, readThrough } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeGateway, fakeJudge, fakeNamer, work } from "./fakes";
import { addReader, useTestDb } from "./harness";

// Two Readers, A (the harness's) and B. No Reader sees another's Library Entries, Notes, Manual Books,
// Connections or Clusters, and another Reader's id behaves exactly as a missing one.

const TABLES = { book, enrichment, libraryEntry, readThrough, note, connection, connectionRun, clusterLabel, bookPosition, graphJob };

describe("The Reader boundary", () => {
  const ctx = useTestDb();
  let a: string;
  let b: string;
  // A's ids, as B might send them.
  const ids = { shared: "", want: "", manual: "", note: "", connection: "", cluster: "" };
  const stoner = work({ workKey: "/works/stoner", title: "Stoner", authors: ["John Williams"] });
  const gilead = work({ workKey: "/works/gilead", title: "Gilead", authors: ["Marilynne Robinson"] });
  const beloved = work({ workKey: "/works/beloved", title: "Beloved", authors: ["Toni Morrison"] });

  async function connect(userId: string, x: string, y: string) {
    const [p, q] = [x, y].sort();
    const [row] = await ctx.db
      .insert(connection)
      .values({
        userId, bookAId: p, bookBId: q, type: "thematic", strength: "strong", similarity: 0.5, similarityModel: "m",
        explanation: "Why.", grounding: "notes", model: "m", promptVersion: "p",
      })
      .returning();
    return row.id;
  }

  // Every row of the tables a Reader's data lives in, to show a call changed none of them.
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(Object.entries(TABLES).map(async ([name, t]) => [name, (await ctx.db.select().from(t)).map((r) => JSON.stringify(r)).sort()])),
    );

  beforeEach(async () => {
    a = ctx.userId;
    b = (await addReader(ctx.db, "b@example.com")).id;

    // A: Stoner and Beloved read, a Manual Book read, Gilead wanted; a Note on each read Book;
    // Connections binding the three into a Cluster, laid out.
    ids.shared = (await addBook(ctx.db, ctx.pipeline, a, stoner, "read")).bookId;
    const belovedId = (await addBook(ctx.db, ctx.pipeline, a, beloved, "read")).bookId;
    ids.want = (await addBook(ctx.db, ctx.pipeline, a, gilead, "want")).bookId;
    ids.manual = (await addManualBook(ctx.db, ctx.pipeline, a, { title: "My Grandmother's Diary", author: "Ada Reader" }, "read")).bookId;
    ids.note = (await addNote(ctx.db, ctx.pipeline, a, ids.manual, { body: "A's private thought." })).id;
    await addNote(ctx.db, ctx.pipeline, a, ids.shared, { body: "A on Stoner." });
    ids.connection = await connect(a, ids.shared, ids.manual);
    await connect(a, ids.shared, belovedId);
    await connect(a, belovedId, ids.manual);
    await recomputeClusters(ctx.db, a);
    await layoutGraph(ctx.db, a);
    [{ id: ids.cluster }] = await ctx.db.select({ id: clusterLabel.id }).from(clusterLabel);
    // The Manual Book's Enrichment gave up on its vector, which a Refresh would ask for again.
    await ctx.db.insert(enrichment).values({ bookId: ids.manual, status: "ready", recognised: false, embedFailedAt: new Date() }).onConflictDoUpdate({
      target: enrichment.bookId,
      set: { embedFailedAt: new Date() },
    });

    // B: Stoner too (the shared Book), read, with a Note of their own.
    await addBook(ctx.db, ctx.pipeline, b, stoner, "read");
    await addNote(ctx.db, ctx.pipeline, b, ids.shared, { body: "B on Stoner." });
  });

  it("B's library, graph, Connections, Notes, search and lookalikes hold none of A's", async () => {
    expect((await readLibrary(ctx.db, b)).map((i) => i.title)).toEqual(["Stoner"]);

    const graph = await readGraph(ctx.db, b);
    expect(graph.books.map((x) => x.title)).toEqual(["Stoner"]);
    expect(graph.connections).toEqual([]);
    expect(graph.clusters).toEqual([]);

    expect((await readConnections(ctx.db, b, ids.shared)).cards).toEqual([]);
    expect((await listNotes(ctx.db, b, ids.shared)).map((n) => n.body)).toEqual(["B on Stoner."]);

    const results = await searchBooks(ctx.db, b, fakeGateway([stoner, gilead, beloved]), "x");
    expect(results.map((r) => [r.title, r.libraryStatus, r.lookalike])).toEqual([
      ["Stoner", "read", null],
      ["Gilead", null, null],
      ["Beloved", null, null],
    ]);
    expect(await findLookalike(ctx.db, b, { title: "My Grandmother's Diary", author: "Ada Reader" })).toBeNull();
  });

  it("B passing A's ids to every reading and mutating function gets what a missing id gets, and changes none of A's rows", async () => {
    const before = await snapshot();
    const sent = ctx.jobs.sent.length;
    const missing = randomUUID();
    // How a call ended: its value, or the kind of error it threw (the message names the id).
    const outcome = (call: () => Promise<unknown>) =>
      call().then(
        (value) => ({ value }),
        (err: Error) => ({ error: err.constructor.name }),
      );
    const edit = { title: "Taken", author: "Someone Else", description: "Changed." };
    const calls: [string, (id: string) => Promise<unknown>, string[]][] = [
      ["edit", (id) => editBook(ctx.db, ctx.pipeline, b, id, edit), [ids.manual, ids.want]],
      ["delete", (id) => removeFromLibrary(ctx.db, ctx.pipeline, b, id), [ids.manual, ids.want]],
      ["change Status", (id) => changeStatus(ctx.db, ctx.pipeline, b, id, "reading"), [ids.manual, ids.want]],
      ["finish", (id) => changeStatus(ctx.db, ctx.pipeline, b, id, "read"), [ids.manual, ids.want]],
      ["Refresh", (id) => ctx.pipeline.refreshRequested(b, id), [ids.manual, ids.want]],
      ["Try again", (id) => tryAgain(ctx.db, ctx.pipeline, b, id), [ids.manual, ids.want]],
      ["read Enrichment", (id) => readEntryEnrichment(ctx.db, b, id), [ids.manual, ids.want]],
      ["read Notes", (id) => listNotes(ctx.db, b, id), [ids.manual, ids.want]],
      ["read Connections", (id) => readConnections(ctx.db, b, id), [ids.manual, ids.want]],
      ["add a Note", (id) => addNote(ctx.db, ctx.pipeline, b, id, { body: "B was here." }), [ids.manual, ids.want]],
      ["edit a Note", (id) => updateNote(ctx.db, ctx.pipeline, b, id, { body: "B was here." }), [ids.note]],
      ["delete a Note", (id) => deleteNote(ctx.db, b, id), [ids.note]],
      ["read a Connection", (id) => readConnection(ctx.db, b, id), [ids.connection, ids.cluster]],
      ["dismiss", (id) => dismissConnection(ctx.db, ctx.pipeline, b, id), [ids.connection, ids.cluster]],
    ];
    for (const [name, call, theirs] of calls) {
      for (const id of theirs) expect(await outcome(() => call(id)), `${name} with A's ${id}`).toEqual(await outcome(() => call(missing)));
    }

    // A new Note's id comes from the browser, so A's is taken where a fresh one is not: refused as not found.
    await expect(addNote(ctx.db, ctx.pipeline, b, ids.shared, { body: "B was here." }, ids.note)).rejects.toBeInstanceOf(NoteNotFoundError);

    expect(await snapshot()).toEqual(before);
    expect(ctx.jobs.sent.slice(sent)).toEqual([]);
  });
});

describe("The worker, for two Readers", () => {
  const ctx = useTestDb();
  const embedder = fakeEmbedder(["solitude"]);
  const titles = ["X", "Y", "Z"];
  const bookIds = new Map<string, string>();
  let a: string;
  let b: string;

  // The Reader finishes the Book, with a Note; its shared Enrichment is ready and embedded.
  async function finish(userId: string, title: string) {
    const { bookId } = await addBook(ctx.db, ctx.pipeline, userId, work({ workKey: `/works/${title}`, title, authors: ["A"] }), "read");
    bookIds.set(title, bookId);
    await enrichBook(ctx.db, { model: fakeEnricher({ themes: ["solitude"] }) }, bookId);
    await embedEnrichment(ctx.db, embedder, bookId);
    const n = await addNote(ctx.db, ctx.pipeline, userId, bookId, { body: `${userId === a ? "A" : "B"}'s note on ${title}, on solitude.` });
    await embedNote(ctx.db, embedder, n.id);
  }

  // The judge links the Book to every candidate it is shown, or to those `only` names.
  const deps = (only?: string[]) => {
    const judge = fakeJudge((input) => ({
      connections: input.candidates
        .filter((c) => !only || only.includes(c.title))
        .map((c) => ({ candidateId: c.id, type: "thematic" as const, strength: "strong" as const, explanation: "Both on solitude.", quotedNoteIds: [] })),
    }));
    return { judge, deps: { model: fakeEnricher(), judge, embedder, descriptions: null, namer: fakeNamer() } satisfies JobDeps };
  };
  // Whose rows each table holds.
  const owners = async () => ({
    connections: (await ctx.db.select().from(connection)).map((r) => r.userId),
    clusters: (await ctx.db.select().from(clusterLabel)).map((r) => r.userId),
    positions: [...new Set((await ctx.db.select().from(bookPosition)).map((r) => r.userId))],
  });

  beforeEach(async () => {
    a = ctx.userId;
    b = (await addReader(ctx.db, "b@example.com")).id;
    for (const t of titles) await finish(a, t);
    for (const t of titles) await finish(b, t);
  });

  it("a job for A writes only A's Connections, Clusters and positions, and shows the judge only A's Notes", async () => {
    const { judge, deps: d } = deps();
    for (const t of titles) await runJob(ctx.db, d, ctx.jobs, { kind: "connections", userId: a, bookId: bookIds.get(t)! });
    await runJob(ctx.db, d, ctx.jobs, { kind: "graph", userId: a });

    expect(await owners()).toEqual({ connections: [a, a, a], clusters: [a], positions: [a] });
    const shown = JSON.stringify(judge.inputs);
    expect(shown).toContain("A's note");
    expect(shown).not.toContain("B's note");
    expect(await ctx.db.select().from(libraryEntry).where(and(eq(libraryEntry.userId, b), inArray(libraryEntry.connectionsStatus, ["idle", "failed"])))).toEqual([]);
  });

  it("computes Clusters per Reader: B's own Connections, not A's, decide B's", async () => {
    for (const t of titles) await runJob(ctx.db, deps().deps, ctx.jobs, { kind: "connections", userId: a, bookId: bookIds.get(t)! });
    await runJob(ctx.db, deps().deps, ctx.jobs, { kind: "graph", userId: a });
    const [aCluster] = await ctx.db.select().from(clusterLabel);

    // B finds only X and Y alike: a pair, which is no Cluster.
    await runJob(ctx.db, deps(["Y"]).deps, ctx.jobs, { kind: "connections", userId: b, bookId: bookIds.get("X")! });
    await runJob(ctx.db, deps().deps, ctx.jobs, { kind: "graph", userId: b });

    expect((await readGraph(ctx.db, b)).clusters).toEqual([]);
    expect((await readGraph(ctx.db, b)).connections).toHaveLength(1);
    expect(await ctx.db.select().from(clusterLabel)).toEqual([aCluster]);
    expect((await readGraph(ctx.db, a)).clusters.map((c) => c.bookIds.length)).toEqual([3]);
  });
});

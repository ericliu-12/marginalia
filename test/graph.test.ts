import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { readConnection, type Strength } from "../src/domain/connections";
import { DISPLAY_CAP, LABEL_MAX_CHARS, LABEL_ROOM, labelOf, layoutGraph, MAX_DRIFT, readGraph, visibleConnections, type GraphView } from "../src/domain/graph";
import { WASH_RADIUS } from "../src/domain/graph-drawing";
import { EMBEDDING_DIMENSIONS } from "../src/lib/models";
import { changeStatus, removeFromLibrary } from "../src/domain/library-entry";
import { layoutStats } from "../src/domain/relayout";
import type { JobDeps } from "../src/domain/pipeline";
import { bookPosition, clusterLabel, connection, libraryEntry } from "../src/db/schema";
import { fakeEmbedder, fakeEnricher, fakeJudge, fakeNamer, work } from "./fakes";
import { useTestDb } from "./harness";

describe("A Book's label", () => {
  it("is its title cut at a subtitle", () => {
    expect(labelOf("Stoner: A Novel")).toBe("Stoner");
  });

  it("cuts a long title at a word, within LABEL_MAX_CHARS", () => {
    const label = labelOf("The unbearable lightness of being");
    expect(label).toBe("The unbearable lightness of…");
    expect(label.length).toBeLessThanOrEqual(LABEL_MAX_CHARS);
  });

  it("cuts mid-word only where the first word alone is too long", () => {
    expect(labelOf("Supercalifragilisticexpialidocious and more")).toBe(`${"Supercalifragilisticexpialidocious".slice(0, LABEL_MAX_CHARS - 1)}…`);
  });
});

describe("Graph", () => {
  const ctx = useTestDb();
  const add = async (title: string, status: "want" | "reading" | "read" = "read") =>
    (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: `/works/${title}`, title, authors: ["A"] }), status)).bookId;
  const graph = () => readGraph(ctx.db, ctx.userId);
  const titleOf = (g: GraphView, id: string) => g.books.find((b) => b.bookId === id)!.title;
  const pairs = (g: GraphView, conns: GraphView["connections"]) => conns.map((c) => [titleOf(g, c.a), titleOf(g, c.b)].sort().join("–")).sort();

  // Stored as the judge would leave it; `similarity` breaks ties within a Strength.
  async function connect(x: string, y: string, strength: Strength = "strong", similarity = 0.5, dismissed = false) {
    const [a, b] = [x, y].sort();
    const [row] = await ctx.db
      .insert(connection)
      .values({
        userId: ctx.userId, bookAId: a, bookBId: b, type: "thematic", strength, similarity, similarityModel: "m",
        explanation: `Why ${a} meets ${b}.`, grounding: "enrichment", model: "m", promptVersion: "p",
        dismissedAt: dismissed ? new Date() : null,
      })
      .returning();
    return row.id;
  }

  it("shows Finished Books only, as the reader titles them, a re-read or moved-back Book included", async () => {
    await add("Wanted", "want");
    await add("Current", "reading");
    const read = await add("Read");
    const reread = await add("Reread");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, reread, "reading");
    const back = await add("Back");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, back, "want");
    await ctx.db.update(libraryEntry).set({ titleOverride: "Read (mine)" }).where(eq(libraryEntry.bookId, read));

    const g = await graph();
    expect(g.books.map((b) => b.title).sort()).toEqual(["Back", "Read (mine)", "Reread"]);
  });

  it("carries each Book's latest completed Read-through, dates and all", async () => {
    const backfilled = await add("Backfilled");
    const finished = await add("Finished", "reading");
    await changeStatus(ctx.db, ctx.pipeline, ctx.userId, finished, "read");

    const g = await graph();
    const pass = (id: string) => g.books.find((b) => b.bookId === id)!.latestPass;
    expect(pass(backfilled)).toEqual({ startedAt: null, finishedAt: null });
    expect(pass(finished)).toEqual({ startedAt: expect.any(Number), finishedAt: expect.any(Number) });
  });

  it("sizes each Book by its Connections, leaving dismissed ones out of the graph", async () => {
    const [a, b, c] = [await add("A"), await add("B"), await add("C")];
    await connect(a, b);
    await connect(a, c, "strong", 0.5, true);

    const g = await graph();
    expect(Object.fromEntries(g.books.map((x) => [x.title, x.degree]))).toEqual({ A: 1, B: 1, C: 0 });
    expect(pairs(g, g.connections)).toEqual(["A–B"]);
  });

  it(`shows each Book's ${DISPLAY_CAP} strongest Connections, and a Connection either of its Books ranks that high`, async () => {
    // The hub links strongly to seven Books, and moderately to a leaf and to a second hub. The leaf has
    // nothing else, so its one Connection shows; the second hub also links strongly to the seven, so
    // neither end ranks the hubs' Connection in its top seven.
    const hub = await add("Hub");
    const other = await add("Other");
    const leaf = await add("Leaf");
    const seven = [];
    for (let i = 1; i <= DISPLAY_CAP; i++) seven.push(await add(`S${i}`));
    for (const s of seven) {
      await connect(hub, s, "strong");
      await connect(other, s, "strong");
    }
    await connect(hub, leaf, "moderate", 0.9);
    await connect(hub, other, "moderate", 0.4);

    const g = await graph();
    const shown = pairs(g, visibleConnections(g, null));
    expect(shown).toContain("Hub–Leaf");
    expect(shown).not.toContain("Hub–Other");
    expect(shown).toHaveLength(2 * DISPLAY_CAP + 1);
  });

  it("keeps weak Connections out of the graph at rest, even a Book's only one, until one of its Books is selected", async () => {
    const a = await add("A");
    const b = await add("B");
    const c = await add("C");
    await connect(a, b, "weak");
    await connect(a, c, "moderate");

    const g = await graph();
    expect(pairs(g, visibleConnections(g, null))).toEqual(["A–C"]);
    expect(pairs(g, visibleConnections(g, b))).toEqual(["A–B", "A–C"]);
    expect(pairs(g, visibleConnections(g, a))).toEqual(["A–B", "A–C"]);
  });

  it("shows all of a selected Book's Connections, and only the default ones besides", async () => {
    const hub = await add("Hub");
    const other = await add("Other");
    for (let i = 1; i <= DISPLAY_CAP; i++) {
      const s = await add(`S${i}`);
      await connect(hub, s, "strong");
      await connect(other, s, "strong");
    }
    await connect(hub, other, "weak");

    const g = await graph();
    expect(pairs(g, visibleConnections(g, null))).not.toContain("Hub–Other");
    expect(pairs(g, visibleConnections(g, hub))).toContain("Hub–Other");
    expect(pairs(g, visibleConnections(g, other))).toContain("Hub–Other");
    expect(visibleConnections(g, hub)).toHaveLength(g.connections.length);
  });

  describe("positions", () => {
    const deps = (): JobDeps => ({
      model: fakeEnricher({ themes: ["quiet"] }),
      judge: fakeJudge((input) => ({
        connections: input.candidates.map((c) => ({ candidateId: c.id, type: "thematic", strength: "strong", explanation: "Both are quiet.", quotedNoteIds: [] })),
      })),
      embedder: fakeEmbedder(["quiet"]),
      descriptions: null,
      namer: fakeNamer(),
    });
    const positions = (g: GraphView) => Object.fromEntries(g.books.map((b) => [b.title, { x: b.x, y: b.y }]));

    it("gives every Finished Book a place, before the worker has laid the graph out too", async () => {
      await add("A");
      await add("B");
      await add("Lonely");
      const g = await graph();
      expect(g.books).toHaveLength(3);
      for (const b of g.books) expect([b.x, b.y].every(Number.isFinite)).toBe(true);
      expect(new Set(g.books.map((b) => `${b.x},${b.y}`)).size).toBe(3);
    });

    // The typical Connection length, the unit the graph is drawn at.
    const unitOf = (g: GraphView) => {
      const at = positions(g);
      const lengths = g.connections
        .map((c) => Math.hypot(at[titleOf(g, c.a)].x - at[titleOf(g, c.b)].x, at[titleOf(g, c.a)].y - at[titleOf(g, c.b)].y))
        .sort((p, q) => p - q);
      return lengths[Math.floor(lengths.length / 2)];
    };
    // How far each Book in `before` has moved by `after`, in typical Connection lengths of `before`.
    const moves = (before: GraphView, after: GraphView) => {
      const was = positions(before);
      const now = positions(after);
      return Object.keys(was).map((t) => Math.hypot(now[t].x - was[t].x, now[t].y - was[t].y) / unitOf(before));
    };

    it("lays the graph out once Connections are found, and keeps it the same from one session to the next", async () => {
      for (const t of ["A", "B", "C", "D"]) await add(t);
      const provisional = await graph();
      await ctx.jobs.drain(deps());
      const first = await graph();
      expect(first.connections.length).toBeGreaterThan(0);
      expect(positions(first)).not.toEqual(positions(provisional));
      expect(positions(await graph())).toEqual(positions(first));
    });

    it("barely moves a graph already settled when it is laid out again", async () => {
      for (const t of ["A", "B", "C", "D", "E"]) await add(t);
      await ctx.jobs.drain(deps());
      const first = await graph();
      await layoutGraph(ctx.db, ctx.userId);
      for (const m of moves(first, await graph())) expect(m).toBeLessThan(MAX_DRIFT / 5);
    });

    it("places a newly finished Book among its Connections, moving no placed Book more than MAX_DRIFT", async () => {
      for (const t of ["A", "B", "C", "D", "E"]) await add(t);
      await ctx.jobs.drain(deps());
      const before = await graph();
      await add("New");
      const provisional = positions(await graph()).New;
      await ctx.jobs.drain(deps());
      const after = await graph();
      expect(positions(after).New).not.toEqual(provisional);
      for (const m of moves(before, after)) expect(m).toBeLessThanOrEqual(MAX_DRIFT + 1e-9);
    });

    it("draws a placed Book toward a Connection it gains, a little each time the graph is laid out", async () => {
      // A chain: its two ends sit far apart until a Connection joins them.
      const chain = [];
      for (const t of ["A", "B", "C", "D", "E", "F"]) chain.push(await add(t));
      for (let i = 1; i < chain.length; i++) await connect(chain[i - 1], chain[i]);
      await layoutGraph(ctx.db, ctx.userId);
      const gap = (g: GraphView) => Math.hypot(positions(g).A.x - positions(g).F.x, positions(g).A.y - positions(g).F.y);
      await connect(chain[0], chain[5]);
      const first = await graph();
      await layoutGraph(ctx.db, ctx.userId);
      const second = await graph();
      expect(gap(second)).toBeLessThan(gap(first));
      for (const m of moves(first, second)) expect(m).toBeLessThanOrEqual(MAX_DRIFT + 1e-9);
    });

    it("lays out Books with no Connections at all, each in a place of its own", async () => {
      for (const t of ["A", "B", "C"]) await add(t);
      await layoutGraph(ctx.db, ctx.userId, { fresh: true });
      const at = Object.values(positions(await graph()));
      expect(at.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(new Set(at.map((p) => `${p.x},${p.y}`)).size).toBe(3);
    });

    it("lays a crowded graph out afresh when asked, all Books at once", async () => {
      for (const t of ["A", "B", "C", "D", "E"]) await add(t);
      await ctx.jobs.drain(deps());
      await ctx.db.update(bookPosition).set({ x: 0, y: 0 });
      await layoutGraph(ctx.db, ctx.userId, { fresh: true });
      const at = Object.values(positions(await graph()));
      expect(new Set(at.map((p) => `${p.x},${p.y}`)).size).toBe(at.length);
    });

    describe("compactly", () => {
      // A main part (a hub and a ring of five, one Cluster), a separate pair, and four unconnected Books.
      async function scattered() {
        const hub = await add("Hub");
        const ring = [];
        for (const t of ["R1", "R2", "R3", "R4", "R5"]) ring.push(await add(t));
        for (const r of ring) await connect(hub, r);
        for (let i = 0; i < ring.length; i++) await connect(ring[i], ring[(i + 1) % ring.length], "moderate");
        const pair = [await add("P1"), await add("P2")];
        await connect(pair[0], pair[1]);
        const lone = [];
        for (const t of ["Born to Run", "Heart the Lover", "Better Left Unsent", "How to Be Okay When Nothing Is"]) lone.push(await add(t));
        await ctx.db.insert(clusterLabel).values({ userId: ctx.userId, name: "Small hours", memberBookIds: [hub, ...ring], wash: 0 });
        return { main: [hub, ...ring], pair, lone };
      }
      const box = (g: GraphView, ids: string[]) => {
        const at = ids.map((id) => g.books.find((b) => b.bookId === id)!);
        return { x0: Math.min(...at.map((b) => b.x)), x1: Math.max(...at.map((b) => b.x)), y0: Math.min(...at.map((b) => b.y)), y1: Math.max(...at.map((b) => b.y)) };
      };

      // The `ids` are in the halo: on every desktop canvas, fitted, none on a wash or a name or within
      // HALO_GAP of a connected Book, and no label over a dot; each dot outside every wash around the
      // `cluster` Books.
      function expectHalo(g: GraphView, ids: string[], cluster: string[]) {
        const unit = unitOf(g);
        const at = (id: string) => g.books.find((b) => b.bookId === id)!;
        for (const b of ids.map(at)) {
          expect(b.degree).toBe(0);
          for (const c of cluster.map(at)) expect(Math.hypot(b.x - c.x, b.y - c.y)).toBeGreaterThan(WASH_RADIUS * unit);
        }
        for (const view of Object.values(layoutStats(g).views)) {
          expect(view).toMatchObject({ dotOverlaps: 0, halo: { onWash: 0, onName: 0, near: 0 } });
        }
      }

      it("keeps the main connected part's share of the fitted view, whatever else is in the graph", async () => {
        await scattered();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        const g = await graph();
        // Before the halo and the packing, ForceAtlas2 left this graph's main part about a tenth of it;
        // now 0.14 with the test database's stable ids, the halo's four Books ringing it.
        expect(layoutStats(g).mainShare).toBeGreaterThanOrEqual(0.12);
      });

      it("scatters unconnected Books in a halo around the connected ones, clear of their dots, labels, washes and names", async () => {
        const { main, lone } = await scattered();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        expectHalo(await graph(), lone, main);
      });

      it("spreads the halo all the way round the connected Books, not to one side", async () => {
        const { main, pair, lone } = await scattered();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        const g = await graph();
        const at = (id: string) => g.books.find((b) => b.bookId === id)!;
        const linked = [...main, ...pair].map(at);
        const centre = { x: linked.reduce((s, b) => s + b.x, 0) / linked.length, y: linked.reduce((s, b) => s + b.y, 0) / linked.length };
        const angles = lone.map((id) => Math.atan2(at(id).y - centre.y, at(id).x - centre.x)).sort((p, q) => p - q);
        const gaps = angles.map((a, i) => (i ? a - angles[i - 1] : a + 2 * Math.PI - angles[angles.length - 1]));
        // Four Books evenly round would leave quarter turns between them; none is left more than a half.
        expect(Math.max(...gaps)).toBeLessThan(Math.PI);
      });

      it("keeps each unconnected Book in its place in the halo from one re-settle to the next", async () => {
        const { lone } = await scattered();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        const first = await graph();
        for (let i = 0; i < 3; i++) await layoutGraph(ctx.db, ctx.userId);
        const after = await graph();
        const at = (g: GraphView, id: string) => g.books.find((b) => b.bookId === id)!;
        for (const id of lone) expect(Math.hypot(at(after, id).x - at(first, id).x, at(after, id).y - at(first, id).y) / unitOf(first)).toBeLessThan(MAX_DRIFT);
      });

      it("puts a far-off unconnected Book straight back in its place in the halo", async () => {
        const { lone } = await scattered();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        const settled = await graph();
        const home = settled.books.find((b) => b.bookId === lone[0])!;
        const [entry] = await ctx.db.select({ id: libraryEntry.id }).from(libraryEntry).where(eq(libraryEntry.bookId, lone[0]));
        await ctx.db.update(bookPosition).set({ x: home.x + 40 * unitOf(settled), y: home.y }).where(eq(bookPosition.libraryEntryId, entry.id));

        await layoutGraph(ctx.db, ctx.userId);
        const now = (await graph()).books.find((b) => b.bookId === lone[0])!;
        expect(Math.hypot(now.x - home.x, now.y - home.y) / unitOf(settled)).toBeLessThan(MAX_DRIFT);
      });

      it("packs a separate group beside the main one", async () => {
        const { main, pair } = await scattered();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        const g = await graph();
        const m = box(g, main);
        const p = box(g, pair);
        const apart = Math.max(p.x0 - m.x1, m.x0 - p.x1, p.y0 - m.y1, m.y0 - p.y1, 0);
        expect(apart / unitOf(g)).toBeLessThan(3);
      });

      it("places a Book that gains its first Connection beside its neighbour at once, the halo anew, the rest within MAX_DRIFT", async () => {
        const { main, pair, lone } = await scattered();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        const inHalo = await graph();
        await connect(lone[0], main[1]);
        const before = await graph();
        await layoutGraph(ctx.db, ctx.userId);
        const after = await graph();

        const unit = unitOf(before);
        const at = (g: GraphView, id: string) => g.books.find((b) => b.bookId === id)!;
        const joined = at(after, lone[0]);
        // Placed as a new Book is: beside its neighbour, then nudged at most a few rings out for room.
        const toNeighbour = Math.hypot(joined.x - at(after, main[1]).x, joined.y - at(after, main[1]).y) / unit;
        const spot = at(inHalo, lone[0]);
        const fromHalo = Math.hypot(joined.x - spot.x, joined.y - spot.y) / unit;
        // Laid out from 100 different sets of Book ids it lands 0.64–3.58 lengths from its neighbour (median
        // 1.23), and 2.00 with the test database's stable ids; the bar sits above all of them.
        expect(toNeighbour).toBeLessThan(4);
        expect(fromHalo).toBeGreaterThan(MAX_DRIFT);
        expect(toNeighbour).toBeLessThan(Math.hypot(spot.x - at(after, main[1]).x, spot.y - at(after, main[1]).y) / unit);
        const rest = (g: GraphView) => ({
          ...g,
          books: g.books.filter((b) => [...main, ...pair].includes(b.bookId)),
          connections: g.connections.filter((c) => c.a !== lone[0] && c.b !== lone[0]),
        });
        for (const m of moves(rest(before), rest(after))) expect(m).toBeLessThanOrEqual(MAX_DRIFT + 1e-9);
        expectHalo(after, lone.slice(1), main);
      });

      it("moves Books that lose their last Connection straight to the halo", async () => {
        const { main, pair, lone } = await scattered();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        await ctx.db.update(connection).set({ dismissedAt: new Date() }).where(eq(connection.bookAId, [pair[0], pair[1]].sort()[0]));
        await layoutGraph(ctx.db, ctx.userId);
        expectHalo(await graph(), [...lone, ...pair], main);
      });
    });

    describe("on the desktop", () => {
      // Twenty-six Books with real titles: three Clusters, close-knit within and linked between, and two
      // Books with no Connections.
      const TITLES = [
        "The Remains of the Day", "Never Let Me Go", "Klara and the Sun", "An Artist of the Floating World", "The Buried Giant",
        "The Unconsoled", "When We Were Orphans", "A Pale View of Hills", "Beloved", "The Bluest Eye", "Song of Solomon",
        "A Little Life", "The Secret History", "Conversations with Friends", "The Goldfinch", "Sula",
        "Gilead", "Housekeeping", "Lila", "Home", "The Death of Ivan Ilyich", "Austerlitz", "The Rings of Saturn",
        "The Emigrants", "To the Lighthouse", "Giovanni's Room",
      ];
      async function crowded() {
        const ids = [];
        for (const t of TITLES) ids.push(await add(t));
        const groups = [ids.slice(0, 8), ids.slice(8, 16), ids.slice(16, 24)];
        for (const g of groups) {
          for (let i = 0; i < g.length; i++) {
            await connect(g[i], g[(i + 1) % g.length]);
            await connect(g[i], g[(i + 2) % g.length], "moderate");
            await connect(g[i], g[(i + 3) % g.length], "moderate");
          }
        }
        await connect(groups[0][0], groups[1][0], "moderate");
        await connect(groups[1][4], groups[2][0], "moderate");
        const names = ["Duty and regret", "Inheritance and silence", "Grace in small towns"];
        await ctx.db.insert(clusterLabel).values(groups.map((g, i) => ({ userId: ctx.userId, name: names[i], memberBookIds: g, wash: i })));
        return ids;
      }

      it("lays a graph out afresh to read on every desktop canvas, fitted: no label over another or a dot, no name over a label, names off their washes, the halo clear", async () => {
        await crowded();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        const { views } = layoutStats(await graph());
        expect(Object.keys(views)).toEqual(["1024×700", "1280×800", "1440×900", "1680×1050", "1920×1080"]);
        for (const view of Object.values(views)) {
          expect(view).toMatchObject({ labelOverlaps: 0, dotOverlaps: 0, nameOverlaps: 0, namesOnWash: 0, halo: { onWash: 0, onName: 0, near: 0 } });
        }
      });

      it("nudges each unconnected Book toward the side its most similar Books sit on, by their stored embeddings", async () => {
        const ids = await crowded();
        // The two unconnected Books, each like one end Cluster, by vectors along a shared axis.
        const [left, right] = [ids.slice(0, 8), ids.slice(16, 24)];
        const lone = ids.slice(24);
        const vector = (axis: number) => `[${Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Number(i === axis)).join(",")}]`;
        const embed = (id: string, axis: number) =>
          ctx.db.execute(sql`
            INSERT INTO enrichment (book_id, embedding, embedding_model) VALUES (${id}, ${vector(axis)}::vector, 'm')
            ON CONFLICT (book_id) DO UPDATE SET embedding = excluded.embedding, embedding_model = excluded.embedding_model`);
        for (const id of left) await embed(id, 0);
        for (const id of right) await embed(id, 1);
        await embed(lone[0], 0);
        await embed(lone[1], 1);
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });

        const g = await graph();
        const at = (id: string) => g.books.find((b) => b.bookId === id)!;
        const mean = (list: string[]) => ({ x: list.reduce((s, id) => s + at(id).x, 0) / list.length, y: list.reduce((s, id) => s + at(id).y, 0) / list.length });
        const centre = mean(ids.slice(0, 24));
        // Its direction from the connected Books' middle strays less than a quarter turn from its Cluster's.
        const angle = (p: { x: number; y: number }) => Math.atan2(p.y - centre.y, p.x - centre.x);
        const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
        expect(turn(angle(at(lone[0])), angle(mean(left)))).toBeLessThan(Math.PI / 2);
        expect(turn(angle(at(lone[1])), angle(mean(right)))).toBeLessThan(Math.PI / 2);
      });

      it("lays the connected Books out wide, and the whole fills the canvas across as well as down", async () => {
        await crowded();
        await layoutGraph(ctx.db, ctx.userId, { fresh: true });
        const g = await graph();
        // The halo rings them, so only the connected Books' shape is wide.
        const linked = layoutStats({ ...g, books: g.books.filter((b) => b.degree > 0) });
        expect(linked.width / linked.height).toBeGreaterThan(1.4);
        for (const view of Object.values(layoutStats(g).views)) expect(view.filled).toBeGreaterThan(0.3);
      });
    });

    it("places a new Book clear of every other Book and its label clear of their dots", async () => {
      // A tight neighbourhood: a hub and five Books all linked to it and to each other.
      const hub = await add("Hub");
      const ring = [];
      for (const t of ["R1", "R2", "R3", "R4", "R5"]) ring.push(await add(t));
      for (const r of ring) await connect(hub, r);
      for (let i = 0; i < ring.length; i++) await connect(ring[i], ring[(i + 1) % ring.length], "moderate");
      await layoutGraph(ctx.db, ctx.userId);
      const fresh = await add("The Wind-up Bird Chronicle");
      await connect(fresh, hub);
      await connect(fresh, ring[0], "moderate");
      await layoutGraph(ctx.db, ctx.userId);

      const g = await graph();
      const at = (id: string) => g.books.find((b) => b.bookId === id)!;
      const lengths = g.connections.map((c) => Math.hypot(at(c.a).x - at(c.b).x, at(c.a).y - at(c.b).y)).sort((p, q) => p - q);
      const unit = lengths[Math.floor(lengths.length / 2)];
      const me = at(fresh);
      const box = {
        x0: me.x + LABEL_ROOM.gap * unit,
        x1: me.x + (LABEL_ROOM.gap + me.label.length * LABEL_ROOM.char) * unit,
        y0: me.y - (LABEL_ROOM.height / 2) * unit,
        y1: me.y + (LABEL_ROOM.height / 2) * unit,
      };
      for (const other of g.books.filter((b) => b.bookId !== fresh)) {
        expect(Math.hypot(other.x - me.x, other.y - me.y)).toBeGreaterThanOrEqual(LABEL_ROOM.spacing * unit);
        expect(other.x >= box.x0 && other.x <= box.x1 && other.y >= box.y0 && other.y <= box.y1).toBe(false);
      }
    });

    it("lays out a newly finished Book even when finding its Connections fails for good", async () => {
      for (const t of ["A", "B", "C"]) await add(t);
      await ctx.jobs.drain(deps());
      await add("Unlucky");
      const provisional = positions(await graph()).Unlucky;
      const down = { ...deps(), judge: { ...fakeJudge(), judge: () => Promise.reject(new Error("overloaded")) } };
      await ctx.jobs.drain(down);
      expect(positions(await graph()).Unlucky).not.toEqual(provisional);
    });

    it("drops a removed Book from the graph and its layout", async () => {
      const a = await add("A");
      await add("B");
      await ctx.jobs.drain(deps());
      await removeFromLibrary(ctx.db, ctx.pipeline, ctx.userId, a);
      const g = await graph();
      expect(g.books.map((b) => b.title)).toEqual(["B"]);
      expect(g.connections).toEqual([]);
    });
  });

  describe("one Connection", () => {
    it("reads a Connection with both Books as the reader titles them", async () => {
      const a = await add("Stoner");
      const b = await add("Lonely");
      await ctx.db.update(libraryEntry).set({ titleOverride: "The Lonely City" }).where(eq(libraryEntry.bookId, b));
      const id = await connect(a, b, "moderate");
      const c = await readConnection(ctx.db, ctx.userId, id);
      expect(c).toMatchObject({ id, type: "thematic", strength: "moderate", grounding: "enrichment" });
      expect([c!.a.title, c!.b.title].sort()).toEqual(["Stoner", "The Lonely City"]);
      expect(c!.explanation).toMatch(/^Why /);
    });

    it("reads nothing for a dismissed or unknown Connection", async () => {
      const id = await connect(await add("A"), await add("B"), "strong", 0.5, true);
      expect(await readConnection(ctx.db, ctx.userId, id)).toBeNull();
      expect(await readConnection(ctx.db, ctx.userId, "00000000-0000-0000-0000-000000000000")).toBeNull();
    });
  });
});

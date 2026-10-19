import { describe, expect, it } from "vitest";
import { addBook, addManualBook } from "../src/domain/add-book";
import { createManualConnection, deleteManualConnection, dismissConnection } from "../src/domain/connections";
import { editBook } from "../src/domain/edit-book";
import { exportReaderData } from "../src/domain/export";
import { changeStatus } from "../src/domain/library-entry";
import { addNote } from "../src/domain/notes";
import { connection } from "../src/db/schema";
import { work } from "./fakes";
import { addReader, useTestDb } from "./harness";

// The account page's export (#67): everything the Reader wrote or chose, and nothing of another Reader's.

describe("Export", () => {
  const ctx = useTestDb();
  const stoner = work({ workKey: "/works/stoner", title: "Stoner", authors: ["John Williams"], firstPublishedYear: 1965 });
  const gilead = work({ workKey: "/works/gilead", title: "Gilead", authors: ["Marilynne Robinson"] });

  async function connect(userId: string, x: string, y: string) {
    const [p, q] = [x, y].sort();
    const [row] = await ctx.db
      .insert(connection)
      .values({
        userId, bookAId: p, bookBId: q, type: "contrast", strength: "moderate", similarity: 0.5, similarityModel: "m",
        explanation: `${userId} sees why.`, grounding: "notes", model: "m", promptVersion: "p",
      })
      .returning();
    return row.id;
  }

  it("holds the Reader's Library Entries, Notes, Manual Books and Connections, with exactly the listed fields", async () => {
    const a = ctx.userId;
    const stonerId = (await addBook(ctx.db, ctx.pipeline, a, stoner, "reading")).bookId;
    await changeStatus(ctx.db, ctx.pipeline, a, stonerId, "read");
    await editBook(ctx.db, ctx.pipeline, a, stonerId, { title: "Stoner (NYRB)", author: "John Williams" });
    const manualId = (await addManualBook(ctx.db, ctx.pipeline, a, { title: "My Diary", author: "Ada Reader", description: "Kept in 1990." }, "read")).bookId;
    await addNote(ctx.db, ctx.pipeline, a, stonerId, { body: "Quiet failure.", quote: "He had wanted…", page: 12 });
    await connect(a, stonerId, manualId);
    const gileadId = (await addBook(ctx.db, ctx.pipeline, a, gilead, "want")).bookId;
    await dismissConnection(ctx.db, ctx.pipeline, a, await connect(a, stonerId, gileadId));

    const exportedAt = new Date("2026-10-10T12:00:00Z");
    const data = await exportReaderData(ctx.db, a, exportedAt);

    const date = expect.any(String);
    const stonerBook = { id: stonerId, title: "Stoner", authors: ["John Williams"], firstPublishedYear: 1965, openLibraryWorkKey: "/works/stoner" };
    const diaryBook = { id: manualId, title: "My Diary", authors: ["Ada Reader"], firstPublishedYear: null, openLibraryWorkKey: null };
    const gileadBook = { id: gileadId, title: "Gilead", authors: ["Marilynne Robinson"], firstPublishedYear: 2000, openLibraryWorkKey: "/works/gilead" };
    expect(data).toEqual({
      formatVersion: 1,
      exportedAt: "2026-10-10T12:00:00.000Z",
      libraryEntries: [
        {
          book: stonerBook, status: "read", titleOverride: "Stoner (NYRB)", authorOverride: null, addedAt: date,
          readThroughs: [{ startedAt: date, finishedAt: date, completed: true }],
          notes: [{ text: "Quiet failure.", quote: "He had wanted…", page: 12, createdAt: date, updatedAt: date }],
        },
        {
          book: diaryBook, status: "read", titleOverride: null, authorOverride: null, addedAt: date,
          // Added as already read: a pass with unknown dates.
          readThroughs: [{ startedAt: null, finishedAt: null, completed: true }],
          notes: [],
        },
        { book: gileadBook, status: "want", titleOverride: null, authorOverride: null, addedAt: date, readThroughs: [], notes: [] },
      ],
      manualBooks: [{ id: manualId, title: "My Diary", authors: ["Ada Reader"], firstPublishedYear: null, description: "Kept in 1990." }],
      connections: expect.any(Array),
    });
    // Each pair in the order it is stored (by id), so match either way round; a dismissed one is kept, marked.
    const pair = (x: object, y: object) => expect.toBeOneOf([{ bookA: x, bookB: y }, { bookA: y, bookB: x }]);
    const fields = { madeBy: "judge", type: "contrast", strength: "moderate", explanation: `${a} sees why.`, createdAt: date };
    expect(data.connections.map(({ bookA, bookB, ...rest }) => [{ bookA, bookB }, rest])).toEqual(
      expect.arrayContaining([
        [pair(stonerBook, diaryBook), { ...fields, dismissedAt: null }],
        [pair(stonerBook, gileadBook), { ...fields, dismissedAt: date }],
      ]),
    );
    expect(data.connections).toHaveLength(2);
    // Every date is an ISO string, so the file reads the same anywhere.
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("marks who made each Connection; the Reader's own are strong, typed or not, and a deleted one keeps no reason or type", async () => {
    const a = ctx.userId;
    const finished = async (title: string) => (await addBook(ctx.db, ctx.pipeline, a, work({ workKey: `/works/${title}`, title }), "read")).bookId;
    const [stonerId, gileadId, belovedId, candideId] = [await finished("Stoner"), await finished("Gilead"), await finished("Beloved"), await finished("Candide")];
    await connect(a, stonerId, gileadId);
    const byHand = (otherBookId: string, rest: { type?: "thematic" | null; reason: string }) =>
      createManualConnection(ctx.db, ctx.pipeline, a, { bookId: stonerId, otherBookId, ...rest });
    await byHand(belovedId, { type: "thematic", reason: "Both about a life's work." });
    await byHand(candideId, { reason: "Read the same winter." });
    await deleteManualConnection(ctx.db, ctx.pipeline, a, (await byHand(gileadId, { reason: "Given by my sister." })).id);

    const data = await exportReaderData(ctx.db, a);

    const date = expect.any(String);
    // Each by the Book Stoner is connected to.
    const byOther = Object.fromEntries(data.connections.map(({ bookA, bookB, ...rest }) => [(bookA.id === stonerId ? bookB : bookA).title, rest]));
    expect(byOther).toEqual({
      // The judge's Connection of the pair was replaced by the Reader's, then deleted: kept as a dismissal is.
      Gilead: { madeBy: "reader", type: null, strength: "strong", explanation: "", createdAt: date, dismissedAt: date },
      Beloved: { madeBy: "reader", type: "thematic", strength: "strong", explanation: "Both about a life's work.", createdAt: date, dismissedAt: null },
      Candide: { madeBy: "reader", type: null, strength: "strong", explanation: "Read the same winter.", createdAt: date, dismissedAt: null },
    });
  });

  it("gives Reader B none of Reader A's Books, Notes or Connections, even on a Book they share", async () => {
    const a = ctx.userId;
    const b = (await addReader(ctx.db, "b@example.com")).id;
    const stonerId = (await addBook(ctx.db, ctx.pipeline, a, stoner, "read")).bookId;
    const manualId = (await addManualBook(ctx.db, ctx.pipeline, a, { title: "A's Diary", author: "Ada Reader" }, "read")).bookId;
    await addNote(ctx.db, ctx.pipeline, a, stonerId, { body: "A on Stoner." });
    await connect(a, stonerId, manualId);
    await addBook(ctx.db, ctx.pipeline, b, stoner, "want");
    await addNote(ctx.db, ctx.pipeline, b, stonerId, { body: "B on Stoner." });

    const data = await exportReaderData(ctx.db, b);

    expect(data.libraryEntries.map((e) => [e.book.title, e.status, e.notes.map((n) => n.text)])).toEqual([["Stoner", "want", ["B on Stoner."]]]);
    expect(data.manualBooks).toEqual([]);
    expect(data.connections).toEqual([]);
    const text = JSON.stringify(data);
    for (const secret of ["A on Stoner.", "A's Diary", manualId, a]) expect(text).not.toContain(secret);
  });

  it("is empty for a brand-new Reader", async () => {
    expect(await exportReaderData(ctx.db, ctx.userId, new Date(0))).toEqual({
      formatVersion: 1, exportedAt: "1970-01-01T00:00:00.000Z", libraryEntries: [], manualBooks: [], connections: [],
    });
  });
});

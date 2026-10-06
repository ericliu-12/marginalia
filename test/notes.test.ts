import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addBook } from "../src/domain/add-book";
import { NotInLibraryError } from "../src/domain/library-entry";
import { addNote, deleteNote, listNotes, NoteNotFoundError, updateNote } from "../src/domain/notes";
import { book, connection } from "../src/db/schema";
import { work } from "./fakes";
import { useTestDb } from "./harness";

describe("notes", () => {
  const ctx = useTestDb();
  const stoner = work({ workKey: "/works/stoner", title: "Stoner" });

  async function bookId() {
    return (await addBook(ctx.db, ctx.pipeline, ctx.userId, stoner, "reading")).bookId;
  }

  it("adds a text-only Note to a Library Entry", async () => {
    const id = await bookId();
    const created = await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "A quiet life, fully seen." });
    expect(created).toMatchObject({ body: "A quiet life, fully seen.", quote: null, page: null });
  });

  it("keeps an optional quote and page, listed newest first", async () => {
    const id = await bookId();
    await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "First" });
    await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "Second", quote: "He was loved.", page: 12 });
    const notes = await listNotes(ctx.db, ctx.userId, id);
    expect(notes.map((n) => n.body)).toEqual(["Second", "First"]);
    expect(notes[0]).toMatchObject({ quote: "He was loved.", page: 12 });
  });

  it("edits a Note's text, quote and page, and can clear the quote", async () => {
    const id = await bookId();
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "Draft", quote: "Old", page: 3 });
    const edited = await updateNote(ctx.db, ctx.pipeline, ctx.userId, n.id, { body: "Final", quote: null, page: 4 });
    expect(edited).toMatchObject({ id: n.id, body: "Final", quote: null, page: 4 });
    expect(await listNotes(ctx.db, ctx.userId, id)).toHaveLength(1);
  });

  it("deletes a Note", async () => {
    const id = await bookId();
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "Gone" });
    await deleteNote(ctx.db, ctx.userId, n.id);
    expect(await listNotes(ctx.db, ctx.userId, id)).toEqual([]);
  });

  it("does not touch another reader's Note", async () => {
    const id = await bookId();
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "Mine" });
    const other = "00000000-0000-0000-0000-000000000000";
    await expect(updateNote(ctx.db, ctx.pipeline, other, n.id, { body: "Hijacked" })).rejects.toThrow();
    await deleteNote(ctx.db, other, n.id);
    expect((await listNotes(ctx.db, ctx.userId, id))[0].body).toBe("Mine");
  });

  it("deleting a Note that is already gone is a no-op", async () => {
    const id = await bookId();
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "Once" });
    await deleteNote(ctx.db, ctx.userId, n.id);
    await expect(deleteNote(ctx.db, ctx.userId, n.id)).resolves.toBeUndefined();
  });

  it("editing a Note that is gone fails", async () => {
    const id = await bookId();
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "Once" });
    await deleteNote(ctx.db, ctx.userId, n.id);
    await expect(updateNote(ctx.db, ctx.pipeline, ctx.userId, n.id, { body: "Again" })).rejects.toThrow(NoteNotFoundError);
  });

  it("a Book outside the library has no Notes and takes none", async () => {
    const [b] = await ctx.db.insert(book).values({ title: "Elsewhere" }).returning();
    expect(await listNotes(ctx.db, ctx.userId, b.id)).toEqual([]);
    await expect(addNote(ctx.db, ctx.pipeline, ctx.userId, b.id, { body: "Hi" })).rejects.toThrow(NotInLibraryError);
  });

  it("rejects an empty body", async () => {
    const id = await bookId();
    await expect(addNote(ctx.db, ctx.pipeline, ctx.userId, id, { body: "   " })).rejects.toThrow();
  });

  it("leaves Connections untouched when a Note is edited or deleted", async () => {
    const a = await bookId();
    const b = (await addBook(ctx.db, ctx.pipeline, ctx.userId, work({ workKey: "/works/other", title: "Other" }), "read")).bookId;
    const n = await addNote(ctx.db, ctx.pipeline, ctx.userId, a, { body: "Solitude", quote: "A life of quiet." });
    const [bookAId, bookBId] = a < b ? [a, b] : [b, a];
    await ctx.db.insert(connection).values({
      userId: ctx.userId, bookAId, bookBId, type: "thematic", strength: "strong", similarity: 0.9,
      similarityModel: "m", explanation: 'Both honour "A life of quiet."', grounding: "notes",
      quotedNoteIds: [n.id], model: "m", promptVersion: "v1",
    });
    const snapshot = () => ctx.db.select().from(connection).where(eq(connection.userId, ctx.userId));
    const before = await snapshot();

    await updateNote(ctx.db, ctx.pipeline, ctx.userId, n.id, { body: "Rewritten", quote: "Something else" });
    expect(await snapshot()).toEqual(before);
    await deleteNote(ctx.db, ctx.userId, n.id);
    expect(await snapshot()).toEqual(before);
  });
});

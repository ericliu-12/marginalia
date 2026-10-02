"use server";

import { revalidatePath } from "next/cache";
import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { addBook, DuplicateBookError } from "@/domain/add-book";
import type { OpenLibraryWork, Status } from "@/domain/search";

export type AddResult = { ok: true } | { ok: false; reason: "duplicate" | "failed" };

export async function addBookAction(work: OpenLibraryWork, status: Status): Promise<AddResult> {
  try {
    const db = appDb();
    await addBook(db, await getSeededUserId(db), work, status);
    revalidatePath("/");
    return { ok: true };
  } catch (err) {
    if (err instanceof DuplicateBookError) return { ok: false, reason: "duplicate" };
    console.error(err);
    return { ok: false, reason: "failed" };
  }
}

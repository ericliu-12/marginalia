import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { searchBooks } from "@/domain/search";
import { bookSearchGateway } from "@/lib/book-search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const db = appDb();
    return Response.json(await searchBooks(db, await getSeededUserId(db), bookSearchGateway(), q));
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Search is unavailable right now." }, { status: 502 });
  }
}

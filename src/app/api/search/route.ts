import { appDb } from "@/db/client";
import { searchBooks } from "@/domain/search";
import { bookSearchGateway } from "@/lib/book-search";
import { requireReader } from "@/lib/signed-in";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await requireReader().catch(() => null);
  if (!userId) return new Response(null, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return Response.json(await searchBooks(appDb(), userId, bookSearchGateway(), q));
  } catch (err) {
    console.error(err);
    return Response.json({ error: "Search is unavailable right now." }, { status: 502 });
  }
}

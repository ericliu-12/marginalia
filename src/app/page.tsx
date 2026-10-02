import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { readLibrary } from "@/domain/library";

export const dynamic = "force-dynamic";

// Walking-skeleton page: proves app -> domain -> Postgres. Visual design comes
// with the library-view ticket (shaped via /impeccable shape).
export default async function LibraryPage() {
  const db = appDb();
  const library = await readLibrary(db, await getSeededUserId(db));

  return (
    <main>
      <h1>Library</h1>
      {library.length === 0 ? (
        <p>Your library is empty.</p>
      ) : (
        <ul>
          {library.map((item) => (
            <li key={item.bookId}>{item.title}</li>
          ))}
        </ul>
      )}
    </main>
  );
}

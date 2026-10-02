import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { readLibrary } from "@/domain/library";
import { LibraryWorkspace } from "./library-workspace";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const db = appDb();
  return <LibraryWorkspace items={await readLibrary(db, await getSeededUserId(db))} />;
}

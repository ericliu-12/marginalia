import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { countFindingConnections } from "@/domain/connections";
import { readLibrary } from "@/domain/library";
import { Library } from "./library";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const db = appDb();
  const userId = await getSeededUserId(db);
  return <Library items={await readLibrary(db, userId)} finding={await countFindingConnections(db, userId)} />;
}

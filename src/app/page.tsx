import { redirect } from "next/navigation";
import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { countFindingConnections } from "@/domain/connections";
import { readLibrary } from "@/domain/library";
import { readPause } from "@/domain/spend";
import { hasReaderSession, hasSession } from "@/lib/signed-in";
import { Library } from "./library";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  if (!(await hasSession())) redirect("/login");
  const db = appDb();
  const userId = await getSeededUserId(db);
  const [items, finding, pause, signedIn] = await Promise.all([readLibrary(db, userId), countFindingConnections(db, userId), readPause(db), hasReaderSession()]);
  return <Library items={items} finding={finding} paused={pause?.resumesOn ?? null} signedIn={signedIn} />;
}

import { redirect } from "next/navigation";
import { appDb } from "@/db/client";
import { countFindingConnections } from "@/domain/connections";
import { readLibrary } from "@/domain/library";
import { readPause } from "@/domain/spend";
import { signedInReader } from "@/lib/signed-in";
import { Library } from "./library";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const userId = await signedInReader();
  if (!userId) redirect("/sign-in");
  const db = appDb();
  const [items, finding, pause] = await Promise.all([readLibrary(db, userId), countFindingConnections(db, userId), readPause(db, userId)]);
  return <Library items={items} finding={finding} paused={pause} />;
}

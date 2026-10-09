import { redirect } from "next/navigation";
import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { countFindingConnections } from "@/domain/connections";
import { readLibrary } from "@/domain/library";
import { hasSession } from "@/lib/signed-in";
import { Library } from "./library";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  if (!(await hasSession())) redirect("/login");
  const db = appDb();
  const userId = await getSeededUserId(db);
  return <Library items={await readLibrary(db, userId)} finding={await countFindingConnections(db, userId)} />;
}

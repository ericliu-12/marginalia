import { redirect } from "next/navigation";
import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { countFindingConnections } from "@/domain/connections";
import { readEntryEnrichment } from "@/domain/enrichment";
import { readGraph } from "@/domain/graph";
import { readLibrary } from "@/domain/library";
import { readPause } from "@/domain/spend";
import { hasSession } from "@/lib/signed-in";
import { GraphWorkspace } from "./graph-workspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "Graph · Marginalia" };

export default async function GraphPage() {
  if (!(await hasSession())) redirect("/login");
  const db = appDb();
  const userId = await getSeededUserId(db);
  const [graph, items, finding, pause] = await Promise.all([readGraph(db, userId), readLibrary(db, userId), countFindingConnections(db, userId), readPause(db)]);
  // A lone Book's themes stand in for the Connections it has yet to make.
  const lone = graph.books.length === 1 ? await readEntryEnrichment(db, userId, graph.books[0].bookId) : null;
  return <GraphWorkspace graph={graph} items={items} finding={finding} paused={pause?.resumesOn ?? null} userId={userId} loneThemes={lone?.themes ?? []} />;
}

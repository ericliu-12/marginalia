import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { countFindingConnections } from "@/domain/connections";
import { readEnrichment } from "@/domain/enrichment";
import { readGraph } from "@/domain/graph";
import { readLibrary } from "@/domain/library";
import { GraphWorkspace } from "./graph-workspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "Graph · Marginalia" };

export default async function GraphPage() {
  const db = appDb();
  const userId = await getSeededUserId(db);
  const [graph, items, finding] = await Promise.all([readGraph(db, userId), readLibrary(db, userId), countFindingConnections(db, userId)]);
  // A lone Book's themes stand in for the Connections it has yet to make.
  const lone = graph.books.length === 1 ? await readEnrichment(db, graph.books[0].bookId) : null;
  return <GraphWorkspace graph={graph} items={items} finding={finding} userId={userId} loneThemes={lone?.themes ?? []} />;
}

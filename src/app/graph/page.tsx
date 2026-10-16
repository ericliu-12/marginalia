import { redirect } from "next/navigation";
import { appDb } from "@/db/client";
import { countFindingConnections } from "@/domain/connections";
import { readEntryEnrichment } from "@/domain/enrichment";
import { readGraph } from "@/domain/graph";
import { readLibrary } from "@/domain/library";
import { readPause } from "@/domain/spend";
import { signedInReader } from "@/lib/signed-in";
import { GraphViews } from "./graph-views";

export const dynamic = "force-dynamic";

export const metadata = { title: "Graph · Marginalia" };

export default async function GraphPage() {
  const userId = await signedInReader();
  if (!userId) redirect("/sign-in?next=%2Fgraph");
  const db = appDb();
  const [graph, items, finding, pause] = await Promise.all([readGraph(db, userId), readLibrary(db, userId), countFindingConnections(db, userId), readPause(db, userId)]);
  // A lone Book's themes stand in for the Connections it has yet to make.
  const lone = graph.books.length === 1 ? await readEntryEnrichment(db, userId, graph.books[0].bookId) : null;
  return <GraphViews graph={graph} items={items} finding={finding} paused={pause} userId={userId} loneThemes={lone?.themes ?? []} />;
}

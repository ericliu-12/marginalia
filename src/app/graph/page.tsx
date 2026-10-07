import { appDb } from "@/db/client";
import { getSeededUserId } from "@/db/seed";
import { countFindingConnections } from "@/domain/connections";
import { readGraph } from "@/domain/graph";
import { readLibrary } from "@/domain/library";
import { GraphWorkspace } from "./graph-workspace";

export const dynamic = "force-dynamic";

export const metadata = { title: "Graph · Marginalia" };

export default async function GraphPage() {
  const db = appDb();
  const userId = await getSeededUserId(db);
  const [graph, items, finding] = await Promise.all([readGraph(db, userId), readLibrary(db, userId), countFindingConnections(db, userId)]);
  return <GraphWorkspace graph={graph} items={items} finding={finding} userId={userId} />;
}

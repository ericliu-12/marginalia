"use client";

import type { GraphView } from "@/domain/graph";
import type { Selection } from "./graph-canvas";

// The canvas is not readable by assistive tech; the same Books and Clusters, as lists, open the same
// panel or sheet. The Book or Cluster a list item stands for is marked on the canvas while it has focus.
export function GraphLists({
  graph,
  onPoint,
  onPointCluster,
  onOpen,
}: {
  graph: GraphView;
  onPoint: (bookId: string | null) => void;
  onPointCluster: (id: string | null) => void;
  onOpen: (target: HTMLElement, s: Selection) => void;
}) {
  const byTitle = [...graph.books].sort((a, b) => a.title.localeCompare(b.title));
  return (
    <>
      <nav aria-label="Books in the graph" className="sr-only">
        <ul>
          {byTitle.map((b) => (
            <li key={b.bookId}>
              <button
                type="button"
                onFocus={() => onPoint(b.bookId)}
                onBlur={() => onPoint(null)}
                onClick={(e) => onOpen(e.currentTarget, { kind: "book", bookId: b.bookId })}
              >
                {b.title}, {b.degree} {b.degree === 1 ? "connection" : "connections"}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {graph.clusters.length > 0 && (
        <nav aria-label="Clusters in the graph" className="sr-only">
          <ul>
            {graph.clusters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onFocus={() => onPointCluster(c.id)}
                  onBlur={() => onPointCluster(null)}
                  onClick={(e) => onOpen(e.currentTarget, { kind: "cluster", id: c.id })}
                >
                  {/* An unnamed Cluster's name already counts its Books. */}
                  {c.named ? `${c.name}, ${c.bookIds.length} books` : c.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { GraphBook, GraphCluster } from "@/domain/graph";
import { titleLink } from "../connections";

// One Cluster, chosen by its name on the graph: its name, what its Books share, and the Books, the
// earliest finished first. Each title opens that Book. Lives in the same floating panel as the Book
// panel, with the same way out. `cluster` is undefined once a fresh graph no longer has it.
export function ClusterPanel({
  cluster,
  books,
  onBack,
  onOpenBook,
}: {
  cluster: GraphCluster | undefined;
  books: GraphBook[];
  onBack: () => void;
  onOpenBook: (bookId: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const goneRef = useRef<HTMLParagraphElement>(null);
  const present = cluster !== undefined;
  useEffect(() => {
    (present ? headingRef : goneRef).current?.focus();
  }, [present]);

  const members = cluster
    ? books.filter((b) => cluster.bookIds.includes(b.bookId)).sort((p, q) => p.finishedAt - q.finishedAt)
    : [];

  return (
    <aside aria-label="Cluster" onKeyDown={(e) => e.key === "Escape" && onBack()} className="flex h-full min-h-0 flex-col bg-paper-2">
      <div className="px-6 pt-5 pb-3">
        <button
          type="button"
          onClick={onBack}
          className="-ml-0.5 flex items-center gap-1.5 font-sans text-[0.8rem] font-medium text-ink-3 transition-colors duration-150 hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to the graph
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-10">
        {!cluster && (
          <p ref={goneRef} tabIndex={-1} className="text-ink-2 italic outline-none">
            This Cluster is no longer in your graph.
          </p>
        )}
        {cluster && (
          <article>
            <h2 ref={headingRef} tabIndex={-1} className="text-[1.35rem] leading-tight font-medium text-balance italic outline-none">
              {cluster.name}
            </h2>
            {/* Until it is named, its name already counts the Books. */}
            {cluster.named ? (
              <>
                <p className="mt-1.5 font-sans text-[0.8rem] font-medium text-ink-2">Cluster of {members.length} Books</p>
                {cluster.description && <p className="mt-5 max-w-[60ch] text-[1.0625rem] leading-relaxed">{cluster.description}</p>}
              </>
            ) : (
              <p className="mt-5 text-ink-2 italic">Not named yet.</p>
            )}
            <ul aria-label="Books in this Cluster" className="mt-8 divide-y divide-rule/60 border-t border-rule">
              {members.map((b) => (
                <li key={b.bookId} className="py-3.5">
                  <p className="text-[1.05rem] leading-snug font-medium">
                    <button type="button" onClick={() => onOpenBook(b.bookId)} className={titleLink}>
                      {b.title}
                    </button>
                  </p>
                  <p className="mt-1 font-sans text-[0.8rem] text-ink-2">
                    {[b.authors.join(", "), `finished ${new Date(b.finishedAt).getFullYear()}`].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          </article>
        )}
      </div>
    </aside>
  );
}

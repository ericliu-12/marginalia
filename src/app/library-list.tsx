"use client";

import type { LibraryItem } from "@/domain/library";
import type { Status } from "@/domain/search";
import { useStatusMove } from "./use-status-move";
import { ClusterDot } from "./cluster-tint";
import { DraftLine, EmptyShelves, MoreBooks, SHELVES, ShelfLabel, shortDate, useDrafts, useExpandedShelves } from "./shelf";

// Quiet one-click moves per Status, on each row and in the Book panel.
export const MOVES: Record<Status, { label: string; to: Status }[]> = {
  reading: [
    { label: "Mark finished", to: "read" },
    { label: "Want to read", to: "want" },
  ],
  want: [
    { label: "Start reading", to: "reading" },
    { label: "Mark finished", to: "read" },
  ],
  read: [{ label: "Read again", to: "reading" }],
};

// The desktop's shelves. "i. reading" is a block of titles two abreast; "ii. want to read" and
// "iii. read" are hairline rows, Read's led by its Cluster's dot and ending with the finish date.
export function LibraryList({ items, openBookId, onOpen }: { items: LibraryItem[]; openBookId?: string; onOpen: (bookId: string) => void }) {
  const { shown, expand } = useExpandedShelves();
  const drafts = useDrafts(items);

  if (items.length === 0) return <EmptyShelves />;

  const shelves = SHELVES.map((s) => ({ ...s, rows: items.filter((i) => i.status === s.status) })).filter((s) => s.status === "reading" || s.rows.length > 0);
  return (
    <div className="flex flex-col gap-7">
      {shelves.map(({ status, label, rows }, index) => {
        const visible = shown(status, rows);
        return (
          <section key={status} aria-labelledby={`h-${status}`}>
            <ShelfLabel id={`h-${status}`} index={index} label={label} count={status === "read" ? rows.length : undefined} />
            {status === "reading" ? (
              rows.length > 0 ? (
                <ul className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-3">
                  {rows.map((item) => (
                    <Row key={item.bookId} item={item} open={item.bookId === openBookId} draftPage={drafts.get(item.bookId)} onOpen={onOpen} />
                  ))}
                </ul>
              ) : (
                <p className="mt-3 max-w-[40ch] text-ink-2 italic">Nothing in progress. Add a Book you’re reading, or start one from Want to read.</p>
              )
            ) : (
              <ul className="mt-1 divide-y divide-rule-3">
                {visible.map((item) => (
                  <Row key={item.bookId} item={item} open={item.bookId === openBookId} onOpen={onOpen} />
                ))}
              </ul>
            )}
            {visible.length < rows.length && <MoreBooks count={rows.length - visible.length} firstHidden={rows[visible.length].bookId} onExpand={() => expand(status)} />}
          </section>
        );
      })}
    </div>
  );
}

// One Book on a shelf. The whole row opens it; its title is the button, stretched over the row. The
// Status moves rest unseen on a pointer, coming up on hover or keyboard focus in the author and date's place;
// on touch they stay, as a line of quiet buttons under the row.
function Row({ item, open, draftPage, onOpen }: { item: LibraryItem; open: boolean; draftPage?: string; onOpen: (bookId: string) => void }) {
  const { pending, moving, error, move } = useStatusMove(item.bookId);
  const reading = item.status === "reading";
  const author = item.authors.join(", ");

  const title = (
    <button
      type="button"
      data-book-id={item.bookId}
      aria-current={open || undefined}
      onClick={() => onOpen(item.bookId)}
      className={`text-left italic decoration-rule underline-offset-4 after:absolute after:inset-0 group-hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-thematic ${reading ? "text-[22px] leading-[1.2]" : "text-[18px] leading-[1.25]"}`}
    >
      {item.title}
    </button>
  );

  const moves = (
    <div
      role="group"
      aria-label={`Change status of ${item.title}`}
      className={`relative z-10 flex flex-wrap gap-2 [@media(hover:hover)]:gap-4 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:transition-opacity [@media(hover:hover)]:duration-150 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 ${
        reading
          ? "ml-auto"
          : "col-span-full pb-1.5 [@media(hover:hover)]:absolute [@media(hover:hover)]:inset-y-0 [@media(hover:hover)]:right-2.5 [@media(hover:hover)]:items-center [@media(hover:hover)]:bg-(--row) [@media(hover:hover)]:pb-0 [@media(hover:hover)]:pl-4"
      }`}
    >
      {MOVES[item.status].map(({ label, to }) => (
        <button
          key={to}
          type="button"
          aria-label={`${label}: ${item.title}`}
          onClick={() => move(to)}
          className="min-h-11 border border-ink/70 px-2.5 text-[14px] text-ink transition-colors duration-150 hover:bg-ink hover:text-paper [@media(hover:hover)]:min-h-0 [@media(hover:hover)]:border-transparent [@media(hover:hover)]:px-0 [@media(hover:hover)]:py-0 [@media(hover:hover)]:text-ink-3 [@media(hover:hover)]:underline [@media(hover:hover)]:decoration-rule [@media(hover:hover)]:underline-offset-4 [@media(hover:hover)]:hover:bg-transparent [@media(hover:hover)]:hover:text-ink [@media(hover:hover)]:hover:decoration-ink"
        >
          {pending && moving === to ? "Moving…" : label}
        </button>
      ))}
    </div>
  );

  // On a pointer, the author and date give their place to the moves as they come up, so the two never
  // overprint; under reduced motion the swap is instant (globals.css).
  const givesWay =
    "[@media(hover:hover)]:transition-opacity [@media(hover:hover)]:duration-150 [@media(hover:hover)]:group-hover:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-0";

  // The row bleeds 10px past the column, its first 2px the edge a selected row shows in the accent.
  const frame = `group relative -mx-2.5 border-l-2 pr-2.5 pl-2 ${open ? "border-l-accent bg-paper-3 [--row:var(--color-paper-3)]" : "border-l-transparent [--row:var(--color-paper)]"}`;
  const failed = error && <p role="alert" className="relative z-10 col-span-full pb-1.5 text-[14px] text-contrast">Couldn’t move this book. Try again.</p>;

  if (reading) {
    return (
      <li aria-busy={pending} className={`${frame} py-1.5`}>
        <p>{title}</p>
        {/* The moves wait at the end of the author's line, so the block keeps no empty band for them. */}
        <div className="flex flex-wrap items-baseline gap-x-4">
          <p className="caps text-[14px] tracking-[1px] text-ink-2">{author}</p>
          {moves}
        </div>
        {item.reReading && <p className="text-[15px] text-ink-3 italic">Re-reading</p>}
        {draftPage !== undefined && <DraftLine page={draftPage} className="mt-1 text-[15px]" />}
        {failed}
      </li>
    );
  }

  const read = item.status === "read";
  return (
    <li aria-busy={pending} className={`${frame} grid min-h-11 content-center items-baseline gap-x-3.5 py-2 ${read ? "grid-cols-[8px_minmax(0,1fr)_auto_auto]" : "grid-cols-[minmax(0,1fr)_auto]"}`}>
      {read && <span className="text-[18px]">{item.cluster && <ClusterDot wash={item.cluster.wash} />}</span>}
      <p className="min-w-0">
        {title}
        {item.cluster?.name && <span className="sr-only">, in {item.cluster.name}</span>}
      </p>
      <p title={author} className={`caps max-w-[18rem] truncate text-right text-[14px] tracking-[1px] text-ink-2 ${givesWay}`}>{author}</p>
      {read && <p className={`text-[14px] text-ink-2 tabular-nums ${givesWay}`}>{item.finishedAt !== null && shortDate(item.finishedAt)}</p>}
      {moves}
      {failed}
    </li>
  );
}

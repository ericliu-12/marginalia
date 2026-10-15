"use client";

import { useRef, useState } from "react";
import type { LibraryItem } from "@/domain/library";
import { FindingIndicator } from "./connections";
import { LibraryList } from "./library-list";
import { BookPanel } from "./book-panel";
import { SearchPane } from "./search-pane";
import { AccountLink } from "./account-link";
import { ViewSwitch } from "./view-switch";
import type { Pause } from "@/domain/spend";

export function LibraryWorkspace({ items, finding, paused }: { items: LibraryItem[]; finding: number; paused: Pause | null }) {
  const [searchOpen, setSearchOpen] = useState(true);
  const [bookId, setBookId] = useState<string | null>(null);
  // The Book last removed: search says so and fetches again, so its result stops saying it is in the library.
  const [removed, setRemoved] = useState<{ title: string } | null>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const book = items.find((i) => i.bookId === bookId);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-14 pt-7 pb-6">
        <div className="mr-auto flex flex-wrap items-baseline gap-x-8">
          <h1 className="text-[30px] leading-none italic">Marginalia</h1>
          <ViewSwitch current="library" />
          <FindingIndicator initial={finding} paused={paused} />
        </div>
        <div className="flex items-baseline gap-6">
          {/* Kept in place, unseen, while search is open: the header keeps its height, so the library doesn't move. */}
          <button
            ref={openRef}
            type="button"
            aria-expanded={false}
            aria-controls="add-a-book"
            onClick={() => setSearchOpen(true)}
            className={`min-h-11 bg-ink px-[18px] text-[16px] text-paper italic transition-colors duration-150 hover:bg-ink-2 ${searchOpen ? "invisible" : ""}`}
          >
            Add a Book
          </button>
          <AccountLink />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-1 overflow-y-auto pt-1 pr-12 pb-16 pl-14">
          <div className="max-w-[48rem]">
            <LibraryList items={items} openBookId={book?.bookId} onOpen={(id) => { setBookId(id); setSearchOpen(true); }} />
          </div>
        </main>
        {searchOpen && (
          <div className="border-t border-rule lg:w-[min(460px,40vw)] lg:shrink-0 lg:border-t-0 lg:border-l">
            {book && (
              <BookPanel
                key={book.bookId}
                variant="docked"
                item={book}
                backLabel="Back to search"
                onOpenBook={setBookId}
                onBack={() => setBookId(null)}
                onRemoved={() => {
                  setBookId(null);
                  setRemoved({ title: book.title });
                }}
              />
            )}
            {/* Kept mounted while a Book is open so the query and results are still there on return. */}
            <div hidden={!!book} className="h-full">
              <SearchPane
                removed={removed}
                onOpenBook={setBookId}
                hidden={!!book}
                onClose={() => {
                  setSearchOpen(false);
                  requestAnimationFrame(() => openRef.current?.focus());
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

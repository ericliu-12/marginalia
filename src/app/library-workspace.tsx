"use client";

import { useRef, useState } from "react";
import type { LibraryItem } from "@/domain/library";
import { FindingIndicator } from "./connections";
import { LibraryList } from "./library-list";
import { BookPanel } from "./book-panel";
import { SearchPane } from "./search-pane";
import { ViewSwitch } from "./view-switch";

export function LibraryWorkspace({ items, finding }: { items: LibraryItem[]; finding: number }) {
  const [searchOpen, setSearchOpen] = useState(true);
  const [bookId, setBookId] = useState<string | null>(null);
  // The Book last removed: search says so and fetches again, so its result stops saying it is in the library.
  const [removed, setRemoved] = useState<{ title: string } | null>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const book = items.find((i) => i.bookId === bookId);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <header className="flex flex-wrap items-baseline justify-between gap-y-2 px-8 pt-7 pb-5 lg:px-12">
        <div className="mr-auto flex items-baseline gap-8">
          <h1 className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</h1>
          <ViewSwitch current="library" />
          <FindingIndicator initial={finding} />
        </div>
        {!searchOpen && (
          <button
            ref={openRef}
            type="button"
            aria-expanded={false}
            aria-controls="add-a-book"
            onClick={() => setSearchOpen(true)}
            className="rounded-[3px] bg-ink px-4 py-2 font-sans text-sm font-medium text-paper transition-colors hover:bg-ink-2"
          >
            Add a book
          </button>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-1 overflow-y-auto px-8 pt-4 pb-16 lg:px-12">
          <div className="max-w-[42rem]">
            <LibraryList items={items} openBookId={book?.bookId} onOpen={(id) => { setBookId(id); setSearchOpen(true); }} />
          </div>
        </main>
        {searchOpen && (
          <div className="border-t border-rule lg:w-[27rem] lg:shrink-0 lg:border-t-0 lg:border-l">
            {book && (
              <BookPanel
                item={book}
                backLabel="Back to search"
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

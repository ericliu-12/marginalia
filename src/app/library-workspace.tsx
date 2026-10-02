"use client";

import { useState } from "react";
import type { LibraryItem } from "@/domain/library";
import { LibraryList } from "./library-list";
import { SearchPane } from "./search-pane";

export function LibraryWorkspace({ items }: { items: LibraryItem[] }) {
  const [searchOpen, setSearchOpen] = useState(true);

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <header className="flex items-baseline justify-between px-8 pt-7 pb-5 lg:px-12">
        <h1 className="text-[1.75rem] leading-none font-medium tracking-[-0.01em] italic">Marginalia</h1>
        {!searchOpen && (
          <button
            type="button"
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
            <LibraryList items={items} />
          </div>
        </main>
        {searchOpen && (
          <div className="border-t border-rule lg:w-[27rem] lg:shrink-0 lg:border-t-0 lg:border-l">
            <SearchPane onClose={() => setSearchOpen(false)} />
          </div>
        )}
      </div>
    </div>
  );
}

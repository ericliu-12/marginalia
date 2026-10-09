"use client";

import type { LibraryItem } from "@/domain/library";
import { LibraryWorkspace } from "./library-workspace";
import { MobileShelf } from "./mobile-shelf";
import { useWide } from "./use-wide";

// The server can't tell the screen's width, so it renders both and CSS shows the right one; once the
// browser knows, only that one stays mounted.
export function Library(props: { items: LibraryItem[]; finding: number; paused: string | null }) {
  const wide = useWide(null);
  return (
    <>
      {wide !== false && (
        <div className={wide === null ? "hidden lg:block" : undefined}>
          <LibraryWorkspace {...props} />
        </div>
      )}
      {wide !== true && (
        <div className={wide === null ? "lg:hidden" : undefined}>
          <MobileShelf {...props} />
        </div>
      )}
    </>
  );
}

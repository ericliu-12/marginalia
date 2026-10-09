"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { LibraryItem } from "@/domain/library";
import type { Note } from "@/domain/notes";
import { NoteForm } from "./book-panel";
import { quietLink } from "./quiet-link";

// The part of the page the reader can see, in page coordinates: on a phone the on-screen keyboard takes
// the rest. iOS keeps the layout viewport full height under the keyboard, so `fixed; bottom: 0` would
// sit behind it; the visual viewport is what shrinks.
function useVisibleViewport() {
  const [box, setBox] = useState<{ top: number; height: number; keyboard: boolean } | null>(null);
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setBox({ top: vv.offsetTop, height: vv.height, keyboard: document.documentElement.clientHeight - vv.offsetTop - vv.height > 80 });
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return box;
}

// Focus the sheet's text with the caret after any kept draft. Inside a tap, this raises a phone's keyboard.
export function focusNote(text: HTMLTextAreaElement | null) {
  if (!text) return;
  text.focus({ preventScroll: true });
  text.setSelectionRange(text.value.length, text.value.length);
}

// The phone's Note sheet: a Note on one Book, written from its shelf row. It rises over the shelf and
// rides on top of the keyboard, text first, with the quote and the page as quiet reveals. The host
// focuses `bodyRef` inside the tap that opens it, which is what lets a phone raise its keyboard.
// Whatever is typed is the Book's draft, kept however the sheet closes.
export function NoteSheet({
  item,
  bodyRef,
  onClose,
  onSaved,
}: {
  item: LibraryItem;
  bodyRef: RefObject<HTMLTextAreaElement | null>;
  onClose: () => void;
  onSaved: (note: Note) => void;
}) {
  const view = useVisibleViewport();

  // Opened by its URL (a refresh), with no tap to focus it in, it takes focus itself.
  useEffect(() => {
    if (!bodyRef.current?.closest("[role=dialog]")?.contains(document.activeElement)) focusNote(bodyRef.current);
  }, [bodyRef]);

  // The shelf behind stays where it was rather than scrolling under the reader's thumb.
  useEffect(() => {
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = was;
    };
  }, []);

  return (
    <div
      className="fixed inset-x-0 z-30 flex flex-col justify-end"
      style={view ? { top: view.top, height: view.height } : { top: 0, height: "100dvh" }}
    >
      <div aria-hidden onClick={onClose} className="absolute inset-0 bg-ink/30 motion-safe:animate-fade-in" />
      <div
        role="dialog"
        aria-modal
        aria-label={`Note on ${item.title}`}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className={`relative mx-auto flex max-h-[calc(100%-1.5rem)] w-full max-w-[40rem] flex-col overflow-y-auto overscroll-contain rounded-t-[3px] border-t border-rule bg-paper-2 px-5 pt-1.5 shadow-[0_-12px_32px_-8px_rgb(35_29_23/0.18),0_-2px_6px_rgb(35_29_23/0.06)] motion-safe:animate-sheet-up ${view?.keyboard ? "pb-3" : "pb-[max(0.75rem,env(safe-area-inset-bottom))]"}`}
      >
        <header className="flex min-h-11 items-center justify-between gap-3">
          <p className="min-w-0 truncate font-sans text-sm text-ink-2">
            Note on <i className="font-serif text-base text-ink">{item.title}</i>
          </p>
          <button type="button" onClick={onClose} className={`${quietLink} shrink-0`}>
            Close
          </button>
        </header>
        <NoteForm key={item.bookId} bookId={item.bookId} variant="sheet" bodyRef={bodyRef} onSaved={onSaved} />
      </div>
    </div>
  );
}

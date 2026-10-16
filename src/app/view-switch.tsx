"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Set as the reader switches views, so the view they arrive in fades in; a page loaded afresh just shows.
let switched = false;
export function useArrivedBySwitch() {
  const [arrived] = useState(() => switched);
  useEffect(() => {
    switched = false;
  }, []);
  return arrived;
}

// Set as a Book is opened from the phone's graph, so its Book screen's back returns there.
export const openedFromGraph = { current: false };

// The two ways into the reader's books. Below lg the phone has its own switch (PhoneSwitch).
export function ViewSwitch({ current }: { current: "library" | "graph" }) {
  const views = [
    { key: "library", label: "Library", href: "/" },
    { key: "graph", label: "Graph", href: "/graph" },
  ] as const;
  return (
    <nav aria-label="Views" className="caps hidden items-baseline gap-[22px] text-[16px] tracking-[1.4px] lg:flex">
      {views.map((v) =>
        v.key === current ? (
          <span key={v.key} aria-current="page" className="py-3 text-ink underline decoration-accent underline-offset-[6px]">
            {v.label}
          </span>
        ) : (
          <Link
            key={v.key}
            href={v.href}
            onClick={() => (switched = true)}
            className="py-3 text-ink-2 underline decoration-transparent underline-offset-[6px] transition-colors duration-150 hover:text-ink hover:decoration-rule"
          >
            {v.label}
          </Link>
        ),
      )}
    </nav>
  );
}

// The phone's two ways into the reader's books, at the top of the shelf and the graph: a full-width
// switch with an ink border, the current half filled with ink.
export function PhoneSwitch({ current }: { current: "library" | "graph" }) {
  const views = [
    { key: "library", label: "Shelf", href: "/" },
    { key: "graph", label: "Graph", href: "/graph" },
  ] as const;
  const segment = "caps flex min-h-11 items-center justify-center text-[15px] tracking-[1.4px] outline-offset-[-4px]";
  return (
    <nav aria-label="Views" className="grid grid-cols-2 border border-ink">
      {views.map((v) =>
        v.key === current ? (
          <span key={v.key} aria-current="page" className={`${segment} bg-ink text-paper`}>
            {v.label}
          </span>
        ) : (
          <Link
            key={v.key}
            href={v.href}
            onClick={() => (switched = true)}
            className={`${segment} text-ink-2 transition-colors duration-150 active:bg-paper-3 active:text-ink`}
          >
            {v.label}
          </Link>
        ),
      )}
    </nav>
  );
}

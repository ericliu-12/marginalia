"use client";

import { useRef, useState } from "react";

// From this many Books, the middle of the trail folds away behind "…" until the reader opens it.
const COLLAPSE_AT = 5;

const crumbLink =
  "inline-flex min-h-6 items-center text-left underline decoration-rule underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink";

// The Follow trail at the top of the panel: each Book followed to reach this one, the current Book last.
// An earlier crumb jumps back to that Book; Clear ends the trail and stays on the current Book.
export function TrailCrumbs({
  labels,
  onRewind,
  onClear,
}: {
  labels: string[];
  onRewind: (index: number) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Opening the fold removes "…", so focus moves to the first Book it revealed.
  const revealed = useRef<HTMLButtonElement>(null);
  const last = labels.length - 1;
  // The first Book and the last two stay; the rest fold into one "…".
  const folded = !open && labels.length >= COLLAPSE_AT;
  const shown = labels.map((label, i) => ({ label, i })).filter(({ i }) => !folded || i === 0 || i >= last - 1);

  return (
    <nav aria-label="Trail" className="flex items-start gap-4 px-6 pb-3 font-sans text-[0.8rem]">
      <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 leading-snug">
        {shown.map(({ label, i }, k) => (
          <li key={i} className="flex min-w-0 items-center gap-x-1.5">
            {/* Each chevron travels with the crumb it leads to, so none is left at a line's end. */}
            {k > 0 && <Chevron />}
            {k === 1 && folded && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(true);
                    requestAnimationFrame(() => revealed.current?.focus());
                  }}
                  aria-label={`Show ${last - 2} more on the trail`}
                  className={`${crumbLink} text-ink-2`}
                >
                  …
                </button>
                <Chevron />
              </>
            )}
            {i === last ? (
              <span aria-current="location" className="inline-flex min-h-6 items-center font-medium text-ink">
                {label}
              </span>
            ) : (
              <button
                ref={i === 1 ? revealed : undefined}
                type="button"
                onClick={() => onRewind(i)}
                className={`${crumbLink} text-ink-2`}
              >
                {label}
              </button>
            )}
          </li>
        ))}
      </ol>
      <button type="button" onClick={onClear} className={`${crumbLink} shrink-0 text-ink-3`}>
        Clear<span className="sr-only"> trail</span>
      </button>
    </nav>
  );
}

function Chevron() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className="shrink-0 text-ink-3">
      <path d="M2.5 1L5.5 4l-3 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

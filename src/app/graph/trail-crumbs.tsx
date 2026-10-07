"use client";

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
  const last = labels.length - 1;
  return (
    <nav aria-label="Trail" className="px-6 pb-3 font-sans text-[0.8rem]">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 leading-snug">
        {labels.map((label, i) => (
          <li key={i} className="flex min-w-0 items-center gap-x-1.5">
            {i === last ? (
              <span aria-current="location" className="font-medium text-ink">
                {label}
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onRewind(i)}
                  className="text-left text-ink-2 underline decoration-rule underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink"
                >
                  {label}
                </button>
                <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden className="shrink-0 text-ink-3">
                  <path d="M2.5 1L5.5 4l-3 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </>
            )}
          </li>
        ))}
        <li className="ml-auto pl-3">
          <button
            type="button"
            onClick={onClear}
            className="text-ink-3 underline decoration-rule underline-offset-4 transition-colors duration-150 hover:text-ink hover:decoration-ink"
          >
            Clear
          </button>
        </li>
      </ol>
    </nav>
  );
}

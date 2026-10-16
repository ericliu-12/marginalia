"use client";

import { useState } from "react";

// A book cover, or a typeset placeholder when there is none: thin metadata never blocks adding.
// Small beside a search result; `large` once, at the top of the Book's panel.
export function Cover({ title, url, size = "small" }: { title: string; url: string | null; size?: "small" | "large" }) {
  const [failed, setFailed] = useState(false);
  const box = size === "large" ? "h-[132px] w-[88px]" : "h-[66px] w-11";
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)}
        onLoad={(e) => e.currentTarget.naturalWidth <= 1 && setFailed(true)} className={`${box} shrink-0 rounded-[2px] object-cover shadow-[0_1px_2px_rgb(26_26_26/0.25)]`} />;
  }
  return (
    <div
      aria-hidden
      className={`bg-paper-3 flex ${box} shrink-0 flex-col justify-between rounded-[2px] shadow-[0_1px_2px_rgb(26_26_26/0.2)] ${size === "large" ? "p-2" : "p-[5px]"}`}
    >
      <span className={`line-clamp-3 font-serif leading-[1.15] font-medium text-ink-2 ${size === "large" ? "text-[13px] italic" : "text-[10px]"}`}>{title}</span>
      <span className="border-t border-ink-3/40 pt-[2px]" />
    </div>
  );
}

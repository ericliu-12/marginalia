"use client";

import { useState } from "react";

// A book cover, or a typeset placeholder when there is none: thin metadata never blocks adding.
const TONES = ["bg-paper-3", "bg-[#e4dcc4]", "bg-[#ddd6c3]"];

function toneFor(title: string) {
  let h = 0;
  for (const ch of title) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export function Cover({ title, url }: { title: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)}
        onLoad={(e) => e.currentTarget.naturalWidth <= 1 && setFailed(true)} className="h-[66px] w-11 shrink-0 rounded-[2px] object-cover shadow-[0_1px_2px_rgb(35_29_23/0.25)]" />;
  }
  return (
    <div
      aria-hidden
      className={`${toneFor(title)} flex h-[66px] w-11 shrink-0 flex-col justify-between rounded-[2px] p-[5px] shadow-[0_1px_2px_rgb(35_29_23/0.2)]`}
    >
      <span className="line-clamp-3 font-serif text-[10px] leading-[1.15] font-medium text-ink-2">{title}</span>
      <span className="border-t border-ink-3/40 pt-[2px]" />
    </div>
  );
}

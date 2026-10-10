"use client";

import { useState } from "react";
import { signInPath } from "@/lib/signed-out";

// Saving a file from the home-screen app on an iPhone often does nothing, so there the file goes to the
// share sheet (Save to Files); everywhere else it downloads. Without JavaScript the link downloads anyway.
const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

// The quiet button (DESIGN.md): a hairline of ink that fills with ink on hover, 44px tall on touch.
const quietButton =
  "inline-flex min-h-11 items-center rounded-[3px] border border-ink/70 px-3 font-sans text-[0.8rem] font-medium text-ink transition-colors duration-150 hover:bg-ink hover:text-paper active:bg-ink-2 active:text-paper lg:min-h-9";

function save(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DownloadExport() {
  // `ready`: the file is fetched, but the share sheet needed a fresh tap to open.
  const [state, setState] = useState<{ is: "idle" | "pending" | "failed" } | { is: "ready"; file: File }>({ is: "idle" });

  async function share(file: File) {
    try {
      await navigator.share({ files: [file] });
      setState({ is: "idle" });
    } catch (err) {
      const name = (err as Error).name;
      if (name === "NotAllowedError") setState({ is: "ready", file });
      else if (name === "AbortError") setState({ is: "idle" });
      else setState({ is: "failed" });
    }
  }

  async function download(e: React.MouseEvent) {
    e.preventDefault();
    if (state.is === "pending") return;
    if (state.is === "ready") return share(state.file);
    setState({ is: "pending" });
    const res = await fetch("/api/export").catch(() => null);
    if (res?.status === 401) return window.location.assign(signInPath("/account"));
    const blob = res?.ok ? await res.blob().catch(() => null) : null;
    if (!blob) return setState({ is: "failed" });
    const name = /filename="([^"]+)"/.exec(res!.headers.get("Content-Disposition") ?? "")?.[1] ?? "marginalia-export.json";
    const file = new File([blob], name, { type: "application/json" });
    if (standalone() && navigator.canShare?.({ files: [file] })) return share(file);
    save(file);
    setState({ is: "idle" });
  }

  const label = { idle: "Download export", pending: "Preparing export…", failed: "Try again", ready: "Save export" }[state.is];
  return (
    <div className="mt-5 flex flex-wrap items-baseline gap-x-4 gap-y-2">
      <a href="/api/export" download onClick={download} aria-disabled={state.is === "pending"} className={`${quietButton} aria-disabled:pointer-events-none aria-disabled:border-rule aria-disabled:text-ink-3`}>
        {label}
      </a>
      <p role="status" className="font-sans text-[0.8rem] text-contrast">
        {state.is === "failed" ? "Couldn’t prepare your export. Check your connection and try again." : ""}
      </p>
    </div>
  );
}

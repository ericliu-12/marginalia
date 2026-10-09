"use client";

import { useEffect, useState } from "react";

// Which window the page is in: the home-screen app or a Safari tab, which keep separate cookies.
export function DisplayMode() {
  const [mode, setMode] = useState<string | null>(null);
  useEffect(() => {
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setMode(standalone ? "the home-screen app" : "a browser tab");
  }, []);
  return <p className="mt-2 font-sans text-sm text-ink-2">This page is open in {mode ?? "…"}.</p>;
}

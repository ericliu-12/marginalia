import { useEffect, useLayoutEffect, useState } from "react";

// The part of the page the reader can see, as insets from the layout viewport: on a phone the on-screen
// keyboard takes the rest. iOS keeps the layout viewport full height under the keyboard, so `fixed;
// bottom: 0` would sit behind it; the visual viewport is what shrinks, and iOS may pan it down as well.
// A layer over the page stays `inset-0`, so nothing behind can show, and pads its inside by these.
export function useVisibleViewport() {
  const [box, setBox] = useState<{ top: number; bottom: number; keyboard: boolean } | null>(null);
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const bottom = Math.max(0, document.documentElement.clientHeight - vv.offsetTop - vv.height);
      setBox({ top: vv.offsetTop, bottom, keyboard: bottom > 80 });
    };
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

// While a layer is over the page, the page behind stays where it was rather than scrolling under the
// reader's thumb, or being scrolled by iOS to reach a focused field.
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { documentElement: html, body } = document;
    const was = [html.style.overflow, body.style.overflow];
    html.style.overflow = body.style.overflow = "hidden";
    return () => {
      [html.style.overflow, body.style.overflow] = was;
    };
  }, [active]);
}

import { useLayoutEffect, useState } from "react";

// The part of the page the reader can see, in page coordinates: on a phone the on-screen keyboard takes
// the rest. iOS keeps the layout viewport full height under the keyboard, so `fixed; bottom: 0` would
// sit behind it; the visual viewport is what shrinks.
export function useVisibleViewport() {
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

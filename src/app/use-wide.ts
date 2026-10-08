import { useSyncExternalStore } from "react";

// Matches Tailwind's lg: where the graph fits. Below it the library is the phone's shelf.
export const WIDE = "(min-width: 1024px)";

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

// Whether the screen is wide; `onServer` is what to assume before the browser can tell.
export const useWide = <T extends boolean | null>(onServer: T) =>
  useSyncExternalStore<boolean | T>(subscribe, () => window.matchMedia(WIDE).matches, () => onServer);

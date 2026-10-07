import { useEffect } from "react";

// While background work is under way (Enrichment, Connections, the graph job), check back now and then.
export const POLL_MS = 4000;

// Calls `fn` now and then every `ms` after the previous call settles, so requests never overlap.
// Pauses while the tab is hidden and checks again as soon as it is shown.
export function usePoll(fn: () => Promise<unknown>, ms: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      clearTimeout(timer);
      if (busy || document.hidden) return;
      busy = true;
      try {
        await fn();
      } catch {
        // the next tick tries again
      }
      busy = false;
      if (live) timer = setTimeout(tick, ms);
    };
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fn, ms, enabled]);
}

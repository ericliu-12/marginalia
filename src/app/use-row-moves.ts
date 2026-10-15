import { useLayoutEffect, useRef, type RefObject } from "react";

export const ROW_MOVE_MS = 300;

// Rows move rather than jump. When `rows` changes (a Status move, a Book added or removed), each row
// [data-row] still in `list` glides from where it was to where it is now: one that changed shelf
// [data-shelf] crosses to its new one, coming up from faint as it goes, and the rows around it close up
// or make room. With less motion, rows simply take their places, and only one that changed shelf fades in.
export function useRowMoves(list: RefObject<HTMLElement | null>, rows: unknown) {
  // Where each row was, relative to the list, and on which shelf, as of the last change.
  const last = useRef(new Map<string, { top: number; shelf?: string }>());
  const lastRows = useRef(rows);

  // Measured afresh after every render, and when the list changes size without one (a resize, a font
  // loading), so a move always starts from where the row was seen.
  useLayoutEffect(() => {
    const host = list.current;
    if (!host) return;
    const measure = () => {
      const origin = host.getBoundingClientRect().top;
      const now = new Map<string, { top: number; shelf?: string }>();
      for (const row of host.querySelectorAll<HTMLElement>("[data-row]")) {
        now.set(row.dataset.row!, { top: row.getBoundingClientRect().top - origin, shelf: row.dataset.shelf });
      }
      return now;
    };
    const ro = new ResizeObserver(() => {
      if (!host.getAnimations({ subtree: true }).length) last.current = measure();
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [list]);

  useLayoutEffect(() => {
    const host = list.current;
    if (!host) return;
    const changed = lastRows.current !== rows;
    lastRows.current = rows;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = host.getBoundingClientRect().top;
    const now = new Map<string, { top: number; shelf?: string }>();
    for (const row of host.querySelectorAll<HTMLElement>("[data-row]")) {
      // Where it would be at rest: a row still gliding is measured without its glide.
      const glide = row.getAnimations().find((a) => a.id === "row-move");
      const offset = glide ? new DOMMatrix(getComputedStyle(row).transform).m42 : 0;
      const at = { top: row.getBoundingClientRect().top - origin - offset, shelf: row.dataset.shelf };
      now.set(row.dataset.row!, at);
      const was = last.current.get(row.dataset.row!);
      if (!changed || !was) continue;
      const crossed = was.shelf !== at.shelf;
      const dy = was.top + (glide ? offset : 0) - at.top;
      if (still) {
        if (crossed) row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
        continue;
      }
      if (Math.abs(dy) < 1 && !crossed) continue;
      glide?.cancel();
      const from: Keyframe = { transform: `translateY(${dy}px)`, ...(crossed && { opacity: 0.25 }) };
      const move = row.animate([from, { transform: "none", opacity: 1 }], { duration: ROW_MOVE_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)" });
      move.id = "row-move";
    }
    last.current = now;
  });
}

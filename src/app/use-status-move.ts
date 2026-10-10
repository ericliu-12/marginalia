import { useRef, useState, useTransition } from "react";
import type { Status } from "@/domain/search";
import { changeStatusAction } from "./client-actions";

// A Book's one-click Status moves on the desktop. A click while a move is still saving goes through too:
// Next sends them in order, so the last one stands, and only its answer may show an error.
export function useStatusMove(bookId: string) {
  const [pending, start] = useTransition();
  const [moving, setMoving] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const latest = useRef(0);

  function move(to: Status) {
    const id = ++latest.current;
    setError(false);
    setMoving(to);
    start(async () => {
      const res = await changeStatusAction(bookId, to);
      if (id === latest.current && !res.ok) setError(true);
    });
  }

  return { pending, moving, error, move };
}

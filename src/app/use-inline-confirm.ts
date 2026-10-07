import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";

// A quiet action that asks before it acts, inline. Focus lands on Keep, the safe choice, and returns to
// the action when the reader keeps the thing; Escape keeps it too, and stops there so the panel stays
// open. `act` runs in a transition; `onDone` follows a success, and a failure sets `error`.
// Spread `onKeyDown` on the element holding the confirmation, put `triggerRef` on the action and
// `keepRef` on Keep.
export function useInlineConfirm(act: () => Promise<{ ok: boolean }>, onDone: () => void) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  const keepRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (confirming) keepRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return {
    confirming,
    pending,
    error,
    keepRef,
    triggerRef,
    ask: () => setConfirming(true),
    keep: () => setConfirming(false),
    confirm: () => {
      setError(false);
      start(async () => {
        const res = await act();
        if (res.ok) onDone();
        else setError(true);
      });
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (confirming && e.key === "Escape" && !pending) {
        e.stopPropagation();
        setConfirming(false);
      }
    },
  };
}

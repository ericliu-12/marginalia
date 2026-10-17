"use client";

import { useEffect, useLayoutEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRefreshRouter } from "./client-actions";

// Lends the router to the client actions, so a save can fetch the page again once it lands.
//
// The refresh keeps the window's scroll. A screen opened by history.pushState (the phone's Book screen,
// /?book=<id>) leaves Next's tree on the page as rendered for the search before; the refreshed page comes
// back for the new search, which Next takes for a change of page, and it sets the window's scroll to the
// top as the refresh commits (#181). This component wraps the page, so its layout effect runs after
// Next's, in that commit and before the paint, and puts the scroll back where the Reader left it.
export function RefreshAfterSaves({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refreshing = useRef(false);
  // The window's scroll as the Reader last left it: scroll events come after the commit that moves it.
  const scrollY = useRef(0);
  useEffect(() => {
    setRefreshRouter(() => {
      refreshing.current = true;
      startTransition(() => router.refresh());
    });
    return () => setRefreshRouter(null);
  }, [router]);
  useEffect(() => {
    const onScroll = () => {
      scrollY.current = window.scrollY;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // Only in the commit that lands the refresh, so a screen's own move to the top meanwhile stays.
  useLayoutEffect(() => {
    if (pending || !refreshing.current) return;
    refreshing.current = false;
    if (window.scrollY === 0 && scrollY.current > 0) window.scrollTo(0, scrollY.current);
  });
  return children;
}

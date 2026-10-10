"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setRefreshRouter } from "./client-actions";

// Lends the router to the client actions, so a save can fetch the page again once it lands.
export function RefreshAfterSaves() {
  const router = useRouter();
  useEffect(() => {
    setRefreshRouter(() => router.refresh());
    return () => setRefreshRouter(null);
  }, [router]);
  return null;
}

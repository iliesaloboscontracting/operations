"use client";

import { useEffect, useRef } from "react";

// Calls `fn` every `intervalMs` and whenever the user comes back to the tab/window,
// but only while the tab is visible (no background polling).
export function useAutoRefresh(fn: () => void, intervalMs = 60_000) {
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    const run = () => {
      if (document.visibilityState === "visible") latest.current();
    };
    const timer = setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("focus", run);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("focus", run);
    };
  }, [intervalMs]);
}

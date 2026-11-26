"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

// Back to the page the list was opened from (a supervisor's or hand-over link's home page). The list carries no token,
// so it can't link back itself - it goes back in this tab's history, and only shows when we came from one of our own
// pages in this tab.
export default function BackButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(!!document.referrer && new URL(document.referrer).origin === window.location.origin && window.history.length > 1); } catch { /* no Back */ }
  }, []);
  if (!show) return null;
  return (
    <button type="button" onClick={() => window.history.back()} className="mb-4 flex items-center gap-1 text-sm text-gray-400">
      <ArrowLeft size={16} /> Back
    </button>
  );
}

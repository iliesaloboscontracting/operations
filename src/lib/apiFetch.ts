"use client";

// A drop-in replacement for fetch() for same-origin API calls made after a page has
// already loaded. If the session has expired since then, the middleware answers every
// /api/* request with a 401 - and every list-loading call in the app was treating that
// the same as "there's no data", which showed up as a confusing empty list (e.g. "No
// projects here.") instead of sending you back to sign in. This sends you back instead.
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    const next = window.location.pathname + window.location.search;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
  }
  return res;
}

// Pulls the server's own { error: "..." } message out of a failed response,
// so the UI can show what actually went wrong (e.g. "This project already
// has a job for that date and shift") instead of a generic fallback.
export async function serverErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : fallback;
}

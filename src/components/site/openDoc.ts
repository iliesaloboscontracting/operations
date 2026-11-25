"use client";

import { serverErrorMessage } from "@/lib/apiFetch";

// SD-001 (Ilies approved 26 Nov 2026): a plan, the SWMS or the topic PDF opens through a 10-minute ticket - the phone
// asks its link for one (POST .../documents/<files|topic>/<id>/ticket), then opens the ticket's address, which never
// carries the link's secret. A blocked pop-up opens it in this tab instead. -> null, or why it couldn't.
export async function openDoc(api: string, what: "files" | "topic", id: string): Promise<string | null> {
  const r = await fetch(`${api}/documents/${what}/${encodeURIComponent(id)}/ticket`, { method: "POST" }).catch(() => null);
  if (!r) return "No signal - try again.";
  if (!r.ok) return serverErrorMessage(r, "That document isn't available any more - go back and look again.");
  const { url } = (await r.json()) as { url: string };
  const w = window.open(url, "_blank");
  if (w) w.opener = null;
  else window.location.href = url;
  return null;
}
"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

// Accounts stage 5: the expired-ticket flag on the Operations board (26 Oct 2026). Information only - it never
// blocks dragging or assigning. Managers and Admins only (the route refuses a Viewer); labels and dates only.
type Flags = Record<string, { expired: { label: string; expiryDate: string }[] }>;
const Ctx = createContext<Flags>({});

export function TicketFlagsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [flags, setFlags] = useState<Flags>({});
  useEffect(() => {
    if (!enabled) return;
    apiFetch("/api/compliance/flags").then((r) => (r.ok ? r.json() : null)).then((d) => d && setFlags(d.flags ?? {})).catch(() => undefined);
  }, [enabled]);
  return <Ctx.Provider value={flags}>{children}</Ctx.Provider>;
}

const dmy = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

export function TicketFlagBadge({ resourceId }: { resourceId: string }) {
  const f = useContext(Ctx)[resourceId];
  if (!f?.expired.length) return null;
  const title = `Expired ticket${f.expired.length > 1 ? "s" : ""}: ${f.expired.map((e) => `${e.label} (${dmy(e.expiryDate)})`).join(", ")}. Information only - accounts keep the details.`;
  return (
    // A small icon so a worker's name keeps its room in the narrow sidebar; the tooltip says which ticket.
    <span title={title} aria-label={title} className="inline-flex shrink-0 items-center rounded-full bg-red-900/80 p-0.5 text-red-200">
      <ShieldAlert size={11} strokeWidth={2.5} aria-hidden />
    </span>
  );
}

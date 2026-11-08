"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { PRIORITY_LABEL, type FaultPriority } from "@/lib/prestart/rules";

// Open vehicle & plant faults (pre-start checks, 8 Nov 2026) as a small icon next to the machine on the board and the
// Vehicles register - the worst open priority's colour. Information only: it never blocks or warns on an allocation.
// Like the expired-ticket flag (components/compliance/TicketFlags.tsx); the route refuses a Viewer, so pass `enabled`.
type Flags = Record<string, { open: number; worst: FaultPriority }>;
const Ctx = createContext<Flags>({});

export function FaultFlagsProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [flags, setFlags] = useState<Flags>({});
  useEffect(() => {
    if (!enabled) return;
    apiFetch("/api/faults/flags").then((r) => (r.ok ? r.json() : null)).then((d) => d && setFlags(d.flags ?? {})).catch(() => undefined);
  }, [enabled]);
  return <Ctx.Provider value={flags}>{children}</Ctx.Provider>;
}

const TONE: Record<FaultPriority, string> = {
  DO_NOT_USE: "bg-red-600 text-white",
  URGENT: "bg-red-900/80 text-red-200",
  HIGH: "bg-amber-900/80 text-amber-200",
  LOW: "bg-gray-700 text-gray-200",
};

export function FaultFlagBadge({ resourceId }: { resourceId: string }) {
  const f = useContext(Ctx)[resourceId];
  if (!f) return null;
  const title = `${f.open} open fault${f.open > 1 ? "s" : ""} - worst: ${PRIORITY_LABEL[f.worst]}. See Faults. Information only.`;
  return (
    <span title={title} aria-label={title} className={`inline-flex shrink-0 items-center rounded-full p-0.5 ${TONE[f.worst] ?? TONE.LOW}`}>
      <AlertTriangle size={11} strokeWidth={2.5} aria-hidden />
    </span>
  );
}

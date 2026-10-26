"use client";

import { useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { TICKET_KINDS } from "@/lib/compliance/rules";
import { btnPrimary, input } from "./shared";

// Add, edit or renew a worker's ticket (stage 5). Renewing creates a new ticket that replaces the old one: the old
// one is archived and its expiry reminder cancelled. The expiry is typed from the card - never worked out.
export type TicketDTO = {
  id: string; kind: string; label: string | null; displayLabel: string; number: string | null; issueDate: string | null;
  expiryDate: string | null; status: string; archivedReason: string | null; notes: string | null;
};

export default function TicketForm({ resourceId, ticket, renewing, onDone, onCancel }: {
  resourceId: string; ticket?: TicketDTO; renewing?: boolean; onDone: () => void; onCancel: () => void;
}) {
  const editing = ticket && !renewing;
  const [f, setF] = useState({
    kind: ticket?.kind ?? "WHITE_CARD", label: ticket?.label ?? "", number: renewing ? "" : ticket?.number ?? "",
    issueDate: renewing ? "" : ticket?.issueDate ?? "", expiryDate: renewing ? "" : ticket?.expiryDate ?? "", notes: renewing ? "" : ticket?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = editing
      ? await apiFetch(`/api/compliance/tickets/${ticket!.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "EDIT", ...f }) })
      : await apiFetch("/api/compliance/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, resourceId, replacesId: renewing ? ticket!.id : undefined }) });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save the ticket."));
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-edge bg-panel p-4">
      <p className="text-sm font-medium text-gray-200">{editing ? "Edit ticket" : renewing ? `Renew: ${ticket!.displayLabel}` : "Add a ticket"}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-400">Ticket<select className={input} value={f.kind} onChange={set("kind")} disabled={renewing}>{TICKET_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-xs text-gray-400">{f.kind === "SITE_INDUCTION" ? "Site / client" : f.kind === "OTHER" ? "What it is" : "Class / detail (optional)"}
          <input className={input} value={f.label} onChange={set("label")} placeholder={f.kind === "DRIVER_LICENCE" ? "e.g. HC" : f.kind === "SITE_INDUCTION" ? "e.g. Westfield Parramatta" : ""} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">Card / licence number<input className={input} value={f.number} onChange={set("number")} /></label>
        <label className="text-xs text-gray-400">Issued<input type="date" className={input} value={f.issueDate} onChange={set("issueDate")} /></label>
        <label className="text-xs text-gray-400">Expires (blank = doesn&apos;t expire)<input type="date" className={input} value={f.expiryDate} onChange={set("expiryDate")} /></label>
      </div>
      <textarea className={input} rows={2} placeholder="Notes (no TFN or bank details - those stay in Xero)" value={f.notes} onChange={set("notes")} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className={btnPrimary}>{editing ? "Save" : renewing ? "Save the new ticket" : "Add"}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-edge px-3.5 py-2 text-sm text-gray-300 hover:bg-panel2">Cancel</button>
      </div>
    </form>
  );
}

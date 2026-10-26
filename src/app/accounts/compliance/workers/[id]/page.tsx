"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import TicketForm, { type TicketDTO } from "@/components/compliance/TicketForm";
import OnboardingForm, { type OnboardingDTO } from "@/components/compliance/OnboardingForm";
import { Files, StateChip, btn, dmy, type FileDTO, type State } from "@/components/compliance/shared";

// One worker's tickets and onboarding (Accounts stage 5). Accounts login + Admins.
type Detail = {
  worker: { id: string; name: string; role: string | null; category: string | null; phone: string | null; email: string | null; active: boolean; legacyTickets: string | null };
  tickets: (TicketDTO & { state: State; files: FileDTO[]; createdBy: string; updatedBy: string | null })[];
  onboarding: OnboardingDTO;
  onboardingProgress: { done: number; of: number };
};

export default function WorkerCompliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [form, setForm] = useState<{ ticket?: TicketDTO; renewing?: boolean } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => apiFetch(`/api/compliance/workers/${id}`).then(async (r) => { if (r.status === 404) setMissing(true); else if (r.ok) setD(await r.json()); }), [id]);
  useEffect(() => { load(); }, [load]);

  async function act(t: TicketDTO, action: "ARCHIVE" | "RESTORE") {
    const reason = action === "ARCHIVE" ? prompt("Why archive it? (e.g. no longer held, entered by mistake)") : "";
    if (action === "ARCHIVE" && !reason) return;
    const res = await apiFetch(`/api/compliance/tickets/${t.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    if (!res.ok) setError(await serverErrorMessage(res, "Couldn't change it."));
    else { setError(null); load(); }
  }

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Compliance"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  if (missing) return <PageShell title="Compliance"><p className="text-sm text-gray-400">That worker isn&apos;t in the Labour register. <Link href="/accounts/compliance" className="text-brand-300 hover:underline">Back to workers</Link></p></PageShell>;
  if (!d) return <PageShell title="Compliance"><p className="text-sm text-gray-500">Loading…</p></PageShell>;

  const tickets = d.tickets.filter((t) => showArchived || t.status === "ACTIVE");
  return (
    <PageShell title={d.worker.name} subtitle={[d.worker.role, d.worker.category, d.worker.active ? null : "inactive"].filter(Boolean).join(" · ") || undefined}
      actions={<Link href="/accounts/compliance" className="text-sm text-brand-300 hover:underline">← All workers</Link>}>
      <section className="mb-4 rounded-xl border border-edge bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <h2 className="text-sm font-semibold text-gray-100">Tickets and licences</h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-400"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
            <button onClick={() => setForm({})} className={`${btn} inline-flex items-center gap-1`}><Plus size={12} /> Add a ticket</button>
          </div>
        </div>
        {d.worker.legacyTickets && (
          <p className="border-b border-edge/60 px-3 py-2 text-xs text-gray-400"><span className="text-gray-500">From the Labour register (free text):</span> {d.worker.legacyTickets}</p>
        )}
        {form && <div className="p-3"><TicketForm resourceId={d.worker.id} ticket={form.ticket} renewing={form.renewing} onDone={() => { setForm(null); load(); }} onCancel={() => setForm(null)} /></div>}
        {error && <p className="px-3 pt-2 text-xs text-red-400">{error}</p>}
        <div className="divide-y divide-edge/60">
          {tickets.length === 0 && !form && <p className="px-3 py-3 text-sm text-gray-500">No tickets recorded yet. Add them from the cards.</p>}
          {tickets.map((t) => (
            <div key={t.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-100">{t.displayLabel}</span>
                <StateChip state={t.status === "ACTIVE" ? t.state : null} />
                {t.number && <span className="text-xs text-gray-400">No. {t.number}</span>}
                <span className="ml-auto text-xs text-gray-400">Issued {dmy(t.issueDate)} · {t.expiryDate ? `expires ${dmy(t.expiryDate)}` : "no expiry"}</span>
              </div>
              {t.archivedReason && <p className="mt-0.5 text-xs text-gray-500">Archived: {t.archivedReason}</p>}
              {t.notes && <p className="mt-0.5 text-xs text-gray-400">{t.notes}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Files files={t.files} owner={{ ticketId: t.id }} onChanged={load} />
                <span className="ml-auto flex gap-2">
                  {t.status === "ACTIVE" ? (
                    <>
                      <button className={btn} onClick={() => setForm({ ticket: t, renewing: true })}>Renew</button>
                      <button className={btn} onClick={() => setForm({ ticket: t })}>Edit</button>
                      <button className={btn} onClick={() => act(t, "ARCHIVE")}>Archive</button>
                    </>
                  ) : <button className={btn} onClick={() => act(t, "RESTORE")}>Restore</button>}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-edge bg-panel">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <h2 className="text-sm font-semibold text-gray-100">Onboarding <span className="ml-1 text-gray-500">{d.onboardingProgress.done} of {d.onboardingProgress.of}</span></h2>
          <span className="text-xs text-gray-500">Kept apart from pay. TFN and bank details stay in Xero.</span>
        </div>
        <div className="p-3"><OnboardingForm key={d.onboarding?.updatedAt ?? "new"} resourceId={d.worker.id} value={d.onboarding} onSaved={load} /></div>
      </section>
    </PageShell>
  );
}

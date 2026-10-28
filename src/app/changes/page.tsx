"use client";

// Changes (LCI phase 4, A3, 25 Oct 2026): proposed changes to one field of
// one record - a hire item's off-hire date, a project's contract value, job
// or quote number - waiting for a different person to approve, and the log of
// every change that went in (or didn't). Approving runs the change through the
// same checks as the edit screens. Managers and Admins. Design:
// docs/lci/PHASE4-5-DESIGN.md §1. The admin kinds (tip rates, removing an invoice,
// rates / engagement, tickets, documents - docs/lci/ADMIN-CHANGE-KINDS-DESIGN.md) show
// here for Admins (Operations AI: its own); they're proposed through the API, so the
// form below offers the first four kinds only.
import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import ChangeCard from "@/components/changes/ChangeCard";
import ProposeChange from "@/components/changes/ProposeChange";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { CHANGE_KINDS, isAdminKind } from "@/lib/changes/config";
import type { ChangeDTO } from "@/lib/changes/store";

export default function ChangesPage() {
  const { user, canEdit, loading } = useAuth();
  const [tab, setTab] = useState<"open" | "log">("open");
  const [rows, setRows] = useState<ChangeDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);

  const load = useCallback(() => {
    apiFetch(tab === "open" ? "/api/changes?open=1" : "/api/changes").then(async (r) => (r.ok ? setRows((await r.json()).changes) : setError(await serverErrorMessage(r, "Couldn't load the changes."))));
  }, [tab]);
  useEffect(() => { setRows(null); load(); }, [load]);
  const done = (m: string) => { setFlash(m); setProposing(false); load(); };

  if (loading) return <PageShell title="Changes"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit) return <PageShell title="Changes"><p className="text-sm text-gray-500">Managers and Admins only.</p></PageShell>;
  const btn = (on: boolean) => `rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide ${on ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"}`;

  return (
    <PageShell
      title="Changes"
      subtitle="Proposed changes to a record, each approved by someone other than the person who proposed it. Nothing changes until it's approved, and every change is logged."
      actions={<button onClick={() => setProposing(true)} className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-panel2">Propose a change</button>}
    >
      <div className="mb-3 flex gap-1">
        <button className={btn(tab === "open")} onClick={() => setTab("open")}>Waiting</button>
        <button className={btn(tab === "log")} onClick={() => setTab("log")}>Change log</button>
      </div>
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!rows ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p>
        : rows.length === 0 ? <p className="rounded-lg border border-dashed border-edge py-8 text-center text-sm text-gray-500">{tab === "open" ? "Nothing waiting." : "No changes yet."}</p>
        : <div className="space-y-2">{rows.map((c) => <ChangeCard key={c.id} c={c} me={user?.name ?? ""} onDone={done} />)}</div>}
      {proposing && <ProposeChange kinds={CHANGE_KINDS.filter((k) => !isAdminKind(k))} onClose={() => setProposing(false)} onDone={done} />}
    </PageShell>
  );
}

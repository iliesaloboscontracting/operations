"use client";

// Variations (Ilies approved 25 Nov 2026): the variation / day dockets signed on site - newest first, by job and by
// the office's status (To price -> Priced -> Sent to client). Each opens as the printable docket. Managers, Admins and
// the coordinator (Alex). The signed docket is never changed; the status is the office's own record. No prices here -
// the office prices a variation elsewhere and emails the signed docket to the client itself.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FilePen } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { tickLabel, type OfficeRowDTO } from "@/lib/variations/rules";
import { STATUS_TONE } from "@/components/variations/statusTone";

type Data = { rows: OfficeRowDTO[]; projects: { id: string; label: string }[]; statuses: { key: string; label: string }[] };
const select = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-AU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });

export default function VariationsPage() {
  const { canEdit, coordinatorOnly, loading } = useAuth();
  const [f, setF] = useState<{ projectId?: string; status?: string } | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  // ?status=TO_PRICE from the coordinator's card.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setF({ status: q.get("status") || undefined, projectId: q.get("projectId") || undefined });
  }, []);
  const load = useCallback(() => {
    if (!f) return;
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
    apiFetch(`/api/variations?${q}`).then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the dockets."))));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const ff = f ?? {};
  if (loading) return <PageShell title="Variations"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!canEdit && !coordinatorOnly) return <PageShell title="Variations"><p className="text-sm text-gray-500">Managers, Admins and the project coordinator only.</p></PageShell>;
  return (
    <PageShell title="Variations" subtitle="Variation / day dockets signed by the client on the supervisor's phone. Open one to print it or save it as a PDF and email it to the client.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={select} value={ff.projectId ?? ""} onChange={(e) => setF((x) => ({ ...(x ?? {}), projectId: e.target.value || undefined }))} aria-label="Job">
          <option value="">All jobs</option>{data?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <select className={select} value={ff.status ?? ""} onChange={(e) => setF((x) => ({ ...(x ?? {}), status: e.target.value || undefined }))} aria-label="Status">
          <option value="">Every status</option>{data?.statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {(ff.projectId || ff.status) && <button className="text-xs text-brand-300 hover:underline" onClick={() => setF({})}>Clear</button>}
      </div>
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p> : data.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-edge p-8 text-center text-sm text-gray-500">No dockets{ff.projectId || ff.status ? " for that filter" : " yet - they come in from the supervisors' links"}.</div>
      ) : (
        <ul className="divide-y divide-edge/60 overflow-hidden rounded-xl border border-edge bg-panel">
          {data.rows.map((r) => (
            <li key={r.id}>
              <Link href={`/variations/${r.id}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 hover:bg-panel2/60">
                <span className="flex w-24 shrink-0 items-center gap-1.5 font-mono text-sm font-semibold text-gray-100"><FilePen size={14} className="text-brand-400" />{r.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-100">{r.project}{r.jobNo ? <span className="ml-1.5 text-xs font-normal text-gray-500">{r.jobNo}</span> : null}</span>
                  <span className="block text-xs text-gray-400">
                    {day(r.day)} · {r.supervisor} · signed by {r.customerName} · {r.ticks.map(tickLabel).join(", ")}
                    {r.tasks ? ` · ${r.tasks} task${r.tasks === 1 ? "" : "s"}${r.hours ? ` (${r.hours} h)` : ""}` : ""}{r.items ? ` · ${r.items} item${r.items === 1 ? "" : "s"}` : ""}{r.photos ? ` · ${r.photos} photo${r.photos === 1 ? "" : "s"}` : ""}
                  </span>
                  {(r.replaces || r.replacedBy) && <span className="block text-xs text-amber-300">{r.replaces ? `Replaces ${r.replaces}` : ""}{r.replaces && r.replacedBy ? " · " : ""}{r.replacedBy ? `Replaced by ${r.replacedBy}` : ""}</span>}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[r.status] ?? ""}`}>{r.statusLabel}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

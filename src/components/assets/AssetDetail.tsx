"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { money } from "@/lib/resource";
import { ASSET_KINDS } from "@/lib/assets/rules";
import type { DocumentDTO } from "@/components/compliance/DocumentForm";
import { Files, StateChip, btn, btnPrimary, dmy, input } from "@/components/compliance/shared";

// One asset on the Accounts screen (stage 6, docs/accounts/STAGE6-DESIGN.md §2): its rego / insurance / service
// dates (stage 5 documents with reminders on To do), service history from mechanics' invoices linked from the
// invoices inbox, and the fault reports Operations already keeps.
type Doc = DocumentDTO & { issuer: string | null };
type Service = { id: string; date: string; mechanic: string | null; invoiceNo: string | null; work: string | null; amountExGst: number | null; total: number | null; odometer: number | null; invoiceDraftId: string | null };
type Data = {
  asset: { kind: "resource" | "tool"; id: string; name: string; type?: string; detail: string | null; identifier?: string | null; status: string; serviceDueText?: string | null; notes: string | null; heldBy?: string | null };
  documents: Doc[];
  service: Service[];
  faults: {
    down: boolean;
    breakdowns: { date: string; site: string; hoursLost: number | null; note: string | null }[];
    toolIssues: { id: string; description: string; status: string; reportedBy: string | null; resolution: string | null; createdAt: string }[];
  };
};
type Invoice = { id: string; supplier: string | null; invoiceNo: string | null; invoiceDate: string | null; description: string | null; amountExGst: number | null; totalIncGst: number | null; uploadId: string; file: string };

const post = (url: string, body: unknown) => apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function DateForm({ owner, vehicle, doc, onDone, onCancel }: { owner: { resourceId: string } | { toolId: string }; vehicle: boolean; doc?: Doc; onDone: () => void; onCancel: () => void }) {
  const kinds = ASSET_KINDS.filter(([k]) => vehicle || k !== "REGO");
  const [f, setF] = useState({ kind: doc?.kind ?? kinds[0][0], title: doc?.title ?? "", reference: doc?.reference ?? "", issuer: doc?.issuer ?? "", issueDate: doc?.issueDate ?? "", expiryDate: doc?.expiryDate ?? "", notes: doc?.notes ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = doc ? await post(`/api/compliance/documents/${doc.id}`, { action: "EDIT", ...f }) : await post("/api/compliance/documents", { holderType: "ASSET", ...owner, ...f });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save it."));
    onDone();
  }
  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-edge bg-panel p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">What<select className={input} value={f.kind} onChange={set("kind")} disabled={!!doc}>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-xs text-gray-400">{f.kind === "ASSET_INSURANCE" ? "Insurer" : f.kind === "REGO" ? "Issued by" : "Done by / certifier"}<input className={input} value={f.issuer} onChange={set("issuer")} placeholder={f.kind === "ASSET_INSURANCE" ? "e.g. the insurer" : ""} /></label>
        <label className="text-xs text-gray-400">{f.kind === "ASSET_INSURANCE" ? "Policy number" : f.kind === "REGO" ? "Plate / rego number" : "Reference"}<input className={input} value={f.reference} onChange={set("reference")} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">From<input type="date" className={input} value={f.issueDate} onChange={set("issueDate")} /></label>
        <label className="text-xs text-gray-400">{f.kind === "SERVICE_DUE" ? "Service due" : "Renewal / expiry date"}<input type="date" className={input} value={f.expiryDate} onChange={set("expiryDate")} /></label>
        <label className="text-xs text-gray-400">Title (optional)<input className={input} value={f.title} onChange={set("title")} /></label>
      </div>
      <textarea className={input} rows={2} placeholder="Notes (no premiums or amounts)" value={f.notes} onChange={set("notes")} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2"><button disabled={busy} className={btnPrimary}>{doc ? "Save" : "Add"}</button><button type="button" onClick={onCancel} className={btn}>Cancel</button></div>
    </form>
  );
}

function LinkInvoice({ resourceId, onDone }: { resourceId: string; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => apiFetch(`/api/accounts/assets/invoices?q=${encodeURIComponent(q)}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setRows(d.invoices)), 250);
    return () => clearTimeout(t);
  }, [q]);
  async function link(id: string) {
    const res = await post(`/api/accounts/assets/resource/${resourceId}/service`, { invoiceDraftId: id });
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't link it."));
    onDone();
  }
  return (
    <div className="rounded-xl border border-edge bg-panel p-3">
      <input className={`${input} mb-2`} placeholder="Search the invoices inbox: mechanic, invoice no., words" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : !rows.length ? <p className="text-sm text-gray-500">No inbox invoices from the last 12 months match (already-linked ones are hidden).</p> : (
        <div className="max-h-80 divide-y divide-edge/60 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="w-24 text-gray-400">{dmy(r.invoiceDate)}</span>
              <span className="text-gray-200">{r.supplier ?? "?"}</span>
              <span className="text-xs text-gray-500">{r.invoiceNo}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-gray-400">{r.description}</span>
              <span className="text-gray-200">{money(r.amountExGst) ?? "-"}</span>
              <a className="text-xs text-brand-300 hover:underline" href={`/api/invoice-inbox/uploads/${r.uploadId}`} target="_blank" rel="noreferrer">{r.file}</a>
              <button className={btn} onClick={() => link(r.id)}>Link</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AssetDetail({ kind, id }: { kind: "resource" | "tool"; id: string }) {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [d, setD] = useState<Data | null>(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState<Doc | "new" | null>(null);
  const [linking, setLinking] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const load = useCallback(() => apiFetch(`/api/accounts/assets/${kind}/${id}`).then((r) => (r.ok ? r.json().then(setD) : setMissing(true))), [kind, id]);
  useEffect(() => { load(); }, [load]);

  async function archive(doc: Doc) {
    const reason = prompt("Why archive it? (e.g. renewed - the new one is added)");
    if (!reason) return;
    await post(`/api/compliance/documents/${doc.id}`, { action: "ARCHIVE", reason });
    load();
  }

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Assets"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  if (missing) return <PageShell title="Assets"><p className="text-sm text-gray-400">That asset isn&apos;t on the register (hired items are on the Hire register).</p></PageShell>;
  if (!d) return <PageShell title="Assets"><p className="text-sm text-gray-500">Loading…</p></PageShell>;
  const a = d.asset;
  const vehicle = a.type === "VEHICLE";
  const owner = kind === "resource" ? { resourceId: id } : { toolId: id };
  const docs = d.documents.filter((x) => showArchived || x.status === "ACTIVE");
  const back = kind === "tool" ? "/accounts/assets?group=TOOLS" : vehicle ? "/accounts/assets" : "/accounts/assets?group=PLANT";
  return (
    <PageShell title={a.name} subtitle={[a.detail, a.serviceDueText && `Register says service: ${a.serviceDueText}`, a.heldBy && `Held by ${a.heldBy}`].filter(Boolean).join(" · ") || undefined}
      actions={<Link href={back} className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200"><ArrowLeft size={14} /> Assets</Link>}>
      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-200">Rego, insurance and service dates</h2>
          <button onClick={() => setEditing("new")} className={`${btn} inline-flex items-center gap-1`}><Plus size={12} /> Add a date</button>
          <label className="flex items-center gap-1.5 text-xs text-gray-400"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>
          <span className="text-xs text-gray-500">Each date reminds you on To do 30 days ahead.</span>
        </div>
        {editing && <div className="mb-3"><DateForm owner={owner} vehicle={vehicle} doc={editing === "new" ? undefined : editing} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} /></div>}
        <div className="space-y-2">
          {docs.map((x) => (
            <div key={x.id} className="rounded-xl border border-edge bg-panel p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-100">{x.kindLabel}</span>
                <StateChip state={x.state} />
                <span className="text-xs text-gray-500">{[x.issuer, x.reference].filter(Boolean).join(" · ")}</span>
                <span className="ml-auto text-xs text-gray-400">{x.expiryDate ? `${x.kind === "SERVICE_DUE" ? "Due" : "Renews"} ${dmy(x.expiryDate)}` : "No date"}</span>
              </div>
              {x.notes && <p className="mt-1 text-xs text-gray-400">{x.notes}</p>}
              {x.archivedReason && <p className="mt-1 text-xs text-gray-500">Archived: {x.archivedReason}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Files files={x.files} owner={{ documentId: x.id }} onChanged={load} />
                {x.status === "ACTIVE" && <span className="ml-auto flex gap-2"><button className={btn} onClick={() => setEditing(x)}>Edit</button><button className={btn} onClick={() => archive(x)}>Archive</button></span>}
              </div>
            </div>
          ))}
          {!docs.length && <p className="rounded-xl border border-edge bg-panel p-3 text-sm text-gray-500">No dates recorded yet.</p>}
        </div>
      </section>

      {kind === "resource" && (
        <section className="mb-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-200">Service history</h2>
            <button onClick={() => setLinking((v) => !v)} className={btn}>{linking ? "Close" : "Link a mechanic invoice"}</button>
            <span className="text-xs text-gray-500">From the invoices inbox - nothing is uploaded twice.</span>
          </div>
          {linking && <div className="mb-3"><LinkInvoice resourceId={id} onDone={() => { setLinking(false); load(); }} /></div>}
          <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
            <table className="w-full text-sm">
              <thead className="border-b border-edge text-left text-xs text-gray-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Mechanic</th><th className="px-3 py-2">Work</th><th className="px-3 py-2">Odometer</th><th className="px-3 py-2 text-right">Ex GST</th></tr></thead>
              <tbody className="divide-y divide-edge/60">
                {d.service.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-gray-300">{dmy(s.date)}</td>
                    <td className="px-3 py-2 text-gray-200">{s.mechanic}<span className="block text-xs text-gray-500">{s.invoiceNo}{s.invoiceDraftId ? " · from the inbox" : ""}</span></td>
                    <td className="px-3 py-2 text-xs text-gray-400">{s.work}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{s.odometer ? `${s.odometer.toLocaleString()} km` : ""}</td>
                    <td className="px-3 py-2 text-right text-gray-200">{money(s.amountExGst) ?? "-"}</td>
                  </tr>
                ))}
                {!d.service.length && <tr><td colSpan={5} className="px-3 py-3 text-sm text-gray-500">No services recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-200">Faults</h2>
        <div className="space-y-2 rounded-xl border border-edge bg-panel p-3 text-sm">
          {d.faults.down && <p className="text-red-300">{kind === "tool" ? "Marked “Needs repair” on the tool register." : "Marked DOWN on the register."}{a.notes ? ` ${a.notes}` : ""}</p>}
          {d.faults.toolIssues.map((t) => (
            <p key={t.id} className="text-gray-300"><span className="text-gray-500">{new Date(t.createdAt).toLocaleDateString("en-AU")} · {t.status.toLowerCase().replace("_", " ")}</span> · {t.description}{t.reportedBy ? ` (${t.reportedBy})` : ""}{t.resolution ? ` - ${t.resolution}` : ""}</p>
          ))}
          {d.faults.breakdowns.length > 0 && <>
            <p className="text-xs text-gray-500">Plant breakdowns logged on daily logs of jobs this item was booked on that day. The log doesn&apos;t name the machine, so check before relying on it.</p>
            {d.faults.breakdowns.map((b, i) => <p key={i} className="text-gray-300"><span className="text-gray-500">{dmy(b.date)} · {b.site}</span>{b.hoursLost != null ? ` · ${b.hoursLost} h lost` : ""}{b.note ? ` - ${b.note}` : ""}</p>)}
          </>}
          {!d.faults.down && !d.faults.toolIssues.length && !d.faults.breakdowns.length && <p className="text-gray-500">No faults reported.</p>}
        </div>
      </section>
    </PageShell>
  );
}

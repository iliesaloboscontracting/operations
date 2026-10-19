"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ServiceRecordDTO } from "@/lib/types";
import { useAuth } from "./AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { localISODate } from "@/lib/resource";

const input =
  "w-full rounded-md border border-edge bg-panel2 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-brand-500";

const money = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const fmtDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

type Draft = Partial<ServiceRecordDTO>;
const BLANK: Draft = { date: "", mechanic: "", invoiceNo: "", work: "", amountExGst: null, gst: null, total: null, odometer: null, notes: "" };

function RecordForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const set = (k: keyof Draft, v: string) => {
    const numeric = k === "amountExGst" || k === "gst" || k === "total" || k === "odometer";
    onChange({ ...draft, [k]: numeric ? (v === "" ? null : Number(v)) : v });
  };

  // Convenience: filling ex-GST alone works out GST (10%) and the total, unless already typed.
  function onAmountBlur() {
    if (draft.amountExGst == null) return;
    const patch: Draft = {};
    if (draft.gst == null) patch.gst = Math.round(draft.amountExGst * 10) / 100;
    const gst = patch.gst ?? draft.gst ?? 0;
    if (draft.total == null) patch.total = Math.round((draft.amountExGst + gst) * 100) / 100;
    if (Object.keys(patch).length) onChange({ ...draft, ...patch });
  }

  return (
    <div className="rounded-md border border-edge bg-panel2/60 p-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <label className="flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
          Date
          <input type="date" className={input} value={draft.date ?? ""} onChange={(e) => set("date", e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
          Mechanic
          <input className={input} value={draft.mechanic ?? ""} onChange={(e) => set("mechanic", e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
          Invoice #
          <input className={input} value={draft.invoiceNo ?? ""} onChange={(e) => set("invoiceNo", e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
          Odometer (km)
          <input type="number" className={input} value={draft.odometer ?? ""} onChange={(e) => set("odometer", e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
          Amount (ex GST)
          <input type="number" step="0.01" className={input} value={draft.amountExGst ?? ""} onChange={(e) => set("amountExGst", e.target.value)} onBlur={onAmountBlur} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
          GST
          <input type="number" step="0.01" className={input} value={draft.gst ?? ""} onChange={(e) => set("gst", e.target.value)} />
        </label>
        <label className="flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
          Total (inc GST)
          <input type="number" step="0.01" className={input} value={draft.total ?? ""} onChange={(e) => set("total", e.target.value)} />
        </label>
      </div>
      <label className="mt-1.5 flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
        Work performed
        <textarea rows={2} className={input} value={draft.work ?? ""} onChange={(e) => set("work", e.target.value)} />
      </label>
      <label className="mt-1.5 flex flex-col gap-0.5 text-[10px] uppercase text-gray-500">
        Notes
        <textarea rows={2} className={input} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-xs text-gray-400 hover:text-gray-200">
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || !draft.date}
          onClick={onSave}
          className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save record"}
        </button>
      </div>
    </div>
  );
}

// Service/repair history for one vehicle (or any resource), shown inside its edit modal.
export default function ServiceHistory({ resourceId }: { resourceId: string }) {
  const { canEdit } = useAuth();
  const [records, setRecords] = useState<ServiceRecordDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/resources/${resourceId}/service`);
    if (res.ok) setRecords(await res.json());
    setLoading(false);
  }, [resourceId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalSpend = useMemo(() => records.reduce((n, r) => n + (r.total ?? 0), 0), [records]);
  const lastService = records[0]; // API returns newest first

  function startAdd() {
    setError(null);
    setEditingId(null);
    setDraft({ ...BLANK, date: localISODate() });
    setAdding(true);
  }
  function startEdit(r: ServiceRecordDTO) {
    setError(null);
    setAdding(false);
    setDraft(r);
    setEditingId(r.id);
  }
  function cancel() {
    setAdding(false);
    setEditingId(null);
    setError(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = editingId
        ? await fetch(`/api/service/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
          })
        : await fetch(`/api/resources/${resourceId}/service`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draft),
          });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Couldn't save that record");
      cancel();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this service record?")) return;
    const res = await fetch(`/api/service/${id}`, { method: "DELETE" });
    if (res.ok) await load();
  }

  return (
    <div className="mt-4 border-t border-edge pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Service history</div>
          <div className="text-xs text-gray-500">
            {records.length} record{records.length === 1 ? "" : "s"}
            {records.length > 0 && <> · {money(totalSpend)} total{lastService && <> · last serviced {fmtDate(lastService.date)}</>}</>}
          </div>
        </div>
        {canEdit && !adding && !editingId && (
          <button
            type="button"
            onClick={startAdd}
            className="rounded-md border border-edge px-2 py-1 text-xs text-gray-300 hover:bg-panel2"
          >
            + Add service record
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-gray-500">Loading...</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {adding && (
            <RecordForm draft={draft} onChange={setDraft} onSave={save} onCancel={cancel} saving={saving} />
          )}
          {records.length === 0 && !adding && (
            <div className="rounded-md border border-dashed border-edge py-4 text-center text-xs text-gray-500">
              No service records yet.
            </div>
          )}
          {records.map((r) =>
            editingId === r.id ? (
              <RecordForm key={r.id} draft={draft} onChange={setDraft} onSave={save} onCancel={cancel} saving={saving} />
            ) : (
              <div key={r.id} className="rounded-md border border-edge bg-panel2/40 px-2 py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="w-20 shrink-0 text-gray-400">{fmtDate(r.date)}</span>
                  <span className="w-24 shrink-0 truncate text-gray-300">{r.mechanic ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-gray-400">{r.work ?? "—"}</span>
                  <span className="w-20 shrink-0 text-right font-medium text-gray-200">{money(r.total)}</span>
                  <span className="text-gray-600">{expanded === r.id ? "▲" : "▼"}</span>
                </button>
                {expanded === r.id && (
                  <div className="mt-2 grid gap-1 border-t border-edge/60 pt-2 sm:grid-cols-2">
                    <div className="text-gray-500">
                      Invoice #<span className="ml-1 text-gray-300">{r.invoiceNo ?? "—"}</span>
                    </div>
                    <div className="text-gray-500">
                      Odometer<span className="ml-1 text-gray-300">{r.odometer ? `${r.odometer.toLocaleString()} km` : "—"}</span>
                    </div>
                    <div className="text-gray-500">
                      Ex GST<span className="ml-1 text-gray-300">{money(r.amountExGst)}</span>
                    </div>
                    <div className="text-gray-500">
                      GST<span className="ml-1 text-gray-300">{money(r.gst)}</span>
                    </div>
                    {r.work && <div className="text-gray-400 sm:col-span-2">{r.work}</div>}
                    {r.notes && <div className="italic text-gray-500 sm:col-span-2">{r.notes}</div>}
                    {canEdit && (
                      <div className="flex gap-3 pt-1 sm:col-span-2">
                        <button type="button" onClick={() => startEdit(r)} className="text-blue-400 hover:text-blue-300">
                          Edit
                        </button>
                        <button type="button" onClick={() => remove(r.id)} className="text-red-400 hover:text-red-300">
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      )}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}

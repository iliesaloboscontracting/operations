"use client";

import { useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { CATEGORIES, REPEATS } from "@/lib/accounts/calendar";

// Add or edit a due date / reminder on the Accounts calendar (26 Oct 2026).
export type AccountsItemDTO = {
  id: string; kind: string; category: string; categoryLabel: string; title: string; dueDate: string; repeat: string;
  amount: number | null; payee: string | null; notes: string | null; alertDays: number; status: string;
  when: "OVERDUE" | "TODAY" | "SOON" | "LATER" | null; lastDoneAt: string | null; lastDoneBy: string | null;
};

const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";

export default function ItemForm({
  item, defaultKind = "DUE", onDone, onCancel,
}: { item?: AccountsItemDTO; defaultKind?: "DUE" | "REMINDER"; onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState(item?.kind ?? defaultKind);
  const [f, setF] = useState({
    title: item?.title ?? "", category: item?.category ?? (defaultKind === "REMINDER" ? "OTHER" : "DIRECT_DEBIT"),
    dueDate: item?.dueDate ?? "", repeat: item?.repeat ?? "NONE", amount: item?.amount != null ? String(item.amount) : "",
    payee: item?.payee ?? "", notes: item?.notes ?? "", alertDays: String(item?.alertDays ?? 3),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...f, kind, alertDays: Number(f.alertDays) };
    const res = await apiFetch(item ? `/api/accounts/items/${item.id}` : "/api/accounts/items", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item ? { action: "EDIT", ...body } : body),
    });
    setBusy(false);
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't save it."));
    onDone();
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl border border-edge bg-panel p-4">
      <div className="flex gap-2 text-sm">
        {(["DUE", "REMINDER"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)}
            className={`rounded-full px-3 py-1 ${kind === k ? "bg-brand-600 text-white" : "border border-edge text-gray-300"}`}>
            {k === "DUE" ? "Due date / payment" : "Reminder / follow-up"}
          </button>
        ))}
      </div>
      <input className={input} placeholder={kind === "REMINDER" ? 'e.g. "Chase Arvin about the hook truck"' : 'e.g. "BAS - September"'} value={f.title} onChange={set("title")} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-400">Date<input type="date" className={input} value={f.dueDate} onChange={set("dueDate")} /></label>
        <label className="text-xs text-gray-400">Repeats<select className={input} value={f.repeat} onChange={set("repeat")}>{REPEATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="text-xs text-gray-400">Alert me (days before)<input type="number" min={0} max={30} className={input} value={f.alertDays} onChange={set("alertDays")} /></label>
      </div>
      {kind === "DUE" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-400">Type<select className={input} value={f.category} onChange={set("category")}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="text-xs text-gray-400">Paid to<input className={input} value={f.payee} onChange={set("payee")} placeholder="e.g. ATO, iCare" /></label>
          <label className="text-xs text-gray-400">Amount (optional)<input className={input} inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="$" /></label>
        </div>
      )}
      <textarea className={input} rows={2} placeholder="Notes" value={f.notes} onChange={set("notes")} />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50">{item ? "Save" : "Add"}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-edge px-3.5 py-2 text-sm text-gray-300 hover:bg-panel2">Cancel</button>
      </div>
    </form>
  );
}

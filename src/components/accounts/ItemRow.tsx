"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { REPEATS } from "@/lib/accounts/calendar";
import ItemForm, { type AccountsItemDTO } from "./ItemForm";

// One due date / reminder: when it's due, tick it done (a repeating one moves on), edit, or cancel.
const WHEN_STYLE: Record<string, string> = {
  OVERDUE: "bg-red-500/15 text-red-300", TODAY: "bg-amber-500/15 text-amber-300", SOON: "bg-brand-500/15 text-brand-300", LATER: "bg-panel2 text-gray-400",
};
const WHEN_TEXT: Record<string, string> = { OVERDUE: "Overdue", TODAY: "Today", SOON: "Coming up", LATER: "" };
const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ItemRow({ item, onChanged }: { item: AccountsItemDTO; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "DONE" | "CANCEL") {
    if (action === "CANCEL" && !confirm(`Remove "${item.title}" from the calendar?`)) return;
    const res = await apiFetch(`/api/accounts/items/${item.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) return setError(await serverErrorMessage(res, "Couldn't do that."));
    onChanged();
  }
  if (editing) return <ItemForm item={item} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
      <div className="w-24 shrink-0 text-gray-300">{fmtDay(item.dueDate, { weekday: "short", day: "numeric", month: "short" })}</div>
      {item.when && WHEN_TEXT[item.when] && <span className={`rounded-full px-2 py-0.5 text-[11px] ${WHEN_STYLE[item.when]}`}>{WHEN_TEXT[item.when]}</span>}
      <div className="min-w-0 flex-1">
        <div className="text-gray-100">{item.title}</div>
        <div className="text-xs text-gray-500">
          {[item.kind === "REMINDER" ? "Reminder" : item.categoryLabel, item.payee, item.repeat !== "NONE" ? REPEATS.find(([k]) => k === item.repeat)?.[1].toLowerCase() : null, item.notes].filter(Boolean).join(" · ")}
        </div>
      </div>
      {item.amount != null && <div className="tabular-nums text-gray-200">{money(item.amount)}</div>}
      {item.status === "OPEN" && (
        <div className="flex gap-1">
          <button onClick={() => act("DONE")} title={item.repeat !== "NONE" ? "Done - move to the next date" : "Done"} className="rounded-md border border-edge p-1.5 text-emerald-300 hover:bg-panel2"><Check size={14} /></button>
          <button onClick={() => setEditing(true)} title="Edit" className="rounded-md border border-edge p-1.5 text-gray-400 hover:bg-panel2"><Pencil size={14} /></button>
          <button onClick={() => act("CANCEL")} title="Remove" className="rounded-md border border-edge p-1.5 text-gray-500 hover:bg-panel2 hover:text-red-300"><X size={14} /></button>
        </div>
      )}
      {error && <p className="w-full text-xs text-red-400">{error}</p>}
    </div>
  );
}

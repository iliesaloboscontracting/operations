"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import PageShell from "@/components/PageShell";
import ItemForm, { type AccountsItemDTO } from "@/components/accounts/ItemForm";
import ItemRow from "@/components/accounts/ItemRow";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";

// The Accounts calendar (26 Oct 2026, Victoria's item 8): every due date and reminder,
// by month. Repeating items show once at their next date; ticking one done moves it on.
export default function AccountsCalendarPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [items, setItems] = useState<AccountsItemDTO[] | null>(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => apiFetch("/api/accounts/items").then((r) => (r.ok ? r.json() : null)).then((d) => d && setItems(d.items)), []);
  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => {
    const m = new Map<string, AccountsItemDTO[]>();
    for (const i of items ?? []) {
      const key = i.when === "OVERDUE" ? "0000-00" : i.dueDate.slice(0, 7);
      m.set(key, [...(m.get(key) ?? []), i]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Calendar"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;

  return (
    <PageShell
      title="Due dates"
      subtitle="BAS, IAS, payroll tax, iCare, payment plans, direct debits, insurance, regos - and your reminders."
      actions={<button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-500"><Plus size={16} /> Add</button>}
    >
      {adding && <div className="mb-4"><ItemForm onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} /></div>}
      {!items ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">Nothing on the calendar yet. Add your BAS, IAS, payroll tax and direct debits with <b>Add</b>.</p>
      ) : (
        months.map(([key, rows]) => (
          <section key={key} className="mb-4 rounded-xl border border-edge bg-panel">
            <h2 className={`border-b border-edge px-3 py-2 text-sm font-semibold ${key === "0000-00" ? "text-red-300" : "text-gray-100"}`}>
              {key === "0000-00" ? "Overdue" : new Date(`${key}-01T00:00:00`).toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
            </h2>
            <div className="divide-y divide-edge/60">{rows.map((i) => <ItemRow key={i.id} item={i} onChanged={load} />)}</div>
          </section>
        ))
      )}
    </PageShell>
  );
}

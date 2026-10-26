"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import PageShell from "@/components/PageShell";
import PushToggle from "@/components/PushToggle";
import ItemForm, { type AccountsItemDTO } from "@/components/accounts/ItemForm";
import ItemRow from "@/components/accounts/ItemRow";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";

// The Accounts screen (26 Oct 2026, stage 1 of Victoria's list): "Pending for me" - read from what
// Operations already records, never a second copy - plus due dates and her own reminders.
type Pending = {
  today: string;
  inboxWaiting: number;
  reimbursementsToPay?: number;
  abnInvoicesToCheck?: number;
  purchasesToCheck?: number;
  purchasesToOrder?: number;
  queries: { id: string; ref: string; summary: string }[];
  noSignOut: { id: string; date: string; name: string; company: string | null; site: string }[];
  due: AccountsItemDTO[];
  comingUp: AccountsItemDTO[];
};

function Section({ title, count, children, action }: { title: string; count?: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-xl border border-edge bg-panel">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-100">{title}{count != null && <span className="ml-1.5 text-gray-500">{count}</span>}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function AccountsPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [p, setP] = useState<Pending | null>(null);
  const [adding, setAdding] = useState<"DUE" | "REMINDER" | null>(null);
  const load = useCallback(() => apiFetch("/api/accounts/pending").then((r) => (r.ok ? r.json() : null)).then((d) => d && setP(d)), []);
  useEffect(() => { load(); }, [load]);

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Accounts"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;

  const nothing = p && !p.inboxWaiting && !p.reimbursementsToPay && !p.abnInvoicesToCheck && !p.purchasesToCheck && !p.purchasesToOrder && !p.queries.length && !p.noSignOut.length && !p.due.length;
  return (
    <PageShell
      title="Accounts"
      subtitle="What's waiting for you, what's due, and your reminders."
      actions={<div className="flex items-center gap-2">{[["/accounts/payroll", "Payroll"], ["/accounts/reimbursements", "Reimbursements"], ["/accounts/purchases", "Purchases"], ["/accounts/assets", "Assets"], ["/accounts/labour-cost", "Labour cost"], ["/accounts/invoice-checks", "Invoice checks"], ["/accounts/compliance", "Compliance"]].map(([href, label]) => <Link key={href} href={href} className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-panel2">{label}</Link>)}<PushToggle /></div>}
    >
      {!p ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {nothing && <p className="mb-4 rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">Nothing waiting for you right now.</p>}

          <Section title="Due and reminders" count={p.due.length} action={
            <div className="flex gap-2">
              <button onClick={() => setAdding("REMINDER")} className="inline-flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-gray-300 hover:bg-panel2"><Plus size={12} /> Remind me</button>
              <button onClick={() => setAdding("DUE")} className="inline-flex items-center gap-1 rounded-md border border-edge px-2 py-1 text-xs text-gray-300 hover:bg-panel2"><Plus size={12} /> Due date</button>
            </div>
          }>
            {adding && <div className="p-3"><ItemForm defaultKind={adding} onDone={() => { setAdding(null); load(); }} onCancel={() => setAdding(null)} /></div>}
            <div className="divide-y divide-edge/60">
              {p.due.length === 0 && !adding && <p className="px-3 py-3 text-sm text-gray-500">Nothing due in the next few days.</p>}
              {p.due.map((i) => <ItemRow key={i.id} item={i} onChanged={load} />)}
            </div>
          </Section>

          {p.inboxWaiting > 0 && (
            <Section title="Invoices waiting for you" count={p.inboxWaiting}>
              <Link href="/invoices" className="block px-3 py-3 text-sm text-brand-300 hover:underline">Open the invoices inbox →</Link>
            </Section>
          )}

          {!!p.abnInvoicesToCheck && (
            <Section title="ABN invoices to check" count={p.abnInvoicesToCheck}>
              <Link href="/accounts/invoice-checks" className="block px-3 py-3 text-sm text-brand-300 hover:underline">Open invoice checks →</Link>
            </Section>
          )}

          {!!p.reimbursementsToPay && (
            <Section title="Reimbursements to pay" count={p.reimbursementsToPay}>
              <Link href="/accounts/reimbursements" className="block px-3 py-3 text-sm text-brand-300 hover:underline">Open reimbursements →</Link>
            </Section>
          )}

          {!!(p.purchasesToCheck || p.purchasesToOrder) && (
            <Section title="Purchase requests waiting for you" count={(p.purchasesToCheck ?? 0) + (p.purchasesToOrder ?? 0)}>
              <Link href="/accounts/purchases" className="block px-3 py-3 text-sm text-brand-300 hover:underline">{[p.purchasesToCheck ? `${p.purchasesToCheck} to check` : null, p.purchasesToOrder ? `${p.purchasesToOrder} approved to order` : null].filter(Boolean).join(" · ")} - open purchases →</Link>
            </Section>
          )}

          {p.queries.length > 0 && (
            <Section title="Questions for you" count={p.queries.length}>
              <div className="divide-y divide-edge/60">
                {p.queries.map((q) => (
                  <Link key={q.id} href="/invoices?tab=queries" className="flex gap-3 px-3 py-2.5 text-sm hover:bg-panel2">
                    <span className="text-gray-500">{q.ref}</span><span className="text-gray-200">{q.summary}</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {p.noSignOut.length > 0 && (
            <Section title="Signed in but never signed out (last 2 weeks)" count={p.noSignOut.length}>
              <p className="px-3 pt-2 text-xs text-gray-500">These need a sign-out time before payroll. The office sets it on Sign-ins.</p>
              <div className="divide-y divide-edge/60">
                {p.noSignOut.map((a) => (
                  <div key={a.id} className="flex flex-wrap gap-x-3 px-3 py-2 text-sm">
                    <span className="w-24 text-gray-400">{fmtDay(a.date, { weekday: "short", day: "numeric", month: "short" })}</span>
                    <span className="text-gray-200">{a.name}{a.company ? ` (${a.company})` : ""}</span>
                    <span className="text-gray-500">{a.site}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {p.comingUp.length > 0 && (
            <Section title="Coming up (next 2 weeks)" count={p.comingUp.length} action={<Link href="/accounts/calendar" className="text-xs text-brand-300 hover:underline">Full calendar</Link>}>
              <div className="divide-y divide-edge/60">{p.comingUp.map((i) => <ItemRow key={i.id} item={i} onChanged={load} />)}</div>
            </Section>
          )}
        </>
      )}
    </PageShell>
  );
}

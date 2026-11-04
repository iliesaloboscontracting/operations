"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CircleHelp, Plus } from "lucide-react";
import PageShell from "@/components/PageShell";
import PushToggle from "@/components/PushToggle";
import ItemForm, { type AccountsItemDTO } from "@/components/accounts/ItemForm";
import ItemRow from "@/components/accounts/ItemRow";
import TimesheetsExplainer from "@/components/accounts/TimesheetsExplainer";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import type { Explainer } from "@/lib/accountsTimesheets";

// The Accounts screen (26 Oct 2026, stage 1 of Victoria's list): "Pending for me" - read from what
// Operations already records, never a second copy - plus due dates and her own reminders.
type Pending = {
  today: string;
  inboxWaiting: number;
  reimbursementsToPay?: number;
  abnInvoicesToCheck?: number;
  salesNotTied?: number;
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

  // "How sign-ins and timesheets work" (4 Nov 2026, Ilies: "a notification to pop up on the accounts dashboard"): the
  // same notice as the Timesheets tab - it comes up by itself for the accounts login until "Got it" on either page,
  // and opens from the link here any time. Admins only get the link.
  const [help, setHelp] = useState<{ seen: boolean; explainer: Explainer } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSaving, setHelpSaving] = useState(false);
  useEffect(() => {
    apiFetch("/api/accounts/timesheets/explainer").then((r) => (r.ok ? r.json() : null)).then((d) => d && setHelp(d));
  }, []);
  const [helpAutoShown, setHelpAutoShown] = useState(false);
  useEffect(() => {
    if (help && accountsOnly && !help.seen && !helpAutoShown) {
      setHelpOpen(true);
      setHelpAutoShown(true);
    }
  }, [help, accountsOnly, helpAutoShown]);
  const helpGotIt = async () => {
    setHelpSaving(true);
    const res = await apiFetch("/api/accounts/timesheets/explainer", { method: "POST" });
    setHelpSaving(false);
    setHelpOpen(false);
    if (res.ok) setHelp((h) => (h ? { ...h, seen: true } : h));
  };

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Accounts"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;

  const nothing = p && !p.inboxWaiting && !p.reimbursementsToPay && !p.abnInvoicesToCheck && !p.salesNotTied && !p.purchasesToCheck && !p.purchasesToOrder && !p.queries.length && !p.noSignOut.length && !p.due.length;
  return (
    <PageShell
      title="Accounts"
      subtitle="What's waiting for you, what's due, and your reminders."
      actions={<div className="flex items-center gap-2">{[["/accounts/payroll", "Payroll"], ["/accounts/timesheets", "Timesheets"], ["/accounts/reimbursements", "Reimbursements"], ["/accounts/purchases", "Purchases"], ["/accounts/assets", "Assets"], ["/accounts/labour-cost", "Labour cost"], ["/accounts/invoice-checks", "Invoice checks"], ["/accounts/compliance", "Compliance"], ["/accounts/tax", "Tax estimates"]].map(([href, label]) => <Link key={href} href={href} className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-panel2">{label}</Link>)}<PushToggle /></div>}
    >
      {!p ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {help && (
            <button
              onClick={() => setHelpOpen(true)}
              className={`mb-4 flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm ${!help.seen && accountsOnly ? "border-brand-500/50 bg-brand-500/10 text-brand-200" : "border-edge bg-panel text-brand-300"} hover:bg-panel2`}
            >
              <CircleHelp size={16} className="shrink-0" />
              <span>
                <span className="font-medium">{help.explainer.title}</span>
                <span className="text-gray-400"> - where the hours come from, the break, approvals, and what each little note on a timesheet means.</span>
              </span>
            </button>
          )}

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


          {!!p.salesNotTied && (
            <Section title="Sales invoices not tied to a job" count={p.salesNotTied}>
              <Link href="/accounts/xero" className="block px-3 py-3 text-sm text-brand-300 hover:underline">Open Accounts data →</Link>
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
              <Link href="/accounts/purchases" className="block px-3 py-3 text-sm text-brand-300 hover:underline">{p.purchasesToOrder ? `${p.purchasesToOrder} approved to order` : ""} - open purchases →</Link>
            </Section>
          )}

          {p.queries.length > 0 && (
            <Section title="Questions for you" count={p.queries.length}>
              <div className="divide-y divide-edge/60">
                {p.queries.map((q) => (
                  <Link key={q.id} href="/accounts/questions" className="flex gap-3 px-3 py-2.5 text-sm hover:bg-panel2">
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

      {helpOpen && help && <TimesheetsExplainer explainer={help.explainer} busy={helpSaving} onClose={() => setHelpOpen(false)} onGotIt={helpGotIt} />}
    </PageShell>
  );
}

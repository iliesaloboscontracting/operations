"use client";

// Accounts -> Questions (27 Oct 2026, Ilies: "add a tab to her dashboard that allows me or you to send RFI or
// questions to victoria"; docs/accounts/QUESTIONS-AND-CHAT-DESIGN.md). Every information request to the accounts
// login - open, answered, closed, with history and files - answered here. The owner (and an Admin with director
// access) reads the same list and asks a new one; closing stays on Directors -> Info requests. One store: the
// existing QUERY requests. Answers never change any record.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import MyQueries, { type QuestionRow } from "@/components/queries/MyQueries";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { isOperationsAi } from "@/lib/infoRequests/rules";

type Data = { questions: QuestionRow[]; canAsk: boolean; accounts: { id: string; name: string }[] };
const input = "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const BLANK = { type: "QUESTION", title: "", question: "", need: "", dueDate: "" };

function AskVictoria({ accounts, onSent }: { accounts: Data["accounts"]; onSent: () => void }) {
  const [f, setF] = useState(BLANK);
  const [to, setTo] = useState(accounts[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await apiFetch("/api/info-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, toUserId: to }) });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: await serverErrorMessage(res, "Couldn't send it.") });
    setF(BLANK);
    setMsg({ ok: true, text: "Sent." });
    onSent();
  }
  if (!accounts.length) return <p className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">There&apos;s no accounts login to ask yet.</p>;
  return (
    <form onSubmit={send} className="space-y-2 rounded-xl border border-edge bg-panel p-4">
      <p className="text-sm font-semibold text-gray-100">Ask Victoria</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {accounts.length > 1 && (
          <select className={input} value={to} onChange={(e) => setTo(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        )}
        <select className={input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="QUESTION">Question (needs an answer)</option>
          <option value="FYI">FYI (just to read)</option>
        </select>
        <input className={input} type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} title="Due by (optional)" />
      </div>
      <input className={input} placeholder="Short title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <textarea className={input} rows={3} placeholder={f.type === "FYI" ? "The note to pass on" : "The question"} value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />
      <input className={input} placeholder="What we need (optional) - e.g. the spreadsheet as CSV" value={f.need} onChange={(e) => setF({ ...f, need: e.target.value })} />
      <div className="flex items-center gap-3">
        <button disabled={busy || f.title.trim().length < 3 || f.question.trim().length < 5} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy && <Loader2 size={14} className="animate-spin" />} Send to Victoria
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

export default function AccountsQuestionsPage() {
  const { accountsOnly, isAdmin, user, loading } = useAuth();
  const ai = isOperationsAi(user?.email, user?.role); // Operations AI (the Building Agent login): its own questions to accounts
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch("/api/accounts/questions").then(async (r) => (r.ok ? (setD(await r.json()), setError(null)) : setError(await serverErrorMessage(r, "Couldn't load the questions."))));
  }, []);
  useEffect(() => { if (!loading && (accountsOnly || isAdmin || ai)) load(); }, [loading, accountsOnly, isAdmin, ai, load]);

  if (loading) return null;
  if (!accountsOnly && !isAdmin && !ai) return <PageShell title="Questions"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  const waiting = d?.questions.filter((q) => q.canAnswer || q.canMarkRead).length ?? 0;
  return (
    <PageShell title="Questions" subtitle={accountsOnly ? (waiting ? `${waiting} waiting on you` : "Questions from Ilies and the office") : ai ? "Questions Operations AI sent to accounts" : "Questions to accounts"}>
      <div className="max-w-2xl space-y-4">
        <p className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm text-sky-100">Answers are reviewed by Ilies before anything changes.</p>
        {error ? <p className="text-sm text-red-400">{error}</p> : !d ? <p className="text-sm text-gray-500">Loading...</p> : (
          <>
            {d.canAsk && <AskVictoria accounts={d.accounts} onSent={load} />}
            {d.canAsk && !ai && <p className="text-xs text-gray-500">Close an answered question or ask a follow-up on <Link href="/directors/requests" className="text-sky-400 hover:underline">Directors → Info requests</Link>.</p>}
            <MyQueries rows={d.questions} onChange={load} restLabel="Answered and closed" noneWaiting={accountsOnly ? "No questions waiting on you." : "Nothing waiting on accounts."} />
          </>
        )}
      </div>
    </PageShell>
  );
}

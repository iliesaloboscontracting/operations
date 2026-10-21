"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Printer, X } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { printRequests } from "@/lib/requestPrint";
import {
  PRIORITIES,
  PRIORITY_DOT,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_FOR_OFFICE,
  byPriority,
  isOverdue,
  requestNo,
  typeOf,
  whenText,
  type Priority,
} from "@/lib/requestTypes";
import type { OfficeRequestView } from "@/lib/siteRequests";

// Site requests (21 Oct 2026): what supervisors have asked for from their
// link, in columns by where each one is up to. Only Ilies (Admin) decides -
// approve onto Alex's to-do, do it himself, ask the supervisor, or decline.
// Managers can look but not decide. No rates or costs on requests.

type Data = { requests: OfficeRequestView[]; assignees: { id: string; name: string }[] };

const COLUMNS: { key: string; title: string; hint: string; statuses: string[] }[] = [
  { key: "decide", title: "To decide", hint: "New, seen, or sent back", statuses: ["SENT", "SEEN", "CANT_DO"] },
  { key: "waiting", title: "Waiting on site", hint: "You asked the supervisor", statuses: ["NEEDS_INFO"] },
  { key: "doing", title: "Being actioned", hint: "With Alex, or you", statuses: ["TODO", "MINE"] },
  { key: "closed", title: "Closed - last 14 days", hint: "Done, declined, cancelled", statuses: ["DONE", "DECLINED", "CANCELLED"] },
];

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";

const localInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Where in Operations the follow-up usually happens.
const FOLLOW_UP: Record<string, { href: string; label: string }> = {
  LABOUR: { href: "/command", label: "Allocations" },
  TRUCK: { href: "/command", label: "Allocations" },
  HIRE: { href: "/hire", label: "Hire" },
  OFF_HIRE: { href: "/hire", label: "Hire" },
  TOOLS: { href: "/tools", label: "Tools" },
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-2">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${value ? tone || "text-gray-100" : "text-gray-500"}`}>{value}</div>
    </div>
  );
}

export default function RequestsPage() {
  const { canEdit, isAdmin, loading } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/requests").catch(() => null);
    if (!res?.ok) return setError(res ? await serverErrorMessage(res, "Couldn't load requests.") : "Couldn't load requests.");
    setError(null);
    setData(await res.json());
  }, []);
  useEffect(() => {
    if (canEdit) load();
  }, [canEdit, load]);
  useAutoRefresh(load, 15_000);

  const replace = (r: OfficeRequestView) => {
    setData((d) => (d ? { ...d, requests: d.requests.map((x) => (x.id === r.id ? r : x)) } : d));
    window.dispatchEvent(new Event("requests-changed")); // menu badge
  };

  // Opening a new one marks it seen - the supervisor sees "Seen by the office".
  async function open(r: OfficeRequestView) {
    setOpenId(r.id);
    if (isAdmin && r.status === "SENT") {
      const res = await apiFetch(`/api/requests/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "SEEN" }) });
      if (res.ok) replace((await res.json()).request);
    }
  }

  if (loading) return <PageShell title="Requests"><p className="text-sm text-gray-500">Loading…</p></PageShell>;
  if (!canEdit) return <PageShell title="Requests"><p className="text-sm text-gray-400">Requests are for managers.</p></PageShell>;

  const all = data?.requests ?? [];
  const openRows = all.filter((r) => !COLUMNS[3].statuses.includes(r.status));
  const current = all.find((r) => r.id === openId) ?? null;
  const withAlex = openRows.filter((r) => r.status === "TODO");

  return (
    <PageShell
      title="Requests"
      subtitle="What supervisors have asked for from their site link. You decide; approved ones go on Alex's to-do list."
      actions={
        <div className="flex gap-2">
          <button onClick={() => printRequests("Open site requests", [...openRows].sort(byPriority))} className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">
            <Printer size={15} /> Print open
          </button>
          <button
            onClick={() => printRequests(`To-do - ${withAlex[0]?.assigneeName ?? "Alex"}`, [...withAlex].sort(byPriority))}
            disabled={!withAlex.length}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2 disabled:opacity-40"
          >
            <Printer size={15} /> Print to-do list
          </button>
        </div>
      }
    >
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      <div className="mb-4 flex flex-wrap gap-2">
        <Stat label="To decide" value={all.filter((r) => COLUMNS[0].statuses.includes(r.status)).length} tone="text-brand-300" />
        <Stat label="Urgent open" value={openRows.filter((r) => r.priority === "URGENT").length} tone="text-red-400" />
        <Stat label="Overdue" value={openRows.filter(isOverdue).length} tone="text-red-400" />
        <Stat label="On to-do lists" value={withAlex.length} />
      </div>
      {!data ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3">
          {COLUMNS.map((c) => {
            const rows = all.filter((r) => c.statuses.includes(r.status));
            if (c.key !== "closed") rows.sort(byPriority);
            return (
              <div key={c.key} className="w-80 shrink-0 rounded-xl border border-edge bg-panel/60 p-2">
                <div className="mb-2 px-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-gray-100">{c.title}</span>
                    <span className="text-xs text-gray-500">{rows.length}</span>
                  </div>
                  <div className="text-[11px] text-gray-500">{c.hint}</div>
                </div>
                <div className="space-y-2">
                  {rows.map((r) => <Card key={r.id} r={r} onOpen={() => open(r)} />)}
                  {!rows.length && <div className="px-1 py-4 text-center text-xs text-gray-600">Nothing here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {current && data && (
        <Detail r={current} assignees={data.assignees} isAdmin={isAdmin} onClose={() => setOpenId(null)} onSaved={replace} />
      )}
    </PageShell>
  );
}

function Card({ r, onOpen }: { r: OfficeRequestView; onOpen: () => void }) {
  const late = isOverdue(r);
  const isNew = r.status === "SENT";
  return (
    <button onClick={onOpen} className={`w-full rounded-lg border bg-panel2 p-2.5 text-left hover:border-brand-500/60 ${isNew ? "border-brand-500/70" : "border-edge"}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY_TONE[r.priority]}`}>{PRIORITY_DOT[r.priority]} {PRIORITY_LABEL[r.priority]}</span>
        <span className="text-[11px] text-gray-500">{isNew ? <b className="text-brand-300">NEW</b> : STATUS_FOR_OFFICE[r.status]}{r.status === "TODO" && r.assigneeName ? ` ${r.assigneeName}` : ""}</span>
      </div>
      <div className="text-sm font-semibold text-gray-100">{r.summary}</div>
      <div className="truncate text-xs text-gray-400">{r.site} · {r.requestedBy}</div>
      <div className={`text-xs ${late ? "font-semibold text-red-400" : "text-gray-500"}`}>
        {late ? "Overdue - " : "By "}{whenText(r.neededBy)}{r.hasPhoto ? " · 📷" : ""}
      </div>
      {r.status === "CANT_DO" && r.outcome && <div className="mt-1 text-xs text-amber-300">Can&apos;t do: {r.outcome}</div>}
      {r.status === "SEEN" && r.answer && <div className="mt-1 text-xs text-sky-300">Answered: {r.answer}</div>}
    </button>
  );
}

type Action = "APPROVE" | "MINE" | "ASK" | "DECLINE" | "DONE";

function Detail({
  r,
  assignees,
  isAdmin,
  onClose,
  onSaved,
}: {
  r: OfficeRequestView;
  assignees: { id: string; name: string }[];
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (r: OfficeRequestView) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState("");
  const [assigneeId, setAssigneeId] = useState(r.assigneeId ?? assignees[0]?.id ?? "");
  const [priority, setPriority] = useState<Priority>(r.priority);
  const [neededBy, setNeededBy] = useState(localInput(r.neededBy));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const closed = ["DONE", "DECLINED", "CANCELLED"].includes(r.status);
  const type = typeOf(r.kind);
  const follow = FOLLOW_UP[r.kind];

  useEffect(() => {
    setAction(null);
    setText("");
    setError(null);
    setShowPhoto(false);
  }, [r.id]);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/requests/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await serverErrorMessage(res, "Couldn't save."));
      onSaved((await res.json()).request);
      setAction(null);
      setText("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (action === "APPROVE") return send({ action, assigneeId, note: text, priority, neededBy: new Date(neededBy).toISOString() });
    if (action === "MINE") return send({ action, note: text });
    if (action === "ASK") return send({ action, question: text });
    if (action === "DECLINE") return send({ action, reason: text });
    if (action === "DONE") return send({ action, outcome: text });
  }

  const PROMPT: Record<Action, { label: string; placeholder: string; button: string }> = {
    APPROVE: { label: "Note for them (optional)", placeholder: "e.g. Use Coates, PO 1234. Call Sam on site.", button: `Send to ${assignees.find((a) => a.id === assigneeId)?.name ?? "them"}` },
    MINE: { label: "Note (optional)", placeholder: "e.g. Calling Hire Express", button: "I'll do it" },
    ASK: { label: "Question for the supervisor", placeholder: "e.g. How many days do you need it for?", button: "Ask" },
    DECLINE: { label: "Reason - the supervisor sees this", placeholder: "e.g. Use the one at Vaucluse - it's free Thursday", button: "Decline" },
    DONE: { label: "What was done - the supervisor sees this", placeholder: "e.g. Booked Hire Express, arriving 7am Thu", button: "Mark done" },
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto border-l border-edge bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-gray-500">{requestNo(r.number)} · {type?.label ?? r.kind}</div>
            <h2 className="text-lg font-semibold text-gray-100">{r.summary}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-panel2" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${PRIORITY_TONE[r.priority]}`}>{PRIORITY_DOT[r.priority]} {PRIORITY_LABEL[r.priority]}</span>
          <span className="rounded bg-panel2 px-2 py-0.5 text-xs text-gray-300">{STATUS_FOR_OFFICE[r.status]}{r.status === "TODO" && r.assigneeName ? ` ${r.assigneeName}` : ""}</span>
          {isOverdue(r) && <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-300">Overdue</span>}
        </div>

        <dl className="mb-3 grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-sm">
          <dt className="text-gray-500">Site</dt><dd className="text-gray-200">{r.site}</dd>
          <dt className="text-gray-500">Requested by</dt><dd className="text-gray-200">{r.requestedBy}</dd>
          <dt className="text-gray-500">Sent</dt><dd className="text-gray-200">{whenText(r.createdAt)}</dd>
          <dt className="text-gray-500">Needed by</dt><dd className="text-gray-200">{whenText(r.neededBy)}</dd>
          {type?.fields.map((f) =>
            r.details[f.key] ? (
              <Fragment key={f.key}><dt className="text-gray-500">{f.label}</dt><dd className="text-gray-200">{r.details[f.key]}</dd></Fragment>
            ) : null,
          )}
        </dl>
        {r.note && <p className="mb-2 rounded-lg bg-panel2 px-3 py-2 text-sm text-gray-300">Supervisor: “{r.note}”</p>}
        {r.question && <p className="mb-1 text-sm text-amber-300">You asked: {r.question}</p>}
        {r.answer && <p className="mb-2 text-sm text-sky-300">Answer: {r.answer}</p>}
        {r.officeNote && <p className="mb-2 text-sm text-brand-200">Your note: {r.officeNote}</p>}
        {r.outcome && <p className={`mb-2 text-sm ${r.status === "CANT_DO" ? "text-amber-300" : "text-emerald-300"}`}>{r.status === "CANT_DO" ? "Can't do: " : "Outcome: "}{r.outcome}</p>}
        {r.declineReason && r.status === "DECLINED" && <p className="mb-2 text-sm text-red-300">Declined: {r.declineReason}</p>}

        <div className="mb-4 flex flex-wrap gap-3 text-sm">
          {r.hasPhoto && <button onClick={() => setShowPhoto((s) => !s)} className="text-gray-300 underline">{showPhoto ? "Hide photo" : "Photo"}</button>}
          {follow && <Link href={follow.href} className="text-gray-300 underline">Open {follow.label}</Link>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {showPhoto && <img src={`/api/requests/${r.id}/photo`} alt="" className="mb-4 max-h-80 w-full rounded-lg object-contain" />}

        {isAdmin ? (
          closed ? (
            <button disabled={busy} onClick={() => send({ action: "REOPEN" })} className="mb-4 rounded-lg border border-edge px-3 py-2 text-sm text-gray-300 hover:bg-panel2">Reopen</button>
          ) : !action ? (
            <div className="mb-4 grid grid-cols-2 gap-2">
              <button onClick={() => setAction("APPROVE")} disabled={!assignees.length} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">
                {r.status === "TODO" ? "Change / re-send" : `Approve → ${assignees[0]?.name.split(" ")[0] ?? "to-do"}`}
              </button>
              <button onClick={() => setAction("MINE")} className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 hover:bg-panel2">I&apos;ll do it</button>
              <button onClick={() => setAction("ASK")} className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-200 hover:bg-panel2">Ask supervisor</button>
              <button onClick={() => setAction("DECLINE")} className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10">Decline</button>
              {(r.status === "MINE" || r.status === "TODO") && (
                <button onClick={() => setAction("DONE")} className="col-span-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Mark done</button>
              )}
            </div>
          ) : (
            <div className="mb-4 space-y-2 rounded-lg border border-edge bg-panel2 p-3">
              {action === "APPROVE" && (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block text-gray-400">Who&apos;s doing it</span>
                    <select className={input} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                      {assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-sm">
                      <span className="mb-1 block text-gray-400">Priority</span>
                      <select className={input} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                        {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="mb-1 block text-gray-400">Do by</span>
                      <input type="datetime-local" className={input} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
                    </label>
                  </div>
                </>
              )}
              <label className="block text-sm">
                <span className="mb-1 block text-gray-400">{PROMPT[action].label}</span>
                <textarea className={input} rows={2} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={PROMPT[action].placeholder} />
              </label>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-2">
                <button onClick={submit} disabled={busy} className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{PROMPT[action].button}</button>
                <button onClick={() => setAction(null)} className="rounded-lg border border-edge px-3 py-2 text-sm text-gray-400">Back</button>
              </div>
            </div>
          )
        ) : (
          <p className="mb-4 text-xs text-gray-500">Only Ilies decides on requests.</p>
        )}
        {error && !action && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-gray-500">History</h3>
        <ol className="space-y-1 text-xs text-gray-400">
          {r.events.map((e, i) => (
            <li key={i}><span className="text-gray-500">{whenText(e.at)}</span> · {e.by} · {e.action.replace("_", " ").toLowerCase()}{e.note ? ` - ${e.note}` : ""}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

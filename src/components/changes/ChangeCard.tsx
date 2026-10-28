"use client";

import { useState } from "react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { whenText } from "@/lib/requestTypes";
import type { ChangeDTO } from "@/lib/changes/store";
import { PROPOSER_HINT } from "@/lib/changes/config";

// One proposed change (LCI phase 4): record -> field -> before -> after, why,
// where it came from, who proposed it, when it expires, its fingerprint and
// what else it moves. Approve (runs it, after re-checking), Reject, Withdraw,
// or Propose undo on one that went in.

const STATUS: Record<string, { word: string; tone: string }> = {
  PROPOSED: { word: "Waiting for approval", tone: "text-amber-300" }, APPROVED: { word: "Approved - applying", tone: "text-sky-300" },
  EXECUTED: { word: "Done", tone: "text-emerald-300" }, STALE: { word: "Not applied - changed meanwhile", tone: "text-red-300" },
  REJECTED: { word: "Rejected", tone: "text-red-300" }, WITHDRAWN: { word: "Withdrawn", tone: "text-gray-400" }, EXPIRED: { word: "Expired", tone: "text-gray-400" },
};

export default function ChangeCard({ c, me, onDone }: { c: ChangeDTO; me: string; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const s = STATUS[c.status] ?? { word: c.status, tone: "text-gray-400" };

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setError(null);
    const res = await apiFetch(`/api/changes/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setError(res ? await serverErrorMessage(res, "Couldn't do that.") : "Couldn't reach the server."); return; }
    const d = await res.json();
    window.dispatchEvent(new Event("requests-changed"));
    onDone(action === "APPROVE" ? `${c.ref} applied: ${c.label} for ${c.recordName} is now ${c.after}.` : action === "UNDO" ? `Undo proposed as P-${String(d.number).padStart(4, "0")} - it needs approving too.` : `${c.ref} ${d.status.toLowerCase()}.`);
  }
  const approve = () => {
    if (confirm(`Approve as ${me}?\n\n${c.label} for ${c.recordName}: ${c.before} -> ${c.after}\n\nThis changes the record now (after re-checking it hasn't changed since).`)) act("APPROVE", { fingerprint: c.fingerprint });
  };
  const reject = () => { const r = prompt("Why is it rejected? (the person who proposed it sees this)"); if (r && r.trim()) act("REJECT", { reason: r }); };

  return (
    <div className="rounded-xl border border-edge bg-panel p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm text-gray-100"><span className="text-gray-500">{c.ref}</span> · <b>{c.label}</b> · {c.recordName}</div>
        <span className={`text-xs font-semibold ${s.tone}`}>{s.word}</span>
      </div>
      <div className="mt-1 text-sm"><span className="text-gray-400 line-through decoration-gray-600">{c.before}</span> <span className="text-gray-500">→</span> <span className="font-semibold text-gray-100">{c.after}</span></div>
      <p className="mt-1 text-xs text-gray-300">Why: {c.reason}</p>
      <ul className="mt-1 text-xs text-gray-400">{c.sources.map((x, i) => <li key={i}>From {x.type === "SiteRequest" ? "request" : x.type === "Query" ? "answered query" : x.type.toLowerCase()}: {x.label}</li>)}</ul>
      <p className="mt-1 text-[11px] text-gray-500">
        Proposed by {c.proposedByAi ? "Operations AI" : c.requestedBy} {whenText(c.createdAt)}{c.sourcePerson ? ` · information from ${c.sourcePerson}` : ""}{c.undoOf ? ` · undoes ${c.undoOf}` : ""}
        {c.status === "PROPOSED" ? ` · expires ${whenText(c.expiresAt)}` : ""} · fingerprint {c.fingerprint.slice(0, 8)}
      </p>
      {c.status === "PROPOSED" && <p className="mt-1 text-[11px] text-gray-500">Also: {c.alsoMoves}</p>}
      {c.status === "PROPOSED" && c.hiddenFromProposer && <p className="mt-1 text-[11px] text-amber-300">{PROPOSER_HINT}</p>}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {c.canApprove && <button disabled={busy} onClick={approve} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Approve as {me.split(" ")[0]}</button>}
        {c.status === "PROPOSED" && !c.whyNot && <button disabled={busy} onClick={reject} className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-300 disabled:opacity-40">Reject</button>}
        {c.canWithdraw && <button disabled={busy} onClick={() => act("WITHDRAW")} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 disabled:opacity-40">Withdraw</button>}
        {c.canUndo && <button disabled={busy} onClick={() => act("UNDO")} className="rounded-lg border border-edge px-3 py-1.5 text-sm text-gray-300 disabled:opacity-40">Propose undo</button>}
        {c.status === "PROPOSED" && c.whyNot && <span className="text-xs text-gray-500">{c.whyNot}</span>}
        <button onClick={() => setShowLog((v) => !v)} className="ml-auto text-xs text-gray-500 underline">{showLog ? "Hide" : "History"}</button>
      </div>
      {showLog && (
        <ol className="mt-2 space-y-0.5 text-[11px] text-gray-400">
          {c.events.map((e, i) => <li key={i}>{whenText(e.at)} · {e.by} · {e.action.toLowerCase()}{e.note ? ` - ${e.note}` : ""}</li>)}
        </ol>
      )}
    </div>
  );
}

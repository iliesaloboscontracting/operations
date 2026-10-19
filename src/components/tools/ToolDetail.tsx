"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRightLeft, History, Wrench } from "lucide-react";
import PhotoPicker from "./PhotoPicker";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { ToolboxDTO, ToolIssueDTO } from "@/lib/types";

const input =
  "w-full rounded-lg border border-edge bg-panel2 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";

export const ISSUE_LABEL: Record<string, string> = {
  REPORTED: "Reported",
  SWAP_REQUESTED: "Swap requested (Hilti)",
  SWAPPED: "Swapped",
  FIXED: "Fixed",
  CLOSED: "Closed",
};

type Detail = {
  id: string;
  tag: string;
  toolboxId: string | null;
  photos: { id: string; kind: string; createdAt: string; takenBy: string | null }[];
  movements: { id: string; fromName: string | null; toName: string | null; reason: string | null; movedBy: string | null; createdAt: string }[];
  issues: ToolIssueDTO[];
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

// Extra panel in a tool's edit window. Everything here saves straight away
// (separately from the form's Save button) and refreshes the register.
export default function ToolDetail({ toolId, reload }: { toolId: string; reload: () => Promise<void> }) {
  const [tool, setTool] = useState<Detail | null>(null);
  const [toolboxes, setToolboxes] = useState<ToolboxDTO[]>([]);
  const [moveTo, setMoveTo] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [fault, setFault] = useState("");
  const [notWorking, setNotWorking] = useState(true);
  const [faultPhoto, setFaultPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/tools/${toolId}`);
    if (res.ok) {
      const t: Detail = await res.json();
      setTool(t);
      setMoveTo(t.toolboxId ?? "");
    }
  }, [toolId]);
  useEffect(() => {
    load();
    apiFetch("/api/toolboxes").then((r) => (r.ok ? r.json() : [])).then(setToolboxes);
  }, [load]);

  async function run(fn: () => Promise<Response>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(await serverErrorMessage(res, fallback));
      await Promise.all([load(), reload()]);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const json = (url: string, method: string, body: unknown) =>
    fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  if (!tool) return <div className="py-4 text-xs text-gray-500">Loading…</div>;
  const openIssues = tool.issues.filter((i) => i.status === "REPORTED" || i.status === "SWAP_REQUESTED");

  return (
    <div className="mt-5 space-y-5 border-t border-edge pt-4">
      {error && <div className="rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}

      {tool.photos.length > 0 && (
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Photos</h3>
          <div className="flex flex-wrap gap-2">
            {tool.photos.map((p) => (
              <a key={p.id} href={`/api/tools/photos/${p.id}`} target="_blank" rel="noreferrer" className="block" title={`${p.kind.toLowerCase()} · ${day(p.createdAt)}${p.takenBy ? ` · ${p.takenBy}` : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/tools/photos/${p.id}`} alt={p.kind} className="h-20 w-20 rounded-md border border-edge object-cover" />
                <div className="mt-0.5 text-center text-[10px] text-gray-500">{p.kind === "PLATE" ? "Plate" : p.kind === "CONDITION" ? "Condition" : p.kind === "FAULT" ? "Fault" : "Check"}</div>
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <ArrowRightLeft size={12} /> Toolbox
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <select className={`${input} w-auto min-w-[12rem]`} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">Yard (no toolbox)</option>
            {toolboxes.map((b) => <option key={b.id} value={b.id}>{b.name}{b.supervisor ? ` — ${b.supervisor.name}` : ""}</option>)}
          </select>
          <input className={`${input} w-auto flex-1`} placeholder="Reason (optional)" value={moveReason} onChange={(e) => setMoveReason(e.target.value)} />
          <button
            type="button"
            className={btn}
            disabled={busy || moveTo === (tool.toolboxId ?? "")}
            onClick={async () => {
              if (await run(() => json(`/api/tools/${tool.id}`, "PATCH", { toolboxId: moveTo || null, moveReason: moveReason || null }), "Couldn't move the tool.")) setMoveReason("");
            }}
          >
            Move
          </button>
        </div>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
          <Wrench size={12} /> Faults
        </h3>
        {tool.issues.length === 0 && <p className="mb-2 text-xs text-gray-500">No faults reported.</p>}
        <ul className="mb-3 space-y-1.5">
          {tool.issues.map((i) => (
            <li key={i.id} className="rounded-md border border-edge px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${i.status === "REPORTED" || i.status === "SWAP_REQUESTED" ? "bg-amber-500/15 text-amber-500" : "bg-gray-700 text-gray-300"}`}>
                  {ISSUE_LABEL[i.status] ?? i.status}
                </span>
                <span className="text-gray-500">{day(i.createdAt)}{i.reportedBy ? ` · ${i.reportedBy}` : ""}</span>
                {i.swapRef && <span className="text-gray-500">· Hilti ref {i.swapRef}</span>}
              </div>
              <div className="mt-1 text-gray-200">{i.description}</div>
              {i.replacementTool && <div className="mt-1 text-gray-400">Replaced by {i.replacementTool.tag} {i.replacementTool.name}</div>}
            </li>
          ))}
        </ul>
        {openIssues.length > 0 && (
          <p className="mb-3 flex items-center gap-1 text-[11px] text-amber-500">
            <AlertTriangle size={11} /> Request the Hilti swap and record the replacement on the “Faults & Hilti swaps” tab.
          </p>
        )}
        <div className="space-y-2 rounded-md border border-edge p-3">
          <textarea className={`${input} min-h-[64px]`} placeholder="What's wrong? e.g. Not hammering, cuts out under load, cracked housing" value={fault} onChange={(e) => setFault(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <PhotoPicker kind="FAULT" label="Photo of the fault (optional)" photoId={faultPhoto} onChange={setFaultPhoto} />
            <div className="flex flex-col justify-end gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={notWorking} onChange={(e) => setNotWorking(e.target.checked)} />
                Not working properly (marks it Needs repair)
              </label>
              <button
                type="button"
                className={btn}
                disabled={busy || !fault.trim()}
                onClick={async () => {
                  const ok = await run(() => json(`/api/tools/${tool.id}/issues`, "POST", { description: fault, photoId: faultPhoto, notWorking }), "Couldn't report the fault.");
                  if (ok) {
                    setFault("");
                    setFaultPhoto(null);
                  }
                }}
              >
                Report fault
              </button>
            </div>
          </div>
        </div>
      </section>

      {tool.movements.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <History size={12} /> Move history
          </h3>
          <ul className="space-y-1 text-xs text-gray-400">
            {tool.movements.map((m) => (
              <li key={m.id}>
                {day(m.createdAt)} — {m.fromName ?? "Yard"} → <span className="text-gray-200">{m.toName ?? "Yard"}</span>
                {m.reason ? ` · ${m.reason}` : ""}
                {m.movedBy ? ` · ${m.movedBy}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

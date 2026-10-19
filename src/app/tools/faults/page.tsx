"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCopy, Wrench } from "lucide-react";
import PageShell from "@/components/PageShell";
import ToolsTabs from "@/components/tools/ToolsTabs";
import { ISSUE_LABEL } from "@/components/tools/ToolDetail";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { OWNERSHIP_LABEL } from "@/lib/pickTool";
import type { ToolDTO, ToolIssueDTO } from "@/lib/types";

const input =
  "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

// The text to send Hilti when asking for a fleet swap - Operations never
// contacts Hilti itself; this is copied and sent by a person.
function hiltiSummary(i: ToolIssueDTO) {
  const t = i.tool!;
  return [
    `Swap request - ${[t.brand, t.model].filter(Boolean).join(" ") || t.name}`,
    `Serial no.: ${t.serialNumber ?? "not recorded"}`,
    t.itemNo ? `Item no. (FFE): ${t.itemNo}` : null,
    t.fleetRef ? `Fleet ref: ${t.fleetRef}` : null,
    `Fault: ${i.description}`,
    `Reported: ${day(i.createdAt)}${i.reportedBy ? ` by ${i.reportedBy}` : ""}`,
    `Lobos tag: ${t.tag}${t.toolbox ? ` (${t.toolbox.name})` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export default function FaultsPage() {
  const { canEdit } = useAuth();
  const [issues, setIssues] = useState<ToolIssueDTO[]>([]);
  const [tools, setTools] = useState<ToolDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [i, t] = await Promise.all([apiFetch("/api/tool-issues"), apiFetch("/api/tools")]);
    if (i.ok) setIssues(await i.json());
    if (t.ok) setTools(await t.json());
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function update(id: string, body: unknown, fallback: string) {
    setError(null);
    const res = await fetch(`/api/tool-issues/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return setError(await serverErrorMessage(res, fallback));
    await load();
  }

  return (
    <PageShell title="Faults & Hilti swaps" subtitle="Tools reported faulty, and fleet tools waiting on a Hilti swap-out.">
      <ToolsTabs />
      {error && <div className="mb-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {loading ? (
        <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : issues.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-500">
          No open faults. Report one from a tool on the Register (click the tool).
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((i) => (
            <FaultCard key={i.id} issue={i} tools={tools} canEdit={canEdit} update={update} />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function FaultCard({
  issue: i, tools, canEdit, update,
}: {
  issue: ToolIssueDTO;
  tools: ToolDTO[];
  canEdit: boolean;
  update: (id: string, body: unknown, fallback: string) => Promise<void>;
}) {
  const [ref, setRef] = useState(i.swapRef ?? "");
  const [replacement, setReplacement] = useState("");
  const [copied, setCopied] = useState(false);
  const t = i.tool!;
  // A replacement is a different, current tool - usually one just registered by photo.
  const candidates = tools.filter((x) => x.id !== t.id && x.condition !== "Swapped out");

  return (
    <div className="rounded-xl border border-edge bg-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Wrench size={14} className="text-amber-500" />
            <span className="font-semibold text-gray-100">{t.tag} · {t.name}</span>
            <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">{ISSUE_LABEL[i.status]}</span>
          </div>
          <div className="mt-0.5 text-xs text-gray-400">
            {[t.brand, t.model].filter(Boolean).join(" ")} · serial {t.serialNumber ?? "not recorded"} · {OWNERSHIP_LABEL[t.ownership] ?? t.ownership}
            {t.toolbox ? ` · ${t.toolbox.name}` : " · Yard"}
          </div>
        </div>
        <div className="text-right text-[11px] text-gray-500">
          Reported {day(i.createdAt)}{i.reportedBy ? ` by ${i.reportedBy}` : ""}
          {i.swapRef && <div>Hilti ref {i.swapRef}</div>}
        </div>
      </div>
      <p className="mt-2 text-sm text-gray-200">{i.description}</p>
      {i.photoId && (
        <a href={`/api/tools/photos/${i.photoId}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/tools/photos/${i.photoId}`} alt="Fault" className="mt-2 h-24 rounded-md border border-edge object-cover" />
        </a>
      )}

      {canEdit && (
        <div className="mt-3 space-y-2 border-t border-edge pt-3">
          {i.status === "REPORTED" && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                className={`${quiet} flex items-center gap-1`}
                onClick={async () => {
                  await navigator.clipboard.writeText(hiltiSummary(i));
                  setCopied(true);
                }}
              >
                <ClipboardCopy size={12} /> {copied ? "Copied" : "Copy details for Hilti"}
              </button>
              <input className={input} placeholder="Hilti job / swap ref (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
              <button className={btn} onClick={() => update(i.id, { status: "SWAP_REQUESTED", swapRef: ref }, "Couldn't record the swap request.")}>
                Swap requested with Hilti
              </button>
              <button className={quiet} onClick={() => update(i.id, { status: "FIXED" }, "Couldn't mark it fixed.")}>Fixed in-house</button>
              <button className={quiet} onClick={() => update(i.id, { status: "CLOSED", resolution: "No fault found" }, "Couldn't close it.")}>No fault - close</button>
            </div>
          )}
          {i.status === "SWAP_REQUESTED" && (
            <div className="flex flex-wrap items-center gap-2">
              <select className={input} value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                <option value="">Replacement tool from Hilti…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.tag} · {c.name}{c.serialNumber ? ` · ${c.serialNumber}` : ""}{c.toolbox ? ` (${c.toolbox.name})` : ""}
                  </option>
                ))}
              </select>
              <button
                className={btn}
                disabled={!replacement}
                onClick={() => update(i.id, { status: "SWAPPED", replacementToolId: replacement }, "Couldn't record the swap.")}
              >
                Swapped - replacement goes in {t.toolbox?.name ?? "the yard"}
              </button>
              <button className={quiet} onClick={() => update(i.id, { status: "FIXED" }, "Couldn't mark it fixed.")}>Repaired and returned</button>
              <p className="w-full text-[11px] text-gray-500">
                Register the replacement first with “Register by photo” (plate + condition), then pick it here.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

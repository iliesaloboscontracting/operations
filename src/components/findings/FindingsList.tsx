"use client";

// The list of open findings (Phase 2, shared since Task J, 25 Oct 2026):
// worst first, CRITICAL / HIGH / MEDIUM one by one, INFO bundled per kind,
// "Details" opens the finding panel (values, questions, actions, history).
// The Directors overview ("Needs attention", director-level kinds) and
// Operations -> Attention (everything else) both use it. Extra rows (e.g.
// budgets waiting, questions waiting) sit on top.
import { useState } from "react";
import { Card } from "@/components/tracking/parts";
import { DLink, Help, PriorityPill } from "@/components/directors/parts";
import FindingPanel from "@/components/directors/FindingPanel";
import { groupForDisplay, type FindingDTO } from "@/lib/findings/view";
import type { Priority } from "@/lib/insights/kpis";

export type FindingsMeta = { open: number; bySeverity: Record<string, number>; signalCleared: number; closedThisWeek: number; checkedAt: string | null };
export type ExtraRow = { key: string; priority: Priority; title: string; href: string; hint: string };

const sydDay = (ts: string) => new Date(ts).toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });

export default function FindingsList({ title, findings, meta, extra = [], emptyText, onRefresh, help = true }: {
  title: string; findings: FindingDTO[]; meta: FindingsMeta; extra?: ExtraRow[]; emptyText: string; onRefresh: () => void;
  help?: boolean; // the "?" opens the Directors KPI dictionary - off where people can't open it
}) {
  const { singles, infoGroups } = groupForDisplay(findings);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const urgent = (meta.bySeverity.CRITICAL ?? 0) + (meta.bySeverity.HIGH ?? 0);
  const shownSingles = showAll ? singles : singles.slice(0, 7);
  const checked = meta.checkedAt ? new Date(meta.checkedAt).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;
  return (
    <Card className="mb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-gray-100">{title}</div>
        <div className="text-[11px] text-gray-500">
          {urgent} critical or high · {meta.open} open{meta.signalCleared ? ` · ${meta.signalCleared} cleared, to close` : ""} · {meta.closedThisWeek} closed this week{checked ? ` · checked ${checked}` : ""}
        </div>
      </div>
      {singles.length === 0 && infoGroups.length === 0 && extra.length === 0 ? (
        <p className="text-sm text-emerald-400">{emptyText}</p>
      ) : (
        <div className="divide-y divide-edge">
          {extra.map((a) => (
            <div key={a.key} className="flex gap-3 py-2.5">
              <PriorityPill p={a.priority} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-200"><DLink href={a.href} className="hover:underline">{a.title}</DLink></div>
                <div className="mt-0.5 text-[11px] text-gray-500">{a.hint}</div>
              </div>
            </div>
          ))}
          {shownSingles.map((f) => (
            <div key={f.id} className="flex gap-3 py-2.5">
              <PriorityPill p={f.severity} />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-200">{f.href ? <DLink href={f.href} className="hover:underline">{f.title}</DLink> : f.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                  <span>Open since {sydDay(f.firstSeenAt)}</span>
                  {f.signalClearedAt && <span className="text-emerald-400">No longer showing since {sydDay(f.signalClearedAt)} - to close</span>}
                  {f.status !== "OPEN" && <span>{f.status === "ACKNOWLEDGED" ? "Acknowledged" : "Being actioned"}{f.ownerName ? ` · ${f.ownerName}` : ""}</span>}
                  {f.provisional && <span>Data incomplete</span>}
                  {help && <Help id={f.kpi} />}
                  <button onClick={() => setOpenId(f.id)} className="text-brand-300 hover:underline">Details</button>
                </div>
              </div>
            </div>
          ))}
          {infoGroups.map((g) => (
            <div key={g.rule} className="flex gap-3 py-2.5">
              <PriorityPill p="INFO" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-200">{g.items.length} {g.label}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {g.items.slice(0, 12).map((f) => (
                    <button key={f.id} onClick={() => setOpenId(f.id)} className="rounded-full border border-edge px-2 py-0.5 text-[11px] text-gray-300 hover:bg-panel2">{f.subjectName}</button>
                  ))}
                  {g.items.length > 12 && <span className="px-1 text-[11px] text-gray-500">+{g.items.length - 12} more</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500">Gaps to fill - they close themselves once fixed {help && <Help id={g.kpi} />}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {singles.length > 7 && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-1 text-xs text-brand-400 hover:underline">
          {showAll ? "Show fewer" : `Show all ${singles.length}`}
        </button>
      )}
      {openId && <FindingPanel id={openId} onClose={() => setOpenId(null)} onChanged={onRefresh} />}
    </Card>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import HoursVsBudget from "@/components/tracking/HoursVsBudget";
import SiteReport from "@/components/dailyReport/SiteReport";
import { UNIT_LABEL, ACM } from "@/lib/dailyLog/rules";
import type { DayReviewSiteLogDTO, HoursVsBudgetDTO } from "@/lib/dailyLog/types";

// The "Site log" panel on a Day Review job card (Task K): the pilot
// supervisor's daily log for the job - hours split by activity code (labour
// and each machine), delays, tip dockets (asbestos highlighted), this week's
// % complete, earlier versions - and the read-time checks: "No site log"
// once it's past 19:00, the split no longer matching sign-ins, crew entered
// by hand. Read-only; no dollars. Managers+ also get (30 Oct 2026) "What was
// said" - each recording word for word next to its tidied text, sent only to
// them by the server - and the full daily site report inline.

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" });
const hrs = (n: number) => `${Math.round(n * 100) / 100} h`;
const length = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export default function SiteLogPanel({ log, budget }: { log: DayReviewSiteLogDTO; budget?: HoursVsBudgetDTO }) {
  const [showEarlier, setShowEarlier] = useState(false);
  const [showSaid, setShowSaid] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const { canEdit } = useAuth(); // the written report is Manager+
  const l = log.latest;
  const photo = (file: string) => `/api/day-review/site-logs/photo?log=${l?.logId}&file=${encodeURIComponent(file)}`;
  const labour = l ? l.hours.filter((x) => x.kind === "LABOUR") : [];
  const plant = l ? l.hours.filter((x) => x.kind !== "LABOUR") : [];
  const max = Math.max(1, ...labour.map((x) => x.hours));

  return (
    <div className="border-t border-edge/70 px-3.5 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <NotebookPen size={13} className="text-gray-500" />
        <span className="text-xs font-semibold text-gray-200">Site log</span>
        {l ? (
          <span className="text-[11px] text-gray-500">Logged by {l.submittedBy} {time(l.at)}{l.revision > 1 ? ` (v${l.revision})` : ""}{l.durationSec != null ? ` · took ${Math.round(l.durationSec)}s` : ""}{log.voiceCount > 0 ? " · by voice" : ""}</span>
        ) : log.missing ? (
          <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-400">No site log</span>
        ) : (
          <span className="text-[11px] text-gray-500">{log.ran ? `Due ${time(log.dueAt)}` : "Not logged"}</span>
        )}
        {l && !l.crewOk && <span className="rounded-full bg-gray-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-gray-300">Crew entered by hand</span>}
        {l && canEdit && (
          <span className="ml-auto flex items-center gap-3 text-[11px]">
            <button className="text-brand-400 hover:underline" onClick={() => setShowReport((s) => !s)}>{showReport ? "Hide full report" : "Full report"}</button>
            <Link href={`/daily-report/${log.jobId}`} className="text-brand-400 hover:underline" title="Opens the report on its own page, to print or save as PDF">Daily site report</Link>
          </span>
        )}
        {log.mismatch && l && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">Split {hrs(l.labourHours)}, signed now {hrs(log.signedNow)}</span>}
      </div>

      {l && (
        <div className="space-y-2 text-xs">
          {l.crewNote && <p className="text-gray-400">Crew note: &ldquo;{l.crewNote}&rdquo;</p>}
          <div>
            <div className="mb-1 text-[11px] text-gray-500">{l.crewCount} crew · {hrs(l.splitHours)} split of {hrs(l.labourHours)}</div>
            {labour.map((x) => (
              <div key={x.code} className="mb-0.5 flex items-center gap-2">
                <span className="w-48 shrink-0 truncate text-gray-300" title={x.label}><b>{x.code}</b> {x.label.slice(x.code.length + 1)}</span>
                <span className="h-2 rounded bg-brand-500/60" style={{ width: `${Math.max(4, (x.hours / max) * 45)}%` }} />
                <span className="tabular-nums text-gray-400">{hrs(x.hours)}</span>
              </div>
            ))}
            {plant.length > 0 && <div className="mt-1 text-[11px] text-gray-500">Plant: {plant.map((x) => `${x.resourceName ?? "machine"} → ${x.code} (${hrs(x.hours)})`).join(" · ")}</div>}
          </div>
          <div className="text-gray-400">
            {l.delays.length ? l.delays.map((d, i) => (
              <div key={i}>Delay: <b className="text-gray-300">{d.label}</b>{d.hoursLost != null ? ` · ~${hrs(d.hoursLost)} lost` : ""} · {d.affects.toLowerCase()}{d.note ? ` · ${d.note}` : ""}
                {d.photos.map((p) => <a key={p} href={photo(p)} target="_blank" rel="noreferrer" className="ml-1 text-brand-400 underline">photo</a>)}</div>
            )) : <div>No delays</div>}
          </div>
          <div className="text-gray-400">
            {l.dockets.length ? l.dockets.map((d, i) => (
              <div key={i} className={d.wasteClass === ACM ? "rounded bg-red-500/10 px-1 text-red-300" : ""}>
                Docket: {d.wasteClass} · {d.quantity} {UNIT_LABEL[d.unit] ?? d.unit}{d.docketNo ? ` · #${d.docketNo}` : ""} · {d.code}
                {d.photo && <a href={photo(d.photo)} target="_blank" rel="noreferrer" className="ml-1 text-brand-400 underline">photo</a>}
              </div>
            )) : null /* tip dockets now arrive as receipts (Receipts R1), not on the log */}
          </div>
          {l.note && <p className="text-gray-300">&ldquo;{l.note}&rdquo;</p>}
          {l.photos.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{l.photos.map((p) => <a key={p} href={photo(p)} target="_blank" rel="noreferrer"><img src={photo(p)} alt="" className="h-14 w-14 rounded object-cover" /></a>)}</div>
          )}
        </div>
      )}

      {log.transcripts && log.transcripts.length > 0 && (
        <div className="mt-2 text-xs">
          <button className="text-[11px] text-gray-500 underline" onClick={() => setShowSaid((s) => !s)}>
            {showSaid ? "Hide what was said" : `What was said (${log.transcripts.length} recording${log.transcripts.length === 1 ? "" : "s"})`}
          </button>
          {showSaid && (
            <div className="mt-1.5 space-y-2">
              {log.transcripts.map((v) => (
                <div key={v.id} className="rounded-lg border border-edge/70 bg-panel2/40 p-2">
                  <div className="mb-1 text-[11px] text-gray-500">Recorded {time(v.at)}{v.seconds != null ? ` · ${length(v.seconds)} long` : ""}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Said</div>
                      <p className="whitespace-pre-wrap text-gray-300">{v.transcript}</p>
                    </div>
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Tidied</div>
                      {v.tidied ? <p className="whitespace-pre-wrap text-gray-300">{v.tidied}</p> : <p className="text-gray-500">Not tidied - the supervisor&apos;s own words were used.</p>}
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-gray-500">Word for word from the recording, with any amounts taken out. The log above is what the supervisor sent.</p>
            </div>
          )}
        </div>
      )}

      {showReport && (
        <div className="mt-2 rounded-xl border border-edge/70 bg-panel2/30 p-2">
          <SiteReport jobId={log.jobId} mode="ops" inline />
        </div>
      )}

      {log.progress && (
        <div className="mt-2 text-xs">
          <div className="text-[11px] text-gray-500">Progress this week (by {log.progress.submittedBy})</div>
          {log.progress.lines.map((p) => (
            <div key={`${p.code}-${p.label}`} className="text-gray-300">{p.label}: <b>{p.pct}%</b>{p.last != null ? <span className="text-gray-500"> (last week {p.last}%)</span> : null}{p.reason ? <span className="text-amber-400"> · {p.reason}</span> : null}</div>
          ))}
        </div>
      )}

      {budget && budget.state !== "NO_LOGS" && (
        <div className="mt-2">
          <div className="mb-1 text-[11px] text-gray-500">Labour hours vs budget (to this date)</div>
          <HoursVsBudget data={budget} compact />
        </div>
      )}

      {log.earlier.length > 0 && (
        <div className="mt-1.5">
          <button className="text-[11px] text-gray-500 underline" onClick={() => setShowEarlier((s) => !s)}>{showEarlier ? "Hide" : "Earlier versions"} ({log.earlier.length})</button>
          {showEarlier && log.earlier.map((e) => <div key={e.revision} className="text-[11px] text-gray-500">v{e.revision} by {e.submittedBy} {time(e.at)} · {hrs(e.splitHours)} split of {hrs(e.labourHours)}</div>)}
        </div>
      )}
    </div>
  );
}

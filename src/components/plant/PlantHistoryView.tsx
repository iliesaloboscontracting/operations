"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Moon, Sun, Wrench } from "lucide-react";
import { serverErrorMessage } from "@/lib/apiFetch";
import type { CheckRow, MachineHistory } from "@/lib/prestart/history";

// A machine's checks & service history (Ilies, 12 Nov 2026) - view only. On the machine's QR (anyone holding the
// sticker, e.g. the builder's site manager - no name needed) and on the Plant page (Managers / Admins). `src` is the
// JSON route; `src + "/download"` the PDF / CSV. No money ever reaches it (the routes run linkSafe).

const DAYS = [7, 30, 90] as const;
const day = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayYear = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const TONE: Record<string, string> = {
  DO_NOT_USE: "border-red-500 bg-red-600 text-white",
  URGENT: "border-red-500/60 bg-red-500/15 text-red-300",
  HIGH: "border-amber-500/60 bg-amber-500/15 text-amber-300",
  LOW: "border-gray-600 bg-gray-700/40 text-gray-300",
};
const STATE: Record<string, { label: string; tone: string }> = {
  EXPIRED: { label: "Overdue", tone: "text-red-300" },
  EXPIRING: { label: "Due soon", tone: "text-amber-300" },
  VALID: { label: "OK", tone: "text-emerald-300" },
  NO_EXPIRY: { label: "No date", tone: "text-gray-400" },
  NOT_RECORDED: { label: "Not recorded", tone: "text-gray-500" },
};

export default function PlantHistoryView({ src, compact = false }: { src: string; compact?: boolean }) {
  const [tab, setTab] = useState<"checks" | "service">("checks");
  const [days, setDays] = useState<(typeof DAYS)[number]>(compact ? 30 : 90);
  const [h, setH] = useState<MachineHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    fetch(`${src}?days=${days}`).then(async (res) => {
      if (!live) return;
      if (!res.ok) { setError(await serverErrorMessage(res, "Couldn't load the history - check your signal and try again.")); setLoading(false); return; }
      setH(await res.json());
      setLoading(false);
    }, () => { if (live) { setError("Couldn't load the history - check your signal and try again."); setLoading(false); } });
    return () => { live = false; };
  }, [src, days]);

  const file = (what: "checks" | "service", format: "pdf" | "csv") => `${src}/download?what=${what}&days=${days}&format=${format}`;
  const pill = (on: boolean) => `rounded-lg px-3 py-1.5 text-sm ${on ? "bg-brand-600 text-white" : "border border-edge text-gray-300"}`;

  return (
    <div className="space-y-3">
      {h?.doNotUse && (
        <div className="flex items-start gap-2 rounded-xl border-2 border-red-500 bg-red-600 px-3 py-3 text-white">
          <AlertTriangle className="mt-0.5 shrink-0" size={20} />
          <div>
            <div className="text-lg font-bold tracking-wide">DO NOT USE</div>
            <div className="text-sm">{h.down ? "This machine is marked Down." : "A Do-not-use fault is open on this machine."} Call the office.</div>
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={pill(tab === "checks")} onClick={() => setTab("checks")}>Pre-start records</button>
        <button type="button" className={pill(tab === "service")} onClick={() => setTab("service")}>Service history</button>
      </div>
      {tab === "checks" && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          Last
          {DAYS.map((d) => <button type="button" key={d} className={`rounded-md px-2 py-1 ${days === d ? "bg-panel2 text-gray-100 ring-1 ring-brand-500/60" : "text-gray-400"}`} onClick={() => setDays(d)}>{d} days</button>)}
        </div>
      )}
      {error ? (
        <div className="rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>
      ) : loading || !h ? (
        <div className="py-10 text-center text-gray-500"><Loader2 className="mx-auto animate-spin" /></div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <a className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white" href={file(tab, "pdf")}>
              <FileText size={16} /> Download PDF
            </a>
            <a className="inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm text-gray-300" href={file(tab, "csv")}>
              <Download size={16} /> CSV
            </a>
            <span className="text-xs text-gray-500">{tab === "checks" ? `Last ${days} days` : "Dates, services and open faults"}</span>
          </div>
          {tab === "checks" ? <Checks h={h} days={days} /> : <Service h={h} />}
        </>
      )}
    </div>
  );
}

function Checks({ h, days }: { h: MachineHistory; days: number }) {
  if (!h.checks.length) return <div className="rounded-xl border border-edge bg-panel p-4 text-sm text-gray-400">No pre-start or post-check in the last {days} days.</div>;
  return (
    <div className="space-y-2">
      {h.checks.map((c) => <CheckCard key={c.id} c={c} />)}
      {h.truncated && <p className="text-xs text-gray-500">Only the newest checks are shown - the office has the rest.</p>}
      <p className="text-xs text-gray-500">{h.photosNote}</p>
    </div>
  );
}

function CheckCard({ c }: { c: CheckRow }) {
  return (
    <div className="rounded-xl border border-edge bg-panel p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-gray-100">
          {c.kind === "PRE" ? <Sun size={16} className="text-brand-300" /> : <Moon size={16} className="text-amber-300" />}
          {c.kindLabel}
        </div>
        <div className="text-gray-400">{day(c.date)} · {c.time}</div>
      </div>
      <div className="mt-1 text-gray-300">{c.operator}</div>
      <div className="mt-1 text-gray-400">
        Hour meter: <span className="text-gray-200">{c.hourMeter ?? "-"}</span>
        {c.hourMeterNote && <span className="ml-1 text-amber-300">({c.hourMeterNote})</span>}
      </div>
      <div className={`mt-1 flex items-start gap-1.5 ${c.allOk ? "text-emerald-300" : "text-red-300"}`}>
        {c.allOk ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
        <span>{c.allOk ? "Checklist all OK" : `Failed: ${c.failed.join(", ")}`}</span>
      </div>
      {c.faults.map((f, i) => (
        <div key={i} className="mt-1.5 flex flex-wrap items-center gap-1.5 text-gray-300">
          <span className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${TONE[f.priority] ?? TONE.LOW}`}>{f.priorityLabel}</span>
          <span>{[f.item, f.description].filter(Boolean).join(" - ")}</span>
          <span className="text-xs text-gray-500">now {f.statusLabel}</span>
        </div>
      ))}
      {c.stillThere > 0 && <div className="mt-1 text-xs text-gray-500">{c.stillThere} known fault{c.stillThere === 1 ? "" : "s"} confirmed still there</div>}
      {c.walkaround && <div className="mt-1 text-xs text-gray-500">{c.walkaround}</div>}
    </div>
  );
}

function Service({ h }: { h: MachineHistory }) {
  const s = h.service;
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-xl border border-edge bg-panel p-3">
        <div className="mb-1 font-semibold text-gray-100">Next service</div>
        {s.nextDue?.expiryDate ? (
          <div className={STATE[s.nextDue.state]?.tone ?? "text-gray-300"}>{dayYear(s.nextDue.expiryDate)} - {STATE[s.nextDue.state]?.label ?? s.nextDue.state}</div>
        ) : <div className="text-gray-500">Not recorded{s.registerNote ? "" : " - ask the office"}</div>}
        {s.registerNote && <div className="mt-0.5 text-xs text-gray-400">Plant register: {s.registerNote}</div>}
        <div className="mt-2 space-y-0.5">
          {s.dates.filter((d) => d.label !== "Service due").map((d, i) => (
            <div key={i} className="flex justify-between gap-2">
              <span className="text-gray-400">{d.label}</span>
              <span className={STATE[d.state]?.tone ?? "text-gray-300"}>{d.expiryDate ? `${dayYear(d.expiryDate)} - ${STATE[d.state]?.label ?? d.state}` : "Not recorded"}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-edge bg-panel p-3">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-gray-100"><Wrench size={15} /> Last services</div>
        {s.records.length ? s.records.map((r, i) => (
          <div key={i} className="border-t border-edge py-1.5 first:border-t-0">
            <div className="flex justify-between gap-2"><span className="text-gray-200">{dayYear(r.date)}</span>{r.reading != null && <span className="text-xs text-gray-500">Odometer / hours {r.reading}</span>}</div>
            {r.work && <div className="text-gray-300">{r.work}</div>}
            {r.provider && <div className="text-xs text-gray-500">{r.provider}</div>}
          </div>
        )) : <div className="text-gray-500">No services recorded.</div>}
      </div>
      <div className="rounded-xl border border-edge bg-panel p-3">
        <div className="mb-1 font-semibold text-gray-100">Open faults</div>
        {s.openFaults.length ? s.openFaults.map((f, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 border-t border-edge py-1.5 text-gray-300 first:border-t-0">
            <span className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${TONE[f.priority] ?? TONE.LOW}`}>{f.priorityLabel}</span>
            <span>{[f.item, f.description].filter(Boolean).join(" - ")}</span>
            <span className="text-xs text-gray-500">{f.statusLabel} · reported {day(f.reportedOn)}</span>
          </div>
        )) : <div className="text-gray-500">No open faults.</div>}
      </div>
    </div>
  );
}

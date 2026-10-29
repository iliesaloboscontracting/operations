"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { fmtDay } from "@/lib/dates";
import { ACM, UNIT_LABEL } from "@/lib/dailyLog/rules";
import type { SiteReportDTO } from "@/lib/dailyLog/types";
import BeforeAfterView from "./BeforeAfterView";

// The written "Daily site report" (29 Oct 2026, Ilies "go"): one job on one day, laid out for the office to read or
// print - site, date, supervisor, crew and signed hours, hours by activity code, plant, delays with photos, tip
// dockets sent, the notes (cleaned from the supervisor's voice, or typed) and photos. "Print / Save as PDF" gives a
// tidy A4 (the print styles below hide everything else on the page). No dollar figures anywhere - the server's DTO
// has none and the route checks. The office's copy (Manager+) and the directors' copy (guardDirector) share this.
// inline: shown inside a Day Review job card (30 Oct 2026) - no back / print bar and no print styles (printing is
// from the report's own page).

const hrs = (n: number) => `${Math.round(n * 100) / 100} h`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "2-digit" });
const PRINT = `
@page { size: A4; margin: 12mm; }
@media print {
  body * { visibility: hidden !important; }
  #site-report, #site-report * { visibility: visible !important; }
  #site-report { position: absolute; left: 0; top: 0; width: 100%; color: #111 !important; background: #fff !important; }
  #site-report .sr-card { border-color: #ccc !important; background: #fff !important; break-inside: avoid; }
  #site-report .sr-muted { color: #555 !important; }
  #site-report .sr-noprint { display: none !important; }
  #site-report img { max-height: 70mm; }
}`;

export default function SiteReport({ jobId, mode, inline = false }: { jobId: string; mode: "ops" | "director"; inline?: boolean }) {
  const [r, setR] = useState<SiteReportDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = mode === "director" ? `/api/directors/daily-report` : `/api/daily-report`;
  const photo = (logId: string, file: string) =>
    `${mode === "director" ? "/api/directors/daily-report/photo" : "/api/day-review/site-logs/photo"}?log=${logId}&file=${encodeURIComponent(file)}`;
  useEffect(() => {
    apiFetch(`${base}/${jobId}`).then(async (res) => (res.ok ? setR((await res.json()).report) : setError(await serverErrorMessage(res, "Couldn't load the report."))));
  }, [base, jobId]);

  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!r) return <p className="p-6 text-sm text-gray-500">Loading…</p>;
  const l = r.log;
  const labour = l ? l.hours.filter((x) => x.kind === "LABOUR") : [];
  const plant = l ? l.hours.filter((x) => x.kind !== "LABOUR") : [];
  const back = mode === "director" ? (r.projectId ? `/directors/jobs/${r.projectId}` : "/directors") : (r.projectId ? `/tracking/${r.projectId}` : "/day-review");
  const card = "sr-card rounded-xl border border-edge bg-panel p-4";
  const h3 = "mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400 sr-muted";

  return (
    <div id={inline ? undefined : "site-report"} className={inline ? "space-y-3 text-gray-100" : "mx-auto max-w-3xl space-y-4 p-4 text-gray-100"}>
      {!inline && <style>{PRINT}</style>}
      {!inline && (
        <div className="sr-noprint flex items-center justify-between gap-2">
          <Link href={back} className="text-xs text-brand-400 hover:underline">← Back</Link>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"><Printer size={14} /> Print / Save as PDF</button>
        </div>
      )}

      <header className={card}>
        <p className="sr-muted text-xs uppercase tracking-wide text-gray-500">Daily site report</p>
        <h1 className="text-xl font-semibold">{r.site}{r.jobNo ? ` · ${r.jobNo}` : ""}</h1>
        <p className="sr-muted text-sm text-gray-400">
          {fmtDay(r.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}{r.shift === "NIGHT" ? " · night shift" : ""}
          {l ? ` · Supervisor ${l.submittedBy} · logged ${time(l.at)}${l.revisions > 1 ? ` · version ${l.revision} of ${l.revisions}` : ""}` : " · no site log yet"}
        </p>
      </header>

      <section className={card}>
        <h3 className={h3}>Before and after</h3>
        <BeforeAfterView data={r.beforeAfter} size="lg"
          photoUrl={(id) => `${mode === "director" ? "/api/directors/daily-report/before-after" : "/api/day-review/site-logs/before-after"}?job=${encodeURIComponent(r.jobId)}&id=${encodeURIComponent(id)}`} />
      </section>

      <section className={card}>
        <h3 className={h3}>Crew</h3>
        <p className="text-sm">{r.crew.count} signed in · {hrs(r.crew.hours)} signed (staff {r.crew.staff}, labour hire {r.crew.hire})</p>
        {l && !l.crewOk && <p className="mt-1 text-sm text-amber-300">Crew entered by hand: {l.crewCount} people, {hrs(l.labourHours)}{l.crewNote ? ` - ${l.crewNote}` : ""}</p>}
        {r.crew.people.length > 0 && (
          <table className="mt-2 w-full text-sm">
            <tbody>{r.crew.people.map((p, i) => (
              <tr key={i} className="border-t border-edge/50"><td className="py-1">{p.name}{p.company ? <span className="sr-muted text-gray-500"> ({p.company})</span> : null}</td><td className="sr-muted py-1 text-gray-400">{p.in ?? "-"} – {p.out ?? "still on"}</td><td className="py-1 text-right">{hrs(p.hours)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>

      {l && (
        <>
          <section className={card}>
            <h3 className={h3}>Hours by activity</h3>
            {labour.length ? (
              <table className="w-full text-sm"><tbody>{labour.map((x, i) => (
                <tr key={i} className="border-t border-edge/50"><td className="py-1">{x.label}</td><td className="py-1 text-right">{hrs(x.hours)}</td></tr>
              ))}</tbody></table>
            ) : <p className="sr-muted text-sm text-gray-500">None split.</p>}
          </section>

          {plant.length > 0 && (
            <section className={card}>
              <h3 className={h3}>Plant</h3>
              <table className="w-full text-sm"><tbody>{plant.map((x, i) => (
                <tr key={i} className="border-t border-edge/50"><td className="py-1">{x.resourceName ?? "Machine"}</td><td className="sr-muted py-1 text-gray-400">{x.label}</td><td className="py-1 text-right">{hrs(x.hours)}</td></tr>
              ))}</tbody></table>
            </section>
          )}

          <section className={card}>
            <h3 className={h3}>Delays</h3>
            {l.delays.length === 0 ? <p className="sr-muted text-sm text-gray-500">No hold-ups reported.</p> : l.delays.map((d, i) => (
              <div key={i} className="border-t border-edge/50 py-1.5 text-sm first:border-0">
                <p><span className="font-semibold">{d.label}</span>{d.hoursLost != null ? ` · ${hrs(d.hoursLost)} lost` : ""} · {d.affects === "BOTH" ? "crew and plant" : d.affects.toLowerCase()}{d.note ? ` - ${d.note}` : ""}</p>
                {d.photos.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{d.photos.map((f) => <img key={f} src={photo(l.logId, f)} alt="Delay photo" className="h-32 rounded border border-edge object-cover" />)}</div>}
              </div>
            ))}
          </section>

          <section className={card}>
            <h3 className={h3}>Tip dockets</h3>
            <p className="text-sm">{r.docketsSent ? `${r.docketsSent} docket${r.docketsSent === 1 ? "" : "s"} sent` : "No dockets sent"}</p>
            {l.dockets.length > 0 && <ul className="mt-1 text-sm">{l.dockets.map((d, i) => <li key={i} className={d.wasteClass === ACM ? "text-amber-300" : ""}>{d.code} · {d.wasteClass} · {d.quantity} {UNIT_LABEL[d.unit] ?? d.unit}{d.docketNo ? ` · #${d.docketNo}` : ""}</li>)}</ul>}
          </section>

          <section className={card}>
            <h3 className={h3}>Notes</h3>
            {l.note ? <div className="whitespace-pre-wrap text-sm leading-relaxed">{l.note}</div> : <p className="sr-muted text-sm text-gray-500">No notes.</p>}
          </section>

          {l.photos.length > 0 && (
            <section className={card}>
              <h3 className={h3}>Photos</h3>
              <div className="grid grid-cols-2 gap-2">{l.photos.map((f) => <img key={f} src={photo(l.logId, f)} alt="Site photo" className="w-full rounded border border-edge object-cover" />)}</div>
            </section>
          )}
        </>
      )}
      <p className="sr-muted text-[11px] text-gray-500">From Operations - sign-ins and the supervisor&apos;s daily log. Hours only; no costs.</p>
    </div>
  );
}

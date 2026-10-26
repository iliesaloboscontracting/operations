"use client";

// Accounts -> Payroll (stage 2, docs/accounts/STAGE2-DESIGN.md): each person's week from the sign-ins -
// employees, ABN workers and labour hire - with the supervisor's daily approval, the Manager's lock and
// where the phone was at sign-in. Victoria approves or queries each person's week; the pay-run file has the
// employees she approved (hours per pay item per day, for Xero), the summary has everyone. Hours only.
import { useCallback, useEffect, useState } from "react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import type { PayPersonDTO, PayDayLine } from "@/lib/payroll/store";
import type { DayState, Group } from "@/lib/payroll/rules";

type Week = {
  weekStart: string; weekEnd: string; days: string[]; weekEnded: boolean; managerLock: { by: string; at: string } | null;
  people: PayPersonDTO[]; abnHints: { id: string; name: string }[]; travel: string;
  summary: { byItem: Record<string, number>; bySite: Record<string, number>; byAgency: Record<string, number>; total: number };
};
const GROUP: Record<Group, string> = { EMPLOYEE: "Employees", ABN: "ABN workers", HIRE: "Labour hire" };
const STATE: Record<DayState, { mark: string; tone: string; title: string }> = {
  APPROVED: { mark: "✓", tone: "text-emerald-400", title: "Approved by the supervisor" },
  FLAGGED: { mark: "⚑", tone: "text-amber-300", title: "Flagged by the supervisor" },
  CHANGED: { mark: "≠", tone: "text-amber-300", title: "Changed since the supervisor approved" },
  NOT_APPROVED: { mark: "·", tone: "text-gray-500", title: "Not approved by the supervisor yet" },
  NO_SUPERVISOR: { mark: "–", tone: "text-gray-500", title: "Office / yard / truck sign-in - no supervisor step" },
};
const dayHead = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric" });
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const btn = "rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50";
const quiet = "rounded-md border border-edge px-2.5 py-1 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";

function Day({ lines }: { lines: PayDayLine[] }) {
  if (!lines.length) return <span className="text-gray-600">-</span>;
  return (
    <div className="space-y-0.5">
      {lines.map((l) => {
        const s = STATE[l.dayState];
        return (
          <div key={l.attendanceId} title={`${l.site} · ${l.in}-${l.out ?? "no sign-out"}${l.tile ? ` · board tile: ${l.tile}` : ""}${l.flag ? ` · flag: ${l.flag}` : ""}\n${s.title}${l.approvedBy ? ` (${l.approvedBy})` : ""}`}>
            <span className={l.out ? "text-gray-200" : "text-amber-300"}>{l.hours ?? "?"}</span>
            <span className={`ml-1 ${s.tone}`}>{s.mark}</span>
            {l.gps ? (
              <a className="ml-1 text-sky-400" href={`https://www.google.com/maps?q=${l.gps.lat},${l.gps.lng}`} target="_blank" rel="noreferrer" title={`At sign-in${l.gps.accuracyM != null ? `, within ${l.gps.accuracyM} m` : ""}`}>📍</a>
            ) : l.gpsStatus ? <span className="ml-1 text-gray-600" title={`No location at sign-in (${l.gpsStatus.toLowerCase()})`}>∅</span> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function PayrollPage() {
  const { accountsOnly, isAdmin, loading } = useAuth();
  const [week, setWeek] = useState<string>(addDays(new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }), -7));
  const [data, setData] = useState<Week | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => {
    setData(null);
    apiFetch(`/api/accounts/payroll?week=${week}`).then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the week."))));
  }, [week]);
  useEffect(() => { load(); }, [load]);

  async function review(p: PayPersonDTO, status: "APPROVED" | "QUERY") {
    const note = status === "QUERY" ? prompt(`What needs checking for ${p.name}?`) : "";
    if (status === "QUERY" && !note) return;
    setBusy(p.personKey); setError(null);
    const r = await apiFetch("/api/accounts/payroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week: data!.weekStart, personKey: p.personKey, status, note }) });
    setBusy(null);
    if (!r.ok) return setError(await serverErrorMessage(r, "Couldn't save."));
    setFlash(`${p.name}: ${status === "APPROVED" ? "approved" : "queried"}.`);
    load();
  }

  if (!loading && !accountsOnly && !isAdmin) return <PageShell title="Payroll"><p className="text-sm text-gray-400">This screen is for accounts.</p></PageShell>;
  const groups = (["EMPLOYEE", "ABN", "HIRE"] as Group[]).map((g) => [g, data?.people.filter((p) => p.group === g) ?? []] as const).filter(([, ps]) => ps.length);
  const inRun = data?.people.filter((p) => p.inPayRun).length ?? 0;

  return (
    <PageShell title="Payroll" subtitle="Each person's week from the sign-ins, the supervisor's daily approval and the Manager's lock. Approve or query each person; the pay-run file has the employees you approve. Hours only.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className={quiet} onClick={() => setWeek(addDays(data?.weekStart ?? week, -7))}>← Week before</button>
        <span className="text-sm font-semibold text-gray-100">{data ? `${data.weekStart} to ${data.weekEnd}` : "…"}</span>
        <button className={quiet} onClick={() => setWeek(addDays(data?.weekStart ?? week, 7))}>Week after →</button>
        {data && <a className={quiet} href={`/api/accounts/payroll/export?week=${data.weekStart}&file=payrun`}>Pay-run file (CSV, {inRun} approved)</a>}
        {data && <a className={quiet} href={`/api/accounts/payroll/export?week=${data.weekStart}&file=summary`}>Weekly summary (CSV)</a>}
      </div>
      {data && (
        <p className="mb-3 text-xs text-gray-500">
          {data.managerLock ? `Timesheet locked by ${data.managerLock.by}.` : data.weekEnded ? "The Manager hasn't locked this week's timesheet yet - staff can be approved once it is." : "This week isn't over yet."}
          {" "}✓ supervisor approved · ⚑ flagged · ≠ changed since approved · · not approved · – office / yard / truck · 📍 location at sign-in. Travel / regional: {data.travel} with Victoria.
        </p>
      )}
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">{error ? "" : "Loading..."}</p> : data.people.length === 0 ? <p className="text-sm text-gray-500">No sign-ins this week.</p> : (
        <>
          {groups.map(([g, ps]) => (
            <section key={g} className="mb-4">
              <div className="mb-1 text-sm font-semibold text-gray-100">{GROUP[g]} <span className="font-normal text-gray-500">· {ps.length}</span>{g !== "EMPLOYEE" && <span className="ml-2 text-xs font-normal text-gray-500">not in the pay-run file ({g === "ABN" ? "they invoice" : "paid on the agency's invoice"})</span>}</div>
              <div className="overflow-x-auto rounded-xl border border-edge bg-panel">
                <table className="w-full min-w-[860px] text-xs">
                  <thead><tr className="border-b border-edge text-left text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="px-2 py-1.5">Person</th>{data.days.map((d) => <th key={d} className="px-2 py-1.5">{dayHead(d)}</th>)}<th className="px-2 py-1.5">Hours</th><th className="px-2 py-1.5">Accounts</th>
                  </tr></thead>
                  <tbody className="divide-y divide-edge/60">
                    {ps.map((p) => (
                      <tr key={p.personKey} className="align-top">
                        <td className="px-2 py-1.5">
                          <div className="text-sm text-gray-100">{p.name}</div>
                          {p.company && <div className="text-gray-500">{p.company}</div>}
                          {p.issues.map((i) => <div key={i} className="text-amber-300">{i}</div>)}
                        </td>
                        {data.days.map((d) => <td key={d} className="px-2 py-1.5 tabular-nums"><Day lines={p.days[d] ?? []} /></td>)}
                        <td className="px-2 py-1.5 text-sm font-semibold tabular-nums text-gray-100">{p.hours}</td>
                        <td className="px-2 py-1.5">
                          {p.review && <div className={p.review.status === "APPROVED" ? "text-emerald-300" : "text-amber-300"}>{p.review.status === "APPROVED" ? "Approved" : "Queried"}{p.review.note ? `: ${p.review.note}` : ""}<div className="text-gray-500">{p.review.by}</div></div>}
                          <div className="mt-1 flex flex-wrap gap-1">
                            <button className={btn} disabled={!!p.canApprove || busy === p.personKey || p.review?.status === "APPROVED"} title={p.canApprove ?? undefined} onClick={() => review(p, "APPROVED")}>Approve</button>
                            <button className={quiet} disabled={busy === p.personKey} onClick={() => review(p, "QUERY")}>Query</button>
                          </div>
                          {p.canApprove && <div className="mt-1 text-gray-500">{p.canApprove}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <section className="mb-4 rounded-xl border border-edge bg-panel p-3 text-sm">
            <div className="mb-1 font-semibold text-gray-100">Week summary · {data.summary.total} h</div>
            <div className="grid gap-3 text-xs text-gray-300 md:grid-cols-3">
              <div><div className="mb-0.5 text-gray-500">By pay item</div>{Object.entries(data.summary.byItem).map(([k, v]) => <div key={k}>{k}: {v} h</div>)}</div>
              <div><div className="mb-0.5 text-gray-500">By site</div>{Object.entries(data.summary.bySite).sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k}>{k}: {v} h</div>)}</div>
              <div><div className="mb-0.5 text-gray-500">Labour hire by agency</div>{Object.keys(data.summary.byAgency).length ? Object.entries(data.summary.byAgency).map(([k, v]) => <div key={k}>{k}: {v} h</div>) : <div className="text-gray-500">None</div>}</div>
            </div>
          </section>
          {data.abnHints.length > 0 && (
            <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
              <div className="mb-1 font-semibold text-amber-200">Check: notes mention ABN, but Engagement isn&apos;t set on the Labour register</div>
              {data.abnHints.map((h) => h.name).join(", ")} - an Admin sets Engagement (Employee / ABN) next to the pay rates. Until then they count as employees.
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}

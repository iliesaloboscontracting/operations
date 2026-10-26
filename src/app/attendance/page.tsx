"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import AttendanceJobCard from "@/components/attendance/AttendanceJobCard";
import PosterPanel from "@/components/attendance/PosterPanel";
import type { AttendanceData } from "@/components/attendance/types";
import { apiFetch } from "@/lib/apiFetch";
import { localISODate } from "@/lib/resource";
import type { ResourceDTO } from "@/lib/types";

// Sign-ins (19 Oct 2026): who signed in and out on each site, the hours that
// works out to, and what needs a look. Crew sign in by scanning the
// supervisor's QR or the site poster; only the office (Manager+) changes a
// time here, with a reason that's kept.

function Tile({ label, value, tone = "" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-2">
      <div className="text-[10px] uppercase tracking-widest text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${value ? tone || "text-gray-100" : "text-gray-100"}`}>{value}</div>
    </div>
  );
}

const shiftDate = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return localISODate(d);
};

export default function AttendancePage() {
  const { canEdit, isAdmin } = useAuth();
  const [date, setDate] = useState(() => localISODate());
  const [data, setData] = useState<AttendanceData | null>(null);
  const [people, setPeople] = useState<ResourceDTO[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; status: string }[]>([]);
  const [vehicles, setVehicles] = useState<ResourceDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/attendance?date=${date}`);
    if (!res.ok) return setError(res.status === 403 ? "Sign-ins are for managers." : "Couldn't load sign-ins.");
    setError(null);
    setData(await res.json());
  }, [date]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    apiFetch("/api/resources?type=PERSONNEL").then(async (r) => r.ok && setPeople(((await r.json()) as ResourceDTO[]).filter((p) => p.type === "PERSONNEL")));
    apiFetch("/api/projects").then(async (r) => r.ok && setProjects(await r.json()));
    apiFetch("/api/resources?type=VEHICLE").then(async (r) => r.ok && setVehicles(((await r.json()) as ResourceDTO[]).filter((v) => v.type === "VEHICLE")));
  }, []);
  // Today's page keeps itself current while it's open.
  useEffect(() => {
    if (!data || date !== data.today) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [data, date, load]);

  const groups = data ? [...data.points, ...data.jobs] : [];
  const rows = groups.flatMap((j) => j.rows);
  const has = (f: string) => rows.filter((r) => r.flags.includes(f)).length;

  return (
    <PageShell title="Sign-ins" subtitle="Who signed in and out - at the office, the yard, in the trucks and on each site - and the hours it works out to.">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="rounded-lg border border-edge p-1.5 text-gray-300 hover:bg-panel2" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day"><ChevronLeft size={16} /></button>
        <input type="date" className="rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-sm text-gray-200" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="rounded-lg border border-edge p-1.5 text-gray-300 hover:bg-panel2" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day"><ChevronRight size={16} /></button>
        {data && date !== data.today && (
          <button className="rounded-lg border border-edge px-2.5 py-1.5 text-xs text-gray-300 hover:bg-panel2" onClick={() => setDate(data.today)}>Today</button>
        )}
      </div>
      {error && <div className="mb-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {!data ? (
        !error && <div className="py-10 text-center text-sm text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label={date === data.today ? "On site now" : "Didn't sign out"} value={has(date === data.today ? "STILL_ON" : "NO_SIGN_OUT")} tone={date === data.today ? "text-emerald-400" : "text-amber-500"} />
            <Tile label="Signed in" value={rows.filter((r) => r.status !== "REJECTED").length} />
            <Tile label="Poster - to confirm" value={has("TO_CONFIRM")} tone="text-amber-500" />
            <Tile label="Expected, not signed in" value={groups.reduce((n, j) => n + j.noShows.length, 0)} tone="text-amber-500" />
            <Tile label="Other flags" value={has("NOT_ALLOCATED") + has("SHARED_PHONE") + has("MOVED") + has("ODD_HOURS") + has("LONG_DAY")} tone="text-amber-500" />
          </div>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-3">
              <h2 className="text-sm font-semibold text-gray-200">Office, yard &amp; trucks</h2>
              {data.points.map((j) => (
                <AttendanceJobCard key={j.id} job={j} date={date} canEdit={canEdit} canRemove={isAdmin} people={people} handover={null} onChanged={load} />
              ))}
              <h2 className="pt-3 text-sm font-semibold text-gray-200">Sites</h2>
              {data.jobs.length === 0 && <p className="text-sm text-gray-500">No jobs on the board for this day.</p>}
              {data.jobs.map((j) => {
                const h = data.handovers.find((x) => x.jobId === j.id);
                return (
                  <AttendanceJobCard
                    key={j.id}
                    job={j}
                    date={date}
                    canEdit={canEdit}
                    canRemove={isAdmin}
                    people={people}
                    handover={h ? { name: h.resource?.name ?? "someone", expiresAt: h.expiresAt } : null}
                    onChanged={load}
                  />
                );
              })}
            </div>
            <PosterPanel projects={projects} vehicles={vehicles} posters={data.posters} canEdit={canEdit} onChanged={load} />
          </div>
        </>
      )}
    </PageShell>
  );
}

"use client";

// Vehicle & plant faults (8 Nov 2026, Ilies - pre-start checks stage 1). Faults reported from a truck's pre-start or
// post-check, worked Open -> In hand -> Fixed; and the Checks tab - each day's truck sign-ins with their pre-start and
// post-check ("No pre-start" when it was skipped). Managers, Admins, the coordinator and the yard computer (the routes
// refuse everyone else). No money here. Tool faults stay on Tools -> Faults & Hilti swaps.
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Truck } from "lucide-react";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/components/AuthProvider";
import { PriorityBadge } from "@/components/site/PrestartCheck";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { localISODate } from "@/lib/resource";
import { LIMITS, PRIORITIES, PRIORITY_LABEL, type FaultPriority } from "@/lib/prestart/rules";
import { CHECKLISTS, answerLabel, type Answer } from "@/lib/prestart/checklists";
import type { FaultDTO, checksForDay } from "@/lib/prestart/store";

type Checks = Awaited<ReturnType<typeof checksForDay>>;
const field = "rounded-lg border border-edge bg-panel2 px-2.5 py-1.5 text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500";
const btn = "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50";
const quiet = "rounded-lg border border-edge px-3 py-1.5 text-xs text-gray-300 hover:bg-panel2 disabled:opacity-50";
const when = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const STATUS_TONE: Record<string, string> = { OPEN: "bg-red-500/15 text-red-300", IN_HAND: "bg-amber-500/15 text-amber-300", FIXED: "bg-emerald-500/15 text-emerald-300" };
const ACTION: Record<string, string> = { REPORTED: "Reported", SEEN: "Still there", STATUS: "Status", PRIORITY: "Priority", NOTE: "Note", DOWN: "Marked Down", BACK_AVAILABLE: "Back to Available" };
// What an answer read on the phone ("No" / "Yes - report it" on a question item).
const labelOf = (list: string, key: string, a: string) => { const i = CHECKLISTS[list]?.items.find((x) => x.key === key); return i ? answerLabel(i, a as Answer) : a === "FAULT" ? "Fault" : a === "NA" ? "N/A" : "OK"; };
const word = (v: string | null) => (v ? (PRIORITY_LABEL as Record<string, string>)[v] ?? ({ OPEN: "Open", IN_HAND: "In hand", FIXED: "Fixed", DOWN: "Down", AVAILABLE: "Available" } as Record<string, string>)[v] ?? v : "");

export default function FaultsPage() {
  const { user, loading, canEdit, coordinatorOnly, yardOnly } = useAuth();
  const allowed = canEdit || coordinatorOnly || yardOnly;
  const [tab, setTab] = useState<"faults" | "checks">("faults");
  const tabBtn = (on: boolean) => `rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wide ${on ? "bg-brand-600 text-white" : "bg-panel2 text-gray-400 hover:text-gray-200"}`;
  if (loading || !user) return <PageShell title="Vehicle & plant faults"><p className="text-sm text-gray-500">Loading...</p></PageShell>;
  if (!allowed) return <PageShell title="Vehicle & plant faults"><p className="text-sm text-gray-500">Managers, Admins, the coordinator and the yard only.</p></PageShell>;
  return (
    <PageShell title="Vehicle & plant faults" subtitle="Faults from the truck pre-starts and post-checks, and each day's checks. Tool faults are under Tools.">
      <div className="mb-3 flex gap-1">
        <button className={tabBtn(tab === "faults")} onClick={() => setTab("faults")}>Faults</button>
        <button className={tabBtn(tab === "checks")} onClick={() => setTab("checks")}>Checks</button>
      </div>
      {tab === "faults" ? <FaultsTab /> : <ChecksTab />}
    </PageShell>
  );
}

function FaultsTab() {
  const [status, setStatus] = useState("OPEN_ALL");
  const [resource, setResource] = useState("");
  const [data, setData] = useState<{ faults: FaultDTO[]; machines: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (status !== "OPEN_ALL") q.set("status", status);
    if (resource) q.set("resource", resource);
    apiFetch(`/api/faults?${q}`).then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the faults."))));
  }, [status, resource]);
  useEffect(() => { load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>, done: string) {
    setError(null);
    const res = await fetch(`/api/faults/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { setError(await serverErrorMessage(res, "Couldn't save that.")); return false; }
    const r = await res.json().catch(() => ({}));
    setFlash(r.backToAvailable ? `${done} The machine is back to Available.` : done);
    load();
    return true;
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={field} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="OPEN_ALL">Open and in hand</option><option value="OPEN">Open</option><option value="IN_HAND">In hand</option><option value="FIXED">Fixed</option><option value="ALL">All</option>
        </select>
        <select className={field} value={resource} onChange={(e) => setResource(e.target.value)} aria-label="Machine">
          <option value="">All machines</option>{data?.machines.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      {flash && <div className="mb-3 rounded-lg bg-emerald-500/15 px-3 py-2 text-sm text-emerald-300">{flash}</div>}
      {error && <div className="mb-3 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{error}</div>}
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p>
        : data.faults.length === 0 ? <p className="rounded-lg border border-dashed border-edge py-8 text-center text-sm text-gray-500">No faults{status === "OPEN_ALL" ? " open" : " here"}. They come in from the truck pre-starts and post-checks.</p>
        : <div className="space-y-3">{data.faults.map((f) => <FaultCard key={f.id} f={f} patch={patch} />)}</div>}
    </>
  );
}

function FaultCard({ f, patch }: { f: FaultDTO; patch: (id: string, body: Record<string, unknown>, done: string) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [fixing, setFixing] = useState(false);
  const [back, setBack] = useState(f.canBackToAvailable);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = f.status !== "FIXED";
  const go = async (body: Record<string, unknown>, done: string) => { setBusy(true); if (await patch(f.id, body, done)) { setNote(""); setFixing(false); } setBusy(false); };
  return (
    <div className={`rounded-xl border bg-panel p-4 shadow-soft ${f.priority === "DO_NOT_USE" && open ? "border-red-500" : "border-edge"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Truck size={14} className="text-gray-400" />
            <span className="font-semibold text-gray-100">{f.resourceName}</span>
            <PriorityBadge p={f.priority} label={f.priority === "DO_NOT_USE" ? "⛔ Do not use" : f.priorityLabel} />
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[f.status] ?? ""}`}>{f.statusLabel}</span>
            {f.machineStatus === "DOWN" && <span className="rounded-full bg-red-900/70 px-1.5 py-0.5 text-[10px] uppercase text-red-200">down</span>}
          </div>
          {f.itemLabel && <div className="mt-0.5 text-xs text-gray-400">{f.checkKind === "POST" ? "Post-check" : f.checkKind === "PRE" ? "Pre-start" : ""}{f.checkKind ? ": " : ""}{f.itemLabel}</div>}
        </div>
        <div className="text-right text-[11px] text-gray-500">
          Reported {when(f.reportedAt)} by {f.reportedBy}
          {/* PS-004: where it came from - staff or hire (and their company), and how they signed in. */}
          {f.source && (
            <div className={f.source.staff ? "" : "text-amber-300"}>
              {f.source.staff ? "Staff" : `Hire${f.source.company ? ` - ${f.source.company}` : ""}`} · {f.source.method}{f.source.point ? ` (${f.source.point})` : ""}
            </div>
          )}
          {f.lastSeenAt && <div>Still there: {when(f.lastSeenAt)} ({f.lastSeenBy}){f.seenCount > 1 ? ` · seen ${f.seenCount} times` : ""}</div>}
          {f.fixedAt && <div>Fixed {when(f.fixedAt)} by {f.fixedBy}</div>}
        </div>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-200">{f.description}</p>
      {f.fixNote && <p className="mt-1 text-xs text-emerald-300">Fix: {f.fixNote}</p>}
      {f.photoNote && <p className="mt-1 text-xs text-amber-300">{f.photoNote}</p>}
      {f.mediaIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {f.mediaIds.map((m) => (
            <a key={m} href={`/api/faults/media/${m}`} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/faults/media/${m}`} alt="Fault photo" className="h-24 w-24 rounded-md border border-edge object-cover" />
            </a>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-2 border-t border-edge pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${field} min-w-[16rem] flex-1`} maxLength={LIMITS.note} placeholder={fixing ? "What was done to fix it? (needed)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
            {f.status === "OPEN" && !fixing && <button className={quiet} disabled={busy} onClick={() => go({ status: "IN_HAND", note }, "Marked in hand.")}>In hand</button>}
            {!fixing ? <button className={btn} disabled={busy} onClick={() => setFixing(true)}>Fixed...</button> : (
              <>
                {f.canBackToAvailable && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-300"><input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} /> Put it back to Available</label>
                )}
                <button className={btn} disabled={busy || note.trim().length < LIMITS.minFixNote} onClick={() => go({ status: "FIXED", note, backToAvailable: f.canBackToAvailable && back }, "Marked fixed.")}>Mark fixed</button>
                <button className={quiet} disabled={busy} onClick={() => setFixing(false)}>Cancel</button>
              </>
            )}
            {!fixing && note.trim() && <button className={quiet} disabled={busy} onClick={() => go({ note }, "Note added.")}>Add note</button>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
            Priority:
            <select className={field} value={f.priority} disabled={busy} onChange={(e) => go({ priority: e.target.value as FaultPriority }, "Priority changed.")} aria-label="Priority">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
            {f.priority !== "DO_NOT_USE" && <span className="text-gray-500">Do not use marks the machine Down.</span>}
          </div>
        </div>
      )}

      <button className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300" onClick={() => setHistory((h) => !h)}>
        {history ? <ChevronDown size={12} /> : <ChevronRight size={12} />} History ({f.events.length})
      </button>
      {history && (
        <ul className="mt-1 space-y-0.5 text-xs text-gray-400">
          {f.events.map((e, i) => (
            <li key={i}>{when(e.at)} · {e.by} · {ACTION[e.action] ?? e.action}{e.from || e.to ? `: ${word(e.from)}${e.from && e.to ? " → " : ""}${word(e.to)}` : ""}{e.note ? ` - ${e.note}` : ""}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChecksTab() {
  const [day, setDay] = useState(localISODate());
  const [data, setData] = useState<Checks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    apiFetch(`/api/faults/checks?date=${day}`).then(async (r) => (r.ok ? (setError(null), setData(await r.json())) : setError(await serverErrorMessage(r, "Couldn't load the checks."))));
  }, [day]);
  const tone = (s: string) => (s.startsWith("No ") ? "bg-red-500/15 text-red-300" : s.includes("fault") ? "bg-amber-500/15 text-amber-300" : s === "Done" ? "bg-emerald-500/15 text-emerald-300" : "bg-gray-700/50 text-gray-300");
  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <input type="date" className={field} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
        {data && <span className="text-xs text-gray-500">{data.signIns.length} truck sign-in{data.signIns.length === 1 ? "" : "s"} · {data.signIns.filter((s) => !s.pre).length} with no pre-start</span>}
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <h2 className="mb-2 text-sm font-semibold text-gray-200">Trucks</h2>
      {!data ? <p className="py-8 text-center text-sm text-gray-500">Loading...</p>
        : data.signIns.length === 0 ? <p className="rounded-lg border border-dashed border-edge py-8 text-center text-sm text-gray-500">No truck sign-ins that day.</p>
        : (
          <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
            {data.signIns.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => setOpenRow(openRow === s.id ? null : s.id)}>
                  {openRow === s.id ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                  <span className="font-medium text-gray-100">{s.machine}</span>
                  <span className="text-sm text-gray-300">{s.person}</span>
                  <span className="text-xs text-gray-500">{s.signedIn}{s.signedOut ? ` - ${s.signedOut}` : ""}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone(s.preStatus)}`}>Pre-start: {s.preStatus}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone(s.postStatus)}`}>Post-check: {s.postStatus}</span>
                </button>
                {openRow === s.id && (
                  <>
                  {/* Stage 1b (10 Nov 2026): the walk-around photos and the odometer - click one for the full size. */}
                  {(s.pre?.walkaround || s.odometer) && (
                    <div className="mt-2 pl-6">
                      <div className="mb-1 text-xs text-gray-400">
                        Walk-around: {s.pre?.walkaround === "DONE" ? "taken" : s.pre?.walkaround === "LIMIT" ? "photos couldn't be added (the day's photo limit)" : s.pre?.walkaround === "OPTIONAL" ? "optional (not the day's first)" : "-"}
                        {" · "}Odometer: {!s.odometer ? "not sent" : s.odometer.status === "SKIPPED" ? "skipped" : s.odometer.km != null ? `${s.odometer.km.toLocaleString("en-AU")} km` : "sent, not read yet"}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {s.pre?.walkaroundPhotos.map((p) => (
                          <a key={p.id} href={`/api/faults/media/${p.id}`} target="_blank" rel="noreferrer" className="text-center text-[10px] text-gray-400">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/faults/media/${p.id}`} alt={p.label} className="h-20 w-20 rounded-md border border-edge object-cover" />
                            {p.label}
                          </a>
                        ))}
                        {s.odometer?.photoIds.map((id) => (
                          <a key={id} href={`/api/faults/odometer/${id}`} target="_blank" rel="noreferrer" className="text-center text-[10px] text-gray-400">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/faults/odometer/${id}`} alt="Odometer" className="h-20 w-20 rounded-md border border-edge object-cover" />
                            Odometer
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 grid gap-3 pl-6 sm:grid-cols-2">
                    {([["Pre-start", s.pre], ["Post-check", s.post]] as const).map(([label, c]) => (
                      <div key={label} className="rounded-lg border border-edge bg-panel2 p-3 text-xs">
                        <div className="mb-1 font-semibold text-gray-200">{label}{c ? ` · ${c.at}` : ""}</div>
                        {!c ? <p className="text-gray-500">Not done.</p> : (
                          <>
                            <ul className="space-y-0.5">
                              {c.answers.map((a) => (
                                <li key={a.key} className="flex justify-between gap-2">
                                  <span className="text-gray-300">{a.label}</span>
                                  <span className={a.answer === "FAULT" ? "font-semibold text-red-300" : a.answer === "NA" ? "text-gray-500" : "text-emerald-300"}>{labelOf(c.checklist, a.key, a.answer)}</span>
                                </li>
                              ))}
                            </ul>
                            {c.seenCount > 0 && <p className="mt-1 text-gray-400">{c.seenCount} known fault{c.seenCount > 1 ? "s" : ""} confirmed still there.</p>}
                            {c.faults.length > 0 && <p className="mt-1 text-amber-300">New: {c.faults.map((f) => `${f.itemLabel} (${f.priority}, ${f.status.toLowerCase()})`).join(", ")}</p>}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      {data && <PlantSection plant={data.plant} tone={tone} reload={async () => {
        const r = await apiFetch(`/api/faults/checks?date=${day}`); if (r.ok) setData(await r.json());
      }} />}
    </>
  );
}

// Stage 2 (plant QR stickers, 10 Nov 2026): owned plant booked on the board that day ("No pre-start" when none), and any
// machine checked that day - who did each check, the walk-around and hour-meter photos, the hours (flagged when lower
// than before) and the answers. Click a photo for the full size (behind the same login as the rest of this page).
function PlantSection({ plant, tone, reload }: { plant: Checks["plant"]; tone: (s: string) => string; reload: () => Promise<void> }) {
  // "Reading wrong" is Managers and Admins only (Ilies, 10 Nov 2026) - the coordinator and the yard see the tab without it.
  const { canEdit: canMarkWrong } = useAuth();
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // PS-019: "Reading wrong" - kept, struck through with the reason, left out of "the last reading".
  async function markWrong(checkId: string) {
    const note = window.prompt("Why is this hour-meter reading wrong? (kept with the reading)");
    if (!note) return;
    setErr(null);
    const res = await fetch(`/api/faults/checks/${checkId}/hour-meter`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
    if (!res.ok) return setErr(await serverErrorMessage(res, "Couldn't save that."));
    await reload();
  }
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-gray-200">Plant</h2>
      {err && <div className="mb-2 rounded-md bg-red-900/30 px-3 py-2 text-xs text-red-300">{err}</div>}
      {plant.length === 0 ? <p className="rounded-lg border border-dashed border-edge py-6 text-center text-sm text-gray-500">No owned plant booked or checked that day.</p> : (
        <ul className="divide-y divide-edge/60 rounded-xl border border-edge bg-panel">
          {plant.map((m) => (
            <li key={m.machineId} className="px-4 py-3">
              <button className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left" onClick={() => setOpen(open === m.machineId ? null : m.machineId)}>
                {open === m.machineId ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
                <span className="font-medium text-gray-100">{m.machine}</span>
                <span className="text-xs text-gray-500">{m.booked ? `Booked: ${m.sites.join(", ")}` : "Not booked that day"}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone(m.preStatus)}`}>Pre-start: {m.preStatus}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone(m.postStatus)}`}>Post-check: {m.postStatus}</span>
                {m.checks.some((c) => c.hourMeterFlag && !c.hourMeterWrong) && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">Hours to check</span>}
              </button>
              {open === m.machineId && (
                <div className="mt-2 space-y-3 pl-6">
                  {m.checks.length === 0 && <p className="text-xs text-gray-500">No checks that day.</p>}
                  {m.checks.map((c) => (
                    <div key={c.id} className="rounded-lg border border-edge bg-panel2 p-3 text-xs">
                      <div className="mb-1 font-semibold text-gray-200">
                        {c.kind === "PRE" ? "Pre-start" : "Post-check"} · {c.at} · {c.person}{c.staff ? "" : " (hire)"}
                      </div>
                      <div className="mb-2 text-gray-400">
                        Hours: <span className={c.hourMeterWrong ? "line-through" : ""}>{c.hourMeter != null ? c.hourMeter.toLocaleString("en-AU") : "-"}</span>
                        {c.hourMeterFlag === "LOWER" && <span className="ml-1 font-semibold text-amber-300">lower than the last reading ({c.hourMeterPrev?.toLocaleString("en-AU")})</span>}
                        {c.hourMeterFlag === "HIGHER" && <span className="ml-1 font-semibold text-amber-300">a lot higher than the last reading ({c.hourMeterPrev?.toLocaleString("en-AU")})</span>}
                        {c.hourMeterWrong ? <span className="ml-1 text-gray-500">- marked wrong by {c.hourMeterWrong.by}: {c.hourMeterWrong.note}</span>
                          : c.hourMeter != null && canMarkWrong && <button className="ml-2 text-brand-300 hover:underline" onClick={() => markWrong(c.id)}>Reading wrong</button>}
                        {c.kind === "PRE" && <> · Walk-around: {c.walkaround === "DONE" ? "taken" : c.walkaround === "LIMIT" ? "photos couldn't be added (the day's photo limit)" : c.walkaround === "OPTIONAL" ? "optional (not the day's first)" : "-"}</>}
                      </div>
                      <div className="mb-2 flex flex-wrap gap-2">
                        {[...c.walkaroundPhotos, ...(c.meterPhotoId ? [{ id: c.meterPhotoId, label: "Hour meter" }] : [])].map((p) => (
                          <a key={p.id} href={`/api/faults/media/${p.id}`} target="_blank" rel="noreferrer" className="text-center text-[10px] text-gray-400">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/api/faults/media/${p.id}`} alt={p.label} className="h-20 w-20 rounded-md border border-edge object-cover" />
                            {p.label}
                          </a>
                        ))}
                      </div>
                      <ul className="space-y-0.5">
                        {c.answers.map((a) => (
                          <li key={a.key} className="flex justify-between gap-2">
                            <span className="text-gray-300">{a.label}</span>
                            <span className={a.answer === "FAULT" ? "font-semibold text-red-300" : a.answer === "NA" ? "text-gray-500" : "text-emerald-300"}>{labelOf(c.checklist, a.key, a.answer)}</span>
                          </li>
                        ))}
                      </ul>
                      {c.seenCount > 0 && <p className="mt-1 text-gray-400">{c.seenCount} known fault{c.seenCount > 1 ? "s" : ""} confirmed still there.</p>}
                      {c.faults.length > 0 && <p className="mt-1 text-amber-300">New: {c.faults.map((f) => `${f.itemLabel} (${f.priority}, ${f.status.toLowerCase()})`).join(", ")}</p>}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

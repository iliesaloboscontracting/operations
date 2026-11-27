"use client";

// "Needs attention" (LCI Stage 1, Ilies 25 Nov 2026: "approve all defaults"; plan §3.1 / §3.3). One compact card:
// on the board (/command) for the owner, Admins and Managers, and Alex's money-free "For you" card on /coordinator.
// Worst first, grouped, capped (lib/findings/card.ts); each line says what and where, since when, opens the page that
// fixes it, and has Snooze (to a date, with a reason) and Done (with a reason). "+ N more" opens a drawer - not a new
// page. Folds to one line, like Pre-starts today, so the board doesn't move. The route refuses every other login, so
// nothing shows for them; LCI_CARD=off hides it.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import { apiFetch, serverErrorMessage } from "@/lib/apiFetch";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import type { CardDTO, CardEntry, CardLine } from "@/lib/findings/card";
import { useBoardSection, type SectionSummary } from "../board/BoardSummary";

const KEY = "lobos-needs-attention-card"; // "closed" = folded on this computer (a convenience only)
const DOT: Record<CardLine["severity"], string> = { CRITICAL: "bg-red-500", HIGH: "bg-orange-400", MEDIUM: "bg-amber-300", INFO: "bg-gray-500" };
const SYDNEY = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
const SHORT = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short" });
const inDays = (n: number) => SYDNEY.format(new Date(Date.now() + n * 86_400_000));
const since = (iso: string) => `since ${SHORT.format(new Date(iso))}`;

export default function NeedsAttentionCard({ variant }: { variant: "board" | "coordinator" }) {
  const [data, setData] = useState<CardDTO | null>(null);
  const [open, setOpen] = useState(true);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { try { if (localStorage.getItem(KEY) === "closed") setOpen(false); } catch { /* no storage - stays open */ } }, []);
  const load = useCallback(() => {
    apiFetch("/api/findings/card").then((r) => (r.ok ? r.json() : null)).then((d) => setData(d && !d.off ? d : null)).catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  useAutoRefresh(load);
  const hasAny = !!data && (data.top.length > 0 || data.dataGaps.length > 0);
  // On the board's slim summary row (laptop windows, 27 Nov 2026) - urgent stays red there, never hidden.
  const section = useBoardSection("attention", variant === "board" && hasAny && data ? attentionSummary(data) : null);
  if (!data || !hasAny) return null;
  const ownToggle = () => { const next = !open; setOpen(next); try { localStorage.setItem(KEY, next ? "open" : "closed"); } catch { /* fine */ } };
  // Opened from the summary row: the whole card shows, and its header folds it back into the row.
  const boardRow = variant === "board" && !!section?.compact;
  const toggle = boardRow ? section!.collapse : ownToggle;
  const shown = boardRow ? true : open;
  const moreCount = data.more.reduce((n, e) => n + (e.kind === "GROUP" ? e.items.length : 1), 0);
  const title = variant === "coordinator" ? "For you" : "Needs attention";
  return (
    <section className={`rounded-xl border border-edge bg-panel px-3 py-2 ${variant === "coordinator" ? "shadow-soft" : ""}`} data-testid="needs-attention" aria-label={title}>
      <button onClick={toggle} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-left text-sm" aria-expanded={shown}>
        {shown ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />}
        <span className="flex items-center gap-1.5 font-semibold text-gray-100"><AlertTriangle size={15} /> {title}</span>
        {data.counts.urgent > 0 && <span className="font-semibold text-red-300">{data.counts.urgent} urgent</span>}
        {data.counts.toDo > 0 && <span className="text-amber-300">{data.counts.toDo} to do</span>}
        {data.counts.urgent + data.counts.toDo === 0 && <span className="text-gray-400">Nothing urgent</span>}
      </button>
      {shown && (
        <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pl-5">
          {data.top.map((e) => <Entry key={e.kind === "ONE" ? e.line.id : e.rule} e={e} onDone={load} max={data.snoozeMaxDays} />)}
          {(moreCount > 0 || data.dataGaps.length > 0) && (
            <button onClick={() => setDrawer(true)} className="text-xs text-brand-300 hover:underline">
              {moreCount > 0 ? `+ ${moreCount} more` : ""}{moreCount > 0 && data.dataGaps.length > 0 ? " · " : ""}{data.dataGaps.length > 0 ? `${data.dataGaps.length} data gaps` : ""}
            </button>
          )}
        </div>
      )}
      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDrawer(false)}>
          <div className="h-full w-full max-w-lg overflow-y-auto border-l border-edge bg-panel p-4 shadow-lg" onClick={(ev) => ev.stopPropagation()} role="dialog" aria-label={`${title} - everything`}>
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-semibold text-gray-100"><AlertTriangle size={16} /> {title} - everything</span>
              <button onClick={() => setDrawer(false)} className="text-gray-500 hover:text-gray-200" aria-label="Close"><X size={16} /></button>
            </div>
            <div className="space-y-1">
              {[...data.top, ...data.more].map((e) => <Entry key={e.kind === "ONE" ? e.line.id : e.rule} e={e} onDone={load} max={data.snoozeMaxDays} />)}
            </div>
            {data.dataGaps.length > 0 && <DataGaps lines={data.dataGaps} onDone={load} max={data.snoozeMaxDays} />}
          </div>
        </div>
      )}
    </section>
  );
}

function attentionSummary(data: CardDTO): SectionSummary {
  const parts: SectionSummary["parts"] = [];
  if (data.counts.urgent > 0) parts.push({ text: `${data.counts.urgent} urgent`, tone: "red" });
  if (data.counts.toDo > 0) parts.push({ text: `${data.counts.toDo} to do`, tone: "amber" });
  if (!parts.length) parts.push({ text: "nothing urgent", tone: "muted" });
  return { label: "Needs attention", parts };
}

function DataGaps({ lines, onDone, max }: { lines: CardLine[]; onDone: () => void; max: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-edge pt-3">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-1 text-sm font-semibold text-gray-300" aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Data gaps ({lines.length})
      </button>
      <p className="mt-0.5 text-xs text-gray-500">Missing rates, dates or times - information only. They clear themselves once filled in.</p>
      {open && <div className="mt-2 space-y-1">{lines.map((l) => <Line key={l.id} l={l} onDone={onDone} max={max} />)}</div>}
    </div>
  );
}

function Entry({ e, onDone, max }: { e: CardEntry; onDone: () => void; max: number }) {
  const [open, setOpen] = useState(false);
  if (e.kind === "ONE") return <Line l={e.line} onDone={onDone} max={max} />;
  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-xs" aria-expanded={open}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.severity]}`} />
        {open ? <ChevronDown size={12} className="text-gray-500" /> : <ChevronRight size={12} className="text-gray-500" />}
        <span className="font-medium text-gray-100">{e.label}: {e.items.length}</span>
        <span className="shrink-0 text-gray-500">{since(e.since)}</span>
      </button>
      {open && <div className="mt-1 space-y-1 pl-5">{e.items.map((l) => <Line key={l.id} l={l} onDone={onDone} max={max} />)}</div>}
    </div>
  );
}

function Line({ l, onDone, max }: { l: CardLine; onDone: () => void; max: number }) {
  const [mode, setMode] = useState<null | "SNOOZE" | "DONE">(null);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(inDays(7));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setErr(null);
    const body = mode === "SNOOZE" ? { action: "DISMISS", kind: "ACCEPTED_RISK", until, reason } : { action: "RESOLVE", note: reason };
    const r = await apiFetch(`/api/findings/${l.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!r.ok) { setErr(await serverErrorMessage(r, "Couldn't save that.")); return; }
    setMode(null); setReason(""); onDone();
  };
  return (
    <div className="text-xs">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[l.severity]}`} title={l.severity.toLowerCase()} />
        <span className="min-w-0 flex-1 truncate text-gray-200" title={l.title}>{l.title}</span>
        {l.doneButStillShowing && <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-200" title="Marked done, but the rule still finds it">done - still showing</span>}
        {l.cleared && <span className="shrink-0 text-[10px] text-emerald-300" title="It's no longer found - it closes itself soon">clearing</span>}
        <span className="shrink-0 text-gray-500">{since(l.since)}</span>
        {l.href && <Link href={l.href} className="shrink-0 font-medium text-brand-300 hover:underline">Fix</Link>}
        {!l.doneButStillShowing && (
          <>
            <button onClick={() => setMode(mode === "SNOOZE" ? null : "SNOOZE")} className="shrink-0 text-gray-400 hover:text-gray-100">Snooze</button>
            <button onClick={() => setMode(mode === "DONE" ? null : "DONE")} className="shrink-0 text-gray-400 hover:text-gray-100">Done</button>
          </>
        )}
      </div>
      {mode && (
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-4">
          {mode === "SNOOZE" && (
            <label className="flex items-center gap-1 text-gray-400">until
              <input type="date" value={until} min={inDays(1)} max={inDays(max)} onChange={(ev) => setUntil(ev.target.value)} className="rounded border border-edge bg-panel2 px-1.5 py-0.5 text-gray-200" />
            </label>
          )}
          <input value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} placeholder={mode === "SNOOZE" ? "Why it can wait" : "What was done"}
            className="min-w-[10rem] flex-1 rounded border border-edge bg-panel2 px-1.5 py-0.5 text-gray-200" />
          <button disabled={busy || reason.trim().length < 2} onClick={send} className="rounded bg-brand-600 px-2 py-0.5 font-medium text-white disabled:opacity-50">{mode === "SNOOZE" ? "Snooze" : "Mark done"}</button>
          <button onClick={() => setMode(null)} className="text-gray-500 hover:text-gray-200">Cancel</button>
          {err && <span className="w-full text-red-300">{err}</span>}
        </div>
      )}
    </div>
  );
}
